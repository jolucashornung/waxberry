import { execSync } from 'child_process';
import fs from 'fs';
import chalk from 'chalk';
import { loadConfig, configExists, maskApiKey, isValidProvider } from '../services/configStore.js';
import { PROVIDERS } from '../utils/constants.js';
import { logger } from '../utils/logger.js';
import { isBinaryAvailable, findBinary } from '../utils/binaries.js';

interface CheckResult {
  label: string;
  passed: boolean;
  detail: string;
}

function tryExec(cmd: string): string | null {
  try {
    return execSync(cmd, { stdio: 'pipe' }).toString().trim();
  } catch {
    return null;
  }
}

function checkNodeVersion(): CheckResult {
  const version = process.version;
  const major = parseInt(version.slice(1).split('.')[0] ?? '0', 10);
  return {
    label: 'Node.js',
    passed: major >= 18,
    detail: `${version} (>= 18 required)`,
  };
}


function checkEspeakNg(): CheckResult {
  const available = isBinaryAvailable('espeak-ng');
  const detail = available
    ? tryExec('espeak-ng --version 2>&1') ?? 'bundled/cached'
    : 'Not found — will auto-download on `live-translate start`';
  return { label: 'espeak-ng', passed: true, detail };
}

function checkSox(): CheckResult {
  const available = isBinaryAvailable('sox');
  const detail = available
    ? tryExec('sox --version 2>&1') ?? 'bundled/cached'
    : 'Not found — will auto-download on `live-translate start`';
  return { label: 'Sox', passed: true, detail };
}

// Uses the same sox binary the recorder resolves (cache/bundled/PATH) — checking a bare `rec`
// from PATH reported failures on setups that work fine through the bundled sox.
function soxSibling(tool: 'rec' | 'play'): string | null {
  const sox = findBinary('sox');
  if (!sox) return null;
  const sibling = sox.replace(/([/\\])sox$/, `$1${tool}`);
  try {
    fs.accessSync(sibling, fs.constants.X_OK);
    return sibling;
  } catch {
    return sox;
  }
}

// sox is auto-downloaded on first start, so its absence is not a failure — but the device
// can't be probed until then.
const SOX_PENDING_DETAIL = 'Cannot test yet — sox downloads automatically on `live-translate start`';

function checkMicrophone(): CheckResult {
  const bin = soxSibling('rec');
  if (!bin) {
    return { label: 'Microphone', passed: true, detail: SOX_PENDING_DETAIL };
  }
  const args = bin.endsWith('rec') ? '-n trim 0 0.1' : '-d -n trim 0 0.1';
  const passed = tryExec(`${JSON.stringify(bin)} ${args} 2>&1`) !== null;
  return {
    label: 'Microphone',
    passed,
    detail: passed ? 'Default input device found' : 'No input device detected',
  };
}

function checkSpeaker(): CheckResult {
  const bin = soxSibling('play');
  if (!bin) {
    return { label: 'Speaker', passed: true, detail: SOX_PENDING_DETAIL };
  }
  const args = bin.endsWith('play') ? '-n trim 0 0.1' : '-n -d trim 0 0.1';
  const passed = tryExec(`${JSON.stringify(bin)} ${args} 2>&1`) !== null;
  return {
    label: 'Speaker',
    passed,
    detail: passed ? 'Default output device found' : 'No output device detected',
  };
}

function checkConfig(): CheckResult {
  if (!configExists()) {
    return {
      label: 'Config',
      passed: false,
      detail: 'Not configured. Run `live-translate config`',
    };
  }
  const config = loadConfig();
  const providerDef = PROVIDERS[config.provider];
  return {
    label: 'Config',
    passed: true,
    detail: `Provider: ${providerDef.name}${config.model ? ` (${config.model})` : ''}`,
  };
}

function checkApiKey(): CheckResult | null {
  if (!configExists()) return null;
  const config = loadConfig();
  const providerDef = PROVIDERS[config.provider];
  if (!providerDef.requiresApiKey) return null;
  const hasKey = Boolean(config.apiKey);
  return {
    label: 'API Key',
    passed: hasKey,
    detail: hasKey ? maskApiKey(config.apiKey) : `Not set (required for ${providerDef.name})`,
  };
}

function checkOllama(): CheckResult | null {
  if (!configExists()) return null;
  const config = loadConfig();
  if (config.provider !== 'ollama') return null;

  const version = tryExec('ollama --version');
  if (!version) {
    return { label: 'Ollama', passed: false, detail: 'Not installed or not running' };
  }

  const modelList = tryExec('ollama list 2>&1');
  const modelAvailable = modelList?.includes(config.model) ?? false;
  return {
    label: 'Ollama',
    passed: modelAvailable,
    detail: modelAvailable
      ? `${version}, model ${config.model} available`
      : `${version}, model ${config.model} not pulled`,
  };
}

function printResult(result: CheckResult): void {
  const icon = result.passed ? chalk.green('✓') : chalk.red('✗');
  console.log(`  ${icon} ${result.label.padEnd(14)} ${result.detail}`);
}

export async function runDoctor(): Promise<void> {
  logger.header('Live Translator — System Check');

  const checks: CheckResult[] = [
    checkNodeVersion(),
    checkEspeakNg(),
    checkSox(),
    checkMicrophone(),
    checkSpeaker(),
    checkConfig(),
  ];

  const apiKeyCheck = checkApiKey();
  if (apiKeyCheck) checks.push(apiKeyCheck);

  const ollamaCheck = checkOllama();
  if (ollamaCheck) checks.push(ollamaCheck);

  for (const check of checks) {
    printResult(check);
  }

  console.log('');
  const failed = checks.filter(c => !c.passed);

  if (failed.length === 0) {
    console.log(chalk.green('  All checks passed!'));
  } else {
    console.log(chalk.red(`  ${failed.length} check(s) failed.`));
    process.exitCode = 1;
  }

  console.log('');
}
