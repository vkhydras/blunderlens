// Thin UCI wrapper around a native Stockfish process.
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { positionProblem } from '../shared/legal.js';

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
    this.proc.on('exit', (code) => {
      this.emit('exit', code);
      if (this.quitting) return;
      // Unexpected exit: answer whoever is waiting and start a fresh process,
      // so one bad position can't leave this engine "busy" forever.
      // Crashing again and again (e.g. killed for memory) backs off a little.
      const now = Date.now();
      this.crashes = (this.crashes || []).filter((t) => now - t < 60000).concat(now);
      const delay = Math.min(10000, 500 * 2 ** (this.crashes.length - 1));
      console.error(`Stockfish exited (${code}); restarting in ${delay} ms`);
      const waiting = this.waiters;
      this.waiters = [];
      waiting.forEach((w) => w.resolve('bestmove (none)'));
      this.buffer = '';
      this.restarting = new Promise((r) => setTimeout(r, delay)).then(() => this.init()).finally(() => (this.restarting = null));
    });
    this.proc.stdin.on('error', () => {}); // EPIPE while the process is exiting
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
    if (this.proc.exitCode === null && !this.proc.killed) this.proc.stdin.write(cmd + '\n');
  }

  onLine(line) {
    this.lastLine = Date.now();
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
    const problem = positionProblem(fen);
    if (problem) {
      this.busy = false;
      return { depth: 0, lines: [], bestmove: null, error: problem };
    }
    this.busy = true;
    if (this.restarting) await this.restarting;
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
    // Watchdog: a searching engine prints something every few hundred ms. If it
    // goes silent (stuck, swapped out, half-dead), kill it; the exit handler
    // answers this search and starts a fresh process.
    this.lastLine = Date.now();
    const watchdog = setInterval(() => {
      if (Date.now() - this.lastLine > 60000) {
        console.error('Stockfish silent for 60 s; killing it');
        this.proc.kill('SIGKILL');
      }
    }, 5000);
    const done = await this.waitFor((l) => l.startsWith('bestmove'));
    clearInterval(watchdog);
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
    this.quitting = true;
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
