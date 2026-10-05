// The screens and windows of the G3 UI check: the walkthrough of the 2026-10-04 audit (discord-ui-audit/common.py),
// ported step for step, with the register ID of each screen (docs/ui-register.md).
// A step: ['dock', view, waitSeconds?] | ['js', selector, fallbackSteps?] | ['wait', seconds]

export const SIZES = [   // docs/design.md 2.2 (D-18): [width, height, class, touch]
  [375, 667, 'compact-port', true], [667, 375, 'compact-land', true], [430, 932, 'compact-port', true], [932, 430, 'compact-land', true],
  [430, 822, 'compact-port', true], [412, 915, 'compact-port', true], [915, 412, 'compact-land', true], [820, 1180, 'medium', true],
  [1180, 820, 'medium', true], [692, 917, 'medium', true], [917, 692, 'medium-short', true], [1280, 720, 'expanded', false],
  [1990, 830, 'expanded', false], [1280, 480, 'compact-land', false], [400, 225, 'tiny', true],
];
export const sizeKey = (s) => `${s[0]}x${s[1]}`;
export const EXPANDED = '1990x830';   // the size that "missing on another class" compares with (12.6, P1)

const COMM = '#commTabs';
export const SCREENS = {
  'home':                { id: 'UI-03', steps: [] },
  'collection':          { id: 'UI-07', steps: [['dock', 'collection']], input: '#colSearch' },
  'collection-detail':   { id: 'UI-08', steps: [['dock', 'collection'], ['js', '#main .v2-cell'], ['wait', 2.5]] },
  'achievements':        { id: 'UI-12', steps: [['dock', 'collection'], ['js', '[data-tab="ach"]']] },
  'achievements-detail': { id: 'UI-12', steps: [['dock', 'collection'], ['js', '[data-tab="ach"]'], ['js', '#main .ach-card, #main .ach-row, #main [data-ach]']] },
  'bosses':              { id: 'UI-11', steps: [['dock', 'collection'], ['js', '[data-tab="bosses"]']] },
  'trades':              { id: 'UI-25', steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="trades"]`]], input: '#trFind, #main input[type=search], #main input[type=text]' },
  'trades-pick':         { id: 'UI-25', steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="trades"]`], ['js', '.v2-trade .v2-cell']] },
  'trades-explain':      { id: 'UI-39', steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="trades"]`], ['js', '#main [data-explain]'], ['wait', 1.5]] },
  'hall':                { id: 'UI-30', steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="hall"]`], ['wait', 1.5]], input: '#main input[type=search], #main input[type=text]' },
  'hall-listings':       { id: 'UI-30', steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="hall"]`], ['wait', 1.5], ['js', '#hlList'], ['wait', 2]] },
  'boons':               { id: 'UI-27', steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="effects"]`], ['wait', 1.5]] },
  'boons-pick':          { id: 'UI-28', steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="effects"]`], ['wait', 1.5], ['js', '.fx-view .v2-cell']] },
  'hunt-squad':          { id: 'UI-17', steps: [['dock', 'battling', 3], ['js', '[data-adv="hunt"]'], ['wait', 6]] },
  'hunt-battle':         { id: 'UI-18', battle: true, steps: [['dock', 'battling', 3], ['js', '[data-adv="hunt"]'], ['wait', 9]] },
  'dungeon':             { id: 'UI-46', steps: [['dock', 'battling', 4], ['js', '[data-adv="dungeon"]'], ['wait', 2.5]] },
  'dungeon-board':       { id: 'UI-51', steps: [['dock', 'battling', 4], ['js', '[data-adv="dungeon"]'], ['wait', 2.5], ['js', '#main [data-board]', [['js', '[data-pane="top"]'], ['wait', 1.5], ['js', '#main [data-board]']]], ['wait', 2.5]] },
  'gauntlet':            { id: 'UI-52', steps: [['dock', 'battling', 4], ['js', '[data-adv="gauntlet"]'], ['wait', 2.5]] },
  'shop':                { id: 'UI-43', steps: [['js', '#shopBtn'], ['wait', 2]] },
  'shop-confirm':        { id: 'UI-43', steps: [['js', '#shopBtn'], ['wait', 2], ['js', '[data-buy]:not([disabled])']] },
  'dailies':             { id: 'UI-36', steps: [['js', '#dailyBtn'], ['wait', 1.5]] },
  'bell':                { id: 'UI-24', steps: [['js', '#bellBtn']] },
  'leaderboard':         { id: 'UI-22', steps: [['wait', 4], ['js', '#boardBtn', [['dock', 'trading'], ['js', '#commBoard']]], ['wait', 2]] },
  'profile':             { id: 'UI-14', steps: [['wait', 4], ['js', '#boardBtn', [['dock', 'trading'], ['js', '#commBoard']]], ['wait', 2], ['js', '[data-member]:not(.me)'], ['wait', 3]] },
  'help':                { id: 'UI-38', steps: [['js', '#helpBtn']] },
  'open-chooser':        { id: 'UI-33', steps: [['wait', 4], ['js', '#dockOpen']] },
};

// The shell (top bar, dock, sub-tabs) is on every screen: a defect there belongs to the shell IDs.
export function ownerOf(screen, where) {
  if (/(^|\s|>\s*)#(topbar|dock|shardsBtn|shopBtn|dailyBtn|helpBtn|bellBtn|boardBtn|reportBtn|avatarBtn|dockOpen)\b/.test(where) || /\.dk\b/.test(where)) return 'UI-01';
  if (/v2-subtabs|dg-tabs|#commTabs|#colTabs/.test(where)) return 'UI-02';
  return SCREENS[screen].id;
}

// ---- Steps (common.py: boot, settle, dock, jsclick, run_steps) ----------------------------------------------
const sleep = (s) => new Promise((ok) => setTimeout(ok, s * 1000));
export async function settle(pg, t = 30) {
  for (let i = 0; i < t / 0.5; i++) { if (!(await pg.evaluate("!!document.querySelector('#main > .loading, #main .v2-loading')"))) break; await sleep(0.5); }
  await sleep(1);
}
export async function boot(pg, url) {
  await pg.goto(url);
  for (let i = 0; i < 60; i++) { if (await pg.evaluate('document.body.classList.contains("ui-v2")')) break; await sleep(0.5); }
  await sleep(4);
  await pg.evaluate("document.getElementById('tutLayer')?.remove()");
}
async function dock(pg, view, wait = 2.5) {
  for (let i = 0; i < 4; i++) {
    await pg.evaluate((v) => document.querySelector(`#dock .dk[data-view="${v}"]`)?.click(), view);
    await sleep(wait);
    if (await pg.evaluate((v) => !!document.querySelector(`#dock .dk[data-view="${v}"]`)?.classList.contains('active'), view)) break;
  }
  await settle(pg);
}
async function jsclick(pg, sel, wait = 1.5) {
  let ok = false;
  for (let i = 0; i < 40; i++) {
    ok = await pg.evaluate((s) => { const e = [...document.querySelectorAll(s)].find((x) => x.getClientRects().length); if (!e) return false; e.click(); return true; }, sel);
    if (ok) break; await sleep(0.5);
  }
  await sleep(wait); await settle(pg); return ok;
}
export async function runSteps(pg, steps) {
  const miss = [];
  for (const st of steps) {
    if (st[0] === 'dock') await dock(pg, st[1], st[2] ?? 2.5);
    else if (st[0] === 'wait') await sleep(st[1]);
    else if (st[0] === 'js') {
      if (st[2] && !(await pg.evaluate((s) => [...document.querySelectorAll(s)].some((x) => x.getClientRects().length), st[1]))) {
        miss.push(`${st[1]} (fallback used)`); miss.push(...(await runSteps(pg, st[2]))); continue;
      }
      if (!(await jsclick(pg, st[1]))) miss.push(st[1]);
    }
  }
  return miss;
}
