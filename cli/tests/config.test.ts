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

import { getConfigPath, configExists, loadConfig, saveConfig, maskApiKey } from '../src/services/configStore.js';
import { DEFAULT_CONFIG } from '../src/utils/constants.js';

beforeEach(() => {
  testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'waxberry-test-'));
});

afterEach(() => {
  fs.rmSync(testHome, { recursive: true, force: true });
});

describe('getConfigPath', () => {
  it('returns path inside home directory', () => {
    const configPath = getConfigPath();
    expect(configPath).toBe(path.join(testHome, '.live-translate', 'config.json'));
  });
});

describe('configExists', () => {
  it('returns false when no config file exists', () => {
    expect(configExists()).toBe(false);
  });

  it('returns true after saving a config', () => {
    saveConfig(DEFAULT_CONFIG);
    expect(configExists()).toBe(true);
  });
});

describe('saveConfig and loadConfig', () => {
  it('writes valid JSON to the correct path', () => {
    const config = { provider: 'anthropic' as const, model: 'claude-haiku-4-5-20241022', apiKey: 'sk-ant-test', ollamaUrl: 'http://localhost:11434' };
    saveConfig(config);

    const raw = fs.readFileSync(getConfigPath(), 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual(config);
  });

  it('reads back the saved config correctly', () => {
    const config = { provider: 'openai' as const, model: 'gpt-4o-mini', apiKey: 'sk-openai-test', ollamaUrl: 'http://localhost:11434', whisperModel: 'onnx-community/whisper-large-v3', recordingMode: 'push-to-talk' as const };
    saveConfig(config);

    const loaded = loadConfig();
    expect(loaded).toEqual(config);
  });

  it('returns default whisperModel when config on disk has no whisperModel field', () => {
    fs.mkdirSync(path.join(testHome, '.live-translate'), { recursive: true });
    fs.writeFileSync(getConfigPath(), JSON.stringify({ provider: 'opus-mt', model: '', apiKey: '', ollamaUrl: '' }));

    const loaded = loadConfig();
    expect(loaded.whisperModel).toBe('onnx-community/whisper-base');
  });

  it('returns default config when no file exists', () => {
    const loaded = loadConfig();
    expect(loaded).toEqual(DEFAULT_CONFIG);
  });

  it('sets file permissions to 0600', () => {
    saveConfig(DEFAULT_CONFIG);
    const stat = fs.statSync(getConfigPath());
    const mode = stat.mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

describe('maskApiKey', () => {
  it('masks anthropic key correctly', () => {
    const masked = maskApiKey('sk-ant-api03-abcdefghijklmn');
    expect(masked).toMatch(/^sk-ant-api0/);
    expect(masked).toContain('...****');
  });

  it('returns empty string for empty key', () => {
    expect(maskApiKey('')).toBe('');
  });

  it('returns **** for very short keys', () => {
    expect(maskApiKey('abc')).toBe('****');
  });

  it('hides the sensitive portion of the key', () => {
    const key = 'sk-ant-api03-SECRET-PART';
    const masked = maskApiKey(key);
    expect(masked).not.toContain('SECRET-PART');
    expect(masked).toContain('...****');
  });
});

describe('non-interactive config via runConfig', () => {
  it('saves config with provider, model, and api-key flags', async () => {
    const { runConfig } = await import('../src/commands/config.js');
    await runConfig({ provider: 'anthropic', model: 'claude-haiku-4-5-20241022', apiKey: 'sk-ant-test123' });

    const loaded = loadConfig();
    expect(loaded.provider).toBe('anthropic');
    expect(loaded.model).toBe('claude-haiku-4-5-20241022');
    expect(loaded.apiKey).toBe('sk-ant-test123');
  });

  it('uses provider default model when model flag is omitted', async () => {
    const { runConfig } = await import('../src/commands/config.js');
    await runConfig({ provider: 'openai' });

    const loaded = loadConfig();
    expect(loaded.provider).toBe('openai');
    expect(loaded.model).toBe('gpt-4o-mini');
  });

  it('sets exitCode and returns early for unknown provider', async () => {
    const { runConfig } = await import('../src/commands/config.js');
    process.exitCode = 0;
    await runConfig({ provider: 'unknown-provider' });
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it('saves whisperModel when --whisper-model flag is provided', async () => {
    const { runConfig } = await import('../src/commands/config.js');
    await runConfig({ provider: 'opus-mt', whisperModel: 'onnx-community/whisper-large-v3' });

    const loaded = loadConfig();
    expect(loaded.whisperModel).toBe('onnx-community/whisper-large-v3');
  });

  it('preserves existing whisperModel when --whisper-model flag is not passed', async () => {
    saveConfig({ ...DEFAULT_CONFIG, whisperModel: 'onnx-community/whisper-medium' });
    const { runConfig } = await import('../src/commands/config.js');
    await runConfig({ provider: 'opus-mt' });

    const loaded = loadConfig();
    expect(loaded.whisperModel).toBe('onnx-community/whisper-medium');
  });
});
