// Phone layouts (designs 24 + 25, approved by Nathan 2026-10-01). One source of truth for
// CSS and JS: body.m-land (a phone held sideways) and body.m-port (a phone held upright).
// The desktop layout has neither class and does not change.
const LAND = matchMedia('(orientation: landscape) and (max-height: 500px)');
const PORT = matchMedia('(orientation: portrait) and (max-width: 600px)');

// The body classes, not the media queries: with the flag OFF there are no classes, so a
// phone gets the desktop layout AND the desktop behavior.
export const isLand = () => document.body.classList.contains('m-land');
export const isPort = () => document.body.classList.contains('m-port');
export const isPhone = () => isLand() || isPort();

function apply() {
  document.body.classList.toggle('m-land', LAND.matches);
  document.body.classList.toggle('m-port', PORT.matches);
  fitSize();
}

// The USABLE size (the window minus the safe areas): m-narrow under 760 px wide, m-short
// under 380 px tall. A notch + Discord buttons take ~120 px of an 852 px iPhone (2026-10-01).
function fitSize() {
  const b = document.body, cs = getComputedStyle(b);
  const w = innerWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0);
  const h = innerHeight - parseFloat(cs.paddingTop || 0) - parseFloat(cs.paddingBottom || 0);
  const phone = LAND.matches || PORT.matches;
  b.classList.toggle('m-narrow', phone && w < 760);
  b.classList.toggle('m-xnarrow', phone && w < 700); // an iPhone SE in landscape
  b.classList.toggle('m-short', phone && h < (PORT.matches ? 700 : 380)); // portrait: an iPhone SE
}

// Discord can leave its safe-area values empty until the first rotation (embedded-app-sdk
// issue #304). Until a value shows, body.m-sa-guess keeps room for Discord's edge buttons.
function insetsKnown() {
  const cs = getComputedStyle(document.documentElement);
  return ['top', 'right', 'bottom', 'left'].some((k) => cs.getPropertyValue(`--discord-safe-area-inset-${k}`).trim() !== '');
}
function watchInsets() {
  const check = () => { document.body.classList.toggle('m-sa-guess', !insetsKnown()); fitSize(); };
  check();
  let n = 0;
  const t = setInterval(() => { check(); if (insetsKnown() || ++n > 60) clearInterval(t); }, 1000);
  addEventListener('resize', check);
}

// onChange runs when the phone turns (landscape <-> portrait, or phone <-> desktop size).
export function initMobile(onChange) {
  apply();
  watchInsets();
  const changed = () => { apply(); onChange?.(); };
  LAND.addEventListener('change', changed);
  PORT.addEventListener('change', changed);
}
