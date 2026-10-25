# BlunderLens

A Chess.com game analyzer that runs on your own machine with native Stockfish 19. Its focus is finding the mistakes you keep repeating.

- **Player page**: type a Chess.com username to see the profile, ratings, rating history and the full game list with filters. Games are stored in SQLite (`data/chess.db`), so they are only fetched once. Finished months are never fetched again, and the current month refreshes every 5 minutes.
- **Game review**: accuracy (overall and per phase), move classes (Brilliant … Blunder), an eval graph, critical moments, the opening and where you left book, and a coach line for each move explaining the tactic you missed or allowed. **Retry this move** lets you find the better move yourself.
- **Weaknesses**: skill profile, focus areas with example positions, and accuracy by phase, clock pressure, tactics missed and allowed, pieces, and opponent strength.
- **Mistakes**: every error from analysed games, with filters (phase, tactic, piece, low clock). Click one to jump straight to that position.
- **Openings / Progress**: results and accuracy per opening, plus weekly or monthly trends.
- **Live board** (`#/live`): make moves for both sides. Each move is rated as it is played, and the best move for the side to move is shown. Load a FEN or PGN, or send the line to a full review.
  *Use the Live board only for study, never during a rated online game. That is engine assistance and breaks Chess.com's fair-play rules.*
- Batch analysis ("Analyze 25 newest") runs in the background and feeds the weakness stats. Reviews are cached, and if the classification rules change they are rebuilt from cached engine output without re-running Stockfish.

## Run

```bash
npm install
npm run dev        # backend on :3001 + Vite on :5173 → open http://localhost:5173
```

Requires Node 24+ (uses the built-in `node:sqlite`).
Stockfish is expected at `engine/stockfish/stockfish-linux-x86-64-universal`. Set `STOCKFISH_PATH` to use another binary.

| Env var | Default | Meaning |
|---|---|---|
| `POOL_SIZE` | min(8, cpus/3) | Stockfish processes for reviews and batch analysis |
| `POOL_THREADS` | (cpus − live) / pool | threads per pool engine |
| `LIVE_THREADS` | min(8, cpus/4) | threads for the live engine |
| `PORT` / `DB_PATH` | 3001 / `data/chess.db` | |

On an i9 with 32 threads this gives 8 engines × 3 threads plus an 8-thread live engine. Stockfish runs on the CPU only, so the GPU is not used.

Production: `npm start` builds the client and serves it from :3001.

## Online version (Vercel)

`npm run build:web` builds a static version with `vite.web.config.js`. It is the same client, with the server-backed modules swapped for browser ones in `web/`:
Chess.com is fetched directly from the browser, data is kept in memory only (no SQLite, nothing saved), and Stockfish 19 *lite* runs as single-threaded WASM in several Web Workers. The Live board is local-only. `vercel deploy --prod` deploys it (see `vercel.json`).
Reviews are slower online (~1 min per game) than with native Stockfish.

## Layout

| Path | What it does |
|---|---|
| `server/engine.js` | UCI wrapper around Stockfish |
| `server/pool.js` | Engine pool with an interactive/batch priority queue and a SQLite eval cache |
| `server/analyzer.js` | Two-pass game analysis (quick pass, then deeper search on critical moves) |
| `server/chesscom.js` | Chess.com public API with caching |
| `server/insights.js` | Weakness, opening, progress and mistake statistics |
| `server/index.js` | REST (`/api`) + WebSocket (`/ws`) |
| `shared/review.js` | Win %, move classification, accuracy, explanations (used by server and browser) |
| `shared/tactics.js` | Fork/pin/skewer/hanging-piece/mate detectors |
| `shared/openings.js` | Opening book built from lichess/chess-openings (`node scripts/build-openings.js`) |

## How moves are classified

Stockfish provides the evaluations, and rules turn them into labels. Win % comes from centipawns using the Lichess formula. A move's loss is how much win % it gave up compared with Stockfish's best move:
≤2 excellent, ≤5 good, ≤10 inaccuracy, ≤20 mistake, >20 blunder. **Best** = Stockfish's top move.
**Great** = the only good move (the second-best line is ≥20% worse). **Brilliant** = a good, non-winning-already move that sacrifices ≥2 points of material that wasn't already hanging.
**Miss** = failing to punish the opponent's error. Accuracy uses the Lichess method, which tracks Chess.com's CAPS closely.
