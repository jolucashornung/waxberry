import { describe, it, expect } from 'vitest';
import { displayWidth, wrapToWidth, padToWidth } from '../src/utils/textWidth.js';

describe('displayWidth', () => {
  it('counts ASCII characters as one column each', () => {
    expect(displayWidth('hello')).toBe(5);
  });

  it('counts CJK ideographs as two columns each', () => {
    expect(displayWidth('你好')).toBe(4);
  });

  it('counts mixed ASCII and CJK correctly', () => {
    // 'hi ' = 3 columns, '你好' = 4 columns
    expect(displayWidth('hi 你好')).toBe(7);
  });

  it('returns zero for empty string', () => {
    expect(displayWidth('')).toBe(0);
  });

  it('counts full-width punctuation as two columns', () => {
    expect(displayWidth('？')).toBe(2);
  });
});

describe('padToWidth', () => {
  it('right-pads ASCII text to the target width', () => {
    expect(padToWidth('hi', 5)).toBe('hi   ');
  });

  it('accounts for double-width characters when padding', () => {
    // '你好' is 4 columns; padding to 6 adds 2 spaces
    expect(padToWidth('你好', 6)).toBe('你好  ');
  });

  it('does not pad when text already meets the width', () => {
    expect(padToWidth('hello', 5)).toBe('hello');
  });

  it('does not truncate text wider than the target', () => {
    expect(padToWidth('hello', 3)).toBe('hello');
  });
});

describe('wrapToWidth', () => {
  it('keeps short text on a single line', () => {
    expect(wrapToWidth('hello', 10)).toEqual(['hello']);
  });

  it('wraps ASCII text that exceeds the width', () => {
    expect(wrapToWidth('abcdef', 3)).toEqual(['abc', 'def']);
  });

  it('wraps CJK text by display width, not character count', () => {
    // Each CJK char is 2 columns; maxWidth 4 fits exactly 2 chars per line
    expect(wrapToWidth('你好世界', 4)).toEqual(['你好', '世界']);
  });

  it('never places a wide character where it would overflow', () => {
    // maxWidth 3 fits one 2-column char, next char goes to a new line
    expect(wrapToWidth('你好', 3)).toEqual(['你', '好']);
  });

  it('returns a single empty line for empty input', () => {
    expect(wrapToWidth('', 10)).toEqual(['']);
  });
});
