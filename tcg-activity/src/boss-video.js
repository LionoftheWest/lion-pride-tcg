// Video-clip raid boss. A drop-in alternative to the procedural WebGL boss
// (boss.js) for archetypes that have a pre-rendered clip set. It plays a boss
// clip in a <video> behind the canvas and keeps the element attack FX
// (attack-fx.js) on a transparent Three overlay on the canvas, so the combat
// handle API is identical to mountBoss:
//   { attack, bossAct, flinch, counter, enrage, stun, defeat, dispose }
import * as THREE from 'three';
import { createAttackFX } from './attack-fx.js';

// Clips are served through the same proven card-art proxy as every other image
// (server.js /api/img, immutable-cached, safe inside the Discord iframe proxy).
const CARD_ART = '/api/img/storage/v1/object/public/card-art';

// archetype -> clip set. `states` maps a combat state to a rendered clip file
// basename (served as <base>/<name>.webm, with a <base>/<name>.mp4 fallback and a
// mobile <base>/<name>.m.webm variant). Add an entry here per archetype we render.
export const BOSS_CLIPS = {
  behemoth: {
    base: `${CARD_ART}/boss/behemoth`,
    states: { idle: 'idle', flinch: 'hit', counter: 'swipe', attack: 'punch', enrage: 'roar', stun: 'hit', defeat: 'death' },
  },
};

export function clipSetFor(arch) { return BOSS_CLIPS[arch] || null; }

// Pick the best source URL the webview can play. VP9 webm carries the alpha so
// the boss composites over the arena; mp4 is the universal (opaque) fallback.
function srcFor(clip, state, mobile) {
  const name = clip.states[state] || clip.states.idle;
  const probe = document.createElement('video');
  const webmOk = !!probe.canPlayType && probe.canPlayType('video/webm; codecs="vp9"') !== '';
  if (webmOk) return `${clip.base}/${name}${mobile ? '.m' : ''}.webm`;
  return `${clip.base}/${name}.mp4`;
}

export function mountVideoBoss(canvas, clip, tier) {
  const isMobile = !!(window.matchMedia && window.matchMedia('(max-width: 620px)').matches);
  const parent = canvas.parentElement || canvas;
  if (parent && getComputedStyle(parent).position === 'static') parent.style.position = 'relative';

  // The boss clip plays in a <video> inserted BEHIND the canvas.
  const video = document.createElement('video');
  video.muted = true; video.autoplay = true; video.loop = true; video.playsInline = true;
  video.setAttribute('muted', ''); video.setAttribute('playsinline', ''); video.preload = 'auto';
  video.className = 'boss-video';
  Object.assign(video.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none', zIndex: '0' });
  parent.insertBefore(video, canvas);
  canvas.style.position = canvas.style.position || 'absolute';
  canvas.style.zIndex = '1';

  let onEnded = null;
  function play(state, loop) {
    const src = srcFor(clip, state, isMobile);
    if (video.getAttribute('src') !== src) video.setAttribute('src', src);
    video.loop = !!loop;
    const p = video.play(); if (p && p.catch) p.catch(() => { /* autoplay gate; muted should pass */ });
  }
  video.addEventListener('ended', () => { if (onEnded) onEnded(); });
  // Play a one-shot state clip, then fall back to the looping idle.
  function once(state) { onEnded = () => { onEnded = null; play('idle', true); }; play(state, false); }
  play('idle', true);

  // Transparent Three overlay on the canvas so the per-element attack FX still
  // play OVER the clip. Same camera + fxRoot transform as mountBoss so the FX
  // land in the same screen space they were tuned for.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobile, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(isMobile ? 1 : Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(0, 0.5, 7.8); camera.lookAt(0, 0.3, 0);
  const fxRoot = new THREE.Group(); fxRoot.scale.setScalar(0.62); fxRoot.position.set(0, -0.47, 0); scene.add(fxRoot);
  const fx = createAttackFX(fxRoot, camera);

  let running = true, raf = 0; const t0 = performance.now(); let last = t0;
  function size() {
    const w = canvas.clientWidth || 300, h = canvas.clientHeight || 220;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  size();
  let ro = null; try { ro = new ResizeObserver(size); ro.observe(canvas); } catch (e) { /* older webviews */ }
  function frame() {
    if (!running) return;
    const now = performance.now(); const dt = Math.min(0.05, (now - last) / 1000); last = now;
    fx.update(dt, (now - t0) / 1000);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return {
    attack(element) { try { fx.fire(element || 'physical'); } catch (e) { /* ignore */ } once('attack'); },
    bossAct(kind) { try { fx.bossFire(kind); } catch (e) { /* ignore */ } },
    flinch() { once('flinch'); },
    counter() { once('counter'); },
    enrage() { once('enrage'); },
    stun() { once('stun'); },
    defeat() { onEnded = () => { onEnded = null; try { video.pause(); } catch (e) { /* ignore */ } }; play('defeat', false); },
    dispose() {
      running = false; cancelAnimationFrame(raf);
      try { if (ro) ro.disconnect(); } catch (e) { /* ignore */ }
      try { video.pause(); video.removeAttribute('src'); video.load(); video.remove(); } catch (e) { /* ignore */ }
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()); } });
      renderer.dispose();
    },
  };
}
