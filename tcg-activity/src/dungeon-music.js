// The Dungeon music (Nathan item 19): free CC0 tracks, one per mood, looped, with a mute button that is
// remembered. Nathan picks the tracks first (2026-10-03): until a mood has a file, the button stays
// hidden and nothing plays. A track file goes in public/dungeon/music/ and its name in TRACKS.
//   setMood('explore' | 'fight' | 'boss' | null)   musicBtnHTML()   toggleMute()   stopMusic()
const TRACKS = {
  explore: '',   // the lobby is silent; the rooms between fights
  fight: '',
  boss: '',      // the guardian and the mini-boss
};
const BASE = '/dungeon/music/';
const KEY = 'lp.dungeon.music.off';
const VOL = 0.32;
let el = null; let mood = null; let fadeT = null;

export const hasMusic = () => Object.values(TRACKS).some(Boolean);
export const isMuted = () => localStorage.getItem(KEY) === '1';

function fadeTo(target, ms, done) {
  clearInterval(fadeT);
  if (!el) return done?.();
  const from = el.volume; const t0 = performance.now();
  fadeT = setInterval(() => {
    const k = Math.min(1, (performance.now() - t0) / ms);
    el.volume = from + (target - from) * k;
    if (k >= 1) { clearInterval(fadeT); done?.(); }
  }, 40);
}

// Play the mood's track (a short fade between moods). The same track keeps playing across moods.
export function setMood(next) {
  mood = next;
  const src = next ? TRACKS[next] || TRACKS.fight || '' : '';
  if (!src || isMuted()) { if (el) fadeTo(0, 400, () => el?.pause()); return; }
  const url = BASE + src;
  if (el && el.dataset.src === url) { if (el.paused) el.play().catch(() => {}); fadeTo(VOL, 500); return; }
  const start = () => {
    el = new Audio(url); el.dataset.src = url; el.loop = true; el.volume = 0;
    el.play().then(() => fadeTo(VOL, 700)).catch(() => {});   // a browser may wait for a tap first
  };
  if (el) fadeTo(0, 400, () => { el.pause(); start(); }); else start();
}
export function stopMusic() { mood = null; if (el) fadeTo(0, 300, () => { el?.pause(); el = null; }); }
export function toggleMute() {
  localStorage.setItem(KEY, isMuted() ? '' : '1');
  setMood(mood);
  return isMuted();
}
const ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
const OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/><path d="M3 3l18 18"/></svg>';
export function musicBtnHTML() {
  if (!hasMusic()) return '';
  const off = isMuted();
  return `<button class="dg-music${off ? ' off' : ''}" data-music title="${off ? 'Music off: tap to play' : 'Music on: tap to mute'}" aria-label="Music">${off ? OFF : ON}</button>`;
}
export function paintMusicBtn(b) {
  const off = isMuted();
  b.classList.toggle('off', off); b.innerHTML = off ? OFF : ON;
  b.title = off ? 'Music off: tap to play' : 'Music on: tap to mute';
}
