import { describe, it, expect } from 'vitest';
import { wavBase64ToFloat32, int16ToWavBase64, createServer } from '../../src/server/shared.js';

function makeWavBase64(samples: Int16Array, sampleRate: number): string {
  return int16ToWavBase64(samples, sampleRate);
}

describe('int16ToWavBase64', () => {
  it('produces a non-empty base64 string', () => {
    const pcm = new Int16Array([0, 100, -100, 32767, -32768]);
    const result = int16ToWavBase64(pcm, 16000);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('encodes WAV header with correct sample rate', () => {
    const pcm = new Int16Array([1000, 2000]);
    const b64 = int16ToWavBase64(pcm, 22050);
    const buf = Buffer.from(b64, 'base64');
    // sample rate is at bytes 24-27 (little-endian uint32)
    expect(buf.readUInt32LE(24)).toBe(22050);
  });

  it('encodes mono 16-bit PCM in WAV header', () => {
    const pcm = new Int16Array([500]);
    const b64 = int16ToWavBase64(pcm, 16000);
    const buf = Buffer.from(b64, 'base64');
    // num channels: bytes 22-23
    expect(buf.readUInt16LE(22)).toBe(1);
    // bits per sample: bytes 34-35
    expect(buf.readUInt16LE(34)).toBe(16);
  });

  it('starts with RIFF header', () => {
    const pcm = new Int16Array([0]);
    const b64 = int16ToWavBase64(pcm, 16000);
    const buf = Buffer.from(b64, 'base64');
    expect(buf.slice(0, 4).toString('ascii')).toBe('RIFF');
    expect(buf.slice(8, 12).toString('ascii')).toBe('WAVE');
  });
});

describe('wavBase64ToFloat32', () => {
  it('round-trips through int16ToWavBase64 and back', () => {
    const original = new Int16Array([0, 16384, -16384, 32767, -32768]);
    const b64 = int16ToWavBase64(original, 16000);
    const { samples, sampleRate } = wavBase64ToFloat32(b64);

    expect(sampleRate).toBe(16000);
    expect(samples.length).toBe(original.length);
    // Values should be approximately correct (within floating point precision)
    for (let i = 0; i < original.length; i++) {
      const expected = (original[i] ?? 0) / 32768.0;
      expect(samples[i]).toBeCloseTo(expected, 3);
    }
  });

  it('returns the correct sample rate', () => {
    const pcm = new Int16Array([100, 200]);
    const b64 = int16ToWavBase64(pcm, 44100);
    const { sampleRate } = wavBase64ToFloat32(b64);
    expect(sampleRate).toBe(44100);
  });

  it('throws on invalid base64 (buffer too short)', () => {
    // A base64 string that decodes to fewer than 44 bytes
    const shortBuf = Buffer.from('not a wav').toString('base64');
    expect(() => wavBase64ToFloat32(shortBuf)).toThrow(/Invalid WAV/);
  });

  it('round-trip encode → decode → encode produces the same base64', () => {
    const pcm = new Int16Array([1000, -1000, 500, 0, -500]);
    const b64First = int16ToWavBase64(pcm, 16000);
    const { samples } = wavBase64ToFloat32(b64First);

    // Convert float32 back to int16 (approximate)
    const reconstructed = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      reconstructed[i] = Math.round((samples[i] ?? 0) * 32768);
    }
    const b64Second = int16ToWavBase64(reconstructed, 16000);
    expect(b64Second).toBe(b64First);
  });
});

describe('wavBase64ToFloat32 — malformed WAV guards', () => {
  function wavWith(mutate: (buf: Buffer) => void): string {
    const pcm = new Int16Array(16);
    const buf = Buffer.from(int16ToWavBase64(pcm, 16000), 'base64');
    mutate(buf);
    return buf.toString('base64');
  }

  it('rejects a non-PCM format code', () => {
    const b64 = wavWith(buf => buf.writeUInt16LE(3, 20)); // IEEE float
    expect(() => wavBase64ToFloat32(b64)).toThrow('expected PCM (format 1), got format 3');
  });

  it('rejects zero channels', () => {
    const b64 = wavWith(buf => buf.writeUInt16LE(0, 22));
    expect(() => wavBase64ToFloat32(b64)).toThrow('zero channels');
  });
});

describe('createServer — request body handling', () => {
  async function withServer(
    routes: Parameters<typeof createServer>[0],
    run: (baseUrl: string) => Promise<void>
  ): Promise<void> {
    const server = createServer(routes, 0);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    try {
      await run(`http://127.0.0.1:${address.port}`);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }

  it('decodes multi-byte UTF-8 split across chunk boundaries intact', async () => {
    await withServer(
      { 'POST /echo': async (body) => body },
      async (baseUrl) => {
        // Large enough body that Node delivers it in multiple chunks; CJK characters make any
        // per-chunk decoding visible as replacement chars.
        const text = '你好世界，今天天气很好。'.repeat(30000);
        const res = await fetch(`${baseUrl}/echo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        expect(res.status).toBe(200);
        const echoed = await res.json() as { text: string };
        expect(echoed.text).toBe(text);
      }
    );
  });

  it('rejects a body over the size limit with a 400', async () => {
    await withServer(
      { 'POST /echo': async (body) => body },
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/echo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: `{"blob":"${'a'.repeat(33 * 1024 * 1024)}"}`,
        }).catch(() => null);
        // The server destroys the connection after rejecting; either a 400 arrives or the
        // socket resets before the response — both mean the body was refused.
        if (res !== null) {
          expect(res.status).toBe(400);
          const body = await res.json() as { error: string };
          expect(body.error).toContain('exceeds');
        }
      }
    );
  });
});
