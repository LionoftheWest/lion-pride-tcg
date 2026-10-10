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
  // v3: the Trades tab opens with the Member picker (UI-65); a tap on a member opens the builder. v2: the builder.
  'trades-pick':         { id: 'UI-25', steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="trades"]`], ['js', '#main .u3-mp-tile__pick', [['wait', 0]]], ['wait', 1.5], ['js', '.v2-trade .v2-cell']] },
  // v3: from the trade builder, the Members button (UI-65, Nathan 2026-10-08) goes back to the Member picker, not the v1 search.
  'trades-pick-back':    { id: 'UI-65', under: 'UI-25', notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="trades"]`], ['js', '#main .u3-mp-tile__pick', [['wait', 0]]], ['wait', 1.5], ['js', '[data-backpick]'], ['wait', 1.5], ['js', '#main .u3-mp .u3-search__input']] },
  // The Member picker (UI-65) is the Trades tab content under v3 (D-43, 6.5b): a defect outside it belongs to Trades ('under').
  'trades-picker':       { id: 'UI-65', under: 'UI-25', notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="trades"]`], ['wait', 1.5]], input: '#main .u3-mp .u3-search__input' },
  'trades-explain':      { id: 'UI-39', steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="trades"]`], ['js', '#main [data-explain]'], ['wait', 1.5]] },
  'hall':                { id: 'UI-30', steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="hall"]`], ['wait', 1.5]], input: '#main input[type=search], #main input[type=text]' },
  'hall-listings':       { id: 'UI-30', steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="hall"]`], ['wait', 1.5], ['js', '#hlList'], ['wait', 2]] },
  'boons':               { id: 'UI-27', steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="effects"]`], ['wait', 1.5]] },
  'boons-pick':          { id: 'UI-28', steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="effects"]`], ['wait', 1.5], ['js', '.fx-view .v2-cell']] },
  'hunt-squad':          { id: 'UI-17', notOn: ['tiny'], steps: [['dock', 'battling', 3], ['js', '[data-adv="hunt"]'], ['wait', 6]] },
  // v3: the Card picker (UI-64) in Hunt mode over the Hunt view (Auto-pick, locked cards, the short-squad dialog).
  // The Hunt with no live boss and with today's squad down (UI-19): states derived in serve.mjs from the recorded calls.
  'hunt-resting':        { id: 'UI-19', hunt: 'resting', notOn: ['tiny'], steps: [['dock', 'battling', 3], ['js', '[data-adv="hunt"]'], ['wait', 6]] },
  'hunt-down':           { id: 'UI-19', hunt: 'down', notOn: ['tiny'], steps: [['dock', 'battling', 3], ['js', '[data-adv="hunt"]'], ['wait', 6]] },
  // v3: the boss detail window (UI-20) over the Hunt view (a tap on the boss stage).
  'boss-window':         { id: 'UI-20', under: 'UI-17', notOn: ['tiny'], steps: [['dock', 'battling', 3], ['js', '[data-adv="hunt"]'], ['wait', 6], ['js', '[data-boss]'], ['wait', 2]] },
  'hunt-picker':         { id: 'UI-64', under: 'UI-17', notOn: ['tiny'], steps: [['dock', 'battling', 3], ['js', '[data-adv="hunt"]'], ['wait', 6], ['js', '[data-hpick]'], ['wait', 1.5]], input: '#u3Picker .u3-search__input' },
  // The card details (the v2 #viewer) opened from a Card picker tile (UI-64, Nathan 2026-10-08): the card and its info whole inside the safe frame.
  'hunt-picker-detail':  { id: 'UI-64', under: 'UI-17', notOn: ['tiny'], steps: [['dock', 'battling', 3], ['js', '[data-adv="hunt"]'], ['wait', 6], ['js', '[data-hpick]'], ['wait', 1.5], ['js', '.u3-pk-card__info'], ['wait', 1.5]] },
  'hunt-battle':         { id: 'UI-18', notOn: ['tiny'], battle: true, steps: [['dock', 'battling', 3], ['js', '[data-adv="hunt"]'], ['wait', 9]] },
  // v3: tiny shows no shell, so the Adventure tabs are not there (D-06: the small live view, UI-59).
  'dungeon':             { id: 'UI-46', notOn: ['tiny'], steps: [['dock', 'battling', 4], ['js', '[data-adv="dungeon"]'], ['wait', 2.5]] },
  // The Card picker (UI-64) over the Dungeon lobby (D-40): a defect outside the window belongs to the lobby ('under').
  'dungeon-picker':      { id: 'UI-64', under: 'UI-46', notOn: ['tiny'], steps: [['dock', 'battling', 4], ['js', '[data-adv="dungeon"]'], ['wait', 2.5], ['js', '[data-pickopen]'], ['wait', 1.5]], input: '#u3Picker .u3-search__input' },
  'dungeon-picker-detail': { id: 'UI-64', under: 'UI-46', notOn: ['tiny'], steps: [['dock', 'battling', 4], ['js', '[data-adv="dungeon"]'], ['wait', 2.5], ['js', '[data-pickopen]'], ['wait', 1.5], ['js', '.u3-pk-card__info'], ['wait', 1.5]] },
  // v3: a run in the "Choose a reward" step (UI-48): the check server answers a run with 3 offers (cookie ci_dungeon=choose).
  'dungeon-choose':      { id: 'UI-48', notOn: ['tiny'], dungeon: 'choose', steps: [['dock', 'battling', 4], ['js', '[data-adv="dungeon"]'], ['wait', 2.5]] },
  // v3: the room steps and Floor cleared (UI-49), derived runs of the check server (cookie ci_dungeon = rest | path | chest | floor).
  'dungeon-rest':        { id: 'UI-49', notOn: ['tiny'], dungeon: 'rest', steps: [['dock', 'battling', 4], ['js', '[data-adv="dungeon"]'], ['wait', 2.5]] },
  'dungeon-path':        { id: 'UI-49', notOn: ['tiny'], dungeon: 'path', steps: [['dock', 'battling', 4], ['js', '[data-adv="dungeon"]'], ['wait', 2.5]] },
  'dungeon-chest':       { id: 'UI-49', notOn: ['tiny'], dungeon: 'chest', steps: [['dock', 'battling', 4], ['js', '[data-adv="dungeon"]'], ['wait', 2.5]] },
  'dungeon-chest-open':  { id: 'UI-49', notOn: ['tiny'], dungeon: 'chest', steps: [['dock', 'battling', 4], ['js', '[data-adv="dungeon"]'], ['wait', 2.5], ['js', '.u3-dgs-chestbox'], ['wait', 2.5]] },
  'dungeon-chest-flipped': { id: 'UI-49', notOn: ['tiny'], dungeon: 'chest', steps: [['dock', 'battling', 4], ['js', '[data-adv="dungeon"]'], ['wait', 2.5], ['js', '.u3-dgs-chestbox'], ['wait', 2.5], ['js', '.u3-dgs-cf [data-flip]'], ['wait', 1.5]] },
  'dungeon-floor':       { id: 'UI-49', notOn: ['tiny'], dungeon: 'floor', steps: [['dock', 'battling', 4], ['js', '[data-adv="dungeon"]'], ['wait', 2.5]] },
  'dungeon-floor-revealed': { id: 'UI-49', notOn: ['tiny'], dungeon: 'floor', steps: [['dock', 'battling', 4], ['js', '[data-adv="dungeon"]'], ['wait', 2.5], ['js', '.u3-dgs-reveal'], ['wait', 4]] },
  'dungeon-retreat':     { id: 'UI-49', notOn: ['tiny'], dungeon: 'floor', steps: [['dock', 'battling', 4], ['js', '[data-adv="dungeon"]'], ['wait', 2.5], ['js', '.u3-dgs-leave'], ['wait', 1.5]] },
  // The same step with other rewards (Heal, damage bonus, Revive): the panel is the same size as in dungeon-choose (D-125 review: one layout).
  'dungeon-choose2':     { id: 'UI-48', notOn: ['tiny'], dungeon: 'choose2', steps: [['dock', 'battling', 4], ['js', '[data-adv="dungeon"]'], ['wait', 2.5]] },
  // v3: a Dungeon fight (UI-47, a horde of 5 and a room of 2; D-70 the support picking): derived runs of the check server.
  'dungeon-fight':       { id: 'UI-47', notOn: ['tiny'], dungeon: 'fight', steps: [['dock', 'battling', 4], ['js', '[data-adv="dungeon"]'], ['wait', 12]] },
  'dungeon-fight2':      { id: 'UI-47', notOn: ['tiny'], dungeon: 'fight2', steps: [['dock', 'battling', 4], ['js', '[data-adv="dungeon"]'], ['wait', 12]] },
  'dungeon-fight-pick':  { id: 'UI-47', notOn: ['tiny'], dungeon: 'fight', steps: [['dock', 'battling', 4], ['js', '[data-adv="dungeon"]'], ['wait', 5], ['js', '.dg-sup'], ['wait', 1]] },
  'dungeon-board':       { id: 'UI-51', notOn: ['tiny'], steps: [['dock', 'battling', 4], ['js', '[data-adv="dungeon"]'], ['wait', 2.5], ['js', '#main [data-board]', [['js', '[data-pane="top"]'], ['wait', 1.5], ['js', '#main [data-board]']]], ['wait', 2.5]] },
  'gauntlet':            { id: 'UI-52', notOn: ['tiny'], steps: [['dock', 'battling', 4], ['js', '[data-adv="gauntlet"]'], ['wait', 2.5]] },
  // The Shop (UI-43): tiny has no top bar, so no Shop button (D-06: the small live view, UI-59).
  'shop':                { id: 'UI-43', notOn: ['tiny'], steps: [['js', '#shopBtn'], ['wait', 2]] },
  'shop-confirm':        { id: 'UI-43', notOn: ['tiny'], steps: [['js', '#shopBtn'], ['wait', 2], ['js', '[data-buy]:not([disabled])']] },
  // The Dailies window (UI-36) opens over Home from the menu: a defect outside the window belongs to Home ('under'). tiny has no menu (D-06).
  // The first wait: the menu shows the Dailies tile only after /api/dailies answered (the tile of a window that is off is hidden).
  'dailies':             { id: 'UI-36', under: 'UI-03', cornerWindow: true, notOn: ['tiny'], steps: [['wait', 3], ['js', '#menuBtn'], ['js', '[data-menu="dailies"]'], ['wait', 1.5]] },
  // The bell window (UI-24) opens over Home: a defect outside the window belongs to Home ('under'). tiny has no top bar (D-06).
  'bell':                { id: 'UI-24', under: 'UI-03', notOn: ['tiny'], steps: [['js', '#bellBtn']] },
  // The Settings window (UI-61) opens over Home from the menu: a defect outside the window belongs to Home ('under'). tiny has no menu (D-06).
  'settings':            { id: 'UI-61', under: 'UI-03', notOn: ['tiny'], steps: [['wait', 2], ['js', '#menuBtn'], ['js', '[data-menu="settings"]'], ['wait', 1.5]] },
  'leaderboard':         { id: 'UI-22', steps: [['wait', 4], ['js', '#menuBtn'], ['js', '[data-menu="board"]'], ['wait', 2]] },
  'profile':             { id: 'UI-14', notOn: ['tiny'], steps: [['wait', 4], ['js', '#menuBtn'], ['js', '[data-menu="board"]'], ['wait', 2], ['js', '[data-member]:not(.me)'], ['wait', 3]] },
  // The own profile (the avatar in the top bar): the Spotlight Edit, Title & frame and the editable wishlist show only here.
  'profile-own':         { id: 'UI-14', notOn: ['tiny'], steps: [['wait', 4], ['js', '#v2Avatar'], ['wait', 3]] },
  // The same with the Wishlist tab open (phones show the Spotlight, the Season and the Wishlist as tabs, D-113).
  'profile-own-wish':    { id: 'UI-14', wish: 'full', notOn: ['tiny'], steps: [['wait', 4], ['js', '#v2Avatar'], ['wait', 3], ['js', '[data-seg="pf:wish"]', [['wait', 0]]], ['wait', 2]] },
  'help':                { id: 'UI-38', under: 'UI-03', cornerWindow: true, notOn: ['tiny'], steps: [['wait', 2], ['js', '#menuBtn'], ['js', '[data-menu="faq"]'], ['wait', 1.5]] },
  'help-closed':          { id: 'UI-38', under: 'UI-03', cornerWindow: true, notOn: ['tiny'], steps: [['wait', 2], ['js', '#menuBtn'], ['js', '[data-menu="faq"]'], ['wait', 1.5], ['js', '[data-q="0"]'], ['wait', 0.5]] },
  'help-item5':           { id: 'UI-38', under: 'UI-03', cornerWindow: true, notOn: ['tiny'], steps: [['wait', 2], ['js', '#menuBtn'], ['js', '[data-menu="faq"]'], ['wait', 1.5], ['js', '[data-q="4"]'], ['wait', 0.5]] },
  // The menu (UI-60) opens over Home: a defect outside the menu belongs to Home ('under'). tiny has no menu (D-06).
  'menu':                { id: 'UI-60', under: 'UI-03', notOn: ['tiny'], steps: [['wait', 2], ['js', '#menuBtn'], ['wait', 1]] },
  // The Open window (UI-33) opens over Home: a defect outside the window belongs to Home ('under'). tiny has no dock (D-06).
  'open-chooser':        { id: 'UI-33', under: 'UI-03', notOn: ['tiny'], steps: [['wait', 4], ['js', '#dockOpen']] },
  // The single pack reveal (UI-34): the open answer comes from serve.mjs (openAnswer, 1 pack with a Full Art).
  // Waiting (the idle loop), then the cards face down after the tap, then every card turned (Reveal all).
  'pack-single':         { id: 'UI-34', under: 'UI-03', notOn: ['tiny'], steps: [['wait', 4], ['js', '#dockOpen'], ['js', '.u3-count[data-count="1"]'], ['wait', 1.5]] },
  'pack-single-cards':   { id: 'UI-34', under: 'UI-03', notOn: ['tiny'], steps: [['wait', 4], ['js', '#dockOpen'], ['js', '.u3-count[data-count="1"]'], ['wait', 1.5], ['js', '#packOpen'], ['wait', 4]] },
  // The multi-pack reveal (UI-35): 5 and 10 packs waiting, then (5 packs) the cards face down after one tap on a pack,
  // then every card turned. The 10-pack cards (50 on one screen) are below 44 px on 375x667 and 932x430 by design (D-108).
  'pack-multi':          { id: 'UI-35', under: 'UI-03', notOn: ['tiny'], steps: [['wait', 4], ['js', '#dockOpen'], ['js', '.u3-count[data-count="5"]'], ['wait', 1.5]] },
  'pack-multi-10':       { id: 'UI-35', under: 'UI-03', notOn: ['tiny'], steps: [['wait', 4], ['js', '#dockOpen'], ['js', '.u3-count[data-count="10"]'], ['wait', 1.5]] },
  'pack-multi-cards':    { id: 'UI-35', under: 'UI-03', notOn: ['tiny'], steps: [['wait', 4], ['js', '#dockOpen'], ['js', '.u3-count[data-count="5"]'], ['wait', 1.5], ['js', '.u3-mpack'], ['wait', 5]] },
  'pack-multi-all':      { id: 'UI-35', under: 'UI-03', notOn: ['tiny'], steps: [['wait', 4], ['js', '#dockOpen'], ['js', '.u3-count[data-count="5"]'], ['wait', 1.5], ['js', '.u3-mpack'], ['wait', 5], ['js', '#mrAll'], ['wait', 4]] },
  'pack-single-all':     { id: 'UI-34', under: 'UI-03', notOn: ['tiny'], steps: [['wait', 4], ['js', '#dockOpen'], ['js', '.u3-count[data-count="1"]'], ['wait', 1.5], ['js', '#packOpen'], ['wait', 4], ['js', '[data-reveal="all"]'], ['wait', 4]] },
};

// The shell (top bar, dock, sub-tabs) is on every screen: a defect there belongs to the shell IDs.
export function ownerOf(screen, where) {
  // A path names an element as id + tag ('#topbarheader', '#docknav'), so the id can run into the tag name.
  if (/#u3Menu(Host)?[a-z]*\b|\.u3-menu|\.u3-mtile/.test(where)) return 'UI-60';
  if (/#u3OpenHost[a-z]*\b|\.u3-open\b|\.u3-set\b|\.u3-count\b/.test(where)) return 'UI-33';
  // The card details (the v2 #viewer) opened from a Card picker: UI-64 owns them there (only the picker detail specs), the screen under the scrim does not.
  // Other screens keep their owner (collection-detail: UI-08 opens the viewer at some sizes and its side panel at others).
  if (/-picker-detail$/.test(screen) && /#viewer[a-z-]*\b|\.viewer-(info|stage|nav)\b|\.vr-|#v-[a-z-]+/.test(where)) return 'UI-64';
  if (/#u3Picker[a-z]*\b|\.u3-pk\b|\.u3-pk[-_]/.test(where)) return 'UI-64';
  if (/#u3BossWin[a-z]*\b|\.u3-bw\b|\.u3-bw[-_]/.test(where)) return 'UI-20';
  if (/#(v2Dailies|u3DlToast)[a-z]*\b|\.u3-dl\b|\.u3-dl[-_]/.test(where)) return 'UI-36';
  if (/\.u3-mp\b|\.u3-mp[-_]/.test(where)) return 'UI-65';
  if (/#v2Notifs[a-z]*\b|\.u3-bell|\.u3-note\b|\.u3-note__|\.u3-gift\b|\.u3-gift__/.test(where)) return 'UI-24';
  if (/#u3Settings[a-z]*\b|\.u3-st\b|\.u3-st[-_]/.test(where)) return 'UI-61';
  if (/\.u3-dgs\b|\.u3-dgs[-_]/.test(where) || (SCREENS[screen].id === 'UI-49' && /\.u3-dgc\b|\.u3-dgc[-_]/.test(where))) return 'UI-49';   // the room steps share the UI-48 stage parts
  if (/#v2Help[a-z]*\b|\.u3-hp\b|\.u3-hp[-_]/.test(where)) return 'UI-38';
  if (/\.u3-dgc\b|\.u3-dgc[-_]/.test(where)) return 'UI-48';
  if (/\.u3-logo\b/.test(where)) return 'UI-01';   // the top bar logo (its path can stop above #topbar)
  // The pack reveal stage covers the screen under it: a defect in the stage belongs to the reveal screen.
  // A path keeps 3 levels, so the stage parts are named too (the pack, the cards, the bar, the effects).
  if (/#stage[a-z]*\b|\.u3-reveal|\.u3-pack|.u3-mpack|.u3-mhint|.u3-mrow|.u3-mwait|.u3-newmark|.reveal-grid|\.fc\b|\.pf\b|\.pf-face|\.react\b|\.u3-reacts|\.tap-prompt|\.sunrays|\.rare-banner|\.spark\b|\.mr-/.test(where)) return SCREENS[screen].id;
  if (/#(v2Shards|shopBtn)[a-z]*\b/.test(where)) return 'UI-42';
  if (/(^|\s|>\s*)#(topbar|dock|shardsBtn|dailyBtn|helpBtn|bellBtn|boardBtn|reportBtn|avatarBtn|dockOpen|menuBtn|v2Avatar)[a-z]*\b/.test(where) || /\.dk\b/.test(where)) return 'UI-01';
  if (/v2-subtabs|(?<![\w-])dg-tabs\b|#commTabs|#colTabs/.test(where)) return 'UI-02';
  return SCREENS[screen].under || SCREENS[screen].id;
}

// ---- Steps (common.py: boot, settle, dock, jsclick, run_steps) ----------------------------------------------
const sleep = (s) => new Promise((ok) => setTimeout(ok, s * 1000));
// Waiting (part C of the speed-up): by default each step waits until the screen is ready, not a fixed time.
// UI_CHECK_WAIT=fixed restores the fixed waits of the audit walkthrough (compare.mjs proves both give the same defects).
const FIXED = process.env.UI_CHECK_WAIT === 'fixed';
// Ready: the fonts are loaded, no loading placeholder shows, no finite animation runs, and the page did not change
// for 3 samples in a row (0.75 s). A countdown text changes its digits, not the page size, so it does not block.
export async function ready(pg, maxS = 15) {
  const t0 = Date.now(); let last = ''; let stable = 0;
  while (Date.now() - t0 < maxS * 1000) {
    const sig = await pg.evaluate(() => {
      const busy = document.fonts?.status !== 'loaded' || !!document.querySelector('#main > .loading, #main .v2-loading')
        || document.getAnimations().some((a) => a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming?.().endTime));
      return `${busy ? 1 : 0}:${document.body.getElementsByTagName('*').length}:${document.getElementById('main')?.innerHTML.length || 0}`;
    }).catch(() => 'nav');
    if (sig === last && sig.startsWith('0:')) { if (++stable >= 3) return; } else stable = 0;
    last = sig; await sleep(0.25);
  }
}
export async function settle(pg, t = 30) {
  if (!FIXED) return ready(pg, t);
  for (let i = 0; i < t / 0.5; i++) { if (!(await pg.evaluate("!!document.querySelector('#main > .loading, #main .v2-loading')"))) break; await sleep(0.5); }
  await sleep(1);
}
export async function boot(pg, url) {
  await pg.goto(url);
  for (let i = 0; i < 60; i++) { if (await pg.evaluate('document.body.classList.contains("ui-v2")')) break; await sleep(0.5); }
  if (FIXED) await sleep(4); else await ready(pg);
  await pg.evaluate("document.getElementById('tutLayer')?.remove()");
}
async function dock(pg, view, wait = 2.5) {
  const active = () => pg.evaluate((v) => !!document.querySelector(`#dock .dk[data-view="${v}"]`)?.classList.contains('active'), view);
  for (let i = 0; i < 4; i++) {
    await pg.evaluate((v) => document.querySelector(`#dock .dk[data-view="${v}"]`)?.click(), view);
    if (FIXED) await sleep(wait);
    else for (let t = 0; t < wait * 4 && !(await active()); t++) await sleep(0.25);
    if (await active()) break;
  }
  await settle(pg);
}
async function jsclick(pg, sel, wait = 1.5) {
  let ok = false;
  for (let i = 0; i < 40; i++) {
    ok = await pg.evaluate((s) => { const e = [...document.querySelectorAll(s)].find((x) => x.getClientRects().length); if (!e) return false; e.click(); return true; }, sel);
    if (ok) break; await sleep(0.5);
  }
  if (FIXED) await sleep(wait);
  await settle(pg); return ok;
}
export async function runSteps(pg, steps) {
  const miss = [];
  for (const st of steps) {
    if (st[0] === 'dock') await dock(pg, st[1], st[2] ?? 2.5);
    else if (st[0] === 'wait') { if (FIXED) await sleep(st[1]); else await ready(pg, st[1] + 10); }
    else if (st[0] === 'js') {
      if (st[2] && !(await pg.evaluate((s) => [...document.querySelectorAll(s)].some((x) => x.getClientRects().length), st[1]))) {
        miss.push(`${st[1]} (fallback used)`); miss.push(...(await runSteps(pg, st[2]))); continue;
      }
      if (!(await jsclick(pg, st[1]))) miss.push(st[1]);
    }
  }
  return miss;
}
