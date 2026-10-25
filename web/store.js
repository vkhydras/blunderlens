// In-memory replacement for the SQLite database (nothing is persisted).
// Rows keep the same shape as the `games` and `analyses` tables.
export const players = new Map(); // username → { profile, stats, archives, fetchedAt }
export const archives = new Map(); // username → Map(url → { fetched_at, complete, games })
export const games = new Map(); // uuid → games row
export const analyses = new Map(); // uuid → { uuid, depth, engine, version, acc_w, acc_b, review, results, created_at }

export const gamesOf = (u) => [...games.values()].filter((g) => g.white_l === u || g.black_l === u);
