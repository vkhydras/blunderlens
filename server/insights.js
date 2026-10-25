// Aggregates stored reviews into a player's weakness profile, opening stats,
// progress over time and a searchable list of their mistakes.
//
// Moves played in already-decided positions (win chance < 10% or > 97% before
// the move) are left out of error statistics so lost games don't skew them.
import { db } from './db.js';
import { openingName } from './chesscom.js';
import { moveAccuracy, SERIOUS, THEMES } from '../shared/review.js';
import { PIECE_NAME } from '../shared/tactics.js';

const DRAWS = new Set(['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient']);
const PHASES = ['opening', 'middlegame', 'endgame'];
const cache = new Map();

const rowsStmt = db.prepare(`
  SELECT g.uuid, g.end_time, g.time_class, g.white_l, g.black_l, g.white, g.black, g.white_rating, g.black_rating,
         g.white_result, g.black_result, g.eco_url, a.review, a.created_at
  FROM games g JOIN analyses a ON a.uuid = g.uuid
  WHERE g.white_l = ? OR g.black_l = ?
  ORDER BY g.end_time`);
const stampStmt = db.prepare(`SELECT COUNT(*) n, MAX(a.created_at) t FROM analyses a JOIN games g ON g.uuid = a.uuid WHERE g.white_l = ? OR g.black_l = ?`);

function load(username) {
  const u = username.toLowerCase();
  const stamp = stampStmt.get(u, u);
  const key = `${stamp.n}|${stamp.t}`;
  const hit = cache.get(u);
  if (hit?.key === key) return hit.games;
  const games = rowsStmt.all(u, u).map((r) => {
    const color = r.white_l === u ? 'w' : 'b';
    const myResult = color === 'w' ? r.white_result : r.black_result;
    const result = myResult === 'win' ? 'win' : DRAWS.has(myResult) ? 'draw' : 'loss';
    const review = JSON.parse(r.review);
    return {
      uuid: r.uuid,
      t: r.end_time * 1000,
      timeClass: r.time_class || 'other',
      color,
      result,
      score: result === 'win' ? 1 : result === 'draw' ? 0.5 : 0,
      rating: color === 'w' ? r.white_rating : r.black_rating,
      oppRating: color === 'w' ? r.black_rating : r.white_rating,
      opponent: color === 'w' ? r.black : r.white,
      opening: review.opening?.name || openingName(r.eco_url) || 'Unknown',
      review,
      mine: review.moves.filter((m) => m.color === color),
    };
  });
  cache.set(u, { key, games });
  return games;
}

const decided = (m) => m.wpBefore !== undefined && (m.wpBefore < 10 || m.wpBefore > 97);
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r1 = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);
const pct = (a, b) => (b ? r1((100 * a) / b) : null);
const family = (name) => name.split(':')[0].trim();

function moveStats(moves) {
  const scored = moves.filter((m) => m.cls && m.cls !== 'book');
  const live = scored.filter((m) => !decided(m));
  return {
    moves: scored.length,
    acc: r1(avg(scored.map((m) => moveAccuracy(m.loss)))),
    blunders: live.filter((m) => m.cls === 'blunder').length,
    errors: live.filter((m) => SERIOUS.has(m.cls)).length,
    errorsPer100: pct(live.filter((m) => SERIOUS.has(m.cls)).length, live.length),
  };
}

function gameStats(games) {
  const accs = games.map((g) => g.review.accuracy[g.color]).filter((x) => x !== null);
  return {
    games: games.length,
    score: pct(games.reduce((s, g) => s + g.score, 0), games.length),
    wins: games.filter((g) => g.result === 'win').length,
    draws: games.filter((g) => g.result === 'draw').length,
    losses: games.filter((g) => g.result === 'loss').length,
    acc: r1(avg(accs)),
  };
}

const example = (g, m) => ({ uuid: g.uuid, ply: m.ply, san: m.san, cls: m.cls, opponent: g.opponent, t: g.t });

export function insights(username, { timeClass } = {}) {
  let games = load(username);
  if (timeClass && timeClass !== 'all') games = games.filter((g) => g.timeClass === timeClass);
  if (!games.length) return { games: 0 };
  const allMine = games.flatMap((g) => g.mine.map((m) => ({ g, m })));
  const moves = allMine.map((x) => x.m);
  const live = allMine.filter((x) => x.m.cls && x.m.cls !== 'book' && !decided(x.m));
  const count = (cls) => live.filter((x) => x.m.cls === cls).length;

  const summary = {
    ...gameStats(games),
    moves: moveStats(moves).moves,
    blundersPerGame: r1(count('blunder') / games.length),
    mistakesPerGame: r1(count('mistake') / games.length),
    missesPerGame: r1(count('miss') / games.length),
    inaccuraciesPerGame: r1(count('inaccuracy') / games.length),
  };

  const phases = Object.fromEntries(PHASES.map((p) => [p, moveStats(moves.filter((m) => m.phase === p))]));
  const colors = { w: gameStats(games.filter((g) => g.color === 'w')), b: gameStats(games.filter((g) => g.color === 'b')) };
  const timeClasses = {};
  for (const tc of new Set(games.map((g) => g.timeClass))) timeClasses[tc] = gameStats(games.filter((g) => g.timeClass === tc));

  const pressure = { low: moveStats(moves.filter((m) => m.pressure)), normal: moveStats(moves.filter((m) => !m.pressure)) };

  // Conversion: games where you reached ≥ 85% win chance after your move.
  const winning = games.filter((g) => g.mine.some((m) => m.wpAfter >= 85));
  const blown = winning.filter((g) => g.result !== 'win');
  const conversion = {
    chances: winning.length,
    converted: winning.length - blown.length,
    pct: pct(winning.length - blown.length, winning.length),
    examples: blown.slice(-8).reverse().map((g) => {
      const m = g.mine.filter((x) => x.wpBefore >= 85).sort((a, b) => b.loss - a.loss)[0] || g.mine[0];
      return example(g, m);
    }),
  };

  // Defense: games where you dropped to ≤ 15% and still drew or won.
  const losing = games.filter((g) => g.mine.some((m) => m.wpAfter <= 15));
  const saved = losing.filter((g) => g.result !== 'loss');
  const defense = { chances: losing.length, saved: saved.length, pct: pct(saved.length, losing.length) };

  // Tactics: opportunities you had vs. found, and what you allowed.
  const opps = allMine.filter((x) => x.m.opportunity);
  const byTheme = {};
  for (const { m } of opps) {
    for (const t of m.opportunity.themes.length ? m.opportunity.themes : ['material']) {
      byTheme[t] ??= { total: 0, found: 0 };
      byTheme[t].total++;
      if (m.opportunity.found) byTheme[t].found++;
    }
  }
  const allowed = {};
  for (const { m } of live) {
    if (!SERIOUS.has(m.cls) || !m.allowed) continue;
    for (const t of m.allowed.themes) allowed[t] = (allowed[t] || 0) + 1;
  }
  const tactics = {
    opportunities: opps.length,
    found: opps.filter((x) => x.m.opportunity.found).length,
    pct: pct(opps.filter((x) => x.m.opportunity.found).length, opps.length),
    byTheme,
    allowed,
  };

  // Which pieces you go wrong with (serious errors per 100 moves of that piece).
  const pieces = {};
  for (const p of ['p', 'n', 'b', 'r', 'q', 'k']) {
    const xs = live.filter((x) => x.m.piece === p);
    pieces[p] = { moves: xs.length, errors: xs.filter((x) => SERIOUS.has(x.m.cls)).length, rate: pct(xs.filter((x) => SERIOUS.has(x.m.cls)).length, xs.length) };
  }

  // Strength of opposition.
  const bands = [
    ['Much stronger (+200)', (d) => d >= 200],
    ['Stronger (+50…200)', (d) => d >= 50 && d < 200],
    ['Similar (±50)', (d) => d > -50 && d < 50],
    ['Weaker (−50…200)', (d) => d <= -50 && d > -200],
    ['Much weaker (−200)', (d) => d <= -200],
  ].map(([label, f]) => ({ label, ...gameStats(games.filter((g) => g.rating && g.oppRating && f(g.oppRating - g.rating))) }));

  // Weakness profile (0–100, each with an explicit definition).
  const profile = [
    { key: 'opening', label: 'Opening', score: phases.opening.acc, n: phases.opening.moves, desc: 'Average move accuracy in the opening, after leaving book.' },
    { key: 'middlegame', label: 'Middlegame', score: phases.middlegame.acc, n: phases.middlegame.moves, desc: 'Average move accuracy in the middlegame.' },
    { key: 'endgame', label: 'Endgame', score: phases.endgame.acc, n: phases.endgame.moves, desc: 'Average move accuracy once few pieces remain (≤ 6 minor/major pieces).' },
    { key: 'tactics', label: 'Tactical vision', score: tactics.pct, n: tactics.opportunities, desc: 'Share of winning tactical chances (material or mate) you found.' },
    { key: 'conversion', label: 'Converting wins', score: conversion.pct, n: conversion.chances, desc: 'Share of games you won after reaching an 85%+ win chance.' },
    { key: 'defense', label: 'Defense', score: defense.pct, n: defense.chances, desc: 'Share of games you saved after dropping to a 15% win chance or less.' },
    { key: 'clock', label: 'Under time pressure', score: pressure.low.acc, n: pressure.low.moves, desc: 'Move accuracy when your clock was under 10% of the starting time.' },
  ];

  return { games: games.length, summary, phases, colors, timeClasses, pressure, conversion, defense, tactics, pieces, bands, profile, focus: focusAreas({ games, live, phases, pressure, tactics, conversion, allowed, pieces }) };
}

// Concrete, data-backed things to work on, each with example positions.
function focusAreas({ games, live, phases, pressure, tactics, conversion, allowed, pieces }) {
  const out = [];
  const examplesWhere = (pred, n = 6) =>
    live
      .filter((x) => pred(x.m))
      .sort((a, b) => b.g.t - a.g.t)
      .slice(0, n)
      .map((x) => example(x.g, x.m));

  const topAllowed = Object.entries(allowed).sort((a, b) => b[1] - a[1])[0];
  if (topAllowed && topAllowed[1] >= 3) {
    const [theme, n] = topAllowed;
    out.push({
      severity: n / games.length >= 0.5 ? 'high' : 'medium',
      title: `You often allow: ${THEMES[theme]?.label || theme}`,
      detail: `${n} of your mistakes in ${games.length} games let the opponent play a ${(THEMES[theme]?.label || theme).toLowerCase()}. ${THEMES[theme]?.advice || ''}`,
      filter: { allowed: theme },
      examples: examplesWhere((m) => SERIOUS.has(m.cls) && m.allowed?.themes.includes(theme)),
    });
  }

  if (tactics.opportunities >= 5 && tactics.pct < 65) {
    const worst = Object.entries(tactics.byTheme).filter(([, v]) => v.total >= 3).sort((a, b) => a[1].found / a[1].total - b[1].found / b[1].total)[0];
    out.push({
      severity: tactics.pct < 45 ? 'high' : 'medium',
      title: 'Missed tactical chances',
      detail: `You found ${tactics.found} of ${tactics.opportunities} winning tactics (${tactics.pct}%).${worst ? ` Weakest: ${THEMES[worst[0]]?.label || worst[0]} (${worst[1].found}/${worst[1].total}).` : ''} ${THEMES[worst?.[0] || 'material'].advice}`,
      filter: { missed: 1 },
      examples: examplesWhere((m) => m.opportunity && !m.opportunity.found),
    });
  }

  const ranked = PHASES.filter((p) => phases[p].moves >= 30).sort((a, b) => phases[a].acc - phases[b].acc);
  if (ranked.length >= 2 && phases[ranked.at(-1)].acc - phases[ranked[0]].acc >= 4) {
    const p = ranked[0];
    out.push({
      severity: phases[ranked.at(-1)].acc - phases[p].acc >= 8 ? 'high' : 'medium',
      title: `Your ${p} is your weakest phase`,
      detail: `${phases[p].acc}% accuracy in the ${p} vs ${phases[ranked.at(-1)].acc}% in the ${ranked.at(-1)}; ${phases[p].errorsPer100} serious errors per 100 moves.`,
      filter: { phase: p },
      examples: examplesWhere((m) => m.phase === p && SERIOUS.has(m.cls)),
    });
  }

  if (pressure.low.moves >= 20 && pressure.normal.acc - pressure.low.acc >= 6) {
    out.push({
      severity: pressure.normal.acc - pressure.low.acc >= 12 ? 'high' : 'medium',
      title: 'Your play collapses in time trouble',
      detail: `Accuracy drops from ${pressure.normal.acc}% to ${pressure.low.acc}% when your clock is low (${pressure.low.errorsPer100} vs ${pressure.normal.errorsPer100} serious errors per 100 moves). Spend less time early, or pre-plan simple moves.`,
      filter: { pressure: 1 },
      examples: examplesWhere((m) => m.pressure && SERIOUS.has(m.cls)),
    });
  }

  if (conversion.chances >= 4 && conversion.pct < 80) {
    out.push({
      severity: conversion.pct < 60 ? 'high' : 'medium',
      title: 'Winning positions slip away',
      detail: `You won ${conversion.converted} of ${conversion.chances} games where you reached an 85%+ win chance. When winning, prefer simple safe moves and trade pieces.`,
      examples: conversion.examples,
    });
  }

  const pieceRanks = Object.entries(pieces).filter(([, v]) => v.moves >= 40).sort((a, b) => b[1].rate - a[1].rate);
  if (pieceRanks.length >= 3) {
    const [p, v] = pieceRanks[0];
    const avgRate = avg(pieceRanks.map(([, x]) => x.rate));
    if (v.rate >= avgRate * 1.5 && v.errors >= 4) {
      out.push({
        severity: 'low',
        title: `Most errors come with your ${PIECE_NAME[p]}`,
        detail: `${v.rate} serious errors per 100 ${PIECE_NAME[p]} moves, vs ${r1(avgRate)} on average for your pieces.`,
        filter: { piece: p },
        examples: examplesWhere((m) => m.piece === p && SERIOUS.has(m.cls)),
      });
    }
  }
  const order = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

export function openings(username, { timeClass } = {}) {
  let games = load(username);
  if (timeClass && timeClass !== 'all') games = games.filter((g) => g.timeClass === timeClass);
  const groups = new Map();
  for (const g of games) {
    const key = `${g.color}|${family(g.opening)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(g);
  }
  return [...groups.entries()]
    .map(([key, gs]) => {
      const [color, name] = key.split('|');
      const evalAfter = gs
        .map((g) => g.mine.filter((m) => m.ply <= 24 && m.wpAfter !== undefined).at(-1)?.wpAfter)
        .filter((x) => x !== undefined);
      const devs = gs
        .map((g) => g.review.opening?.deviation)
        .filter((d) => d && d.color === color)
        .map((d) => d.san);
      const topDev = Object.entries(devs.reduce((acc, s) => ((acc[s] = (acc[s] || 0) + 1), acc), {})).sort((a, b) => b[1] - a[1])[0];
      const variations = Object.entries(gs.reduce((acc, g) => ((acc[g.opening] = (acc[g.opening] || 0) + 1), acc), {}))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);
      return {
        color,
        name,
        ...gameStats(gs),
        openingAcc: r1(avg(gs.map((g) => g.review.phaseAcc?.[g.color]?.opening).filter((x) => x !== null && x !== undefined))),
        winChanceAfter: r1(avg(evalAfter)),
        commonDeviation: topDev ? { san: topDev[0], n: topDev[1] } : null,
        variations,
        recent: gs.slice(-5).reverse().map((g) => ({ uuid: g.uuid, result: g.result, opponent: g.opponent, t: g.t })),
      };
    })
    .sort((a, b) => b.games - a.games);
}

export function progress(username, { timeClass } = {}) {
  let games = load(username);
  if (timeClass && timeClass !== 'all') games = games.filter((g) => g.timeClass === timeClass);
  if (!games.length) return { buckets: [] };
  const span = games.at(-1).t - games[0].t;
  const weekly = span < 1000 * 60 * 60 * 24 * 150;
  const keyOf = (t) => {
    const d = new Date(t);
    if (!weekly) return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
    return monday.toISOString().slice(0, 10);
  };
  const buckets = new Map();
  for (const g of games) {
    const k = keyOf(g.t);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(g);
  }
  return {
    unit: weekly ? 'week' : 'month',
    buckets: [...buckets.entries()].map(([label, gs]) => {
      const mine = gs.flatMap((g) => g.mine).filter((m) => m.cls && m.cls !== 'book' && !decided(m));
      const opps = gs.flatMap((g) => g.mine).filter((m) => m.opportunity);
      return {
        label,
        games: gs.length,
        acc: r1(avg(gs.map((g) => g.review.accuracy[g.color]).filter((x) => x !== null))),
        blundersPerGame: r1(mine.filter((m) => m.cls === 'blunder').length / gs.length),
        errorsPerGame: r1(mine.filter((m) => SERIOUS.has(m.cls)).length / gs.length),
        tacticsPct: opps.length >= 3 ? pct(opps.filter((m) => m.opportunity.found).length, opps.length) : null,
        score: pct(gs.reduce((s, g) => s + g.score, 0), gs.length),
        rating: Math.round(avg(gs.map((g) => g.rating).filter(Boolean)) || 0) || null,
      };
    }),
  };
}

// Every serious error you made, newest first, filterable.
export function mistakes(username, f = {}) {
  let games = load(username);
  if (f.timeClass && f.timeClass !== 'all') games = games.filter((g) => g.timeClass === f.timeClass);
  const out = [];
  for (const g of games) {
    for (const m of g.mine) {
      const isMiss = m.opportunity && !m.opportunity.found;
      if (!SERIOUS.has(m.cls) && !isMiss) continue;
      if (decided(m)) continue;
      if (f.phase && m.phase !== f.phase) continue;
      if (f.cls && m.cls !== f.cls) continue;
      if (f.piece && m.piece !== f.piece) continue;
      if (f.pressure && !m.pressure) continue;
      if (f.missed && !isMiss) continue;
      if (f.allowed && !m.allowed?.themes.includes(f.allowed)) continue;
      if (f.theme && !(m.allowed?.themes.includes(f.theme) || m.opportunity?.themes.includes(f.theme))) continue;
      out.push({
        ...example(g, m),
        bestSan: m.bestSan,
        loss: m.loss,
        phase: m.phase,
        pressure: m.pressure,
        piece: m.piece,
        allowed: m.allowed?.themes || [],
        missed: isMiss ? m.opportunity.themes : [],
        note: m.allowed?.notes?.[0] || m.opportunity?.notes?.[0] || null,
        timeClass: g.timeClass,
        color: g.color,
      });
    }
  }
  out.sort((a, b) => b.t - a.t || b.loss - a.loss);
  return { total: out.length, items: out.slice(0, Number(f.limit) || 200) };
}
