/**
 * WebSocket room stress test (non-mutating; run against a LOCAL server with
 * LOADTEST=1). Connects N clients to one room, measures connect time, then fires
 * reactions and measures broadcast fan-out latency and server stability.
 *
 * Run:  TARGET=ws://localhost:4466 ROOM=r1 N=100 node tools/wstest.mjs
 */
import { WebSocket } from 'ws';

const TARGET = process.env.TARGET || 'ws://localhost:4466';
const ROOM = process.env.ROOM || 'loadroom';
const N = Number(process.env.N || 100);

const sockets = [];
let presenceFrames = 0;
let reactFrames = 0;

function connectOne(i) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${TARGET}/ws?token=lt:${i}&instanceId=${ROOM}`);
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.type === 'presence') presenceFrames += 1;
      else if (m.type === 'react') { reactFrames += 1; if (ws._reactT0) ws._lastReactMs = performance.now() - ws._reactT0; }
    });
    ws.on('open', () => resolve(ws));
    ws.on('error', () => resolve(null));
  });
}

(async () => {
  console.log(`\nWS ${TARGET}/ws  room=${ROOM}  N=${N}\n`);
  const t0 = performance.now();
  // connect in small batches so we do not open all sockets in the exact same tick
  for (let i = 0; i < N; i += 25) {
    const batch = [];
    for (let j = i; j < Math.min(i + 25, N); j += 1) batch.push(connectOne(j));
    const got = await Promise.all(batch);
    for (const ws of got) if (ws) sockets.push(ws);
  }
  const connectMs = performance.now() - t0;
  console.log(`connected ${sockets.length}/${N} in ${connectMs.toFixed(0)}ms  (${(sockets.length / (connectMs / 1000)).toFixed(0)}/s)`);
  await new Promise((r) => setTimeout(r, 500));
  console.log(`presence frames received so far: ${presenceFrames}  (mass-join fan-out)`);

  // Reaction fan-out: one client reacts; time until all N receive it.
  const reactLat = [];
  for (let k = 0; k < 10; k += 1) {
    reactFrames = 0;
    const sender = sockets[k % sockets.length];
    const start = performance.now();
    for (const ws of sockets) ws._reactT0 = start;
    sender.send(JSON.stringify({ type: 'react', emoji: '🔥' }));
    await new Promise((r) => setTimeout(r, 300));
    reactLat.push({ delivered: reactFrames, expected: sockets.length });
  }
  const avgDelivered = (reactLat.reduce((s, r) => s + r.delivered, 0) / reactLat.length).toFixed(0);
  const worstLat = Math.max(...sockets.map((s) => s._lastReactMs || 0));
  console.log(`reaction fan-out: avg ${avgDelivered}/${sockets.length} clients received each react; worst per-client delivery ${worstLat.toFixed(0)}ms`);

  // Disconnect storm — each close broadcasts presence to the room.
  const dt0 = performance.now();
  for (const ws of sockets) ws.close();
  await new Promise((r) => setTimeout(r, 1000));
  console.log(`closed ${sockets.length} sockets in ~${(performance.now() - dt0).toFixed(0)}ms; total presence frames: ${presenceFrames}\n`);
  process.exit(0);
})();
