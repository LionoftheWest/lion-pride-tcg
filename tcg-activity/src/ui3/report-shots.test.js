// UI-40 review-2: the pure parts of the screenshots and the device chip (report-shots.js). node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shotsReducer, shotsBusy, shotsToUpload, shotsFull, countText, sendState, fitSize, encodeSteps, shrinkTo, uploadOutcome,
  deviceChip, factRows, SHOT_TEXT, SLOTS, MAX_SIDE, PICK_MAX_BYTES } from './report-shots.js';
import { REASON } from './report.js';
import { deviceFacts } from '../device-facts.js';

const run = (evs, list = []) => evs.reduce((l, e) => shotsReducer(l, e), list);

test('UI-40 shrink sizing: fits the longest side, keeps the shape, never upscales, whole pixels', () => {
  assert.equal(MAX_SIDE, 1920);
  assert.deepEqual(fitSize(3840, 2160), { w: 1920, h: 1080 });
  assert.deepEqual(fitSize(1290, 2796), { w: 886, h: 1920 });      // an iPhone 15 Pro Max photo, portrait
  assert.deepEqual(fitSize(860, 1864), { w: 860, h: 1864 });       // a 430x932 capture at pixel ratio 2: no change
  assert.deepEqual(fitSize(1000, 500, 400), { w: 400, h: 200 });
  assert.deepEqual(fitSize(0, 500), { w: 0, h: 0 });
  assert.deepEqual(fitSize(10000, 1), { w: 1920, h: 1 });          // never 0
});

test('UI-40 encode steps: four qualities at each size, sizes go down by 3/4 to about a quarter', () => {
  const s = encodeSteps(1920, 1080);
  assert.deepEqual(s.slice(0, 4).map((x) => x.q), [0.85, 0.7, 0.55, 0.4]);
  assert.deepEqual([s[0].w, s[0].h], [1920, 1080]);
  assert.deepEqual([s[4].w, s[4].h], [1440, 810]);
  assert.ok(s.at(-1).w >= 1920 * 0.24 && s.at(-1).w < 1920 * 0.33, String(s.at(-1).w));
  assert.equal(s.length % 4, 0);
});

// A fake encoder: bytes = pixels x quality x k (a WebP is about that shape).
const fake = (k, calls = []) => async (w, h, q) => { calls.push([w, h, q]); return { size: Math.round(w * h * q * k), type: 'image/webp' }; };

test('UI-40 shrinkTo: the first try that fits the server limit wins; it shrinks before it gives up', async () => {
  const calls = [];
  const b = await shrinkTo(fake(1, calls), 3840, 2160, 1572864);   // 1.5 MB = balance report_shots.max_bytes
  assert.ok(b.size <= 1572864);
  assert.deepEqual(calls[0], [1920, 1080, 0.85]);                    // sized to MAX_SIDE first
  assert.deepEqual(calls.at(-1), [1920, 1080, 0.7]);                 // 1920*1080*0.85 = 1.76 MB too big; 0.7 = 1.45 MB fits
  const c2 = [];
  const b2 = await shrinkTo(fake(4, c2), 1920, 1080, 1572864);
  assert.ok(b2.size <= 1572864 && c2.at(-1)[0] < 1920, 'a smaller size when no quality fits');
  assert.equal(await shrinkTo(fake(1e6), 1920, 1080, 1000), null, 'null when even the smallest try is too large');
});

test('UI-40 shrinkTo: no known limit takes the first try (the server answers 413 with max_bytes)', async () => {
  const calls = [];
  const b = await shrinkTo(fake(10, calls), 1920, 1080, null);
  assert.equal(calls.length, 1);
  assert.equal(b.size, Math.round(1920 * 1080 * 0.85 * 10));
});

test('UI-40 upload outcome: done, big (encode again under max_bytes), failed', () => {
  assert.equal(uploadOutcome(200, { ok: true, n: 1 }), 'done');
  assert.equal(uploadOutcome(200, { ok: false }), 'failed');
  assert.equal(uploadOutcome(413, { ok: false, error: 'big', max_bytes: 1572864 }), 'big');
  assert.equal(uploadOutcome(413, { ok: false, error: 'big' }), 'failed');   // the read limit answer has no max_bytes
  for (const [st, b] of [[409, { error: 'full' }], [415, { error: 'type' }], [429, { error: 'slow down' }], [502, { error: 'upload' }], [0, null]]) assert.equal(uploadOutcome(st, b), 'failed');
});

test('UI-40 slots: add up to the limit, prepare, upload, done', () => {
  let l = run([{ type: 'add', id: 'a', src: 'f1' }, { type: 'add', id: 'b' }, { type: 'add', id: 'c' }, { type: 'add', id: 'd' }]);
  assert.equal(SLOTS, 3);
  assert.deepEqual(l.map((s) => s.id), ['a', 'b', 'c'], 'no fourth slot');
  assert.ok(shotsFull(l) && shotsBusy(l));
  assert.equal(run([{ type: 'add', id: 'z', max: 1 }, { type: 'add', id: 'y', max: 1 }]).length, 1, 'the max of the event');
  l = run([{ type: 'progress', id: 'a', value: 2 }], l);
  assert.equal(l[0].progress, 1, 'progress is 0..1');
  l = run([{ type: 'ready', id: 'a', blob: 'B', mime: 'image/webp', url: 'blob:x' }], l);
  assert.deepEqual([l[0].status, l[0].mime, l[0].url], ['ready', 'image/webp', 'blob:x']);
  assert.deepEqual(shotsToUpload(l).map((s) => s.id), ['a']);
  l = run([{ type: 'upload', id: 'a' }], l);
  assert.deepEqual([l[0].status, l[0].progress], ['uploading', 0]);
  l = run([{ type: 'done', id: 'a' }], l);
  assert.equal(l[0].status, 'done');
});

test('UI-40 slots: a failure keeps its slot and its stage; Try again goes back to the step that failed', () => {
  let l = run([{ type: 'add', id: 'a' }, { type: 'fail', id: 'a' }]);
  assert.deepEqual([l[0].status, l[0].stage], ['failed', 'prepare']);
  assert.ok(!shotsBusy(l) && !shotsToUpload(l).length, 'a failed prepare does not block Send and is not uploaded');
  l = run([{ type: 'retry', id: 'a' }], l);
  assert.equal(l[0].status, 'preparing');
  l = run([{ type: 'ready', id: 'a', blob: 1 }, { type: 'upload', id: 'a' }, { type: 'fail', id: 'a' }], l);
  assert.deepEqual([l[0].status, l[0].stage], ['failed', 'upload']);
  assert.deepEqual(shotsToUpload(l).map((s) => s.id), ['a'], 'Send uploads a failed upload again');
  assert.deepEqual(run([{ type: 'reencode', id: 'a' }], l).map((s) => [s.status, s.stage]), [['preparing', undefined]], '413: encode again');
  l = run([{ type: 'retry', id: 'a' }], l);
  assert.equal(l[0].status, 'ready');
  assert.equal(shotsReducer(l, { type: 'reencode', id: 'a' }), l, 'reencode only after a failed upload');
});

test('UI-40 slots: transitions that are not allowed change nothing (the same list)', () => {
  const l = run([{ type: 'add', id: 'a' }]);
  for (const ev of [{ type: 'upload', id: 'a' }, { type: 'done', id: 'a' }, { type: 'retry', id: 'a' }, { type: 'add', id: 'a' }, { type: 'ready', id: 'nope' }, { type: 'bogus', id: 'a' }]) {
    assert.equal(shotsReducer(l, ev), l, JSON.stringify(ev));
  }
  const up = run([{ type: 'ready', id: 'a', blob: 1 }, { type: 'upload', id: 'a' }], l);
  assert.equal(shotsReducer(up, { type: 'remove', id: 'a' }), up, 'no remove while it uploads');
  const done = run([{ type: 'done', id: 'a' }], up);
  assert.equal(shotsReducer(done, { type: 'remove', id: 'a' }), done, 'no remove after the server stored it');
  assert.deepEqual(shotsReducer(l, { type: 'remove', id: 'a' }), [], 'remove while it prepares');
});

test('UI-40 count: "n / 3", and "3 / 3 · Limit" at the limit', () => {
  assert.equal(countText([]), '0 / 3');
  assert.equal(countText([{}, {}]), '2 / 3');
  assert.equal(countText([{}, {}, {}]), '3 / 3 · Limit');
  assert.equal(countText([{}], 1), '1 / 1 · Limit');
});

test('UI-40 Send row: grey while an image works, with "Wait for the upload to finish"; an error takes the line', () => {
  const working = [{ status: 'uploading' }], ready = [{ status: 'ready' }];
  assert.deepEqual(sendState({ text: 'hello there', shots: working }), { canSend: false, line: { kind: 'reason', text: SHOT_TEXT.wait } });
  assert.deepEqual(sendState({ text: 'hello there', shots: [{ status: 'preparing' }] }).line.text, 'Wait for the upload to finish');
  assert.deepEqual(sendState({ text: 'hello there', shots: ready }), { canSend: true, line: null });
  assert.deepEqual(sendState({ text: 'hi', shots: ready }), { canSend: false, line: { kind: 'reason', text: REASON } });
  assert.deepEqual(sendState({ text: 'hello there', shots: ready, error: SHOT_TEXT.tooLarge }), { canSend: true, line: { kind: 'error', text: 'This image is too large. Choose a smaller one.' } });
  assert.deepEqual(sendState({ text: 'hello there', sending: true, shots: working }), { canSend: false, line: null }, 'while it sends: the busy button, no reason');
  assert.equal(sendState({ text: 'hello there', shots: [{ status: 'failed', stage: 'upload' }] }).canSend, true);
});

test('UI-40 the approved texts and the 20 MB picker limit', () => {
  assert.equal(PICK_MAX_BYTES, 20 * 1024 * 1024);
  assert.equal(SHOT_TEXT.privacy, 'Screenshots are only seen by the team');
  assert.equal(SHOT_TEXT.add, 'Add this screen');
  assert.equal(SHOT_TEXT.upload, 'Upload an image');
  assert.equal(SHOT_TEXT.failed, 'The screenshot did not upload. Try again.');
});

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';   // device-facts.test.js
const WIN_APP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9180 Chrome/128.0.6613.186 Electron/32.2.7 Safari/537.36';

test('UI-40 device chip: "iPhone · Discord app", "iPad · Discord app", "Windows 11 · Desktop app", with the icon', () => {
  const ip = deviceFacts({ userAgent: IPHONE, maxTouchPoints: 5, innerWidth: 430, innerHeight: 932, devicePixelRatio: 3, sdkPlatform: 'mobile', layout: 'compact-port' });
  assert.deepEqual(deviceChip(ip), { icon: 'smartphone', label: 'iPhone · Discord app' });
  assert.deepEqual(deviceChip({ device: 'Tablet', os: 'iPadOS 18', app: 'Mobile app' }), { icon: 'tablet', label: 'iPad · Discord app' });
  const win = deviceFacts({ userAgent: WIN_APP, platformVersion: '15.0.0', innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1, sdkPlatform: 'desktop', layout: 'expanded' });
  assert.deepEqual(deviceChip(win), { icon: 'laptop', label: 'Windows 11 · Desktop app' });
  assert.deepEqual(deviceChip({ device: 'Phone', os: 'Android 15', app: 'Mobile app' }).label, 'Android phone · Discord app');
  assert.deepEqual(deviceChip({ device: 'Desktop', app: 'Browser' }).label, 'Desktop · Browser');
  assert.deepEqual(deviceChip({}).label, '', 'no facts: no chip');
});

test('UI-40 facts popover: the 6 facts in the approved order and words', () => {
  const ip = deviceFacts({ userAgent: IPHONE, maxTouchPoints: 5, innerWidth: 430, innerHeight: 932, devicePixelRatio: 3, sdkPlatform: 'mobile', layout: 'compact-port' });
  assert.deepEqual(factRows(ip), [['Discord app', 'Mobile app'], ['Device', 'Phone'], ['System', 'iOS 18'], ['Browser engine', 'WebKit'], ['Layout', 'Compact · portrait'], ['Pixel ratio', '3']]);
  assert.deepEqual(factRows({ layout: 'expanded short', dpr: '2.6x' }), [['Layout', 'Expanded · short'], ['Pixel ratio', '2.6']]);
  assert.deepEqual(factRows({}), []);
});

test('UI-40 capture: a wrapping row gets half a pixel more width in the copy (the Home stats rounding), other rows do not', async () => {
  const { widenWrapRows } = await import('./report-capture.js');
  const svg = '<div style="display: flex; flex-flow: wrap; min-width: auto; width: 267.109px;"></div><i style="flex-flow: nowrap; width: 10px;"></i><u style="flex-wrap: wrap; width: 5px;"></u><s style="display: block; width: 7px;"></s>';
  const out = decodeURIComponent(widenWrapRows(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`).split(',').slice(1).join(','));
  assert.match(out, /min-width: auto; width: 267\.609px/);
  assert.match(out, /flex-flow: nowrap; width: 10px/);
  assert.match(out, /flex-wrap: wrap; width: 5\.5px/);
  assert.match(out, /display: block; width: 7px/);
});
