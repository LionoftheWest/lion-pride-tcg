// The screens and windows of the G3 UI check: the walkthrough of the 2026-10-04 audit (discord-ui-audit/common.py),
// ported step for step, with the register ID of each screen (docs/ui-register.md).
// A step: ['dock', view, waitSeconds?] | ['js', selector, fallbackSteps?] | ['wait', seconds]

export const SIZES = [   // docs/design.md 2.2 (D-18): [width, height, class, touch]. D-136: 667x375, 932x430, 915x412, 1180x820 and 917x692 are DESKTOP windows (phones and tablets are locked to portrait in the Developer Portal): no touch, so no safe and no keyboard variant.
  [375, 667, 'compact-port', true], [667, 375, 'compact-land', false], [430, 932, 'compact-port', true], [932, 430, 'compact-land', false],
  [430, 822, 'compact-port', true], [412, 915, 'compact-port', true], [915, 412, 'compact-land', false], [820, 1180, 'medium', true],
  [1180, 820, 'medium', false], [692, 917, 'medium', true], [917, 692, 'medium-short', false], [1280, 720, 'expanded', false],
  [1990, 830, 'expanded', false], [1280, 480, 'compact-land', false], [400, 225, 'tiny', true],
];
export const sizeKey = (s) => `${s[0]}x${s[1]}`;
// D-136 (Nathan, 2026-10-09: "anything that is wrong with landscapes currently don't worry about it"): the five former landscape phone and
// tablet sizes keep running, and their defects are REPORTED (summary table, defects.json) but do NOT fail the verdict. The one list.
// D-154 (Nathan, 2026-10-09): 375x667 (the smallest phone: Discord adds a 48 px top bar) and 1280x480 (the short desktop window,
// it uses the landscape layout) are report only too, "fix later".
export const REPORT_ONLY_SIZES = ['667x375', '932x430', '915x412', '1180x820', '917x692', '375x667', '1280x480'];
export const EXPANDED = '1990x830';   // the size that "missing on another class" compares with (12.6, P1)

const COMM = '#commTabs';
const WALK_START = [['wait', 2], ['js', '#menuBtn'], ['js', '[data-menu="faq"]'], ['wait', 1], ['js', '[data-hp-replay]'], ['wait', 2]];
const WALK_NEXT = (n) => Array.from({ length: n }, () => [['js', '[data-wt="next"]'], ['wait', 1]]).flat();
export const SCREENS = {
  // Home (UI-03): a resting hunt, 9 pulls and 5 members in voice (the state of the approved frames, UI-03/approved); home-live: the recorded live hunt.
  'home':                { id: 'UI-03', safe: true, long: true, home: 'busy', notOn: ['tiny'], steps: [] },
  'home-live':           { id: 'UI-03', long: true, safe: true, home: 'live', notOn: ['tiny'], steps: [] },
  // UI-04: the live Hunt hero with the Top 3 board (D-58) inside the UI-03 Home; a defect outside the board belongs to Home ('under').
  'home-board':          { id: 'UI-04', under: 'UI-03', long: true, home: 'live', notOn: ['tiny'], steps: [] },
  // UI-05: the Home carousel. With the Hunt resting the Dungeon slide is first (D-14, D-45): the first four specs are the Dungeon slide
  // (no runs yet, then with a Top 3), the Gauntlet slide (no runs, then with a Top 3), and the resting Hunt slide behind the control.
  // UI-06: the "+N" window of Live in voice (5 members in voice; where every member fits the tile there is no "+N" and the spec is the Home).
  'home-dungeon':        { id: 'UI-05', under: 'UI-03', long: true, safe: true, home: 'busy', notOn: ['tiny'], steps: [] },
  'home-dungeon-top':    { id: 'UI-05', under: 'UI-03', long: true, safe: true, home: 'busy', dungeon: 'top', notOn: ['tiny'], steps: [] },
  'home-gauntlet':       { id: 'UI-05', under: 'UI-03', long: true, safe: true, home: 'busy', notOn: ['tiny'], steps: [['js', '[data-slide-go="gauntlet"]'], ['wait', 0.5]] },
  'home-gauntlet-top':   { id: 'UI-05', under: 'UI-03', long: true, safe: true, home: 'busy', dungeon: 'top', notOn: ['tiny'], steps: [['js', '[data-slide-go="gauntlet"]'], ['wait', 0.5]] },
  'home-hunt-rest':      { id: 'UI-05', under: 'UI-03', long: true, safe: true, home: 'busy', notOn: ['tiny'], steps: [['js', '[data-slide-go="hunt"]'], ['wait', 0.5]] },
  'home-voice-all':      { id: 'UI-06', under: 'UI-03', long: true, safe: true, home: 'busy', notOn: ['tiny'], steps: [['js', '[data-voice-all]', [['wait', 0]]], ['wait', 1]] },
  'collection':          { id: 'UI-07', long: true, steps: [['dock', 'collection']], input: '#colSearch' },
  // the Filters panel open (D-39, D-123: under tabs where the groups do not fit the height)
  'collection-filters': { id: 'UI-07', safe: true, notOn: ['tiny'], steps: [['dock', 'collection'], ['js', '#colFilters'], ['wait', 1]] },
  'collection-detail':   { id: 'UI-08', under: 'UI-07', notOn: ['tiny'], safe: true, steps: [['dock', 'collection'], ['js', '#main .u3-ctile:not(.is-locked)'], ['wait', 2.5]] },
  // v3: the Card Detail states of UI-08 (the approved frames): a card to ascend (cookie ci_col=ascend), the stat points editor (ci_col=points), a locked card.
  'collection-detail-ascend': { id: 'UI-08', under: 'UI-07', notOn: ['tiny'], safe: true, col: 'ascend', steps: [['dock', 'collection'], ['js', '#main .u3-ctile:not(.is-locked)'], ['wait', 2.5]] },
  'collection-detail-points': { id: 'UI-08', under: 'UI-07', notOn: ['tiny'], safe: true, col: 'points', steps: [['dock', 'collection'], ['js', '#main .u3-ctile:not(.is-locked)'], ['wait', 2.5], ['js', '#ptsOpen'], ['wait', 1], ['js', '[data-add="attack"]'], ['wait', 1]] },
  'collection-detail-locked': { id: 'UI-08', under: 'UI-07', safe: true, notOn: ['tiny'], steps: [['dock', 'collection'], ['js', '#main .u3-ctile.is-locked'], ['wait', 2.5]] },
  // v3: the card viewer (UI-09) opened from the Card Detail art (a tap on #pArt; at the sizes where the viewer opens with the panel it opens again).
  'collection-viewer':   { id: 'UI-09', under: 'UI-07', notOn: ['tiny'], safe: true, steps: [['dock', 'collection'], ['js', '#main .u3-ctile:not(.is-locked)'], ['wait', 2.5], ['js', '#pArt'], ['wait', 1.5]] },
  // v3: the celebration after an Ascend (UI-10 C1-C4): the viewer with the card and "Spend points" (cookie ci_col=ascend-ok answers the Ascend).
  'ascend-celebration':  { id: 'UI-10', under: 'UI-07', notOn: ['tiny'], safe: true, steps: [['dock', 'collection'], ['js', '#main .u3-ctile:not(.is-locked)'], ['wait', 2.5], ['js', '#pAscend'], ['wait', 5]], col: 'ascend-ok' },
  // v3: the Ascend refused (UI-10 E1: the writes answer 403 here, cookie ci_col=points) and the stat points save error (S2).
  'ascend-error':        { id: 'UI-10', under: 'UI-07', notOn: ['tiny'], steps: [['dock', 'collection'], ['js', '#main .u3-ctile:not(.is-locked)'], ['wait', 2.5], ['js', '#pAscend'], ['wait', 1.5]], col: 'ascend' },
  'stat-points-error':   { id: 'UI-10', under: 'UI-07', notOn: ['tiny'], steps: [['dock', 'collection'], ['js', '#main .u3-ctile:not(.is-locked)'], ['wait', 2.5], ['js', '[data-add="attack"]', [['js', '#ptsOpen'], ['wait', 1], ['js', '[data-add="attack"]']]], ['wait', 1], ['js', '#ptsSave'], ['wait', 1.5]], col: 'points' },
  'achievements':        { id: 'UI-12', notOn: ['tiny'], long: true, safe: true, steps: [['dock', 'collection'], ['js', '[data-tab="ach"]']] },
  // v3: the achievement window (a tap on a tile), the tab with an achievement ready to claim (cookie ci_ach=ready, derived in
  // serve.mjs), and a Claim that the server refuses (the check server blocks every write: the button shows "Try again").
  'achievements-detail': { id: 'UI-12', notOn: ['tiny'], long: true, safe: true, steps: [['dock', 'collection'], ['js', '[data-tab="ach"]'], ['js', '#main [data-ach="s1"]'], ['wait', 1.5]] },
  'achievements-ready':  { id: 'UI-12', notOn: ['tiny'], long: true, safe: true, ach: 'ready', steps: [['dock', 'collection'], ['js', '[data-tab="ach"]']] },
  'achievements-claim-error': { id: 'UI-12', notOn: ['tiny'], safe: true, ach: 'ready', steps: [['dock', 'collection'], ['js', '[data-tab="ach"]'], ['js', '#main [data-claim]'], ['wait', 1.5]] },
  // UI-13 (the tracks under the UI-12 Achievements tab; cookie ci_ach=tracks makes the achievement view and the gallery, serve.mjs): the Tracks list, a track
  // window, the Badges list, the Titles list, the Frames list, a Claim and an Equip that the server refuses (the check server blocks every write).
  'tracks':              { id: 'UI-13', notOn: ['tiny'], long: true, safe: true, ach: 'tracks', steps: [['dock', 'collection'], ['js', '[data-tab="ach"]']] },
  'tracks-window':       { id: 'UI-13', notOn: ['tiny'], long: true, safe: true, ach: 'tracks', steps: [['dock', 'collection'], ['js', '[data-tab="ach"]'], ['js', '#main [data-track]'], ['wait', 1]] },
  'tracks-badges':       { id: 'UI-13', notOn: ['tiny'], long: true, safe: true, ach: 'tracks', steps: [['dock', 'collection'], ['js', '[data-tab="ach"]'], ['js', '#main [data-seg="badges"]'], ['wait', 1]] },
  'tracks-titles':       { id: 'UI-13', notOn: ['tiny'], long: true, safe: true, ach: 'tracks', steps: [['dock', 'collection'], ['js', '[data-tab="ach"]'], ['js', '#main [data-seg="titles"]'], ['wait', 1]] },
  'tracks-frames':       { id: 'UI-13', notOn: ['tiny'], long: true, safe: true, ach: 'tracks', steps: [['dock', 'collection'], ['js', '[data-tab="ach"]'], ['js', '#main [data-seg="frames"]'], ['wait', 1]] },
  'tracks-claim-error':  { id: 'UI-13', notOn: ['tiny'], safe: true, ach: 'tracks', steps: [['dock', 'collection'], ['js', '[data-tab="ach"]'], ['js', '#main [data-claim]'], ['wait', 1.5]] },
  'tracks-equip-error':  { id: 'UI-13', notOn: ['tiny'], safe: true, ach: 'tracks', steps: [['dock', 'collection'], ['js', '[data-tab="ach"]'], ['js', '#main [data-seg="titles"]'], ['wait', 1], ['js', '#main [data-equip]'], ['wait', 1.5]] },
  'bosses':              { id: 'UI-11', notOn: ['tiny'], long: true, safe: true, steps: [['dock', 'collection'], ['js', '[data-tab="bosses"]']] },
  'boss-detail':         { id: 'UI-11', notOn: ['tiny'], long: true, safe: true, steps: [['dock', 'collection'], ['js', '[data-tab="bosses"]'], ['js', '#main [data-bi]'], ['wait', 2]] },
  'trades':              { id: 'UI-25', notOn: ['tiny'], long: true, safe: true, steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="trades"]`]], input: '#trFind, #main input[type=search], #main input[type=text]' },
  // v3: the Trades tab opens with the Member picker (UI-65); a tap on a member opens the builder. v2: the builder.
  // UI-63: a tap on a member opens the Trade window (Your cards); the states of the approved frames: one of my cards chosen
  // (Gift, Offer), one of theirs chosen (Request), one in each (Offer). v2: the builder with a card picked.
  'trades-pick':         { id: 'UI-63', long: true, safe: true, notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="trades"]`], ['js', '#main .u3-mp-tile__pick', [['wait', 0]]], ['wait', 1.5], ['js', '.v2-trade .v2-cell, #u3TradeWin .u3-pk-card__pick']], input: '#u3TradeWin .u3-search__input' },
  'trades-request':      { id: 'UI-63', long: true, safe: true, notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="trades"]`], ['js', '#main .u3-mp-tile__pick', [['wait', 0]]], ['wait', 1.5], ['js', '#u3TradeWin [data-seg="their"]'], ['wait', 0.5], ['js', '#u3TradeWin .u3-pk-card__pick']] },
  'trades-proposal':     { id: 'UI-63', long: true, safe: true, notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="trades"]`], ['js', '#main .u3-mp-tile__pick', [['wait', 0]]], ['wait', 1.5], ['js', '#u3TradeWin .u3-pk-card__pick'], ['wait', 0.5], ['js', '#u3TradeWin [data-seg="their"]'], ['wait', 0.5], ['js', '#u3TradeWin .u3-pk-card__pick']] },
  // D-168 requests on (cookie ci_treq): Request works with their card only; both cards = the full proposal; the owner picks from the requester's cards.
  'trades-request-on':   { id: 'UI-63', long: true, safe: true, treq: 'on', notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="trades"]`], ['js', '#main .u3-mp-tile__pick', [['wait', 0]]], ['wait', 1.5], ['js', '#u3TradeWin [data-seg="their"]'], ['wait', 0.5], ['js', '#u3TradeWin .u3-pk-card__pick']] },
  'trades-proposal-on':  { id: 'UI-63', long: true, safe: true, treq: 'on', notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="trades"]`], ['js', '#main .u3-mp-tile__pick', [['wait', 0]]], ['wait', 1.5], ['js', '#u3TradeWin .u3-pk-card__pick'], ['wait', 0.5], ['js', '#u3TradeWin [data-seg="their"]'], ['wait', 0.5], ['js', '#u3TradeWin .u3-pk-card__pick']] },
  'trades-request-pick': { id: 'UI-63', long: true, safe: true, treq: 'rows', notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="trades"]`], ['js', '.u3-mp__tools [data-pending]', [['wait', 0]]], ['wait', 1], ['js', '.u3-pd-row--in.is-pick [data-act="pick"]'], ['wait', 1.5], ['js', '#u3TradeWin .u3-pk-card__pick']] },
  'trades-window':       { id: 'UI-63', long: true, safe: true, notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="trades"]`], ['js', '#main .u3-mp-tile__pick', [['wait', 0]]], ['wait', 1.5]], input: '#u3TradeWin .u3-search__input' },
  // v3: from the trade builder, the Members button (UI-65, Nathan 2026-10-08) goes back to the Member picker, not the v1 search.
  'trades-pick-back':    { id: 'UI-65', under: 'UI-25', notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="trades"]`], ['js', '#main .u3-mp-tile__pick', [['wait', 0]]], ['wait', 1.5], ['js', '[data-backpick]'], ['wait', 1.5], ['js', '#main .u3-mp .u3-search__input']] },
  // The Member picker (UI-65) is the Trades tab content under v3 (D-43, 6.5b): a defect outside it belongs to Trades ('under').
  // UI-25: Pending with offers in every state, and a member with few partners (D-64 item 5, D-116): In voice, All members + Pager.
// Compact classes open the Pending sheet with its button; the wide classes show the panel (the button is hidden there: the fallback).
'trades-few':         { id: 'UI-25', long: true, safe: true, trades: 'few', notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="trades"]`], ['wait', 1.5]] },
'trades-pending':     { id: 'UI-25', long: true, safe: true, trades: 'few', notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="trades"]`], ['js', '.u3-mp__tools [data-pending]', [['wait', 0]]], ['wait', 1.5]] },
'trades-requests':    { id: 'UI-25', long: true, safe: true, treq: 'rows', notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="trades"]`], ['js', '.u3-mp__tools [data-pending]', [['wait', 0]]], ['wait', 1.5]] },
'trades-offer':       { id: 'UI-25', long: true, safe: true, trades: 'few', notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="trades"]`], ['js', '.u3-mp__tools [data-pending]', [['wait', 0]]], ['js', '.u3-pd-row__open'], ['wait', 1.5]] },
  // UI-26 Trade animation: the Accept in Pending starts it; the page clock holds each phase (start, swap), landed = the layer gone (Pending without the offer).
  'trades-fx-start':     { id: 'UI-26', trades: 'few', tfx: true, notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="trades"]`], ['js', '.u3-mp__tools [data-pending]', [['wait', 0]]], ['wait', 1.5], ['tfx', '.u3-pd-sheet [data-act="accept"], .u3-pd [data-act="accept"]', 600]] },
  'trades-fx-swap':      { id: 'UI-26', trades: 'few', tfx: true, long: true, safe: true, notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="trades"]`], ['js', '.u3-mp__tools [data-pending]', [['wait', 0]]], ['wait', 1.5], ['tfx', '.u3-pd-sheet [data-act="accept"], .u3-pd [data-act="accept"]', 2400]] },
  'trades-fx-landed':    { id: 'UI-26', trades: 'few', tfx: true, notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="trades"]`], ['js', '.u3-mp__tools [data-pending]', [['wait', 0]]], ['wait', 1.5], ['tfx', '.u3-pd-sheet [data-act="accept"], .u3-pd [data-act="accept"]', 7000, 'gone']] },
'trades-picker':       { id: 'UI-65', under: 'UI-25', notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="trades"]`], ['wait', 1.5]], input: '#main .u3-mp .u3-search__input' },
  // UI-29: the member suggest list (typed "Member": the fixture answers with every member, so the list holds more rows than fit and scrolls). The keyboard variant keeps the text and the list.
  'trades-suggest':      { id: 'UI-29', long: true, under: 'UI-25', notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="trades"]`], ['wait', 1.5], ['type', '#main .u3-mp .u3-search__input', 'Member']], input: '#main .u3-mp .u3-search__input' },
  'trades-explain':      { id: 'UI-39', steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="trades"]`], ['js', '#main [data-explain]'], ['wait', 1.5]] },
  // v3 (UI-30): the Trade Hall lists with the listings of other members (cookie ci_hall=many: the recording holds only the signed-in member's own).
  'hall':                { id: 'UI-30', safe: true, long: true, hall: 'many', notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="hall"]`], ['wait', 1.5]], input: '#main input[type=search], #main input[type=text]' },
  'hall-fortrade':       { id: 'UI-30', long: true, safe: true, hall: 'many', notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="hall"]`], ['wait', 1.5], ['js', '.u3-hl__sw [data-seg="fortrade"]'], ['wait', 1]], input: '#main input[type=search], #main input[type=text]' },
  'hall-filters':        { id: 'UI-30', long: true, safe: true, hall: 'many', notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="hall"]`], ['wait', 1.5], ['js', '[data-hlfilters]'], ['wait', 1]] },
  // The v2 views behind the Hall (UI-31 Manage my listings, UI-32 Auctions) stay reachable from the v3 Hall.
  // v3 (UI-31): List a card = Manage my listings (2 of 5 listed, cookie ci_hall=list), the Card picker over it, the refused list call (the check server blocks
  // writes: the error line of the approved frame), the unlisted toast with Undo (the check server answers the unlist call ok), and the offer on a listing
  // = the Trade window UI-63 on the chosen card (cookie ci_hall=offer: Wanted index 2 is a card I own, For trade index 2 a card of the lister).
  'hall-listings':       { id: 'UI-31', long: true, safe: true, hall: 'list', notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="hall"]`], ['wait', 1.5], ['js', '#hlList, [data-hlmanage]'], ['wait', 2]] },
  'hall-list-picker':    { id: 'UI-31', safe: true, hall: 'list', notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="hall"]`], ['wait', 1.5], ['js', '#hlList, [data-hlmanage]'], ['wait', 2], ['js', '[data-lsadd]'], ['wait', 1.5]], input: '#u3Picker .u3-search__input' },
  'hall-list-error':     { id: 'UI-31', safe: true, hall: 'list', notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="hall"]`], ['wait', 1.5], ['js', '#hlList, [data-hlmanage]'], ['wait', 2], ['js', '[data-lsadd]'], ['wait', 1.5], ['js', '#u3Picker .u3-pk-card__pick'], ['wait', 0.5], ['js', '#u3Picker [data-confirm]'], ['wait', 1.5]] },
  'hall-unlisted':       { id: 'UI-31', safe: true, hall: 'list', notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="hall"]`], ['wait', 1.5], ['js', '#hlList, [data-hlmanage]'], ['wait', 2], ['js', '[data-lsunlist]'], ['wait', 1.5]] },
  'hall-offer-wanted':   { id: 'UI-31', under: 'UI-30', long: true, safe: true, hall: 'offer', notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="hall"]`], ['wait', 1.5], ['js', '.u3-hl__grid [data-idx="2"]'], ['wait', 2]], input: '#u3TradeWin .u3-search__input' },
  'hall-offer-fortrade': { id: 'UI-31', under: 'UI-30', long: true, safe: true, hall: 'offer', notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="hall"]`], ['wait', 1.5], ['js', '.u3-hl__sw [data-seg="fortrade"]'], ['wait', 1], ['js', '.u3-hl__grid [data-idx="2"]'], ['wait', 2]], input: '#u3TradeWin .u3-search__input' },
  'boons':               { id: 'UI-27', notOn: ['tiny'], long: true, safe: true, steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="effects"]`], ['wait', 1.5]] },
  // v3 (UI-27): the Boons tab with my play history (Frequent and Recent), the limit states, the On you sheet, and the Card picker for a member (a card picked).
  'boons-hist':          { id: 'UI-27', notOn: ['tiny'], long: true, safe: true, fx: 'hist', steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="effects"]`], ['wait', 1.5]] },
  'boons-day':           { id: 'UI-27', notOn: ['tiny'], long: true, fx: 'day', steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="effects"]`], ['wait', 1.5]] },
  'boons-member':        { id: 'UI-27', notOn: ['tiny'], long: true, fx: 'member', steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="effects"]`], ['wait', 1.5]] },
  'boons-onyou':         { id: 'UI-27', notOn: ['tiny'], long: true, safe: true, fx: 'hist', steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="effects"]`], ['wait', 1.5], ['js', '.u3-bn-onyou', [['wait', 0]]], ['wait', 1.5]] },
  'boons-picker':        { id: 'UI-27', long: true, safe: true, fx: 'hist', notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="effects"]`], ['wait', 1.5], ['js', '#main .u3-mp-tile__pick'], ['wait', 1.5], ['js', '#u3Picker .u3-pk-card__pick'], ['wait', 1]], input: '#u3Picker .u3-search__input' },
  // v3 (UI-28): the play flow. The confirm window over the Card picker (boon or prank, a poll card, the error of a play that the check server
  // blocks), the played toast (ci_play=ok answers the play), the owner popup, the refund popup and the banners (derived /api/effects/me), and the profile Prank.
  'fx-confirm':          { id: 'UI-28', under: 'UI-27', long: true, safe: true, fx: 'hist', notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="effects"]`], ['wait', 1.5], ['js', '#main .u3-mp-tile__pick'], ['wait', 1.5], ['js', '#u3Picker .u3-pk-card__pick'], ['wait', 1], ['js', '#u3Picker [data-confirm]'], ['wait', 1.5]] },
  'fx-error':            { id: 'UI-28', under: 'UI-27', long: true, fx: 'hist', notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="effects"]`], ['wait', 1.5], ['js', '#main .u3-mp-tile__pick'], ['wait', 1.5], ['js', '#u3Picker .u3-pk-card__pick'], ['wait', 1], ['js', '#u3Picker [data-confirm]'], ['wait', 1], ['js', '#u3FxWin [data-fxplay]'], ['wait', 1.5]] },
  'fx-played':           { id: 'UI-28', under: 'UI-27', long: true, safe: true, fx: 'hist', play: 'ok', hold: true, notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="effects"]`], ['wait', 1.5], ['js', '#main .u3-mp-tile__pick'], ['wait', 1.5], ['js', '#u3Picker .u3-pk-card__pick'], ['wait', 1], ['js', '#u3Picker [data-confirm]'], ['wait', 1], ['js', '#u3FxWin [data-fxplay]'], ['wait', 1.5]] },
  'fx-poll':             { id: 'UI-28', under: 'UI-27', long: true, safe: true, fx: 'poll', notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="effects"]`], ['wait', 1.5], ['js', '#main .u3-mp-tile__pick'], ['wait', 1.5], ['js', '#u3Picker .u3-pk-card__pick'], ['wait', 1], ['js', '#u3Picker [data-confirm]'], ['wait', 1], ['js', '#u3FxWin [data-fxq="1"]'], ['wait', 1]] },
  'fx-owner':            { id: 'UI-28', under: 'UI-27', long: true, safe: true, fx: 'owner', notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="effects"]`], ['wait', 1.5], ['js', '#main .u3-mp-tile__pick'], ['wait', 1.5], ['js', '#u3Picker .u3-pk-card__pick'], ['wait', 1.5]] },
  'fx-refund':           { id: 'UI-28', under: 'UI-03', long: true, safe: true, fx: 'refund', notOn: ['tiny'], steps: [['wait', 3]] },
  'fx-banners':          { id: 'UI-28', under: 'UI-03', long: true, safe: true, fx: 'banners', hold: true, notOn: ['tiny'], steps: [['wait', 3]] },
  'fx-profile-prank':    { id: 'UI-28', under: 'UI-14', long: true, safe: true, fx: 'hist', notOn: ['tiny'], steps: [['wait', 4], ['js', '#menuBtn'], ['js', '[data-menu="board"]'], ['wait', 2], ['js', '.u3-lb-row[data-member]:not(.is-me)'], ['wait', 3], ['js', '#memPrank'], ['wait', 1.5]] },
  'fx-profile-confirm':  { id: 'UI-28', under: 'UI-14', long: true, fx: 'hist', notOn: ['tiny'], steps: [['wait', 4], ['js', '#menuBtn'], ['js', '[data-menu="board"]'], ['wait', 2], ['js', '.u3-lb-row[data-member]:not(.is-me)'], ['wait', 3], ['js', '#memPrank'], ['wait', 1.5], ['js', '#u3Picker .u3-pk-card__pick'], ['wait', 1], ['js', '#u3Picker [data-confirm]'], ['wait', 1.5]] },
  'boons-pick':          { id: 'UI-28', notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="effects"]`], ['wait', 1.5], ['js', '.fx-view .v2-cell']] },
  // v3 (UI-32): Auctions. The recording holds no auction: cookie ci_auction gives the derived states (serve.mjs: open, seller, seller-bids, seller-accepted,
  // bidder, bidder-bid, bidder-confirm). The list with 9 auctions, the empty Open and My auctions, Start (empty, the Card picker, a card chosen), the seller
  // view (no bid, bids, one accepted, Close early), the bidder view (no bid, my bid, the bid picker, Withdraw with Undo, the accepted bid to Confirm).
  'hall-auctions':       { id: 'UI-32', long: true, safe: true, auction: 'open', notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="hall"]`], ['wait', 1.5], ['js', '.u3-hl__sw [data-seg="auctions"]'], ['wait', 1.5]], input: '#main input[type=search], #main input[type=text]' },
  'auction-empty':       { id: 'UI-32', long: true, safe: true, notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="hall"]`], ['wait', 1.5], ['js', '.u3-hl__sw [data-seg="auctions"]'], ['wait', 1.5]] },
  'auction-mine-empty':  { id: 'UI-32', safe: true, notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="hall"]`], ['wait', 1.5], ['js', '.u3-hl__sw [data-seg="auctions"]'], ['wait', 1.5], ['js', '[data-aumine]'], ['wait', 1.5]] },
  'auction-start':       { id: 'UI-32', long: true, safe: true, notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="hall"]`], ['wait', 1.5], ['js', '.u3-hl__sw [data-seg="auctions"]'], ['wait', 1.5], ['js', '[data-aumanage]'], ['wait', 1.5]] },
  'auction-start-picker': { id: 'UI-32', safe: true, notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="hall"]`], ['wait', 1.5], ['js', '.u3-hl__sw [data-seg="auctions"]'], ['wait', 1.5], ['js', '[data-aumanage]'], ['wait', 1.5], ['js', '[data-aupickcard]'], ['wait', 1.5]], input: '#u3Picker .u3-search__input' },
  'auction-start-card':  { id: 'UI-32', long: true, safe: true, notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="hall"]`], ['wait', 1.5], ['js', '.u3-hl__sw [data-seg="auctions"]'], ['wait', 1.5], ['js', '[data-aumanage]'], ['wait', 1.5], ['js', '[data-aupickcard]'], ['wait', 1.5], ['js', '#u3Picker .u3-pk-card__pick'], ['wait', 0.5], ['js', '#u3Picker [data-confirm]'], ['wait', 1.5]] },
  'auction-seller':      { id: 'UI-32', long: true, safe: true, auction: 'seller', notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="hall"]`], ['wait', 1.5], ['js', '.u3-hl__sw [data-seg="auctions"]'], ['wait', 1.5], ['js', '.u3-au-grid [data-idx="0"]'], ['wait', 2]] },
  'auction-seller-bids': { id: 'UI-32', long: true, safe: true, auction: 'seller-bids', notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="hall"]`], ['wait', 1.5], ['js', '.u3-hl__sw [data-seg="auctions"]'], ['wait', 1.5], ['js', '.u3-au-grid [data-idx="0"]'], ['wait', 2]] },
  'auction-seller-accepted': { id: 'UI-32', long: true, safe: true, auction: 'seller-accepted', notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="hall"]`], ['wait', 1.5], ['js', '.u3-hl__sw [data-seg="auctions"]'], ['wait', 1.5], ['js', '.u3-au-grid [data-idx="0"]'], ['wait', 2]] },
  'auction-close':       { id: 'UI-32', safe: true, auction: 'seller', notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="hall"]`], ['wait', 1.5], ['js', '.u3-hl__sw [data-seg="auctions"]'], ['wait', 1.5], ['js', '.u3-au-grid [data-idx="0"]'], ['wait', 2], ['js', '[data-auclose]'], ['wait', 1]] },
  'auction-bidder':      { id: 'UI-32', long: true, safe: true, auction: 'bidder', notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="hall"]`], ['wait', 1.5], ['js', '.u3-hl__sw [data-seg="auctions"]'], ['wait', 1.5], ['js', '.u3-au-grid [data-idx="0"]'], ['wait', 2]] },
  'auction-bid':         { id: 'UI-32', long: true, safe: true, auction: 'bidder-bid', notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="hall"]`], ['wait', 1.5], ['js', '.u3-hl__sw [data-seg="auctions"]'], ['wait', 1.5], ['js', '.u3-au-grid [data-idx="0"]'], ['wait', 2]] },
  'auction-bid-picker':  { id: 'UI-32', safe: true, auction: 'bidder-bid', notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="hall"]`], ['wait', 1.5], ['js', '.u3-hl__sw [data-seg="auctions"]'], ['wait', 1.5], ['js', '.u3-au-grid [data-idx="0"]'], ['wait', 2], ['js', '.u3-au-slot:not(.is-full)'], ['wait', 1.5]], input: '#u3Picker .u3-search__input' },
  'auction-withdraw':    { id: 'UI-32', safe: true, auction: 'bidder-bid', notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="hall"]`], ['wait', 1.5], ['js', '.u3-hl__sw [data-seg="auctions"]'], ['wait', 1.5], ['js', '.u3-au-grid [data-idx="0"]'], ['wait', 2], ['js', '[data-auwithdraw]'], ['wait', 1.5]] },
  'auction-confirm':     { id: 'UI-32', long: true, safe: true, auction: 'bidder-confirm', notOn: ['tiny'], steps: [['dock', 'trading'], ['js', `${COMM} [data-tab="hall"]`], ['wait', 1.5], ['js', '.u3-hl__sw [data-seg="auctions"]'], ['wait', 1.5], ['js', '.u3-au-grid [data-idx="0"]'], ['wait', 2]] },
  'hunt-squad':          { id: 'UI-17', long: true, notOn: ['tiny'], steps: [['dock', 'battling', 3], ['js', '[data-adv="hunt"]'], ['wait', 6]] },
  // D-166: the trophy button in the squad stage Top 3 row opens the Leaderboard window (UI-66) on the Hunt tab; behind it the squad stage is UI-17.
  'hunt-board':          { safe: true, long: true, id: 'UI-66', under: 'UI-17', notOn: ['tiny'], board: 'rows', steps: [['dock', 'battling', 3], ['js', '[data-adv="hunt"]'], ['wait', 6], ['js', '#main [data-hboard]'], ['wait', 2.5]] },
  // v3: the Card picker (UI-64) in Hunt mode over the Hunt view (Auto-pick, locked cards, the short-squad dialog).
  // The Hunt with no live boss and with today's squad down (UI-19): states derived in serve.mjs from the recorded calls.
  'hunt-resting':        { id: 'UI-19', hunt: 'resting', notOn: ['tiny'], steps: [['dock', 'battling', 3], ['js', '[data-adv="hunt"]'], ['wait', 6]] },
  'hunt-down':           { id: 'UI-19', hunt: 'down', notOn: ['tiny'], steps: [['dock', 'battling', 3], ['js', '[data-adv="hunt"]'], ['wait', 6]] },
  // v3: the boss detail window (UI-20) over the Hunt view (a tap on the boss stage).
  'boss-window':         { id: 'UI-20', under: 'UI-17', notOn: ['tiny'], steps: [['dock', 'battling', 3], ['js', '[data-adv="hunt"]'], ['wait', 6], ['js', '[data-boss]'], ['wait', 2]] },
  'hunt-picker':         { id: 'UI-64', under: 'UI-17', notOn: ['tiny'], steps: [['dock', 'battling', 3], ['js', '[data-adv="hunt"]'], ['wait', 6], ['js', '[data-hpick]'], ['wait', 1.5]], input: '#u3Picker .u3-search__input' },
  // The card details (the v2 #viewer) opened from a Card picker tile (UI-64, Nathan 2026-10-08): the card and its info whole inside the safe frame.
  'hunt-picker-detail':  { id: 'UI-64', safe: true, under: 'UI-17', notOn: ['tiny'], steps: [['dock', 'battling', 3], ['js', '[data-adv="hunt"]'], ['wait', 6], ['js', '[data-hpick]'], ['wait', 1.5], ['js', '.u3-pk-card__info'], ['wait', 1.5]] },
  'hunt-battle':         { id: 'UI-18', long: true, safe: true, notOn: ['tiny'], battle: true, steps: [['dock', 'battling', 3], ['js', '[data-adv="hunt"]'], ['wait', 9]] },
  // UI-18: the fight with two supports and one card down (D-68 plates, D-69 support HP), and the targeting state (D-70: a support is a valid target).
  'hunt-battle-mix':    { safe: true, long: true, id: 'UI-18', notOn: ['tiny'], battle: 'mix', steps: [['dock', 'battling', 3], ['js', '[data-adv="hunt"]'], ['wait', 9]] },
  'hunt-battle-target': { safe: true, long: true, id: 'UI-18', notOn: ['tiny'], battle: 'mix', steps: [['dock', 'battling', 3], ['js', '[data-adv="hunt"]'], ['wait', 9], ['js', '.u3-ft-grid .c[data-id="370"]'], ['wait', 1]] },
  // v3: tiny shows no shell, so the Adventure tabs are not there (D-06: the small live view, UI-59).
  'dungeon':             { id: 'UI-46', long: true, safe: true, notOn: ['tiny'], steps: [['dock', 'battling', 4], ['js', '[data-adv="dungeon"]'], ['wait', 2.5]] },
  // The Card picker (UI-64) over the Dungeon lobby (D-40): a defect outside the window belongs to the lobby ('under').
  'dungeon-picker':      { id: 'UI-64', under: 'UI-46', notOn: ['tiny'], steps: [['dock', 'battling', 4], ['js', '[data-adv="dungeon"]'], ['wait', 2.5], ['js', '[data-pickopen]'], ['wait', 1.5]], input: '#u3Picker .u3-search__input' },
  'dungeon-picker-detail': { id: 'UI-64', safe: true, under: 'UI-46', notOn: ['tiny'], steps: [['dock', 'battling', 4], ['js', '[data-adv="dungeon"]'], ['wait', 2.5], ['js', '[data-pickopen]'], ['wait', 1.5], ['js', '.u3-pk-card__info'], ['wait', 1.5]] },
  // v3: a run in the "Choose a reward" step (UI-48): the check server answers a run with 3 offers (cookie ci_dungeon=choose).
  'dungeon-choose':      { id: 'UI-48', long: true, safe: true, notOn: ['tiny'], dungeon: 'choose', steps: [['dock', 'battling', 4], ['js', '[data-adv="dungeon"]'], ['wait', 2.5]] },
  // v3: the room steps and Floor cleared (UI-49), derived runs of the check server (cookie ci_dungeon = rest | path | chest | floor).
  'dungeon-rest':        { id: 'UI-49', long: true, safe: true, notOn: ['tiny'], dungeon: 'rest', steps: [['dock', 'battling', 4], ['js', '[data-adv="dungeon"]'], ['wait', 2.5]] },
  'dungeon-path':        { id: 'UI-49', long: true, safe: true, notOn: ['tiny'], dungeon: 'path', steps: [['dock', 'battling', 4], ['js', '[data-adv="dungeon"]'], ['wait', 2.5]] },
  // v3: the unlock gate (UI-53) on the three Adventure tabs: the check server answers a locked member (cookie ci_hunt / ci_dungeon = gate).
  'gate-hunt':           { id: 'UI-53', long: true, safe: true, notOn: ['tiny'], hunt: 'gate', steps: [['dock', 'battling', 3], ['js', '[data-adv="hunt"]'], ['wait', 4]] },
  'gate-dungeon':        { id: 'UI-53', long: true, safe: true, notOn: ['tiny'], dungeon: 'gate', steps: [['dock', 'battling', 4], ['js', '[data-adv="dungeon"]'], ['wait', 2.5]] },
  'gate-gauntlet':       { id: 'UI-53', long: true, safe: true, notOn: ['tiny'], dungeon: 'gate', steps: [['dock', 'battling', 4], ['js', '[data-adv="gauntlet"]'], ['wait', 2.5]] },
  'dungeon-chest':       { id: 'UI-49', long: true, safe: true, notOn: ['tiny'], dungeon: 'chest', steps: [['dock', 'battling', 4], ['js', '[data-adv="dungeon"]'], ['wait', 2.5]] },
  'dungeon-chest-open':  { id: 'UI-49', long: true, safe: true, notOn: ['tiny'], dungeon: 'chest', steps: [['dock', 'battling', 4], ['js', '[data-adv="dungeon"]'], ['wait', 2.5], ['js', '.u3-dgs-chestbox'], ['wait', 2.5]] },
  'dungeon-chest-flipped': { id: 'UI-49', long: true, safe: true, notOn: ['tiny'], dungeon: 'chest', steps: [['dock', 'battling', 4], ['js', '[data-adv="dungeon"]'], ['wait', 2.5], ['js', '.u3-dgs-chestbox'], ['wait', 2.5], ['js', '.u3-dgs-cf [data-flip]'], ['wait', 1.5]] },
  'dungeon-floor':       { id: 'UI-49', long: true, safe: true, notOn: ['tiny'], dungeon: 'floor', steps: [['dock', 'battling', 4], ['js', '[data-adv="dungeon"]'], ['wait', 2.5]] },
  'dungeon-floor-revealed': { id: 'UI-49', long: true, safe: true, notOn: ['tiny'], dungeon: 'floor', steps: [['dock', 'battling', 4], ['js', '[data-adv="dungeon"]'], ['wait', 2.5], ['js', '.u3-dgs-reveal'], ['wait', 4]] },
  'dungeon-retreat':     { id: 'UI-49', long: true, safe: true, notOn: ['tiny'], dungeon: 'floor', steps: [['dock', 'battling', 4], ['js', '[data-adv="dungeon"]'], ['wait', 2.5], ['js', '.u3-dgs-leave'], ['wait', 1.5]] },
  // The same step with other rewards (Heal, damage bonus, Revive): the panel is the same size as in dungeon-choose (D-125 review: one layout).
  'dungeon-choose2':     { id: 'UI-48', long: true, safe: true, notOn: ['tiny'], dungeon: 'choose2', steps: [['dock', 'battling', 4], ['js', '[data-adv="dungeon"]'], ['wait', 2.5]] },
  // v3: a Dungeon fight (UI-47, a horde of 5 and a room of 2; D-70 the support picking) and the run over (UI-50): derived runs of the check server.
  'dungeon-fight':       { id: 'UI-47', long: true, safe: true, notOn: ['tiny'], dungeon: 'fight', steps: [['dock', 'battling', 4], ['js', '[data-adv="dungeon"]'], ['wait', 12]] },
  'dungeon-fight2':      { id: 'UI-47', long: true, safe: true, notOn: ['tiny'], dungeon: 'fight2', steps: [['dock', 'battling', 4], ['js', '[data-adv="dungeon"]'], ['wait', 12]] },
  'dungeon-fight-pick':  { id: 'UI-47', long: true, safe: true, notOn: ['tiny'], dungeon: 'fight', steps: [['dock', 'battling', 4], ['js', '[data-adv="dungeon"]'], ['wait', 5], ['js', '.dg-sup'], ['wait', 1]] },
  'dungeon-over':        { id: 'UI-50', long: true, safe: true, notOn: ['tiny'], dungeon: 'over', steps: [['dock', 'battling', 4], ['js', '[data-adv="dungeon"]'], ['wait', 2.5]] },
  'dungeon-over-revealed': { id: 'UI-50', long: true, safe: true, notOn: ['tiny'], dungeon: 'over', steps: [['dock', 'battling', 4], ['js', '[data-adv="dungeon"]'], ['wait', 2.5], ['js', '.u3-dgs-reveal, .dg-reveal'], ['wait', 3]] },
  // v3: the loader and the sign-in retry (UI-56). `loader` = the sign-in state (sdk-stub.js reads the cookie ci_loader): wait = never answers
  // (loader: 'loading' shows the bar; 'timeout' waits the real 15 s), error = fails. run.mjs stores the hint lp_ui3=1 (the loader cannot know
  // the flag before the sign-in) and measures the loader block (the checks skip #loader, so run.mjs renames it for these cells).
  'loader':              { id: 'UI-56', loader: 'loading', steps: [] },
  'loader-timeout':      { id: 'UI-56', loader: 'timeout', steps: [] },
  'loader-error':        { id: 'UI-56', loader: 'error', steps: [] },
  // v3: the Dungeon "See the leaderboard" button opens the one Leaderboard window (UI-66) on the Dungeon tab: a defect outside the window belongs to the lobby ('under').
  'dungeon-board':       { safe: true, long: true, id: 'UI-66', under: 'UI-46', notOn: ['tiny'], board: 'rows', steps: [['dock', 'battling', 4], ['js', '[data-adv="dungeon"]'], ['wait', 2.5], ['js', '#main [data-board]', [['js', '[data-seg="pane:top"]'], ['wait', 1.5], ['js', '#main [data-board]']]], ['wait', 2.5]] },
  // The Gauntlet lobby "See the leaderboard" button opens the Leaderboard window (UI-66) on the Gauntlet tab; behind it the lobby is UI-52.
  // The v3 lobby (UI-52) keeps the button in the Top 3 panel: on phones and tall tablets that panel is the segment pane:top (data-seg), so the fallback taps it first.
  'gauntlet-board':      { safe: true, long: true, id: 'UI-66', under: 'UI-52', notOn: ['tiny'], board: 'rows', steps: [['dock', 'battling', 4], ['js', '[data-adv="gauntlet"]'], ['wait', 2.5], ['js', '#main [data-board]', [['js', '[data-seg="pane:top"]'], ['wait', 1.5], ['js', '#main [data-board]']]], ['wait', 2.5]] },
  // The Gauntlet (UI-52): the lobby, then its Prizes and Top 3 tabs (phones show them as tabs; the wide classes show them in the lobby).
  'gauntlet':            { id: 'UI-52', long: true, safe: true, notOn: ['tiny'], steps: [['dock', 'battling', 4], ['js', '[data-adv="gauntlet"]'], ['wait', 2.5]] },
  'gauntlet-over':       { id: 'UI-52', long: true, safe: true, notOn: ['tiny'], dungeon: 'g-over', steps: [['dock', 'battling', 4], ['js', '[data-adv="gauntlet"]'], ['wait', 2.5]] },
  // The Gauntlet fight (UI-52, a delta on the UI-47 fight) and a support picking a target (D-70): the derived run of the check server (cookie ci_dungeon = g-fight).
  'gauntlet-fight':      { id: 'UI-52', long: true, safe: true, notOn: ['tiny'], dungeon: 'g-fight', steps: [['dock', 'battling', 4], ['js', '[data-adv="gauntlet"]'], ['wait', 12]] },
  'gauntlet-fight-pick': { id: 'UI-52', long: true, safe: true, notOn: ['tiny'], dungeon: 'g-fight', steps: [['dock', 'battling', 4], ['js', '[data-adv="gauntlet"]'], ['wait', 5], ['js', '.dg-sup'], ['wait', 1]] },
  'gauntlet-prizes':     { id: 'UI-52', long: true, safe: true, notOn: ['tiny', 'medium', 'expanded', 'compact-land'], steps: [['dock', 'battling', 4], ['js', '[data-adv="gauntlet"]'], ['wait', 2.5], ['js', '[data-seg="pane:prizes"]', [['wait', 0]]], ['wait', 1]] },
  'gauntlet-top':        { id: 'UI-52', long: true, safe: true, notOn: ['tiny', 'medium', 'expanded', 'compact-land'], steps: [['dock', 'battling', 4], ['js', '[data-adv="gauntlet"]'], ['wait', 2.5], ['js', '[data-seg="pane:top"]', [['wait', 0]]], ['wait', 1]] },
  // The Shop (UI-43): tiny has no top bar, so no Shop button (D-06: the small live view, UI-59).
  'shop':                { id: 'UI-43', long: true, safe: true, notOn: ['tiny'], steps: [['js', '#shopBtn'], ['wait', 2]] },
  // The stat reset picker (UI-64 pick one, from Shop > Stat reset > Choose a card): a defect outside the window belongs to the Shop ('under').
  'shop-reset-picker':   { id: 'UI-64', long: true, safe: true, stats: 'many', under: 'UI-43', notOn: ['tiny'], steps: [['js', '#shopBtn'], ['wait', 2], ['js', '[data-tab="reset"]', [['wait', 0]]], ['js', '[data-choose]'], ['wait', 1.5]], input: '#u3Picker .u3-search__input' },
  'shop-confirm':        { id: 'UI-43', safe: true, notOn: ['tiny'], steps: [['js', '#shopBtn'], ['wait', 2], ['js', '[data-buy]:not([disabled])']] },
  // Convert extra copies (UI-44): the window over the card detail (UI-08); minus = one copy less; error = the refused write (no fixture for POST).
  'convert':             { id: 'UI-44', under: 'UI-08', long: true, safe: true, notOn: ['tiny'], steps: [['dock', 'collection'], ['js', '#main .u3-ctile:not(.is-locked)'], ['wait', 2.5], ['js', '#pConvert'], ['wait', 1]] },
  'convert-minus':       { id: 'UI-44', under: 'UI-08', notOn: ['tiny'], steps: [['dock', 'collection'], ['js', '#main .u3-ctile:not(.is-locked)'], ['wait', 2.5], ['js', '#pConvert'], ['wait', 1], ['js', '#u3ShopDlg [aria-label="Decrease"]'], ['wait', 0.5]] },
  'convert-error':       { id: 'UI-44', under: 'UI-08', notOn: ['tiny'], steps: [['dock', 'collection'], ['js', '#main .u3-ctile:not(.is-locked)'], ['wait', 2.5], ['js', '#pConvert'], ['wait', 1], ['js', '#u3ShopDlg [data-go]'], ['wait', 1.5]] },
  // The Dailies window (UI-36) opens over Home from the menu: a defect outside the window belongs to Home ('under'). tiny has no menu (D-06).
  // The first wait: the menu shows the Dailies tile only after /api/dailies answered (the tile of a window that is off is hidden).
  'dailies':             { id: 'UI-36', long: true, safe: true, under: 'UI-03', cornerWindow: true, notOn: ['tiny'], steps: [['wait', 3], ['js', '#menuBtn'], ['js', '[data-menu="dailies"]'], ['wait', 1.5]] },
  // The bell window (UI-24) opens over Home: a defect outside the window belongs to Home ('under'). tiny has no top bar (D-06).
  'bell-many':           { id: 'UI-24', long: true, safe: true, under: 'UI-03', notOn: ['tiny'], notes: 'many', steps: [['js', '#bellBtn']] },
  'bell':                { id: 'UI-24', safe: true, long: true, under: 'UI-03', notOn: ['tiny'], steps: [['js', '#bellBtn']] },
  // The Settings window (UI-61) opens over Home from the menu: a defect outside the window belongs to Home ('under'). tiny has no menu (D-06).
  'settings':            { id: 'UI-61', safe: true, under: 'UI-03', notOn: ['tiny'], steps: [['wait', 2], ['js', '#menuBtn'], ['js', '[data-menu="settings"]'], ['wait', 1.5]] },
  // The Leaderboard window (UI-66, D-44) opens over Home from the menu: a defect outside the window belongs to Home ('under'). tiny has no menu (D-06).
  'leaderboard':         { safe: true, long: true, id: 'UI-66', under: 'UI-03', notOn: ['tiny'], board: 'rows', steps: [['wait', 4], ['js', '#menuBtn'], ['js', '[data-menu="board"]'], ['wait', 2]] },
  'leaderboard-hunt':    { safe: true, long: true, id: 'UI-66', under: 'UI-03', notOn: ['tiny'], board: 'rows', steps: [['wait', 4], ['js', '#menuBtn'], ['js', '[data-menu="board"]'], ['wait', 2], ['js', '#u3LbHost [data-tab="hunt"]'], ['wait', 2]] },
  'leaderboard-dungeon': { safe: true, long: true, id: 'UI-66', under: 'UI-03', notOn: ['tiny'], board: 'rows', steps: [['wait', 4], ['js', '#menuBtn'], ['js', '[data-menu="board"]'], ['wait', 2], ['js', '#u3LbHost [data-tab="dungeon"]'], ['wait', 2]] },
  'leaderboard-gauntlet': { safe: true, long: true, id: 'UI-66', under: 'UI-03', notOn: ['tiny'], board: 'rows', steps: [['wait', 4], ['js', '#menuBtn'], ['js', '[data-menu="board"]'], ['wait', 2], ['js', '#u3LbHost [data-tab="gauntlet"]'], ['wait', 2]] },
  // The states: Main with an error answer, and the Hunt, Dungeon and Gauntlet tabs with no rows or an error answer.
  'leaderboard-error':   { id: 'UI-66', under: 'UI-03', notOn: ['tiny'], board: 'error', steps: [['wait', 4], ['js', '#menuBtn'], ['js', '[data-menu="board"]'], ['wait', 2]] },
  'leaderboard-hunt-error': { id: 'UI-66', under: 'UI-03', notOn: ['tiny'], board: 'error', steps: [['wait', 4], ['js', '#menuBtn'], ['js', '[data-menu="board"]'], ['wait', 2], ['js', '#u3LbHost [data-tab="hunt"]'], ['wait', 2]] },
  'leaderboard-hunt-empty': { id: 'UI-66', under: 'UI-03', notOn: ['tiny'], board: 'empty', steps: [['wait', 4], ['js', '#menuBtn'], ['js', '[data-menu="board"]'], ['wait', 2], ['js', '#u3LbHost [data-tab="hunt"]'], ['wait', 2]] },
  'leaderboard-dungeon-empty': { id: 'UI-66', under: 'UI-03', notOn: ['tiny'], board: 'empty', steps: [['wait', 4], ['js', '#menuBtn'], ['js', '[data-menu="board"]'], ['wait', 2], ['js', '#u3LbHost [data-tab="dungeon"]'], ['wait', 2]] },
  'leaderboard-gauntlet-empty': { id: 'UI-66', under: 'UI-03', notOn: ['tiny'], board: 'empty', steps: [['wait', 4], ['js', '#menuBtn'], ['js', '[data-menu="board"]'], ['wait', 2], ['js', '#u3LbHost [data-tab="gauntlet"]'], ['wait', 2]] },
  'profile':             { id: 'UI-14', safe: true, long: true, notOn: ['tiny'], steps: [['wait', 4], ['js', '#menuBtn'], ['js', '[data-menu="board"]'], ['wait', 2], ['js', '.u3-lb-row[data-member]:not(.is-me)'], ['wait', 3]] },   // lane 1 v3 Leaderboard rows (UI-66)
  'style-editor':        { id: 'UI-15', safe: true, notOn: ['tiny'], steps: [['wait', 3], ['js', '#v2Avatar'], ['wait', 3], ['js', '#memCos'], ['wait', 1.5]] },
  // UI-15 opens the Card picker for the Spotlight (D-80 item 16): a defect inside the picker window belongs to UI-64
  'style-picker':        { id: 'UI-64', under: 'UI-15', notOn: ['tiny'], steps: [['wait', 3], ['js', '#v2Avatar'], ['wait', 3], ['js', '#memCos'], ['wait', 1.5], ['js', '#u3StyleHost [data-sepick]'], ['wait', 1.5]], input: '#u3Picker .u3-search__input' },
  // The Wishlist drawer (UI-16, D-128) pulls up from the handle strip at the bottom of the own Profile (UI-14): a defect outside the drawer
  // belongs to the Profile ('under'). The wish picker is the Card picker (UI-64) over the drawer. tiny has no top bar avatar (D-06).
  // 'wishlist' = 4 cards and an empty slot (the approved edit-empty-slot state); 'wishlist-drawer' = all 5 slots filled (the approved edit state).
  'wishlist':            { id: 'UI-16', long: true, safe: true, under: 'UI-14', notOn: ['tiny'], steps: [['wait', 4], ['js', '#v2Avatar'], ['wait', 3], ['js', '#wlHandle'], ['wait', 1.5]] },
  'wishlist-drawer':     { id: 'UI-16', long: true, safe: true, under: 'UI-14', wish: 'full', notOn: ['tiny'], steps: [['wait', 4], ['js', '#v2Avatar'], ['wait', 3], ['js', '#wlHandle'], ['wait', 1.5]] },
  'wish-picker':         { id: 'UI-16', safe: true, under: 'UI-14', notOn: ['tiny'], steps: [['wait', 4], ['js', '#v2Avatar'], ['wait', 3], ['js', '#wlHandle'], ['wait', 1.5], ['js', '#u3Wish [data-wlset]'], ['wait', 1.5]], input: '#u3Picker .u3-search__input' },
  // The own profile (the avatar in the top bar): the Spotlight Edit, Title & frame and the editable wishlist show only here.
  'profile-own':         { id: 'UI-14', safe: true, long: true, notOn: ['tiny'], steps: [['wait', 4], ['js', '#v2Avatar'], ['wait', 3]] },
  // The same with all five wishlist slots filled (the handle strip shows 5/5; the Spotlight and the Season are tabs on the smallest phones, D-113; the Wishlist never is, D-128).
  'profile-own-wish':    { id: 'UI-14', safe: true, long: true, wish: 'full', notOn: ['tiny'], steps: [['wait', 4], ['js', '#v2Avatar'], ['wait', 3], ['wait', 2]] },
  // Avatar effects (UI-55): the mustache on every avatar of the member (cookie ci_avfx=on: serve.mjs adds it to the badge list for the signed-in
  // member, the Home members and the leaderboard). A defect outside the effect belongs to the host screen ('under').
  'avatarfx-home':       { id: 'UI-55', under: 'UI-03', long: true, safe: true, home: 'busy', avfx: 'on', notOn: ['tiny'], steps: [['wait', 3]] },
  'avatarfx-profile':    { id: 'UI-55', under: 'UI-14', long: true, safe: true, avfx: 'on', notOn: ['tiny'], steps: [['wait', 4], ['js', '#v2Avatar'], ['wait', 3]] },
  'avatarfx-board':      { id: 'UI-55', under: 'UI-22', long: true, avfx: 'on', notOn: ['tiny'], steps: [['wait', 4], ['js', '#menuBtn'], ['js', '[data-menu="board"]'], ['wait', 2]] },
  // The same with the Wishlist tab open (phones show the Spotlight, the Season and the Wishlist as tabs, D-113).
  'help':                { id: 'UI-38', safe: true, under: 'UI-03', cornerWindow: true, notOn: ['tiny'], steps: [['wait', 2], ['js', '#menuBtn'], ['js', '[data-menu="faq"]'], ['wait', 1.5]] },
  'help-closed':          { id: 'UI-38', safe: true, under: 'UI-03', cornerWindow: true, notOn: ['tiny'], steps: [['wait', 2], ['js', '#menuBtn'], ['js', '[data-menu="faq"]'], ['wait', 1.5], ['js', '[data-q="0"]'], ['wait', 0.5]] },
  // UI-57: the standalone public legal pages (no Activity, no flag): `page` loads that path instead of the Activity.
  'legal-terms':         { id: 'UI-57', safe: true, cornerWindow: true, page: '/app/legal/terms.html', steps: [] },
  'legal-privacy':       { id: 'UI-57', safe: true, cornerWindow: true, page: '/app/legal/privacy.html', steps: [] },
  // The Feedback window (UI-40) opens over Home from the menu (the check server turns the report flag on: cookie ci_report). The send is blocked (403): report-error shows the error state.
  'report':              { id: 'UI-40', safe: true, under: 'UI-03', report: true, cornerWindow: true, notOn: ['tiny'], input: '#u3RpText', steps: [['wait', 2], ['js', '#menuBtn'], ['js', '[data-menu="feedback"]'], ['wait', 1.5]] },
  'report-typed':        { id: 'UI-40', safe: true, under: 'UI-03', report: true, cornerWindow: true, notOn: ['tiny'], input: '#u3RpText', steps: [['wait', 2], ['js', '#menuBtn'], ['js', '[data-menu="feedback"]'], ['wait', 1.5], ['type', '#u3RpText', 'The pack chooser covers the dock.']] },
  'report-error':        { id: 'UI-40', safe: true, under: 'UI-03', report: true, cornerWindow: true, notOn: ['tiny'], input: '#u3RpText', steps: [['wait', 2], ['js', '#menuBtn'], ['js', '[data-menu="feedback"]'], ['wait', 1.5], ['type', '#u3RpText', 'The pack chooser covers the dock.'], ['js', '[data-rp-send]'], ['wait', 1.5]] },
  'help-item5':         { id: 'UI-38', safe: true, under: 'UI-03', cornerWindow: true, notOn: ['tiny'], steps: [['wait', 2], ['js', '#menuBtn'], ['js', '[data-menu="faq"]'], ['wait', 1.5], ['js', '[data-q="4"]'], ['wait', 0.5]] },
  // The menu (UI-60) opens over Home: a defect outside the menu belongs to Home ('under'). tiny has no menu (D-06).
  'menu':                { id: 'UI-60', under: 'UI-03', notOn: ['tiny'], steps: [['wait', 2], ['js', '#menuBtn'], ['wait', 1]] },
  // The first-time walkthrough (UI-37): FAQ > Replay tutorial starts it over Home, then Next goes on. walk: true runs checks/walkthrough.js
  // (the check skips #tutLayer everywhere else): the card never covers the spotlighted control or the corner zone, Skip and Next are 44 px.
  // gifts: true = a gift waits in the bell (cookie ci_gifts, serve.mjs): step 1 shows; without it step 1 is skipped ("STEP 1 OF 7").
  // The page under the dim belongs to Home ('under'). tiny has no shell (D-06).
  'walk-1':              { id: 'UI-37', safe: true, under: 'UI-03', walk: true, gifts: true, notOn: ['tiny'], steps: [...WALK_START, ['wait', 1]] },
  'walk-2':              { id: 'UI-37', safe: true, under: 'UI-03', walk: true, notOn: ['tiny'], steps: [...WALK_START, ['wait', 1]] },
  'walk-5':              { id: 'UI-37', safe: true, under: 'UI-03', walk: true, notOn: ['tiny'], steps: [...WALK_START, ...WALK_NEXT(3)] },
  'walk-8':              { id: 'UI-37', safe: true, under: 'UI-03', walk: true, notOn: ['tiny'], steps: [...WALK_START, ...WALK_NEXT(6)] },
  // The Open window (UI-33) opens over Home: a defect outside the window belongs to Home ('under'). tiny has no dock (D-06).
  'open-chooser':        { id: 'UI-33', safe: true, under: 'UI-03', notOn: ['tiny'], steps: [['wait', 4], ['js', '#dockOpen']] },
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
  // The logo (UI-23): the top bar lockup (A, B or C by size class) on the Home screen; the loader lockup D is the specs loader / loader-error (UI-56 frame).
  'logo':                { id: 'UI-23', safe: true, under: 'UI-03', home: 'busy', notOn: ['tiny'], steps: [] },
  'pack-single-all':     { id: 'UI-34', under: 'UI-03', notOn: ['tiny'], steps: [['wait', 4], ['js', '#dockOpen'], ['js', '.u3-count[data-count="1"]'], ['wait', 1.5], ['js', '#packOpen'], ['wait', 4], ['js', '[data-reveal="all"]'], ['wait', 4]] },
  // The small live view (UI-59, the tiny class only): the live Hunt and the resting state (ci_home live and busy). No typing there (D-138).
  'tiny-live':           { id: 'UI-59', long: true, home: 'live', notOn: ['compact-port', 'compact-land', 'medium', 'medium-short', 'expanded'], steps: [] },
  'tiny-rest':           { id: 'UI-59', long: true, home: 'busy', notOn: ['compact-port', 'compact-land', 'medium', 'medium-short', 'expanded'], steps: [] },
};

// The shell (top bar, dock, sub-tabs) is on every screen: a defect there belongs to the shell IDs.
export function ownerOf(screen, where) {
  // A path names an element as id + tag ('#topbarheader', '#docknav'), so the id can run into the tag name.
  if (/#tutLayer[a-z]*\b|\.u3-wt\b|\.u3-wt[-_]/.test(where)) return 'UI-37';
  if (/#u3TrHost\b|\.u3-trhost\b|\.u3-tr\b|\.u3-tr[-_]|\.u3-trw\b|\.u3-trw[-_]|\.u3-fr\b|\.u3-fr[-_]/.test(where)) return 'UI-13';   // the tracks, the track window, the title and frame tiles (UI-13)
  if (/\.u3-avfx\b|\.u3-avfx[-_]/.test(where)) return 'UI-55';   // the avatar effect overlay (UI-55)
  if (/\.u3-tn\b|\.u3-tn[-_]/.test(where)) return 'UI-59';   // the small live view (tiny class)
  if (/#u3Menu(Host)?[a-z]*\b|\.u3-menu|\.u3-mtile/.test(where)) return 'UI-60';
  if (/#u3OpenHost[a-z]*\b|\.u3-open\b|\.u3-set\b|\.u3-count\b/.test(where)) return 'UI-33';
  if (/#u3Lb(Host)?[a-z]*\b|\.u3-lb\b|\.u3-lb[-_]|\.u3-lbhost\b/.test(where)) return 'UI-66';
  // The card details (the v2 #viewer) opened from a Card picker: UI-64 owns them there (only the picker detail specs), the screen under the scrim does not.
  // Other screens keep their owner (collection-detail: UI-08 opens the viewer at some sizes and its side panel at others).
  if (/-picker-detail$/.test(screen) && /#viewer[a-z-]*\b|\.viewer-(info|stage|nav)\b|\.vr-|#v-[a-z-]+/.test(where)) return 'UI-64';
  // UI-09: the card viewer opened from the Card Detail (collection-viewer): the viewer and its buttons. UI-10: the celebration's Spend points
  // button and the inline errors of an Ascend or a stat point save (the Card Detail panel around them is UI-08).
  // The Card Detail window (UI-08) is the top layer of the Collection specs; the Collection behind its scrim (the v2 grid and Filters, UI-07) owns what is
  // not in the window. Without this rule a Game chip that the filter panel folds away at 1280x720 (fitChips) was blamed on UI-08.
  if (/\.asc-spend\b|#pAscFail|#ptsFail|\.u3-fail\b/.test(where)) return 'UI-10';
  if (/^collection-detail/.test(screen) && /#viewer[a-z-]*\b|\.viewer-(info|stage|nav)\b/.test(where)) return 'UI-08';   // the viewer that opens with the window at some sizes
  if (/#u3Det|\.u3-det\b|\.u3-det__|#pPts|#pAscend|#pConvert|#pSpot|#pTrade|#pArt|#pClose|#colEffect/.test(where)) return 'UI-08';
  if (screen === 'collection-viewer' && /#viewer[a-z-]*\b|\.viewer-(info|stage|nav|win)\b|#v-[a-z-]+|#card3d/.test(where)) return 'UI-09';
  if (/#u3TradeWin[a-z]*\b|\.u3-tw\b|\.u3-tw[-_]/.test(where)) return 'UI-63';
  if (/#u3VoiceWin[a-z]*\b|\.u3-vw\b|\.u3-vw[-_]|\.u3-hm-more\b/.test(where)) return 'UI-06';   // the Live in voice window and its "+N" button
  if (/\.u3-hm-(car|ctl|slide|dots|pip|labels|sb|sart|sinfo|strow|date|stimer|rule|rl|sline|sboard|sbh|sbt|sbl|sbr|sbk|sbn|sbd|sbe|sbc)\b/.test(where)) return 'UI-05';   // the carousel: the slides, the control
  if (/\.u3-hm-board\b|\.u3-hm-br[a-z]*\b/.test(where)) return 'UI-04';   // the Top 3 board in the Home hero (D-58)   // the Trade window; its card tiles are UI-64 classes inside .u3-tw__grid
  if (/#u3TradeWin[a-z]*\b|\.u3-tw\b|\.u3-tw[-_]/.test(where)) return 'UI-63';   // the Trade window; its card tiles are UI-64 classes inside .u3-tw__grid
  // The Card picker (UI-64) opened from the Boons tab (UI-27): the window of that spec is UI-27's (its head, kind switch and foot are the Boons form).
  if (screen === 'boons-picker' && /#u3Picker[a-z]*\b|\.u3-pk\b|\.u3-pk[-_]|\.u3-bn-/.test(where)) return 'UI-27';
  if (/#u3Tfx\b|\.u3-tfx\b|\.u3-tfx[-_]/.test(where)) return 'UI-26';   // the trade animation layer
  if (/#u3TradeWin[a-z]*\b|\.u3-tw\b|\.u3-tw[-_]/.test(where)) return 'UI-63';   // the Trade window; its card tiles are UI-64 classes inside .u3-tw__grid
  // UI-28: the confirm window, the owner and refund popups, the play toast and the incoming banners; the Card picker under them stays UI-27's (the Boons form)
  if (/#u3Fx[A-Za-z]*\b|\.u3-fxw\b|\.u3-fxw[-_]|\.u3-fxn\b|\.u3-fxn[-_]|\.u3-fxb\b|\.u3-fxb[-_]|\.u3-fx-toast\b/.test(where)) return 'UI-28';
  if (/^fx-/.test(screen) && /#u3Picker[a-z]*\b|\.u3-pk\b|\.u3-pk[-_]|\.u3-bn-/.test(where)) return 'UI-27';
  if (/#u3Picker[a-z]*\b|\.u3-pk\b|\.u3-pk[-_]/.test(where)) return 'UI-64';
  if (/\.u3-ls\b|\.u3-ls[-_]|#lsSlots|#u3LsToast/.test(where)) return 'UI-31';   // List a card (the sheet, its slots, the Undo toast)
  if (/\.u3-au\b|\.u3-au[-_]|#u3Au[A-Za-z]*\b/.test(where)) return 'UI-32';   // Auctions (the views, the Confirm and Close early windows, the Undo toast)
  if (/#u3Wish[a-z]*\b|\.u3-wl\b|\.u3-wl[-_]|#wlHandle|\.u3-pf-wishbar/.test(where)) return 'UI-16';
  // the member profile under a window opened from it (the UI-15 style editor) belongs to UI-14
  if (screen !== 'profile' && /#memberModal[a-z]*\b|#mem[A-Z]|\.mem-|\.u3-pf\b|\.u3-pf-|\.wl-/.test(where)) return 'UI-14';
  if (/#u3BossWin[a-z]*\b|\.u3-bw\b|\.u3-bw[-_]/.test(where)) return 'UI-20';
  if (/#(v2Dailies|u3DlToast)[a-z]*\b|\.u3-dl\b|\.u3-dl[-_]/.test(where)) return 'UI-36';
  if (/\.u3-mp-sug\b|\.u3-mp-sug[-_]/.test(where)) return 'UI-29';   // the member suggest list under the Member picker search
  if (/\.u3-bn-|#u3BoonsSheet|\.u3-boons\b/.test(where)) return 'UI-27';   // the Boons tab: the panel, the lists, the limit line (the Member picker inside stays UI-65)
  if (/\.u3-mp\b|\.u3-mp[-_]/.test(where)) return 'UI-65';
  if (/\.u3-pd\b|\.u3-pd[-_]|#u3Pd[a-z]*\b|\.u3-trades\b|\.u3-trades[-_]/.test(where)) return 'UI-25';   // Pending, its sheet, the Offer view, the Trades layout
  if (/#v2Notifs[a-z]*\b|\.u3-bell|\.u3-note\b|\.u3-note__|\.u3-gift\b|\.u3-gift__/.test(where)) return 'UI-24';
  if (/#u3Settings[a-z]*\b|\.u3-st\b|\.u3-st[-_]/.test(where)) return 'UI-61';
  if (SCREENS[screen].id === 'UI-50' && /\.u3-dg[sc]\b|\.u3-dg[sc][-_]/.test(where)) return 'UI-50';   // the run over shares the room-step parts of UI-49
  if (/\.u3-dgs\b|\.u3-dgs[-_]/.test(where) || (SCREENS[screen].id === 'UI-49' && /\.u3-dgc\b|\.u3-dgc[-_]/.test(where))) return 'UI-49';   // the room steps share the UI-48 stage parts
  if (/#v2Help[a-z]*\b|\.u3-hp\b|\.u3-hp[-_]/.test(where)) return 'UI-38';
  if (/#(v2Report|u3Rp)[a-z]*\b|\.u3-rp\b|\.u3-rp[-_]/.test(where)) return 'UI-40';
  if (/\.u3-dgc\b|\.u3-dgc[-_]/.test(where)) return 'UI-48';
  if (/\.u3-(col|fpanel|ctile|fhost|frow)\b|\.u3-(col|fpanel|ctile|frow)[-_]|#u3FiltersT\b/.test(where)) return 'UI-07';   // the v3 Collection (the v2 ids #colSearch and #colFilters are also on Achievements and Bosses: only the u3 classes count)
  if (/\.u3-logo\b|\.ldr3-emblem\b/.test(where)) return 'UI-23';   // the logo lockups (UI-23): the top bar logo (its path can stop above #topbar) and the loader tile
  // The pack reveal stage covers the screen under it: a defect in the stage belongs to the reveal screen.
  // A path keeps 3 levels, so the stage parts are named too (the pack, the cards, the bar, the effects).
  if (/#stage[a-z]*\b|\.u3-reveal|\.u3-pack|.u3-mpack|.u3-mhint|.u3-mrow|.u3-mwait|.u3-newmark|.reveal-grid|\.fc\b|\.pf\b|\.pf-face|\.react\b|\.u3-reacts|\.tap-prompt|\.sunrays|\.rare-banner|\.spark\b|\.mr-/.test(where)) return SCREENS[screen].id;
  if (/#u3ShopDlg|\.u3-sdlg|\.u3-sbal|\.u3-scvt|\.u3-scrim|\.u3-dialog|\.u3-step|\.u3-msg/.test(where) && SCREENS[screen].id === 'UI-44') return 'UI-44';   // the Convert window (it is the Shop confirm plus the quantity row)
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
    else if (st[0] === 'type') {   // the text goes into a field with an input event (no focus: the v2 m-kb class would hide the dock; the keyboard variant focuses it later); then the suggest request and its answer
      try {
        await pg.waitForSelector(st[1], { state: 'attached', timeout: 8000 });
        await pg.evaluate(([sel, text]) => { const e = [...document.querySelectorAll(sel)].find((x) => x.getClientRects().length); const set = Object.getOwnPropertyDescriptor(e instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set;   /* an input or a textarea (the Report box, UI-40) */ set.call(e, text); e.dispatchEvent(new Event('input', { bubbles: true })); }, [st[1], st[2]]);
        await sleep(0.8);
      } catch { miss.push(st[1]); }
      await settle(pg);
    }
    else if (st[0] === 'tfx') {
      // UI-26: hold the trade animation at one phase. ['tfx', <accept selector>, <ms after the layer opened>, <'gone' to wait for the layer to leave>].
      // The page clock (run.mjs installs it for these cells) stops, the click starts the animation, and runFor moves its timers to the
      // wanted moment; CSS transitions then finish in real time and the phase stays (a stopped clock gives the same frame on every run).
      await pg.clock.pauseAt(new Date(await pg.evaluate('Date.now()') + 50));
      if (!(await pg.evaluate((s) => { const e = [...document.querySelectorAll(s)].find((x) => x.getClientRects().length); if (!e) return false; e.click(); return true; }, st[1]))) { miss.push(st[1]); await pg.clock.resume(); continue; }
      try { await pg.waitForSelector('#u3Tfx', { state: 'attached', timeout: 10000 }); } catch { miss.push('#u3Tfx'); await pg.clock.resume(); continue; }
      await pg.clock.runFor(st[2]);
      if (st[3] === 'gone') { await pg.waitForSelector('#u3Tfx', { state: 'detached', timeout: 10000 }).catch(() => miss.push('#u3Tfx stays')); await pg.clock.resume(); await settle(pg); }
      else await sleep(1.5);   // the CSS transitions of the phase finish in real time
    }
    else if (st[0] === 'js') {
      if (st[2] && !(await pg.evaluate((s) => [...document.querySelectorAll(s)].some((x) => x.getClientRects().length), st[1]))) {
        miss.push(`${st[1]} (fallback used)`); miss.push(...(await runSteps(pg, st[2]))); continue;
      }
      if (!(await jsclick(pg, st[1]))) miss.push(st[1]);
    }
  }
  return miss;
}
