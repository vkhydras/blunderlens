// SQLite storage (Node's built-in node:sqlite). Holds Chess.com data, the
// Stockfish position cache and finished game reviews.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = process.env.DB_PATH || join(ROOT, 'data/chess.db');
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;

  CREATE TABLE IF NOT EXISTS players (
    username TEXT PRIMARY KEY,         -- lowercase
    profile TEXT, stats TEXT, archives TEXT,
    fetched_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS archives (
    username TEXT, url TEXT,
    fetched_at INTEGER, complete INTEGER DEFAULT 0, games INTEGER,
    PRIMARY KEY (username, url)
  );

  CREATE TABLE IF NOT EXISTS games (
    uuid TEXT PRIMARY KEY,
    url TEXT, end_time INTEGER, time_class TEXT, time_control TEXT, rules TEXT, rated INTEGER,
    white TEXT, black TEXT, white_l TEXT, black_l TEXT,
    white_rating INTEGER, black_rating INTEGER, white_result TEXT, black_result TEXT,
    eco_url TEXT, accuracies TEXT, pgn TEXT, source TEXT DEFAULT 'chesscom'
  );
  CREATE INDEX IF NOT EXISTS games_white ON games (white_l, end_time);
  CREATE INDEX IF NOT EXISTS games_black ON games (black_l, end_time);

  CREATE TABLE IF NOT EXISTS analyses (
    uuid TEXT PRIMARY KEY,
    depth INTEGER, engine TEXT, version INTEGER,
    acc_w REAL, acc_b REAL,
    review TEXT,      -- classified moves + summary (small)
    results TEXT,     -- raw engine results per position (large)
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS evals (
    fen TEXT, engine TEXT, depth INTEGER, multipv INTEGER, result TEXT,
    PRIMARY KEY (fen, engine, depth, multipv)
  );
`);

export const q = {
  getPlayer: db.prepare('SELECT * FROM players WHERE username = ?'),
  putPlayer: db.prepare(`INSERT INTO players (username, profile, stats, archives, fetched_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET profile = excluded.profile, stats = excluded.stats, archives = excluded.archives, fetched_at = excluded.fetched_at`),
  listPlayers: db.prepare(`SELECT p.username, p.profile, p.fetched_at,
      (SELECT COUNT(*) FROM games g WHERE g.white_l = p.username OR g.black_l = p.username) AS games
    FROM players p ORDER BY p.fetched_at DESC LIMIT 12`),

  getArchives: db.prepare('SELECT * FROM archives WHERE username = ?'),
  putArchive: db.prepare(`INSERT INTO archives (username, url, fetched_at, complete, games) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(username, url) DO UPDATE SET fetched_at = excluded.fetched_at, complete = excluded.complete, games = excluded.games`),

  putGame: db.prepare(`INSERT INTO games (uuid, url, end_time, time_class, time_control, rules, rated, white, black, white_l, black_l,
      white_rating, black_rating, white_result, black_result, eco_url, accuracies, pgn, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(uuid) DO UPDATE SET accuracies = excluded.accuracies, pgn = excluded.pgn`),
  getGame: db.prepare('SELECT * FROM games WHERE uuid = ?'),

  getAnalysis: db.prepare('SELECT * FROM analyses WHERE uuid = ?'),
  putAnalysis: db.prepare(`INSERT INTO analyses (uuid, depth, engine, version, acc_w, acc_b, review, results, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(uuid) DO UPDATE SET depth = excluded.depth, engine = excluded.engine, version = excluded.version,
      acc_w = excluded.acc_w, acc_b = excluded.acc_b, review = excluded.review, results = excluded.results, created_at = excluded.created_at`),

  getEval: db.prepare(`SELECT result FROM evals WHERE fen = ? AND engine = ? AND depth >= ? AND multipv >= ?
    ORDER BY depth DESC LIMIT 1`),
  putEval: db.prepare('INSERT OR REPLACE INTO evals (fen, engine, depth, multipv, result) VALUES (?, ?, ?, ?, ?)'),
};

export const tx = (fn) => {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
};
