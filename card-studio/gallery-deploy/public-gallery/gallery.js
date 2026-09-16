// Tier labels come from the gallery payload (server-side rarity.js is the single
// source), so a new tier shows its real name + color with no edit here.
let LABEL = {};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const el = (id) => document.getElementById(id);

let subjects = [];
let backUrl = '';
let flat = []; // cards in render order, each with its subject name, for click lookup
let holoTiers = new Set(); // tiers that get the holographic overlay (foil / animated)

async function load() {
  try {
    const data = await (await fetch('/api/gallery')).json();
    subjects = data.subjects || [];
    backUrl = data.backUrl || '';
    const tiers = data.tiers || [];
    LABEL = Object.fromEntries(tiers.map((t) => [t.key, t.label]));
    holoTiers = new Set(tiers.filter((t) => t.animated).map((t) => t.key));
    // Generate badge colors from each tier's accent (no CSS edit per tier).
    const css = tiers.map((t) => `.badge.${t.key}{background:${t.accent}}`).join('');
    let tag = document.getElementById('tier-colors');
    if (!tag) { tag = document.createElement('style'); tag.id = 'tier-colors'; document.head.appendChild(tag); }
    tag.textContent = css;
    el('count').textContent =
      `Season 1 · ${subjects.reduce((n, s) => n + s.cards.length, 0)} cards`;
    render();
  } catch {
    el('gallery').textContent = 'Could not load the gallery.';
  }
}

function render() {
  const q = el('search').value.trim().toLowerCase();
  const main = el('gallery');
  main.classList.remove('loading');
  flat = [];
  // All cards under ONE section ("Season 1"), kept in subject order.
  const cards = [];
  for (const s of subjects) {
    for (const c of s.cards) {
      if (q && !(s.name.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))) continue;
      cards.push({ ...c, subject: s.name });
    }
  }

  if (!cards.length) { main.innerHTML = '<p style="text-align:center;color:#8b94a7">No cards match.</p>'; return; }

  const cells = cards.map((c) => {
    const idx = flat.push(c) - 1;
    return `<figure class="card" data-idx="${idx}">
      <div class="frame"><canvas class="thumb" data-src="${c.image_url}"></canvas></div>
      <figcaption>
        <span class="cname">${esc(c.subject)}</span>
        <span class="badge ${c.rarity}">${LABEL[c.rarity] || c.rarity}</span>
      </figcaption>
    </figure>`;
  }).join('');

  main.innerHTML = `
    <section class="subject">
      <h2>Season 1</h2>
      <div class="cards">${cells}</div>
    </section>`;

  freezeThumbs(main);
  main.querySelectorAll('.card').forEach((f) => {
    f.onclick = () => openViewer(flat[Number(f.dataset.idx)]);
  });
}

// Draw one frame of each thumbnail to a canvas, so animated foils sit STILL in
// the grid (the holo look is kept, just frozen). Motion happens in the viewer.
function freezeThumbs(root) {
  root.querySelectorAll('canvas.thumb').forEach((cv) => {
    const im = new Image();
    im.onload = () => {
      cv.width = im.naturalWidth;
      cv.height = im.naturalHeight;
      cv.getContext('2d').drawImage(im, 0, 0);
    };
    im.src = cv.dataset.src;
  });
}

// --- 3D viewer: DRAG to pivot the card freely, CLICK to flip, and the foil
// SHINES as you move it. Two motions drive the look:
//   rx / ry     — the pivot you build up by dragging (and flipping), so you can
//                 spin the card and see its back and edges.
//   hoverX/Y    — a small lean toward the mouse (or the phone's gyroscope) when
//                 you are NOT dragging, so the holo shimmers on a light touch.
// The holographic overlay is driven by the card's actual tilt, so pivoting the
// card is what makes it shine.
let rx = 0, ry = 0, hoverX = 0, hoverY = 0;
let dragging = false, lx = 0, ly = 0, moved = false;
let isFoil = false;
const LEAN = 16; // hover / gyro lean range (degrees)

function applyView() {
  const card3d = el('card3d');
  const ex = rx + hoverX;
  const ey = ry + hoverY;
  card3d.style.transform = `rotateX(${ex}deg) rotateY(${ey}deg)`;
  // Show the correct face by angle (never a mirrored front).
  const y = (((ey % 360) + 360) % 360);
  const showingBack = y > 90 && y < 270;
  document.querySelector('.card3d .front').style.opacity = showingBack ? '0' : '1';
  document.querySelector('.card3d .back').style.opacity = showingBack ? '1' : '0';
  // Holo from how far the front is turned from square-on.
  const dev = y > 180 ? y - 360 : y;                    // -180..180, 0 = facing us
  const nx = Math.max(-1, Math.min(1, dev / 45));
  const ny = Math.max(-1, Math.min(1, ex / 45));
  card3d.style.setProperty('--hx', (50 + nx * 55) + '%');
  card3d.style.setProperty('--hy', (50 + ny * 55) + '%');
  card3d.style.setProperty('--gx', (50 + nx * 45) + '%');
  card3d.style.setProperty('--gy', (50 - ny * 45) + '%');
  const mag = Math.min(1, Math.hypot(nx, ny));
  card3d.style.setProperty('--holo-opacity', (0.16 + mag * 0.6).toFixed(3));
}

// Freeze the (possibly animated) card image to a still on the front canvas, so
// the card sits still and the holo overlay does the shining.
function drawFront(url) {
  const cv = el('v-front');
  const im = new Image();
  im.onload = () => {
    cv.width = im.naturalWidth; cv.height = im.naturalHeight;
    cv.getContext('2d').drawImage(im, 0, 0);
  };
  im.src = url;
}

function openViewer(card) {
  drawFront(card.image_url);
  el('v-back').src = backUrl;
  el('v-subject').textContent = card.subject;
  el('v-name').textContent = card.name;
  const badge = el('v-badge');
  badge.textContent = LABEL[card.rarity] || card.rarity;
  badge.className = 'badge ' + card.rarity;
  el('v-season').textContent = card.season || 'Season 1';
  el('v-event').textContent = card.event || '';
  el('v-event-row').classList.toggle('hidden', !card.event);
  el('v-rarity').textContent = LABEL[card.rarity] || card.rarity;
  el('v-lore').textContent = card.lore ? `“${card.lore}”` : '';
  el('v-artist').textContent = card.artist ? `Art by ${card.artist}` : '';
  isFoil = holoTiers.has(card.rarity);
  el('card3d').classList.toggle('holo-on', isFoil);
  rx = 0; ry = 0; hoverX = 0; hoverY = 0; applyView();
  el('viewer').classList.remove('hidden');
  enableGyro();
}

function closeViewer() { el('viewer').classList.add('hidden'); }

const stage = el('viewer-stage');
stage.addEventListener('dragstart', (e) => e.preventDefault());
stage.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  dragging = true; moved = false; lx = e.clientX; ly = e.clientY;
  hoverX = 0; hoverY = 0;
  el('card3d').classList.add('dragging');
  stage.setPointerCapture(e.pointerId);
});
stage.addEventListener('pointermove', (e) => {
  if (dragging) {
    // Free pivot: accumulate rotation from the drag.
    const dx = e.clientX - lx, dy = e.clientY - ly;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    ry += dx * 0.6;
    rx = Math.max(-80, Math.min(80, rx - dy * 0.6));
    lx = e.clientX; ly = e.clientY;
    applyView();
  } else {
    // Hover lean → the foil shimmers without a drag.
    const r = stage.getBoundingClientRect();
    hoverX = -(((e.clientY - r.top) / r.height) - 0.5) * 2 * LEAN;
    hoverY = (((e.clientX - r.left) / r.width) - 0.5) * 2 * LEAN;
    applyView();
  }
});
stage.addEventListener('pointerup', () => {
  dragging = false;
  el('card3d').classList.remove('dragging');
  if (!moved) { ry += 180; applyView(); } // a click (no drag) flips the card
});
stage.addEventListener('pointerleave', () => { hoverX = 0; hoverY = 0; applyView(); });

// Phone gyroscope: tilting the device leans the card (the "hold a real foil
// card" feel). iOS needs a permission prompt, requested on the opening tap.
let gyroOn = false;
function onOrient(e) {
  if (e.gamma == null && e.beta == null) return;
  if (dragging) return;
  hoverY = Math.max(-LEAN, Math.min(LEAN, e.gamma || 0));
  hoverX = Math.max(-LEAN, Math.min(LEAN, (e.beta || 0) - 40));
  applyView();
}
function enableGyro() {
  if (gyroOn) return;
  const DOE = window.DeviceOrientationEvent;
  if (!DOE) return;
  if (typeof DOE.requestPermission === 'function') {
    DOE.requestPermission().then((s) => { if (s === 'granted') { window.addEventListener('deviceorientation', onOrient); gyroOn = true; } }).catch(() => {});
  } else {
    window.addEventListener('deviceorientation', onOrient); gyroOn = true;
  }
}

el('viewer-close').onclick = closeViewer;
el('viewer').addEventListener('click', (e) => { if (e.target === el('viewer')) closeViewer(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeViewer(); });

el('search').oninput = render;
load().then(() => {
  // #flip opens the first card already turned to the back (for verification).
  if (location.hash === '#flip' && flat[0]) {
    openViewer(flat[0]);
    ry = 180;
    applyView();
  }
});
