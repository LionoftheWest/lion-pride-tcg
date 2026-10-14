/**
 * THE COMBAT LAB (docs/foundations.md F-3 item 6, docs/combat-lab.md). One command, on the LOCAL copy only:
 *
 *   LOCALDB=1 node scripts/combat-lab.mjs [--quick] [--sections a,b,c] [--out dir] [--baseline file] [--no-baseline]
 *
 * It plays seeded fights for the Hunt, the Dungeon and the Gauntlet with every boss kind and every foe kind, and it writes a report
 * (out/combat-lab/report.md and report.json, not committed: the folder out/ is ignored). The Lab never calculates combat: every number
 * comes from the SAME SQL functions as a real fight (hunt_attack, hunt_support, dungeon_start, dungeon_attack, dungeon_support,
 * dungeon_pass_turn, dungeon_choose, dungeon_auto_rounds, gauntlet_start, card_combat, combat_cooldown ...). The Lab only sets up a member
 * and a fight (scripts/lab-sql.mjs), picks the next action, reads what the fight wrote, and adds up the results. Every fight runs in an
 * undone block (nothing stays on the local copy), with a fixed seed, so the same command gives the same report.
 *
 * Sections (the default is all of them):
 *   data       every card at 0 to 5 stars: no NaN, no NULL, no zero HP; every ability has a cooldown of 1 or more
 *   hunt       the damage of every attacker, the value of every support, the strongest squads, every boss kind
 *   dungeon    every foe kind and element, whole runs with random squads, the shape of the best squad
 *   gauntlet   the weekly Gauntlet, the 0-star rule, no loot
 *   stats      the value of one stat point in each stat, and of one star for each rarity (docs/foundations.md F-3 item 9)
 *   rewards    each reward pays once (a Hunt prize, a Dungeon run), also when the settle runs a second time
 *   smoke      every card takes part in a Hunt fight
 *
 * Findings (the exit code is 1 when there is one that is not in the baseline):
 *   INVARIANT  HP below 0 or above the maximum, a NaN or a NULL number, a negative shield, an SQL error in a fight
 *   REWARD     a reward that paid twice, or that does not equal the run
 *   COOLDOWN   a support with a cooldown of 0
 *   LOOP       a fight that does not end: a call that runs longer than the limit, a fight that reaches its round limit or its call limit
 *   LOCK       a heal larger than all damage, a stun chain, a squad that cannot fall or a foe that cannot be killed
 *   BALANCE    a card, a stat or a boss far from the others (information: does not change the exit code)
 * INVARIANT, REWARD and COOLDOWN are never accepted by a baseline. LOOP and LOCK findings that are listed in the baseline file are "known"
 * (a design question for Nathan), and a NEW one fails the Lab.
 *
 * LAB_MUTATE=<file.sql>  installs a candidate (inside every request, undone with it): the Lab runs on the changed code. The acceptance test
 *                        (scripts/test-combat-lab.mjs) plants a loop, a heal of everything, a negative HP and a cooldown of 0 this way.
 */
import { runBlock, assertLocal, sqlLit } from './lab-lib.mjs';
import { installHelpers, PLAN } from './lab-sql.mjs';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
assertLocal('combat-lab.mjs');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const TINY = flag('tiny');   // the acceptance test: a few fights of each kind (seconds, not minutes)
const QUICK = flag('quick') || TINY;
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = opt('out', join(HERE, '..', 'out', 'combat-lab'));
const SECTIONS = new Set((opt('sections', 'data,hunt,dungeon,gauntlet,stats,rewards,smoke')).split(','));
const BASELINE_FILE = flag('no-baseline') ? null : opt('baseline', join(HERE, 'combat-lab.baseline.json'));
const MUTATE = process.env.LAB_MUTATE ? readFileSync(process.env.LAB_MUTATE, 'utf8').replace(/\r/g, '').replace(/notify pgrst[^\n]*\n/g, '') : '';
if (MUTATE.includes('$m$')) throw new Error('the LAB_MUTATE file must not contain $m$');

// --- The sizes. The full Lab is the budget of the docs; --quick samples to fit about 3 minutes. ---------------------------------
const N = TINY
  ? { duel: 4, supSeeds: 2, supCount: 4, squadSeeds: 1, squadRandom: 2, squadClimb: 3, bossSeeds: 1, foeSeeds: 1, foeKinds: ['fight', 'guardian'], els: 3, bosses: 3, runs: 2, shapeRuns: 1, gauntRuns: 1, statCards: 2, statSeeds: 2, starCards: 1, rewardFights: 3, smoke: 20 }
  : QUICK
  ? { duel: 8, supSeeds: 4, supCount: 14, squadSeeds: 3, squadRandom: 8, squadClimb: 6, bossSeeds: 3, foeSeeds: 1, foeKinds: ['fight', 'elite', 'guardian'], runs: 6, shapeRuns: 2, gauntRuns: 2, statCards: 3, statSeeds: 6, starCards: 2, rewardFights: 4, smoke: 60 }
  : { duel: 24, supSeeds: 16, supCount: 999, squadSeeds: 6, squadRandom: 40, squadClimb: 36, bossSeeds: 6, foeSeeds: 2, foeKinds: ['fight', 'horde', 'elite', 'miniboss', 'guardian'], runs: 20, shapeRuns: 6, gauntRuns: 6, statCards: 8, statSeeds: 16, starCards: 4, rewardFights: 12, smoke: 9999 };
N.rounds = 40;   // a Hunt fight: at most this many attacks (balance round_cap)
const ctx = {};   // what a section hands to the next (the attackers by value, the supports by value, the best squad)
const LIMIT_S = Number(process.env.LAB_LIMIT_S || 45);   // an SQL request that runs longer than this is a LOOP (the request is cut by statement_timeout)
const T0 = Date.now();
const log = (m) => console.error(`[lab ${((Date.now() - T0) / 1000).toFixed(0).padStart(4)} s] ${m}`);

// --- The report data --------------------------------------------------------------------------------------------------------
const rep = { meta: { quick: QUICK, started: new Date().toISOString(), sizes: N, mutate: process.env.LAB_MUTATE || null }, findings: [], timing: {} };
const findings = rep.findings;
const find = (cls, key, msg, data) => { if (!findings.some((f) => f.key === key)) findings.push({ cls, key, msg, data }); };
class Abort extends Error {}
const timeIt = async (name, fn) => { const t = Date.now(); try { return await fn(); } finally { rep.timing[name] = Math.round((Date.now() - t) / 1000); log(`${name} done in ${rep.timing[name]} s`); } };

// --- Requests ----------------------------------------------------------------------------------------------------------------
const seeds = (n, o = 0) => Array.from({ length: n }, (_, i) => Number((((i + 1) * 0.6180339887 + o * 0.37) % 1 * 1.8 - 0.9).toFixed(4)));
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const sd = (a) => { const m = mean(a); return a.length > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)) : 0; };
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };
const r2 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 100) / 100);
const r4 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10000) / 10000);
const pct = (x) => (x == null ? '-' : `${(x * 100).toFixed(1)}%`);

/** One request: the SQL expressions (each returns jsonb) run in one undone block. Returns the array of results. */
async function request(exprs, timeoutS = LIMIT_S) {
  const body = `${PLAN} set local statement_timeout = '${timeoutS}s';
do $t$
declare o jsonb[] := '{}';
begin
  ${installHelpers()}
  ${MUTATE ? 'execute $m$' + MUTATE + '$m$;' : ''}
  ${exprs.map((e) => `o := o || coalesce(${e}, '{"null_result": true}'::jsonb);`).join('\n  ')}
  raise exception 'RESULT:%', to_jsonb(o)::text;
end $t$;`;
  return JSON.parse(await runBlock(body));
}
const isTimeout = (e) => /statement timeout|Query read timeout/i.test(String(e.message));

/**
 * All the calls, in chunks that take about 20 s each (one request must end before the limit). A chunk that runs into the limit is split
 * into single calls, and each call that is too long is a LOOP finding and gets the result {timeout: true}.
 */
async function calls(name, exprs, { target = 20 } = {}) {
  const out = []; let size = 2, i = 0, hung = 0;
  while (i < exprs.length) {
    if (hung >= 2) { out.push(...exprs.slice(i).map(() => ({ timeout: true }))); break; }   // two calls did not end: the rest is not tried (it would wait just as long)
    const part = exprs.slice(i, i + size), t = Date.now();
    try {
      out.push(...await request(part));
      const per = Math.max(0.005, (Date.now() - t) / 1000 / part.length);
      size = Math.max(1, Math.min(200, Math.floor(target / per)));
      i += part.length;
    } catch (e) {
      if (!isTimeout(e)) throw e;
      for (const x of part) {   // find the call that does not end
        if (hung >= 2) { out.push({ timeout: true }); continue; }
        try { out.push(...await request([x], Math.max(3, Math.min(20, LIMIT_S)))); } catch (e2) {
          if (!isTimeout(e2)) throw e2;
          hung++;
          out.push({ timeout: true });
          find('LOOP', `${name}:timeout:${out.length}`, `${name}: one call did not end within ${Math.min(20, LIMIT_S)} s (an infinite loop or a lock)`, { call: x.slice(0, 300) });
        }
      }
      i += part.length; size = 1;
    }
  }
  return out;
}
// (a planted change, LAB_MUTATE, is installed first: the data checks see it too)
const sqlRows = async (sql) => JSON.parse(await runBlock(`do $t$ begin ${MUTATE ? 'execute $m$' + MUTATE + '$m$;' : ''} raise exception 'RESULT:%', (select coalesce(jsonb_agg(z), '[]'::jsonb) from (${sql}) z)::text; end $t$;`));

// --- Facts of the local copy: the cards, the subjects, the balance ---------------------------------------------------------------
const RAR_ORDER = ['normal', 'illustrated_rare', 'full_art', 'secret_rare', 'gold', 'event', 'promo'];
async function loadFacts() {
  const cards = await sqlRows(`select c.id, c.name, c.rarity::text rarity, c.subject_id sid, s.type, s.ability, coalesce(s.tag_slugs, '{}') tags, s.cp_mod,
      card_combat(c.rarity::text, 0, s.cp_mod, '{}'::jsonb) cmb from cards c join subjects s on s.id = c.subject_id order by c.id`);
  const bal = (await sqlRows(`select key, value from balance where key in ('boss_atk', 'boss_hp', 'boss_tiers', 'round_cap', 'daily_card_cap', 'stars', 'rarity_cp', 'stat_points', 'dungeon', 'support', 'combat')`))
    .reduce((a, r) => ({ ...a, [r.key]: r.value }), {});
  const passives = (await sqlRows(`select passives_for('boss') b, passives_for('counter') c, passives_for('foe') f, dungeon_foe_elements() e`))[0];
  const bosses = ['The Rage-Quit Warlord', 'The Netcode Mutant', 'Maw of the Meta', 'The Lagspike Parasite', 'The Patch-Day Pumpkin', 'The Ranked Nightshade', 'The Grind Vampire', 'The Ban-Wave Demon', 'The Smurf Brute', 'The AFK Warzombie', 'The Hardstuck Skeleton', 'The Zerg-Rush Queen'];
  const monsters = (await sqlRows(`select key from dungeon_monsters order by key`)).map((r) => r.key);
  const isAtk = (c) => ['Character', 'Creature'].includes(c.type);
  // one card for each subject: the lowest rarity (the card facts, not a member's copy)
  const bySubject = new Map();
  for (const c of cards) { const o = bySubject.get(c.sid); if (!o || RAR_ORDER.indexOf(c.rarity) < RAR_ORDER.indexOf(o.rarity)) bySubject.set(c.sid, c); }
  const subjects = [...bySubject.values()].map((c) => ({ ...c, atk: isAtk(c), eff: c.ability?.effect ?? (c.ability?.kind ?? 'none') }));
  return { cards, subjects, bal, passives, bosses, monsters, isAtk };
}

const F = await loadFacts();
rep.meta.cards = F.cards.length; rep.meta.subjects = F.subjects.length;
log(`${F.cards.length} cards, ${F.subjects.length} subjects, ${F.subjects.filter((s) => s.atk).length} attackers`);
const STD = { tier: 'Normal' };   // the standard boss: the Normal tier ATK (balance boss_atk), no passive, no weakness, a huge HP
const bossLit = (b) => `${sqlLit(b)}::jsonb`;
const buildsLit = (b) => `${sqlLit(b || {})}::jsonb`;
const arrLit = (a) => `array[${a.join(',')}]::bigint[]`;
const seedLit = (s) => `array[${s.join(',')}]::float[]`;
const nameOf = (id) => F.cards.find((c) => c.id === id);
const label = (c) => `${c.name} (${c.type}${c.ability ? `, ${c.ability.effect ?? c.ability.kind}` : ''})`;

// ===== data ===============================================================================================================
async function secData() {
  const g = (await sqlRows(`select jsonb_build_object(
    'cards', (select count(*) from cards),
    'bad_cards', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'asc', a, 'why', w)), '[]'::jsonb) from cards c join subjects s on s.id = c.subject_id, generate_series(0, 5) a,
        lateral (select card_combat(c.rarity::text, a, s.cp_mod, '{}'::jsonb) k) cc,
        lateral (select case when cc.k is null then 'NULL' when (cc.k->>'cp') is null or (cc.k->>'hp') is null then 'cp or hp is NULL'
                             when (cc.k->>'cp')::numeric <= 0 then 'cp is 0 or less' when (cc.k->>'hp')::numeric <= 0 then 'hp is 0 or less'
                             when cc.k::text ~ '(NaN|Infinity)' then 'NaN' end w) q where q.w is not null),
    'not_monotone', (select count(*) from cards c join subjects s on s.id = c.subject_id, generate_series(1, 5) a
        where (card_combat(c.rarity::text, a, s.cp_mod, '{}'::jsonb)->>'cp')::numeric < (card_combat(c.rarity::text, a - 1, s.cp_mod, '{}'::jsonb)->>'cp')::numeric),
    'bad_abilities', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'why', w)), '[]'::jsonb) from subjects s,
        lateral (select case when s.ability is null then null
                             when s.ability->>'kind' = 'support' and (s.ability->>'cooldown' is null or (s.ability->>'cooldown')::numeric < 1) then 'support cooldown is missing or below 1'
                             when s.ability->>'kind' = 'support' and coalesce((s.ability->>'amount')::numeric, 0) <= 0 and s.ability->>'effect' <> 'stun' and s.ability->>'effect' <> 'cleanse' then 'support amount is 0 or less'
                             when s.ability->>'kind' not in ('attack', 'support') then 'unknown ability kind' end w) q where q.w is not null),
    'cooldown_grid', (select min(combat_cooldown(c, h)) from generate_series(1, 12) c, unnest(array[1, 0.96, 0.8, 0.5, 0.2, 0.01, 0]::numeric[]) h)
  ) j`))[0].j;
  rep.data = { cards: g.cards, not_monotone: g.not_monotone, cooldown_grid_min: g.cooldown_grid };
  if (g.bad_cards.length) find('INVARIANT', 'data:card_combat', `card_combat gives a bad value for ${g.bad_cards.length} (card, star) pairs`, g.bad_cards.slice(0, 10));
  if (g.not_monotone > 0) find('BALANCE', 'data:stars_not_monotone', `${g.not_monotone} (card, star) pairs where one more star lowers the CP`);
  for (const b of g.bad_abilities) {
    const cd = /cooldown/.test(b.why);
    find(cd ? 'COOLDOWN' : 'INVARIANT', `data:ability:${b.id}`, `subject ${b.name}: ${b.why}`);
  }
  if (g.cooldown_grid < 1) find('COOLDOWN', 'data:combat_cooldown', `combat_cooldown can return ${g.cooldown_grid} (a support with a cooldown of 0)`);
  rep.data.bad_abilities = g.bad_abilities.length;
}

// ===== hunt: attackers (the duel) ===========================================================================================
function checkResult(name, r, what) {
  if (!r || r.timeout) return;
  if (r.viol?.length) find('INVARIANT', `${name}:viol:${r.viol[0]}`.slice(0, 160), `${name}: ${r.viol.slice(0, 3).join('; ')}${what ? ` (${what})` : ''}`);
  const errs = Object.keys(r.err && typeof r.err === 'object' ? r.err : {}).filter((k) => k.startsWith('SQL ') || k.startsWith('pass:SQL'));
  if (errs.length) find('INVARIANT', `${name}:sql:${errs[0]}`.slice(0, 160), `${name}: an SQL error in a fight: ${errs[0].slice(0, 200)}`);
  if (r.cd0 > 0) find('COOLDOWN', `${name}:cd0`, `${name}: ${r.cd0} support plays with a cooldown of 0 (${what ?? ''})`);
}
async function hunt() {
  const atk = F.subjects.filter((s) => s.atk), sup = F.subjects.filter((s) => !s.atk && s.ability?.kind === 'support');
  // --- attackers: the damage of one attack, and the HP the boss counter takes, over the seeds; full boss HP and a boss at 20% (execute)
  const S = seeds(N.duel);
  const exprs = [];
  for (const s of atk) for (const f of [1, 0.2]) exprs.push(`pg_temp.lab_hunt_duel(${s.id}, '{}'::jsonb, ${bossLit({ ...STD, hp_frac: f })}, ${seedLit(S)})`);
  const res = await timeIt('hunt:duels', () => calls('hunt-duel', exprs));
  if (process.env.LAB_DEBUG) console.error(JSON.stringify(res.slice(0, 2)));
  const A = atk.map((s, i) => {
    const full = res[2 * i], low = res[2 * i + 1];
    for (const r of [full, low]) checkResult('hunt-duel', r, s.name);
    const one = (r) => { const dm = r.dmg_sum / Math.max(1, r.n), loss = Math.max(1, r.loss_sum / Math.max(1, r.n)); return { dmg: dm, loss, life: dm * r.hp / loss, crit: r.crit / Math.max(1, r.n), miss: r.miss / Math.max(1, r.n), cp: r.cp, hp: r.hp, n: r.n }; };
    const a = one(full), b = one(low);
    return { id: s.id, sid: s.sid, name: s.name, rarity: s.rarity, effect: s.eff, tags: s.tags, cp: a.cp, hp: a.hp, dmg: a.dmg, dmg_low: b.dmg, loss: a.loss, crit: a.crit, life_full: a.life, life_low: b.life, value: 0.75 * a.life + 0.25 * b.life };
  }).filter((a) => a.cp);
  if (A.length < 5) { find('LOOP', 'hunt:no_attackers', `the attacker sweep gave no result (${res.filter((r) => r && r.timeout).length} calls did not end)`); throw new Abort('the attacker sweep gave no result'); }
  A.sort((x, y) => y.value - x.value);
  const med = median(A.filter((a) => !['event', 'promo'].includes(a.rarity)).map((a) => a.value));
  A.forEach((a) => { a.ratio = a.value / med; });
  rep.attackers = A;
  rep.attacker_effects = Object.entries(A.reduce((o, a) => ({ ...o, [a.effect]: [...(o[a.effect] || []), a.ratio] }), {})).map(([e, v]) => ({ effect: e, n: v.length, mean_ratio: r2(mean(v)) })).sort((x, y) => y.mean_ratio - x.mean_ratio);
  for (const a of A) {
    if (['event', 'promo'].includes(a.rarity)) continue;   // the event cards are a special rarity: listed, not an outlier
    if (a.ratio > 2.5) find('BALANCE', `hunt:atk-high:${a.id}`, `attacker ${a.name} is worth ${r2(a.ratio)} times the median attacker`);
    if (a.ratio < 0.35) find('BALANCE', `hunt:atk-low:${a.id}`, `attacker ${a.name} is worth ${r2(a.ratio)} times the median attacker`);
  }
  for (const e of rep.attacker_effects) if (e.n >= 3 && (e.mean_ratio > 1.6 || e.mean_ratio < 0.6)) find('BALANCE', `hunt:atk-effect:${e.effect}`, `the attack effect ${e.effect} is ${e.mean_ratio} times the median (${e.n} cards)`);
  // the reference squad: the three attackers around the median
  const pool = A.filter((a) => !['event', 'promo'].includes(a.rarity));
  const m = Math.floor(pool.length / 2);
  const refAtk = [pool[m - 1], pool[m], pool[m + 1]];
  ctx.A = pool; ctx.refAtk = refAtk;
  log(`attackers: median value ${r2(med)}, top ${A[0].name} ${r2(A[0].ratio)}x, bottom ${A.at(-1).name} ${r2(A.at(-1).ratio)}x`);

  // --- supports: the same 3 attackers fight with and without the support card (the same seeds); the value = the extra squad damage
  const SS = seeds(N.supSeeds, 1);
  const fight = (squad, seed, boss, builds) => `pg_temp.lab_hunt_fight(${seed}, ${arrLit(squad)}, ${buildsLit(builds)}, ${bossLit(boss || STD)}, ${N.rounds}, '{}'::jsonb)`;
  const squads = new Map();   // the base squads: the reference one and one for each affinity tag (3 attackers that carry the tag)
  const refIds = refAtk.map((a) => a.id);
  const matchedSquad = (tag) => {
    const withTag = A.filter((a) => a.tags.includes(tag));
    if (withTag.length < 2) return null;
    const pick = [...withTag].sort((x, y) => Math.abs(x.value - med) - Math.abs(y.value - med)).slice(0, 3).map((a) => a.id);
    for (const id of refIds) if (pick.length < 3 && !pick.includes(id)) pick.push(id);
    return pick;
  };
  const supList = sup.slice(0, N.supCount);
  ctx.sup = sup;
  const baseKeys = new Map();   // key -> squad
  baseKeys.set('ref', refIds);
  for (const s of supList) { const tag = s.ability.affinity; if (tag && !baseKeys.has(tag)) { const q = matchedSquad(tag); if (q) baseKeys.set(tag, q); } }
  const baseList = [...baseKeys.entries()];
  const bexprs = []; for (const [, q] of baseList) for (const sd of SS) bexprs.push(fight(q, sd));
  const bres = await timeIt('hunt:support-baselines', () => calls('hunt-base', bexprs));
  const base = new Map(); baseList.forEach(([k], i) => base.set(k, bres.slice(i * SS.length, (i + 1) * SS.length)));
  for (const r of bres) checkResult('hunt-fight', r, 'no support');
  const sexprs = []; const spec = [];
  for (const s of supList) {
    spec.push({ s, kind: 'ref' }); if (base.has(s.ability.affinity)) spec.push({ s, kind: 'matched' });
  }
  for (const x of spec) for (const sd of SS) sexprs.push(fight([...(x.kind === 'ref' ? refIds : baseKeys.get(x.s.ability.affinity)), x.s.id], sd));
  const sres = await timeIt('hunt:supports', () => calls('hunt-support', sexprs));
  const supVal = new Map();
  spec.forEach((x, i) => {
    const rs = sres.slice(i * SS.length, (i + 1) * SS.length), bs = base.get(x.kind === 'ref' ? 'ref' : x.s.ability.affinity);
    rs.forEach((r) => checkResult('hunt-fight', r, `${x.s.name} ${x.kind}`));
    const d = rs.map((r, j) => r.dmg_gross - bs[j].dmg_gross), hl = rs.map((r, j) => r.squad_hp_lost - bs[j].squad_hp_lost), dw = rs.map((r, j) => r.downs - bs[j].downs);
    const b0 = mean(bs.map((b) => b.dmg_gross));
    const o = { value: mean(d), se: sd(d) / Math.sqrt(d.length), pct: b0 ? mean(d) / b0 : 0, hp_lost: mean(hl), downs: mean(dw), plays: mean(rs.map((r) => r.supports)), base_dmg: b0, per_seed: d };
    supVal.set(`${x.s.id}:${x.kind}`, o);
  });
  const S2 = sup.slice(0, N.supCount).map((s) => {
    const r = supVal.get(`${s.id}:ref`), mt = supVal.get(`${s.id}:matched`);
    return { id: s.id, sid: s.sid, name: s.name, rarity: s.rarity, effect: s.eff, target: s.ability.target ?? 'boss', affinity: s.ability.affinity, cooldown: s.ability.cooldown, amount: s.ability.amount,
      value: r.value, se: r.se, pct: r.pct, hp_lost: r.hp_lost, downs: r.downs, plays: r.plays, value_matched: mt ? mt.value : null, pct_matched: mt ? mt.pct : null, best: Math.max(r.value, mt ? mt.value : -1e9) };
  });
  S2.sort((x, y) => y.best - x.best);
  rep.supports = S2;
  ctx.S2 = S2; ctx.supVal = supVal; ctx.SS = SS; ctx.baseSquad = refIds; ctx.refBase = mean(base.get('ref').map((b) => b.dmg_gross)); ctx.fight = fight;
  const bestPct = S2.map((x) => Math.max(x.pct, x.pct_matched ?? -9));
  rep.support_effects = Object.entries(S2.reduce((o, x) => ({ ...o, [x.effect]: [...(o[x.effect] || []), Math.max(x.pct, x.pct_matched ?? -9)] }), {})).map(([e, v]) => ({ effect: e, n: v.length, mean_pct: r2(mean(v)) })).sort((x, y) => y.mean_pct - x.mean_pct);
  const mp = median(bestPct);
  for (const x of S2) {
    const p = Math.max(x.pct, x.pct_matched ?? -9);
    if (p > Math.max(0.5, mp * 4)) find('BALANCE', `hunt:sup-high:${x.id}`, `support ${x.name} adds ${pct(p)} squad damage (median ${pct(mp)})`);
    if (p < 0 && Math.abs(x.value) > 2 * x.se && x.effect !== 'cleanse') find('BALANCE', `hunt:sup-negative:${x.id}`, `support ${x.name} LOWERS the squad damage (${pct(p)}, more than 2 standard errors)`);
  }
  log(`supports: ${S2.length}; best ${S2[0]?.name} (${pct(S2[0]?.pct)}), worst ${S2.at(-1)?.name} (${pct(S2.at(-1)?.pct)})`);
}


// ===== hunt: the strongest squads ==============================================================================================
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const shapeOf = (ids) => { const a = ids.filter((id) => nameOf(id).type === 'Character' || nameOf(id).type === 'Creature').length; return `${a}A+${ids.length - a}S`; };
const effectsOf = (ids) => ids.map((id) => nameOf(id).ability?.effect ?? '-').join(',');
let _hunt;
const ensureHunt = () => (_hunt ??= timeIt('hunt', hunt));   // (a stopped hunt section stays stopped: the later sections stop with it)

async function evalSquads(list, n) {
  const S = seeds(n, 2);
  const exprs = []; for (const q of list) for (const sd of S) exprs.push(ctx.fight(q.ids, sd));
  const res = await calls('squad', exprs);
  list.forEach((q, i) => {
    const rs = res.slice(i * S.length, (i + 1) * S.length);
    rs.forEach((r) => { checkResult('hunt-squad', r, shapeOf(q.ids)); });
    q.dmg = mean(rs.map((r) => r.dmg_gross)); q.hp_lost = mean(rs.map((r) => r.squad_hp_lost)); q.downs = mean(rs.map((r) => r.downs)); q.attacks = mean(rs.map((r) => r.attacks));
    q.stops = rs.reduce((o, r) => ({ ...o, [r.stop]: (o[r.stop] || 0) + 1 }), {}); q.shape = shapeOf(q.ids); q.effects = effectsOf(q.ids);
    q.names = q.ids.map((id) => nameOf(id).name);
    for (const r of rs) {
      if (r.stop === 'round_cap') find('LOCK', `squad:round_cap:${q.shape}:${q.ids.join('-')}`.slice(0, 200), `a squad of ${q.shape} reaches the round limit with the boss alive (it cannot fall and does not win)`, { ids: q.ids });
      if (r.boss_stun_run_max >= 3) find('LOCK', `squad:stun_chain:${q.ids.join('-')}`.slice(0, 200), `the boss is stunned ${r.boss_stun_run_max} rounds in a row`, { ids: q.ids });
    }
  });
  return list;
}
async function squads() {
  await ensureHunt();
  const A = ctx.A.filter((a, i, all) => all.findIndex((b) => b.sid === a.sid) === i), S = ctx.S2.filter((x, i, all) => all.findIndex((b) => b.sid === x.sid) === i);
  const rnd = rng(0xC0FFEE);
  const pick = (arr, k) => { const c = [...arr], out = []; while (out.length < k && c.length) out.push(c.splice(Math.floor(rnd() * c.length), 1)[0]); return out; };
  const list = [];
  for (let k = 1; k <= 7; k++) list.push({ ids: [...A.slice(0, k), ...S.slice(0, 8 - k)].map((x) => x.id), how: `top ${k} attackers + top ${8 - k} supports` });
  for (const e of [...new Set(S.map((x) => x.effect))]) {
    const same = S.filter((x) => x.effect === e).slice(0, 5), rest = S.filter((x) => x.effect !== e);
    list.push({ ids: [...A.slice(0, 3), ...same, ...rest.slice(0, 5 - same.length)].map((x) => x.id), how: `3 top attackers + 5 supports, as many ${e} as possible` });
  }
  for (let i = 0; i < N.squadRandom; i++) { const k = 2 + Math.floor(rnd() * 5); list.push({ ids: [...pick(A, k), ...pick(S, 8 - k)].map((x) => x.id), how: 'random' }); }
  await timeIt('hunt:squads', () => evalSquads(list, N.squadSeeds));
  // hill climbing from the two best: change one card, keep the change when the squad deals more damage
  const pool = [...A, ...S];
  const best = [...list].sort((x, y) => y.dmg - x.dmg).slice(0, 2).map((q) => ({ ...q, how: 'climb' }));
  const climbed = [];
  for (const start of best) {
    let cur = { ...start };
    for (let round = 0; round < Math.ceil(N.squadClimb / 3); round++) {
      const nb = Array.from({ length: 6 }, () => { const ids = [...cur.ids], at = Math.floor(rnd() * ids.length); const c = pick(pool.filter((x) => !ids.includes(x.id) && !ids.some((i) => nameOf(i).sid === x.sid)), 1)[0]; ids[at] = c.id; return { ids, how: 'climb' }; })
        .filter((q) => q.ids.some((id) => nameOf(id).type === 'Character' || nameOf(id).type === 'Creature'));
      await evalSquads(nb, N.squadSeeds);
      const top = nb.sort((x, y) => y.dmg - x.dmg)[0];
      if (top && top.dmg > cur.dmg) cur = top;
    }
    climbed.push(cur);
  }
  const all = [...list, ...climbed].sort((x, y) => y.dmg - x.dmg);
  const ref = ctx.refBase;
  all.forEach((q) => { q.vs_ref = q.dmg / ref; });
  rep.squads = { reference_damage: r2(ref), top: all.slice(0, 10), shapes: list.filter((q) => /^top/.test(q.how)).map((q) => ({ shape: q.shape, dmg: r2(q.dmg), vs_ref: r2(q.vs_ref), hp_lost: r2(q.hp_lost), downs: r2(q.downs) })),
    stacks: list.filter((q) => /as many/.test(q.how)).map((q) => ({ how: q.how, dmg: r2(q.dmg), vs_ref: r2(q.vs_ref) })), random: { n: N.squadRandom, mean: r2(mean(list.filter((q) => q.how === 'random').map((q) => q.dmg)) / ref) } };
  ctx.bestSquad = all[0];
  const bestShape = all[0].shape, shapes = rep.squads.shapes;
  const top = shapes.reduce((a, b) => (b.dmg > a.dmg ? b : a), shapes[0]);
  find('BALANCE', 'squads:best_shape', `the strongest squad shape is ${bestShape} (${r2(all[0].vs_ref)} times the reference squad); the best of the shape sweep is ${top.shape} (${r2(top.vs_ref)}x)`, { top: all.slice(0, 3).map((q) => ({ shape: q.shape, effects: q.effects, vs_ref: r2(q.vs_ref) })) });
  const stack = Math.max(...shapes.filter((s) => /^[1-3]A/.test(s.shape)).map((s) => s.dmg), 0), bal = Math.max(...shapes.filter((s) => /^[4-7]A/.test(s.shape)).map((s) => s.dmg), 0);
  if (stack > bal * 1.25) find('BALANCE', 'squads:support_stacking', `support stacking is the strongest shape: squads of 1 to 3 attackers + 5 to 7 supports deal ${r2(stack / bal)} times the damage of the best squad with 4 or more attackers`);
  log(`squads: best ${bestShape} ${r2(all[0].vs_ref)}x the reference; shapes ${shapes.map((s) => `${s.shape}=${s.vs_ref}`).join(' ')}`);
}

// ===== hunt: the bosses =========================================================================================================
async function bosses() {
  await ensureHunt(); if (!ctx.bestSquad) await squads();
  const tiers = ['Normal', 'Heroic', 'Mythic'], allP = [...F.passives.b, ...F.passives.c];
  let list = [];
  F.bosses.forEach((name, j) => tiers.forEach((tier, t) => {
    const n = F.bal.boss_tiers[tier].passives;
    list.push({ name, tier, passive: [...new Set(Array.from({ length: n }, (_, k) => allP[(j * 3 + t * 5 + k) % allP.length]))], hp: F.bal.boss_hp[tier] });
  }));
  if (QUICK) list = list.filter((b) => b.tier === 'Normal');
  if (N.bosses) list = list.slice(0, N.bosses);
  const refPlus = [...ctx.baseSquad, ctx.S2[0].id];
  const squadsToUse = [['best squad', ctx.bestSquad.ids], ['reference squad + 1 support', refPlus]];
  const S = seeds(N.bossSeeds, 3);
  const exprs = []; for (const b of list) for (const [, ids] of squadsToUse) for (const sd of S) exprs.push(ctx.fight(ids, sd, { name: b.name, tier: b.tier, hp: b.hp, passive: b.passive }));
  const res = await timeIt('hunt:bosses', () => calls('boss', exprs));
  let i = 0;
  for (const b of list) {
    b.res = {};
    for (const [sname] of squadsToUse) {
      const rs = res.slice(i, i + S.length); i += S.length;
      rs.forEach((r) => checkResult('hunt-boss', r, `${b.name} ${b.tier}`));
      b.res[sname] = { dmg: mean(rs.map((r) => r.dmg_gross)), downs: mean(rs.map((r) => r.downs)), attacks: mean(rs.map((r) => r.attacks)), net: mean(rs.map((r) => r.boss_net / r.boss_max)),
        boss_heal: mean(rs.map((r) => r.boss_heal)), stops: rs.reduce((o, r) => ({ ...o, [r.stop]: (o[r.stop] || 0) + 1 }), {}), stun_run: Math.max(...rs.map((r) => r.boss_stun_run_max || 0)) };
      for (const r of rs) {
        if (r.stop === 'round_cap') find('LOCK', `boss:round_cap:${b.name}:${b.tier}:${sname}`, `${b.name} (${b.tier}) and the ${sname}: the fight reaches the round limit with both sides alive`);
        if (r.boss_stun_run_max >= 3) find('LOCK', `boss:stun_chain:${b.name}:${b.tier}:${sname}`, `${b.name} (${b.tier}): the boss is stunned ${r.boss_stun_run_max} rounds in a row`);
        // A boss that heals more than ONE squad deals is not a lock (many members hit one boss). It is a lock when the fight also runs to the round limit.
        if (r.attacks >= 10 && r.boss_heal >= r.dmg_gross * 0.9 && r.dmg_gross > 0) { if (r.stop === 'round_cap') find('LOCK', `boss:heal:${b.name}:${b.tier}:${sname}`, `${b.name} (${b.tier}): the boss heals ${r.boss_heal}, as much as one squad deals (${r.dmg_gross}) in ${r.attacks} attacks and the fight reaches the round limit`); else (ctx.outHeal ??= new Set()).add(`${b.name} ${b.tier}`); }
      }
    }
  }
  if (ctx.outHeal?.size) find('BALANCE', 'boss:out_heal', `${ctx.outHeal.size} of ${list.length} bosses heal as much as one squad deals in one fight (a single member cannot dent them): ${[...ctx.outHeal].slice(0, 6).join(', ')}${ctx.outHeal.size > 6 ? ' ...' : ''}`);
  const med = Object.fromEntries(squadsToUse.map(([s]) => [s, median(list.map((b) => b.res[s].dmg))]));
  list.forEach((b) => { for (const [s] of squadsToUse) b.res[s].rel = b.res[s].dmg / med[s]; });
  rep.bosses = list.map((b) => ({ name: b.name, tier: b.tier, passive: b.passive, ...Object.fromEntries(squadsToUse.map(([s]) => [s, { dmg: r2(b.res[s].dmg), rel: r2(b.res[s].rel), downs: r2(b.res[s].downs), attacks: r2(b.res[s].attacks), stops: b.res[s].stops }])) }));
  for (const b of list) for (const [s] of squadsToUse) {
    if (b.res[s].rel < 0.5) find('BALANCE', `boss:hard:${b.name}:${b.tier}:${s}`, `${b.name} (${b.tier}, ${b.passive.join('+')}) cuts the ${s} to ${r2(b.res[s].rel)} of the median boss damage`);
    if (b.res[s].rel > 1.8) find('BALANCE', `boss:easy:${b.name}:${b.tier}:${s}`, `${b.name} (${b.tier}, ${b.passive.join('+')}) lets the ${s} deal ${r2(b.res[s].rel)} times the median boss damage`);
  }
}

// ===== dungeon =================================================================================================================
const NEED_FIELDS = ['status', 'stop', 'viol', 'err', 'facts'];
function runExpr(seed, squad, floors, policy, opts, mode = 'daily', builds = {}) {
  return `pg_temp.lab_dungeon_run(${seed}, '${mode}', ${arrLit(squad)}, ${buildsLit(builds)}, ${floors ?? 'null'}, '${policy}', ${sqlLit(opts)}::jsonb)`;
}
/** The rules that every Dungeon or Gauntlet run must keep (INVARIANT, REWARD, LOOP, LOCK). */
function checkRun(name, r, { fightOnly = false, gauntlet = false } = {}) {
  if (!r || r.timeout) return;
  if (r.start_error) { find('INVARIANT', `${name}:start:${JSON.stringify(r.start_error).slice(0, 80)}`, `${name}: the run did not start: ${JSON.stringify(r.start_error).slice(0, 200)}`); return; }
  checkResult(name, r, null);
  const f = r.facts;
  if (f) {
    if (f.sh_rows > 1 || f.resettle_sh_rows > f.sh_rows) find('REWARD', `${name}:shards_twice`, `${name}: the Shards of one run were paid ${Math.max(f.sh_rows, f.resettle_sh_rows)} times`);
    if (f.sh_sum !== f.run_shards) find('REWARD', `${name}:shards_sum`, `${name}: the Shard ledger (${f.sh_sum}) does not equal the run (${f.run_shards})`);
    if (f.cd_rows !== f.run_cards || f.resettle_cd_rows > f.cd_rows) find('REWARD', `${name}:cards`, `${name}: the card ledger rows (${f.cd_rows}, then ${f.resettle_cd_rows}) do not equal the cards of the run (${f.run_cards})`);
    if (gauntlet && (f.sh_rows > 0 || f.cd_rows > 0 || r.shards > 0)) find('REWARD', `${name}:gauntlet_loot`, `${name}: the Gauntlet paid loot (${f.sh_sum} Shards, ${f.cd_rows} cards); it must pay none`);
    if (f.cd0 > 0) find('COOLDOWN', `${name}:cd0`, `${name}: ${f.cd0} support plays with a cooldown of 0`);
    if (f.foe_heal > 0 && f.foe_heal >= f.foe_dmg && r.rounds_max >= 12) find('LOCK', `${name}:foe_heal`, `${name}: the foes healed ${f.foe_heal}, as much as the damage dealt to them (${f.foe_dmg})`);
    if (f.card_heal > 0 && f.card_heal >= f.card_dmg && r.rounds_max >= 20) find('LOCK', `${name}:card_heal`, `${name}: the squad healed ${f.card_heal}, as much as all the damage it took (${f.card_dmg})`);
  }
  if (['round_cap', 'max_calls'].includes(r.stop) && (fightOnly || r.floor < 8)) find('LOOP', `${name}:${r.stop}`, `${name}: the run stopped at the ${r.stop === 'round_cap' ? 'round limit' : 'call limit'} (${r.calls} calls, round ${r.rounds_max}, floor ${r.floor})`);
  if (/^stuck/.test(r.stop || '')) find('LOOP', `${name}:${r.stop}`, `${name}: no call could move the run (${r.stop})`);
  if (r.pass_run_max >= 3) find('LOCK', `${name}:stun_chain_card`, `${name}: every attacker was stunned ${r.pass_run_max} rounds in a row (a stun chain)`);
  if (r.foe_stun_run_max >= 3) find('LOCK', `${name}:stun_chain_foe`, `${name}: the foes were stunned ${r.foe_stun_run_max} rounds in a row`);
}
const roomFloors = (kind, el, floor, tag) => {
  const n = kind === 'horde' ? 4 : kind === 'fight' ? 2 : 1;
  const foes = Array.from({ length: n }, (_, i) => `pg_temp.lab_foe('${kind}', ${floor}, 1, '${el}', null, null, '${tag}${i}')`).join(', ');
  return `jsonb_build_array(jsonb_build_array(jsonb_build_object('type', '${kind}', 'foes', jsonb_build_array(${foes}))))`;
};
const pickSq = (A, S, nA) => [...A.slice(0, nA).map((x) => x.id), ...S.slice(0, 5 - nA).map((x) => x.id)];
async function dungeon() {
  await ensureHunt();
  const A = ctx.A.filter((a, i, all) => all.findIndex((b) => b.sid === a.sid) === i), S = ctx.S2.filter((x, i, all) => all.findIndex((b) => b.sid === x.sid) === i);
  const mA = Math.floor(A.length / 2), mS = Math.floor(S.length / 2);
  const stun = S.find((x) => x.effect === 'stun'), heal = S.find((x) => x.effect === 'heal');
  const sqs = [['strong 3+2', pickSq(A, S, 3)], ['median 3+2', [...A.slice(mA - 1, mA + 2).map((x) => x.id), ...S.slice(mS, mS + 2).map((x) => x.id)]],
    ['stun and heal 3+2', [...A.slice(mA - 1, mA + 2).map((x) => x.id), ...[stun, heal].filter(Boolean).map((x) => x.id)]]].filter(([, ids]) => new Set(ids).size === 5);
  const els = N.els ? F.passives.e.slice(0, N.els) : F.passives.e, kinds = N.foeKinds, FL = 2;
  const SD = seeds(N.foeSeeds, 4);
  const cells = [];
  for (const el of els) for (const kind of kinds) for (const [sn, ids] of sqs) for (const sd of SD) cells.push({ el, kind, sn, ids, sd });
  const exprs = cells.map((c) => runExpr(c.sd, c.ids, roomFloors(c.kind, c.el, FL, `d${c.el}${c.kind}`), 'script', { max_calls: 250, fight_only: true }));
  const res = await timeIt('dungeon:foes', () => calls('dungeon-foe', exprs));
  const agg = {};
  cells.forEach((c, i) => {
    const r = res[i]; checkRun(`dungeon-foe:${c.el}:${c.kind}:${c.sn}`, r, { fightOnly: true });
    if (!r || r.timeout || r.start_error) return;
    const win = r.stop === 'room_done' || r.ended_by === 'cleared';
    for (const key of [`el:${c.el}`, `kind:${c.kind}`, `sq:${c.sn}`, `kind:${c.kind}|sq:${c.sn}`]) {
      const a = (agg[key] ??= { n: 0, win: 0, loss: [], rounds: [], calls: [] });
      a.n++; a.win += win ? 1 : 0; a.loss.push(1 - r.hp_end / Math.max(1, r.hp_max)); a.rounds.push(r.rounds_max); a.calls.push(r.calls);
    }
  });
  const table = (pfx) => Object.entries(agg).filter(([k]) => k.startsWith(pfx) && !k.includes('|')).map(([k, a]) => ({ key: k.slice(pfx.length), n: a.n, win: r2(a.win / a.n), hp_lost: r2(mean(a.loss)), rounds: r2(mean(a.rounds)) }));
  rep.dungeon = { foe_floor: FL, squads: sqs.map(([n, ids]) => ({ name: n, cards: ids.map((id) => nameOf(id).name), shape: shapeOf(ids) })), by_element: table('el:'), by_kind: table('kind:'), by_squad: table('sq:'),
    by_kind_squad: Object.entries(agg).filter(([k]) => k.includes('|')).map(([k, a]) => ({ key: k, n: a.n, win: r2(a.win / a.n), hp_lost: r2(mean(a.loss)) })) };
  const medWin = median(rep.dungeon.by_element.map((e) => e.win));
  for (const e of rep.dungeon.by_element) if (e.win < medWin - 0.3) find('BALANCE', `dungeon:element_hard:${e.key}`, `the ${e.key} foes are won in ${pct(e.win)} of the fights (median element ${pct(medWin)})`);

  // whole runs with random squads (the real generated day, the Auto button), the shape of the best squad
  const rnd = rng(0xBADA55), pool = F.subjects.filter((s) => s.rarity === 'normal');
  const atkP = pool.filter((s) => s.atk), supP = pool.filter((s) => !s.atk && s.ability?.kind === 'support');
  const pickN = (arr, k) => { const c = [...arr], out = []; while (out.length < k && c.length) out.push(c.splice(Math.floor(rnd() * c.length), 1)[0].id); return out; };
  const runs = [];
  for (let i = 0; i < N.runs; i++) { const k = 1 + Math.floor(rnd() * 4); runs.push({ k, ids: [...pickN(atkP, k), ...pickN(supP, 5 - k)], sd: seeds(1, 10 + i)[0], how: 'random' }); }
  for (const stars of [0, 3]) for (let k = 1; k <= 4; k++) for (let j = 0; j < N.shapeRuns; j++) runs.push({ k, ids: pickSq(A, S, k), sd: seeds(1, 40 + j)[0], how: `best ${stars}-star`, stars });
  const rres = await timeIt('dungeon:runs', () => calls('dungeon-run', runs.map((r) => runExpr(r.sd, r.ids, null, 'auto', { max_calls: 120 }, 'daily', r.stars ? Object.fromEntries(r.ids.map((id) => [id, { asc: r.stars, pts: {} }])) : {}))));
  const byShape = {};
  runs.forEach((r, i) => {
    const x = rres[i]; checkRun(`dungeon-run:${r.how}:${r.k}A:${i}`, x);
    if (!x || x.timeout || x.start_error) return;
    ((byShape[`${r.how} ${r.k}A+${5 - r.k}S`] ??= []).push({ floor: x.floor, room: x.room, calls: x.calls, shards: x.shards, ended: x.ended_by || x.stop }));
  });
  rep.dungeon.runs = Object.entries(byShape).map(([k, v]) => ({ shape: k, n: v.length, floor_mean: r2(mean(v.map((x) => x.floor))), floor_max: Math.max(...v.map((x) => x.floor)), shards_mean: r2(mean(v.map((x) => x.shards))), calls_mean: r2(mean(v.map((x) => x.calls))) }));
  const best = rep.dungeon.runs.filter((x) => x.shape.startsWith('best 3-star')).sort((a, b) => b.floor_mean - a.floor_mean)[0];
  if (best) find('BALANCE', 'dungeon:best_shape', `the Dungeon squad shape that reaches the deepest floor (best cards, 3 stars): ${best.shape}, floor ${best.floor_mean}`);
  log(`dungeon: ${cells.length} room fights, ${runs.length} runs; best shape ${best?.shape}`);
}

// ===== gauntlet ================================================================================================================
async function gauntlet() {
  const SD = seeds(N.gauntRuns, 6);
  const mk = (sd, rich, log_) => runExpr(sd, [], null, 'auto', { max_calls: 120, rich, log: log_ }, 'gauntlet');
  const exprs = [...SD.map((sd) => mk(sd, false, false)), ...SD.slice(0, 2).flatMap((sd) => [mk(sd, true, true), mk(sd, false, true)])];
  const res = await timeIt('gauntlet:runs', () => calls('gauntlet', exprs));
  const runs = res.slice(0, SD.length);
  runs.forEach((r, i) => checkRun(`gauntlet:run:${i}`, r, { gauntlet: true }));
  // the 0-star rule: a member with 5 stars and stat points plays the same fight as a member with none
  const pairs = [];
  for (let i = 0; i < 2 && SD.length + 2 * i + 1 < res.length; i++) {
    const a = res[SD.length + 2 * i], b = res[SD.length + 2 * i + 1];
    if (!a || !b || a.timeout || b.timeout) continue;
    checkRun(`gauntlet:rich:${i}`, a, { gauntlet: true }); checkRun(`gauntlet:bare:${i}`, b, { gauntlet: true });
    const same = a.log === b.log;
    pairs.push({ seed: SD[i], same, calls: a.calls });
    if (!same) find('INVARIANT', `gauntlet:zero_star:${i}`, 'the Gauntlet fight changed with the stars and stat points of the member (the 0-star rule is broken)');
  }
  const ok = runs.filter((r) => r && !r.timeout && !r.start_error);
  rep.gauntlet = { runs: ok.length, floor_mean: r2(mean(ok.map((r) => r.floor))), room_mean: r2(mean(ok.map((r) => r.room))), calls_mean: r2(mean(ok.map((r) => r.calls))), ended: ok.reduce((o, r) => ({ ...o, [r.ended_by || r.stop]: (o[r.ended_by || r.stop] || 0) + 1 }), {}),
    shards_paid: ok.reduce((a, r) => a + r.shards, 0), cards_paid: ok.reduce((a, r) => a + r.cards.length, 0), zero_star_pairs: pairs };
  log(`gauntlet: ${ok.length} runs, floor ${rep.gauntlet.floor_mean}, zero-star pairs ${pairs.map((p) => p.same).join('/')}`);
}

// ===== stats: one stat point, one star =========================================================================================
async function stats() {
  await ensureHunt();
  const ASC = 3, PTS = 5;
  const A = ctx.A, byEff = {};
  for (const a of A) (byEff[a.effect] ??= []).push(a);
  const refs = Object.values(byEff).map((v) => v[Math.floor(v.length / 2)]).slice(0, N.statCards);
  const STATS = ['attack', 'vitality', 'precision', 'potency', 'haste'];
  const S = seeds(N.duel, 5);
  const exprs = [];
  for (const a of refs) for (const st of [null, ...STATS]) exprs.push(`pg_temp.lab_hunt_duel(${a.id}, ${buildsLit({ [a.id]: { asc: ASC, pts: st ? { [st]: PTS } : {} } })}, ${bossLit(STD)}, ${seedLit(S)})`);
  const res = await timeIt('stats:attackers', () => calls('stat-duel', exprs));
  const rows = {}; let i = 0;
  const life = (r) => (r.dmg_sum / Math.max(1, r.n)) * r.hp / Math.max(1, r.loss_sum / Math.max(1, r.n));
  for (const a of refs) {
    const base = res[i++]; checkResult('stat-duel', base, a.name);
    for (const st of STATS) { const r = res[i++]; checkResult('stat-duel', r, a.name);
      (rows[st] ??= []).push({ card: a.name, effect: a.effect, gain: life(r) / life(base) - 1, dmg: (r.dmg_sum / r.n) / (base.dmg_sum / base.n) - 1, hp: r.hp / base.hp - 1, crit: r.crit / r.n - base.crit / base.n }); }
  }
  rep.stat_points = { asc: ASC, points: PTS, attackers: STATS.map((st) => ({ stat: st, per_point: r4(mean(rows[st].map((x) => x.gain)) / PTS), dmg: r4(mean(rows[st].map((x) => x.dmg))), hp: r4(mean(rows[st].map((x) => x.hp))), crit: r4(mean(rows[st].map((x) => x.crit))) })) };
  // which attacker stat is best for each reference card
  const atkStats = ['attack', 'vitality', 'precision'];
  const bestFor = refs.map((_, k) => atkStats.map((st) => [st, rows[st][k].gain]).sort((x, y) => y[1] - x[1])[0][0]);
  rep.stat_points.best_for_attackers = atkStats.map((st) => ({ stat: st, best_for: bestFor.filter((b) => b === st).length, of: refs.length }));
  for (const st of atkStats) {
    const n = bestFor.filter((b) => b === st).length;
    if (refs.length >= 3 && n >= Math.ceil(refs.length * 0.75)) find('BALANCE', `stats:dominant:${st}`, `${st} is the best of the three attacker stats for ${n} of ${refs.length} reference attackers (a stat that is always best is a defect)`);
    const mine = mean(rows[st].map((x) => x.gain)), top = Math.max(...atkStats.map((s) => mean(rows[s].map((x) => x.gain))));
    if (top > 0 && mine < top * 0.4) find('BALANCE', `stats:weak:${st}`, `one point of ${st} is worth ${pct(mine / PTS)} of the life of an attacker, but the best stat gives ${pct(top / PTS)} (it is never worth a point)`);
  }
  for (const st of ['potency', 'haste']) if (Math.abs(mean(rows[st].map((x) => x.gain))) > 0.02) find('BALANCE', `stats:attacker_${st}`, `${st} changes the damage or the life of an attacker (${pct(mean(rows[st].map((x) => x.gain)))}); it should act on supports only`);

  // supports: potency and haste (and vitality, which should do nothing) change the squad damage of the reference fight
  const supRefs = Object.values(ctx.S2.reduce((o, x) => { (o[x.effect] ??= []).push(x); return o; }, {})).map((v) => v[0]).slice(0, N.statCards);
  const SS = seeds(N.statSeeds, 7);
  const sx = [];
  const VAR = [['base', null, 0], ['potency5', 'potency', 5], ['potency15', 'potency', 15], ['haste5', 'haste', 5], ['haste15', 'haste', 15], ['vitality5', 'vitality', 5]];
  for (const s of supRefs) for (const [, st, n] of VAR) for (const sd of SS) sx.push(ctx.fight([...ctx.baseSquad, s.id], sd, STD, { [s.id]: { asc: 5, pts: st ? { [st]: n } : {} } }));
  const sres = await timeIt('stats:supports', () => calls('stat-sup', sx));
  const srows = Object.fromEntries(VAR.slice(1).map(([key]) => [key, []])); let k = 0;
  for (const s of supRefs) {
    const cols = {};
    for (const [key] of VAR) { cols[key] = sres.slice(k, k + SS.length); k += SS.length; cols[key].forEach((r) => checkResult('stat-sup', r, s.name)); }
    const b = mean(cols.base.map((r) => r.dmg_gross));
    for (const [key] of VAR.slice(1)) { const d = cols[key].map((r, j) => r.dmg_gross - cols.base[j].dmg_gross); srows[key].push({ card: s.name, effect: s.effect, gain: b ? mean(d) / b : 0, se: b ? sd(d) / Math.sqrt(d.length) / b : 0 }); }
  }
  rep.stat_points.supports = VAR.slice(1).map(([key, st, n]) => ({ stat: `${st} ${n} points`, per_point: r4(mean(srows[key].map((x) => x.gain)) / n), per_card: srows[key].map((x) => ({ effect: x.effect, gain: r4(x.gain / n), se: r4(x.se / n) })) }));
  // The cooldown that a Haste build gives (combat_cooldown with the haste of card_combat): how many points before a cooldown is one round shorter
  rep.stat_points.haste_table = await sqlRows(`select cd, (select min(p) from generate_series(1, 15) p where combat_cooldown(cd, (card_combat('normal', 5, 1, jsonb_build_object('haste', p))->>'haste')::numeric) < cd) points_for_one_round,
      (select combat_cooldown(cd, (card_combat('normal', 5, 1, jsonb_build_object('haste', 15))->>'haste')::numeric)) cooldown_at_15 from (select distinct (ability->>'cooldown')::int cd from subjects where ability->>'kind' = 'support') z order by cd`);
  for (const h of rep.stat_points.haste_table) if (h.points_for_one_round == null || h.points_for_one_round > 8) find('BALANCE', `stats:haste_threshold:${h.cd}`, `a support with a cooldown of ${h.cd} rounds needs ${h.points_for_one_round ?? 'more than 15'} Haste points before its cooldown is one round shorter (it is rounded to whole rounds)`);
  const pot = mean(srows.potency15.map((x) => x.gain)) / 3, has = mean(srows.haste15.map((x) => x.gain)) / 3;   // 15 points = 3 times the 5-point value
  if (Math.abs(mean(srows.vitality5.map((x) => x.gain))) > 0.03) find('BALANCE', 'stats:support_vitality', 'vitality changes the squad damage of a support card (it should do nothing: a support has the floor HP)');
  if (pot > 0 && has < pot * 0.25) find('BALANCE', 'stats:haste_weak', `15 points of haste add ${pct(has * 3)} squad damage, 15 points of potency add ${pct(pot * 3)} (haste is rarely worth a point)`);
  if (has > 0 && pot < has * 0.25) find('BALANCE', 'stats:potency_weak', `15 points of potency add ${pct(pot * 3)} squad damage, 15 points of haste add ${pct(has * 3)}`);

  // stars: for each rarity, the life of an attacker at 0 to 5 stars (real attacks); the copies that the stars cost (balance ascend_cost)
  const rars = ['normal', 'illustrated_rare', 'full_art', 'secret_rare', 'gold'], medCp = {};
  const starExprs = [], starSpec = [];
  for (const r of rars) {
    const pool = F.cards.filter((c) => c.rarity === r && F.isAtk(c)).sort((x, y) => x.cp_mod - y.cp_mod);
    const mid = Math.floor(pool.length / 2), pick = pool.slice(Math.max(0, mid - Math.floor(N.starCards / 2)), Math.max(0, mid - Math.floor(N.starCards / 2)) + N.starCards);
    for (const c of pick) for (let a = 0; a <= 5; a++) { starSpec.push({ r, c, a }); starExprs.push(`pg_temp.lab_hunt_duel(${c.id}, ${buildsLit({ [c.id]: { asc: a, pts: {} } })}, ${bossLit(STD)}, ${seedLit(seeds(N.duel, 8))})`); }
  }
  const stres = await timeIt('stats:stars', () => calls('stat-star', starExprs));
  const cell = {};
  starSpec.forEach((x, j) => { const r = stres[j]; checkResult('stat-star', r, `${x.c.name} ${x.a} stars`); (cell[`${x.r}:${x.a}`] ??= []).push({ life: life(r), cp: r.cp, hp: r.hp }); });
  const ref0 = mean(cell['normal:0'].map((x) => x.life));
  const cost = F.bal && (await sqlRows(`select value from balance where key = 'ascend_cost'`))[0]?.value || {};
  rep.stars = rars.map((r) => ({ rarity: r, copies_to_5: (cost[r] || []).reduce((a, b) => a + b, 0) || null,
    by_star: [0, 1, 2, 3, 4, 5].map((a) => ({ stars: a, cp: r2(mean(cell[`${r}:${a}`].map((x) => x.cp))), hp: r2(mean(cell[`${r}:${a}`].map((x) => x.hp))), life_vs_normal_0: r2(mean(cell[`${r}:${a}`].map((x) => x.life)) / ref0) })) }));
  for (const r of rep.stars) for (const o of rep.stars) {
    if (r.rarity === o.rarity) continue;
    const r5 = r.by_star[5].life_vs_normal_0, o0 = o.by_star[0].life_vs_normal_0;
    if (r5 < o0 * 0.9 && ['normal', 'illustrated_rare'].includes(o.rarity) === false && rars.indexOf(r.rarity) < rars.indexOf(o.rarity)) find('BALANCE', `stars:cross:${r.rarity}:${o.rarity}`, `a 5-star ${r.rarity} card (${r5}x) is weaker than a 0-star ${o.rarity} card (${o0}x)`);
  }
  log(`stats: ${STATS.map((st) => `${st} ${pct(mean(rows[st].map((x) => x.gain)) / PTS)}/pt`).join(', ')}`);
}

// ===== rewards: each pays once =================================================================================================
async function rewards() {
  await ensureHunt();
  // a Hunt boss with a low HP: the squad defeats it, settle_hunt pays the prizes, and a second settle pays nothing
  const sqs = [ctx.bestSquad?.ids ?? ctx.baseSquad, ctx.baseSquad];
  const S = seeds(N.rewardFights, 9);
  const exprs = []; for (const ids of sqs) for (const sd of S) exprs.push(ctx.fight(ids, sd, { name: 'Lab Boss', tier: 'Normal', hp: 25 }));
  const res = await timeIt('rewards:hunt', () => calls('reward-hunt', exprs));
  let defeated = 0;
  res.forEach((r, i) => {
    checkResult('reward-hunt', r, 'low HP boss');
    if (!r || r.timeout) return;
    if (r.defeated) {
      defeated++;
      if (r.pack_rows !== r.pack_players) find('REWARD', 'reward:hunt_rows', `a Hunt prize paid ${r.pack_rows} rows to ${r.pack_players} members (one row for each member)`);
      if (r.pack_rows_after !== r.pack_rows) find('REWARD', 'reward:hunt_settle_twice', `a second settle_hunt paid ${r.pack_rows_after - r.pack_rows} more rows`);
    }
  });
  rep.rewards = { hunt_fights: res.length, hunt_defeated: defeated, dungeon_checked: 'every Dungeon and Gauntlet run of the Lab (ledger rows against the run, and a second settle)' };
  if (defeated === 0) find('INVARIANT', 'reward:no_defeat', 'the reward check never defeated its low-HP boss, so it checked nothing');
}

// ===== smoke: every card takes part in a fight =================================================================================
async function smoke() {
  await ensureHunt();
  const step = Math.max(1, Math.floor(F.cards.length / N.smoke));
  const cards = F.cards.filter((_, i) => i % step === 0);
  const exprs = cards.map((c) => (F.isAtk(c) ? `pg_temp.lab_hunt_duel(${c.id}, '{}'::jsonb, ${bossLit(STD)}, ${seedLit(seeds(3, 11))})` : `${ctx.fight([...ctx.baseSquad, c.id], 0.31)}`));
  const res = await timeIt('smoke:cards', () => calls('smoke', exprs));
  res.forEach((r, i) => checkResult('smoke', r, cards[i].name));
  const base = await sqlRows(`select count(*) bad from cards c where dungeon_card_base(c.id) is null or (dungeon_card_base(c.id)->'cmb'->>'hp') is null`);
  if (base[0].bad > 0) find('INVARIANT', 'smoke:dungeon_card_base', `dungeon_card_base gives no card or no HP for ${base[0].bad} cards`);
  rep.smoke = { cards: cards.length, of: F.cards.length };
}

// ===== run ======================================================================================================================
const TASKS = { data: secData, hunt: async () => { await ensureHunt(); await squads(); await bosses(); }, dungeon, gauntlet, stats, rewards, smoke };
for (const [name, fn] of Object.entries(TASKS)) if (SECTIONS.has(name)) {
  try { await timeIt(`section ${name}`, fn); } catch (e) { if (!(e instanceof Abort)) throw e; log(`section ${name} stopped: ${e.message}`); rep.aborted = [...(rep.aborted || []), `${name}: ${e.message}`]; }
}
rep.meta.seconds = Math.round((Date.now() - T0) / 1000);

// --- The baseline: LOOP and LOCK findings that Nathan has seen ---------------------------------------------------------------
const known = BASELINE_FILE && existsSync(BASELINE_FILE) ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8')).known ?? {} : {};
const FAIL_CLASSES = new Set(['INVARIANT', 'REWARD', 'COOLDOWN', 'LOOP', 'LOCK']);
for (const f of findings) f.known = ['LOOP', 'LOCK'].includes(f.cls) && f.key in known;
const newFails = findings.filter((f) => FAIL_CLASSES.has(f.cls) && !f.known);
rep.verdict = newFails.length || rep.aborted ? 'FAIL' : 'PASS';

// --- The report -------------------------------------------------------------------------------------------------------------
const md = [];
const table = (rows, cols) => rows.length ? [`| ${cols.map((c) => c[0]).join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${cols.map((c) => c[1](r)).join(' | ')} |`)].join('\n') : '(none)';
md.push(`# Combat Lab report`, '', `Run: ${rep.meta.started}, ${rep.meta.quick ? 'QUICK (sampled)' : 'full'}, ${rep.meta.seconds} s. ${rep.meta.cards} cards, ${rep.meta.subjects} subjects. Verdict: **${rep.verdict}**.`, '',
  `The Lab calls the same SQL functions as real fights. It plays synthetic members (no member data) in undone blocks with fixed seeds.`, '');
md.push('## Findings', '', table([...findings].sort((a, b) => a.cls.localeCompare(b.cls)), [['Class', (f) => f.cls], ['Known', (f) => (f.known ? 'known' : f.cls === 'BALANCE' ? '-' : 'NEW')], ['Finding', (f) => f.msg.replace(/\|/g, '/')]]), '');
if (rep.attackers) {
  const A = rep.attackers;
  md.push('## Hunt: attackers (subject level: the lowest rarity, 0 stars, no stat points)', '',
    `Value = expected damage before the card falls against the standard boss (the damage of one attack times the HP divided by the HP lost to the boss counter in that round), ${N.duel} seeds, 75% at full boss HP and 25% at 20% boss HP.`, '',
    'Top 5:', table(A.slice(0, 5), [['Card', (a) => a.name], ['Rarity', (a) => a.rarity], ['Effect', (a) => a.effect], ['CP', (a) => a.cp], ['HP', (a) => a.hp], ['Value', (a) => r2(a.value)], ['x median', (a) => r2(a.ratio)]]), '',
    'Bottom 5:', table(A.slice(-5), [['Card', (a) => a.name], ['Rarity', (a) => a.rarity], ['Effect', (a) => a.effect], ['CP', (a) => a.cp], ['HP', (a) => a.hp], ['Value', (a) => r2(a.value)], ['x median', (a) => r2(a.ratio)]]), '',
    'By attack effect:', table(rep.attacker_effects, [['Effect', (e) => e.effect], ['Cards', (e) => e.n], ['Mean x median', (e) => e.mean_ratio]]), '');
}
if (rep.supports) {
  const S = rep.supports;
  md.push('## Hunt: supports', '', `Value = the extra damage of the reference squad (3 median attackers) in a fight of at most ${N.rounds} attacks with the support card, against the same squad without it (same seeds, ${N.supSeeds} seeds). "Matched" = the squad has attackers with the support's affinity tag.`, '',
    'Top 5:', table(S.slice(0, 5), [['Card', (a) => a.name], ['Effect', (a) => a.effect], ['Value', (a) => r2(a.value)], ['% of squad damage', (a) => pct(a.pct)], ['Matched %', (a) => pct(a.pct_matched)]]), '',
    'Bottom 5:', table(S.slice(-5), [['Card', (a) => a.name], ['Effect', (a) => a.effect], ['Value', (a) => r2(a.value)], ['% of squad damage', (a) => pct(a.pct)], ['Matched %', (a) => pct(a.pct_matched)]]), '',
    'By effect:', table(rep.support_effects, [['Effect', (e) => e.effect], ['Cards', (e) => e.n], ['Mean % of squad damage', (e) => pct(e.mean_pct)]]), '');
}
if (rep.squads) {
  md.push('## Hunt: the strongest squads', '', `The reference squad (3 median attackers, no support) deals ${rep.squads.reference_damage} damage. Squads of 8 cards, ${N.squadSeeds} seeds.`, '',
    table(rep.squads.top, [['Shape', (q) => q.shape], ['How', (q) => q.how], ['Damage', (q) => r2(q.dmg)], ['x reference', (q) => r2(q.vs_ref)], ['Effects', (q) => q.effects]]), '',
    'Shapes (the best cards for each shape):', table(rep.squads.shapes, [['Shape', (q) => q.shape], ['Damage', (q) => q.dmg], ['x reference', (q) => q.vs_ref], ['HP lost', (q) => q.hp_lost], ['Cards down', (q) => q.downs]]), '',
    'Stacks of one support effect:', table(rep.squads.stacks, [['Squad', (q) => q.how], ['Damage', (q) => q.dmg], ['x reference', (q) => q.vs_ref]]), '');
}
if (rep.bosses) md.push('## Hunt: every boss', '', table(rep.bosses, [['Boss', (b) => b.name], ['Tier', (b) => b.tier], ['Passives', (b) => b.passive.join('+')], ['Best squad dmg', (b) => b['best squad']?.dmg], ['x median', (b) => b['best squad']?.rel], ['Reference dmg', (b) => b['reference squad + 1 support']?.dmg], ['x median', (b) => b['reference squad + 1 support']?.rel]]), '');
if (rep.dungeon) {
  md.push('## Dungeon', '', `Foes at floor ${rep.dungeon.foe_floor}; squads: ${rep.dungeon.squads.map((s) => `${s.name} (${s.shape})`).join(', ')}.`, '', 'By element:', table(rep.dungeon.by_element, [['Element', (e) => e.key], ['Fights', (e) => e.n], ['Won', (e) => pct(e.win)], ['HP lost', (e) => pct(e.hp_lost)], ['Rounds', (e) => e.rounds]]), '',
    'By foe kind:', table(rep.dungeon.by_kind, [['Kind', (e) => e.key], ['Fights', (e) => e.n], ['Won', (e) => pct(e.win)], ['HP lost', (e) => pct(e.hp_lost)], ['Rounds', (e) => e.rounds]]), '',
    'Whole runs (the real generated day, the Auto button):', table(rep.dungeon.runs, [['Squad', (e) => e.shape], ['Runs', (e) => e.n], ['Mean floor', (e) => e.floor_mean], ['Best floor', (e) => e.floor_max], ['Shards', (e) => e.shards_mean], ['Calls', (e) => e.calls_mean]]), '');
}
if (rep.gauntlet) md.push('## Gauntlet', '', `${rep.gauntlet.runs} runs of the real weekly squad: mean floor ${rep.gauntlet.floor_mean}, room ${rep.gauntlet.room_mean}; ended: ${JSON.stringify(rep.gauntlet.ended)}. Shards paid: ${rep.gauntlet.shards_paid}, cards paid: ${rep.gauntlet.cards_paid} (both must be 0). 0-star pairs (a member with 5 stars and stat points against one with none): ${rep.gauntlet.zero_star_pairs.map((p) => (p.same ? 'same' : 'DIFFERENT')).join(', ')}.`, '');
if (rep.stat_points) {
  md.push('## Stat points', '', `Reference build: ${rep.stat_points.asc} stars, ${rep.stat_points.points} points in one stat. Value = the change in the expected damage before the card falls (attackers) or in the squad damage (supports).`, '',
    'Attackers:', table(rep.stat_points.attackers, [['Stat', (s) => s.stat], ['Value per point', (s) => pct(s.per_point)], ['Damage of one attack', (s) => pct(s.dmg)], ['HP', (s) => pct(s.hp)], ['Crit chance', (s) => pct(s.crit)]]), '',
    'Best attacker stat (count of reference cards):', table(rep.stat_points.best_for_attackers, [['Stat', (s) => s.stat], ['Best for', (s) => `${s.best_for} of ${s.of}`]]), '',
    'Supports (% of squad damage for each point):', table(rep.stat_points.supports, [['Stat', (s) => s.stat], ['Value per point', (s) => pct(s.per_point)]]), '',
    'Haste: points before a cooldown is one round shorter (combat_cooldown):', table(rep.stat_points.haste_table, [['Cooldown (rounds)', (h) => h.cd], ['Points for 1 round', (h) => h.points_for_one_round ?? 'more than 15'], ['Cooldown at 15 points', (h) => h.cooldown_at_15]]), '');
}
if (rep.stars) md.push('## Stars', '', 'Life of an attacker (expected damage before it falls) at each star, relative to a 0-star normal card:', '', table(rep.stars, [['Rarity', (r) => r.rarity], ['Copies to 5 stars', (r) => r.copies_to_5 ?? '-'], ...[0, 1, 2, 3, 4, 5].map((a) => [`${a}*`, (r) => r.by_star[a].life_vs_normal_0])]), '');
if (rep.rewards) md.push('## Rewards', '', `Hunt: ${rep.rewards.hunt_defeated} of ${rep.rewards.hunt_fights} low-HP bosses were defeated and settled twice. Dungeon and Gauntlet: ${rep.rewards.dungeon_checked}.`, '');
if (rep.smoke) md.push('## Every card', '', `${rep.smoke.cards} of ${rep.smoke.of} cards played a fight with no broken limit.`, '');
md.push('## Time', '', table(Object.entries(rep.timing).map(([k, v]) => ({ k, v })), [['Step', (r) => r.k], ['Seconds', (r) => r.v]]), '');
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'report.md'), md.join('\n'));
writeFileSync(join(OUT, 'report.json'), JSON.stringify(rep, null, 1));

console.log(`COMBAT LAB ${rep.verdict}: ${findings.length} findings (${newFails.length} new failures), ${rep.meta.seconds} s. Report: ${join(OUT, 'report.md')}`);
for (const c of ['INVARIANT', 'REWARD', 'COOLDOWN', 'LOOP', 'LOCK', 'BALANCE']) {
  const fs_ = findings.filter((f) => f.cls === c);
  if (fs_.length) console.log(`  ${c}: ${fs_.length}${c === 'BALANCE' ? '' : ` (${fs_.filter((f) => f.known).length} known)`}`);
}
for (const f of newFails.slice(0, 12)) console.log(`  FAIL ${f.cls}: ${f.msg}  [${f.key}]`);
if (rep.aborted) console.log(`  STOPPED: ${rep.aborted.join('; ')}`);
if (newFails.length || rep.aborted) process.exitCode = 1;
