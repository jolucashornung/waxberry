import { describe, it, expect } from 'vitest';
import { buildRecordArgs, isRecordingTooShort, isRecordingTooLong } from '../src/services/recorder.js';

describe('buildRecordArgs', () => {
  it('produces correct sox rec flags for a wav file', () => {
    const args = buildRecordArgs('/tmp/test.wav');
    expect(args).toContain('-q');
    expect(args).toContain('-t');
    expect(args).toContain('wav');
    expect(args).toContain('-r');
    expect(args).toContain('16000');
    expect(args).toContain('-c');
    expect(args).toContain('1');
    expect(args).toContain('-b');
    expect(args).toContain('16');
  });

  it('includes the output path as the last argument by default', () => {
    const args = buildRecordArgs('/custom/output.wav');
    expect(args[args.length - 1]).toBe('/custom/output.wav');
  });

  it('appends a silence effect when autoStop is enabled', () => {
    const args = buildRecordArgs('/tmp/test.wav', { autoStop: true });
    expect(args).toContain('silence');
    // silence effect trails the output path
    const outputIndex = args.indexOf('/tmp/test.wav');
    expect(args.indexOf('silence')).toBeGreaterThan(outputIndex);
  });

  it('omits the silence effect when autoStop is disabled', () => {
    const args = buildRecordArgs('/tmp/test.wav', { autoStop: false });
    expect(args).not.toContain('silence');
    expect(args[args.length - 1]).toBe('/tmp/test.wav');
  });
});

describe('isRecordingTooShort', () => {
  it('returns true for 300ms (below 500ms threshold)', () => {
    expect(isRecordingTooShort(300)).toBe(true);
  });

  it('returns false for 600ms (above 500ms threshold)', () => {
    expect(isRecordingTooShort(600)).toBe(false);
  });

  it('returns false exactly at threshold (500ms)', () => {
    expect(isRecordingTooShort(500)).toBe(false);
  });

  it('returns true for 0ms', () => {
    expect(isRecordingTooShort(0)).toBe(true);
  });
});

describe('isRecordingTooLong', () => {
  it('returns true for 31000ms (above 30s limit)', () => {
    expect(isRecordingTooLong(31000)).toBe(true);
  });

  it('returns false for 29000ms (below 30s limit)', () => {
    expect(isRecordingTooLong(29000)).toBe(false);
  });

  it('returns false exactly at threshold (30000ms)', () => {
    expect(isRecordingTooLong(30000)).toBe(false);
  });
});
