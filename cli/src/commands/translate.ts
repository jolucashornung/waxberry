import chalk from 'chalk';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ChildProcess } from 'child_process';
import { checkHealth, translate, isTranslateError } from '../services/api.js';
import { startRecording, stopRecording, isRecordingTooShort } from '../services/recorder.js';
import { playAudio } from '../services/player.js';
import { loadConfig, configExists } from '../services/configStore.js';
import { PROVIDERS, MAX_RECORDING_MS, DEFAULT_CONFIG, type ContextTurn } from '../utils/constants.js';
import { logger } from '../utils/logger.js';
import { wrapToWidth, padToWidth } from '../utils/textWidth.js';
import { ensureServicesRunning } from './start.js';

function getTmpRecordingPath(): string {
  return path.join(os.tmpdir(), `live-translate-rec-${Date.now()}.wav`);
}

function clearLine(): void {
  process.stdout.write('\r\x1b[K');
}

function printBanner(providerLabel: string, autoStop: boolean): void {
  console.log('');
  console.log(chalk.bold('  Live Translator — EN ↔ 中文'));
  console.log(`  Provider: ${providerLabel}`);
  const hint = autoStop
    ? 'Press SPACE to talk, then pause — it translates automatically. Press Q to quit.'
    : 'Press SPACE to start/stop recording. Press Q to quit.';
  console.log(`  ${hint}`);
  console.log('');
}

const BOX_INNER_WIDTH = 44;

// Emits a box row for text that may exceed the box width or contain double-width CJK glyphs,
// wrapping onto as many lines as needed and padding each to the exact inner width.
function printBoxText(text: string): void {
  for (const line of wrapToWidth(text, BOX_INNER_WIDTH)) {
    console.log(`  │  ${padToWidth(line, BOX_INNER_WIDTH)}│`);
  }
}

function printResultBox(
  original: string,
  detectedLang: string,
  translated: string,
  targetLang: string
): void {
  const sourceLine = detectedLang === 'en' ? 'You said (English):' : 'You said (中文):';
  const targetLine = targetLang === 'zh' ? 'Translation (中文):' : 'Translation (English):';
  const border = '─'.repeat(BOX_INNER_WIDTH + 2);

  console.log(`  ┌${border}┐`);
  printBoxText(sourceLine);
  printBoxText(original);
  console.log(`  │  ${padToWidth('', BOX_INNER_WIDTH)}│`);
  printBoxText(targetLine);
  printBoxText(translated);
  console.log(`  └${border}┘`);
}

export async function runTranslate(): Promise<void> {
  const status = await checkHealth();
  if (!status.healthy) {
    const started = await ensureServicesRunning();
    if (!started) {
      process.exitCode = 1;
      return;
    }
    console.log('');
  }

  if (!process.stdin.isTTY) {
    logger.error('This command requires an interactive terminal.');
    process.exitCode = 1;
    return;
  }

  const config = configExists() ? loadConfig() : { ...DEFAULT_CONFIG };
  const providerDef = PROVIDERS[config.provider];
  const providerLabel = config.model ? `${providerDef.name} (${config.model})` : providerDef.name;
  const autoStop = (config.recordingMode ?? DEFAULT_CONFIG.recordingMode) === 'auto';
  const contextTurns = config.contextTurns ?? DEFAULT_CONFIG.contextTurns ?? 0;
  const history: ContextTurn[] = [];

  printBanner(providerLabel, autoStop);
  process.stdout.write(chalk.dim('  ▶ Ready\n'));

  let recording: ChildProcess | null = null;
  let recordingPath: string | null = null;
  let recordingStart = 0;
  let timerInterval: ReturnType<typeof setInterval> | null = null;
  let maxRecordingTimeout: ReturnType<typeof setTimeout> | null = null;
  let isProcessing = false;

  const cancelTimers = (): void => {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    if (maxRecordingTimeout) { clearTimeout(maxRecordingTimeout); maxRecordingTimeout = null; }
  };

  const stopCurrentRecording = (): { filePath: string; durationMs: number } | null => {
    if (!recording || !recordingPath) return null;
    cancelTimers();
    stopRecording(recording);
    recording = null;
    const result = { filePath: recordingPath, durationMs: Date.now() - recordingStart };
    recordingPath = null;
    return result;
  };

  const processRecording = async (filePath: string, durationMs: number): Promise<void> => {
    isProcessing = true;

    if (isRecordingTooShort(durationMs)) {
      fs.rmSync(filePath, { force: true });
      clearLine();
      process.stdout.write(chalk.yellow('  (Too short — hold longer)\n'));
      process.stdout.write(chalk.dim('  ▶ Ready\n'));
      isProcessing = false;
      return;
    }

    clearLine();
    const processingStart = Date.now();
    const processingTimer = setInterval(() => {
      const elapsed = ((Date.now() - processingStart) / 1000).toFixed(1);
      clearLine();
      process.stdout.write(chalk.blue(`  ⟳ Processing... ${elapsed}s`));
    }, 100);

    const stopProcessingTimer = (): void => {
      clearInterval(processingTimer);
      clearLine();
    };

    try {
      const audioBytes = fs.readFileSync(filePath);
      fs.rmSync(filePath, { force: true });

      const context = contextTurns > 0 ? history.slice(-contextTurns) : [];
      const result = await translate(audioBytes.toString('base64'), context);

      stopProcessingTimer();
      if (isTranslateError(result)) {
        logger.error(`Unsupported language: ${result.detected_language}`);
      } else {
        console.log('');
        printResultBox(result.original_text, result.detected_language, result.translated_text, result.target_language);
        if (contextTurns > 0) {
          history.push({ source_text: result.original_text, target_text: result.translated_text });
        }
        console.log('  🔊 Playing translation...');
        await playAudio(result.audio_base64);
      }
    } catch (err) {
      stopProcessingTimer();
      logger.error(`Translation failed: ${(err as Error).message}`);
    }

    console.log('');
    process.stdout.write(chalk.dim('  ▶ Ready\n'));
    isProcessing = false;
  };

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  const cleanup = (): void => {
    cancelTimers();
    if (recording) stopCurrentRecording();
    process.stdin.setRawMode(false);
    process.stdin.pause();
    console.log('');
  };

  process.on('SIGINT', () => { cleanup(); process.exit(0); });

  process.stdin.on('data', (key: string) => {
    if (key === '' || key === 'q' || key === 'Q') {
      cleanup();
      process.exit(0);
    }

    if (key !== ' ' || isProcessing) return;

    if (!recording) {
      recordingPath = getTmpRecordingPath();
      recordingStart = Date.now();
      recording = startRecording(recordingPath, { autoStop });
      const thisRecording = recording;

      // In auto mode, sox exits on trailing silence. Treat that self-exit as a stop-and-process,
      // unless we already stopped it manually (SPACE / max timeout / cleanup set recording elsewhere).
      thisRecording.on('close', () => {
        if (recording !== thisRecording || !recordingPath) return;
        cancelTimers();
        const filePath = recordingPath;
        const durationMs = Date.now() - recordingStart;
        recording = null;
        recordingPath = null;
        clearLine();
        void processRecording(filePath, durationMs);
      });

      timerInterval = setInterval(() => {
        const elapsed = ((Date.now() - recordingStart) / 1000).toFixed(1);
        clearLine();
        process.stdout.write(chalk.red(`  ● Recording... ${elapsed}s`));
      }, 100);

      maxRecordingTimeout = setTimeout(() => {
        const stopped = stopCurrentRecording();
        if (stopped) {
          clearLine();
          process.stdout.write(chalk.yellow('  (Max 30s reached)\n'));
          void processRecording(stopped.filePath, stopped.durationMs);
        }
      }, MAX_RECORDING_MS);
    } else {
      const stopped = stopCurrentRecording();
      if (stopped) {
        void processRecording(stopped.filePath, stopped.durationMs);
      }
    }
  });
}
