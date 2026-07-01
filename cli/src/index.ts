#!/usr/bin/env node
import { createRequire } from 'node:module';
import { Command } from 'commander';
import { runDoctor } from './commands/doctor.js';
import { runConfig } from './commands/config.js';
import { runStart } from './commands/start.js';
import { runStop } from './commands/stop.js';
import { runStatus } from './commands/status.js';
import { runTranslate } from './commands/translate.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

const program = new Command();

program
  .name('live-translate')
  .description('Real-time English ↔ Mandarin speech translator')
  .version(version)
  .action(runTranslate);

program
  .command('doctor')
  .description('Check prerequisites (Node, Sox, espeak-ng, microphone, config)')
  .action(runDoctor);

program
  .command('config')
  .description('Interactive provider setup')
  .option('--provider <provider>', 'Translation provider (opus-mt, ollama, anthropic, openai, deepseek)')
  .option('--model <model>', 'Model name')
  .option('--api-key <key>', 'API key')
  .option('--whisper-model <model>', 'Whisper model for ASR (whisper-base, whisper-small, whisper-medium, whisper-large-v3)')
  .action((opts: { provider?: string; model?: string; apiKey?: string; whisperModel?: string }) =>
    runConfig({ provider: opts.provider, model: opts.model, apiKey: opts.apiKey, whisperModel: opts.whisperModel })
  );

program
  .command('start')
  .description('Start backend services')
  .action(runStart);

program
  .command('stop')
  .description('Stop backend services')
  .action(runStop);

program
  .command('status')
  .description('Show service health and active provider')
  .action(runStatus);

program.parse();
