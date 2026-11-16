// Copies the single-threaded Stockfish WASM build into public/ so it can be served as a static Web Worker.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'stockfish', 'bin');
const out = join(root, 'public', 'engine');
mkdirSync(out, { recursive: true });
for (const file of ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm']) {
  copyFileSync(join(src, file), join(out, file));
}
console.log('Copied Stockfish engine to public/engine');
