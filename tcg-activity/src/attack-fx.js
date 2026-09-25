// Per-element attack FX for the Pride Hunt boss, ported from the Attack FX Lab
// (card-studio/out/attack-preview.html). Each element has its OWN distinct form.
//
//   const fx = createAttackFX(fxRoot, camera);  // fxRoot = a THREE.Group in the boss scene
//   fx.fire('fire');                            // spawn an element's attack
//   fx.update(dt, t);                           // call every frame from the boss render loop
//
// fxRoot is scaled/positioned by the caller so this module keeps the lab's own
// coordinate space (boss ~ y1.4, caster lower-left). `camera` is the real scene camera.
import * as THREE from 'three';

export function createAttackFX(scene, camera) {
  let bossHitT = 0; // written by the effects (lab holdover); harmless here

  function softTex() {
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, '#fff'); g.addColorStop(.3, 'rgba(255,255,255,.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
  }
  const TEX = softTex();

  const EL = {
    fire: { c: 0xff6a2c, c2: 0xffd23e, glyph: '🔥', imp: { n: 46, size: .34, spread: 2.6, grav: 2.4, drag: .90, add: true, life: .9, smoke: true } },
    water: { c: 0x39a8ff, c2: 0x9fe4ff, glyph: '💧', imp: { n: 60, size: .22, spread: 3.0, grav: -6.5, drag: .96, add: false, life: 1.0, ring: 0x8fe0ff } },
    lightning: { c: 0xffe23e, c2: 0xffffff, glyph: '⚡', imp: { n: 30, size: .18, spread: 3.4, grav: 0, drag: .82, add: true, life: .5, bolt: true } },
    ice: { c: 0x8fe0ff, c2: 0xffffff, glyph: '❄', imp: { n: 34, size: .30, spread: 2.8, grav: -3, drag: .93, add: false, life: .9, shard: true } },
    nature: { c: 0x5ddb6f, c2: 0xd0ff9a, glyph: '🌿', imp: { n: 40, size: .28, spread: 2.4, grav: -2, drag: .92, add: false, life: 1.1, ring: 0x9dff7a } },
    earth: { c: 0xc79a5a, c2: 0xefd39a, glyph: '⛰', imp: { n: 36, size: .34, spread: 2.2, grav: -7, drag: .90, add: false, life: .9 } },
    air: { c: 0xbfeaff, c2: 0xffffff, glyph: '🌪', imp: { n: 40, size: .22, spread: 3.6, grav: .4, drag: .95, add: true, life: .8, ring: 0xdff2ff } },
    shadow: { c: 0x8a3cff, c2: 0xc9a6ff, glyph: '🌑', imp: { n: 44, size: .30, spread: 2.0, grav: .2, drag: .90, add: true, life: 1.1, implode: true } },
    light: { c: 0xffe27a, c2: 0xffffff, glyph: '✨', imp: { n: 40, size: .26, spread: 2.8, grav: .2, drag: .92, add: true, life: .9, ring: 0xffffff, rays: true } },
    arcane: { c: 0xe06aff, c2: 0xffc0ff, glyph: '🔮', imp: { n: 44, size: .26, spread: 2.6, grav: .3, drag: .92, add: true, life: 1.0, ring: 0xffb0ff } },
    psychic: { c: 0xff6ad0, c2: 0xffd0ef, glyph: '🌀', imp: { n: 44, size: .24, spread: 2.6, grav: .2, drag: .93, add: true, life: 1.0, ring: 0xffb0e6 } },
    toxic: { c: 0x9cd93c, c2: 0xe0ff9a, glyph: '☣', imp: { n: 40, size: .30, spread: 2.2, grav: -2.5, drag: .93, add: false, life: 1.1, smoke: true } },
    metal: { c: 0xa8bccf, c2: 0xe6f0fa, glyph: '⚙', imp: { n: 34, size: .22, spread: 3.0, grav: -6, drag: .88, add: true, life: .6 } },
    physical: { c: 0xdfe6f2, c2: 0xffffff, glyph: '💥', imp: { n: 30, size: .24, spread: 2.6, grav: -4, drag: .9, add: true, life: .5 } },
  };

  function fireTex() {
    const s = 160, c = document.createElement('canvas'); c.width = c.height = s; const x = c.getContext('2d');
    const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, '#ffffff'); g.addColorStop(.16, '#fff2a8'); g.addColorStop(.4, '#ffab2e');
    g.addColorStop(.72, 'rgba(255,74,0,.5)'); g.addColorStop(1, 'rgba(255,40,0,0)');
    x.fillStyle = g; x.beginPath(); x.arc(s / 2, s / 2, s / 2, 0, 7); x.fill();
    x.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2, r0 = s * .14, r1 = s * (.34 + Math.random() * .16), w = .1 + Math.random() * .12;
      x.fillStyle = `rgba(255,${150 + (Math.random() * 90 | 0)},40,.55)`;
      x.beginPath(); x.moveTo(s / 2 + Math.cos(a) * r0, s / 2 + Math.sin(a) * r0);
      x.lineTo(s / 2 + Math.cos(a - w) * r0, s / 2 + Math.sin(a - w) * r0);
      x.lineTo(s / 2 + Math.cos(a) * r1, s / 2 + Math.sin(a) * r1); x.closePath(); x.fill();
    }
    return new THREE.CanvasTexture(c);
  }
  const FIRETEX = fireTex();
  const SMOKETEX = (() => { const s = 64, c = document.createElement('canvas'); c.width = c.height = s; const x = c.getContext('2d'); const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); g.addColorStop(0, 'rgba(46,34,30,.9)'); g.addColorStop(1, 'rgba(30,22,20,0)'); x.fillStyle = g; x.fillRect(0, 0, s, s); return new THREE.CanvasTexture(c); })();
  function waterTex() {
    const s = 160, c = document.createElement('canvas'); c.width = c.height = s; const x = c.getContext('2d');
    const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(224,246,255,.6)'); g.addColorStop(.42, 'rgba(90,180,255,.5)');
    g.addColorStop(.8, 'rgba(30,120,240,.22)'); g.addColorStop(1, 'rgba(20,90,220,0)');
    x.fillStyle = g; x.beginPath(); x.arc(s / 2, s / 2, s / 2, 0, 7); x.fill();
    x.globalCompositeOperation = 'lighter'; x.strokeStyle = 'rgba(255,255,255,.5)';
    for (let i = 0; i < 7; i++) { x.lineWidth = 1 + Math.random() * 2.4; const r = s * (.16 + i * .045); const a0 = Math.random() * 6.28; x.beginPath(); x.arc(s / 2, s / 2, r, a0, a0 + 2 + Math.random() * 2); x.stroke(); }
    for (let i = 0; i < 22; i++) { const a = Math.random() * 6.28, r = s * (.2 + Math.random() * .28); x.fillStyle = 'rgba(232,249,255,.75)'; x.beginPath(); x.arc(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r, 1 + Math.random() * 2, 0, 7); x.fill(); }
    return new THREE.CanvasTexture(c);
  }
  const WATERTEX = waterTex();
  function natureTex() {
    const s = 160, c = document.createElement('canvas'); c.width = c.height = s; const x = c.getContext('2d');
    const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(206,255,170,.6)'); g.addColorStop(.4, 'rgba(90,210,110,.55)'); g.addColorStop(.8, 'rgba(40,150,70,.24)'); g.addColorStop(1, 'rgba(30,120,60,0)');
    x.fillStyle = g; x.beginPath(); x.arc(s / 2, s / 2, s / 2, 0, 7); x.fill();
    x.globalCompositeOperation = 'lighter'; x.lineCap = 'round';
    for (let i = 0; i < 9; i++) { x.strokeStyle = `rgba(${120 + (Math.random() * 60 | 0)},255,${120 + (Math.random() * 60 | 0)},.5)`; x.lineWidth = 2 + Math.random() * 3; const r = s * (.12 + i * .04), a0 = Math.random() * 6.28; x.beginPath(); x.arc(s / 2, s / 2, r, a0, a0 + 1.5 + Math.random() * 2.5); x.stroke(); }
    return new THREE.CanvasTexture(c);
  }
  const NATURETEX = natureTex();
  function leafTex() {
    const s = 48, c = document.createElement('canvas'); c.width = c.height = s; const x = c.getContext('2d');
    x.fillStyle = '#4fbf5a'; x.beginPath(); x.ellipse(s / 2, s / 2, s * .17, s * .42, 0, 0, 7); x.fill();
    x.strokeStyle = '#2f8f42'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(s / 2, s * .1); x.lineTo(s / 2, s * .9); x.stroke();
    return new THREE.CanvasTexture(c);
  }
  const LEAFTEX = leafTex();
  const TOXICTEX = (() => { const s = 128, c = document.createElement('canvas'); c.width = c.height = s; const x = c.getContext('2d'); const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); g.addColorStop(0, 'rgba(206,255,120,.92)'); g.addColorStop(.5, 'rgba(124,214,44,.8)'); g.addColorStop(1, 'rgba(70,150,20,0)'); x.fillStyle = g; x.beginPath(); x.arc(s / 2, s / 2, s / 2, 0, 7); x.fill(); for (let i = 0; i < 10; i++) { x.fillStyle = 'rgba(184,255,120,.5)'; const a = Math.random() * 6.28, r = s * (.2 + Math.random() * .22); x.beginPath(); x.arc(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r, 3 + Math.random() * 6, 0, 7); x.fill(); } return new THREE.CanvasTexture(c); })();
  const SHADOWTEX = (() => { const s = 128, c = document.createElement('canvas'); c.width = c.height = s; const x = c.getContext('2d'); const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); g.addColorStop(0, 'rgba(232,182,255,.95)'); g.addColorStop(.25, 'rgba(150,60,240,.78)'); g.addColorStop(.7, 'rgba(40,10,70,.5)'); g.addColorStop(1, 'rgba(10,0,20,0)'); x.fillStyle = g; x.beginPath(); x.arc(s / 2, s / 2, s / 2, 0, 7); x.fill(); return new THREE.CanvasTexture(c); })();
  const ARCANETEX = (() => { const s = 256, c = document.createElement('canvas'); c.width = c.height = s; const x = c.getContext('2d'); x.translate(s / 2, s / 2); x.strokeStyle = 'rgba(150,210,255,.95)'; x.lineWidth = 2.5; x.shadowColor = '#7fd0ff'; x.shadowBlur = 10; for (const r of [s * .46, s * .4, s * .3]) { x.beginPath(); x.arc(0, 0, r, 0, 7); x.stroke(); } for (let i = 0; i < 24; i++) { const a = i / 24 * 6.28; x.beginPath(); x.moveTo(Math.cos(a) * s * .4, Math.sin(a) * s * .4); x.lineTo(Math.cos(a) * s * .46, Math.sin(a) * s * .46); x.stroke(); } x.beginPath(); for (let i = 0; i < 3; i++) { const a = i / 3 * 6.28 - 1.57, px = Math.cos(a) * s * .3, py = Math.sin(a) * s * .3; i ? x.lineTo(px, py) : x.moveTo(px, py); } x.closePath(); x.stroke(); return new THREE.CanvasTexture(c); })();
  function fistTex() { const s = 128, c = document.createElement('canvas'); c.width = c.height = s; const x = c.getContext('2d'); const rr = (X, Y, W, H, r) => { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + W, Y, X + W, Y + H, r); x.arcTo(X + W, Y + H, X, Y + H, r); x.arcTo(X, Y + H, X, Y, r); x.arcTo(X, Y, X + W, Y, r); x.closePath(); }; x.fillStyle = '#ffe27a'; x.strokeStyle = '#c98a1e'; x.lineWidth = 4; rr(s * .28, s * .34, s * .46, s * .5, 14); x.fill(); x.stroke(); for (let i = 0; i < 4; i++) { x.beginPath(); x.arc(s * .34 + i * s * .11, s * .34, s * .075, 0, 7); x.fill(); x.stroke(); } x.beginPath(); x.arc(s * .26, s * .56, s * .075, 0, 7); x.fill(); x.stroke(); return new THREE.CanvasTexture(c); }
  const FISTTEX = fistTex();

  // ---- Particle burst (generic fallback) ----
  const bursts = [];
  function burst(pos, el) {
    const p = el.imp; const col = new THREE.Color(el.c), col2 = new THREE.Color(el.c2);
    const N = p.n; const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(N * 3), colors = new Float32Array(N * 3);
    const vel = [], life = new Float32Array(N), maxlife = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      positions.set([pos.x, pos.y, pos.z], i * 3);
      let dx = (Math.random() - .5), dy = (Math.random() - .5), dz = (Math.random() - .5);
      const L = Math.hypot(dx, dy, dz) || 1; dx /= L; dy /= L; dz /= L;
      let sp = (0.5 + Math.random()) * p.spread; if (p.implode) sp *= -1;
      vel.push(new THREE.Vector3(dx * sp, dy * sp + (p.grav > 0 ? p.grav * .3 : 0), dz * sp));
      const cc = Math.random() < .5 ? col : col2; colors.set([cc.r, cc.g, cc.b], i * 3);
      maxlife[i] = p.life * (.6 + Math.random() * .7); life[i] = maxlife[i];
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({ size: p.size, map: TEX, vertexColors: true, transparent: true, depthWrite: false, blending: p.add ? THREE.AdditiveBlending : THREE.NormalBlending });
    const pts = new THREE.Points(geo, mat); scene.add(pts);
    bursts.push({ pts, geo, mat, vel, life, maxlife, p, N, age: 0 });
    if (p.ring) ring(pos, p.ring);
    if (p.rays) rays(pos, el.c);
    if (p.bolt) bolt(pos, el.c);
    flash(pos, el.c, p.add);
    bossHitT = 1;
  }
  const rings = [];
  function ring(pos, color) { const m = new THREE.Mesh(new THREE.RingGeometry(.2, .32, 40), new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })); m.position.copy(pos); m.lookAt(camera.position); scene.add(m); rings.push({ m, age: 0, life: .6 }); }
  function groundRing(pos, color) { const m = new THREE.Mesh(new THREE.RingGeometry(.2, .4, 40), new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })); m.position.copy(pos); m.rotation.x = -Math.PI / 2; scene.add(m); rings.push({ m, age: 0, life: .7 }); }
  const flashes = [];
  function flash(pos, color, add) { const m = new THREE.Mesh(new THREE.SphereGeometry(.7, 16, 16), new THREE.MeshBasicMaterial({ color, transparent: true, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false })); m.position.copy(pos); scene.add(m); flashes.push({ m, age: 0, life: .28 }); }
  function rays(pos, color) { for (let i = 0; i < 8; i++) { const g = new THREE.Mesh(new THREE.PlaneGeometry(.14, 3.2), new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); g.position.copy(pos); g.rotation.z = i / 8 * Math.PI * 2; g.lookAt(camera.position); g.rotation.z = i / 8 * Math.PI * 2; scene.add(g); flashes.push({ m: g, age: 0, life: .4, scale: true }); } }
  const boltsFx = [];
  function bolt(pos, color) { const pts = [new THREE.Vector3(pos.x, pos.y + 4, pos.z)]; for (let i = 1; i < 6; i++) pts.push(new THREE.Vector3(pos.x + (Math.random() - .5) * 1.2, pos.y + 4 - i * .8, pos.z + (Math.random() - .5) * 1.2)); pts.push(pos.clone()); const g = new THREE.BufferGeometry().setFromPoints(pts); const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending })); scene.add(l); boltsFx.push({ l, age: 0, life: .3 }); }

  // ---- Attack systems ----
  const START = new THREE.Vector3(-6.5, -1.0, 2.5);
  const projs = [];
  const emberSys = [], flames = [], smokes = [], droplets = [], strikes = [], shards = [], risers = [], waves = [], vines = [], streams = [], jetp = [], gobjs = [], beams = [], tornadoes = [], windp = [], slashes = [];

  function jag(from, to, segs, jit) { const pts = []; for (let i = 0; i <= segs; i++) { const p = from.clone().lerp(to, i / segs); if (i > 0 && i < segs) { p.x += (Math.random() - .5) * jit; p.y += (Math.random() - .5) * jit; p.z += (Math.random() - .5) * jit; } pts.push(p); } return pts; }
  function boltTube(pts, color, rad, op) { const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, rad, 6, false); const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false })); m.material.userData = { base: op }; return m; }
  function lightningStrike(to) {
    const from = new THREE.Vector3(-6.0, -0.6, 2.2);
    const grp = new THREE.Group(); scene.add(grp);
    const rebuild = () => {
      while (grp.children.length) { const c = grp.children.pop(); c.geometry && c.geometry.dispose(); }
      const main = jag(from, to, 11, .55);
      grp.add(boltTube(main, 0x6fb8ff, .16, .5)); grp.add(boltTube(main, 0xbfe4ff, .085, .8)); grp.add(boltTube(main, 0xffffff, .038, 1));
      const nf = 3 + Math.floor(Math.random() * 3);
      for (let f = 0; f < nf; f++) { const base = main[2 + Math.floor(Math.random() * (main.length - 3))]; const end = base.clone().add(new THREE.Vector3((Math.random() - .5), (Math.random() - .5), (Math.random() - .5)).normalize().multiplyScalar(1.3 + Math.random() * 1.6)); const fp = jag(base, end, 5, .35); grp.add(boltTube(fp, 0x8fd0ff, .1, .7)); grp.add(boltTube(fp, 0xffffff, .032, .95)); }
    };
    rebuild();
    strikes.push({ grp, age: 0, life: .32, flick: 0, rebuild });
    flash(to, 0xdff0ff, true); ring(to, 0x9fd0ff);
    for (let i = 0; i < 20; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX, color: 0xdff0ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); s.position.copy(to); s.scale.setScalar(.2); scene.add(s); const a = Math.random() * 6.28, sp = 1.5 + Math.random() * 3.5; droplets.push({ s, age: 0, life: .4 + Math.random() * .3, v: new THREE.Vector3(Math.cos(a) * sp, (Math.random() - .3) * sp, Math.sin(a) * sp), g: 2 }); }
    bossHitT = 1.3;
  }
  function emberBurst(pos) {
    const N = 48, geo = new THREE.BufferGeometry(), position = new Float32Array(N * 3), colors = new Float32Array(N * 3), vel = [], life = new Float32Array(N);
    const cA = new THREE.Color(0xffd23e), cB = new THREE.Color(0xff5a1e);
    for (let i = 0; i < N; i++) { position.set([pos.x, pos.y, pos.z], i * 3); const a = Math.random() * 6.28, sp = 1 + Math.random() * 3; vel.push(new THREE.Vector3(Math.cos(a) * sp * .6, .6 + Math.random() * 2.4, Math.sin(a) * sp * .6)); const cc = Math.random() < .5 ? cA : cB; colors.set([cc.r, cc.g, cc.b], i * 3); life[i] = .7 + Math.random() * .8; }
    geo.setAttribute('position', new THREE.BufferAttribute(position, 3)); geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({ size: .16, map: TEX, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(geo, mat); scene.add(pts); emberSys.push({ pts, geo, mat, vel, life, N, age: 0 });
  }
  function fireImpact(pos) {
    flash(pos, 0xffd23e, true);
    const fr = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: FIRETEX, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); fr.position.copy(pos); scene.add(fr); flashes.push({ m: fr, age: 0, life: .55, scale: true, grow: 8 });
    emberBurst(pos);
    for (let i = 0; i < 7; i++) { const fm = new THREE.Sprite(new THREE.SpriteMaterial({ map: FIRETEX, color: 0xffa030, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); fm.position.copy(pos).add(new THREE.Vector3((Math.random() - .5) * 1.4, (Math.random() - .3) * .8, (Math.random() - .5))); fm.scale.setScalar(.6); scene.add(fm); flames.push({ m: fm, age: 0, life: .6 + Math.random() * .4, rise: 1.2 + Math.random() }); }
    for (let i = 0; i < 10; i++) { const sm = new THREE.Sprite(new THREE.SpriteMaterial({ map: SMOKETEX, transparent: true, opacity: .5, depthWrite: false })); sm.position.copy(pos).add(new THREE.Vector3((Math.random() - .5) * 1.2, 0, (Math.random() - .5) * 1.2)); sm.scale.setScalar(.8); scene.add(sm); smokes.push({ m: sm, age: 0, life: 1.2 + Math.random() * .6, rise: .8 + Math.random() * .6 }); }
    ring(pos, 0xff8a2e); bossHitT = 1.4;
  }
  function waterImpact(pos) {
    flash(pos, 0xbfe8ff, true); ring(pos, 0x8fe0ff); ring(pos, 0xffffff);
    const cr = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: WATERTEX, transparent: true, depthWrite: false })); cr.position.copy(pos); scene.add(cr); flashes.push({ m: cr, age: 0, life: .6, scale: true, grow: 7 });
    for (let i = 0; i < 46; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX, color: i % 2 ? 0xffffff : 0x7fd0ff, transparent: true, depthWrite: false })); s.position.copy(pos); s.scale.setScalar(.12 + Math.random() * .14); scene.add(s); const a = Math.random() * 6.28, sp = 1.5 + Math.random() * 3.5; droplets.push({ s, age: 0, life: .9 + Math.random() * .5, v: new THREE.Vector3(Math.cos(a) * sp, 1.5 + Math.random() * 2.5, Math.sin(a) * sp), g: 7 }); }
    bossHitT = 1.3;
  }
  function makeIceSpear(to) {
    const from = new THREE.Vector3(to.x + .3, to.y + 6, to.z);
    const g = new THREE.Group(); g.position.copy(from); scene.add(g);
    const mat = new THREE.MeshStandardMaterial({ color: 0x9fe4ff, emissive: 0x2aa8ff, emissiveIntensity: .8, roughness: .2, metalness: .1, flatShading: true, transparent: true, opacity: .93 });
    const main = new THREE.Mesh(new THREE.ConeGeometry(.42, 2, 6), mat); main.rotation.x = Math.PI; main.position.y = .3; g.add(main);
    for (let i = 0; i < 6; i++) { const sh = new THREE.Mesh(new THREE.ConeGeometry(.12 + Math.random() * .12, .6 + Math.random() * .7, 5), mat); const a = Math.random() * 6.28, r = .2 + Math.random() * .3; sh.position.set(Math.cos(a) * r, .5 + Math.random() * .5, Math.sin(a) * r); sh.rotation.x = Math.PI + (Math.random() - .5) * .5; sh.rotation.z = (Math.random() - .5) * .5; g.add(sh); }
    g.add(new THREE.PointLight(0x6fd0ff, 3, 7));
    return { kind: 'ice', g, mat, t: 0, dur: .44, from, to, trail: [], el: EL.ice, arc: 0, ease: true };
  }
  function iceImpact(pos) {
    flash(pos, 0xdff3ff, true); ring(pos, 0x9fe4ff); ring(pos, 0xffffff);
    const sm = new THREE.MeshStandardMaterial({ color: 0x9fe4ff, emissive: 0x2aa8ff, emissiveIntensity: .7, roughness: .2, flatShading: true, transparent: true, opacity: .95 });
    for (let i = 0; i < 20; i++) { const m = new THREE.Mesh(new THREE.ConeGeometry(.1 + Math.random() * .12, .4 + Math.random() * .5, 5), sm); m.position.copy(pos); m.rotation.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28); scene.add(m); const a = Math.random() * 6.28, sp = 1.5 + Math.random() * 3.5; shards.push({ m, age: 0, life: .9 + Math.random() * .5, v: new THREE.Vector3(Math.cos(a) * sp, 1 + Math.random() * 2.5, Math.sin(a) * sp), spin: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6), g: 7 }); }
    for (let i = 0; i < 12; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX, color: 0xdff3ff, transparent: true, opacity: .5, blending: THREE.AdditiveBlending, depthWrite: false })); s.position.copy(pos).add(new THREE.Vector3((Math.random() - .5) * 1.4, (Math.random() - .3), (Math.random() - .5) * 1.4)); s.scale.setScalar(.6); scene.add(s); smokes.push({ m: s, age: 0, life: .9 + Math.random() * .4, rise: .3 }); }
    bossHitT = 1.3;
  }
  function natureImpact(pos) {
    flash(pos, 0xaaff88, true); ring(pos, 0x8dff6a); ring(pos, 0xd0ffb0);
    const cr = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: NATURETEX, transparent: true, depthWrite: false })); cr.position.copy(pos); scene.add(cr); flashes.push({ m: cr, age: 0, life: .6, scale: true, grow: 7 });
    for (let i = 0; i < 24; i++) { const lf = new THREE.Sprite(new THREE.SpriteMaterial({ map: LEAFTEX, transparent: true, depthWrite: false })); lf.material.rotation = Math.random() * 6.28; lf.scale.setScalar(.3 + Math.random() * .25); lf.position.copy(pos); scene.add(lf); const a = Math.random() * 6.28, sp = 1.5 + Math.random() * 3; droplets.push({ s: lf, age: 0, life: 1 + Math.random() * .6, v: new THREE.Vector3(Math.cos(a) * sp, 1 + Math.random() * 2, Math.sin(a) * sp), g: 3 }); }
    for (let i = 0; i < 22; i++) { const sp2 = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX, color: 0xcfffa0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); sp2.scale.setScalar(.14 + Math.random() * .12); sp2.position.copy(pos); scene.add(sp2); const a = Math.random() * 6.28, sp = 1 + Math.random() * 2; droplets.push({ s: sp2, age: 0, life: 1.1 + Math.random() * .6, v: new THREE.Vector3(Math.cos(a) * sp * .6, .5 + Math.random() * 1.2, Math.sin(a) * sp * .6), g: -.6 }); }
    bossHitT = 1.2;
  }
  function earthErupt(to) {
    const gx = to.x, gz = to.z, gy = -1.55;
    const rockMat = new THREE.MeshStandardMaterial({ color: 0xb08a52, roughness: .95, flatShading: true });
    for (let i = 0; i < 7; i++) { const h = 1.5 + Math.random() * 1.8; const pil = new THREE.Mesh(new THREE.ConeGeometry(.34 + Math.random() * .26, h, 5), rockMat); const a = Math.random() * 6.28, r = Math.random() * 1.6; pil.position.set(gx + Math.cos(a) * r, gy, gz + Math.sin(a) * r); pil.rotation.set((Math.random() - .5) * .5, Math.random() * 6.28, (Math.random() - .5) * .5); scene.add(pil); risers.push({ m: pil, age: 0, life: 1.2, from: gy, peak: gy + h * .55 }); }
    for (let i = 0; i < 6; i++) { const b = new THREE.Mesh(new THREE.IcosahedronGeometry(.28 + Math.random() * .22, 0), rockMat); b.position.set(gx + (Math.random() - .5) * 1.2, gy, gz + (Math.random() - .5) * 1.2); scene.add(b); const a = Math.random() * 6.28, sp = 1 + Math.random() * 2.5; shards.push({ m: b, age: 0, life: 1.2 + Math.random() * .5, v: new THREE.Vector3(Math.cos(a) * sp, 3 + Math.random() * 3, Math.sin(a) * sp), spin: new THREE.Vector3(Math.random() * 4, Math.random() * 4, Math.random() * 4), g: 7, keep: true }); }
    for (let i = 0; i < 16; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: SMOKETEX, transparent: true, opacity: .5, depthWrite: false })); s.material.color = new THREE.Color(0xbfa98a); s.position.set(gx + (Math.random() - .5) * 2.4, gy + Math.random() * .4, gz + (Math.random() - .5) * 2.4); s.scale.setScalar(.9); scene.add(s); smokes.push({ m: s, age: 0, life: 1.3 + Math.random() * .6, rise: .5 + Math.random() * .5 }); }
    for (let i = 0; i < 8; i++) { const len = 1 + Math.random() * 2.2; const cr = new THREE.Mesh(new THREE.PlaneGeometry(.06, len), new THREE.MeshBasicMaterial({ color: 0xffb14a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); cr.rotation.x = -Math.PI / 2; cr.rotation.z = i / 8 * 6.28 + Math.random() * .3; cr.position.set(gx, gy + .02, gz); scene.add(cr); flashes.push({ m: cr, age: 0, life: .9, nogrow: true }); }
    flash(new THREE.Vector3(gx, gy + .5, gz), 0xffb14a, true); bossHitT = 1.5;
  }
  const WAVEFACETEX = (() => {
    const w = 128, h = 160, c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, h, 0, 0);
    g.addColorStop(0, 'rgba(18,86,170,0)'); g.addColorStop(.15, 'rgba(24,110,210,.85)'); g.addColorStop(.6, 'rgba(70,170,255,.9)'); g.addColorStop(.86, 'rgba(190,235,255,.95)'); g.addColorStop(1, 'rgba(255,255,255,.98)');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.globalCompositeOperation = 'lighter'; x.fillStyle = 'rgba(255,255,255,.9)';
    for (let i = 0; i < 46; i++) { x.beginPath(); x.arc(Math.random() * w, Math.random() * h * .3, 1 + Math.random() * 4, 0, 7); x.fill(); }
    x.strokeStyle = 'rgba(255,255,255,.22)'; x.lineWidth = 1;
    for (let i = 0; i < 14; i++) { const px = Math.random() * w; x.beginPath(); x.moveTo(px, h * .2 + Math.random() * h * .5); x.lineTo(px + (Math.random() - .5) * 10, h); x.stroke(); }
    return new THREE.CanvasTexture(c);
  })();
  function makeWaveMesh() {
    const geo = new THREE.PlaneGeometry(3.4, 3, 1, 10); const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) { const ny = (pos.getY(i) + 1.5) / 3; pos.setZ(i, Math.pow(ny, 2.2) * 1.7); }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: WAVEFACETEX, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.y = Math.PI / 2; return m;
  }
  function waterWave(to) {
    const from = new THREE.Vector3(-7, -1.0, to.z || 1.6);
    const grp = new THREE.Group(); grp.position.copy(from); scene.add(grp);
    const N = 420; const positions = new Float32Array(N * 3), colors = new Float32Array(N * 3), base = new Float32Array(N * 3), phase = new Float32Array(N);
    const cDeep = new THREE.Color(0x1f74d6), cMid = new THREE.Color(0x5ab0ff), cFoam = new THREE.Color(0xffffff);
    for (let n = 0; n < N; n++) { const b = n * 3; const z = (Math.random() * 2 - 1) * 1.7; const ny = Math.pow(Math.random(), .7); const y = ny * 2.6 - .4; const x = Math.pow(ny, 2) * 1.3 + (Math.random() - .5) * .7; base[b] = x; base[b + 1] = y; base[b + 2] = z; positions[b] = x; positions[b + 1] = y; positions[b + 2] = z; phase[n] = Math.random() * 6.28; const col = ny > .72 ? cFoam : (ny > .4 ? cMid : cDeep); colors[b] = col.r; colors[b + 1] = col.g; colors[b + 2] = col.b; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    grp.add(new THREE.Points(geo, new THREE.PointsMaterial({ size: .42, map: TEX, vertexColors: true, transparent: true, opacity: .92, depthWrite: false })));
    for (let l = 0; l < 2; l++) { const f = makeWaveMesh(); f.position.x = (l - .5) * .5; f.material.opacity = .5; grp.add(f); }
    const cp = []; for (let i = 0; i <= 6; i++) { const tt = i / 6; cp.push(new THREE.Vector3(.5, 1 + Math.sin(tt * Math.PI) * .3, (tt - .5) * 3.2)); }
    const curve = new THREE.CatmullRomCurve3(cp);
    grp.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, .9, 10, false), new THREE.MeshBasicMaterial({ color: 0x2f9ae6, transparent: true, opacity: .32, depthWrite: false })));
    grp.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, .24, 8, false), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false })));
    grp.add(new THREE.PointLight(0x2aa8ff, 3, 10));
    waves.push({ grp, geo, base, phase, N, t: 0, dur: .6, from, to: to.clone() });
  }
  function natureVines(to) {
    const from = new THREE.Vector3(-6.0, -1.0, 2.4);
    const mat = new THREE.MeshStandardMaterial({ color: 0x3f9f4a, emissive: 0x2f8f42, emissiveIntensity: .45, roughness: .85, flatShading: true });
    const grp = new THREE.Group(); scene.add(grp); const tubes = [];
    for (let v = 0; v < 5; v++) {
      const pts = [], segs = 9;
      for (let i = 0; i <= segs; i++) { const t = i / segs; const p = from.clone().lerp(to, t); const amp = Math.sin(t * Math.PI) * 1.3; p.x += Math.sin(t * 7 + v * 1.3) * amp * .5; p.y += Math.cos(t * 6 + v) * amp * .5 + (v - 2) * .2 * t; p.z += Math.sin(t * 5 + v * .7) * amp * .4; pts.push(p); }
      const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 44, .09 + Math.random() * .05, 6, false); geo.setDrawRange(0, 0);
      const m = new THREE.Mesh(geo, mat); grp.add(m); tubes.push({ m, count: geo.index.count, tip: pts });
    }
    grp.add(new THREE.PointLight(0x5adb6f, 2.5, 8));
    vines.push({ grp, tubes, t: 0, dur: .45, to: to.clone(), leafT: 0 });
  }
  function fireStream(to) {
    const from = new THREE.Vector3(-6.2, -0.2, 2.2);
    const dir = to.clone().sub(from).normalize();
    const dist = to.distanceTo(from);
    const light = new THREE.PointLight(0xff6a20, 4, 9); light.position.copy(from); scene.add(light);
    streams.push({ from, to: to.clone(), dir, dist, age: 0, life: .75, light });
  }
  function doSlash(to) {
    const front = new THREE.Vector3(0, 0, 3);
    for (let s = 0; s < 2; s++) { const ang = s === 0 ? -.7 : .7, dir = new THREE.Vector3(Math.cos(ang), Math.sin(ang), 0), half = 3.4;
      const from = to.clone().addScaledVector(dir, -half).add(front), end = to.clone().addScaledVector(dir, half).add(front);
      const lead = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); lead.scale.setScalar(.9); lead.position.copy(from); scene.add(lead);
      slashes.push({ lead, from, end, ang, mid: to.clone().add(front), age: 0, dur: .16 + s * .05, mark: false });
    }
    flash(to.clone().add(front), 0xffffff, true);
  }
  function shadowCast(to) {
    flash(to, 0x9a5cff, true); ring(to, 0x9a5cff);
    const grp = new THREE.Group(); scene.add(grp); const nt = 6;
    for (let f = 0; f < nt; f++) { const a = f / nt * 6.28, len = 1.6 + Math.random() * 1.2, pts = []; for (let i = 0; i <= 6; i++) { const t = i / 6, r = t * len, wob = Math.sin(t * 6 + f) * .5 * t; pts.push(new THREE.Vector3(to.x + Math.cos(a) * r + Math.cos(a + 1.57) * wob, to.y + Math.sin(a) * r * .6 + Math.sin(t * 5 + f) * .4, to.z + Math.sin(a) * r * .4)); } const mm = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, .08, 5, false), new THREE.MeshBasicMaterial({ color: 0x6a2fbf, transparent: true, opacity: .9, depthWrite: false })); mm.userData.base = .9; grp.add(mm); }
    gobjs.push({ grp, age: 0, life: .55 });
    for (let i = 0; i < 40; i++) { const a = Math.random() * 6.28, r = 2 + Math.random() * 1.5; const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX, color: Math.random() < .5 ? 0xb060ff : 0x3a1c66, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); s.position.copy(to).add(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, (Math.random() - .5))); s.scale.setScalar(.2 + Math.random() * .2); scene.add(s); droplets.push({ s, age: 0, life: .45, v: to.clone().sub(s.position).multiplyScalar(2.5), g: 0 }); }
    setTimeout(() => { for (let i = 0; i < 24; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: SHADOWTEX, transparent: true, depthWrite: false })); s.position.copy(to); s.scale.setScalar(.3); scene.add(s); const a = Math.random() * 6.28, sp = 1 + Math.random() * 2.5; droplets.push({ s, age: 0, life: .6, v: new THREE.Vector3(Math.cos(a) * sp, (Math.random() - .2) * sp, Math.sin(a) * sp), g: 1 }); } }, 260);
    for (let i = 0; i < 22; i++) { const sm = new THREE.Sprite(new THREE.SpriteMaterial({ map: SHADOWTEX, transparent: true, opacity: .55, depthWrite: false })); sm.position.copy(to).add(new THREE.Vector3((Math.random() - .5) * 3, (Math.random() - .5) * 2.8, (Math.random() - .5) * 1.4)); sm.scale.setScalar(.9 + Math.random() * .9); scene.add(sm); smokes.push({ m: sm, age: 0, life: 1.4 + Math.random() * .8, rise: .22 + Math.random() * .4 }); }
    for (let i = 0; i < 14; i++) { const sm = new THREE.Sprite(new THREE.SpriteMaterial({ map: SHADOWTEX, transparent: true, opacity: .4, depthWrite: false })); sm.position.copy(to).add(new THREE.Vector3((Math.random() - .5) * 4, (Math.random() - .5) * 3.4, (Math.random() - .5) * 1.6)); sm.scale.setScalar(1.6 + Math.random() * 1.4); scene.add(sm); smokes.push({ m: sm, age: 0, life: 1.8 + Math.random(), rise: .15 + Math.random() * .3 }); }
    for (let i = 0; i < 12; i++) { const sm = new THREE.Sprite(new THREE.SpriteMaterial({ map: SMOKETEX, transparent: true, opacity: .5, depthWrite: false })); sm.material.color = new THREE.Color(0x6a2fbf); sm.position.copy(to).add(new THREE.Vector3((Math.random() - .5) * 3.2, (Math.random() - .5) * 2.6, (Math.random() - .5) * 1.4)); sm.scale.setScalar(1.1 + Math.random() * 1.1); scene.add(sm); smokes.push({ m: sm, age: 0, life: 1.5 + Math.random() * .8, rise: .2 + Math.random() * .35 }); }
    bossHitT = 1.3;
  }
  function lightBurst(to) {
    flash(to, 0xffffff, true); flash(to, 0xffe27a, true); ring(to, 0xffffff); ring(to, 0xffe27a);
    for (let i = 0; i < 12; i++) { const g = new THREE.Mesh(new THREE.PlaneGeometry(.18, 5.5), new THREE.MeshBasicMaterial({ color: 0xfff3b0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); g.position.copy(to); g.lookAt(camera.position); g.rotation.z = i / 12 * 6.28 + Math.random() * .2; scene.add(g); flashes.push({ m: g, age: 0, life: .45, scale: true, grow: .6 }); }
    for (let i = 0; i < 44; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX, color: 0xfff3b0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); s.position.copy(to); s.scale.setScalar(.1 + Math.random() * .16); scene.add(s); const a = Math.random() * 6.28, sp = 1 + Math.random() * 3.2; droplets.push({ s, age: 0, life: .5 + Math.random() * .4, v: new THREE.Vector3(Math.cos(a) * sp, (Math.random() - .3) * sp, Math.sin(a) * sp), g: .5 }); }
    bossHitT = 1.3;
  }
  function lightCast(to) {
    const top = new THREE.Vector3(to.x, to.y + 6, to.z);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(.5, .75, 6, 14, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff3b0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    col.position.set(to.x, to.y + 3, to.z); scene.add(col);
    const orb = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); orb.scale.setScalar(1.3); orb.position.copy(top); scene.add(orb);
    orb.add(new THREE.PointLight(0xfff3b0, 4, 10));
    beams.push({ col, orb, top, to: to.clone(), age: 0, dur: .28, hit: false });
  }
  function arcaneCast(to) {
    for (const [sz, rot] of [[4, 2.2], [2.5, -3.2]]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(sz, sz), new THREE.MeshBasicMaterial({ map: ARCANETEX, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); m.position.copy(to).add(new THREE.Vector3(0, 0, 3)); m.lookAt(camera.position); scene.add(m); flashes.push({ m, age: 0, life: .9, nogrow: true, rot }); }
    flash(to, 0x8fd0ff, true); ring(to, 0xbfe0ff);
    for (let i = 0; i < 26; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX, color: Math.random() < .5 ? 0x9fd0ff : 0xe06aff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); s.position.copy(to); s.scale.setScalar(.14); scene.add(s); const a = Math.random() * 6.28, sp = 1 + Math.random() * 2.5; droplets.push({ s, age: 0, life: .6, v: new THREE.Vector3(Math.cos(a) * sp, (Math.random() - .3) * sp, Math.sin(a) * sp), g: .4 }); }
    bossHitT = 1.2;
  }
  function psychicWave(to) {
    const cols = [0xff6ad0, 0x7fd0ff, 0xe06aff];
    for (let r = 0; r < 5; r++) setTimeout(() => ring(to, cols[r % cols.length]), r * 110);
    flash(to, 0xff9ae0, true);
    for (let i = 0; i < 30; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX, color: Math.random() < .5 ? 0xff6ad0 : 0x9fd0ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); s.position.copy(to); s.scale.setScalar(.14); scene.add(s); const a = Math.random() * 6.28, sp = 1 + Math.random() * 2; droplets.push({ s, age: 0, life: .7, v: new THREE.Vector3(Math.cos(a) * sp, (Math.random() - .4) * sp, Math.sin(a) * sp), g: .3 }); }
    bossHitT = 1.2;
  }
  function makeToxicBlob(to) {
    const g = new THREE.Group(); g.position.copy(START); scene.add(g);
    g.add(new THREE.Sprite(new THREE.SpriteMaterial({ map: TOXICTEX, transparent: true, depthWrite: false }))); g.children[0].scale.setScalar(1.2);
    g.add(new THREE.Mesh(new THREE.SphereGeometry(.3, 12, 12), new THREE.MeshBasicMaterial({ color: 0x7cd62c, transparent: true, opacity: .8 })));
    g.add(new THREE.PointLight(0x9cd93c, 3, 7));
    return { kind: 'toxic', g, t: 0, dur: .5, from: START.clone(), to, trail: [], el: EL.toxic, arc: 1.4 };
  }
  function toxicImpact(pos) {
    flash(pos, 0x9cd93c, true); ring(pos, 0x9cd93c);
    for (let b = 0; b < 6; b++) { const cr = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: TOXICTEX, transparent: true, depthWrite: false })); cr.position.copy(pos).add(new THREE.Vector3((Math.random() - .5) * 1.8, (Math.random() - .3) * 1.5, .3 + b * .02)); cr.lookAt(camera.position); cr.scale.setScalar(.6 + Math.random() * .9); cr.material.opacity = .88; scene.add(cr); flashes.push({ m: cr, age: 0, life: 1.5 + Math.random() * .7, scale: true, grow: 1.4 + Math.random() }); }
    for (let i = 0; i < 16; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TOXICTEX, transparent: true, depthWrite: false })); s.position.copy(pos); s.scale.setScalar(.2 + Math.random() * .24); scene.add(s); const a = Math.random() * 6.28, sp = 1 + Math.random() * 2.4; droplets.push({ s, age: 0, life: .6 + Math.random() * .4, v: new THREE.Vector3(Math.cos(a) * sp, .5 + Math.random() * 1.6, Math.sin(a) * sp), g: 6 }); }
    for (let i = 0; i < 36; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TOXICTEX, transparent: true, depthWrite: false })); s.position.copy(pos).add(new THREE.Vector3((Math.random() - .5) * 2.6, (Math.random() - .1) * 1.9, .4)); s.scale.set(.17 + Math.random() * .14, .42 + Math.random() * .75, 1); scene.add(s); droplets.push({ s, age: 0, life: 1.9 + Math.random() * 1.2, v: new THREE.Vector3(0, -.28 - Math.random() * .45, 0), g: .33 }); }
    for (let i = 0; i < 12; i++) { const sm = new THREE.Sprite(new THREE.SpriteMaterial({ map: SMOKETEX, transparent: true, opacity: .4, depthWrite: false })); sm.material.color = new THREE.Color(0x9cd93c); sm.position.copy(pos).add(new THREE.Vector3((Math.random() - .5) * 1.6, Math.random() * .7, (Math.random() - .5) * 1.6)); sm.scale.setScalar(.8); scene.add(sm); smokes.push({ m: sm, age: 0, life: 1.2 + Math.random() * .6, rise: .45 }); }
    bossHitT = 1.3;
  }
  function makeFist(to) {
    const g = new THREE.Group(); g.position.copy(START); scene.add(g);
    const fist = new THREE.Sprite(new THREE.SpriteMaterial({ map: FISTTEX, transparent: true, depthWrite: false })); fist.scale.setScalar(1.2); g.add(fist);
    g.add(new THREE.PointLight(0xffe27a, 3, 7));
    return { kind: 'fist', g, fist, t: 0, dur: .32, from: START.clone(), to, trail: [], el: EL.physical, arc: .4, ease: true };
  }
  function physicalImpact(pos) {
    flash(pos, 0xffffff, true); flash(pos, 0xffe27a, true); ring(pos, 0xffd23e);
    for (let i = 0; i < 12; i++) { const g = new THREE.Mesh(new THREE.PlaneGeometry(.2, 3.8), new THREE.MeshBasicMaterial({ color: 0xffd23e, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); g.position.copy(pos); g.lookAt(camera.position); g.rotation.z = i / 12 * 6.28; scene.add(g); flashes.push({ m: g, age: 0, life: .35, scale: true, grow: .5 }); }
    for (let i = 0; i < 22; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX, color: 0xfff0c0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); s.position.copy(pos); s.scale.setScalar(.15 + Math.random() * .15); scene.add(s); const a = Math.random() * 6.28, sp = 2 + Math.random() * 4; droplets.push({ s, age: 0, life: .4 + Math.random() * .3, v: new THREE.Vector3(Math.cos(a) * sp, (Math.random() - .2) * sp, Math.sin(a) * sp), g: 3 }); }
    bossHitT = 1.6;
  }
  function airCast(to) {
    const grp = new THREE.Group(); grp.position.copy(to); scene.add(grp);
    for (let i = 0; i < 4; i++) { const r = 1.6 - i * .32, h = 3.6; const cone = new THREE.Mesh(new THREE.CylinderGeometry(r, r * .2, h, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xdff2ff, transparent: true, opacity: .22, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false })); cone.position.y = h / 2 - 1.5; cone.material.userData.baseOp = .22; grp.add(cone); }
    for (let b = 0; b < 5; b++) { const yy = -1 + b * .8, rad = .7 + (yy + 1) * .18; const blade = new THREE.Mesh(new THREE.RingGeometry(rad, rad + .5, 24, 1, 0, 1.6), new THREE.MeshBasicMaterial({ color: 0xeaffff, transparent: true, opacity: .5, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false })); blade.material.userData.baseOp = .5; blade.position.y = yy; blade.rotation.x = -Math.PI / 2 + .3; blade.rotation.z = b * 1.2; grp.add(blade); }
    grp.add(new THREE.PointLight(0xbfeaff, 2.5, 9));
    tornadoes.push({ grp, age: 0, life: .9, to: to.clone(), spawnT: 0 });
  }

  function fire(elName) {
    const el = EL[elName] || EL.physical; const key = EL[elName] ? elName : 'physical';
    const to = new THREE.Vector3((Math.random() - .5) * .8, 1.4 + (Math.random() - .5) * .6, 1.6);
    if (key === 'fire') return void fireStream(to);
    if (key === 'air') return void airCast(to);
    if (key === 'metal') return void doSlash(to);
    if (key === 'shadow') return void shadowCast(to);
    if (key === 'light') return void lightCast(to);
    if (key === 'arcane') return void arcaneCast(to);
    if (key === 'psychic') return void psychicWave(to);
    if (key === 'toxic') return void projs.push(makeToxicBlob(to));
    if (key === 'physical') return void projs.push(makeFist(to));
    if (key === 'water') return void waterWave(to);
    if (key === 'nature') return void natureVines(to);
    if (key === 'ice') return void projs.push(makeIceSpear(to));
    if (key === 'earth') return void earthErupt(to);
    if (key === 'lightning') return void lightningStrike(to);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(.36, 16, 16), new THREE.MeshBasicMaterial({ color: el.c }));
    orb.position.copy(START); scene.add(orb);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX, color: el.c2, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.set(1.7, 1.7, 1.7); orb.add(halo); orb.add(new THREE.PointLight(el.c, 3, 8));
    projs.push({ kind: 'orb', orb, el, t: 0, dur: .42, from: START.clone(), to, trail: [] });
  }

  // The BOSS's own attacks on its turn (origin = the boss, aimed at the player).
  function bossFire(kind) {
    const O = new THREE.Vector3(0, 1.15, 0.7), ground = new THREE.Vector3(0, -1.45, 0.3);
    if (kind === 'slam' || kind === 'strike') {
      flash(ground, 0xffcf7a, true);
      for (let i = 0; i < 3; i++) groundRing(ground, i % 2 ? 0xffb14a : 0xffd8a0);
      for (let i = 0; i < 16; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: SMOKETEX, transparent: true, opacity: .5, depthWrite: false })); s.material.color = new THREE.Color(0x6a5a4a); s.position.copy(ground).add(new THREE.Vector3((Math.random() - .5) * 3, Math.random() * .4, (Math.random() - .5) * 2)); s.scale.setScalar(.9); scene.add(s); smokes.push({ m: s, age: 0, life: 1.1 + Math.random() * .5, rise: .5 }); }
      const rockMat = new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: .9, flatShading: true });
      for (let i = 0; i < 12; i++) { const b = new THREE.Mesh(new THREE.IcosahedronGeometry(.16 + Math.random() * .14, 0), rockMat); b.position.copy(ground); scene.add(b); const a = Math.random() * 6.28, sp = 2 + Math.random() * 3; shards.push({ m: b, age: 0, life: 1 + Math.random() * .5, v: new THREE.Vector3(Math.cos(a) * sp, 3 + Math.random() * 3, Math.sin(a) * sp), spin: new THREE.Vector3(Math.random() * 5, Math.random() * 5, Math.random() * 5), g: 8, keep: true }); }
      if (kind === 'strike') { const front = new THREE.Vector3(0, 1.0, 1.4); for (let s2 = 0; s2 < 3; s2++) { const ang = -.5 + s2 * .5; const blade = new THREE.Mesh(new THREE.RingGeometry(.9, 1.4, 32, 1, .4, 2.0), new THREE.MeshBasicMaterial({ color: 0xff4a3a, transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false })); blade.position.copy(front); blade.lookAt(camera.position); blade.rotation.z += ang; scene.add(blade); flashes.push({ m: blade, age: 0, life: .3, scale: true, grow: .8, rot: 7 }); } flash(front, 0xff5a3a, true); }
    } else if (kind === 'enrage') {
      flash(O, 0xff3a10, true); flash(O, 0xffb020, true);
      for (let i = 0; i < 3; i++) ring(O, 0xff5a2a);
      for (let i = 0; i < 30; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX, color: Math.random() < .5 ? 0xffd23e : 0xff5a1e, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); s.position.copy(O).add(new THREE.Vector3((Math.random() - .5) * 2, (Math.random() - .5) * 2, (Math.random() - .5))); s.scale.setScalar(.14 + Math.random() * .16); scene.add(s); const a = Math.random() * 6.28, sp = 1 + Math.random() * 2; droplets.push({ s, age: 0, life: .7, v: new THREE.Vector3(Math.cos(a) * sp * .5, 1 + Math.random() * 2, Math.sin(a) * sp * .5), g: -.5 }); }
    } else if (kind === 'curse') {
      flash(O, 0x9a3cff, true);
      for (let i = 0; i < 18; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: SHADOWTEX, transparent: true, depthWrite: false })); s.position.copy(O); s.scale.setScalar(.3 + Math.random() * .3); scene.add(s); const spd = 2 + Math.random() * 3; droplets.push({ s, age: 0, life: .8, v: new THREE.Vector3((Math.random() - .5) * 1.5, (Math.random() - .3) * 1.5, spd), g: 0 }); }
      for (let i = 0; i < 10; i++) { const sm = new THREE.Sprite(new THREE.SpriteMaterial({ map: SHADOWTEX, transparent: true, opacity: .5, depthWrite: false })); sm.position.copy(O).add(new THREE.Vector3((Math.random() - .5) * 1.5, (Math.random() - .5) * 1.5, .5)); sm.scale.setScalar(1 + Math.random()); scene.add(sm); smokes.push({ m: sm, age: 0, life: 1.2, rise: .2 }); }
    } else if (kind === 'stunned') {
      for (let i = 0; i < 8; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX, color: 0xffe23e, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); s.position.set((Math.random() - .5) * 1.5, 2.2 + (Math.random() - .5) * .5, .4 + (Math.random() - .5)); s.scale.setScalar(.2); scene.add(s); const a = Math.random() * 6.28; droplets.push({ s, age: 0, life: .9, v: new THREE.Vector3(Math.cos(a), .3, Math.sin(a)), g: -.2 }); }
    }
  }

  function update(dt, t) {
    for (let i = projs.length - 1; i >= 0; i--) {
      const p = projs[i]; p.t += dt / p.dur; const k = Math.min(1, p.t);
      const kp = p.ease ? k * k : k;
      const pos = p.from.clone().lerp(p.to, kp); pos.y += Math.sin(k * Math.PI) * (p.arc != null ? p.arc : 1.6);
      const node = p.g || p.orb; node.position.copy(pos);
      if (p.kind === 'ice') {
        p.g.rotation.y += dt * 3;
        const fr = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX, color: 0xcfeeff, transparent: true, opacity: .55, blending: THREE.AdditiveBlending, depthWrite: false })); fr.scale.setScalar(.5); fr.position.copy(pos); scene.add(fr); p.trail.push({ s: fr, age: 0, dr: 3, fix: .5 });
        if (Math.random() < .6) { const sh = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX, color: 0x9fe4ff, transparent: true, depthWrite: false })); sh.scale.setScalar(.14); sh.position.copy(pos); scene.add(sh); const a = Math.random() * 6.28; droplets.push({ s: sh, age: 0, life: .5, v: new THREE.Vector3(Math.cos(a), -.5 - Math.random(), Math.sin(a)), g: 5 }); }
      } else if (p.kind === 'toxic') {
        p.g.rotation.z += dt * 4; const sq = 1 + Math.sin(t * 20) * .12; p.g.scale.set(1 / sq, sq, 1);
        if (Math.random() < .5) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX, color: 0x9cd93c, transparent: true, depthWrite: false })); s.position.copy(pos); s.scale.setScalar(.14); scene.add(s); droplets.push({ s, age: 0, life: .5, v: new THREE.Vector3((Math.random() - .5), -1 - Math.random(), (Math.random() - .5)), g: 6 }); }
      } else if (p.kind === 'fist') {
        const sc = .8 + k * 1.6; p.fist.scale.setScalar(1.2 * sc);
        const gh = new THREE.Sprite(new THREE.SpriteMaterial({ map: FISTTEX, transparent: true, opacity: .4, depthWrite: false })); gh.scale.setScalar(1.2 * sc); gh.position.copy(pos); scene.add(gh); p.trail.push({ s: gh, age: 0, dr: 5, fix: 1.2 * sc });
      } else {
        const tp = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX, color: p.el.c2, transparent: true, opacity: .8, blending: THREE.AdditiveBlending, depthWrite: false })); tp.scale.setScalar(.7); tp.position.copy(pos); scene.add(tp); p.trail.push({ s: tp, age: 0, dr: 4, fix: .7 });
      }
      for (let j = p.trail.length - 1; j >= 0; j--) { const tr = p.trail[j]; tr.age += dt; tr.s.material.opacity = Math.max(0, .85 - tr.age * (tr.dr || 4)); if (tr.gr) tr.s.scale.multiplyScalar(1 + dt * tr.gr); else if (tr.fix) tr.s.scale.setScalar(Math.max(.01, tr.fix - tr.age * 2)); if (tr.s.material.opacity <= 0) { scene.remove(tr.s); p.trail.splice(j, 1); } }
      if (k >= 1) {
        if (p.kind === 'ice') iceImpact(pos.clone());
        else if (p.kind === 'toxic') toxicImpact(pos.clone());
        else if (p.kind === 'fist') physicalImpact(pos.clone());
        else burst(pos.clone(), p.el);
        scene.remove(node); p.trail.forEach((tr) => scene.remove(tr.s)); projs.splice(i, 1);
      }
    }
    for (let i = emberSys.length - 1; i >= 0; i--) { const b = emberSys[i]; b.age += dt; const pos = b.geo.attributes.position.array; let alive = 0; for (let j = 0; j < b.N; j++) { if (b.life[j] <= 0) continue; alive++; b.life[j] -= dt; const v = b.vel[j]; v.y -= .8 * dt; v.multiplyScalar(.97); pos[j * 3] += v.x * dt; pos[j * 3 + 1] += v.y * dt; pos[j * 3 + 2] += v.z * dt; } b.geo.attributes.position.needsUpdate = true; b.mat.opacity = Math.max(0, 1 - b.age / 1.4); if (alive === 0 || b.age > 1.6) { scene.remove(b.pts); b.geo.dispose(); b.mat.dispose(); emberSys.splice(i, 1); } }
    for (let i = flames.length - 1; i >= 0; i--) { const f = flames[i]; f.age += dt; const k = f.age / f.life; f.m.position.y += (f.rise || 1) * dt; f.m.scale.setScalar(.6 + k * 1.4); f.m.material.opacity = Math.max(0, 1 - k); if (k >= 1) { scene.remove(f.m); flames.splice(i, 1); } }
    for (let i = smokes.length - 1; i >= 0; i--) { const s = smokes[i]; s.age += dt; const k = s.age / s.life; s.m.position.y += (s.rise || .8) * dt; s.m.scale.setScalar(.8 + k * 2.2); s.m.material.opacity = Math.max(0, .5 * (1 - k)); if (k >= 1) { scene.remove(s.m); smokes.splice(i, 1); } }
    for (let i = droplets.length - 1; i >= 0; i--) { const d = droplets[i]; d.age += dt; d.v.y -= (d.g || 6) * dt; d.v.multiplyScalar(.98); d.s.position.addScaledVector(d.v, dt); d.s.material.opacity = Math.max(0, 1 - d.age / d.life); if (d.age >= d.life) { scene.remove(d.s); droplets.splice(i, 1); } }
    for (let i = strikes.length - 1; i >= 0; i--) { const st = strikes[i]; st.age += dt; st.flick += dt; if (st.flick > .04) { st.flick = 0; st.rebuild(); } const op = Math.max(0, 1 - st.age / st.life); st.grp.traverse((o) => { if (o.material) o.material.opacity = op * (o.material.userData ? o.material.userData.base || 1 : 1); }); if (st.age >= st.life) { st.grp.traverse((o) => o.geometry && o.geometry.dispose()); scene.remove(st.grp); strikes.splice(i, 1); } }
    for (let i = shards.length - 1; i >= 0; i--) { const s = shards[i]; s.age += dt; s.v.y -= (s.g || 7) * dt; s.m.position.addScaledVector(s.v, dt); s.m.rotation.x += s.spin.x * dt; s.m.rotation.y += s.spin.y * dt; s.m.rotation.z += s.spin.z * dt; if (s.m.material.transparent) s.m.material.opacity = Math.max(0, 1 - s.age / s.life); if (s.age >= s.life) { scene.remove(s.m); shards.splice(i, 1); } }
    for (let i = risers.length - 1; i >= 0; i--) { const r = risers[i]; r.age += dt; const k = r.age / r.life; let y; if (k < .25) y = r.from + (r.peak - r.from) * (k / .25); else if (k < .65) y = r.peak; else y = r.peak - (r.peak - r.from) * ((k - .65) / .35); r.m.position.y = y; if (k >= 1) { scene.remove(r.m); r.m.geometry.dispose(); risers.splice(i, 1); } }
    for (let i = waves.length - 1; i >= 0; i--) { const w = waves[i]; w.t += dt / w.dur; const k = Math.min(1, w.t); const pos = w.from.clone().lerp(w.to, k * k); pos.y += Math.sin(k * Math.PI) * .4; w.grp.position.copy(pos); w.grp.scale.set(.9 + k * .7, .9 + k * 1.2, .9 + k * .7); w.grp.rotation.z = -.18 * k;
      const arr = w.geo.attributes.position.array; for (let n = 0; n < w.N; n++) { const b = n * 3, ph = w.phase[n]; arr[b] = w.base[b] + Math.sin(t * 3 + ph) * .12; arr[b + 1] = w.base[b + 1] + Math.cos(t * 2.5 + ph) * .1; arr[b + 2] = w.base[b + 2] + Math.sin(t * 2 + ph * 1.3) * .12; } w.geo.attributes.position.needsUpdate = true;
      if (Math.random() < .95) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX, color: Math.random() < .5 ? 0xffffff : 0x9fd8ff, transparent: true, depthWrite: false })); s.position.copy(pos).add(new THREE.Vector3(1 + Math.random() * 1.5, 1 + Math.random() * 1.6, (Math.random() - .5) * 3)); s.scale.setScalar(.12 + Math.random() * .14); scene.add(s); droplets.push({ s, age: 0, life: .5 + Math.random() * .4, v: new THREE.Vector3(.5 + Math.random() * 2, .3 + Math.random() * 1.5, (Math.random() - .5) * 2), g: 7 }); } if (k >= 1) { waterImpact(w.to.clone()); scene.remove(w.grp); w.geo.dispose(); waves.splice(i, 1); } }
    for (let i = vines.length - 1; i >= 0; i--) { const vn = vines[i]; vn.t += dt / vn.dur; const k = Math.min(1, vn.t); for (const tb of vn.tubes) tb.m.geometry.setDrawRange(0, Math.floor(k * tb.count)); vn.leafT += dt; if (vn.leafT > .05 && k < 1) { vn.leafT = 0; const tb = vn.tubes[Math.floor(Math.random() * vn.tubes.length)]; const tp = tb.tip[Math.min(tb.tip.length - 1, Math.floor(k * tb.tip.length))]; const lf = new THREE.Sprite(new THREE.SpriteMaterial({ map: LEAFTEX, transparent: true, depthWrite: false })); lf.material.rotation = Math.random() * 6.28; lf.scale.setScalar(.3); lf.position.copy(tp); scene.add(lf); const a = Math.random() * 6.28; droplets.push({ s: lf, age: 0, life: .9, v: new THREE.Vector3(Math.cos(a) * .8, Math.random(), Math.sin(a) * .8), g: 1.5 }); } if (k >= 1 && !vn.hit) { vn.hit = true; natureImpact(vn.to.clone()); } if (vn.hit) { vn.hold = (vn.hold || 0) + dt; if (vn.hold > .6) { vn.grp.traverse((o) => o.geometry && o.geometry.dispose()); scene.remove(vn.grp); vines.splice(i, 1); } } }
    for (let i = streams.length - 1; i >= 0; i--) { const st = streams[i]; st.age += dt; if (st.age < st.life) {
      for (let n = 0; n < 9; n++) { const tt = Math.random(); const p = st.from.clone().addScaledVector(st.dir, tt * st.dist); const spread = .25 + tt * 1.0; p.add(new THREE.Vector3((Math.random() - .5) * spread, (Math.random() - .5) * spread + tt * .2, (Math.random() - .5) * spread)); const v = st.dir.clone().multiplyScalar(2 + Math.random() * 2).add(new THREE.Vector3((Math.random() - .5), Math.random() * .8, (Math.random() - .5))); const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: FIRETEX, color: Math.random() < .5 ? 0xffa030 : 0xff5a1e, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); s.scale.setScalar(.35 + tt * .8); s.position.copy(p); scene.add(s); jetp.push({ s, age: 0, life: .3 + Math.random() * .2, v, grow: 1.1 }); }
      if (Math.random() < .5) { const sm = new THREE.Sprite(new THREE.SpriteMaterial({ map: SMOKETEX, transparent: true, opacity: .4, depthWrite: false })); sm.position.copy(st.to).add(new THREE.Vector3((Math.random() - .5), Math.random() * .6, (Math.random() - .5))); sm.scale.setScalar(.8); scene.add(sm); smokes.push({ m: sm, age: 0, life: 1 + Math.random() * .5, rise: .8 }); }
    } else { scene.remove(st.light); fireImpact(st.to.clone()); streams.splice(i, 1); } }
    for (let i = jetp.length - 1; i >= 0; i--) { const j = jetp[i]; j.age += dt; j.s.position.addScaledVector(j.v, dt); j.v.multiplyScalar(.94); j.s.scale.multiplyScalar(1 + dt * (j.grow || 1)); j.s.material.opacity = Math.max(0, 1 - j.age / j.life); if (j.age >= j.life) { scene.remove(j.s); jetp.splice(i, 1); } }
    for (let i = beams.length - 1; i >= 0; i--) { const b = beams[i]; b.age += dt; const k = Math.min(1, b.age / b.dur); b.orb.position.lerpVectors(b.top, b.to, k * k); b.col.material.opacity = k < 1 ? k * .8 : Math.max(0, .8 - (b.age - b.dur) * 2.5); if (k < 1 && Math.random() < .8) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX, color: 0xfff3b0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); s.position.copy(b.orb.position); s.scale.setScalar(.5); scene.add(s); droplets.push({ s, age: 0, life: .3, v: new THREE.Vector3((Math.random() - .5), -1, (Math.random() - .5)), g: 0 }); } if (k >= 1 && !b.hit) { b.hit = true; lightBurst(b.to.clone()); scene.remove(b.orb); } if (b.hit && b.col.material.opacity <= 0) { scene.remove(b.col); b.col.geometry.dispose(); beams.splice(i, 1); } }
    for (let i = tornadoes.length - 1; i >= 0; i--) { const tn = tornadoes[i]; tn.age += dt; const k = tn.age / tn.life; tn.grp.rotation.y += dt * 12; const op = k < .2 ? k / .2 : (k > .8 ? (1 - k) / .2 : 1); tn.grp.traverse((o) => { if (o.isMesh && o.material) o.material.opacity = (o.material.userData.baseOp || .16) * op; }); tn.spawnT += dt; if (tn.spawnT > .02) { tn.spawnT = 0; for (let n = 0; n < 3; n++) { const ang = Math.random() * 6.28, rad = .4 + Math.random() * 1, s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX, color: Math.random() < .3 ? 0xffffff : 0xbfeaff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); s.scale.setScalar(.2 + Math.random() * .2); const py = tn.to.y - 1.3 + Math.random() * 3; s.position.set(tn.to.x + Math.cos(ang) * rad, py, tn.to.z + Math.sin(ang) * rad); scene.add(s); windp.push({ s, age: 0, life: .5, cx: tn.to.x, cz: tn.to.z, ang, rad, y: py, vy: 2 + Math.random() * 2, spin: 6 + Math.random() * 4 }); } } if (k >= 1) { tn.grp.traverse((o) => o.geometry && o.geometry.dispose()); scene.remove(tn.grp); tornadoes.splice(i, 1); } }
    for (let i = windp.length - 1; i >= 0; i--) { const w = windp[i]; w.age += dt; w.ang += w.spin * dt; w.y += w.vy * dt; w.rad *= .99; w.s.position.set(w.cx + Math.cos(w.ang) * w.rad, w.y, w.cz + Math.sin(w.ang) * w.rad); w.s.material.opacity = Math.max(0, 1 - w.age / w.life); if (w.age >= w.life) { scene.remove(w.s); windp.splice(i, 1); } }
    for (let i = slashes.length - 1; i >= 0; i--) { const sl = slashes[i]; sl.age += dt; const k = Math.min(1, sl.age / sl.dur); sl.lead.position.lerpVectors(sl.from, sl.end, k);
      const seg = new THREE.Mesh(new THREE.PlaneGeometry(.8, .16), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false })); seg.position.copy(sl.lead.position); seg.lookAt(camera.position); seg.rotation.z += sl.ang; scene.add(seg); flashes.push({ m: seg, age: 0, life: .35, nogrow: true });
      const fc = [0x9fe0ff, 0xffe08a, 0xff9fe0][Math.floor(Math.random() * 3)]; const fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX, color: fc, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); fl.scale.setScalar(.3); fl.position.copy(sl.lead.position); scene.add(fl); droplets.push({ s: fl, age: 0, life: .3, v: new THREE.Vector3((Math.random() - .5) * 2, (Math.random() - .5) * 2, 0), g: 0 });
      if (k >= 1 && !sl.mark) { sl.mark = true; scene.remove(sl.lead); const len = sl.from.distanceTo(sl.end);
        [[0x9fe0ff, .34], [0xffe08a, .24], [0xffffff, .12]].forEach(([col, h]) => { const mk = new THREE.Mesh(new THREE.PlaneGeometry(len, h), new THREE.MeshBasicMaterial({ color: col, transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false })); mk.position.copy(sl.mid); mk.lookAt(camera.position); mk.rotation.z += sl.ang; scene.add(mk); flashes.push({ m: mk, age: 0, life: .6, nogrow: true }); });
        flash(sl.end, 0xffffff, true);
        for (let n = 0; n < 12; n++) { const c2 = [0xffffff, 0x9fe0ff, 0xffe08a, 0xff9fe0][n % 4]; const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX, color: c2, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); sp.position.copy(sl.end); sp.scale.setScalar(.16); scene.add(sp); const a = Math.random() * 6.28, spd = 2 + Math.random() * 3; droplets.push({ s: sp, age: 0, life: .4, v: new THREE.Vector3(Math.cos(a) * spd, Math.sin(a) * spd, 0), g: 2 }); }
        slashes.splice(i, 1); }
    }
    for (let i = bursts.length - 1; i >= 0; i--) { const b = bursts[i]; b.age += dt; const pos = b.geo.attributes.position.array; let alive = 0; for (let j = 0; j < b.N; j++) { if (b.life[j] <= 0) continue; alive++; b.life[j] -= dt; const v = b.vel[j]; if (b.p.implode && b.age < .18) { } else { v.y -= b.p.grav * dt; } v.multiplyScalar(b.p.drag); pos[j * 3] += v.x * dt; pos[j * 3 + 1] += v.y * dt; pos[j * 3 + 2] += v.z * dt; } b.geo.attributes.position.needsUpdate = true; b.mat.opacity = Math.max(0, 1 - b.age / b.p.life); if (alive === 0 || b.age > b.p.life * 1.4) { scene.remove(b.pts); b.geo.dispose(); b.mat.dispose(); bursts.splice(i, 1); } }
    for (let i = rings.length - 1; i >= 0; i--) { const r = rings[i]; r.age += dt; const k = r.age / r.life; r.m.scale.setScalar(1 + k * 10); r.m.material.opacity = Math.max(0, 1 - k); if (k >= 1) { scene.remove(r.m); rings.splice(i, 1); } }
    for (let i = flashes.length - 1; i >= 0; i--) { const f = flashes[i]; f.age += dt; if (f.rot) f.m.rotation.z += f.rot * dt; const k = f.age / f.life; f.m.material.opacity = Math.max(0, (f.scale ? .9 : .8) * (1 - k)); if (f.scale) f.m.scale.setScalar(1 + k * (f.grow || .8)); else if (!f.nogrow) f.m.scale.setScalar(1 + k * 1.4); if (k >= 1) { scene.remove(f.m); flashes.splice(i, 1); } }
    for (let i = gobjs.length - 1; i >= 0; i--) { const g = gobjs[i]; g.age += dt; const k = g.age / g.life; g.grp.traverse((o) => { if (o.material) o.material.opacity = (o.userData.base || .9) * (1 - k); }); if (k >= 1) { g.grp.traverse((o) => o.geometry && o.geometry.dispose()); scene.remove(g.grp); gobjs.splice(i, 1); } }
    for (let i = boltsFx.length - 1; i >= 0; i--) { const bl = boltsFx[i]; bl.age += dt; bl.l.material.opacity = Math.max(0, 1 - bl.age / bl.life); if (bl.age >= bl.life) { scene.remove(bl.l); boltsFx.splice(i, 1); } }
  }

  return { fire, bossFire, update };
}
