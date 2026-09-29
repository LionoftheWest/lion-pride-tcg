// The 3D boss code (three.js + boss.js + the attack FX) is 68% of the bundle (~700 of 1030
// KB, 2026-09-28). It loads on its own: in the background a few seconds after start-up
// (preloadBoss), or at once when a boss is shown. mountBoss() returns a handle at once;
// calls made before the code has loaded (bossAct, defeat, flinch...) wait and then run in
// order, and a dispose() before the load cancels the mount.
let mod = null, loading = null;
export function preloadBoss() {
  if (!loading) loading = import('./boss.js').then((m) => (mod = m)).catch((e) => { loading = null; throw e; });
  return loading;
}
export function mountBoss(canvas, seedStr, tier) {
  if (mod) return mod.mountBoss(canvas, seedStr, tier);
  let real = null, gone = false;
  const queue = [];
  const handle = new Proxy({}, {
    get(_, key) {
      if (key === 'then') return undefined; // not a promise
      return (...args) => {
        if (key === 'dispose') { gone = true; queue.length = 0; return real ? real.dispose(...args) : undefined; }
        if (real) return typeof real[key] === 'function' ? real[key](...args) : undefined;
        queue.push([key, args]);
        return undefined;
      };
    },
  });
  preloadBoss().then((m) => {
    if (gone) return;
    real = m.mountBoss(canvas, seedStr, tier);
    for (const [k, a] of queue.splice(0)) if (typeof real[k] === 'function') real[k](...a);
  }).catch((e) => console.error('boss code failed to load', e));
  return handle;
}
