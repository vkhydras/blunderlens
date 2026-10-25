// Copies the single-threaded Stockfish WASM build into the web build's public dir.
import { cpSync, mkdirSync } from 'node:fs';

const SRC = 'node_modules/stockfish/bin';
const DEST = 'web/public/stockfish';
mkdirSync(DEST, { recursive: true });
for (const f of ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm']) cpSync(`${SRC}/${f}`, `${DEST}/${f}`);
console.log(`Stockfish WASM copied to ${DEST}`);
