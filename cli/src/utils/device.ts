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

// transformers.js device + dtype attempts in priority order. GPU attempts always end in a CPU
// fallback — a preference must never leave the service unable to start on a CPU-only
// onnxruntime build; the attempt loop logs a warning when it has to fall back.
export function asrDeviceAttempts(pref: DevicePreference): AsrDeviceAttempt[] {
  if (pref === 'cpu') return [{ device: 'cpu', dtype: 'q8' }];
  return [{ device: 'gpu', dtype: 'fp16' }, { device: 'cpu', dtype: 'q8' }];
}

// onnxruntime execution-provider attempts in priority order. The GPU provider is platform
// specific (CoreML on macOS, CUDA elsewhere) and requires a matching onnxruntime-node build,
// so GPU preferences also end in a CPU fallback.
// 'auto' resolves to CPU for TTS: CoreML splits the Piper graph into ~200 partitions
// (observed 1096/2685 nodes assigned), and the transfer overhead makes it slower than plain
// CPU. GPU execution providers are only attempted on an explicit 'gpu' preference.
export function ttsProviderAttempts(pref: DevicePreference, platform: string): string[][] {
  const gpuProvider = platform === 'darwin' ? 'coreml' : 'cuda';
  if (pref === 'gpu') return [[gpuProvider], ['cpu']];
  return [['cpu']];
}
