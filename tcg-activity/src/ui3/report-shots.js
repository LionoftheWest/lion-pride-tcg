// UI-40 review-2 (lion-pride-tcg-design UI-40/approved, approval 2026-10-11): the pure parts of the screenshots and the
// device chip. No DOM here, so every rule is unit-tested (report-shots.test.js).
// - The slots: a small state machine (shotsReducer). A slot is preparing (the client shrinks and encodes the image),
//   ready, uploading (POST /api/feedback/:id/shot, after the report is sent), done, or failed (with the stage that failed).
// - The image size: fitSize and shrinkTo. The byte limit is balance report_shots.max_bytes. It is not in the public
//   balance, so the client learns it from the server answer 413 { error: 'big', max_bytes } (reports.js) and encodes again.
// - The device chip and its 6 facts: the words of src/device-facts.js (PR #378), formatted for the window.

/** Approval choice 6: the picker accepts up to 20 MB; above that, "too large". The client shrinks the rest. */
export const PICK_MAX_BYTES = 20 * 1024 * 1024;
/** The longest side of an encoded screenshot, in image pixels (a 932 CSS px phone at pixel ratio 2 fits). */
export const MAX_SIDE = 1920;
/** The slots drawn in the approved frames (balance report_shots.per_report is 3; the public balance does not have it). */
export const SLOTS = 3;

export const SHOT_TEXT = {
  privacy: 'Screenshots are only seen by the team',
  add: 'Add this screen', addLabel: 'Add a picture of this screen',
  upload: 'Upload an image',
  tooLarge: 'This image is too large. Choose a smaller one.',
  failed: 'The screenshot did not upload. Try again.',
  wait: 'Wait for the upload to finish',
  limit: 'Limit',
  remove: 'Remove screenshot', retry: 'Try again', empty: 'Empty screenshot slot',
};

let seq = 0;
/** A new slot id (unique in this page). */
export const newShotId = () => `s${++seq}`;

/**
 * The slot state machine. list = [{ id, status, progress, stage?, url?, blob?, mime?, src? }]. Returns a NEW list, or the
 * same list when the event does not apply (an unknown id or a transition that is not allowed).
 *   add      { id, src, url, max }   append a preparing slot while the list has fewer than max slots
 *   progress { id, value }      preparing or uploading: 0..1
 *   ready    { id, blob, mime, url }  preparing -> ready
 *   upload   { id }             ready -> uploading
 *   done     { id }             uploading -> done (the server stored it)
 *   fail     { id }             preparing -> failed (stage 'prepare'), uploading -> failed (stage 'upload')
 *   retry    { id }             failed 'prepare' -> preparing, failed 'upload' -> ready (the caller uploads it again)
 *   reencode { id }             failed 'upload' -> preparing (the server answered 413 with its max_bytes)
 *   remove   { id }             any slot that is not uploading and not done (the server has no delete)
 */
export function shotsReducer(list, ev) {
  const at = list.findIndex((s) => s.id === ev.id);
  const s = at >= 0 ? list[at] : null;
  const put = (next) => list.map((x, i) => (i === at ? next : x));
  switch (ev.type) {
    case 'add':
      if (s || list.length >= (ev.max ?? SLOTS)) return list;
      return [...list, { id: ev.id, status: 'preparing', progress: 0, src: ev.src ?? null, url: ev.url ?? null }];
    case 'progress':
      if (!s || (s.status !== 'preparing' && s.status !== 'uploading')) return list;
      return put({ ...s, progress: Math.max(0, Math.min(1, Number(ev.value) || 0)) });
    case 'ready':
      if (!s || s.status !== 'preparing') return list;
      return put({ ...s, status: 'ready', progress: 1, blob: ev.blob, mime: ev.mime, url: ev.url ?? s.url ?? null });
    case 'upload':
      if (!s || s.status !== 'ready') return list;
      return put({ ...s, status: 'uploading', progress: 0 });
    case 'done':
      if (!s || s.status !== 'uploading') return list;
      return put({ ...s, status: 'done', progress: 1 });
    case 'fail':
      if (!s || (s.status !== 'preparing' && s.status !== 'uploading')) return list;
      return put({ ...s, status: 'failed', stage: s.status === 'preparing' ? 'prepare' : 'upload' });
    case 'retry':
      if (!s || s.status !== 'failed') return list;
      return put(s.stage === 'prepare' ? { ...s, status: 'preparing', progress: 0, stage: undefined } : { ...s, status: 'ready', stage: undefined });
    case 'reencode':
      if (!s || s.status !== 'failed' || s.stage !== 'upload') return list;
      return put({ ...s, status: 'preparing', progress: 0, stage: undefined });
    case 'remove':
      if (!s || s.status === 'uploading' || s.status === 'done') return list;
      return list.filter((x) => x.id !== ev.id);
    default:
      return list;
  }
}

/** A slot works now (the client prepares or uploads it): Send waits. */
export const shotsBusy = (list) => list.some((s) => s.status === 'preparing' || s.status === 'uploading');
/** The slots that Send uploads: ready, and the failed uploads (Send tries them again). */
export const shotsToUpload = (list) => list.filter((s) => s.status === 'ready' || (s.status === 'failed' && s.stage === 'upload'));
/** No more slots. */
export const shotsFull = (list, max = SLOTS) => list.length >= max;

/** The count line: "2 / 3", or "3 / 3 · Limit" at the limit (review-2 change 5). */
export const countText = (list, max = SLOTS) => `${list.length} / ${max}${list.length >= max ? ` · ${SHOT_TEXT.limit}` : ''}`;

/**
 * The Send row (review-2 change 7: one fixed message line under Send for the reason or any error).
 * Returns { canSend, line } with line = { kind: 'error' | 'reason', text } or null.
 *  - Send is on when the text has min characters, nothing is sending, and no slot is preparing or uploading.
 *  - The line shows an error first (the send error, an image error), else the reason of a greyed Send.
 */
export function sendState({ text = '', sending = false, shots = [], error = '', min = 5 }) {
  const short = String(text ?? '').trim().length < min;
  const busy = shotsBusy(shots);
  const canSend = !sending && !busy && !short;
  if (error) return { canSend, line: { kind: 'error', text: error } };
  if (sending) return { canSend, line: null };
  if (busy) return { canSend, line: { kind: 'reason', text: SHOT_TEXT.wait } };
  if (short) return { canSend, line: { kind: 'reason', text: 'Type a message first' } };
  return { canSend, line: null };
}

/** The size of an image that fits in maxSide x maxSide, keeping its shape. Never larger than the source. Whole pixels. */
export function fitSize(w, h, maxSide = MAX_SIDE) {
  const W = Math.max(0, Number(w) || 0), H = Math.max(0, Number(h) || 0);
  if (!W || !H) return { w: 0, h: 0 };
  const k = Math.min(1, maxSide / Math.max(W, H));
  return { w: Math.max(1, Math.round(W * k)), h: Math.max(1, Math.round(H * k)) };
}

/** The encode tries, in order: four qualities at full size, then each smaller step (3/4 of the side) with the same
 *  qualities, down to a quarter of the side. The first try that fits wins. */
export const QUALITIES = [0.85, 0.7, 0.55, 0.4];
export function encodeSteps(w, h) {
  const out = [];
  for (let k = 1; k >= 0.24; k *= 0.75) {
    const sw = Math.max(1, Math.round(w * k)), sh = Math.max(1, Math.round(h * k));
    for (const q of QUALITIES) out.push({ w: sw, h: sh, q });
  }
  return out;
}

/**
 * Encode the image at or under maxBytes. encode(w, h, q) -> Promise<Blob> (the browser part draws and encodes).
 * maxBytes unknown (null): the first try is the answer (the server tells the limit if it is too large).
 * Returns the Blob, or null when even the smallest try is too large.
 */
export async function shrinkTo(encode, w, h, maxBytes = null, onStep = null) {
  const { w: fw, h: fh } = fitSize(w, h);
  const steps = encodeSteps(fw, fh);
  for (let i = 0; i < steps.length; i += 1) {
    const { w: sw, h: sh, q } = steps[i];
    const blob = await encode(sw, sh, q);
    onStep?.((i + 1) / steps.length);
    if (blob && (!(maxBytes > 0) || blob.size <= maxBytes)) return blob;
  }
  return null;
}

/** The server answer of one upload -> 'done' | 'big' (encode again under max_bytes) | 'failed'. */
export function uploadOutcome(status, body) {
  if (status >= 200 && status < 300 && body?.ok) return 'done';
  if (status === 413 && body?.error === 'big' && Number(body?.max_bytes) > 0) return 'big';
  return 'failed';
}

// ---- the device chip (review-2 change 1 and 2; approval choices 3 and 4) ----

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

/** The chip: { icon, label } as "iPhone · Discord app", "iPad · Discord app", "Windows 11 · Desktop app". */
export function deviceChip(f = {}) {
  const os = String(f.os || ''), dev = String(f.device || '');
  let name = '';
  if (dev === 'Phone') name = os.startsWith('iOS') ? 'iPhone' : os.startsWith('Android') ? 'Android phone' : 'Phone';
  else if (dev === 'Tablet') name = os.startsWith('iPadOS') ? 'iPad' : os.startsWith('Android') ? 'Android tablet' : 'Tablet';
  else name = os || (dev ? dev : '');
  const app = f.app === 'Mobile app' ? 'Discord app' : f.app || '';
  const ic = dev === 'Phone' ? 'smartphone' : dev === 'Tablet' ? 'tablet' : 'laptop';
  return { icon: ic, label: [name, app].filter(Boolean).join(' · ') };
}

/** The 6 facts of the popover, in the approved order, with their words. A fact the client does not know is left out. */
export const FACT_ROWS = [['app', 'Discord app'], ['device', 'Device'], ['os', 'System'], ['engine', 'Browser engine'], ['layout', 'Layout'], ['dpr', 'Pixel ratio']];
export function factRows(f = {}) {
  const word = {
    layout: (v) => String(v).split(/\s+/).filter(Boolean).map((x, i) => (i ? x : cap(x))).join(' · '),   // "compact portrait" -> "Compact · portrait"
    dpr: (v) => String(v).replace(/x$/, ''),   // "3x" -> "3"
  };
  return FACT_ROWS.filter(([k]) => f[k]).map(([k, label]) => [label, word[k] ? word[k](f[k]) : String(f[k])]);
}
