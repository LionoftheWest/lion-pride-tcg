// Adaptive render quality (2026-09-28). Desktop always drew at up to 2x resolution with
// soft shadows (and bloom on the procedural bosses), so a slow laptop dropped frames in the
// fight. Now each boss scene steps down when the average frame time stays above 24 ms
// (< ~40 fps): the steps are the scene's own (shadows off, 1x resolution, ...). It waits 3 s
// after start-up (loading, shader compiles) and 2.5 s between steps, and it never steps
// back up, so the picture does not flicker between levels. canvas.dataset.quality = level.
export function adaptiveQuality(canvas, steps) {
  const t0 = performance.now();
  let ema = 1000 / 60, prev = 0, level = 0, lastStep = 0;
  return function tick(now) {
    if (prev) ema = ema * 0.95 + Math.min(100, now - prev) * 0.05; // a hidden tab's long gap counts as 100 ms
    prev = now;
    if (level < steps.length && now - t0 > 3000 && now - lastStep > 2500 && ema > 24) {
      try { steps[level](); } catch (e) { /* keep going */ }
      level += 1; lastStep = now;
      canvas.dataset.quality = String(level);
    }
    return level;
  };
}

/** Recompile every material after the shadows are switched off (the old shadow map stays bound otherwise). */
export function shadowsOff(renderer, scene) {
  renderer.shadowMap.enabled = false;
  scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); });
}
