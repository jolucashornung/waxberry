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

const mockExecSync = vi.fn();
vi.mock('child_process', () => ({
  execSync: mockExecSync,
  spawn: vi.fn(),
}));

beforeEach(() => {
  testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'waxberry-doctor-test-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  mockExecSync.mockReset();
  process.exitCode = 0;
});

afterEach(() => {
  fs.rmSync(testHome, { recursive: true, force: true });
  vi.restoreAllMocks();
  process.exitCode = 0;
});

function stubExecSync(responses: Record<string, string>): void {
  mockExecSync.mockImplementation((cmd: string) => {
    for (const [pattern, response] of Object.entries(responses)) {
      if (cmd.includes(pattern)) return Buffer.from(response);
    }
    throw new Error(`Unexpected command: ${cmd}`);
  });
}

async function setupOpusMtConfig(): Promise<void> {
  const { saveConfig } = await import('../src/services/configStore.js');
  saveConfig({ provider: 'opus-mt', model: '', apiKey: '', ollamaUrl: '' });
}

// binaries.findBinary locates sox/espeak via `which` (execSync), so stubbing 'which sox' pins
// the resolved path machine-independently. No rec/play sibling exists at the fake path, so the
// mic/speaker checks invoke sox directly (-d flags).
const FULL_PASS_EXECS: Record<string, string> = {
  'which espeak-ng': '/mock/bin/espeak-ng',
  'which sox': '/mock/bin/sox',
  'espeak-ng --version': 'eSpeak NG text-to-speech: 1.51.1  Data at: /usr/lib/x86_64-linux-gnu/espeak-ng-data',
  'sox --version': 'SoX v14.4.2',
  '-d -n trim': '',
  '-n -d trim': '',
};

describe('runDoctor', () => {
  it('passes all checks when environment is fully configured', async () => {
    await setupOpusMtConfig();
    stubExecSync(FULL_PASS_EXECS);

    const { runDoctor } = await import('../src/commands/doctor.js');
    await runDoctor();

    expect(process.exitCode).not.toBe(1);
    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(output).toContain('All checks passed');
  });

  it('does not check for Python', async () => {
    await setupOpusMtConfig();
    stubExecSync(FULL_PASS_EXECS);

    const { runDoctor } = await import('../src/commands/doctor.js');
    await runDoctor();

    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(output).not.toContain('Python');
  });

  it('espeak-ng check always passes — will auto-download if missing', async () => {
    await setupOpusMtConfig();
    stubExecSync(FULL_PASS_EXECS);

    const { runDoctor } = await import('../src/commands/doctor.js');
    await runDoctor();

    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(output).toContain('espeak-ng');
    expect(process.exitCode).not.toBe(1);
  });

  it('espeak-ng check shows auto-download message when not on system', async () => {
    await setupOpusMtConfig();
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes('espeak-ng')) throw new Error('not found');
      for (const [k, v] of Object.entries(FULL_PASS_EXECS)) {
        if (cmd.includes(k)) return Buffer.from(v);
      }
      throw new Error(`Unexpected: ${cmd}`);
    });

    const { runDoctor } = await import('../src/commands/doctor.js');
    await runDoctor();

    // Still passes — binary will be auto-downloaded on waxberry start
    expect(process.exitCode).not.toBe(1);
    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(output).toContain('auto-download');
  });

  it('Sox check always passes — will auto-download if missing', async () => {
    await setupOpusMtConfig();
    stubExecSync(FULL_PASS_EXECS);

    const { runDoctor } = await import('../src/commands/doctor.js');
    await runDoctor();

    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(output).toContain('Sox');
    expect(process.exitCode).not.toBe(1);
  });

  it('Sox check shows auto-download message when not on system', async () => {
    await setupOpusMtConfig();
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes('sox')) throw new Error('not found');
      for (const [k, v] of Object.entries(FULL_PASS_EXECS)) {
        if (cmd.includes(k)) return Buffer.from(v);
      }
      throw new Error(`Unexpected: ${cmd}`);
    });

    const { runDoctor } = await import('../src/commands/doctor.js');
    await runDoctor();

    expect(process.exitCode).not.toBe(1);
    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(output).toContain('auto-download');
  });

  it('Config check shows provider name when config exists', async () => {
    const { saveConfig } = await import('../src/services/configStore.js');
    saveConfig({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001', apiKey: 'sk-ant-test', ollamaUrl: '' });
    stubExecSync(FULL_PASS_EXECS);

    const { runDoctor } = await import('../src/commands/doctor.js');
    await runDoctor();

    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(output).toContain('Anthropic (Claude)');
  });

  it('API Key check shows masked key when cloud provider is configured', async () => {
    const { saveConfig } = await import('../src/services/configStore.js');
    saveConfig({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001', apiKey: 'sk-ant-api03-abcdef', ollamaUrl: '' });
    stubExecSync(FULL_PASS_EXECS);

    const { runDoctor } = await import('../src/commands/doctor.js');
    await runDoctor();

    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(output).toContain('...****');
    expect(output).not.toContain('abcdef');
  });

  it('API Key check fails when cloud provider has no key set', async () => {
    const { saveConfig } = await import('../src/services/configStore.js');
    saveConfig({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001', apiKey: '', ollamaUrl: '' });
    stubExecSync(FULL_PASS_EXECS);

    const { runDoctor } = await import('../src/commands/doctor.js');
    await runDoctor();

    expect(process.exitCode).toBe(1);
    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(output).toContain('Not set');
  });

  it('Ollama check verifies model availability', async () => {
    const { saveConfig } = await import('../src/services/configStore.js');
    saveConfig({ provider: 'ollama', model: 'qwen2.5:7b', apiKey: '', ollamaUrl: 'http://localhost:11434' });
    stubExecSync({
      ...FULL_PASS_EXECS,
      'ollama --version': 'ollama version 0.3.0',
      'ollama list': 'qwen2.5:7b   abc123   4.7 GB',
    });

    const { runDoctor } = await import('../src/commands/doctor.js');
    await runDoctor();

    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(output).toContain('Ollama');
    expect(output).toContain('qwen2.5:7b');
  });

  it('Ollama check fails when model is not pulled', async () => {
    const { saveConfig } = await import('../src/services/configStore.js');
    saveConfig({ provider: 'ollama', model: 'qwen2.5:7b', apiKey: '', ollamaUrl: 'http://localhost:11434' });
    stubExecSync({
      ...FULL_PASS_EXECS,
      'ollama --version': 'ollama version 0.3.0',
      'ollama list': 'NAME   ID   SIZE',
    });

    const { runDoctor } = await import('../src/commands/doctor.js');
    await runDoctor();

    expect(process.exitCode).toBe(1);
    const output = vi.mocked(console.log).mock.calls.flat().join('\n');
    expect(output).toContain('not pulled');
  });
});
