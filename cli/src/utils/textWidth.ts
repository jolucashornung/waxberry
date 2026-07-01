// Terminal display-width helpers. CJK ideographs and full-width punctuation occupy two
// monospace columns; treating them as one breaks box alignment in the result panel.

// Returns true for code points that render two columns wide in a monospace terminal.
function isWideCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) || // Hangul Jamo
    (codePoint >= 0x2e80 && codePoint <= 0x303e) || // CJK radicals, Kangxi
    (codePoint >= 0x3041 && codePoint <= 0x33ff) || // Hiragana, Katakana, CJK symbols
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) || // CJK Extension A
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) || // CJK Unified Ideographs
    (codePoint >= 0xa000 && codePoint <= 0xa4cf) || // Yi
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) || // Hangul syllables
    (codePoint >= 0xf900 && codePoint <= 0xfaff) || // CJK compatibility ideographs
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) || // CJK compatibility forms
    (codePoint >= 0xff00 && codePoint <= 0xff60) || // full-width forms
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) || // full-width signs
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)  // CJK Extension B+ (astral)
  );
}

// Total number of terminal columns the string occupies.
export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    width += isWideCodePoint(char.codePointAt(0) ?? 0) ? 2 : 1;
  }
  return width;
}

// Splits text into lines that each fit within maxWidth display columns, breaking between
// characters (CJK has no spaces). Never splits an astral character.
export function wrapToWidth(text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = '';
  let currentWidth = 0;

  for (const char of text) {
    const charWidth = isWideCodePoint(char.codePointAt(0) ?? 0) ? 2 : 1;
    if (currentWidth + charWidth > maxWidth) {
      lines.push(current);
      current = char;
      currentWidth = charWidth;
    } else {
      current += char;
      currentWidth += charWidth;
    }
  }
  if (current || lines.length === 0) lines.push(current);
  return lines;
}

// Pads text with trailing spaces to exactly width display columns (right-pad).
export function padToWidth(text: string, width: number): string {
  const padding = width - displayWidth(text);
  return padding > 0 ? text + ' '.repeat(padding) : text;
}
