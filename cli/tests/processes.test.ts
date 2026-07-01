import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let testHome: string;

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    default: {
      ...actual,
      homedir: () => testHome,
    },
  };
});

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

import {
  voicesExist,
  getVoicesDir,
  stopServices,
} from '../src/services/processes.js';

beforeEach(() => {
  testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'waxberry-processes-test-'));
});

afterEach(() => {
  fs.rmSync(testHome, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('voicesExist', () => {
  it('returns false when voices directory is empty', () => {
    expect(voicesExist()).toBe(false);
  });

  it('returns true when all expected voice model files are present', () => {
    const voicesDir = getVoicesDir();
    fs.mkdirSync(voicesDir, { recursive: true });
    for (const f of ['en_US-lessac-medium.onnx', 'zh_CN-huayan-medium.onnx']) {
      fs.writeFileSync(path.join(voicesDir, f), '');
    }
    expect(voicesExist()).toBe(true);
  });

  it('returns false when only one voice file is present', () => {
    const voicesDir = getVoicesDir();
    fs.mkdirSync(voicesDir, { recursive: true });
    fs.writeFileSync(path.join(voicesDir, 'en_US-lessac-medium.onnx'), '');
    expect(voicesExist()).toBe(false);
  });
});

describe('stopServices', () => {
  it('does not throw when no PID files exist', async () => {
    await expect(stopServices()).resolves.not.toThrow();
  });

  it('removes PID file even when the process is already gone', async () => {
    const pidsDir = path.join(testHome, '.live-translate', 'pids');
    fs.mkdirSync(pidsDir, { recursive: true });
    // PID 999999999 will not exist on any real system
    fs.writeFileSync(path.join(pidsDir, 'asr.pid'), '999999999');

    await stopServices();

    expect(fs.existsSync(path.join(pidsDir, 'asr.pid'))).toBe(false);
  });

  it('removes all PID files for all services', async () => {
    const pidsDir = path.join(testHome, '.live-translate', 'pids');
    fs.mkdirSync(pidsDir, { recursive: true });
    for (const svc of ['asr', 'translation', 'tts', 'orchestrator']) {
      fs.writeFileSync(path.join(pidsDir, `${svc}.pid`), '999999999');
    }

    await stopServices();

    for (const svc of ['asr', 'translation', 'tts', 'orchestrator']) {
      expect(fs.existsSync(path.join(pidsDir, `${svc}.pid`))).toBe(false);
    }
  });
});
