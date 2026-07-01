import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

let routes: Awaited<typeof import('../../src/server/orchestrator.js')>['routes'];

beforeAll(async () => {
  const mod = await import('../../src/server/orchestrator.js');
  routes = mod.routes;
});

afterEach(() => {
  mockFetch.mockReset();
});

function makeJsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as unknown as Response;
}

// A minimal valid WAV base64 (44 bytes header + 2 bytes PCM = 46 bytes)
function makeFakeAudioBase64(): string {
  const buf = Buffer.alloc(46);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(38, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);   // PCM
  buf.writeUInt16LE(1, 22);   // mono
  buf.writeUInt32LE(16000, 24); // sample rate
  buf.writeUInt32LE(32000, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(2, 40);
  buf.writeInt16LE(1000, 44);
  return buf.toString('base64');
}

describe('orchestrator POST /translate', () => {
  it('returns full success response for a valid English pipeline', async () => {
    mockFetch
      .mockResolvedValueOnce(makeJsonResponse({
        text: 'Hello world',
        language: 'en',
        confidence: 0.95,
      }))
      .mockResolvedValueOnce(makeJsonResponse({
        translated_text: '你好世界',
        source_lang: 'en',
        target_lang: 'zh',
      }))
      .mockResolvedValueOnce(makeJsonResponse({
        audio_base64: 'ZmFrZWF1ZGlv',
        mime_type: 'audio/wav',
      }));

    const handler = routes['POST /translate'];
    expect(handler).toBeDefined();

    const result = await handler!({
      audio_base64: makeFakeAudioBase64(),
      sample_rate: 16000,
    }) as Record<string, unknown>;

    expect(result['original_text']).toBe('Hello world');
    expect(result['detected_language']).toBe('en');
    expect(result['translated_text']).toBe('你好世界');
    expect(result['target_language']).toBe('zh');
    expect(result['audio_base64']).toBe('ZmFrZWF1ZGlv');
    expect(result['mime_type']).toBe('audio/wav');
  });

  it('forwards conversation context to the translation service', async () => {
    mockFetch
      .mockResolvedValueOnce(makeJsonResponse({ text: 'Hello', language: 'en', confidence: 0.95 }))
      .mockResolvedValueOnce(makeJsonResponse({ translated_text: '你好', source_lang: 'en', target_lang: 'zh' }))
      .mockResolvedValueOnce(makeJsonResponse({ audio_base64: 'ZmFrZQ==', mime_type: 'audio/wav' }));

    const context = [{ source_text: 'My name is Lucas', target_text: '我叫卢卡斯' }];
    await routes['POST /translate']!({
      audio_base64: makeFakeAudioBase64(),
      sample_rate: 16000,
      context,
    });

    // Second fetch call is the translation service; its body must carry the context.
    const translationCall = mockFetch.mock.calls[1];
    const body = JSON.parse((translationCall?.[1] as RequestInit).body as string) as Record<string, unknown>;
    expect(body['context']).toEqual(context);
  });

  it('returns structured error for unsupported language without throwing', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({
      text: 'Bonjour',
      language: 'fr',
      confidence: 0.95,
    }));

    const handler = routes['POST /translate'];
    const result = await handler!({
      audio_base64: makeFakeAudioBase64(),
      sample_rate: 16000,
    }) as Record<string, unknown>;

    expect(result['error']).toBeDefined();
    expect(typeof result['error']).toBe('string');
    expect(result['detected_language']).toBe('fr');
    expect(result['original_text']).toBe('Bonjour');
    // Should NOT have translated_text — it's an error response
    expect(result['translated_text']).toBeUndefined();
  });

  it('propagates error when ASR service is down', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    const handler = routes['POST /translate'];
    await expect(
      handler!({ audio_base64: makeFakeAudioBase64(), sample_rate: 16000 })
    ).rejects.toThrow();
  });

  it('throws on Invalid request when audio_base64 is missing', async () => {
    const handler = routes['POST /translate'];
    await expect(
      handler!({ sample_rate: 16000 })
    ).rejects.toThrow('Invalid request');
  });

  it('correctly flips language from zh to en', async () => {
    mockFetch
      .mockResolvedValueOnce(makeJsonResponse({
        text: '你好世界',
        language: 'zh',
        confidence: 0.95,
      }))
      .mockResolvedValueOnce(makeJsonResponse({
        translated_text: 'Hello world',
        source_lang: 'zh',
        target_lang: 'en',
      }))
      .mockResolvedValueOnce(makeJsonResponse({
        audio_base64: 'ZmFrZQ==',
        mime_type: 'audio/wav',
      }));

    const handler = routes['POST /translate'];
    const result = await handler!({
      audio_base64: makeFakeAudioBase64(),
      sample_rate: 16000,
    }) as Record<string, unknown>;

    expect(result['detected_language']).toBe('zh');
    expect(result['target_language']).toBe('en');
  });
});

describe('orchestrator GET /health', () => {
  it('returns ok when all services are healthy', async () => {
    mockFetch
      .mockResolvedValueOnce(makeJsonResponse({ status: 'ok', model: 'whisper-base' }))
      .mockResolvedValueOnce(makeJsonResponse({ status: 'ok', provider: 'opus-mt' }))
      .mockResolvedValueOnce(makeJsonResponse({ status: 'ok', engine: 'piper' }));

    const handler = routes['GET /health'];
    const result = await handler!({}) as Record<string, unknown>;

    expect(result['status']).toBe('ok');
    const services = result['services'] as Record<string, unknown>;
    expect(services['asr']).toBeDefined();
    expect(services['translation']).toBeDefined();
    expect(services['tts']).toBeDefined();
  });

  it('returns degraded when one service is down', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('Connection refused'))
      .mockResolvedValueOnce(makeJsonResponse({ status: 'ok' }))
      .mockResolvedValueOnce(makeJsonResponse({ status: 'ok' }));

    const handler = routes['GET /health'];
    const result = await handler!({}) as Record<string, unknown>;

    expect(result['status']).toBe('degraded');
  });
});
