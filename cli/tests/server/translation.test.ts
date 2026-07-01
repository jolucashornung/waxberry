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
});
