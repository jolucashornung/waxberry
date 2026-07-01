import { spawn, type ChildProcess } from 'child_process';
import fs from 'node:fs';
import { MIN_RECORDING_MS, MAX_RECORDING_MS } from '../utils/constants.js';
import { resolveBinary } from '../utils/binaries.js';

// Resolved once during startup via ensureRecorderReady(); synchronous after that.
let resolvedRec = 'rec';

export interface RecordOptions {
  // When true, sox stops on trailing silence so `rec` exits on its own (no second keypress).
  autoStop?: boolean;
}

// sox `silence` effect: begin after speech (>3% for 0.1s), stop after 1.5s of trailing silence.
const SILENCE_EFFECT = ['silence', '1', '0.1', '3%', '1', '1.5', '3%'];

export function buildRecordArgs(outputPath: string, opts: RecordOptions = {}): string[] {
  const base = ['-q', '-t', 'wav', '-r', '16000', '-c', '1', '-b', '16', outputPath];
  return opts.autoStop ? [...base, ...SILENCE_EFFECT] : base;
}

export async function ensureRecorderReady(
  onProgress?: (msg: string) => void
): Promise<void> {
  const sox = await resolveBinary('sox', onProgress);
  // sox ships a 'rec' symlink alongside the main binary — prefer it.
  const recPath = sox.replace(/([/\\])sox$/, '$1rec');
  try {
    fs.accessSync(recPath, fs.constants.X_OK);
    resolvedRec = recPath;
  } catch {
    // sox binary used directly with --default-device flag
    resolvedRec = sox;
  }
}

export function startRecording(outputPath: string, opts: RecordOptions = {}): ChildProcess {
  const isSoxDirect = !resolvedRec.endsWith('rec');
  const prefix = isSoxDirect ? ['-q', '--default-device'] : ['-q'];
  const rest = ['-t', 'wav', '-r', '16000', '-c', '1', '-b', '16', outputPath];
  const args = [...prefix, ...rest, ...(opts.autoStop ? SILENCE_EFFECT : [])];
  return spawn(resolvedRec, args);
}

export function stopRecording(proc: ChildProcess): void {
  proc.kill('SIGTERM');
}

export function isRecordingTooShort(durationMs: number): boolean {
  return durationMs < MIN_RECORDING_MS;
}

export function isRecordingTooLong(durationMs: number): boolean {
  return durationMs > MAX_RECORDING_MS;
}
