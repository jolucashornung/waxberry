import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// translation.ts reads TRANSLATION_PROVIDER at import time; set it before importing.
// Anthropic path needs no model download, unlike opus-mt, so it's the cleanest to exercise.
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function anthropicResponse(text: string): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ content: [{ type: 'text', text }] }),
    text: () => Promise.resolve(''),
  } as unknown as Response;
}

// Reads the request body sent to fetch on a given call.
function requestBody(callIndex: number): Record<string, unknown> {
  const call = mockFetch.mock.calls[callIndex];
  const init = call?.[1] as RequestInit;
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

let routes: import('../../src/server/shared.js').Routes;

beforeEach(async () => {
  vi.resetModules();
  mockFetch.mockReset();
  process.env['TRANSLATION_PROVIDER'] = 'anthropic';
  process.env['TRANSLATION_API_KEY'] = 'sk-ant-test';
  const mod = await import('../../src/server/translation.js');
  routes = mod.routes;
});

afterEach(() => {
  delete process.env['TRANSLATION_PROVIDER'];
  delete process.env['TRANSLATION_API_KEY'];
});

describe('translation POST /translate — conversation context', () => {
  it('injects prior turns as alternating user/assistant messages', async () => {
    mockFetch.mockResolvedValue(anthropicResponse('你好世界'));

    await routes['POST /translate']!({
      text: 'Hello world',
      source_lang: 'en',
      target_lang: 'zh',
      context: [
        { source_text: 'My name is Lucas', target_text: '我叫卢卡斯' },
      ],
    });

    const body = requestBody(0);
    const messages = body['messages'] as Array<{ role: string; content: string }>;
    // prior user, prior assistant, current user
    expect(messages).toEqual([
      { role: 'user', content: 'My name is Lucas' },
      { role: 'assistant', content: '我叫卢卡斯' },
      { role: 'user', content: 'Hello world' },
    ]);
  });

  it('sends only the current message when context is empty', async () => {
    mockFetch.mockResolvedValue(anthropicResponse('你好'));

    await routes['POST /translate']!({
      text: 'Hello',
      source_lang: 'en',
      target_lang: 'zh',
    });

    const body = requestBody(0);
    const messages = body['messages'] as Array<{ role: string; content: string }>;
    expect(messages).toEqual([{ role: 'user', content: 'Hello' }]);
  });

  it('returns the translated text from the provider', async () => {
    mockFetch.mockResolvedValue(anthropicResponse('你好世界'));

    const result = await routes['POST /translate']!({
      text: 'Hello world',
      source_lang: 'en',
      target_lang: 'zh',
    }) as Record<string, unknown>;

    expect(result['translated_text']).toBe('你好世界');
  });

  it('reports a clear error when the provider response has an unexpected shape', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ error: { message: 'overloaded' } }),
    } as unknown as Response);

    await expect(routes['POST /translate']!({
      text: 'Hello',
      source_lang: 'en',
      target_lang: 'zh',
    })).rejects.toThrow('unexpected response shape');
  });
});

describe('translation POST /translate — Ollama resilience', () => {
  function ollamaResponse(text: string): Response {
    return {
      ok: true,
      status: 200,
      json: () => Promise.resolve({ message: { content: text } }),
    } as unknown as Response;
  }

  function ollamaError(status: number): Response {
    return { ok: false, status } as unknown as Response;
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    mockFetch.mockReset();
    process.env['TRANSLATION_PROVIDER'] = 'ollama';
    const mod = await import('../../src/server/translation.js');
    routes = mod.routes;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function translateOnce(): Promise<Record<string, unknown>> {
    const pending = routes['POST /translate']!({
      text: 'Hello',
      source_lang: 'en',
      target_lang: 'zh',
    }) as Promise<Record<string, unknown>>;
    await vi.runAllTimersAsync();
    return pending;
  }

  it('retries once when Ollama drops the connection', async () => {
    mockFetch
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(ollamaResponse('你好'));

    const result = await translateOnce();

    expect(result['translated_text']).toBe('你好');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('retries once when Ollama answers 5xx while loading a model', async () => {
    mockFetch
      .mockResolvedValueOnce(ollamaError(503))
      .mockResolvedValueOnce(ollamaResponse('你好'));

    const result = await translateOnce();

    expect(result['translated_text']).toBe('你好');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry on a 4xx client error', async () => {
    mockFetch.mockResolvedValue(ollamaError(404));

    const pending = routes['POST /translate']!({
      text: 'Hello',
      source_lang: 'en',
      target_lang: 'zh',
    });
    const assertion = expect(pending).rejects.toThrow('Ollama error: HTTP 404');
    await vi.runAllTimersAsync();
    await assertion;
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('passes an abort signal to the provider fetch', async () => {
    mockFetch.mockResolvedValue(ollamaResponse('你好'));

    await translateOnce();

    const init = mockFetch.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
