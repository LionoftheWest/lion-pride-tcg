// UI-56 Loader and sign-in retry (design repo UI-56/approved). The pure part: the states, the texts, the 15 s timeout rule,
// and the hint that tells the next start that this member has the v3 look. The DOM glue (paintLoader) is at the end.
//
// The v3 flag (flags.uiV3) comes from /api/flags, which needs the sign-in, so the loader cannot read it. It reads a hint
// that the last session stored (localStorage "lp_ui3"). A member with no hint (the first start, or a cleared store) sees the
// old loader once. design.md 11.3: after 15 s the loader shows Try again; design.md 10.6: no raw error text.

export const TIMEOUT_MS = 15000;
export const HINT_KEY = 'lp_ui3';

export const TEXT = Object.freeze({
  connecting: 'Connecting to Discord…',
  shuffling: 'Shuffling the deck…',
  error: 'Something went wrong. Try again.',
  timeout: 'This took too long. Try again.',
});

/** The state of the loader: loading (bar moves), timeout (bar moves, Try again), error (bar stops, Try again), done. */
export const initialState = (phase = 'connecting') => ({ kind: 'loading', phase });

/** The state after an event. Events: { type: 'phase', phase } | { type: 'timeout' } | { type: 'fail' } | { type: 'done' }.
 *  A done loader stays done. An error stays an error (a late timeout does not replace it). A phase message does not
 *  replace the timeout text (the sign-in is still running, the member can retry). */
export function next(state, ev) {
  if (state.kind === 'done') return state;
  switch (ev.type) {
    case 'done': return { kind: 'done', phase: state.phase };
    case 'fail': return { kind: 'error', phase: state.phase };
    case 'timeout': return state.kind === 'loading' ? { kind: 'timeout', phase: state.phase } : state;
    case 'phase': return state.kind === 'loading' ? { kind: 'loading', phase: ev.phase } : { ...state, phase: ev.phase };
    default: return state;
  }
}

/** What the loader shows for a state: the text, the bar, the retry button. */
export function view(state) {
  if (state.kind === 'error') return { state: 'error', text: TEXT.error, bar: false, retry: true };
  if (state.kind === 'timeout') return { state: 'timeout', text: TEXT.timeout, bar: true, retry: true };
  return { state: 'loading', text: TEXT[state.phase] || TEXT.connecting, bar: true, retry: false };
}

/** Does the stored hint say v3? Only the exact value "1". A store that throws (a blocked store) is no hint. */
export function readHint(storage) { try { return storage?.getItem(HINT_KEY) === '1'; } catch { return false; } }
export function writeHint(storage, on) { try { storage?.setItem(HINT_KEY, on ? '1' : '0'); } catch { /* a blocked store: the next start has no hint */ } }

/** The loader controller. `paint(view)` draws; `setTimer`/`clearTimer` are the timer functions (a test passes fakes).
 *  Returns { send(ev), state() }. The timeout timer starts at once and stops when the loader is done or failed. */
export function createLoader({ paint, setTimer = setTimeout, clearTimer = clearTimeout, timeoutMs = TIMEOUT_MS } = {}) {
  let st = initialState();
  const timer = setTimer(() => send({ type: 'timeout' }), timeoutMs);
  function send(ev) {
    const was = st;
    st = next(st, ev);
    if (st !== was && (st.kind === 'done' || st.kind === 'error')) clearTimer(timer);
    if (st !== was || ev.type === 'phase') paint?.(view(st), st);
    return st;
  }
  paint?.(view(st), st);
  return { send, state: () => st };
}

/** The DOM glue: draws a view on the v3 loader block (index.html #ldr3). */
export function paintLoader(doc, v) {
  const root = doc.getElementById('ldr3');
  if (!root) return;
  root.dataset.state = v.state;
  const msg = doc.getElementById('ldr3Msg');
  if (msg) msg.textContent = v.text;
  const btn = doc.getElementById('ldr3Retry');
  if (btn) btn.tabIndex = v.retry ? 0 : -1;
}
