import fs from 'fs';
import path from 'path';
import os from 'os';
import { type Config, DEFAULT_CONFIG, PROVIDERS, type ProviderKey } from '../utils/constants.js';

export function getConfigPath(): string {
  return path.join(os.homedir(), '.live-translate', 'config.json');
}

export function configExists(): boolean {
  return fs.existsSync(getConfigPath());
}

export function loadConfig(): Config {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }
  const raw = fs.readFileSync(configPath, 'utf8');

  let parsed: Partial<Config>;
  try {
    parsed = JSON.parse(raw) as Partial<Config>;
  } catch {
    throw new Error(`Config file is not valid JSON: ${configPath}. Fix it or re-run \`live-translate config\`.`);
  }

  const config = { ...DEFAULT_CONFIG, ...parsed };
  if (!isValidProvider(config.provider)) {
    throw new Error(
      `Config file has unknown provider '${String(config.provider)}': ${configPath}. `
      + `Valid: ${Object.keys(PROVIDERS).join(', ')}. Re-run \`live-translate config\`.`
    );
  }
  return config;
}

export function saveConfig(config: Config): void {
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '****';
  return `${key.slice(0, 12)}...****`;
}

export function isValidProvider(key: string): key is ProviderKey {
  return key in PROVIDERS;
}
