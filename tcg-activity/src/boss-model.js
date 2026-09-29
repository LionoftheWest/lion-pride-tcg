// Model bosses: real rigged + animated GLB models (Mixamo monsters, and later credited
// Sketchfab fan models), drawn live with three.js. Same handle as mountBoss and
// mountVideoBoss, so the fight code does not change. mountBoss (boss.js) tries this
// path first, then the video clips, then the procedural bosses.
//
// The model files are NOT in the repo (Mixamo terms: never share the raw files). They
// live in Supabase storage and load through the /api/img proxy. The proxy caches for a
// week, so a changed model gets a new versioned file name.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
// The models are meshopt-compressed with WebP textures (gltf-transform resample + webp +
// meshopt, 2026-09-28): 40.8 MB -> 18.1 MB for the 12 bosses.
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createAttackFX } from './attack-fx.js';
import { adaptiveQuality, shadowsOff } from './quality.js';

import { MODEL_BASE, MODEL_BOSSES, modelFor } from './boss-models.js';
export { MODEL_BOSSES, modelFor };

// Fight event -> animation clip in the GLB (names from mixamo_to_glb.py).
const CLIP_FOR = { taunt: 'taunt', flinch: 'hit', counter: 'strike', slam: 'slam', strike: 'strike', enrage: 'roar', stun: 'hit', curse: 'flex', defeat: 'death', attack: 'hit',
  cataclysm: 'slam', drain: 'punch', stunhit: 'punch', regenerate: 'flex', charging: 'roar' };
// The boss's own moves (hunt_boss_difficulty.sql) -> the CLIP_FOR key ("stun" = the boss is
// stunned; "stunhit" = the boss stuns a card).
const MOVE = { slam: 'slam', strike: 'strike', curse: 'curse', cataclysm: 'cataclysm', drain: 'drain', stun: 'stunhit', regenerate: 'regenerate', charging: 'charging' };

// opts.portrait (the Home card of the resting hunt, Nathan 2026-09-29): no floor, no shadows,
// a transparent background, and the camera framed on the head and the upper chest.
export function mountModelBoss(canvas, key, tier, opts = {}) {
  const portrait = !!opts.portrait;
  // Portrait options (defaults = the Home card): at = the boss's x in the frame (0..1), fit =
  // the frame height x the head+chest height, faceAt = the idle face height, bust = fit both
  // arms across, showcase = the occasional flex / taunt (the squad box turns it off).
  const P = { at: null, fit: 1, faceAt: 0.7, bust: true, showcase: true, ...(opts.portraitOpts || {}) };
  const def = MODEL_BOSSES[key];
  if (!def) throw new Error(`no model boss ${key}`);
  const isMobile = !!(window.matchMedia && window.matchMedia('(max-width: 620px)').matches);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobile, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(isMobile ? 1 : Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  if (!isMobile && !portrait) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; }
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envRT.texture;
  // The same camera and FX space as mountBoss, so the attack FX land where they were tuned.
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(0, 0.5, 7.8);
  camera.lookAt(0, 0.3, 0);
  scene.add(new THREE.HemisphereLight(0x8a90b8, 0x241a26, 1.1));
  const key1 = new THREE.DirectionalLight(0xfff0dc, 2.6); key1.position.set(3.5, 6, 5); scene.add(key1);
  const rim = new THREE.DirectionalLight(0xbcd6ff, 2.4); rim.position.set(-3.5, 4.5, -2.5); scene.add(rim);
  const rim2 = new THREE.DirectionalLight(0xff7a52, 1.6); rim2.position.set(3.5, 3, -2.5); scene.add(rim2);
  if (!isMobile && !portrait) {
    key1.castShadow = true; key1.shadow.mapSize.set(1024, 1024);
    const sc = key1.shadow.camera; sc.near = 1; sc.far = 24; sc.left = -4.5; sc.right = 4.5; sc.top = 5; sc.bottom = -4.5; sc.updateProjectionMatrix();
    key1.shadow.bias = -0.0006;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), new THREE.ShadowMaterial({ opacity: 0.42 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -1.7; ground.receiveShadow = true; scene.add(ground);
  }
  const fxRoot = new THREE.Group(); fxRoot.scale.setScalar(0.62); fxRoot.position.set(0, -0.47, 0); scene.add(fxRoot);
  const fx = createAttackFX(fxRoot, camera);

  // The boss: fit its height to the stage (bigger on the harder tiers), feet on the ground.
  const holder = new THREE.Group(); scene.add(holder);
  let mixer = null, actions = {}, twins = {}, idle = null, current = null, holding = false, dead = false, defeatPending = false;
  const TS = { Heroic: 1.1, Mythic: 1.22 }[tier] || 1.0;
  new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(`${MODEL_BASE}/${def.file}`, (g) => {
    const m = g.scene;
    m.traverse((o) => { if (o.isMesh && !isMobile && !portrait) { o.castShadow = true; o.receiveShadow = true; } if (o.isMesh) o.frustumCulled = false; });
    // Measure AFTER the world matrices are current (the Mixamo armature carries a 0.01
    // scale; an un-updated matrix gives a tiny box and a huge boss).
    m.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(m, true), size = box.getSize(new THREE.Vector3());
    const s = (4.3 * TS) / (size.y || 1); // ~80% of the stage height (Nathan: show more of the boss)
    m.scale.multiplyScalar(s);
    m.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(m, true);
    m.position.set(-(b2.min.x + b2.max.x) / 2, -1.7 - b2.min.y, -(b2.min.z + b2.max.z) / 2);
    holder.add(m);
    mixer = new THREE.AnimationMixer(m);
    for (const clip of g.animations) { actions[clip.name] = mixer.clipAction(clip); twins[clip.name] = mixer.clipAction(clip.clone()); }
    idle = actions.idle || Object.values(actions)[0] || null;
    current = idle;
    canvas.dataset.bossDebug = JSON.stringify({ clips: Object.keys(actions), measured: +size.y.toFixed(3), fitted: +(b2.max.y - b2.min.y).toFixed(3) });
    if (idle) { idle.setEffectiveWeight(1); idle.play(); }
    if (portrait) {
      // Aim at the head bone in the idle pose; show about half the body: the head and the chest.
      // The Head bone sits at the base of the skull: the top of the head is the HeadTop_End bone
      // (Mixamo) or ~13% of the body height above it.
      mixer.update(0.5); m.updateMatrixWorld(true);
      // The top: the HIGHEST head / hair / forehead bone (Mixamo: HeadTop_End; Kerrigan: her
      // upper hair bones, above a face bone that sits at the nose).
      let head = null, top = null, topY = -Infinity;
      const wp = new THREE.Vector3();
      m.traverse((o) => {
        if (!o.isBone || /neck|wing/i.test(o.name)) return;
        if (!head && /head/i.test(o.name) && !/top|end/i.test(o.name)) head = o;
        if (/head|hair|forehead/i.test(o.name)) { o.getWorldPosition(wp); if (wp.y > topY) { topY = wp.y; top = o; } }
      });
      const hp = new THREE.Vector3(), tp = new THREE.Vector3();
      if (head) head.getWorldPosition(hp); else hp.set(0, b2.min.y + (b2.max.y - b2.min.y) * 0.85, 0);
      const bodyH = Math.max(0.4, hp.y - b2.min.y);
      if (top && topY > hp.y) top.getWorldPosition(tp); else tp.set(hp.x, hp.y + bodyH * 0.13, hp.z);
      // Down to the chest bone (Mixamo Spine2, Kerrigan spine_upper_1c), with a margin.
      let chest = null;
      m.traverse((o) => { if (!chest && o.isBone && /spine2$|spine_upper_1c|upperchest/i.test(o.name)) chest = o; });
      const cp = new THREE.Vector3();
      if (chest) chest.getWorldPosition(cp); else cp.set(hp.x, hp.y - bodyH * 0.3, hp.z);
      const viewH = Math.max(0.3, (tp.y - cp.y) * 1.3); // the head and the upper chest
      const cy = tp.y + viewH * 0.2 - viewH / 2; // room above the head (the idle lifts it)
      // The arm span (the elbows) + a margin: the whole bust must fit across a narrow card.
      let xmin = Infinity, xmax = -Infinity;
      m.traverse((o) => { if (o.isBone && /forearm|elbow/i.test(o.name) && !/twist/i.test(o.name)) { o.getWorldPosition(wp); xmin = Math.min(xmin, wp.x); xmax = Math.max(xmax, wp.x); } });
      const span = Number.isFinite(xmin) ? (xmax - xmin) + viewH * 0.45 : viewH * 1.1;
      portraitView = { viewH, cy, z: hp.z, span, mx: Number.isFinite(xmin) ? (xmin + xmax) / 2 : hp.x };
      // Keep only the showcase clips that stay in the frame (the Demon's roar bends down out of
      // it): sample each clip on a scratch mixer. In every pose the FACE (the head bone) must
      // stay inside the shown frame: under the top edge, above the lowest 30%, inside 85% of
      // the width. The hair / horns may pass the top edge (the card crops them).
      portraitCamera(); // sets shownFrame (the frame the test below checks against)
      const report = {};
      if (head && shownFrame) {
        const probe = new THREE.AnimationMixer(m), at = new THREE.Vector3();
        // The idle face at 70% of the frame height for every boss (the head bones differ per
        // model: the face sat at 48-93% before this step).
        const sampleFace = (clip, n) => {
          const a = probe.clipAction(clip); a.play(); const ys = [], xs = [];
          for (let k = 0; k <= n; k += 1) { probe.setTime((clip.duration * k) / n); m.updateMatrixWorld(true); head.getWorldPosition(at); ys.push(at.y); xs.push(at.x); }
          a.stop(); probe.uncacheAction(clip); return { ys, xs };
        };
        if (idle) {
          const { ys } = sampleFace(idle.getClip(), 8);
          portraitView.faceY = ys.reduce((t, y) => t + y, 0) / ys.length;
        }
        portraitCamera(SHOW_ZOOM); // the showcase clips play zoomed out
        const f = shownFrame, frameTop = f.cy + f.vh / 2, frameBottom = f.cy - f.vh / 2;
        for (const ev of ['idle', 'enrage', 'curse', 'taunt']) {
          const clip = (ev === 'idle' ? idle : actions[CLIP_FOR[ev]])?.getClip();
          if (!clip) continue;
          const a = probe.clipAction(clip); a.play();
          let ok = true, lo = Infinity, hi = -Infinity;
          for (let k = 0; k <= 16; k += 1) {
            probe.setTime((clip.duration * k) / 16); m.updateMatrixWorld(true); head.getWorldPosition(at);
            lo = Math.min(lo, at.y); hi = Math.max(hi, at.y);
            if (at.y > frameTop - 0.05 * f.vh || at.y < frameBottom + 0.3 * f.vh || Math.abs(at.x - f.x) > f.vw / 2 * 0.85) ok = false;
          }
          a.stop(); probe.uncacheClip(clip);
          report[ev] = { ok, low: +((lo - frameBottom) / f.vh).toFixed(2), high: +((hi - frameBottom) / f.vh).toFixed(2) }; // face height, 0 = bottom, 1 = top
          if (ok && ev !== 'idle') showClips.push(ev); // idle = the reference (not a showcase clip)
        }
        probe.stopAllAction(); probe.uncacheRoot(m);
        mixer.update(0); m.updateMatrixWorld(true); // back to the idle pose
        portraitCamera(1);
      }
      canvas.dataset.showcase = showClips.join(',');
      canvas.dataset.showcaseReport = JSON.stringify(report);
      portraitCamera();
      canvas.dataset.portrait = JSON.stringify({ head: head ? head.name : null, top: top ? top.name : null, y: +hp.y.toFixed(2), topY: +tp.y.toFixed(2), chest: chest ? chest.name : null, viewH: +viewH.toFixed(2) });
    }
    if (typeof window !== 'undefined' && window.__BOSS_DEBUG) canvas.__boss = { model: m, mixer, fx, act: (ev) => once(ev), pause: () => { running = false; cancelAnimationFrame(raf); }, step: (dt) => { mixer.update(dt); backToIdle(); } }; // tests only
    if (defeatPending) { dead = false; once('defeat', true); dead = true; } // defeated before the model loaded
  });

  // Every change is a crossfade whose weights add up to 1, so the model never drops
  // toward its rest pose (the "snap" Nathan saw, 2026-09-28). Measured with
  // discord-ui-preview/animtest: fast hits jumped a bone 135 degrees in one frame.
  // - One-shots hold their last frame and blend back to idle BEFORE they end.
  // - A clip that is already playing blends from its twin (no restart at frame 0).
  // - A hit reaction does not cut off the boss's own move (slam, strike, roar...).
  const FADE_IN = 0.28, FADE_BACK = 0.4;
  const REACT = new Set(['hit']);
  function crossTo(next, fade) {
    if (!current || current === next) return;
    next.reset(); next.setEffectiveTimeScale(1); next.setEffectiveWeight(1); next.play();
    current.crossFadeTo(next, fade, false);
    current = next;
  }
  // Portrait (the Home card): mostly idle, and every 10-15 s a roar, a flex or a taunt, the
  // clips that stay in the frame (Nathan, 2026-09-29; the attacks lunge or crouch out of it).
  // The taunt is Mixamo "Taunting Throwing Arms Back" (the Fox Ninja's clip).
  let showTimer = 0;
  const showClips = [];
  function showcase() {
    showTimer = setTimeout(() => {
      if (running && !document.hidden && current === idle && showClips.length) once(showClips[Math.floor(Math.random() * showClips.length)]); // roar / flex / taunt
      if (running) showcase();
    }, 10000 + Math.random() * 5000);
  }
  if (portrait && P.showcase) showcase();
  function once(event, hold) {
    const name = CLIP_FOR[event];
    if (!actions[name] || !mixer || dead) return;
    const cur = current && current !== idle ? current.getClip().name : null;
    // Keep the boss's own move: a hit during it is skipped (unless the move is almost done).
    if (REACT.has(name) && cur && !REACT.has(cur) && current.time < current.getClip().duration - FADE_BACK) return;
    const next = cur === name && current === actions[name] ? twins[name] : actions[name];
    next.setLoop(THREE.LoopOnce, 1); next.clampWhenFinished = true;
    crossTo(next, FADE_IN);
    holding = !!hold;
  }
  // Back to idle a little before the one-shot ends (the clip holds its last frame).
  function backToIdle() {
    if (!current || current === idle || holding || dead || !idle) return;
    if (current.time >= current.getClip().duration - FADE_BACK || !current.isRunning()) {
      idle.setLoop(THREE.LoopRepeat, Infinity);
      crossTo(idle, FADE_BACK);
    }
  }

  let running = true, raf = 0, last = performance.now();
  const t0 = last;
  // Portrait: fit the head + chest by height, and by width when the view is narrow.
  let portraitView = null, shownFrame = null;
  let zoomNow = 1;
  const SHOW_ZOOM = 1.35;
  function portraitCamera(zoom = zoomNow) {
    if (!portraitView) return;
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    // Fit the head + chest by height and the whole bust (both arms) by width (Nathan: the
    // right arm was cut in a narrow card). A narrow card centres the boss.
    const narrow = camera.aspect < 1.6;
    const at = P.at != null ? P.at : narrow ? 0.5 : 0.38;
    const vhFit = portraitView.viewH * P.fit;
    const distH = (vhFit / 2) / t;
    const distW = P.bust ? (portraitView.span * 1.08) / (2 * t * camera.aspect * Math.min(at, 1 - at) * 2) : 0;
    const dist0 = Math.max(distH, distW), dist = dist0 * zoom;
    const vh0 = 2 * dist0 * t, vh = 2 * dist * t; // the height shown (at zoom 1, and now)
    const x = portraitView.mx + (0.5 - at) * 2 * dist * t * camera.aspect;
    // The idle face at 70% of the height at zoom 1 (60% when zoomed out); before the face is
    // known, the head top stays in place.
    const p = P.faceAt - 0.1 * (zoom - 1) / (SHOW_ZOOM - 1);
    const cy = portraitView.faceY != null ? portraitView.faceY + (0.5 - p) * vh : portraitView.cy - (vh0 - portraitView.viewH) / 2;
    camera.position.set(x, cy, portraitView.z + dist); camera.lookAt(x, cy, portraitView.z);
    shownFrame = { x, cy, vh, vw: vh * camera.aspect };
    canvas.dataset.fit = distW > distH ? 'width' : 'height';
  }
  function size() {
    const w = canvas.clientWidth || 300, h = canvas.clientHeight || 220;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    portraitCamera();
  }
  size();
  let ro = null; try { ro = new ResizeObserver(size); ro.observe(canvas); } catch (e) { /* older webviews */ }
  // A slow machine steps down: shadows off, then 1x, then 0.75x resolution (quality.js).
  const quality = adaptiveQuality(canvas, [
    () => shadowsOff(renderer, scene),
    () => { renderer.setPixelRatio(1); size(); },
    () => { renderer.setPixelRatio(0.75); size(); },
  ]);
  function frame() {
    if (!running) return;
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
    quality(now);
    if (mixer) { mixer.update(dt); backToIdle(); }
    if (portrait && portraitView && portraitView.faceY != null) {
      const want = current && current !== idle ? SHOW_ZOOM : 1;
      if (Math.abs(want - zoomNow) > 0.001) { zoomNow += (want - zoomNow) * Math.min(1, dt * 3); portraitCamera(zoomNow); }
    }
    holder.rotation.y = Math.sin((now - t0) / 1000 * 0.4) * 0.12; // a slow sway toward the squad
    fx.update(dt, (now - t0) / 1000);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return {
    credit: def.credit,
    attack(element) { try { fx.fire(element || 'physical'); } catch (e) { /* ignore */ } },
    bossAct(kind) { try { fx.bossFire(kind); } catch (e) { /* ignore */ } if (MOVE[kind]) once(MOVE[kind]); },
    flinch() { once('flinch'); },
    counter() { once('counter'); },
    enrage() { once('enrage'); },
    stun() { once('stun'); },
    defeat() { if (!mixer) defeatPending = true; once('defeat', true); dead = true; },
    dispose() {
      running = false; cancelAnimationFrame(raf); clearTimeout(showTimer);
      try { if (ro) ro.disconnect(); } catch (e) { /* ignore */ }
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((mt) => { if (mt.map) mt.map.dispose(); mt.dispose(); }); });
      try { envRT.dispose(); pmrem.dispose(); } catch (e) { /* ignore */ }
      renderer.dispose();
    },
  };
}
