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
const CLIP_FOR = { flinch: 'hit', counter: 'strike', slam: 'slam', strike: 'strike', enrage: 'roar', stun: 'hit', curse: 'flex', defeat: 'death', attack: 'hit',
  cataclysm: 'slam', drain: 'punch', stunhit: 'punch', regenerate: 'flex', charging: 'roar' };
// The boss's own moves (hunt_boss_difficulty.sql) -> the CLIP_FOR key ("stun" = the boss is
// stunned; "stunhit" = the boss stuns a card).
const MOVE = { slam: 'slam', strike: 'strike', curse: 'curse', cataclysm: 'cataclysm', drain: 'drain', stun: 'stunhit', regenerate: 'regenerate', charging: 'charging' };

// opts.portrait (the Home card of the resting hunt, Nathan 2026-09-29): no floor, no shadows,
// a transparent background, and the camera framed on the head and the upper chest.
export function mountModelBoss(canvas, key, tier, opts = {}) {
  const portrait = !!opts.portrait;
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
      const cy = tp.y + viewH * 0.12 - viewH / 2; // room above the head (the idle lifts it)
      portraitView = { viewH, cy, z: hp.z };
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
  let portraitView = null;
  function portraitCamera() {
    if (!portraitView) return;
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dist = Math.max((portraitView.viewH / 2) / t, (portraitView.viewH * 0.8 / 2) / (t * camera.aspect));
    camera.position.set(0, portraitView.cy, portraitView.z + dist); camera.lookAt(0, portraitView.cy, portraitView.z);
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
      running = false; cancelAnimationFrame(raf);
      try { if (ro) ro.disconnect(); } catch (e) { /* ignore */ }
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((mt) => { if (mt.map) mt.map.dispose(); mt.dispose(); }); });
      try { envRT.dispose(); pmrem.dispose(); } catch (e) { /* ignore */ }
      renderer.dispose();
    },
  };
}
