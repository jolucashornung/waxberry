import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline, env } from '@huggingface/transformers';
import { createServer, wavBase64ToFloat32 } from './shared.js';
import type { Routes } from './shared.js';
import { asrDeviceAttempts, isDevicePreference } from '../utils/device.js';

env.cacheDir = path.join(os.homedir(), '.live-translate', 'models');

const MODEL = process.env['WHISPER_MODEL'] ?? 'onnx-community/whisper-base';
const DEVICE_PREF = (() => {
  const raw = process.env['ASR_DEVICE'] ?? 'auto';
  return isDevicePreference(raw) ? raw : 'auto';
})();
const PORT = parseInt(process.env['PORT'] ?? '8001', 10);

let resolvedDevice: 'cpu' | 'gpu' = 'cpu';

// Minimal callable view of the ASR pipeline; the full transformers.js type is too large to
// annotate and we only ever call it or cast it to PipelineInternals for the language probe.
type Transcriber = (audio: Float32Array, options: Record<string, unknown>) => Promise<unknown>;

// Tries each device/dtype attempt in order; the first to initialize wins. On GPU failure
// (no CUDA/CoreML onnxruntime build) the 'auto' preference falls back to CPU rather than crashing.
async function createTranscriber(): Promise<Transcriber> {
  const attempts = asrDeviceAttempts(DEVICE_PREF);
  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      const pipe = await pipeline('automatic-speech-recognition', MODEL, {
        device: attempt.device,
        dtype: attempt.dtype,
      });
      resolvedDevice = attempt.device;
      return pipe as unknown as Transcriber;
    } catch (err) {
      lastError = err;
      console.warn(`ASR: could not initialize on ${attempt.device} (${(err as Error).message})`);
    }
  }
  throw lastError;
}

const transcriber = await createTranscriber();

type PipelineInternals = {
  processor: (audio: Float32Array) => Promise<{ input_features: unknown }>;
  model: {
    generate: (opts: Record<string, unknown>) => Promise<{ 0: { tolist: () => bigint[] } }>;
    generation_config: {
      decoder_start_token_id: number;
      is_multilingual: boolean | null;
      lang_to_id: Record<string, number> | null;
    };
  };
};

// Runs a single decoder probe step to read Whisper's built-in language token prediction.
// Transformers.js v3 left this as a TODO and silently defaults to English; we fill the gap.
async function detectAudioLanguage(samples: Float32Array): Promise<'en' | 'zh'> {
  const pipe = transcriber as unknown as PipelineInternals;
  const { is_multilingual, decoder_start_token_id, lang_to_id } = pipe.model.generation_config;

  if (!is_multilingual || !lang_to_id) return 'en';

  const { input_features } = await pipe.processor(samples);

  // Passing decoder_input_ids bypasses _retrieve_init_tokens (which hard-codes English).
  // max_new_tokens: 1 → the single generated token is Whisper's language prediction.
  const output = await pipe.model.generate({
    inputs: input_features,
    decoder_input_ids: [decoder_start_token_id],
    max_new_tokens: 1,
    do_sample: false,
  });

  const langTokenId = Number(output[0].tolist()[1]);
  return langTokenId === lang_to_id['<|zh|>'] ? 'zh' : 'en';
}

export function detectLanguage(text: string): 'en' | 'zh' {
  const chinese = (text.match(/[一-鿿㐀-䶿]/g) ?? []).length;
  const total = text.replace(/\s/g, '').length;
  return total > 0 && chinese / total > 0.3 ? 'zh' : 'en';
}

// Below this transcript length the char-ratio heuristic is unreliable, so skip the cross-check.
const MIN_CROSS_CHECK_CHARS = 4;

async function transcribeAs(samples: Float32Array, language: 'en' | 'zh'): Promise<string> {
  const result = await transcriber(samples, {
    language: language === 'zh' ? 'chinese' : 'english',
    task: 'transcribe',
  });
  const output = Array.isArray(result) ? result[0] : result;
  return (output as { text: string }).text?.trim() ?? '';
}

export const routes: Routes = {
  'GET /health': async () => ({
    status: 'ok',
    model: MODEL,
    device: resolvedDevice,
  }),

  'POST /transcribe': async (body) => {
    const req = body as { audio_base64: string; sample_rate: number };
    if (!req.audio_base64) {
      throw new Error('Invalid request: audio_base64 is required');
    }

    const { samples } = wavBase64ToFloat32(req.audio_base64);

    let language = await detectAudioLanguage(samples);
    let text = await transcribeAs(samples, language);

    // Cross-check the acoustic probe against the transcript. When forced transcription leaks the
    // true language into the text (e.g. probe said zh but the output is Latin), the char-ratio
    // heuristic disagrees — re-transcribe once in the corrected language. Skips trivial output.
    if (text.length >= MIN_CROSS_CHECK_CHARS) {
      const textLanguage = detectLanguage(text);
      if (textLanguage !== language) {
        language = textLanguage;
        text = await transcribeAs(samples, language);
      }
    }

    return { text, language, confidence: 0.95 };
  },
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(routes, PORT);
}
