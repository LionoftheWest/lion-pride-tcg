// One place and one look for every sub-tab bar (Nathan, 2026-10-03: "any sub tabs like these should all be
// in the same area, so even the Community Tab / Collection Tab should all be the same font / same design /
// same location"). The host is #main > .v2-subtabs: in the top bar after the logo (desktop, landscape), a
// strip under the top bar (portrait). Styles: public/ui-v2-subtabs.css.
//
// The Adventure tabs render straight into the host (ui-v2-dungeon.js). The Collection tabs (.col-tabs) and
// the Community tabs (#commTabs) keep their own markup and click handlers: this module only MOVES their bar
// into the host when a view paints it, so their code does not change.
const LIFT = '.col-tabs, #commTabs';

function lift(main) {
  const bar = [...main.querySelectorAll(LIFT)].find((n) => !n.closest('.v2-subtabs'));
  if (!bar) return;
  main.querySelector(':scope > .v2-subtabs')?.remove();
  const host = document.createElement('div');
  host.className = 'v2-subtabs lifted';
  host.setAttribute('role', 'tablist');
  main.prepend(host);
  host.appendChild(bar);
}

export function initSubtabs() {
  const main = document.getElementById('main');
  if (!main) return;
  new MutationObserver(() => lift(main)).observe(main, { childList: true, subtree: true });
}
