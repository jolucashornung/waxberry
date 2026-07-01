#!/usr/bin/env npx tsx
/**
 * ASR benchmark — measures Whisper transcription accuracy across model sizes.
 * Usage: npx tsx tests/asr-benchmark/benchmark.ts [--asr-url <url>]
 *
 * Reads audio/*.wav files with matching audio/*.txt ground-truth files.
 * POSTs each WAV to the running ASR service and computes:
 *   CER (Character Error Rate) for Chinese (zh)
 *   WER (Word Error Rate) for English (en)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIO_DIR = path.join(__dirname, 'audio');

const ASR_URL = process.argv.includes('--asr-url')
  ? process.argv[process.argv.indexOf('--asr-url') + 1]
  : 'http://localhost:8001';

// Levenshtein distance between two arrays of strings (WER) or chars (CER)
function editDistance(a: string[], b: string[]): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] = a[i - 1] === b[j - 1]
        ? dp[i - 1]![j - 1]!
        : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
    }
  }
  return dp[m]![n]!;
}

function cer(ref: string, hyp: string): number {
  const r = [...ref.replace(/\s/g, '')];
  const h = [...hyp.replace(/\s/g, '')];
  if (r.length === 0) return h.length === 0 ? 0 : 1;
  return editDistance(r, h) / r.length;
}

function wer(ref: string, hyp: string): number {
  const normalize = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);
  const r = normalize(ref);
  const h = normalize(hyp);
  if (r.length === 0) return h.length === 0 ? 0 : 1;
  return editDistance(r, h) / r.length;
}

function isChinese(text: string): boolean {
  const chinese = (text.match(/[一-鿿㐀-䶿]/g) ?? []).length;
  const total = text.replace(/\s/g, '').length;
  return total > 0 && chinese / total > 0.3;
}

interface Result {
  file: string;
  language: string;
  metric: string;
  groundTruth: string;
  transcription: string;
  score: number;
  ms: number;
  error?: string;
}

async function transcribe(audioPath: string): Promise<{ text: string; language: string; ms: number }> {
  const wav = fs.readFileSync(audioPath);
  const audio_base64 = wav.toString('base64');

  const start = performance.now();
  const res = await fetch(`${ASR_URL}/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio_base64, sample_rate: 16000 }),
    signal: AbortSignal.timeout(60000),
  });
  const ms = Math.round(performance.now() - start);

  if (!res.ok) {
    throw new Error(`ASR returned ${res.status}: ${await res.text()}`);
  }
  const data = await res.json() as { text: string; language: string };
  return { text: data.text, language: data.language, ms };
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n - 1) + '…' : s.padEnd(n);
}

async function main(): Promise<void> {
  // Verify ASR service is up
  try {
    const health = await fetch(`${ASR_URL}/health`, { signal: AbortSignal.timeout(3000) });
    const { model } = await health.json() as { model: string };
    console.log(`\nASR service: ${ASR_URL}`);
    console.log(`Whisper model: ${model}\n`);
  } catch {
    console.error(`Cannot reach ASR service at ${ASR_URL}. Run: live-translate start`);
    process.exitCode = 1;
    return;
  }

  if (!fs.existsSync(AUDIO_DIR)) {
    console.error(`No audio directory found at ${AUDIO_DIR}. See README.md for setup.`);
    process.exitCode = 1;
    return;
  }

  const wavFiles = fs.readdirSync(AUDIO_DIR)
    .filter(f => f.endsWith('.wav'))
    .sort();

  if (wavFiles.length === 0) {
    console.error(`No .wav files found in ${AUDIO_DIR}. See README.md for recording instructions.`);
    process.exitCode = 1;
    return;
  }

  const results: Result[] = [];

  for (const wavFile of wavFiles) {
    const txtFile = wavFile.replace(/\.wav$/, '.txt');
    const txtPath = path.join(AUDIO_DIR, txtFile);

    if (!fs.existsSync(txtPath)) {
      console.warn(`  Skipping ${wavFile} — no matching ${txtFile}`);
      continue;
    }

    const groundTruth = fs.readFileSync(txtPath, 'utf8').trim();
    process.stdout.write(`  Processing ${wavFile}...`);

    try {
      const { text, language, ms } = await transcribe(path.join(AUDIO_DIR, wavFile));
      const isZh = isChinese(groundTruth);
      const score = isZh ? cer(groundTruth, text) : wer(groundTruth, text);
      const metric = isZh ? 'CER' : 'WER';
      results.push({ file: wavFile, language, metric, groundTruth, transcription: text, score, ms });
      console.log(` ${metric}: ${score.toFixed(2)} (${ms}ms)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ file: wavFile, language: '?', metric: '?', groundTruth, transcription: '', score: 1, ms: 0, error: msg });
      console.log(` ERROR: ${msg}`);
    }
  }

  if (results.length === 0) {
    console.log('\nNo results to display.');
    return;
  }

  // Print table
  const w = { file: 14, lang: 8, metric: 6, ref: 40, hyp: 40, score: 7, ms: 8 };
  const row = (f: string, l: string, m: string, r: string, h: string, s: string, t: string) =>
    `│ ${pad(f, w.file)} │ ${pad(l, w.lang)} │ ${pad(m, w.metric)} │ ${pad(r, w.ref)} │ ${pad(h, w.hyp)} │ ${s.padStart(w.score)} │ ${t.padStart(w.ms)} │`;
  const sep = `├${'─'.repeat(w.file + 2)}┼${'─'.repeat(w.lang + 2)}┼${'─'.repeat(w.metric + 2)}┼${'─'.repeat(w.ref + 2)}┼${'─'.repeat(w.hyp + 2)}┼${'─'.repeat(w.score + 2)}┼${'─'.repeat(w.ms + 2)}┤`;
  const top = sep.replace(/├/g, '┌').replace(/┼/g, '┬').replace(/┤/g, '┐').replace(/─/g, '─');
  const bot = sep.replace(/├/g, '└').replace(/┼/g, '┴').replace(/┤/g, '┘').replace(/─/g, '─');

  console.log('\n' + top);
  console.log(row('file', 'language', 'metric', 'ground truth', 'transcription', 'score', 'ms'));
  console.log(sep);
  for (const r of results) {
    console.log(row(r.file, r.language, r.metric, r.groundTruth, r.error ?? r.transcription, r.error ? 'ERROR' : r.score.toFixed(2), String(r.ms)));
  }
  console.log(bot);

  const zhResults = results.filter(r => r.metric === 'CER' && !r.error);
  const enResults = results.filter(r => r.metric === 'WER' && !r.error);
  const avg = (arr: Result[]) => arr.reduce((s, r) => s + r.score, 0) / arr.length;

  console.log(`\nSummary: ${results.length} files processed`);
  if (zhResults.length > 0) console.log(`  Mandarin avg CER: ${avg(zhResults).toFixed(3)} (${zhResults.length} files)`);
  if (enResults.length > 0) console.log(`  English avg WER:  ${avg(enResults).toFixed(3)} (${enResults.length} files)`);
  console.log('');
}

main();
