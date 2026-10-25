// Static build for Vercel. Same client as the local app, but the modules that
// talk to the local server are swapped for in-browser versions: Chess.com is
// fetched directly (it allows CORS), data lives in memory instead of SQLite,
// and Stockfish runs as WASM in Web Workers. The Live board is local-only.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const r = (p) => fileURLToPath(new URL(p, import.meta.url));
const SWAP = {
  [r('client/src/lib/api.js')]: r('web/api.js'),
  [r('client/src/lib/engine.js')]: r('web/engine.js'),
  [r('client/src/components/LivePage.jsx')]: r('web/NoLive.jsx'),
  [r('server/db.js')]: r('web/db.js'),
  [r('server/chesscom.js')]: r('web/chesscom.js'),
};

const swap = {
  name: 'web-swap',
  enforce: 'pre',
  async resolveId(source, importer, opts) {
    if (!importer || importer.startsWith(r('web/'))) return null;
    const res = await this.resolve(source, importer, { ...opts, skipSelf: true });
    return res && SWAP[res.id] ? SWAP[res.id] : null;
  },
  transformIndexHtml: { order: 'pre', handler: (html) => html.replace('/client/src/main.jsx', '/web/main.jsx') },
};

export default defineConfig({
  plugins: [swap, react()],
  publicDir: 'web/public',
  server: { port: 5174 },
});
