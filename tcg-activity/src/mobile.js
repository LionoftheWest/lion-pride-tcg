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
}

// onChange runs when the phone turns (landscape <-> portrait, or phone <-> desktop size).
export function initMobile(onChange) {
  apply();
  const changed = () => { apply(); onChange?.(); };
  LAND.addEventListener('change', changed);
  PORT.addEventListener('change', changed);
}
