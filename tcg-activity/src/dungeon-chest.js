// The treasure room chest (Nathan item 14, 2026-10-03: a real model, not a drawn one): Quaternius "Chest"
// (CC0, public/dungeon/chest.glb) with its Chest_Open animation, lit in the chest tier colour.
// Loaded on demand (import('./dungeon-chest.js')). mountChest(canvas, colour) -> { open(), dispose() }
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export function mountChest(canvas, colour = '#9AA3B5') {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  scene.add(new THREE.HemisphereLight(0xfff1dc, 0x2a1a3a, 1.8));
  const key = new THREE.DirectionalLight(0xffe2b8, 2.2); key.position.set(2, 4, 4); scene.add(key);
  const glow = new THREE.PointLight(new THREE.Color(colour), 0, 6); glow.position.set(0, 0.9, 0.3); scene.add(glow);
  const clock = new THREE.Clock();
  let mixer = null, openA = null, model = null, raf = 0, dead = false, opened = false, t0 = 0;

  function fit() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new GLTFLoader().load('/dungeon/chest.glb', (g) => {
    if (dead) return;
    model = g.scene;
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model, true); const size = box.getSize(new THREE.Vector3());
    const s = 1.2 / Math.max(size.x, size.y, size.z, 0.001);
    model.scale.setScalar(s);
    const c = box.getCenter(new THREE.Vector3()).multiplyScalar(s);
    model.position.set(-c.x, -box.min.y * s, -c.z);
    model.rotation.y = -0.45;
    scene.add(model);
    mixer = new THREE.AnimationMixer(model);
    const clip = g.animations.find((a) => /Chest_Open$/.test(a.name)) || g.animations.find((a) => /open/i.test(a.name));
    if (clip) { openA = mixer.clipAction(clip); openA.setLoop(THREE.LoopOnce, 1); openA.clampWhenFinished = true; }
    camera.position.set(0, 1.25, 2.6); camera.lookAt(0, 0.45, 0);
    canvas.dispatchEvent(new Event('chest-ready'));
  }, undefined, () => canvas.dispatchEvent(new Event('chest-fail')));
  const ro = new ResizeObserver(fit); ro.observe(canvas); fit();

  function loop() {
    if (dead) return;
    raf = requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05); const now = performance.now() / 1000;
    mixer?.update(dt);
    if (model && !opened) model.rotation.z = Math.sin(now * 9) * 0.04 * Math.max(0, Math.sin(now * 1.3));   // a little wiggle: tap me
    if (opened) { const k = Math.min(1, (now - t0) / 0.6); glow.intensity = 6 * k; if (model) model.rotation.z *= 0.8; }
    renderer.render(scene, camera);
  }
  loop();
  return {
    open() { if (opened) return; opened = true; t0 = performance.now() / 1000; openA?.reset().play(); },
    dispose() { dead = true; cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose(); },
  };
}
