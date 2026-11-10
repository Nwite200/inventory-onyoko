// Copies the speech runtime (ONNX Runtime, WebAssembly build) into public/ort so it is served from
// your own server instead of a public CDN. Runs automatically after install, dev and build.
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules', 'onnxruntime-web', 'dist');
const to = join(root, 'public', 'ort');
const names = ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'];

if (!existsSync(from)) {
  console.log('copy-ort: onnxruntime-web is not installed yet, skipping');
  process.exit(0);
}
mkdirSync(to, { recursive: true });
const files = names.map((name) => {
  copyFileSync(join(from, name), join(to, name));
  return { name, size: statSync(join(to, name)).size };
});
writeFileSync(join(to, 'manifest.json'), JSON.stringify({ version: String(files[1].size), files }, null, 2));
console.log(`copy-ort: ${files.map((f) => f.name).join(', ')} -> public/ort`);
