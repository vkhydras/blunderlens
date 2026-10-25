// Pool of Stockfish processes with a two-level priority queue (interactive
// reviews jump ahead of background batch work) and a SQLite position cache.
import { Engine } from './engine.js';
import { q } from './db.js';

const PV_KEEP = 12;

export class Pool {
  constructor(path, { size, threads }) {
    this.path = path;
    this.size = size;
    this.threads = threads;
    this.queues = [[], []]; // [interactive, batch]
    this.memo = new Map();
  }

  async init() {
    this.engines = await Promise.all(Array.from({ length: this.size }, () => new Engine(this.path, { threads: this.threads, hash: 128 }).init()));
    this.engineName = this.engines[0].name || 'Stockfish';
    return this;
  }

  // Resolves with { depth, lines, bestmove } or null if the job was cancelled.
  evaluate(fen, { depth, multipv = 1, priority = 0, job = null }) {
    const key = `${fen}|${depth}|${multipv}`;
    if (this.memo.has(key)) return Promise.resolve(this.memo.get(key));
    const row = q.getEval.get(fen, this.engineName, depth, multipv);
    if (row) {
      const r = JSON.parse(row.result);
      r.lines = r.lines.slice(0, multipv);
      return Promise.resolve(r);
    }
    return new Promise((resolve) => {
      this.queues[priority].push({ fen, depth, multipv, job, resolve, key });
      this.pump();
    });
  }

  pending(priority) {
    return this.queues[priority].length;
  }

  pump() {
    for (const engine of this.engines) {
      if (engine.busy) continue;
      const task = this.next();
      if (!task) return;
      engine.busy = true;
      engine.analyze(task.fen, { depth: task.depth, multipv: task.multipv }).then((r) => {
        r.lines = r.lines.map((l) => ({ ...l, pv: l.pv.slice(0, PV_KEEP) }));
        q.putEval.run(task.fen, this.engineName, task.depth, task.multipv, JSON.stringify(r));
        if (this.memo.size > 20000) this.memo.delete(this.memo.keys().next().value);
        this.memo.set(task.key, r);
        task.resolve(r);
        this.pump();
      });
    }
  }

  next() {
    for (const queue of this.queues) {
      let task;
      while ((task = queue.shift())) {
        if (!task.job?.cancelled) return task;
        task.resolve(null);
      }
    }
    return null;
  }

  quit() {
    this.engines.forEach((e) => e.quit());
  }
}
