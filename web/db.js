// Browser stand-in for server/db.js so server/insights.js runs unchanged.
// insights.js prepares exactly two statements: the analysed games of a player
// (ordered by end_time) and a COUNT/MAX stamp used as its cache key.
import { gamesOf, analyses } from './store.js';

function analysed(u) {
  return gamesOf(u)
    .filter((g) => analyses.has(g.uuid))
    .sort((a, b) => a.end_time - b.end_time)
    .map((g) => ({ g, a: analyses.get(g.uuid) }));
}

export const db = {
  prepare(sql) {
    if (/COUNT\(\*\)/.test(sql))
      return {
        get: (u) => {
          const xs = analysed(u);
          return { n: xs.length, t: Math.max(0, ...xs.map((x) => x.a.created_at)) };
        },
      };
    return { all: (u) => analysed(u).map(({ g, a }) => ({ ...g, review: JSON.stringify(a.review), created_at: a.created_at })) };
  },
};
