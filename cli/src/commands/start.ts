import { execSync } from 'child_process';
import ora from 'ora';
import chalk from 'chalk';
import { confirm } from '@inquirer/prompts';
import { loadConfig, configExists } from '../services/configStore.js';
import { startServices } from '../services/processes.js';
import { checkHealth } from '../services/api.js';
import { runConfig } from './config.js';
import { PROVIDERS, HEALTH_POLL_INTERVAL_MS, HEALTH_POLL_TIMEOUT_MS } from '../utils/constants.js';
import { logger } from '../utils/logger.js';

async function pollUntilHealthy(): Promise<boolean> {
  const deadline = Date.now() + HEALTH_POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const status = await checkHealth();
    if (status.healthy) return true;
    await new Promise(resolve => setTimeout(resolve, HEALTH_POLL_INTERVAL_MS));
  }

  return false;
}

function isOllamaModelPulled(model: string): boolean {
  try {
    const output = execSync('ollama list', { stdio: 'pipe' }).toString();
    return output.includes(model);
  } catch {
    return false;
  }
}

function pullOllamaModel(model: string): void {
  execSync(`ollama pull ${model}`, { stdio: 'inherit' });
}

function printPrivacyNote(provider: string): void {
  const providerDef = PROVIDERS[provider as keyof typeof PROVIDERS];
  if (providerDef?.local) {
    console.log('    Fully local. No data leaves your machine.');
  } else {
    console.log(`    Audio stays on your machine. Only text is sent to ${providerDef?.name ?? provider} for translation.`);
  }
}

export async function ensureServicesRunning(): Promise<boolean> {
  if (!configExists()) {
    logger.info('No configuration found. Running setup...');
    console.log('');
    await runConfig({});
  }

  const config = loadConfig();
  const providerDef = PROVIDERS[config.provider];

  if (providerDef.requiresOllama && !isOllamaModelPulled(config.model)) {
    const pull = await confirm({
      message: `Model ${config.model} not found. Pull it now?`,
      default: true,
    });

    if (!pull) {
      logger.error('Model not available. Cannot start.');
      return false;
    }

    pullOllamaModel(config.model);
  }

  const spinner = ora('Starting translation services...').start();

  try {
    await startServices(config, (msg) => { spinner.text = msg; });
  } catch (err) {
    spinner.fail('Failed to start services');
    logger.error((err as Error).message);
    return false;
  }

  spinner.text = 'Waiting for services to be healthy...';
  const healthy = await pollUntilHealthy();

  if (!healthy) {
    spinner.fail('Services did not become healthy within 3 minutes');
    return false;
  }

  spinner.succeed('All services started.');
  return true;
}

export async function runStart(): Promise<void> {
  const started = await ensureServicesRunning();
  if (!started) {
    process.exitCode = 1;
    return;
  }

  const config = loadConfig();
  const providerDef = PROVIDERS[config.provider];

  console.log('');
  console.log('    ASR:         Whisper (base) — local');
  console.log(`    Translation: ${providerDef.name}${config.model ? ` (${config.model})` : ''}`);
  console.log('    TTS:         Piper (en, zh) — local');
  console.log('');
  console.log('    Note:');
  printPrivacyNote(config.provider);
  console.log('');
  console.log('  Run `live-translate` to start translating.');
  console.log('');
}
