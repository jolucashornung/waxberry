import { fileURLToPath } from 'node:url';
import { createServer } from './shared.js';
import type { Routes } from './shared.js';

const ASR_URL = process.env['ASR_URL'] ?? 'http://localhost:8001';
const TRANSLATION_URL = process.env['TRANSLATION_URL'] ?? 'http://localhost:8002';
const TTS_URL = process.env['TTS_URL'] ?? 'http://localhost:8003';
const TIMEOUT_MS = 60_000;
const PORT = parseInt(process.env['PORT'] ?? '8000', 10);

const SUPPORTED_LANGUAGES = new Set(['en', 'zh']);

function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function callAsr(audioBase64: string, sampleRate: number): Promise<{ text: string; language: string }> {
  const response = await fetchWithTimeout(`${ASR_URL}/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio_base64: audioBase64, sample_rate: sampleRate }),
  });
  if (!response.ok) {
    throw new Error(`ASR service error: HTTP ${response.status}`);
  }
  return response.json() as Promise<{ text: string; language: string }>;
}

interface ContextTurn {
  source_text: string;
  target_text: string;
}

async function callTranslation(
  text: string,
  sourceLang: string,
  targetLang: string,
  context: ContextTurn[],
): Promise<{ translated_text: string }> {
  const response = await fetchWithTimeout(`${TRANSLATION_URL}/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, source_lang: sourceLang, target_lang: targetLang, context }),
  });
  if (!response.ok) {
    throw new Error(`Translation service error: HTTP ${response.status}`);
  }
  return response.json() as Promise<{ translated_text: string }>;
}

async function callTts(text: string, language: string): Promise<{ audio_base64: string; mime_type: string }> {
  const response = await fetchWithTimeout(`${TTS_URL}/synthesize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language, voice: null }),
  });
  if (!response.ok) {
    throw new Error(`TTS service error: HTTP ${response.status}`);
  }
  return response.json() as Promise<{ audio_base64: string; mime_type: string }>;
}

async function fetchServiceHealth(url: string): Promise<Record<string, unknown>> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    const response = await fetch(`${url}/health`, { signal: controller.signal }).finally(() => clearTimeout(timer));
    if (response.ok) {
      return response.json() as Promise<Record<string, unknown>>;
    }
    return { status: 'error', detail: `HTTP ${response.status}` };
  } catch (err) {
    return { status: 'error', detail: String(err) };
  }
}

export const routes: Routes = {
  'GET /health': async () => {
    const [asrHealth, translationHealth, ttsHealth] = await Promise.all([
      fetchServiceHealth(ASR_URL),
      fetchServiceHealth(TRANSLATION_URL),
      fetchServiceHealth(TTS_URL),
    ]);
    const allOk = [asrHealth, translationHealth, ttsHealth].every(s => s['status'] === 'ok');
    return {
      status: allOk ? 'ok' : 'degraded',
      services: {
        asr: asrHealth,
        translation: translationHealth,
        tts: ttsHealth,
      },
    };
  },

  'POST /translate': async (body) => {
    const req = body as { audio_base64: string; sample_rate?: number; context?: ContextTurn[] };
    if (!req.audio_base64) {
      throw new Error('Invalid request: audio_base64 is required');
    }

    const sampleRate = req.sample_rate ?? 16000;
    const context = Array.isArray(req.context) ? req.context : [];
    const asrResult = await callAsr(req.audio_base64, sampleRate);
    const { text: originalText, language: detectedLanguage } = asrResult;

    if (!originalText.trim()) {
      return {
        error: 'No speech detected in the audio.',
        detected_language: detectedLanguage,
        original_text: originalText,
      };
    }

    if (!SUPPORTED_LANGUAGES.has(detectedLanguage)) {
      return {
        error: `Unsupported language detected: '${detectedLanguage}'. This translator supports English and Mandarin only.`,
        detected_language: detectedLanguage,
        original_text: originalText,
      };
    }

    const targetLanguage = detectedLanguage === 'en' ? 'zh' : 'en';

    const translationResult = await callTranslation(originalText, detectedLanguage, targetLanguage, context);
    const { translated_text: translatedText } = translationResult;

    const ttsResult = await callTts(translatedText, targetLanguage);

    return {
      original_text: originalText,
      detected_language: detectedLanguage,
      translated_text: translatedText,
      target_language: targetLanguage,
      audio_base64: ttsResult.audio_base64,
      mime_type: ttsResult.mime_type,
    };
  },
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(routes, PORT);
}
