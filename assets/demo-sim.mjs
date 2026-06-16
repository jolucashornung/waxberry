#!/usr/bin/env node
// Terminal demo simulation for live-translate — not the real tool.
// Scripted for vhs recording; driven by SPACE/Q keypresses from the tape.

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const BLUE = '\x1b[34m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function clearLine() {
  process.stdout.write('\r\x1b[K');
}

let pendingKeyResolve = null;

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding('utf8');
process.stdin.on('data', (key) => {
  if (key === '\x03') process.exit(0);
  if (pendingKeyResolve) {
    const resolve = pendingKeyResolve;
    pendingKeyResolve = null;
    resolve(key);
  }
});

function nextKey() {
  return new Promise((resolve) => {
    pendingKeyResolve = resolve;
  });
}

async function waitForKey(expected) {
  while (true) {
    const key = await nextKey();
    if (key === expected || key.toLowerCase() === expected.toLowerCase()) return;
  }
}

async function spinFor(msg, ms) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  const start = Date.now();
  let i = 0;
  while (Date.now() - start < ms) {
    process.stdout.write(`\r${BLUE}${frames[i % frames.length]}${RESET} ${msg}`);
    await sleep(80);
    i++;
  }
  clearLine();
}

const pad = (s) => s.slice(0, 44).padEnd(44);

function printResultBox(original, detectedLang, translated, targetLang) {
  const sourceLine = detectedLang === 'en' ? 'You said (English):' : 'You said (中文):';
  const targetLine = targetLang === 'zh' ? 'Translation (中文):' : 'Translation (English):';
  console.log('  ┌──────────────────────────────────────────────┐');
  console.log(`  │  ${pad(sourceLine)}│`);
  console.log(`  │  ${pad(original)}│`);
  console.log('  │                                              │');
  console.log(`  │  ${pad(targetLine)}│`);
  console.log(`  │  ${pad(translated)}│`);
  console.log('  └──────────────────────────────────────────────┘');
}

async function recording(label) {
  await waitForKey(' ');
  const start = Date.now();
  const timer = setInterval(() => {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    clearLine();
    process.stdout.write(`  ${RED}● Recording... ${elapsed}s${RESET}`);
  }, 100);
  await waitForKey(' ');
  clearInterval(timer);
  clearLine();
}

async function processing(ms) {
  const start = Date.now();
  const timer = setInterval(() => {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    clearLine();
    process.stdout.write(`  ${BLUE}⟳ Processing... ${elapsed}s${RESET}`);
  }, 100);
  await sleep(ms);
  clearInterval(timer);
  clearLine();
}

async function main() {
  // Startup
  await spinFor('Starting translation services...', 1800);
  await spinFor('Waiting for services to be healthy...', 2200);
  process.stdout.write(`${GREEN}✔${RESET} All services started.\n`);

  await sleep(300);
  console.log('');
  console.log('    ASR:         Whisper (base) — local');
  console.log('    Translation: Opus-MT');
  console.log('    TTS:         Piper (en, zh) — local');
  console.log('');
  console.log('    Note:');
  console.log('    Fully local. No data leaves your machine.');
  console.log('');

  await sleep(400);

  // Banner
  console.log('');
  process.stdout.write(`  ${BOLD}Live Translator — EN ↔ 中文${RESET}\n`);
  console.log('  Provider: Opus-MT');
  console.log('  Press SPACE to start/stop recording. Press Q to quit.');
  console.log('');
  process.stdout.write(`  ${DIM}▶ Ready${RESET}\n`);

  // Translation 1: EN → ZH
  await recording('en');
  await processing(1200);
  console.log('');
  printResultBox('How are you today?', 'en', '你今天好吗？', 'zh');
  console.log('  🔊 Playing translation...');
  await sleep(2000);
  console.log('');
  process.stdout.write(`  ${DIM}▶ Ready${RESET}\n`);

  // Translation 2: ZH → EN
  await recording('zh');
  await processing(900);
  console.log('');
  printResultBox('谢谢你的帮助。', 'zh', 'Thank you for your help.', 'en');
  console.log('  🔊 Playing translation...');
  await sleep(2000);
  console.log('');
  process.stdout.write(`  ${DIM}▶ Ready${RESET}\n`);

  // Quit
  await waitForKey('q');
  console.log('');
  process.stdin.setRawMode(false);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
