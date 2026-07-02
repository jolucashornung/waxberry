import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Config } from '../utils/constants.js';
import { resolveBinary } from '../utils/binaries.js';
import { ensureRecorderReady } from './recorder.js';

// All paths are functions so os.homedir() is evaluated at call time (testable via mocks).
function getWaxberryHome(): string { return path.join(os.homedir(), '.live-translate'); }
function getPidsDir(): string     { return path.join(getWaxberryHome(), 'pids'); }
function getLogsDir(): string     { return path.join(getWaxberryHome(), 'logs'); }
export function getVoicesDir(): string { return path.join(getWaxberryHome(), 'voices'); }

interface ServiceDef {
  name: string;
  port: number;
  extraEnv?: Record<string, string>;
}

const SERVICE_DEFS: ServiceDef[] = [
  { name: 'translation', port: 8002 },
  { name: 'tts', port: 8003 },
  { name: 'asr', port: 8001 },
  {
    name: 'orchestrator',
    port: 8000,
    extraEnv: {
      ASR_URL: 'http://localhost:8001',
      TRANSLATION_URL: 'http://localhost:8002',
      TTS_URL: 'http://localhost:8003',
    },
  },
];

function findPkgRoot(): string {
  const thisFile = fileURLToPath(import.meta.url);
  // dist/services/processes.js → ../../ → package root (cli/)
  return path.resolve(path.dirname(thisFile), '..', '..');
}

function pidFile(name: string): string { return path.join(getPidsDir(), `${name}.pid`); }
function logFile(name: string): string { return path.join(getLogsDir(), `${name}.log`); }

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(name: string): number | null {
  const file = pidFile(name);
  if (!fs.existsSync(file)) return null;
  const pid = parseInt(fs.readFileSync(file, 'utf8').trim(), 10);
  return isNaN(pid) ? null : pid;
}

export function voicesExist(): boolean {
  const voicesDir = getVoicesDir();
  return ['en_US-lessac-medium.onnx', 'zh_CN-huayan-medium.onnx'].every(
    f => fs.existsSync(path.join(voicesDir, f))
  );
}

const VOICE_URLS: Array<{ url: string; file: string }> = [
  {
    url: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx',
    file: 'en_US-lessac-medium.onnx',
  },
  {
    url: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json',
    file: 'en_US-lessac-medium.onnx.json',
  },
  {
    url: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/zh/zh_CN/huayan/medium/zh_CN-huayan-medium.onnx',
    file: 'zh_CN-huayan-medium.onnx',
  },
  {
    url: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/zh/zh_CN/huayan/medium/zh_CN-huayan-medium.onnx.json',
    file: 'zh_CN-huayan-medium.onnx.json',
  },
];

const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

async function downloadWithFetch(url: string, dest: string): Promise<void> {
  // Follow redirects — Node 18+ fetch follows redirects automatically
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  }
  const buf = await response.arrayBuffer();
  // Write to a temp file and rename — an interrupted write must not leave a truncated
  // voice file behind, or the existsSync check would skip re-downloading it forever.
  const tmp = `${dest}.download`;
  fs.writeFileSync(tmp, Buffer.from(buf));
  fs.renameSync(tmp, dest);
}

async function downloadVoices(onProgress?: (msg: string) => void): Promise<void> {
  const voicesDir = getVoicesDir();
  fs.mkdirSync(voicesDir, { recursive: true });

  for (const { url, file } of VOICE_URLS) {
    const dest = path.join(voicesDir, file);
    if (fs.existsSync(dest)) continue;
    onProgress?.(`Downloading ${file}...`);
    await downloadWithFetch(url, dest);
  }
}

function buildTranslationEnv(config: Config): NodeJS.ProcessEnv {
  return {
    TRANSLATION_PROVIDER: config.provider,
    ...(config.model     ? { TRANSLATION_MODEL:   config.model     } : {}),
    ...(config.apiKey    ? { TRANSLATION_API_KEY: config.apiKey    } : {}),
    ...(config.ollamaUrl ? { OLLAMA_URL:           config.ollamaUrl } : {}),
  };
}

function buildAsrEnv(config: Config): NodeJS.ProcessEnv {
  return {
    ...(config.whisperModel ? { WHISPER_MODEL: config.whisperModel } : {}),
    ...(config.device ? { ASR_DEVICE: config.device } : {}),
  };
}

function buildTtsEnv(config: Config): NodeJS.ProcessEnv {
  return {
    ...(config.device ? { TTS_DEVICE: config.device } : {}),
  };
}

export async function startServices(
  config: Config,
  onProgress?: (msg: string) => void
): Promise<void> {
  const pkgRoot = findPkgRoot();

  fs.mkdirSync(getPidsDir(), { recursive: true });
  fs.mkdirSync(getLogsDir(), { recursive: true });

  if (!voicesExist()) {
    onProgress?.('Downloading voice models (~100 MB)...');
    await downloadVoices(onProgress);
  }

  // Resolve espeak-ng and sox — downloads bundled binary if not already installed.
  await resolveBinary('espeak-ng', onProgress);
  await ensureRecorderReady(onProgress);

  onProgress?.('Starting services...');

  for (const svc of SERVICE_DEFS) {
    const existing = readPid(svc.name);
    if (existing !== null && isProcessRunning(existing)) continue;
    // PID file points at a dead process — clear it so it can't mask failures later.
    fs.rmSync(pidFile(svc.name), { force: true });

    const script = path.join(pkgRoot, 'dist', 'server', `${svc.name}.js`);

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PORT: String(svc.port),
      PIPER_VOICE_DIR: getVoicesDir(),
      ...(svc.name === 'translation' ? buildTranslationEnv(config) : {}),
      ...(svc.name === 'asr'         ? buildAsrEnv(config)         : {}),
      ...(svc.name === 'tts'         ? buildTtsEnv(config)         : {}),
      ...(svc.extraEnv ?? {}),
    };

    const logFd = fs.openSync(logFile(svc.name), 'a');
    const proc = spawn('node', [script], {
      env,
      detached: true,
      stdio: ['ignore', logFd, logFd],
    });
    // Without a listener, a failed spawn emits an unhandled 'error' event and crashes the CLI.
    // The subsequent health check reports the service as down, which is the real signal.
    proc.on('error', (err) => {
      onProgress?.(`Failed to start ${svc.name}: ${err.message}`);
    });
    proc.unref();
    fs.closeSync(logFd);
    if (proc.pid !== undefined) {
      fs.writeFileSync(pidFile(svc.name), String(proc.pid));
    }
  }
}

const STOP_GRACE_MS = 3000;
const STOP_POLL_MS = 100;

// A service stuck in a model load can ignore SIGTERM; without the SIGKILL fallback it survives as
// an orphan holding its port, and the next start fails health checks with no visible cause.
export async function stopServices(): Promise<void> {
  const stopping: Array<{ name: string; pid: number }> = [];

  for (const svc of SERVICE_DEFS) {
    const pid = readPid(svc.name);
    if (pid !== null) {
      try { process.kill(pid, 'SIGTERM'); } catch { /* already dead */ }
      stopping.push({ name: svc.name, pid });
    }
  }

  const deadline = Date.now() + STOP_GRACE_MS;
  while (Date.now() < deadline && stopping.some(s => isProcessRunning(s.pid))) {
    await new Promise(resolve => setTimeout(resolve, STOP_POLL_MS));
  }

  for (const { pid } of stopping) {
    if (isProcessRunning(pid)) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* died in the meantime */ }
    }
  }

  for (const svc of SERVICE_DEFS) {
    fs.rmSync(pidFile(svc.name), { force: true });
  }
}

export function anyServiceRunning(): boolean {
  return SERVICE_DEFS.some(svc => {
    const pid = readPid(svc.name);
    return pid !== null && isProcessRunning(pid);
  });
}
