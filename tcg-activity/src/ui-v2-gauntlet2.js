// The combat v2 fight view (UI-52 review-5, approved 2026-10-23; the UI-67 parts, approved 2026-10-19). Testers only: the server decides
// (R1b combat_v2_on, R1c not_tester). The view is the built v1 fight (ui-v2-dungeon.js, the same .dg-* layout and CSS) with the v2 parts:
// the turn-order strip (D-203), the status badges, the role badges, the charge pips, the active pill on the acting card (D-204 option A),
// supports with HP (D-207), the status tap line and the ally pick (D-70). CSS: public/ui3/90-ui-52-v2.css.
// Every number on the screen is a server value (C3): the client only formats them. The one compare is charge >= need (both server values)
// for the gold border and "Ready". The mode is a parameter (the API base), so the Dungeon and Hunt v2 test modes can reuse the view.
// The top half of this file is pure (the mappers: answer -> view model, tested in ui-v2-gauntlet2.test.js). The bottom half draws and wires
// the view with the helpers of its host (ui-v2-dungeon.js passes them), so this file imports no DOM module.
import { icon as ui3Icon } from './ui3/icons.js';
import { TOKENS } from './tokens.js';
import { fmtFull, fmtCompact } from './ui3/number.js';

// ---- The static tables (UI-67): status key -> Lucide icon, the family colors, role key -> Lucide icon ----
export const STATUS_ICON = {
  poison: 'flask-conical', burn: 'flame-kindling', stunned: 'orbit', frozen: 'cuboid', sleep: 'bed', paralyzed: 'activity', blinded: 'eye-off',
  confused: 'shuffle', slowed: 'snail', chill: 'thermometer-snowflake', exposed: 'heart-crack', weakened: 'arrow-big-down-dash', mark: 'target',
  shielded: 'shield', empowered: 'arrow-big-up-dash', focused: 'focus', quickened: 'rabbit', enraged: 'chevrons-up', guarded: 'shield-plus',
};
// The enemy-only boons are drawn filled (UI-67 01: Enraged, Guarded).
export const FILLED = new Set(['enraged', 'guarded']);
export const ROLE_ICON = {
  breaker: 'drill', striker: 'sword', flurry: 'repeat-2', finisher: 'axe', survivor: 'heart-pulse', cleaver: 'slice',
  warden: 'brick-wall', medic: 'cross', controller: 'anchor', spotter: 'binoculars', herald: 'megaphone', artillery: 'rocket',
};
// The tap line (UI-52 review-5 frame 11, approved Q7): one short line for each status, filled with the server amounts by leaf name.
// {leaf%} formats a share as a percent; {leaf} prints the number. A status with no line here shows its server rule.
export const TAP_LINE = {
  poison: 'Ticks {tick%} of HP at step end.', burn: 'Ticks {tick_x}x the Poison tick at step end.', stunned: 'Skips its next action.',
  frozen: 'Skips its next action.', sleep: 'Skips actions until it takes damage.', paralyzed: 'Each action can fail ({fail%}).',
  blinded: '+{miss%} miss chance.', confused: '{chance%} of its attacks hit a wrong target.', slowed: 'Speed x{x}.', quickened: 'Speed x{x}.',
  chill: '-{dmg%} damage and speed.', exposed: 'Takes +{value%} damage.', weakened: 'Deals -{value%} damage.',
  mark: 'The next attack on it deals more and cannot miss.', shielded: 'Absorbs {value} damage before HP.', empowered: 'The next attack deals +{value%}.',
  focused: '+{value%} crit chance.', enraged: 'Deals x{x} damage.', guarded: 'Absorbs {value} damage before HP.',
};
export const STRIP_N = 10;   // D-203: the strip shows the next 10 turns (the server sends at most 10)
export const FOE_PLACES = 3; // UI-52 review-5 parts: a foe shows 3 status places, then "+N"
export const SLOT_FILL = 1.25; // UI-52 review-5 frames 01-04 (Nathan 2026-11-03 "match the approved designs"): a phone monster is 1.25 x its plate slot high (r5-capture.mjs: h = plate width x 1.25)
export const CARD_PLACES = 3;// a card plate: the Shielded place and 2 more, then "+N"

const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);
const unitKey = (side, id) => `${side === 'enemy' ? 'enemy' : 'card'}:${id}`;
// A number for the screen: whole numbers, no decimals (the engine HP can have decimals, R1b 3.2 item 4).
export const fmtN = (n) => Math.round(num(n)).toLocaleString('en-US');
/** The power on the card chip: the full form, the compact form from 10,000 ("123.5M": a 9-digit power fits the chip, G3 long variant). */
export const fmtPower = (n) => (Math.abs(num(n)) >= 10000 ? fmtCompact(n) : fmtFull(n));
const pctOf = (n) => `${Math.round(num(n) * 100)}%`;
const refStatus = (ref, key) => (ref?.statuses || []).find((s) => s.key === key) || null;
const refRole = (ref, key) => (ref?.roles || []).find((r) => r.key === key) || null;

// The fight of a v2 view or answer, and its parts.
export const fightOf = (v) => v?.run?.state?.fight || null;
export const stateOf = (v) => v?.run?.state || null;

/** The status badges of one unit, from status_lines (server): [{key, icon, family, negative, filled, stacks, left}] (ended statuses left out). */
export function badgesOf(v, side, id) {
  const lines = v?.status_lines?.[unitKey(side, id)] || [];
  return lines.filter((l) => l.left == null || l.left >= 0).map((l) => {
    const s = refStatus(v?.ref, l.key);
    return { key: l.key, label: s?.label || l.key, icon: STATUS_ICON[l.key] || 'circle', family: s?.family || 'control', negative: s ? !!s.negative : true,
      filled: FILLED.has(l.key), stacks: l.stacks ?? null, left: l.left ?? null };
  });
}
/** Places: at most n places; more statuses -> the first n-1 and "+N" (the count of the rest). */
export function placesOf(list, n) {
  if (list.length <= n) return { shown: list, more: 0 };
  return { shown: list.slice(0, n - 1), more: list.length - (n - 1) };
}

/** The turn-order strip: the first 10 entries of `order`, as the server gives them (D6: the clock picks the card). */
export function stripOf(v) {
  const cards = v?.cards || {};
  return (v?.order || []).slice(0, STRIP_N).map((o, i) => {
    const isCard = o.side === 'card';
    const f = isCard ? null : fightOf(v)?.enemies?.[o.id];
    return { side: isCard ? 'card' : 'enemy', id: o.id, next: i === 0, ready: isCard && o.ready === true, skip: !!o.skip, mayFail: !!o.may_fail,
      cls: isCard ? stateOf(v)?.info?.[o.id]?.class || 'attacker' : null,
      name: isCard ? cards[o.id]?.name || '' : f?.show?.name || '', image: isCard ? cards[o.id]?.image_url || '' : '', model: f?.show?.model || '' };
  });
}

/** The card that acts now: order[0] when it is a card (the server's turn), else the engine's ext.turn. */
export function actorOf(v) {
  const o = v?.order?.[0];
  if (o && o.side === 'card') return Number(o.id);
  const t = fightOf(v)?.ext?.turn;
  return t && t.side === 'card' ? Number(t.id) : null;
}

/** The squad (attackers and supports) of a v2 view, every number from the server. */
export function squadOf(v) {
  const st = stateOf(v); const F = fightOf(v) || {};
  const ids = (st?.squad || []).map(Number);
  const actor = actorOf(v);
  return ids.map((id) => {
    const u = F.cards?.[id] || F.cards?.[String(id)] || st?.carry?.[id] || {};
    const inf = st?.info?.[id] || {};
    const cls = inf.class || refRole(v?.ref, inf.role)?.class || u.class || 'attacker';
    const charge = num(u.charge), need = num(v?.need?.[id]);
    const c = v?.cards?.[id] || {};
    return { id, name: c.name || inf.name || '', image_url: c.image_url || '', rarity: c.rarity || 'normal', type: c.type || '',
      power: st?.units?.[id]?.power ?? null, role: inf.role || u.role || '', cls, activeName: inf.name || '', needsAlly: !!inf.needs_ally,
      hp: num(u.hp), max: num(u.max), down: !!u.down, shield: num(u.status?.shielded?.value), charge, need, ready: charge >= need,
      actor: id === actor, badges: badgesOf(v, 'card', id) };
  });
}

/** The foes of the fight. */
export function foesOf(v) {
  const F = fightOf(v) || {};
  const rt = stateOf(v)?.room_type;
  return (F.enemies || []).map((e, i) => ({ i, name: e.show?.name || '', model: e.show?.model || '', key: e.monster || e.show?.model || '', element: e.show?.element || '', level: e.show?.level ?? null,
    kind: e.show?.kind || '', boss: e.show?.kind === 'boss' || rt === 'guardian', elite: e.show?.kind === 'elite' || rt === 'elite',
    hp: e.down ? 0 : num(e.hp), max: num(e.max), down: !!e.down, charging: !!e.charging, guard: num(e.status?.guarded?.value), badges: badgesOf(v, 'enemy', i), passives: [] }));
}

/** The whole view model of a fight: the strip, the actor, the squad, the foes, Squad HP, the valid targets and allies. */
export function fightModel(v) {
  const squad = squadOf(v);
  return { strip: stripOf(v), actor: actorOf(v), squad, attackers: squad.filter((c) => c.cls !== 'support'), supports: squad.filter((c) => c.cls === 'support'),
    foes: foesOf(v), squadHp: { hp: num(v?.squad_hp?.hp), max: num(v?.squad_hp?.max) }, targets: (v?.targets || []).map(Number), allies: (v?.allies || []).map(Number),
    floor: v?.run?.floor, room: v?.run?.room, roomType: stateOf(v)?.room_type || '' };
}

/** The status tap line: "Chill 2: -16% damage and speed." The leaves come from the server rule; the numbers from status_lines amounts. */
export function tapLine(v, side, id, key) {
  const line = (v?.status_lines?.[unitKey(side, id)] || []).find((l) => l.key === key);
  const s = refStatus(v?.ref, key);
  if (!line || !s) return null;
  const leaves = [...String(s.rule || '').matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  const amounts = line.amounts || [];
  const val = {};
  leaves.forEach((k, i) => { if (!(k in val)) val[k] = amounts[i]; });
  if (amounts.length > leaves.length) val.value = amounts[amounts.length - 1];   // a status with a value: the unit's value comes last (R1b 3.2 item 3)
  const fill = (t) => t.replace(/\{(\w+)(%?)\}/g, (_, k, p) => (val[k] == null ? '' : p ? pctOf(val[k]) : String(val[k])));
  const text = fill(TAP_LINE[key] || s.rule || '');
  const label = `${s.label}${line.stacks >= 2 ? ` ${line.stacks}` : ''}`;
  return { key, label, text, left: line.left ?? null, line: `${label}: ${text}` };
}

const moveLabel = (k) => String(k || '').replace(/_/g, ' ').replace(/^\w/, (x) => x.toUpperCase());
/** The room log lines of a write answer's log (R1b 3.2 item 10): newest last. who / to / txt / kind. */
export function logLines(v, log) {
  const F = fightOf(v) || {}; const cards = v?.cards || {};
  const nm = (side, id) => (side === 'enemy' ? F.enemies?.[id]?.show?.name || 'Foe' : cards[id]?.name || 'Card');
  const out = [];
  for (const e of log || []) {
    if (e.k === 'act' && e.actor?.side === 'card') {
      const who = nm('card', e.actor.id);
      for (const h of e.hits || []) out.push({ kind: 'me', who, to: nm(h.target?.side, h.target?.id), txt: h.miss ? 'miss' : `-${fmtN(h.dmg)}` });
      if (!(e.hits || []).length && e.ally) out.push({ kind: 'sup', who, to: nm('card', e.ally.id), txt: '' });
      for (const x of e.hp || []) if (x.down) out.push({ kind: 'kill', who: nm(x.side, x.id), to: 'down', txt: '' });
    } else if (e.k === 'act' && e.actor?.side === 'enemy') {
      const who = `${nm('enemy', e.actor.id)} · ${moveLabel(e.move)}`;
      const hit = (e.hp || []).filter((x) => x.side !== 'enemy');
      if (!hit.length) out.push({ kind: 'foe', who, to: '', txt: '' });   // N4: a miss shows the move with no target
      for (const x of hit) out.push({ kind: 'foe', who, to: nm(x.side, x.id), txt: x.after < x.before ? `-${fmtN(x.before - x.after)}` : '' });
      for (const x of e.hp || []) if (x.down) out.push({ kind: 'kill', who: nm(x.side, x.id), to: 'down', txt: '' });
    } else if (e.k === 'clock') {
      for (const t of e.ticks || []) out.push({ kind: 'foe', who: refStatus(v?.ref, t.status)?.label || moveLabel(t.status), to: nm(t.side, t.id), txt: `-${fmtN(t.dmg)}` });
      for (const x of e.hp || []) {
        if (x.before === x.after && num(x.shield_after) === 0 && num(x.shield_before) > 0) out.push({ kind: 'sup', who: nm(x.side, x.id), to: 'Shield ends', txt: '' });
        if (x.down) out.push({ kind: 'kill', who: nm(x.side, x.id), to: 'down', txt: '' });
      }
    }
  }
  return out;
}

/** Merge a write answer (act, auto, finish, choose) into the view: the run state and the screen fields of R1b 3.4. */
export function mergeAnswer(v, r) {
  if (!v || !r?.ok) return v;
  const run = { ...(v.run || {}) };
  if (r.state) run.state = r.state;
  if (r.status) run.status = r.status;
  if (r.floor != null) run.floor = r.floor;
  if (r.room != null) run.room = r.room;
  if (r.ended_by !== undefined) run.ended_by = r.ended_by;
  const out = { ...v, run };
  for (const k of ['need', 'squad_hp', 'order', 'targets', 'allies', 'status_lines', 'rooms', 'floors']) if (r[k] !== undefined) out[k] = r[k];
  if (r.cards) out.cards = { ...(v.cards || {}), ...r.cards };
  return out;
}

/** The v1-shaped run of a v2 view for the reused v1 screens (Q-E1: reward, rest, door, floor done, over): no loot (0 at risk, 0 banked). */
export function v1RunOf(v) {
  const R = v?.run;
  if (!R) return null;
  const st = R.state || {};
  return { id: R.id, status: R.status, ended_by: R.ended_by ?? null, floor: R.floor, room: R.room, turns: R.turns ?? 0, rank: null, shards: 0,
    squad: (st.squad || []).map(Number), state: { phase: st.phase, room_type: st.room_type, offers: st.offers || [], pend: { shards: 0, cards: [] }, bank: { shards: 0, cards: [] } } };
}
/** Does this v2 answer take the screen? A tester's v2 run of today (active or just over); else the v1 screens stay (INV-E1). */
export const v2Owns = (v) => !!(v?.ok && v.run && (v.active_mode === 'gauntlet_v2' || v.run.status === 'over'));
/** The Dungeon test mode (R2b; dungeon_v2_view): the tester's active v2 run takes the screen; a v2 run that is over takes it only when the
 *  v1 view (v1) has no active run (QD2: the v2 run is an extra run, so a v1 run of the same day keeps its screens). */
export const v2OwnsDungeon = (v, v1) => !!(v?.ok && v.run && (v.run.status === 'active' || (v.run.status === 'over' && v1?.run?.status !== 'active')));
/** The Dungeon test mode (R2b): the tester-only "Play v2 (test)" in the lobby. can_start is the server's (tester, no active v2 run, a run left). */
export const v2CanStart = (v) => !!(v?.ok && v.tester === true && v.can_start === true);

// ---- The view (DOM) -----------------------------------------------------------------------------------------------------------------
const ic = (name, size = 'sm') => ui3Icon(name, { size, cls: 'g2-ico' });
const FAMILY = { dot: 'dot', control: 'control', accuracy: 'accuracy', tempo: 'tempo', vuln: 'vuln', boon: 'boon' };
/** One status badge (UI-67 01): harm = rounded square, boon = circle, the family color; a stack plate from 2. */
export function badgeHTML(b, { md = false, unit = '' } = {}) {
  const cls = `g2-b f-${FAMILY[b.family] || 'control'}${b.negative ? '' : ' is-boon'}${b.filled ? ' is-filled' : ''}${md ? ' is-md' : ''}`;
  return `<span class="${cls}" data-st="${b.key}"${unit ? ` data-unit="${unit}"` : ''} title="${b.label}">${ic(b.icon, md ? 'md' : 'sm')}${b.stacks >= 2 ? `<span class="g2-n">${b.stacks}</span>` : ''}</span>`;
}
const moreHTML = (n, md) => (n > 0 ? `<span class="g2-b is-more${md ? ' is-md' : ''}">+${n}</span>` : '');
const pipsHTML = (c) => (c.need > 0 ? `<span class="g2-pips${c.ready ? ' is-ready' : ''}">${Array.from({ length: c.need }, (_, i) => `<i class="${i < c.charge ? 'is-on' : ''}"></i>`).join('')}</span>` : '<span class="g2-pips"></span>');
const roleHTML = (c, sm) => (c.role ? `<span class="g2-role ${c.cls === 'support' ? 'is-sup' : 'is-att'}${sm ? ' is-sm' : ''}" title="${c.role}">${ic(ROLE_ICON[c.role] || 'circle', sm ? 'xs' : 'md')}</span>` : '');
// The Shielded place stays when there is no shield (nothing moves when a status changes, INV-E3).
const shieldPlace = (c) => { const b = c.badges.find((x) => x.key === 'shielded'); return b ? badgeHTML(b, { unit: `card:${c.id}` }) : '<span class="g2-b is-empty"></span>'; };
export function cardStatusHTML(c) {
  const rest = c.badges.filter((x) => x.key !== 'shielded');
  const p = placesOf(rest, CARD_PLACES - 1);
  return shieldPlace(c) + p.shown.map((b) => badgeHTML(b, { unit: `card:${c.id}` })).join('') + moreHTML(p.more);
}
function foeStatusHTML(f, md) {
  const p = placesOf(f.badges, FOE_PLACES);
  return p.shown.map((b) => badgeHTML(b, { md, unit: `enemy:${f.i}` })).join('') + moreHTML(p.more, md);
}
function stripHTML(m, H) {
  return m.strip.map((s) => {
    const pk = s.model ? portraitKey(s.model, fightFoe(m, s.id)?.element) : '';
    const pic = pk ? portraitNow(pk) : '';
    const art = s.side === 'card' ? (s.image ? `<img src="${H.thumb(s.image)}" alt="">` : '')
      : `<span class="g2-foeface">${H.elIcon(fightFoe(m, s.id)?.element) || ''}</span><img class="g2-port${pic ? ' is-on' : ''}" alt="" data-model="${H.esc(pk)}"${pic ? ` src="${pic}"` : ''}>`;
    return `<span class="g2-chip ${s.side === 'card' ? (s.cls === 'support' ? 'is-sup' : 'is-att') : 'is-foe'}${s.next ? ' is-next' : ''}${s.skip ? ' is-skip' : ''}" title="${H.esc(s.name)}"><span class="g2-a">${art}</span>${s.side === 'enemy' ? '<span class="g2-bar"></span>' : ''}${s.ready ? '<span class="g2-rp"></span>' : ''}</span>`;
  }).join('');
}
const fightFoe = (m, i) => m.foes[i];

/** The fight HTML: the v1 skeleton (.dg-fight and its areas: the same CSS) with the v2 parts. */
export function fightHTML(v, H) {
  const m = fightModel(v);
  const esc = H.esc;
  const plate = (f) => `<div class="dg-plate g2-plate${f.boss ? ' boss' : f.elite ? ' elite' : ''}" data-foe="${f.i}">
      <span class="n">${f.element && H.elIcon(f.element) ? `<span class="el" title="${esc(f.element)}">${H.elIcon(f.element)}</span>` : ''}<b>${H.plateName({ name: f.name, element: f.element })}</b>${f.level != null ? `<small>LV ${esc(f.level)}</small>` : ''}<em class="hpn"></em></span>
      <span class="bar"><i></i></span>
      <span class="g2-fst"></span></div>`;
  const unit = (c) => `<div class="dg-unit g2-unit" data-card="${c.id}">${roleHTML(c)}
      ${H.cardTile({ id: c.id, name: c.name, image_url: c.image_url, rarity: c.rarity }, { top: `<span class="dg-pw">${H.bolt}${c.power != null ? esc(fmtPower(c.power)) : ''}</span>`, over: '<span class="dg-state"></span><span class="g2-pillbox"></span>' })}
      <span class="dg-fx g2-st"></span>
      <span class="g2-hprow"><span class="dg-hp"><i></i></span><span class="g2-pipbox"></span></span><small class="dg-hpn"></small></div>`;
  const sup = (c) => `<button class="dg-sup g2-sup" data-sup="${c.id}" type="button">
      ${c.image_url ? `<img src="${H.thumb(c.image_url)}" alt="">` : '<span></span>'}
      <span class="t"><b>${roleHTML(c, true)}${esc(c.name)}</b><small>${esc(c.activeName)}</small></span>
      <span class="g2-suprole">${roleHTML(c)}</span><span class="card-info g2-mag" data-info="${c.id}" aria-label="Details">${ic('search')}</span>
      <span class="g2-stline"><em></em><span class="g2-shp"><span class="g2-shpl"></span><span class="dg-hp"><i></i></span><small></small></span></span></button>`;
  return `<div class="dg-fight g2" data-room="${esc(`${m.floor}-${m.room}`)}">
    <div class="dg-ftop">${H.progressHTML()}${statsHTML(H)}</div>
    <div class="dg-meter g2-meter"><div class="g2-strip">${stripHTML(m, H)}</div></div>
    <div class="dg-arena">
      <div class="dg-plates">${m.foes.map(plate).join('')}</div>
      <canvas class="dg-canvas"></canvas>
      <div class="dg-reticle"><i></i></div>
      <div class="dg-pops"></div>
    </div>
    <div class="dg-ctl">${H.musicBtnHTML()}<div class="dg-hint"></div>${H.finishHTML()}<button class="dg-auto${H.dg.auto ? ' on' : ''}" aria-pressed="${!!H.dg.auto}" title="Auto: the squad fights by itself. It stops at every choice."><i></i>Auto</button></div>
    <div class="dg-units">${m.attackers.map(unit).join('')}</div>
    <aside class="dg-right"><section class="dg-panel dg-shp"><span class="k">Squad HP</span><b class="v"></b><span class="dg-hp big"><i></i></span></section>
      <section class="dg-panel dg-sups"><span class="k">Support</span>${m.supports.map(sup).join('') || '<p class="dg-none">No support cards in this squad.</p>'}</section></aside>
    <aside class="dg-left-col"><span class="k">Room log</span><ol class="dg-log"></ol></aside>
    <div class="dg-shade"></div>
  </div>`;
}
// N2: the week best is the v1 value (v2 runs are off the board, D1). N3: the "+n% damage" place stays, empty (nothing moves).
function statsHTML(H) {
  const b = H.dg.data?.best;
  return `<div class="dg-stats"><span title="Your best run this week">${H.trophy}<b>${b ? `${b.floor}F R${b.room}` : '—'}</b><i>week best</i></span><span class="g2-empty" aria-hidden="true">${H.up}<b>+0%</b><i>damage</i></span></div>`;
}

/** Change the parts in place from the view (the server's, or a replay step). s = the UI state: target, picking, tap, busy, notice, log. */
export function fightUpdate(F, v, s, H) {
  if (!F) return;
  const m = fightModel(v);
  const esc = H.esc;
  if (!m.targets.includes(s.target)) s.target = m.targets[0] ?? -1;
  for (const f of m.foes) {
    const p = F.querySelector(`.dg-plate[data-foe="${f.i}"]`); if (!p) continue;
    p.classList.toggle('on', f.i === s.target && !f.down && !s.picking);
    p.classList.toggle('dead', f.down);
    p.querySelector('.hpn').textContent = `${H.fmt(f.hp)} / ${H.fmt(f.max)}`;
    p.querySelector('.bar i').style.width = `${f.max ? Math.max(0, (f.hp / f.max) * 100) : 0}%`;
    const md = F.classList.contains('g2-wide');
    p.querySelector('.g2-fst').innerHTML = foeStatusHTML(f, md);
  }
  H.dg.stage?.setTarget?.(s.target >= 0 && !s.picking ? s.target : -1);
  const allies = new Set(m.allies);
  for (const c of m.squad) {
    const u = F.querySelector(`.dg-unit[data-card="${c.id}"]`) || F.querySelector(`.dg-sup[data-sup="${c.id}"]`);
    if (!u) continue;
    const pct = c.max ? Math.max(0, Math.min(100, (c.hp / c.max) * 100)) : 0;
    u.classList.toggle('down', c.down);
    u.classList.toggle('g2-actor', c.actor && !s.picking && !s.finishing);
    u.classList.toggle('g2-wait', !c.actor && !c.down && !s.picking && !s.finishing);
    u.classList.toggle('g2-lit', !!s.picking && allies.has(c.id));
    u.classList.toggle('g2-unlit', !!s.picking && !allies.has(c.id));
    const shield = c.shield > 0 ? ` <em>+${H.fmt(c.shield)}</em>` : '';
    const shieldS = c.shield > 0 ? ` <span class="g2-shn">+${H.fmt(c.shield)}</span>` : '';
    if (u.classList.contains('dg-unit')) {
      u.querySelector('.dg-hp i').style.width = `${pct}%`;
      u.querySelector('.dg-hpn').innerHTML = `${H.fmt(c.hp)}/${H.fmt(c.max)}${shield}`;
      u.querySelector('.dg-state').textContent = c.down ? 'Down' : '';
      u.querySelector('.g2-st').innerHTML = c.down ? '<span class="g2-b is-empty"></span>' : cardStatusHTML(c);
      u.querySelector('.g2-pipbox').innerHTML = c.down ? '' : pipsHTML(c);
      // D-204 option A: the active is a pill on the acting card; tap the pill = the active, tap the card = the basic attack.
      const pill = u.querySelector('.g2-pillbox');
      pill.innerHTML = c.actor && !c.down && !s.picking && !s.finishing
        ? (c.ready ? `<button type="button" class="g2-pill" data-active="${c.id}"><b>${esc(c.activeName)}</b>${pipsHTML(c)}</button>`
          : `<span class="g2-pill is-wait"><b>${esc(c.activeName)}</b>${pipsHTML(c)}<span>${H.fmt(c.charge)} of ${H.fmt(c.need)}</span></span>`) : '';
    } else {
      u.querySelector('.g2-stline em').innerHTML = c.down ? 'Down' : c.ready ? `${ic('check')}Ready` : `<span class="g2-waitc">${pipsHTML(c)}${H.fmt(c.charge)} of ${H.fmt(c.need)}</span>`;
      u.querySelector('.g2-shpl').innerHTML = shieldPlace(c);
      u.querySelector('.g2-shp .dg-hp i').style.width = `${pct}%`;
      u.querySelector('.g2-shp small').innerHTML = `${H.fmt(c.hp)}/${H.fmt(c.max)}${shieldS}`;
      u.disabled = !!s.busy && !s.picking;
    }
  }
  F.querySelector('.dg-shp .v').innerHTML = `${H.fmt(m.squadHp.hp)}<small> / ${H.fmt(m.squadHp.max)}</small>`;
  F.querySelector('.dg-shp .dg-hp i').style.width = `${m.squadHp.max ? (m.squadHp.hp / m.squadHp.max) * 100 : 0}%`;
  F.querySelector('.g2-strip').innerHTML = stripHTML(m, H);
  F.querySelector('.dg-log').innerHTML = s.log.slice(-6).reverse().map((l) => `<li class="${l.kind}"><b>${esc(l.who)}</b>${l.to ? `<span>→ ${esc(l.to)}</span>` : ''}<em>${esc(l.txt)}</em></li>`).join('') || '<li class="none">The fight starts. Tap a card.</li>';
  const actor = m.squad.find((c) => c.actor);
  const hint = F.querySelector('.dg-hint');
  hint.classList.toggle('g2-pickbar', !!s.picking);
  // wide classes: the pick prompt goes over the bottom of the stage (frame 14), and back to its row after
  const home = F.querySelector('.g2-l'), arena = F.querySelector('.dg-arena');
  if (home && arena) { if (s.picking && hint.parentNode !== arena) arena.appendChild(hint); else if (!s.picking && hint.parentNode !== home) home.appendChild(hint); }
  hint.classList.toggle('g2-tapbar', !!s.tap);
  if (s.picking) hint.innerHTML = `${H.hand}Choose a card for <b>${esc(actor?.name || '')}</b><button class="dg-cancel" type="button">Cancel</button>`;
  else if (s.notice) hint.innerHTML = `${H.timer}${esc(s.notice)}`;
  else if (s.tap) hint.innerHTML = `<span class="g2-tap">${badgeHTML(s.tap.badge)}<span><b>${esc(s.tap.label)}:</b> ${esc(s.tap.text)}</span></span>`;
  else if (s.busy) hint.innerHTML = `${H.timer}The monsters are acting…`;
  else hint.innerHTML = `${H.hand}${m.targets.length > 1 ? 'Tap a monster to target it · tap a card to attack' : 'Tap a card to attack'}`;
  // the steps left (server left) are in the tooltip: frame 11 draws one line, and the hint keeps one fixed height (nothing moves)
  const tl = hint.querySelector('.g2-tap'); if (tl && s.tap) tl.title = s.tap.left != null ? `${s.tap.line} ${H.fmt(s.tap.left)} steps left.` : s.tap.line;
  if (s.tap) F.querySelector(`.g2-b[data-unit="${s.tap.unit}"][data-st="${s.tap.key}"]`)?.classList.add('is-tapped');
  F.classList.toggle('picking', !!s.picking);
  F.classList.toggle('busy', !!s.busy);
  const fbs = H.finishButton({ busy: s.busy, finishing: s.finishing, picking: !!s.picking, unavailable: false });
  const fb = F.querySelector('.dg-finish');
  if (fb) { fb.hidden = fbs.hidden; fb.disabled = fbs.disabled; fb.classList.toggle('is-skip', fbs.skip); fb.setAttribute('aria-label', fbs.label); fb.title = fbs.label; }
  const ab = F.querySelector('.dg-auto'); if (ab) ab.disabled = H.autoDisabled(s.finishing);
  placeFoeStatus(F);
}
// The foe status rows sit under the plates (phones) or under each plate on the wide classes (24 px badges, UI-52 review-5 frames 06-08).
function placeFoeStatus(F) { F.classList.toggle('g2-wide', ['medium', 'expanded'].includes(document.body.dataset.size || '')); }

// ---- The controller: taps, the ally pick, the status tap line, act / auto / finish, the replay of a write answer's log ----
const fresh = (key = '') => ({ key, target: -1, picking: false, tap: null, busy: false, finishing: false, skip: false, notice: '', log: [] });
let S = fresh();
let V = null;     // the v2 view (the host keeps it too: H.setView)
let H = null;     // the host helpers (ui-v2-dungeon.js)
let autoT = null;
let wideRO = null;
const clone = (o) => JSON.parse(JSON.stringify(o));
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const nap = (ms) => sleep(H.waitMs(ms, { finishing: S.finishing, skip: S.skip }));
const fightEl = () => document.querySelector('.dg-fight.g2');
const upd = (v = V) => fightUpdate(fightEl(), v, S, H);
const roomKeyOf = (v) => `${v?.run?.floor}-${v?.run?.room}`;
const alive = () => !!fightEl() && H.currentView() === 'dungeon';

/** Change the open fight in place (a repaint of the same room). */
export function updateFight(main, v, host) { V = v; H = host; upd(); place(main); }
/** Reset the controller (the host left the fight or the view). */
export function disposeFight() { clearTimeout(autoT); wideRO?.disconnect(); wideRO = null; S = fresh(); }

/** Wire a freshly painted fight (fightHTML). keep = the 3D canvas of the same room (no reload of the models). */
export async function wireFight(main, v, host, keep) {
  V = v; H = host;
  const F = main.querySelector('.dg-fight.g2');
  if (!F) return;
  const key = roomKeyOf(v);
  if (S.key !== key) S = fresh(key);
  upd();
  // the controls work at once: the listeners come before the 3D stage loads (round 4: under load a Finish Room tap came before them and was lost)
  F.querySelector('.dg-auto')?.addEventListener('click', (e) => { e.stopPropagation(); H.setAuto(!H.dg.auto); e.currentTarget.classList.toggle('on', H.dg.auto); e.currentTarget.setAttribute('aria-pressed', String(!!H.dg.auto)); H.sfx('click'); autoNext(true); });
  F.querySelector('.dg-finish')?.addEventListener('click', (e) => { e.stopPropagation(); finishRoom(); });
  F.addEventListener('click', onTap);
  const canvas = F.querySelector('.dg-canvas');
  if (keep) canvas.replaceWith(keep);
  else {
    H.dg.stage?.dispose(); H.dg.stage = null;
    try {
      const { mountStage } = await import('./dungeon-stage.js');
      if (!main.contains(canvas)) return;
      H.dg.stage = mountStage(canvas, { onPick: (i) => target(i), onLayout: () => place(main), slotFill: () => (document.body.dataset.size === 'compact-port' ? SLOT_FILL : 0), slotTop: () => slotTop(canvas) });
      H.dg.stage.canvas = canvas; H.dg.roomKey = key;
      portraits(foesOf(V));   // the strip portraits: the same models (not awaited)
      await H.dg.stage.setFoes(foesOf(V));
      if (alive()) upd();
    } catch (e) { console.warn('v2 stage', e); }
  }
  // the stage loads in the background: when another fight (or another screen) opened meanwhile, this old call stops here and does not
  // take the resize observer or the layout of the new fight (round 5, L-4)
  if (fightEl() !== F) return;
  H.fitFight(F);
  layout(F);
  wideRO?.disconnect(); wideRO = null;
  if (typeof ResizeObserver === 'function') { wideRO = new ResizeObserver(() => layout(F)); wideRO.observe(F); }
  requestAnimationFrame(() => place(main));
  autoNext();
}

function onTap(e) {
  const t = e.target;
  const m = fightModel(V);
  const badge = t.closest('.g2-b[data-st][data-unit]');
  if (badge && !S.picking && !S.busy) {   // S4: the tap line in the hint place
    const [side, id] = badge.dataset.unit.split(':');
    const tl = tapLine(V, side, Number(id), badge.dataset.st);
    const b = badgesOf(V, side, Number(id)).find((x) => x.key === badge.dataset.st);
    S.tap = tl && b && !(S.tap && S.tap.key === tl.key && S.tap.unit === badge.dataset.unit) ? { ...tl, badge: b, unit: badge.dataset.unit } : null;
    upd(); return;
  }
  if (S.tap) { S.tap = null; upd(); }
  if (t.closest('.dg-cancel')) { S.picking = false; upd(); place(); return; }
  if (S.picking) {   // S5 (D-70): a lit card (allies, the server's list) takes the active; any other tap cancels
    const u = t.closest('.dg-unit, .dg-sup');
    const id = u ? Number(u.dataset.card || u.dataset.sup) : NaN;
    S.picking = false;
    if (u && m.allies.includes(id)) { act({ use: 'active', target: S.target, ally: id }); return; }
    upd(); place(); return;
  }
  const info = t.closest('.card-info');
  if (info) { const id = Number(info.dataset.info) || Number(info.closest('.dg-card')?.dataset.id); if (id) H.openInfo(id); return; }
  const p = t.closest('[data-foe]'); if (p) { target(Number(p.dataset.foe)); return; }
  if (t.closest('[data-active]')) { useActive(); return; }
  const u = t.closest('.dg-unit, .dg-sup');
  if (!u) return;
  const id = Number(u.dataset.card || u.dataset.sup);
  const c = m.squad.find((x) => x.id === id);
  if (!c || !c.actor || c.down) return;   // only the card whose turn it is acts (D6: the clock picks the card)
  if (c.cls === 'support' && c.ready) { useActive(); return; }   // a support: its tile is its active when charged
  act({ use: 'basic', target: S.target });
}
function target(i) {
  const m = fightModel(V);
  if (S.picking || !m.targets.includes(i) || i === S.target) return;
  S.target = i; H.sfx('click'); upd(); place();
}
function useActive() {
  const c = fightModel(V).squad.find((x) => x.actor);
  if (!c || S.busy || !c.ready) return;
  if (c.needsAlly) { S.picking = true; H.sfx('click'); upd(); place(); return; }
  act({ use: 'active', target: S.target });
}
/** The body of POST /v2/act (R1c 3.1 item 3): only use, target and ally. */
export const choiceOf = (b) => { const o = { use: b.use }; if (b.target != null && b.target >= 0) o.target = b.target; if (b.ally != null) o.ally = b.ally; return o; };

async function post(path, body) {
  let r = null;
  try { r = await H.apiPost(`${H.base}/${path}`, body); } catch (e) { r = e?.body || null; }
  return r;
}
async function act(body) {
  if (S.busy) return false;
  S.busy = true; upd();
  const actor = fightEl()?.querySelector('.g2-actor');
  actor?.classList.add('striking');
  if (!H.dg.auto) H.sfx('click');
  const r = await post('act', choiceOf(body));
  actor?.classList.remove('striking');
  if (!r?.ok) { S.busy = false; upd(); H.toast(r?.message || 'That did not work.'); return false; }
  await play(r);
  return settle(r);
}
// One step of a replay: the HP of the units the entry changed (R1b 3.2 item 10: hp = [{side, id, before, after, down, shield_before, shield_after}]).
export function applyHp(step, hp) {
  const F = fightOf(step); if (!F) return;
  for (const x of hp || []) {
    const u = x.side === 'enemy' ? F.enemies?.[x.id] : F.cards?.[x.id] || F.cards?.[String(x.id)];
    if (!u) continue;
    u.hp = x.after; u.down = !!x.down;
    const sk = x.side === 'enemy' ? 'guarded' : 'shielded';
    u.status = u.status || {};
    if (Number(x.shield_after) > 0) u.status[sk] = { ...(u.status[sk] || {}), value: x.shield_after }; else delete u.status[sk];
  }
}
function pop(i, txt, cls = '', dy = 0) {
  const box = document.querySelector('.dg-fight.g2 .dg-pops'); const l = H.dg.stage?.labels()[i]; const canvas = document.querySelector('.dg-fight.g2 .dg-canvas');
  if (!box || !l) return;
  const n = document.createElement('span');
  n.className = `dg-pop ${cls}`; n.textContent = txt; n.style.left = `${l.x}px`; n.style.top = `${(canvas?.offsetTop || 0) + l.y + 40 + dy}px`;
  box.appendChild(n); setTimeout(() => n.remove(), 1500);
}
function popCard(id, txt, cls = '') {
  const u = document.querySelector(`.dg-fight.g2 .dg-unit[data-card="${id}"], .dg-fight.g2 .dg-sup[data-sup="${id}"]`);
  if (!u) return;
  const n = document.createElement('span');
  n.className = `dg-pop on-card ${cls}`; n.textContent = txt;
  u.appendChild(n); setTimeout(() => n.remove(), 1500);
}
/** Replay the log of a write answer on the stage, then take the server's state. */
async function play(r) {
  const step = clone(V);
  for (const e of r.log || []) {
    if (S.skip || !alive()) break;
    if (S.finishing && e.clock != null) S.notice = `Finishing the room · Round ${e.clock}`;
    const lines = logLines(step, [e]);
    if (e.k === 'act' && e.actor?.side === 'card') {
      for (const h of e.hits || []) {
        if (h.target?.side !== 'enemy') continue;
        const down = (e.hp || []).some((x) => x.side === 'enemy' && x.id === h.target.id && x.down);
        H.dg.stage?.play(h.target.id, down ? 'death' : 'hit');
        pop(h.target.id, h.miss ? 'MISS' : `-${fmtN(h.dmg)}`, h.miss ? 'miss' : h.crit ? 'crit' : '');
      }
      if (!(e.hits || []).length && e.ally) popCard(e.ally.id, step.run.state.info?.[e.actor.id]?.name || '', 'heal');
      if ((e.hits || []).length) H.sfx('hit');
      applyHp(step, e.hp); S.log.push(...lines); upd(step);
      await nap(700);
    } else if (e.k === 'act' && e.actor?.side === 'enemy') {
      pop(e.actor.id, moveLabel(e.move), 'act move', -30);
      H.dg.stage?.play(e.actor.id, 'attack');
      await nap(380);
      for (const x of e.hp || []) if (x.side !== 'enemy' && x.after < x.before) popCard(x.id, `-${fmtN(x.before - x.after)}`, 'hurt');
      applyHp(step, e.hp); S.log.push(...lines); upd(step);
      await nap(600);
    } else if (e.k === 'clock' && ((e.ticks || []).length || (e.hp || []).length)) {
      for (const t of e.ticks || []) { if (t.side === 'enemy') pop(t.id, `-${fmtN(t.dmg)}`, ''); else popCard(t.id, `-${fmtN(t.dmg)}`, 'hurt'); }
      applyHp(step, e.hp); S.log.push(...lines); upd(step);
      await nap(300);
    }
  }
  V = mergeAnswer(V, r);
  H.setView(V);
}
async function settle(r) {
  S.busy = false;
  if (r.status === 'over' || r.state?.phase !== 'fight') { disposeFight(); await H.reload(); return true; }
  if (!alive()) return true;
  upd(); place();
  autoNext();
  return true;
}
// Finish Room (D-200, D-201): the server plays the room (R1c /finish); the log replays at FINISH_SPEED with Skip; Auto is greyed meanwhile.
async function finishRoom() {
  if (S.finishing) { S.skip = true; H.sfx('click'); return; }
  if (S.busy || S.picking) return;
  clearTimeout(autoT);
  S.busy = true; S.finishing = true; S.skip = false; S.notice = `Finishing the room · Round ${fightOf(V)?.clock ?? ''}`;
  H.sfx('click'); upd();
  const r = await post('finish', {});
  if (!r?.ok) { S.finishing = false; S.notice = ''; S.busy = false; upd(); H.toast(r?.message || 'That did not work.'); return; }
  await play(r);
  S.finishing = false; S.skip = false; S.notice = '';
  await settle(r);
}
function autoNext(now) {
  clearTimeout(autoT);
  if (!H.dg.auto) return;
  if (now) { if (!S.busy) autoStep(); return; }
  autoT = setTimeout(autoStep, 550);
}
async function autoStep() {
  if (!H.dg.auto || S.busy || S.picking || !alive()) return;
  S.busy = true; upd();
  const r = await post('auto', { max: H.AUTO_ROUNDS });
  if (!r?.ok) { S.busy = false; H.setAuto(false); fightEl()?.querySelector('.dg-auto')?.classList.remove('on'); upd(); H.toast(r?.message || 'That did not work.'); return; }
  await play(r);
  await settle(r);
}

// The reticle on the target (the v1 placeArena places the plates; it knows no v2 target).
function place(main = document.getElementById('main')) {
  if (!main || !H) return;
  H.placeArena(main);
  const r = main.querySelector('.dg-fight.g2 .dg-reticle');
  const L = H.dg.stage?.labels?.() || [];
  const l = L[S.target];
  const canvas = main.querySelector('.dg-fight.g2 .dg-canvas');
  const on = !!l && fightModel(V).targets.includes(S.target) && !S.picking;
  // the drawn height of the monsters (the stage's own projection, the tallest standing one): measured by the R1e size check (G-E11)
  if (canvas && L.length) { const up = foesOf(V).filter((f) => !f.down).map((f) => L[f.i]).filter(Boolean); if (up.length) canvas.dataset.monsterPx = String(Math.round(Math.max(...up.map((x) => x.foot - x.y)))); }
  if (r) {
    r.classList.toggle('on', on);
    if (l) { r.style.left = `${l.x}px`; r.style.top = `${(canvas ? canvas.offsetTop : 0) + (l.y + l.foot) / 2}px`; r.style.width = r.style.height = `${Math.max(1, (l.foot - l.y) * 0.8)}px`; }
  }
}
// D-206: on the wide classes the control row goes beside the cards (Music and the hint at the left, Finish Room and Auto at the right), and
// its grid row goes to the stage (CSS: .g2-side). D-205: on 375 px phones (is-narrow) the supports join the squad row as small cards.
function layout(F) {
  if (!F?.isConnected) return;
  const units = F.querySelector('.dg-units'), ctl = F.querySelector('.dg-ctl');
  const wide = ['medium', 'expanded'].includes(document.body.dataset.size || '') && !F.classList.contains('is-stack');
  F.classList.toggle('g2-side', wide);
  if (wide && ctl && units && ctl.parentNode !== units) {
    const L = document.createElement('div'); L.className = 'g2-l';
    const R = document.createElement('div'); R.className = 'g2-r';
    [ctl.querySelector('.dg-music'), ctl.querySelector('.dg-hint')].forEach((x) => x && L.appendChild(x));
    [ctl.querySelector('.dg-finish'), ctl.querySelector('.dg-auto')].forEach((x) => x && R.appendChild(x));
    ctl.append(L, document.createElement('span'), R);
    units.appendChild(ctl);
  }
  // the grid row of the control row goes to the stage (read from the computed grid of this size class, so each class keeps its own template)
  F.style.gridTemplateAreas = ''; F.style.gridTemplateRows = '';
  if (wide) {
    const areas = (getComputedStyle(F).gridTemplateAreas.match(/"[^"]+"/g) || []).map((r) => r.slice(1, -1).trim().split(/\s+/));
    const k = areas.findIndex((r) => r.includes('hint') && !r.includes('arena'));
    if (k >= 0) {
      const keep = areas.filter((_, i) => i !== k);
      F.style.gridTemplateAreas = keep.map((r) => `"${r.join(' ')}"`).join(' ');
      F.style.gridTemplateRows = keep.map((r) => (r.includes('arena') ? 'minmax(0, 1fr)' : 'auto')).join(' ');
    }
  }
  if (wide && units) {
    const cards = [...units.querySelectorAll('.dg-unit')].map((x) => x.getBoundingClientRect());
    if (cards.length) F.style.setProperty('--g2-cards', `${Math.max(...cards.map((q) => q.right)) - Math.min(...cards.map((q) => q.left))}px`);
  }
  // a wide support tile (the text column 200 px or more, review-5): the HP row sits on the state line
  F.querySelectorAll('.dg-sup.g2-sup').forEach((b) => { const t = b.querySelector('.t'); b.classList.toggle('g2-row', !!t && t.getBoundingClientRect().width >= 200); });
  const narrow = F.classList.contains('is-narrow');
  F.querySelectorAll('.dg-sup.g2-sup').forEach((b) => { const home = narrow ? units : F.querySelector('.dg-sups'); if (home && b.parentNode !== home) home.appendChild(b); b.classList.toggle('g2-plate', narrow); });
  place(F.closest('#main') || undefined);
}

// ---- The monster portraits of the strip (the same models as the stage: public/dungeon/monsters/<model>.glb) ----
const PORT = new Map();    // model -> data URL (done)
const PORT_Q = new Map();  // model -> Promise (loading)
export const portraitNow = (key) => PORT.get(key) || '';
/** The cache key of a portrait: the model and the element (the stage tints a model by the element). */
export const portraitKey = (model, element) => `${model}|${element || ''}`;
const MODELS = '/dungeon/monsters/';
/** Render the portrait of each model once (a 96 px square, the head and body framed), then fill the strip images of that model. */
export async function portraits(foes) {
  const want = [...new Set(foes.filter((f) => f.model).map((f) => portraitKey(f.model, f.element)))].filter((k) => !PORT.has(k) && !PORT_Q.has(k));
  if (!want.length) return;
  let THREE, GLTFLoader;
  try { THREE = await import('three'); ({ GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')); } catch { return; }
  const size = 96;
  const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true }); } catch { return; }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setSize(size, size, false);
  const loader = new GLTFLoader();
  for (const m of want) {
    const [model0, el] = m.split('|');
    const job = new Promise((ok) => loader.load(MODELS + model0 + '.glb', ok, undefined, () => ok(null)));
    PORT_Q.set(m, job);
    const g = await job;
    PORT_Q.delete(m);
    if (!g) continue;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(TOKENS['text-on-color'], TOKENS['border-strong'], 2.2));
    const sun = new THREE.DirectionalLight(TOKENS['text-on-color'], 1.6); sun.position.set(1, 2, 3); scene.add(sun);
    const model = g.scene;
    const col = TOKENS[`element-${el}`] ? new THREE.Color(TOKENS[`element-${el}`]) : null;
    model.traverse((o) => { if (o.isMesh && o.material && col) { o.material = o.material.clone(); o.material.color?.lerp(col, 0.45); } });
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model, true);
    const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
    const top = box.max.y, h = Math.max(sz.y * 0.62, sz.x * 0.62, 0.001);   // the upper part of the body: the head reads at 24 px
    const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
    const dist = h / (2 * Math.tan((30 * Math.PI) / 360)) * 1.15;
    cam.position.set(c.x, top - h / 2, c.z + sz.z / 2 + dist);
    cam.lookAt(c.x, top - h / 2, c.z);
    scene.add(model);
    renderer.render(scene, cam);
    const url = canvas.toDataURL('image/png');
    PORT.set(m, url);
    document.querySelectorAll(`.g2-strip img.g2-port[data-model="${m}"]`).forEach((img) => { img.src = url; img.classList.add('is-on'); });
  }
  renderer.dispose(); renderer.forceContextLoss?.();
}

// The top band of the stage that the monsters leave free on phones: down to the plate bottom + sp-3 (review-5: the models start there).
function slotTop(canvas) {
  const F = canvas.closest('.dg-fight'); if (!F) return 0;
  const pl = [...F.querySelectorAll('.dg-plate')].map((p) => p.getBoundingClientRect().bottom);
  if (!pl.length) return 0;
  return Math.max(0, Math.max(...pl) + TOKENS['sp-3'] - canvas.getBoundingClientRect().top);
}
