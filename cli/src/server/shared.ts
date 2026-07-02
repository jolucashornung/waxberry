import * as http from 'node:http';
import * as https from 'node:https';
import * as fs from 'node:fs';
import * as path from 'node:path';

export type Routes = Record<string, (body: unknown) => Promise<unknown>>;

// Generous bound for base64 WAV payloads (30 s of 16 kHz mono is ~1.3 MB base64) while still
// preventing an unbounded body from exhausting memory.
const MAX_BODY_BYTES = 32 * 1024 * 1024;

export function logLine(message: string): void {
  console.log(`${new Date().toISOString()} ${message}`);
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // Collect chunks and decode once at the end — decoding per chunk corrupts any multi-byte
    // UTF-8 character (e.g. Chinese text) that a TCP chunk boundary splits.
    const chunks: Buffer[] = [];
    let received = 0;
    req.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > MAX_BODY_BYTES) {
        reject(new Error(`Invalid request: body exceeds ${MAX_BODY_BYTES} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export function createServer(routes: Routes, port: number): http.Server {
  const server = http.createServer(async (req, res) => {
    const method = req.method ?? 'GET';
    const url = req.url?.split('?')[0] ?? '/';
    const key = `${method} ${url}`;

    const handler = routes[key];
    if (!handler) {
      sendJson(res, 404, { error: `Not found: ${key}` });
      return;
    }

    try {
      const body = method === 'POST' ? await readBody(req) : {};
      const result = await handler(body);
      sendJson(res, 200, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.startsWith('Invalid') || message.startsWith('Unsupported') ? 400 : 500;
      sendJson(res, status, { error: message });
    }
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logLine(`Port ${port} is already in use — another instance may still be running. Run \`live-translate stop\` first.`);
    } else {
      logLine(`Server error: ${err.message}`);
    }
    process.exit(1);
  });

  server.listen(port, () => {
    logLine(`Service listening on port ${port}`);
  });

  return server;
}

const WAV_HEADER_BYTES = 44;

export function wavBase64ToFloat32(b64: string): { samples: Float32Array; sampleRate: number } {
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < WAV_HEADER_BYTES) {
    throw new Error('Invalid WAV: buffer too short');
  }

  const formatCode = buf.readUInt16LE(20);
  const sampleRate = buf.readUInt32LE(24);
  const numChannels = buf.readUInt16LE(22);
  const bitsPerSample = buf.readUInt16LE(34);

  if (formatCode !== 1) {
    throw new Error(`Invalid WAV: expected PCM (format 1), got format ${formatCode}`);
  }
  if (numChannels === 0) {
    throw new Error('Invalid WAV: zero channels');
  }
  if (bitsPerSample !== 16) {
    throw new Error(`Invalid WAV: expected 16-bit PCM, got ${bitsPerSample}-bit`);
  }

  const pcmData = buf.slice(WAV_HEADER_BYTES);
  const numSamples = Math.floor(pcmData.length / 2 / numChannels);
  const samples = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    // Read first channel only (mono or left channel of stereo)
    const int16 = pcmData.readInt16LE(i * 2 * numChannels);
    samples[i] = int16 / 32768.0;
  }

  return { samples, sampleRate };
}

export function int16ToWavBase64(pcm: Int16Array, sampleRate: number): string {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcm.length * 2;
  const headerSize = WAV_HEADER_BYTES;
  const fileSize = headerSize + dataSize;

  const buf = Buffer.alloc(fileSize);

  // RIFF chunk
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(fileSize - 8, 4);
  buf.write('WAVE', 8, 'ascii');

  // fmt sub-chunk
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);         // sub-chunk size
  buf.writeUInt16LE(1, 20);          // PCM format
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);

  // data sub-chunk
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < pcm.length; i++) {
    buf.writeInt16LE(pcm[i] ?? 0, WAV_HEADER_BYTES + i * 2);
  }

  return buf.toString('base64');
}

const MAX_REDIRECTS = 5;

export async function downloadFile(url: string, dest: string): Promise<void> {
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);

    function fail(err: Error): void {
      file.close(() => fs.unlink(dest, () => undefined));
      reject(err);
    }

    function request(currentUrl: string, redirectsLeft: number): void {
      const client = currentUrl.startsWith('https') ? https : http;
      client.get(currentUrl, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (redirectsLeft === 0) {
            fail(new Error(`Too many redirects downloading ${url}`));
            return;
          }
          request(res.headers.location, redirectsLeft - 1);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          fail(new Error(`Failed to download ${currentUrl}: HTTP ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
        file.on('error', fail);
      }).on('error', fail);
    }

    request(url, MAX_REDIRECTS);
  });
}
