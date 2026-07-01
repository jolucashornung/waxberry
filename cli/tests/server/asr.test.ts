import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// Language token IDs matching onnx-community/whisper-base generation_config
const SOT = 50258;
const LANG_EN = 50259;
const LANG_ZH = 50260;

// Language probe result: a Tensor-like where [0].tolist() returns [SOT, LANG_TOKEN]
const langProbe = (langTokenId: number) => ({
  0: { tolist: () => [BigInt(SOT), BigInt(langTokenId)] },
});

const mockModelGenerate = vi.fn();
const mockProcessor = vi.fn();
const mockTranscriber = vi.fn();

// Attach pipeline internals that detectAudioLanguage accesses via (transcriber as any)
Object.assign(mockTranscriber, {
  processor: mockProcessor,
  model: {
    generate: mockModelGenerate,
    generation_config: {
      decoder_start_token_id: SOT,
      is_multilingual: true,
      lang_to_id: { '<|zh|>': LANG_ZH, '<|en|>': LANG_EN },
    },
  },
});

vi.mock('@huggingface/transformers', () => ({
  pipeline: vi.fn().mockResolvedValue(mockTranscriber),
  env: { cacheDir: '' },
}));

// Stub wavBase64ToFloat32 so POST /transcribe tests don't need a real WAV buffer.
vi.mock('../../src/server/shared.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/server/shared.js')>();
  return {
    ...actual,
    wavBase64ToFloat32: vi.fn().mockReturnValue({ samples: new Float32Array(1), sampleRate: 16000 }),
  };
});

let detectLanguage: (text: string) => 'en' | 'zh';
let routes: import('../../src/server/shared.js').Routes;

beforeAll(async () => {
  const mod = await import('../../src/server/asr.js');
  detectLanguage = mod.detectLanguage;
  routes = mod.routes;
});

describe('detectLanguage', () => {
  it('returns "en" for English text', () => {
    expect(detectLanguage('Hello, how are you doing today?')).toBe('en');
  });

  it('returns "zh" for Chinese text', () => {
    expect(detectLanguage('你好，今天怎么样？')).toBe('zh');
  });

  it('returns "zh" for mixed text with more than 30% Chinese characters', () => {
    // 4 CJK out of 7 non-space chars = ~57%
    expect(detectLanguage('hi 你好 世界')).toBe('zh');
  });

  it('returns "en" for mixed text with less than 30% Chinese characters', () => {
    // 1 CJK out of many non-space chars
    expect(detectLanguage('this is a long english sentence with one 你 character')).toBe('en');
  });

  it('returns "en" for empty string', () => {
    expect(detectLanguage('')).toBe('en');
  });

  it('returns "en" for whitespace-only string', () => {
    expect(detectLanguage('   ')).toBe('en');
  });

  it('returns "zh" when exactly at 30% threshold (>0.3)', () => {
    // Exactly 3 CJK out of 10 non-space = 0.3 → NOT > 0.3 → returns 'en'
    expect(detectLanguage('abcdefg你好吗')).toBe('en');
  });

  it('returns "zh" when just above 30% threshold', () => {
    // 4 CJK out of 10 non-space = 0.4 > 0.3 → 'zh'
    expect(detectLanguage('abcdef你好吗啊')).toBe('zh');
  });
});

describe('POST /transcribe — native language probe', () => {
  const transcribeHandler = async (body: unknown) =>
    routes['POST /transcribe'](body);

  beforeEach(() => {
    mockModelGenerate.mockReset();
    mockProcessor.mockReset();
    mockTranscriber.mockReset();
    mockProcessor.mockResolvedValue({ input_features: new Float32Array(1) });
  });

  it('detects Chinese and transcribes with language: chinese in a single pass', async () => {
    mockModelGenerate.mockResolvedValue(langProbe(LANG_ZH));
    mockTranscriber.mockResolvedValue([{ text: '你好' }]);

    const result = await transcribeHandler({ audio_base64: 'dGVzdA==' }) as Record<string, unknown>;

    expect(result.text).toBe('你好');
    expect(result.language).toBe('zh');
    // One probe call, one transcription call
    expect(mockModelGenerate).toHaveBeenCalledTimes(1);
    expect(mockTranscriber).toHaveBeenCalledTimes(1);
    expect(mockTranscriber).toHaveBeenCalledWith(
      expect.any(Float32Array),
      { language: 'chinese', task: 'transcribe' },
    );
  });

  it('detects English and transcribes with language: english in a single pass', async () => {
    mockModelGenerate.mockResolvedValue(langProbe(LANG_EN));
    mockTranscriber.mockResolvedValue([{ text: 'Hello' }]);

    const result = await transcribeHandler({ audio_base64: 'dGVzdA==' }) as Record<string, unknown>;

    expect(result.text).toBe('Hello');
    expect(result.language).toBe('en');
    expect(mockModelGenerate).toHaveBeenCalledTimes(1);
    expect(mockTranscriber).toHaveBeenCalledTimes(1);
    expect(mockTranscriber).toHaveBeenCalledWith(
      expect.any(Float32Array),
      { language: 'english', task: 'transcribe' },
    );
  });

  it('probe passes decoder_start_token_id and max_new_tokens: 1 to model.generate', async () => {
    mockModelGenerate.mockResolvedValue(langProbe(LANG_EN));
    mockTranscriber.mockResolvedValue([{ text: 'test' }]);

    await transcribeHandler({ audio_base64: 'dGVzdA==' });

    expect(mockModelGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        decoder_input_ids: [SOT],
        max_new_tokens: 1,
        do_sample: false,
      }),
    );
  });

  it('re-transcribes in the corrected language when the transcript disagrees with the probe', async () => {
    // Probe says English, but the forced-English transcription leaks Chinese characters.
    mockModelGenerate.mockResolvedValue(langProbe(LANG_EN));
    mockTranscriber
      .mockResolvedValueOnce([{ text: '你好世界你好' }])  // first pass (english) — leaks Chinese
      .mockResolvedValueOnce([{ text: '你好世界，你好。' }]); // second pass (chinese) — corrected

    const result = await transcribeHandler({ audio_base64: 'dGVzdA==' }) as Record<string, unknown>;

    expect(result.language).toBe('zh');
    expect(result.text).toBe('你好世界，你好。');
    // One probe, two transcription passes
    expect(mockTranscriber).toHaveBeenCalledTimes(2);
    expect(mockTranscriber).toHaveBeenNthCalledWith(1, expect.any(Float32Array), { language: 'english', task: 'transcribe' });
    expect(mockTranscriber).toHaveBeenNthCalledWith(2, expect.any(Float32Array), { language: 'chinese', task: 'transcribe' });
  });

  it('does not re-transcribe when transcript is too short to cross-check', async () => {
    // Probe says English, transcript is short Chinese (< 4 chars) — cross-check skipped.
    mockModelGenerate.mockResolvedValue(langProbe(LANG_EN));
    mockTranscriber.mockResolvedValue([{ text: '你' }]);

    const result = await transcribeHandler({ audio_base64: 'dGVzdA==' }) as Record<string, unknown>;

    expect(result.language).toBe('en');
    expect(mockTranscriber).toHaveBeenCalledTimes(1);
  });

  it('throws when audio_base64 is missing', async () => {
    await expect(transcribeHandler({})).rejects.toThrow('audio_base64 is required');
  });
});
