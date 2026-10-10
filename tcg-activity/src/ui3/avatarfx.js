// UI-55 Avatar effects (v3 only): an effect that changes a member's picture shows on EVERY avatar of that member
// (top bar, Home voice and pulls, Profile, Leaderboard) through one overlay inside the avatar box. Today one effect:
// the mustache (the effect primitive "mustache": Grown-Up Stache, Gerudo Stache). The effect rules and the data come from
// the server (/api/effects/badges): this module only draws what the badge list says. node --test

// The mustache drawing is the one of the Spotlight cards (ui-v2.js STACHE): one drawing for every place (UI-55 notes, proposal 1).
const STACHE_PATH = 'M50 14c-6-10-20-12-30-4-6 5-12 6-18 3 4 12 18 20 32 13 7-3 12-7 16-12 4 5 9 9 16 12 14 7 28-1 32-13-6 3-12 2-18-3-10-8-24-6-30 4z';
const DRAW = { mustache: `<svg class="u3-avfx__stache" viewBox="0 0 100 40" aria-hidden="true" focusable="false"><path d="${STACHE_PATH}"/></svg>` };

/** The avatar effects of one badge entry (/api/effects/badges), in a fixed order. */
export function avatarEffects(badge) {
  const out = [];
  if (badge?.mustache) out.push('mustache');
  return out;
}

/** The overlay of a list of effects ('' for none). It takes no tap and no focus (the avatar stays one button). */
export function overlayHTML(kinds) {
  if (!kinds?.length) return '';
  return `<span class="u3-avfx" data-fx="${kinds.join(',')}" aria-hidden="true">${kinds.map((k) => DRAW[k] || '').join('')}</span>`;
}

/** The member id of an avatar element: data-pid (set by avatarHTML under v3), else the picture address /api/avatar/<id>. */
export function pidOf(av) {
  const d = av?.dataset?.pid;
  if (d) return String(d);
  const src = av?.querySelector?.('img')?.getAttribute?.('src') || '';
  const m = /^\/api\/avatar\/([^/?#]+)/.exec(src);
  return m ? decodeURIComponent(m[1]) : '';
}

/** Make one avatar show exactly `kinds`. Returns true when it changed the avatar (so a repeat pass changes nothing). */
export function syncAvatar(av, kinds) {
  const key = (kinds || []).join(',');
  const old = av.querySelector(':scope > .u3-avfx');
  if ((old?.dataset?.fx || '') === key) return false;
  old?.remove();
  if (key) av.insertAdjacentHTML('beforeend', overlayHTML(kinds));
  return true;
}

/** One pass over a root: every avatar gets the effects of its member. badgeOf(id) is the effects-ui badge lookup. */
export function scanAvatars(root, badgeOf) {
  let n = 0;
  for (const av of root.querySelectorAll('.v2-avatar')) {
    const id = pidOf(av);
    if (syncAvatar(av, id ? avatarEffects(badgeOf(id)) : [])) n += 1;
  }
  return n;
}

/**
 * Start the watcher (v3 only: main.js calls it under flags.uiV3). The pass runs after the page changes (one pass for each
 * animation frame at most) and every few seconds, because the badge list refreshes with no page change. `reduce()` tells
 * Reduce effects (D-11): the overlay then stands still (class u3-calm on the body; the device setting is in the CSS).
 */
export function startAvatarFx({ badgeOf, reduce = () => false, root = document.body, every = 4000 } = {}) {
  let queued = false;
  const pass = () => {
    queued = false;
    root.classList.toggle('u3-calm', !!reduce());
    scanAvatars(root, badgeOf);
  };
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(pass); } };
  new MutationObserver(queue).observe(root, { childList: true, subtree: true });
  setInterval(queue, every);
  queue();
}
