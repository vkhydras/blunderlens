// Thin UCI wrapper around a native Stockfish process.
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

export class Engine extends EventEmitter {
  constructor(path, { threads = 2, hash = 64 } = {}) {
    super();
    this.path = path;
    this.threads = threads;
    this.hash = hash;
    this.busy = false;
    this.buffer = '';
    this.waiters = [];
  }

  async init() {
    this.proc = spawn(this.path, [], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.proc.on('exit', (code) => this.emit('exit', code));
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => {
      this.buffer += chunk;
      let nl;
      while ((nl = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (line) this.onLine(line);
      }
    });
    const onId = (l) => l.startsWith('id name ') && (this.name = l.slice(8));
    this.on('line', onId);
    this.send('uci');
    await this.waitFor((l) => l === 'uciok');
    this.off('line', onId);
    this.send(`setoption name Threads value ${this.threads}`);
    this.send(`setoption name Hash value ${this.hash}`);
    await this.ready();
    return this;
  }

  send(cmd) {
    this.proc.stdin.write(cmd + '\n');
  }

  onLine(line) {
    this.emit('line', line);
    this.waiters = this.waiters.filter((w) => {
      if (!w.match(line)) return true;
      w.resolve(line);
      return false;
    });
  }

  waitFor(match) {
    return new Promise((resolve) => this.waiters.push({ match, resolve }));
  }

  async ready() {
    this.send('isready');
    await this.waitFor((l) => l === 'readyok');
  }

  async newGame() {
    this.send('ucinewgame');
    await this.ready();
  }

  // Searches `fen` and resolves with lines scored from White's point of view.
  // `onInfo` receives intermediate results whenever a full depth completes.
  async analyze(fen, { depth = 16, multipv = 1, movetime, onInfo } = {}) {
    this.busy = true;
    const whiteToMove = fen.split(' ')[1] === 'w';
    const lines = new Map();
    let lastDepth = 0;

    const onLine = (line) => {
      if (!line.startsWith('info ') || !line.includes(' pv ')) return;
      const info = parseInfo(line, whiteToMove);
      if (!info) return;
      if (info.multipv === 1 && info.depth > lastDepth && lines.size && onInfo) {
        onInfo(snapshot(lines, lastDepth));
      }
      if (info.multipv === 1) lastDepth = info.depth;
      lines.set(info.multipv, info);
    };

    this.on('line', onLine);
    this.send(`setoption name MultiPV value ${multipv}`);
    this.send(`position fen ${fen}`);
    this.send(movetime ? `go movetime ${movetime}` : `go depth ${depth}`);
    const done = await this.waitFor((l) => l.startsWith('bestmove'));
    this.off('line', onLine);
    this.busy = false;

    const bestmove = done.split(' ')[1];
    const result = snapshot(lines, lastDepth);
    result.bestmove = bestmove === '(none)' ? null : bestmove;
    return result;
  }

  stop() {
    this.send('stop');
  }

  quit() {
    try {
      this.send('quit');
    } catch {}
    setTimeout(() => this.proc.kill(), 500);
  }
}

function snapshot(lines, depth) {
  const sorted = [...lines.values()]
    .filter((l) => l.multipv <= lines.size)
    .sort((a, b) => a.multipv - b.multipv)
    .map(({ cp, mate, pv, depth }) => ({ cp, mate, pv, depth }));
  return { depth, lines: sorted };
}

function parseInfo(line, whiteToMove) {
  const t = line.split(' ');
  if (t.includes('lowerbound') || t.includes('upperbound')) return null;
  const at = (k) => t.indexOf(k);
  const sign = whiteToMove ? 1 : -1;
  const info = {
    depth: Number(t[at('depth') + 1]),
    multipv: at('multipv') >= 0 ? Number(t[at('multipv') + 1]) : 1,
    cp: null,
    mate: null,
    pv: t.slice(at('pv') + 1),
  };
  const s = at('score');
  if (s < 0) return null;
  if (t[s + 1] === 'cp') info.cp = sign * Number(t[s + 2]);
  else info.mate = sign * Number(t[s + 2]);
  return info;
}
