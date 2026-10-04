// The Dungeon music (Nathan item 19): free CC0 tracks, one per mood, looped, with a mute button that is
// remembered. Nathan picked all six tracks (2026-10-03, public/dungeon/music/CREDITS.md). Each mood
// rotates its tracks: a new mood picks one at random and keeps it while the mood lasts.
//   setMood('explore' | 'fight' | 'boss' | null)   musicBtnHTML()   toggleMute()   stopMusic()
const TRACKS = {
  explore: ['explore1.mp3', 'explore2.mp3', 'explore3.mp3'],   // the rooms between fights (the lobby is silent)
  fight: ['fight1.mp3', 'fight2.mp3'],
  boss: ['boss1.mp3'],                                          // the guardian and the mini-boss
};
const pick = (list) => list[Math.floor(Math.random() * list.length)] || '';
const chosen = {};
const BASE = '/dungeon/music/';
const KEY = 'lp.dungeon.music.off';
const VOL = 0.32;
let el = null; let mood = null; let ac = null; let gain = null;

export const hasMusic = () => Object.values(TRACKS).some((l) => l.length);
export const isMuted = () => localStorage.getItem(KEY) === '1';

// The volume goes through a Web Audio gain: iOS ignores <audio>.volume (the music played at full volume).
function wire(a) {
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    gain = ac.createGain(); gain.gain.value = 0;
    ac.createMediaElementSource(a).connect(gain).connect(ac.destination);
  } catch { gain = null; a.volume = VOL; }
}
function fadeTo(target, ms, done) {
  if (!el) return done?.();
  if (gain && ac) { const t = ac.currentTime; gain.gain.cancelScheduledValues(t); gain.gain.setValueAtTime(gain.gain.value, t); gain.gain.linearRampToValueAtTime(target, t + ms / 1000); }
  else el.volume = target;
  if (done) setTimeout(done, ms + 30);
}

// Play the mood's track (a short fade between moods). The same track keeps playing while the mood lasts.
export function setMood(next) {
  if (next !== mood && next) chosen[next] = pick(TRACKS[next] || []);   // a new mood: a new track
  mood = next;
  const src = next ? chosen[next] || '' : '';
  if (!src || isMuted()) { if (el) { const old = el; fadeTo(0, 400, () => old.pause()); } return; }
  const url = BASE + src;
  if (el && el.dataset.src === url) { if (el.paused) el.play().catch(() => {}); fadeTo(VOL, 500); return; }
  const start = () => {
    el = new Audio(url); el.dataset.src = url; el.loop = true; el.preload = 'auto';
    wire(el);
    el.play().then(() => fadeTo(VOL, 700)).catch(() => {});   // a browser may wait for a tap first
  };
  if (el) { const old = el; fadeTo(0, 400, () => { old.pause(); start(); }); } else start();
}
export function stopMusic() { mood = null; if (el) { const old = el; fadeTo(0, 300, () => { old.pause(); if (el === old) el = null; }); } }
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
