// Downloads an offline speech model (OpenAI Whisper, converted to ONNX by the sherpa-onnx project)
// from GitHub and installs it into public/models/whisper, so your own server can hand it to every device.
//
//   npm run get-model                      -> tiny.en  (about 100 MB, fast, good for short commands)
//   npm run get-model -- base.en           -> better with accents, about 2x slower, about 160 MB
//   npm run get-model -- --archive FILE    -> use an already downloaded .tar.bz2 (e.g. copied on a USB stick)
//
// Needs the "tar" command with bzip2 support (Linux, macOS and Windows 10+ have it).
import { copyFileSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'models', 'whisper');
const args = process.argv.slice(2);
const archiveArg = args.includes('--archive') ? args[args.indexOf('--archive') + 1] : undefined;
const name = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--archive') ?? 'tiny.en';
const allowed = ['tiny.en', 'base.en', 'small.en'];
if (!allowed.includes(name)) {
  console.error(`Unknown model "${name}". Choose one of: ${allowed.join(', ')}`);
  process.exit(1);
}

async function download(url, dest) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok || !res.body) throw new Error(`server replied ${res.status}`);
      const total = Number(res.headers.get('content-length')) || 0;
      let got = 0;
      let lastShown = 0;
      const src = Readable.fromWeb(res.body);
      src.on('data', (c) => {
        got += c.length;
        if (got - lastShown > 5_000_000) {
          lastShown = got;
          process.stdout.write(`\r  downloaded ${(got / 1e6).toFixed(0)} MB${total ? ` of ${(total / 1e6).toFixed(0)} MB` : ''}   `);
        }
      });
      await pipeline(src, createWriteStream(dest));
      if (total && got !== total) throw new Error('download was cut short');
      process.stdout.write('\n');
      return;
    } catch (e) {
      console.log(`\n  attempt ${attempt} failed: ${e.message}`);
      if (attempt === 5) throw e;
      await new Promise((r) => setTimeout(r, 4000 * attempt));
    }
  }
}

const work = mkdtempSync(join(tmpdir(), 'openpos-model-'));
try {
  let archive = archiveArg ? resolve(archiveArg) : join(work, `${name}.tar.bz2`);
  if (archiveArg) {
    if (!existsSync(archive)) throw new Error(`File not found: ${archive}`);
  } else {
    const url = `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-${name}.tar.bz2`;
    console.log(`Downloading ${name} from GitHub...`);
    await download(url, archive);
  }
  console.log('Unpacking...');
  const t = spawnSync('tar', ['-xjf', archive, '-C', work], { stdio: 'inherit' });
  if (t.status !== 0) throw new Error('Could not unpack the archive. Is "tar" with bzip2 support installed? (On Debian/Ubuntu: apt install bzip2)');

  const dir = join(work, `sherpa-onnx-whisper-${name}`);
  const parts = [
    [`${name}-encoder.int8.onnx`, 'encoder.onnx'],
    [`${name}-decoder.int8.onnx`, 'decoder.onnx'],
    [`${name}-tokens.txt`, 'tokens.txt'],
  ];
  mkdirSync(out, { recursive: true });
  const files = parts.map(([src, dst]) => {
    const from = join(dir, src);
    if (!existsSync(from)) throw new Error(`Archive does not contain ${src}`);
    copyFileSync(from, join(out, dst));
    return { name: dst, size: statSync(join(out, dst)).size };
  });
  const version = `${name}-${files[0].size}-${files[1].size}`;
  writeFileSync(join(out, 'manifest.json'), JSON.stringify({ model: `whisper-${name}`, version, files }, null, 2));
  console.log(`Installed whisper-${name} (${(files.reduce((s, f) => s + f.size, 0) / 1e6).toFixed(0)} MB) in public/models/whisper`);
  console.log('Rebuild (npm run build) or restart the dev server, then open Settings > Voice on each device to download it.');
} catch (e) {
  console.error('\nFailed:', e.message);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
