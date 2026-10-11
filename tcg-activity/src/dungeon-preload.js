// Preload for the Dungeon rooms (2026-10-11: "the next room appears at once").
// Two steps, both small:
//  1. warmFoes(foes): the monsters of the room that starts NOW (the answer of start / choose names them): load their models
//     and the stage module at once, in parallel with everything else, no budget.
//  2. warmRoster(kind, key): in idle time, a few more models of the roster, because the next room is not known before it starts
//     (the server hides the rooms ahead on purpose). One call per step (kind + key) and a budget per kind, so that the whole
//     roster (10 models, 2.7 MB) is spread over the lobby, the reward steps and the floor screens, never loaded at once.
// A slow link (data saver, 2g) loads nothing in idle time. Nothing here changes a rule or a result.
export const BUDGET = { lobby: 4, reward: 3, floor: 3, fight: 2 };   // fight: the smallest (a model parses on the main thread while the fight animates)
export const ROSTER_MODELS = 10;

let stage = null;
const stageModule = () => (stage ||= import('./dungeon-stage.js').catch(() => { stage = null; return null; }));
const done = new Set();

/** True on a link where an idle preload would cost the member (data saver or 2g). */
export const slowLink = () => {
  const c = typeof navigator !== 'undefined' ? navigator.connection : null;
  return !!c && (c.saveData === true || /(^|-)2g$/.test(c.effectiveType || ''));
};
const idle = (fn) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 2500 }) : setTimeout(fn, 250));

/** The models of the room that starts now. Returns a promise (the callers do not wait for it). */
export async function warmFoes(foes) {
  const m = await stageModule();
  const models = [...new Set((foes || []).map((f) => f?.model).filter(Boolean))];
  if (m && models.length) await m.preloadModels(models, models.length);
}

/** The idle step of one screen. `key` makes it run once for that screen (a repaint does not load more). */
export function warmRoster(kind, key = '') {
  const tag = `${kind}|${key}`;
  if (globalThis.__dgNoRoster || done.has(tag) || slowLink() || (typeof document !== 'undefined' && document.hidden)) return false;
  done.add(tag);
  idle(async () => {
    const m = await stageModule();
    await m?.preloadModels(m.STAGE_MODELS, BUDGET[kind] ?? 2);
  });
  return true;
}

// globalThis.__dgNoRoster = true switches the idle step off (tools/fight-rig.mjs --noroster: the measurement of a room that the idle step missed).
/** Test hook: forget the steps that ran. */
export const resetWarm = () => done.clear();
