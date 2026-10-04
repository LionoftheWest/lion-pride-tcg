// The Dungeon room stage: the monsters of the room in one three.js canvas (one WebGL context for 1 to 3
// monsters, for the phones). The models are Quaternius CC0 glb files (public/dungeon/monsters/,
// CREDITS.md) with Idle / Attack / HitReact / Death clips. Loaded on demand (import('./dungeon-stage.js')).
// Nathan 2026-10-03: big monsters with room between them; the target is obvious (a red pulsing ring);
// an attack is easy to see (the monster lunges at you); a hit flashes; a monster with passives is bigger
// and has a glowing aura.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { createAttackFX } from './attack-fx.js';

const BASE = '/dungeon/monsters/';
const CLIPS = {
  idle: ['Idle', 'Flying_Idle'],
  attack: ['Attack', 'Punch', 'Bite_Front', 'Headbutt', 'Weapon'],
  hit: ['HitReact', 'HitRecieve'],
  death: ['Death'],
};
const ELEMENT = { fire: 0xff6a3d, water: 0x3da5ff, lightning: 0xffd23d, earth: 0xb08850, nature: 0x5fd06a, ice: 0x9fe6ff, shadow: 0xa070ff, light: 0xfff2b0 };
const TARGET = 0xff3b55;
const cache = new Map();
const loader = new GLTFLoader();
const load = (model) => {
  if (!cache.has(model)) cache.set(model, new Promise((ok, no) => loader.load(BASE + model + '.glb', ok, undefined, no)));
  return cache.get(model);
};
const clipOf = (clips, kind) => {
  for (const n of CLIPS[kind] || []) { const c = clips.find((x) => x.name === n || x.name.endsWith('|' + n)); if (c) return c; }
  return null;
};
// The height of a monster in world units: bigger for an elite, the guardian, and passives.
const heightOf = (f) => (f.boss ? 1.45 : f.elite ? 1.2 : 1.0) * ((f.passives || []).length ? 1.12 : 1);

// mountStage(canvas, { onPick(i), onLayout() }) -> { setFoes, play(i, kind), cast(i, element), foeFx(i, move), setTarget(i), labels(), dispose() }
export function mountStage(canvas, opts = {}) {
  const phone = !!(window.matchMedia && window.matchMedia('(max-width: 620px), (max-height: 500px)').matches);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !phone, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(phone ? 1 : Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 100);
  scene.add(new THREE.HemisphereLight(0xcfd8ff, 0x2a1a3a, 1.7));
  const key = new THREE.DirectionalLight(0xffe2b8, 2.3); key.position.set(2, 4, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(0x9a7bff, 1.4); rim.position.set(-3, 2, -3); scene.add(rim);
  const clock = new THREE.Clock();
  // Item 13: the Raid's attack effects (attack-fx.js, the lab's own space: the target at (0, 1.4, 1.6), the
  // boss origin at (0, 1.15, 0.7)). Before each effect the group moves and scales onto the monster.
  const fxRoot = new THREE.Group(); scene.add(fxRoot);
  const fx = createAttackFX(fxRoot, camera);
  const aim = (slot, ox, oy, oz) => { const k = slot.tall / 2.6; fxRoot.scale.setScalar(k); fxRoot.position.set(slot.x0 - ox * k, slot.tall * 0.55 - oy * k, -oz * k); };
  const MOVE_FX = { strike: 'strike', heavy: 'strike', flurry: 'strike', drain: 'drain', stun: 'stun', slam: 'slam', cataclysm: 'cataclysm', enrage: 'enrage', charging: 'charging', curse: 'curse', poison: 'curse', regenerate: 'regenerate', guard: 'regenerate', stunned: 'stunned' };
  let slots = []; let token = 0; let raf = 0; let disposed = false; let spread = 1.8; let cur = 1.8; let tallest = 1; let target = -1;

  function fit() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Frame the row tightly: the monsters fill the height (bigger on screen) with room between them.
    const n = Math.max(1, slots.length);
    const rowW = (n - 1) * spread + tallest * 1.3;
    const vh = Math.max(tallest * 1.12, rowW / camera.aspect);
    // A wide, short arena (a landscape phone): spread the monsters over the width (they bunched in the middle).
    if (n > 1) {
      const wide = Math.min(tallest * 3.2, (vh * camera.aspect * 0.84) / n);
      const sp = Math.max(spread, wide);
      slots.forEach((sl, i) => { sl.x0 = (i - (n - 1) / 2) * sp; sl.root.position.x = sl.x0; });
      cur = sp;
    } else cur = spread;
    const dist = (vh / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    camera.position.set(0, tallest * 0.5, dist + 0.4);
    camera.lookAt(0, tallest * 0.5, 0);
    camera.updateProjectionMatrix();
  }

  function clear() {
    for (const s of slots) { scene.remove(s.root); s.mixer?.stopAllAction(); }
    slots = [];
  }

  async function setFoes(foes) {
    const my = ++token;
    clear();
    const n = foes.length;
    tallest = Math.max(1, ...foes.map(heightOf));
    spread = tallest * (n >= 3 ? 1.45 : 1.7);
    const list = await Promise.all(foes.map((f) => load(f.model).catch(() => null)));
    if (my !== token || disposed) return;
    list.forEach((g, i) => {
      const f = foes[i];
      const tall = heightOf(f);
      const root = new THREE.Group();
      root.position.x = (i - (n - 1) / 2) * spread;
      scene.add(root);
      const slot = { root, f, tall, mixer: null, actions: {}, dead: false, model: null, mats: [], fx: [], ring: null, aura: null, x0: root.position.x };
      slots.push(slot);
      // The ground ring: the element colour; red and pulsing on the target.
      slot.ringColor = ELEMENT[f.element] || 0xffffff;
      slot.ring = new THREE.Mesh(new THREE.RingGeometry(tall * 0.36, tall * 0.48, 48), new THREE.MeshBasicMaterial({ color: slot.ringColor, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
      slot.ring.rotation.x = -Math.PI / 2; slot.ring.position.y = 0.01; root.add(slot.ring);
      // A monster with passives: a glowing aura disc under it (and it is bigger, heightOf).
      if ((f.passives || []).length) {
        slot.aura = new THREE.Mesh(new THREE.CircleGeometry(tall * 0.62, 48), new THREE.MeshBasicMaterial({ color: 0xb28cff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }));
        slot.aura.rotation.x = -Math.PI / 2; slot.aura.position.y = 0.005; root.add(slot.aura);
      }
      if (!g) return;
      const model = SkeletonUtils.clone(g.scene);
      model.updateMatrixWorld(true); // the file's own scale and rotation first (else the box is the raw mesh)
      const box = new THREE.Box3().setFromObject(model, true);
      const size = box.getSize(new THREE.Vector3());
      const s = tall / Math.max(size.y, size.x * 0.8, 0.001);
      model.scale.setScalar(s);
      model.position.y = -box.min.y * s;
      model.rotation.y = -0.22 * Math.sign(root.position.x || 0);
      // The element tint: an Ice Slime looks icy (one model, many monsters). The passive glow: emissive.
      const tint = new THREE.Color(ELEMENT[f.element] || 0xffffff);
      model.traverse((o) => {
        if (o.isMesh && o.material) {
          o.material = o.material.clone(); o.material.color?.lerp(tint, 0.45);
          if (o.material.emissive) { o.material.emissive.set((f.passives || []).length ? 0x2a1450 : 0x000000); slot.mats.push(o.material); }
        }
      });
      root.add(model);
      slot.model = model;
      slot.mixer = new THREE.AnimationMixer(model);
      for (const k of Object.keys(CLIPS)) { const c = clipOf(g.animations, k); if (c) slot.actions[k] = slot.mixer.clipAction(c); }
      if (f.hp <= 0) { dieNow(slot); return; }
      slot.actions.idle?.play();
      slot.mixer.update(Math.random() * 2);
      // Measure again in the idle pose: some models (the Ooze) are much bigger animated than at rest.
      model.updateMatrixWorld(true);
      const b2 = new THREE.Box3().setFromObject(model, true);
      const h2 = b2.max.y - b2.min.y, w2 = b2.max.x - b2.min.x;
      if (h2 > 0.001) { model.scale.multiplyScalar(tall / Math.max(h2, w2 * 0.8)); model.updateMatrixWorld(true); model.position.y -= new THREE.Box3().setFromObject(model, true).min.y; }
    });
    fit();
    setTarget(target);
    opts.onLayout?.();
  }

  function dieNow(slot) {
    slot.dead = true;
    const a = slot.actions.death;
    if (a) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.reset().play(); slot.mixer.update(10); }
    fade(slot);
  }
  function fade(slot) {
    slot.root.traverse((o) => { if (o.material) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.3; } });
    if (slot.ring) slot.ring.visible = false;
  }

  function setTarget(i) {
    target = i;
    slots.forEach((s, k) => {
      if (!s.ring) return;
      const on = k === i && !s.dead;
      s.ring.material.color.set(on ? TARGET : s.ringColor);
      s.ring.material.opacity = on ? 0.95 : 0.4;
      s.targeted = on;
    });
  }

  // A tween on a slot: t from 0 to 1 over ms, f(t) each frame.
  const tween = (slot, ms, f) => slot.fx.push({ t0: performance.now(), ms, f });

  function play(i, kind) {
    const slot = slots[i];
    if (!slot || slot.dead) return;
    if (kind === 'death') {
      slot.dead = true;
      const a = slot.actions.death;
      if (a) { slot.mixer.stopAllAction(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.reset().play(); }
      setTimeout(() => fade(slot), 900);
      return;
    }
    if (kind === 'attack') {
      // The lunge: forward toward the camera and back (easy to see who attacks).
      tween(slot, 620, (t) => { const k = Math.sin(Math.PI * Math.min(1, t)); slot.root.position.z = k * slot.tall * 0.7; slot.root.scale.setScalar(1 + k * 0.12); });
    }
    if (kind === 'hit') {
      // The flash and the shake.
      tween(slot, 420, (t) => {
        const k = 1 - t;
        for (const m of slot.mats) m.emissive.setRGB(0.9 * k, 0.15 * k, 0.15 * k);
        slot.root.position.x = slot.x0 + Math.sin(t * 40) * 0.05 * k;
        if (t >= 1) { for (const m of slot.mats) m.emissive.set((slot.f.passives || []).length ? 0x2a1450 : 0x000000); slot.root.position.x = slot.x0; }
      });
    }
    const a = slot.actions[kind];
    if (!a || !slot.mixer) return;
    const idle = slot.actions.idle;
    a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = false; a.reset();
    if (idle) a.crossFadeFrom(idle, 0.12, false);
    a.play();
    const back = () => { slot.mixer.removeEventListener('finished', back); if (!slot.dead && idle) { idle.reset().play(); idle.crossFadeFrom(a, 0.2, false); } };
    slot.mixer.addEventListener('finished', back);
  }

  // The screen position (CSS px in the canvas) of each monster: its head (y), its feet (foot), its centre
  // (x) and the width of its slot (w), for the name plates, the reticle and the damage numbers.
  function labels() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    return slots.map((s) => {
      const top = new THREE.Vector3(s.x0, s.tall, 0).project(camera);
      const foot = new THREE.Vector3(s.x0, 0, 0).project(camera);
      const edge = new THREE.Vector3(s.x0 + cur / 2, 0, 0).project(camera);
      return { x: (top.x + 1) / 2 * w, y: (1 - top.y) / 2 * h, foot: (1 - foot.y) / 2 * h, w: Math.abs(edge.x - foot.x) * w * 2 };
    });
  }

  canvas.addEventListener('click', (e) => {
    if (!opts.onPick) return;
    const r = canvas.getBoundingClientRect();
    const L = labels();
    let best = -1, bd = Infinity;
    L.forEach((l, i) => { if (slots[i].dead) return; const d = Math.abs(e.clientX - r.left - l.x); if (d < bd && d < l.w / 2) { bd = d; best = i; } });
    if (best >= 0) opts.onPick(best);
  });
  const ro = new ResizeObserver(() => { fit(); opts.onLayout?.(); });
  ro.observe(canvas);

  function loop() {
    if (disposed) return;
    raf = requestAnimationFrame(loop);
    if (document.hidden) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    const now = performance.now();
    for (const s of slots) {
      s.mixer?.update(dt);
      if (s.targeted && s.ring) { const k = 1 + 0.08 * Math.sin(now / 160); s.ring.scale.set(k, k, k); }
      if (s.aura) s.aura.material.opacity = 0.18 + 0.08 * Math.sin(now / 400);
      s.fx = s.fx.filter((x) => { const t = Math.min(1, (now - x.t0) / x.ms); x.f(t); return t < 1; });
    }
    fx.update(dt, now / 1000);
    renderer.render(scene, camera);
  }
  loop();

  return {
    setFoes, play, setTarget, labels,
    // A card's attack: the element's Raid effect flies to monster i.
    cast(i, element) { const slot = slots[i]; if (!slot) return; aim(slot, 0, 1.4, 1.6); try { fx.fire(element || 'physical'); } catch { /* the effect is cosmetic */ } },
    // A monster's move: the Raid boss effect from monster i.
    foeFx(i, move) { const slot = slots[i]; const k = MOVE_FX[move]; if (!slot || slot.dead || !k) return; aim(slot, 0, 1.15, 0.7); try { fx.bossFire(k); } catch { /* cosmetic */ } },
    dispose() { disposed = true; cancelAnimationFrame(raf); ro.disconnect(); clear(); renderer.dispose(); },
  };
}
