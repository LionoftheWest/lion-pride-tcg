// node --test scripts/render-wait.test.mjs  (no Edge, no network). Headless Edge sometimes returns before it
// writes the screenshot (2026-10-20). shootHtml must return only the complete NEW file, never an old one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shootHtml } from '../src/render.js';

const fast = { tries: 40, ms: 25 };
const dir = () => mkdtempSync(join(tmpdir(), 'render-wait-'));
const argOf = (args, name) => args.find((a) => a.startsWith(`--${name}=`)).slice(name.length + 3);

/** A fake Edge that returns at once and writes the screenshot later (or never). */
function lateEdge(bytes, delayMs, calls = []) {
  return async (_exe, args) => {
    calls.push(args);
    if (bytes != null) setTimeout(() => writeFileSync(argOf(args, 'screenshot'), bytes), delayMs);
  };
}

test('a screenshot that Edge writes after it returns is waited for', async () => {
  const out = join(dir(), 'face.png');
  await shootHtml('<p>x</p>', out, 1, '_tmp_c1_common.html', { exec: lateEdge('NEW-FACE', 200), ...fast });
  assert.equal(readFileSync(out, 'utf8'), 'NEW-FACE');
});

test('an old PNG from an earlier render is never returned as the new one', async () => {
  const out = join(dir(), 'face.png');
  writeFileSync(out, 'OLD-TEXT-MASK');
  await shootHtml('<p>x</p>', out, 1, '_tmp_c1_common.html', { exec: lateEdge('NEW-FACE', 200), ...fast });
  assert.equal(readFileSync(out, 'utf8'), 'NEW-FACE');
});

test('a screenshot that never comes is an error, not a silent return', async () => {
  const out = join(dir(), 'face.png');
  await assert.rejects(
    shootHtml('<p>x</p>', out, 1, '_tmp_c1_common.html', { exec: lateEdge(null, 0), ...fast }),
    /no screenshot/,
  );
});

test('two renders of one card use their own HTML file and their own Edge profile, and both are removed', async () => {
  const d = dir();
  const calls = [];
  await Promise.all([
    shootHtml('<p>face</p>', join(d, 'face.png'), 1, '_tmp_c1_common.html', { exec: lateEdge('A', 50, calls), ...fast }),
    shootHtml('<p>mask</p>', join(d, 'mask.png'), 1, '_tmp_c1_common.html', { exec: lateEdge('B', 50, calls), ...fast }),
  ]);
  const pages = calls.map((a) => a[a.length - 1]);
  const profiles = calls.map((a) => argOf(a, 'user-data-dir'));
  assert.notEqual(pages[0], pages[1]);
  assert.notEqual(profiles[0], profiles[1]);
  assert.equal(readFileSync(join(d, 'face.png'), 'utf8'), 'A');
  assert.equal(readFileSync(join(d, 'mask.png'), 'utf8'), 'B');
  assert.deepEqual(readdirSync(d).filter((f) => f.endsWith('.html')), []);
  for (const p of profiles) assert.equal(existsSync(p), false);
});
