export const WHISPER_MODELS = {
  'onnx-community/whisper-base':     { name: 'whisper-base',     description: 'Fast, 74M params. Default.' },
  'onnx-community/whisper-small':    { name: 'whisper-small',    description: 'Better Mandarin, 244M params.' },
  'onnx-community/whisper-medium':   { name: 'whisper-medium',   description: 'High accuracy, 769M params.' },
  'onnx-community/whisper-large-v3': { name: 'whisper-large-v3', description: 'Best Mandarin, 1.5B params. Needs 6+ GB RAM.' },
} as const;

export type WhisperModelKey = keyof typeof WHISPER_MODELS;

export const PROVIDERS = {
  'opus-mt': {
    name: 'Opus-MT',
    description: 'Lightweight local model. Lower quality but works out of the box.',
    local: true,
    requiresApiKey: false,
    requiresOllama: false,
    defaultModel: '',
    models: [] as const,
  },
  'ollama': {
    name: 'Ollama',
    description: 'Local LLM (Qwen 2.5). High quality, free, needs ~5 GB RAM.',
    local: true,
    requiresApiKey: false,
    requiresOllama: true,
    defaultModel: 'qwen2.5:7b',
    models: ['qwen2.5:7b', 'qwen2.5:14b', 'qwen2.5:3b'] as const,
  },
  'anthropic': {
    name: 'Anthropic (Claude)',
    description: 'Cloud API. Excellent quality. ~$0.001/translation with Haiku.',
    local: false,
    requiresApiKey: true,
    requiresOllama: false,
    defaultModel: 'claude-haiku-4-5-20251001',
    models: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-5-20250929'] as const,
  },
  'openai': {
    name: 'OpenAI',
    description: 'Cloud API. ~$0.001/translation with GPT-4o-mini.',
    local: false,
    requiresApiKey: true,
    requiresOllama: false,
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o'] as const,
  },
  'deepseek': {
    name: 'DeepSeek',
    description: 'Cloud API. Strong at Chinese, very cheap (~$0.0005/translation).',
    local: false,
    requiresApiKey: true,
    requiresOllama: false,
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat'] as const,
  },
} as const;

export type ProviderKey = keyof typeof PROVIDERS;

export const RECORDING_MODES = ['auto', 'push-to-talk'] as const;
export type RecordingMode = (typeof RECORDING_MODES)[number];

export interface Config {
  provider: ProviderKey;
  model: string;
  apiKey: string;
  ollamaUrl: string;
  whisperModel?: string;
  recordingMode?: RecordingMode;
  contextTurns?: number;
  device?: 'auto' | 'cpu' | 'gpu';
}

export const DEFAULT_CONFIG: Config = {
  provider: 'opus-mt',
  model: '',
  apiKey: '',
  ollamaUrl: 'http://localhost:11434',
  whisperModel: 'onnx-community/whisper-base',
  recordingMode: 'auto',
  contextTurns: 3,
  device: 'auto',
};

// A prior exchange fed to LLM translators for conversational continuity.
export interface ContextTurn {
  source_text: string;
  target_text: string;
}

export const SERVICE_PORTS = {
  orchestrator: 8000,
  asr: 8001,
  translation: 8002,
  tts: 8003,
} as const;

export const ORCHESTRATOR_URL = process.env['LIVE_TRANSLATE_URL'] ?? 'http://localhost:8000';

export const MIN_RECORDING_MS = 500;
export const MAX_RECORDING_MS = 30000;
export const HEALTH_POLL_INTERVAL_MS = 3000;
export const HEALTH_POLL_TIMEOUT_MS = 180000;
