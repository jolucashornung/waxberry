import { describe, it, expect } from 'vitest';
import { asrDeviceAttempts, ttsProviderAttempts, isDevicePreference } from '../src/utils/device.js';

describe('isDevicePreference', () => {
  it('accepts the known preferences', () => {
    expect(isDevicePreference('auto')).toBe(true);
    expect(isDevicePreference('cpu')).toBe(true);
    expect(isDevicePreference('gpu')).toBe(true);
  });

  it('rejects unknown values', () => {
    expect(isDevicePreference('cuda')).toBe(false);
    expect(isDevicePreference('')).toBe(false);
  });
});

describe('asrDeviceAttempts', () => {
  it('cpu preference yields a single CPU/q8 attempt', () => {
    expect(asrDeviceAttempts('cpu')).toEqual([{ device: 'cpu', dtype: 'q8' }]);
  });

  it('gpu preference falls back to CPU so a CPU-only build can still start', () => {
    expect(asrDeviceAttempts('gpu')).toEqual([
      { device: 'gpu', dtype: 'fp16' },
      { device: 'cpu', dtype: 'q8' },
    ]);
  });

  it('auto tries GPU first, then falls back to CPU', () => {
    expect(asrDeviceAttempts('auto')).toEqual([
      { device: 'gpu', dtype: 'fp16' },
      { device: 'cpu', dtype: 'q8' },
    ]);
  });
});

describe('ttsProviderAttempts', () => {
  it('explicit gpu tries CoreML on macOS, then falls back to CPU', () => {
    expect(ttsProviderAttempts('gpu', 'darwin')).toEqual([['coreml'], ['cpu']]);
  });

  it('explicit gpu tries CUDA on non-macOS, then falls back to CPU', () => {
    expect(ttsProviderAttempts('gpu', 'linux')).toEqual([['cuda'], ['cpu']]);
  });

  it('auto resolves to CPU (CoreML partitioning slows Piper down)', () => {
    expect(ttsProviderAttempts('auto', 'linux')).toEqual([['cpu']]);
    expect(ttsProviderAttempts('auto', 'darwin')).toEqual([['cpu']]);
  });

  it('cpu preference yields only the CPU provider', () => {
    expect(ttsProviderAttempts('cpu', 'darwin')).toEqual([['cpu']]);
  });
});
