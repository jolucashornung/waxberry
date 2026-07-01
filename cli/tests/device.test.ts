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

  it('gpu preference yields a single GPU/fp16 attempt', () => {
    expect(asrDeviceAttempts('gpu')).toEqual([{ device: 'gpu', dtype: 'fp16' }]);
  });

  it('auto tries GPU first, then falls back to CPU', () => {
    expect(asrDeviceAttempts('auto')).toEqual([
      { device: 'gpu', dtype: 'fp16' },
      { device: 'cpu', dtype: 'q8' },
    ]);
  });
});

describe('ttsProviderAttempts', () => {
  it('uses CoreML as the GPU provider on macOS', () => {
    expect(ttsProviderAttempts('gpu', 'darwin')).toEqual([['coreml']]);
  });

  it('uses CUDA as the GPU provider on non-macOS', () => {
    expect(ttsProviderAttempts('gpu', 'linux')).toEqual([['cuda']]);
  });

  it('auto tries the platform GPU provider, then CPU', () => {
    expect(ttsProviderAttempts('auto', 'linux')).toEqual([['cuda'], ['cpu']]);
    expect(ttsProviderAttempts('auto', 'darwin')).toEqual([['coreml'], ['cpu']]);
  });

  it('cpu preference yields only the CPU provider', () => {
    expect(ttsProviderAttempts('cpu', 'darwin')).toEqual([['cpu']]);
  });
});
