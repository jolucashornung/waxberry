import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline, env } from '@huggingface/transformers';
import { createServer, wavBase64ToFloat32 } from './shared.js';
import type { Routes } from './shared.js';

env.cacheDir = path.join(os.homedir(), '.live-translate', 'models');

const MODEL = process.env['WHISPER_MODEL'] ?? 'onnx-community/whisper-base';
const PORT = parseInt(process.env['PORT'] ?? '8001', 10);

const transcriber = await pipeline('automatic-speech-recognition', MODEL, { dtype: 'q8' });

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

export const routes: Routes = {
  'GET /health': async () => ({
    status: 'ok',
    model: MODEL,
    device: 'cpu',
  }),

  'POST /transcribe': async (body) => {
    const req = body as { audio_base64: string; sample_rate: number };
    if (!req.audio_base64) {
      throw new Error('Invalid request: audio_base64 is required');
    }

    const { samples } = wavBase64ToFloat32(req.audio_base64);

    const language = await detectAudioLanguage(samples);

    const result = await transcriber(samples, {
      language: language === 'zh' ? 'chinese' : 'english',
      task: 'transcribe',
    });
    const output = Array.isArray(result) ? result[0] : result;
    const text = (output as { text: string }).text?.trim() ?? '';

    return { text, language, confidence: 0.95 };
  },
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(routes, PORT);
}
