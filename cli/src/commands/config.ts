import { select, input, password } from '@inquirer/prompts';
import chalk from 'chalk';
import { PROVIDERS, WHISPER_MODELS, RECORDING_MODES, DEFAULT_CONFIG, type ProviderKey, type RecordingMode, type Config } from '../utils/constants.js';
import { isDevicePreference, type DevicePreference } from '../utils/device.js';
import { saveConfig, loadConfig, maskApiKey, isValidProvider } from '../services/configStore.js';
import { anyServiceRunning } from '../services/processes.js';
import { logger } from '../utils/logger.js';

// Fields the background services read at spawn time — changing them requires a restart.
const SERVICE_FIELDS: ReadonlyArray<keyof Config> = ['provider', 'model', 'apiKey', 'ollamaUrl', 'whisperModel', 'device'];

interface ConfigOptions {
  provider?: string;
  model?: string;
  apiKey?: string;
  whisperModel?: string;
  recordingMode?: string;
  contextTurns?: string;
  device?: string;
}

function isValidRecordingMode(value: string): value is RecordingMode {
  return (RECORDING_MODES as readonly string[]).includes(value);
}

async function runInteractiveConfig(): Promise<Config> {
  const existing = loadConfig();

  const provider = await select<ProviderKey>({
    message: 'Choose a translation provider:',
    choices: Object.entries(PROVIDERS).map(([key, def]) => ({
      name: `${def.name} — ${def.description}`,
      value: key as ProviderKey,
    })),
    default: existing.provider,
  });

  const providerDef = PROVIDERS[provider];
  let model: string = providerDef.defaultModel;
  let apiKey = '';
  let ollamaUrl = existing.ollamaUrl;

  if (providerDef.models.length > 1) {
    model = await select<string>({
      message: 'Choose a model:',
      choices: [...providerDef.models].map(m => ({ name: m, value: m })),
      default: providerDef.defaultModel,
    });
  }

  if (providerDef.requiresApiKey) {
    apiKey = await password({
      message: `Enter your ${providerDef.name} API key:`,
      mask: '*',
    });
  }

  if (providerDef.requiresOllama) {
    ollamaUrl = await input({
      message: 'Ollama URL:',
      default: ollamaUrl,
    });
  }

  const whisperModel = await select<string>({
    message: 'Choose a Whisper model for speech recognition:',
    choices: Object.entries(WHISPER_MODELS).map(([key, def]) => ({
      name: `${def.name} — ${def.description}`,
      value: key,
    })),
    default: existing.whisperModel ?? DEFAULT_CONFIG.whisperModel,
  });

  const recordingMode = await select<RecordingMode>({
    message: 'Choose a recording mode:',
    choices: [
      { name: 'auto — stop automatically when you stop speaking', value: 'auto' },
      { name: 'push-to-talk — press SPACE to start and stop', value: 'push-to-talk' },
    ],
    default: existing.recordingMode ?? DEFAULT_CONFIG.recordingMode,
  });

  // Conversation context only benefits LLM providers; Opus-MT is seq2seq and ignores it.
  let contextTurns = existing.contextTurns ?? DEFAULT_CONFIG.contextTurns;
  if (provider !== 'opus-mt') {
    contextTurns = await select<number>({
      message: 'How many prior turns to send as conversation context?',
      choices: [
        { name: '0 — none (translate each utterance in isolation)', value: 0 },
        { name: '3 — recommended', value: 3 },
        { name: '5 — more context, higher token cost', value: 5 },
      ],
      default: existing.contextTurns ?? DEFAULT_CONFIG.contextTurns,
    });
  }

  const device = await select<DevicePreference>({
    message: 'Compute device for speech recognition and synthesis:',
    choices: [
      { name: 'auto — use GPU if available, else CPU', value: 'auto' },
      { name: 'cpu — always CPU', value: 'cpu' },
      { name: 'gpu — require GPU (needs a CUDA/CoreML onnxruntime build)', value: 'gpu' },
    ],
    default: existing.device ?? DEFAULT_CONFIG.device,
  });

  return { provider, model, apiKey, ollamaUrl, whisperModel, recordingMode, contextTurns, device };
}

function printSummary(config: Config): void {
  const providerDef = PROVIDERS[config.provider];
  console.log('');
  console.log(`    Provider:  ${providerDef.name}`);
  if (config.model) console.log(`    Model:     ${config.model}`);
  if (config.apiKey) console.log(`    API Key:   ${maskApiKey(config.apiKey)}`);
  if (config.provider === 'ollama') console.log(`    Ollama:    ${config.ollamaUrl}`);
  console.log(`    ASR model: ${config.whisperModel}`);
  console.log(`    Recording: ${config.recordingMode}`);
  if (config.provider !== 'opus-mt') console.log(`    Context:   ${config.contextTurns} turns`);
  console.log(`    Device:    ${config.device}`);
  console.log('');
  console.log('  Run `live-translate start` to start translating.');
  console.log('');
}

export async function runConfig(opts: ConfigOptions): Promise<void> {
  logger.header('Live Translator — Configuration');

  const before = loadConfig();
  let config: Config;

  const hasFlags = Object.values(opts).some(value => value !== undefined);

  if (hasFlags) {
    if (opts.provider !== undefined && !isValidProvider(opts.provider)) {
      logger.error(`Unknown provider: ${opts.provider}. Valid: ${Object.keys(PROVIDERS).join(', ')}`);
      process.exitCode = 1;
      return;
    }

    if (opts.recordingMode && !isValidRecordingMode(opts.recordingMode)) {
      logger.error(`Unknown recording mode: ${opts.recordingMode}. Valid: ${RECORDING_MODES.join(', ')}`);
      process.exitCode = 1;
      return;
    }

    let contextTurns = before.contextTurns ?? DEFAULT_CONFIG.contextTurns;
    if (opts.contextTurns !== undefined) {
      const parsed = Number(opts.contextTurns);
      if (!Number.isInteger(parsed) || parsed < 0) {
        logger.error(`Invalid context turns: ${opts.contextTurns}. Expected a non-negative integer.`);
        process.exitCode = 1;
        return;
      }
      contextTurns = parsed;
    }

    if (opts.device && !isDevicePreference(opts.device)) {
      logger.error(`Unknown device: ${opts.device}. Valid: auto, cpu, gpu`);
      process.exitCode = 1;
      return;
    }

    // Flags update only what they name; everything else (API key, Ollama URL, model) is preserved
    // from the stored config. Switching providers resets the model to the new provider's default
    // unless --model is given, since model names are provider-specific.
    const provider = (opts.provider as ProviderKey | undefined) ?? before.provider;
    const providerChanged = provider !== before.provider;

    config = {
      provider,
      model: opts.model ?? (providerChanged ? PROVIDERS[provider].defaultModel : before.model),
      apiKey: opts.apiKey ?? before.apiKey,
      ollamaUrl: before.ollamaUrl || DEFAULT_CONFIG.ollamaUrl,
      whisperModel: opts.whisperModel ?? before.whisperModel ?? DEFAULT_CONFIG.whisperModel,
      recordingMode: (opts.recordingMode as RecordingMode | undefined) ?? before.recordingMode ?? DEFAULT_CONFIG.recordingMode,
      contextTurns,
      device: (opts.device as DevicePreference | undefined) ?? before.device ?? DEFAULT_CONFIG.device,
    };
  } else {
    config = await runInteractiveConfig();
  }

  saveConfig(config);
  console.log(chalk.green('  ✓ Configuration saved to ~/.live-translate/config.json'));
  printSummary(config);

  const serviceSettingsChanged = SERVICE_FIELDS.some(field => before[field] !== config[field]);
  if (serviceSettingsChanged && anyServiceRunning()) {
    console.log(chalk.yellow('  ⚠ Services are still running with the previous settings.'));
    console.log(chalk.yellow('    Run `live-translate stop && live-translate start` to apply the change.'));
    console.log('');
  }
}
