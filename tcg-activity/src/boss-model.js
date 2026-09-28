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
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createAttackFX } from './attack-fx.js';

const MODEL_BASE = '/api/img/storage/v1/object/public/card-art/boss/models';

// key -> the model file, the name pattern of the weekly boss, and the credit.
export const MODEL_BOSSES = {
  warrok: { file: 'warrok-v1.glb', names: /rage-?quit warlord|warrok/i, credit: 'Model: Warrok W Kurniawan — Mixamo (Adobe)' },
  mutant: { file: 'mutant-v1.glb', names: /netcode mutant|\bmutant\b/i, credit: 'Model: Mutant — Mixamo (Adobe)' },
  maw:    { file: 'maw-v1.glb',    names: /maw of the meta|\bmaw\b/i, credit: 'Model: Maw J Laygo — Mixamo (Adobe)' },
  parasite:       { file: 'parasite-v1.glb',       names: /lagspike parasite|\bparasite\b/i, credit: 'Model: Parasite L Starkie — Mixamo (Adobe)' },
  pumpkinhulk:    { file: 'pumpkinhulk-v1.glb',    names: /patch-?day pumpkin|pumpkinhulk/i, credit: 'Model: Pumpkinhulk L Shaw — Mixamo (Adobe)' },
  nightshade:     { file: 'nightshade-v1.glb',     names: /ranked nightshade|\bnightshade\b/i, credit: 'Model: Nightshade J Friedrich — Mixamo (Adobe)' },
  vampire:        { file: 'vampire-v1.glb',        names: /grind vampire|\bvampire\b/i, credit: 'Model: Vampire A Lusth — Mixamo (Adobe)' },
  demon:          { file: 'demon-v1.glb',          names: /ban-?wave demon/i, credit: 'Model: Demon T Wiezzorek — Mixamo (Adobe)' },
  // Not "brute": that key is the procedural Ogre Brute in boss.js.
  smurf:          { file: 'smurf-v1.glb',          names: /smurf brute/i, credit: 'Model: Brute — Mixamo (Adobe)' },
  warzombie:      { file: 'warzombie-v1.glb',      names: /afk warzombie|warzombie/i, credit: 'Model: Warzombie F Pedroso — Mixamo (Adobe)' },
  skeletonzombie: { file: 'skeletonzombie-v1.glb', names: /hardstuck skeleton|skeletonzombie/i, credit: 'Model: Skeletonzombie T Avelange — Mixamo (Adobe)' },
};

/** The model key for a boss name (or an `arch:<key>` seed), or null. */
export function modelFor(seedStr) {
  const s = seedStr || '';
  const mo = s.match(/^arch:(\w+)/);
  if (mo) return MODEL_BOSSES[mo[1]] ? mo[1] : null;
  for (const [key, m] of Object.entries(MODEL_BOSSES)) if (m.names.test(s)) return key;
  return null;
}

// Fight event -> animation clip in the GLB (names from mixamo_to_glb.py).
const CLIP_FOR = { flinch: 'hit', counter: 'strike', slam: 'slam', strike: 'strike', enrage: 'roar', stun: 'hit', curse: 'flex', defeat: 'death', attack: 'hit' };

export function mountModelBoss(canvas, key, tier) {
  const def = MODEL_BOSSES[key];
  if (!def) throw new Error(`no model boss ${key}`);
  const isMobile = !!(window.matchMedia && window.matchMedia('(max-width: 620px)').matches);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobile, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(isMobile ? 1 : Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  if (!isMobile) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; }
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
  if (!isMobile) {
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
  let mixer = null, actions = {}, idle = null, dead = false, defeatPending = false;
  const TS = { Heroic: 1.1, Mythic: 1.22 }[tier] || 1.0;
  new GLTFLoader().load(`${MODEL_BASE}/${def.file}`, (g) => {
    const m = g.scene;
    m.traverse((o) => { if (o.isMesh && !isMobile) { o.castShadow = true; o.receiveShadow = true; } if (o.isMesh) o.frustumCulled = false; });
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
    for (const clip of g.animations) actions[clip.name] = mixer.clipAction(clip);
    idle = actions.idle || Object.values(actions)[0] || null;
    canvas.dataset.bossDebug = JSON.stringify({ clips: Object.keys(actions), measured: +size.y.toFixed(3), fitted: +(b2.max.y - b2.min.y).toFixed(3) });
    if (idle) idle.play();
    if (defeatPending) { dead = false; once('defeat', true); dead = true; } // defeated before the model loaded
    mixer.addEventListener('finished', (e) => {
      if (dead || !idle || e.action === idle) return;
      idle.reset().fadeIn(0.25).play(); e.action.fadeOut(0.25);
    });
  });

  // Play a one-shot clip, then return to idle. `hold` keeps the last frame (death).
  function once(event, hold) {
    const a = actions[CLIP_FOR[event]];
    if (!a || !mixer || dead) return;
    for (const other of Object.values(actions)) if (other !== a && other.isRunning() && other !== idle) other.fadeOut(0.12);
    a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = !!hold; a.fadeIn(0.12).play();
    if (idle) idle.fadeOut(0.12);
  }

  let running = true, raf = 0, last = performance.now();
  const t0 = last;
  function size() {
    const w = canvas.clientWidth || 300, h = canvas.clientHeight || 220;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  size();
  let ro = null; try { ro = new ResizeObserver(size); ro.observe(canvas); } catch (e) { /* older webviews */ }
  function frame() {
    if (!running) return;
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (mixer) mixer.update(dt);
    holder.rotation.y = Math.sin((now - t0) / 1000 * 0.4) * 0.12; // a slow sway toward the squad
    fx.update(dt, (now - t0) / 1000);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return {
    credit: def.credit,
    attack(element) { try { fx.fire(element || 'physical'); } catch (e) { /* ignore */ } },
    bossAct(kind) { try { fx.bossFire(kind); } catch (e) { /* ignore */ } if (kind === 'slam' || kind === 'strike' || kind === 'curse') once(kind); },
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
