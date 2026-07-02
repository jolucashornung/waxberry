import { describe, it, expect, vi, beforeAll } from 'vitest';
import { int16ToWavBase64, wavBase64ToFloat32 } from '../../src/server/shared.js';
import type { VoiceConfig } from '../../src/server/tts.js';

// Mock onnxruntime-node and child_process/execFile before importing tts.ts
vi.mock('onnxruntime-node', () => ({
  InferenceSession: {
    create: vi.fn().mockResolvedValue({
      run: vi.fn().mockResolvedValue({
        output: { data: new Float32Array([0.1, -0.2, 0.3]) },
      }),
    }),
  },
  Tensor: class MockTensor {
    constructor(
      public type: string,
      public data: unknown,
      public dims: number[],
    ) {}
  },
}));

// Mock fs.existsSync so no real voice files are needed
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn().mockReturnValue(false),
      readFileSync: actual.readFileSync,
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      openSync: vi.fn().mockReturnValue(1),
      closeSync: vi.fn(),
      rmSync: vi.fn(),
    },
  };
});

let textToPhonemeIds: (ipa: string, config: VoiceConfig) => number[];

beforeAll(async () => {
  const mod = await import('../../src/server/tts.js');
  textToPhonemeIds = mod.textToPhonemeIds;
});

function makeConfig(overrides: Partial<VoiceConfig> = {}): VoiceConfig {
  return {
    sample_rate: 22050,
    espeak_voice: 'en-us',
    phoneme_id_map: {
      '^': [1],
      '$': [2],
      '_': [0],
      'h': [10],
      'e': [11],
      'l': [12],
      'o': [13],
    },
    noise_scale: 0.667,
    length_scale: 1.0,
    noise_w: 0.8,
    bos: '^',
    eos: '$',
    pad: '_',
    ...overrides,
  };
}

describe('textToPhonemeIds', () => {
  it('includes bos and eos when present in phoneme_id_map', () => {
    const config = makeConfig();
    const ids = textToPhonemeIds('h', config);
    expect(ids[0]).toBe(1);  // bos '^'
    expect(ids[ids.length - 1]).toBe(2);  // eos '$'
  });

  it('includes pad after each character', () => {
    const config = makeConfig();
    const ids = textToPhonemeIds('h', config);
    // Should be: [bos(1), h(10), pad(0), eos(2)]
    expect(ids).toEqual([1, 10, 0, 2]);
  });

  it('skips unknown characters', () => {
    const config = makeConfig();
    // 'x' is not in phoneme_id_map
    const ids = textToPhonemeIds('hx', config);
    // 'x' is skipped: [bos, h, pad, eos]
    expect(ids).toEqual([1, 10, 0, 2]);
  });

  it('returns only bos and eos for empty IPA string', () => {
    const config = makeConfig();
    const ids = textToPhonemeIds('', config);
    expect(ids).toEqual([1, 2]);
  });

  it('handles null bos by not prepending any ids', () => {
    const config = makeConfig({ bos: null });
    const ids = textToPhonemeIds('h', config);
    expect(ids[0]).toBe(10);  // first char 'h', no bos
    expect(ids[ids.length - 1]).toBe(2);  // eos
  });

  it('handles null eos by not appending any ids', () => {
    const config = makeConfig({ eos: null });
    const ids = textToPhonemeIds('h', config);
    expect(ids[0]).toBe(1);  // bos
    expect(ids[ids.length - 1]).toBe(0);  // pad after 'h', no eos
  });

  it('handles null pad by not inserting pad between chars', () => {
    const config = makeConfig({ pad: null });
    const ids = textToPhonemeIds('he', config);
    // [bos(1), h(10), e(11), eos(2)]
    expect(ids).toEqual([1, 10, 11, 2]);
  });

  it('encodes multiple characters in order', () => {
    const config = makeConfig();
    const ids = textToPhonemeIds('helo', config);
    // [bos(1), h(10), pad(0), e(11), pad(0), l(12), pad(0), o(13), pad(0), eos(2)]
    expect(ids).toEqual([1, 10, 0, 11, 0, 12, 0, 13, 0, 2]);
  });
});

describe('int16ToWavBase64 (shared, via tts context)', () => {
  it('produces non-empty output', () => {
    const pcm = new Int16Array([100, 200, -100]);
    const result = int16ToWavBase64(pcm, 22050);
    expect(result.length).toBeGreaterThan(0);
  });

  it('decodes back to approximately the same samples', () => {
    const pcm = new Int16Array([1000, -2000, 500]);
    const b64 = int16ToWavBase64(pcm, 22050);
    const { samples, sampleRate } = wavBase64ToFloat32(b64);

    expect(sampleRate).toBe(22050);
    expect(samples.length).toBe(pcm.length);
    for (let i = 0; i < pcm.length; i++) {
      const expected = (pcm[i] ?? 0) / 32768.0;
      expect(samples[i]).toBeCloseTo(expected, 3);
    }
  });
});

describe('GET /health', () => {
  it('reports degraded when no voices are loaded', async () => {
    vi.resetModules();
    process.env['PIPER_VOICE_DIR'] = '/nonexistent-voices-dir';
    try {
      const mod = await import('../../src/server/tts.js');
      const health = await mod.routes['GET /health']!({}) as Record<string, unknown>;

      expect(health['status']).toBe('degraded');
      expect(health['loaded_voices']).toEqual([]);
    } finally {
      delete process.env['PIPER_VOICE_DIR'];
    }
  });
});
