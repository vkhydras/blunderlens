// WebSocket client for the local Stockfish server.
let ws = null;
let openPromise = null;
const listeners = new Set();
let nextId = 1;

function connect() {
  if (ws && ws.readyState <= 1) return openPromise;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  openPromise = new Promise((resolve, reject) => {
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error('Cannot reach the Stockfish server. Is `npm run dev` running?'));
  });
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    listeners.forEach((fn) => fn(msg));
  };
  ws.onclose = () => (ws = null);
  return openPromise;
}

async function send(msg) {
  (await connect()).send(JSON.stringify(msg));
}

function listen(reqId, fn) {
  const l = (msg) => msg.reqId === reqId && fn(msg);
  listeners.add(l);
  return () => listeners.delete(l);
}

// Full-game review. Stored reviews come back immediately.
export function requestReview(uuid, { depth, force = false }, { onProgress, onDone, onError }) {
  const reqId = nextId++;
  const off = listen(reqId, (msg) => {
    if (msg.type === 'reviewProgress') onProgress(msg);
    else if (msg.type === 'reviewDone') (off(), onDone(msg));
    else if (msg.type === 'reviewError') (off(), onError(new Error(msg.error)));
  });
  send({ type: 'review', reqId, uuid, depth, force }).catch((e) => (off(), onError(e)));
  return () => {
    off();
    send({ type: 'cancelReview', reqId }).catch(() => {});
  };
}

// Live, deepening analysis of one position.
export function analyzeLive(fen, { depth = 22, multipv = 3 } = {}, onUpdate) {
  const reqId = nextId++;
  const off = listen(reqId, (msg) => {
    if (msg.type === 'liveInfo' || msg.type === 'liveDone') onUpdate(msg.result, msg.type === 'liveDone');
  });
  send({ type: 'live', reqId, fen, depth, multipv }).catch(() => {});
  return off;
}

// One-off evaluation of a position (used to check "retry" attempts).
// priority 1 queues behind interactive work (for background refinement).
export function evaluate(fen, depth = 16, multipv = 1, priority = 0) {
  const reqId = nextId++;
  return new Promise((resolve, reject) => {
    const off = listen(reqId, (msg) => msg.type === 'evaluateResult' && (off(), resolve(msg.result)));
    send({ type: 'evaluate', reqId, fen, depth, multipv, priority }).catch(reject);
  });
}
