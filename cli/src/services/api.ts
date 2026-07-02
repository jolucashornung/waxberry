import { ORCHESTRATOR_URL, SERVICE_PORTS, type ContextTurn } from '../utils/constants.js';

export interface TranslateSuccess {
  original_text: string;
  detected_language: string;
  translated_text: string;
  target_language: string;
  audio_base64: string;
  mime_type: string;
}

export interface TranslateError {
  error: string;
  detected_language: string;
  original_text: string;
}

export type TranslateResponse = TranslateSuccess | TranslateError;

export function isTranslateError(res: TranslateResponse): res is TranslateError {
  return 'error' in res;
}

export interface ServiceHealth {
  name: string;
  healthy: boolean;
  details: Record<string, unknown>;
}

export interface HealthStatus {
  healthy: boolean;
  services: ServiceHealth[];
}

const SERVICE_HEALTH_URLS = [
  { name: 'ASR', url: `http://localhost:${SERVICE_PORTS.asr}/health` },
  { name: 'Translation', url: `http://localhost:${SERVICE_PORTS.translation}/health` },
  { name: 'TTS', url: `http://localhost:${SERVICE_PORTS.tts}/health` },
  { name: 'Orchestrator', url: `http://localhost:${SERVICE_PORTS.orchestrator}/health` },
];

export async function checkHealth(): Promise<HealthStatus> {
  const results = await Promise.allSettled(
    SERVICE_HEALTH_URLS.map(async ({ name, url }) => {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      const data = await res.json() as Record<string, unknown>;
      return { name, healthy: res.ok, details: data };
    })
  );

  const services = results.map((result, i) => {
    if (result.status === 'fulfilled') return result.value;
    return { name: SERVICE_HEALTH_URLS[i]!.name, healthy: false, details: {} };
  });

  return {
    healthy: services.every(s => s.healthy),
    services,
  };
}

// Must exceed the orchestrator's worst case (60 s per downstream hop) — a shorter client timeout
// cancels requests that would still succeed, e.g. while Ollama is loading a model.
const TRANSLATE_TIMEOUT_MS = 120_000;

export async function translate(audioBase64: string, context: ContextTurn[] = []): Promise<TranslateResponse> {
  let res: Response;
  try {
    res = await fetch(`${ORCHESTRATOR_URL}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio_base64: audioBase64, sample_rate: 16000, context }),
      signal: AbortSignal.timeout(TRANSLATE_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new Error('Timed out after 120s — a model may still be loading. Try again in a moment.');
    }
    if (err instanceof TypeError) {
      throw new Error('Could not reach the translation services. Run `live-translate status` to check them.');
    }
    throw err;
  }

  if (!res.ok) {
    throw new Error(`Orchestrator returned ${res.status}: ${await res.text()}`);
  }

  return res.json() as Promise<TranslateResponse>;
}
