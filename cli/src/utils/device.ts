// Device selection for the ASR and TTS inference backends. Pure functions so the fallback
// ordering is unit-testable without loading models.

export type DevicePreference = 'auto' | 'cpu' | 'gpu';

export const DEVICE_PREFERENCES: readonly DevicePreference[] = ['auto', 'cpu', 'gpu'];

export function isDevicePreference(value: string): value is DevicePreference {
  return (DEVICE_PREFERENCES as readonly string[]).includes(value);
}

export interface AsrDeviceAttempt {
  device: 'cpu' | 'gpu';
  dtype: 'q8' | 'fp16';
}

// transformers.js device + dtype attempts in priority order. 'auto' tries GPU (fp16) then
// falls back to CPU (q8). Each attempt is tried until one initializes successfully.
export function asrDeviceAttempts(pref: DevicePreference): AsrDeviceAttempt[] {
  if (pref === 'cpu') return [{ device: 'cpu', dtype: 'q8' }];
  if (pref === 'gpu') return [{ device: 'gpu', dtype: 'fp16' }];
  return [{ device: 'gpu', dtype: 'fp16' }, { device: 'cpu', dtype: 'q8' }];
}

// onnxruntime execution-provider attempts in priority order. The GPU provider is platform
// specific (CoreML on macOS, CUDA elsewhere). Real acceleration requires a matching
// onnxruntime-node build; otherwise these attempts fail and the CPU fallback is used.
export function ttsProviderAttempts(pref: DevicePreference, platform: string): string[][] {
  const gpuProvider = platform === 'darwin' ? 'coreml' : 'cuda';
  if (pref === 'cpu') return [['cpu']];
  if (pref === 'gpu') return [[gpuProvider]];
  return [[gpuProvider], ['cpu']];
}
