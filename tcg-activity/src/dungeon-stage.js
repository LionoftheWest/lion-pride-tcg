// The Dungeon room stage: the monsters of the room in one three.js canvas (one WebGL context for 1 to 3
// monsters, for the phones). The models are Quaternius CC0 glb files (public/dungeon/monsters/,
// CREDITS.md) with Idle / Attack / HitReact / Death clips. Bigger on screen (Nathan, 2026-10-03): each
// monster fills its slot of the room. Loaded on demand (dungeon UI: import('./dungeon-stage.js')).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

const BASE = '/dungeon/monsters/';
const CLIPS = {
  idle: ['Idle', 'Flying_Idle'],
  attack: ['Attack', 'Punch', 'Bite_Front', 'Headbutt', 'Weapon'],
  hit: ['HitReact', 'HitRecieve'],
  death: ['Death'],
};
const ELEMENT = { fire: 0xff6a3d, water: 0x3da5ff, lightning: 0xffd23d, earth: 0xb08850, nature: 0x5fd06a, ice: 0x9fe6ff, shadow: 0xa070ff, light: 0xfff2b0 };
const cache = new Map();
const loader = new GLTFLoader();
const load = (model) => {
  if (!cache.has(model)) cache.set(model, new Promise((ok, no) => loader.load(BASE + model + '.glb', ok, undefined, no)));
  return cache.get(model);
};
const clipOf = (clips, kind) => {
  const names = CLIPS[kind] || [];
  for (const n of names) { const c = clips.find((x) => x.name === n || x.name.endsWith('|' + n)); if (c) return c; }
  return null;
};

// mountStage(canvas, { onPick(i) }) -> { setFoes(foes, roomKey), play(i, kind), labels(): [{x, y, w}], dispose() }
export function mountStage(canvas, opts = {}) {
  const phone = !!(window.matchMedia && window.matchMedia('(max-width: 620px), (max-height: 500px)').matches);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !phone, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(phone ? 1 : Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  scene.add(new THREE.HemisphereLight(0xcfd8ff, 0x2a1a3a, 1.6));
  const key = new THREE.DirectionalLight(0xffe2b8, 2.2); key.position.set(2, 4, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(0x9a7bff, 1.4); rim.position.set(-3, 2, -3); scene.add(rim);
  const clock = new THREE.Clock();
  let slots = []; let token = 0; let raf = 0; let disposed = false; let spread = 1.5;

  function fit() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Frame every slot: the width of the row and a monster height of 1.25 (the guardian).
    const n = Math.max(1, slots.length);
    const rowW = (n - 1) * spread + 1.4;
    const vh = Math.max(1.55, rowW / camera.aspect);
    const dist = (vh / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    camera.position.set(0, 0.75, dist + 0.6);
    camera.lookAt(0, 0.62, 0);
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
    spread = n >= 3 ? 1.35 : 1.6;
    const list = await Promise.all(foes.map((f) => load(f.model).catch(() => null)));
    if (my !== token || disposed) return;
    list.forEach((g, i) => {
      const f = foes[i];
      const root = new THREE.Group();
      root.position.x = (i - (n - 1) / 2) * spread;
      scene.add(root);
      const slot = { root, f, mixer: null, actions: {}, dead: false, model: null };
      slots.push(slot);
      // The element ring under the monster.
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.46, 40), new THREE.MeshBasicMaterial({ color: ELEMENT[f.element] || 0xffffff, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01; root.add(ring);
      if (!g) return;
      const model = SkeletonUtils.clone(g.scene);
      model.updateMatrixWorld(true); // the file's own scale and rotation first (else the box is the raw mesh)
      const box = new THREE.Box3().setFromObject(model, true);
      const size = box.getSize(new THREE.Vector3());
      const tall = f.boss ? 1.25 : f.elite ? 1.1 : 0.95;
      const s = tall / Math.max(size.y, size.x * 0.8, 0.001);
      model.scale.setScalar(s);
      model.position.y = -box.min.y * s;
      model.rotation.y = -0.25 * Math.sign(root.position.x || 0);
      // The element tint: an Ice Slime looks icy, a Fire Slime fiery (one model, many monsters).
      const tint = new THREE.Color(ELEMENT[f.element] || 0xffffff);
      model.traverse((o) => { if (o.isMesh && o.material) { o.material = o.material.clone(); o.material.color?.lerp(tint, 0.45); } });
      root.add(model);
      slot.model = model;
      slot.mixer = new THREE.AnimationMixer(model);
      for (const k of Object.keys(CLIPS)) { const c = clipOf(g.animations, k); if (c) slot.actions[k] = slot.mixer.clipAction(c); }
      if (f.hp <= 0) { dieNow(slot); return; }
      slot.actions.idle?.play();
      slot.mixer.update(Math.random() * 2);
    });
    fit();
  }

  function dieNow(slot) {
    slot.dead = true;
    const a = slot.actions.death;
    if (!a) { slot.root.visible = false; return; }
    a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.reset().play();
    slot.mixer.update(10);
    slot.root.traverse((o) => { if (o.material) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.35; } });
  }

  function play(i, kind) {
    const slot = slots[i];
    if (!slot || !slot.mixer || slot.dead) return;
    if (kind === 'death') {
      slot.dead = true;
      const a = slot.actions.death;
      if (!a) { slot.root.visible = false; return; }
      slot.mixer.stopAllAction();
      a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.reset().play();
      return;
    }
    const a = slot.actions[kind];
    if (!a) return;
    const idle = slot.actions.idle;
    a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = false; a.reset();
    if (idle) a.crossFadeFrom(idle, 0.12, false);
    a.play();
    const back = () => { slot.mixer.removeEventListener('finished', back); if (!slot.dead && idle) { idle.reset().play(); idle.crossFadeFrom(a, 0.2, false); } };
    slot.mixer.addEventListener('finished', back);
  }

  // The screen position (CSS px in the canvas) above each monster's head and its slot width, for the
  // HTML name plates and the damage numbers.
  function labels() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    return slots.map((s) => {
      const top = new THREE.Vector3(s.root.position.x, (s.f.boss ? 1.25 : s.f.elite ? 1.1 : 0.95) + 0.08, 0).project(camera);
      const foot = new THREE.Vector3(s.root.position.x, 0, 0).project(camera);
      const edge = new THREE.Vector3(s.root.position.x + spread / 2, 0, 0).project(camera);
      return { x: (top.x + 1) / 2 * w, y: (1 - top.y) / 2 * h, foot: (1 - foot.y) / 2 * h, w: Math.abs(edge.x - foot.x) * w };
    });
  }

  canvas.addEventListener('click', (e) => {
    if (!opts.onPick) return;
    const r = canvas.getBoundingClientRect();
    const L = labels();
    let best = -1, bd = Infinity;
    L.forEach((l, i) => { if (slots[i].dead) return; const d = Math.abs(e.clientX - r.left - l.x); if (d < bd && d < l.w / 2 + 10) { bd = d; best = i; } });
    if (best >= 0) opts.onPick(best);
  });
  const ro = new ResizeObserver(() => { fit(); opts.onLayout?.(); });
  ro.observe(canvas);

  function loop() {
    if (disposed) return;
    raf = requestAnimationFrame(loop);
    if (document.hidden) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    for (const s of slots) s.mixer?.update(dt);
    renderer.render(scene, camera);
  }
  loop();

  return {
    setFoes, play, labels,
    dispose() { disposed = true; cancelAnimationFrame(raf); ro.disconnect(); clear(); renderer.dispose(); },
  };
}
