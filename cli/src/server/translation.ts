import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline, env } from '@huggingface/transformers';
import { createServer } from './shared.js';
import type { Routes } from './shared.js';

env.cacheDir = path.join(os.homedir(), '.live-translate', 'models');

const PROVIDER = process.env['TRANSLATION_PROVIDER'] ?? 'opus-mt';
const TRANSLATION_MODEL = process.env['TRANSLATION_MODEL'] ?? '';
const TRANSLATION_API_KEY = process.env['TRANSLATION_API_KEY'] ?? '';
const OLLAMA_URL = process.env['OLLAMA_URL'] ?? 'http://localhost:11434';

const PORT = parseInt(process.env['PORT'] ?? '8002', 10);

const SUPPORTED_PAIRS = new Set(['en-zh', 'zh-en']);

interface ContextTurn {
  source_text: string;
  target_text: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

function buildSystemPrompt(sourceLang: string, targetLang: string): string {
  const names: Record<string, string> = { en: 'English', zh: 'Mandarin Chinese' };
  const source = names[sourceLang] ?? sourceLang;
  const target = names[targetLang] ?? targetLang;
  return `You are translating a live conversation between English and Mandarin Chinese speakers. `
    + `Translate the latest message from ${source} to ${target}. Any earlier turns are provided only `
    + `for context (names, topic, tone). Return only the translation of the latest message, no explanation.`;
}

// Turns prior exchanges into alternating user/assistant messages, then appends the current text.
function buildChatMessages(text: string, context: ContextTurn[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const turn of context) {
    messages.push({ role: 'user', content: turn.source_text });
    messages.push({ role: 'assistant', content: turn.target_text });
  }
  messages.push({ role: 'user', content: text });
  return messages;
}

type TranslationFn = (text: string) => Promise<Array<{ translation_text: string }>>;

interface OpusMtModels {
  'en-zh': TranslationFn;
  'zh-en': TranslationFn;
}

let opusMtModels: OpusMtModels | null = null;

if (PROVIDER === 'opus-mt') {
  opusMtModels = {
    'en-zh': await pipeline('translation', 'Xenova/opus-mt-en-zh') as unknown as TranslationFn,
    'zh-en': await pipeline('translation', 'Xenova/opus-mt-zh-en') as unknown as TranslationFn,
  };
}

async function translateWithOpusMt(text: string, sourceLang: string, targetLang: string): Promise<string> {
  const pair = `${sourceLang}-${targetLang}` as keyof OpusMtModels;
  const model = opusMtModels?.[pair];
  if (!model) {
    throw new Error(`Unsupported language pair: ${sourceLang} → ${targetLang}`);
  }
  const result = await model(text);
  const output = Array.isArray(result) ? result[0] : result;
  return (output as { translation_text: string }).translation_text ?? '';
}

async function translateWithOllama(text: string, sourceLang: string, targetLang: string, context: ContextTurn[]): Promise<string> {
  const model = TRANSLATION_MODEL || 'qwen2.5:7b';
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        { role: 'system', content: buildSystemPrompt(sourceLang, targetLang) },
        ...buildChatMessages(text, context),
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`Ollama error: HTTP ${response.status}`);
  }
  const data = await response.json() as { message: { content: string } };
  return data.message.content.trim();
}

async function translateWithAnthropic(text: string, sourceLang: string, targetLang: string, context: ContextTurn[]): Promise<string> {
  const model = TRANSLATION_MODEL || 'claude-haiku-4-5-20241022';
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': TRANSLATION_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system: buildSystemPrompt(sourceLang, targetLang),
      messages: buildChatMessages(text, context),
    }),
  });
  if (!response.ok) {
    throw new Error(`Anthropic error: HTTP ${response.status}`);
  }
  const data = await response.json() as { content: Array<{ type: string; text: string }> };
  const textContent = data.content.find(c => c.type === 'text');
  return textContent?.text.trim() ?? '';
}

async function translateWithOpenAICompat(
  text: string,
  sourceLang: string,
  targetLang: string,
  context: ContextTurn[],
  baseUrl: string,
): Promise<string> {
  const model = TRANSLATION_MODEL || (PROVIDER === 'deepseek' ? 'deepseek-chat' : 'gpt-4o-mini');
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TRANSLATION_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: buildSystemPrompt(sourceLang, targetLang) },
        ...buildChatMessages(text, context),
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`${PROVIDER} error: HTTP ${response.status}`);
  }
  const data = await response.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message.content.trim() ?? '';
}

async function translate(text: string, sourceLang: string, targetLang: string, context: ContextTurn[]): Promise<string> {
  switch (PROVIDER) {
    case 'opus-mt':
      // Opus-MT is a seq2seq model with no conversational input — context is ignored.
      return translateWithOpusMt(text, sourceLang, targetLang);
    case 'ollama':
      return translateWithOllama(text, sourceLang, targetLang, context);
    case 'anthropic':
      return translateWithAnthropic(text, sourceLang, targetLang, context);
    case 'openai':
      return translateWithOpenAICompat(text, sourceLang, targetLang, context, 'https://api.openai.com/v1');
    case 'deepseek':
      return translateWithOpenAICompat(text, sourceLang, targetLang, context, 'https://api.deepseek.com/v1');
    default:
      throw new Error(`Unsupported provider: ${PROVIDER}`);
  }
}

export const routes: Routes = {
  'GET /health': async () => ({
    status: 'ok',
    provider: PROVIDER,
    ...(PROVIDER === 'opus-mt' ? { models: ['Xenova/opus-mt-en-zh', 'Xenova/opus-mt-zh-en'] } : {}),
  }),

  'POST /translate': async (body) => {
    const req = body as { text: string; source_lang: string; target_lang: string; context?: ContextTurn[] };
    if (!req.text || !req.source_lang || !req.target_lang) {
      throw new Error('Invalid request: text, source_lang, and target_lang are required');
    }

    const pair = `${req.source_lang}-${req.target_lang}`;
    if (!SUPPORTED_PAIRS.has(pair)) {
      throw new Error(`Unsupported language pair: ${req.source_lang} → ${req.target_lang}. Supported: en↔zh`);
    }

    const context = Array.isArray(req.context) ? req.context : [];
    const translatedText = await translate(req.text, req.source_lang, req.target_lang, context);
    return {
      translated_text: translatedText,
      source_lang: req.source_lang,
      target_lang: req.target_lang,
    };
  },
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(routes, PORT);
}
