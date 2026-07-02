import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkHealth, translate, isTranslateError } from '../src/services/api.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeOkResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function makeErrorResponse(status: number, body: string): Response {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('checkHealth', () => {
  it('returns healthy when all services respond ok', async () => {
    mockFetch.mockResolvedValue(makeOkResponse({ status: 'ok' }));

    const result = await checkHealth();

    expect(result.healthy).toBe(true);
    expect(result.services).toHaveLength(4);
    expect(result.services.every(s => s.healthy)).toBe(true);
  });

  it('returns unhealthy when a service is down', async () => {
    mockFetch
      .mockResolvedValueOnce(makeOkResponse({ status: 'ok' }))
      .mockRejectedValueOnce(new Error('Connection refused'))
      .mockResolvedValueOnce(makeOkResponse({ status: 'ok' }))
      .mockResolvedValueOnce(makeOkResponse({ status: 'ok' }));

    const result = await checkHealth();

    expect(result.healthy).toBe(false);
    expect(result.services.some(s => !s.healthy)).toBe(true);
  });

  it('marks individual failed service as unhealthy', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValue(makeOkResponse({ status: 'ok' }));

    const result = await checkHealth();

    expect(result.services[0]?.healthy).toBe(false);
    expect(result.services[0]?.name).toBe('ASR');
  });
});

describe('translate', () => {
  it('returns parsed success response', async () => {
    const successBody = {
      original_text: 'Hello',
      detected_language: 'en',
      translated_text: '你好',
      target_language: 'zh',
      audio_base64: 'abc123',
      mime_type: 'audio/wav',
    };
    mockFetch.mockResolvedValue(makeOkResponse(successBody));

    const result = await translate('base64audio');

    expect(isTranslateError(result)).toBe(false);
    if (!isTranslateError(result)) {
      expect(result.original_text).toBe('Hello');
      expect(result.translated_text).toBe('你好');
    }
  });

  it('returns error response without throwing when language is unsupported', async () => {
    const errorBody = {
      error: "Unsupported language detected: 'fr'",
      detected_language: 'fr',
      original_text: 'Bonjour',
    };
    mockFetch.mockResolvedValue(makeOkResponse(errorBody));

    const result = await translate('base64audio');

    expect(isTranslateError(result)).toBe(true);
    if (isTranslateError(result)) {
      expect(result.detected_language).toBe('fr');
    }
  });

  it('throws on network failure', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    await expect(translate('base64audio')).rejects.toThrow('Network error');
  });

  it('throws when orchestrator returns non-ok status', async () => {
    mockFetch.mockResolvedValue(makeErrorResponse(500, 'Internal Server Error'));

    await expect(translate('base64audio')).rejects.toThrow('Orchestrator returned 500');
  });

  it('explains a timeout in user terms', async () => {
    mockFetch.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));

    await expect(translate('base64audio')).rejects.toThrow('a model may still be loading');
  });

  it('explains an unreachable orchestrator in user terms', async () => {
    mockFetch.mockRejectedValue(new TypeError('fetch failed'));

    await expect(translate('base64audio')).rejects.toThrow('Could not reach the translation services');
  });

  it('sends the conversation context in the request body', async () => {
    mockFetch.mockResolvedValue(makeOkResponse({
      original_text: 'Hello', detected_language: 'en', translated_text: '你好',
      target_language: 'zh', audio_base64: 'abc', mime_type: 'audio/wav',
    }));

    await translate('base64audio', [{ source_text: 'Hi', target_text: '嗨' }]);

    const init = mockFetch.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body['context']).toEqual([{ source_text: 'Hi', target_text: '嗨' }]);
  });
});
