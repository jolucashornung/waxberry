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

export async function translate(audioBase64: string, context: ContextTurn[] = []): Promise<TranslateResponse> {
  const res = await fetch(`${ORCHESTRATOR_URL}/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio_base64: audioBase64, sample_rate: 16000, context }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    throw new Error(`Orchestrator returned ${res.status}: ${await res.text()}`);
  }

  return res.json() as Promise<TranslateResponse>;
}
