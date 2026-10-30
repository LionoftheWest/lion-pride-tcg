// targets.mjs - the tuning targets of 2026-10-18 (Nathan approved the 6 recommendations).
// One command measures every target: node card-studio/v2sim/run.mjs targets [--runs N] [--tag name]
// Returns { md, head, data } (data = the numbers, for before/after tables). PROTOTYPE ESTIMATES.
import { cardPool, pickCards, makeCard, templatesOf, templateFor, ATTACKER_ROLES, SUPPORT_ROLES, ROLES } from './cards.mjs';
import { loadSets, withSet1, subjects } from './teams.mjs';
import { buildSquad, huntDay, makeFoe, setFoeMech } from './modes.mjs';
import { Battle } from './engine.mjs';
import { POLICIES } from './policy.mjs';
import { allChecks } from './checks.mjs';
import { ARCHETYPES, speed, huntMany, dungeonMany, clearRate, randRoles, strength, dngPick, HUNT_ROLES, DNG_ROLES, PROTO } from './experiments.mjs';
import { mkRng, hash, mean, median, table, fmt, pct, ratio } from './util.mjs';

export const CLEAR_THRESHOLD = 0.70;

/** The card pool of a Set 1 / Set 1 + Set 2 run: the fixture cards of the batch with their own active (template s1.<key>) and their batch role, the other fixture cards
 * with the placeholder template that the placeholder run gives them, and each Set 2 card (a synthetic subject, teams.mjs loadSet2Batch) with a pullable finish. */
export function setPool(cfg, S) {
  const tpl = (role) => templatesOf(cfg, role).filter((t) => !t.startsWith('s1.'));
  const base = cardPool(cfg).map((p) => (S[p.key] ? { ...p, role: S[p.key].role, template: `s1.${p.key}` } : { ...p, template: tpl(p.role)[hash('template', p.key) % tpl(p.role).length] }));
  const have = new Set(base.map((p) => p.key)); const subj = subjects(cfg);
  const add = Object.keys(S).sort().filter((k) => !have.has(k)).map((k) => { const s = subj.get(k); return { key: k, name: s.name, type: s.type, cp_mod: s.cp_mod, role: S[k].role, traits: [], finishes: s.finishes.map((f) => f.rarity), pullable: s.finishes.filter((f) => f.pool).map((f) => f.rarity), template: `s1.${k}` }; });
  return [...base, ...add];
}

/** set1 / set2: the pool holds the real actives of the private batch (Set 1) or of Set 1 + Set 2 (set2); the roles, the shapes and the archetypes keep the placeholder templates. */
export function targets(cfg0, { runs = 200, seed = 1, set1, set2 } = {}) {
  const S = set1 || set2 ? (set1 && set1 !== true ? set1 : loadSets({ set2 })) : null; const cfg = S ? withSet1(cfg0, S) : cfg0;
  const tplOf = (role) => templatesOf(cfg, role).filter((t) => !S || !t.startsWith('s1.'));
  const pool = S ? setPool(cfg, S) : cardPool(cfg); const head = []; const D = {}; const rows = [];
  const thr = CLEAR_THRESHOLD; const ok = b => (b ? 'PASS' : 'FAIL');
  const A = cfg.v2_investment.active, Cs = cfg.v2_investment.casual;

  // 1 end gap, 2 main content
  const hN = huntMany(cfg, rng => buildSquad(cfg, pickCards(cfg, pool, HUNT_ROLES, 'normal', rng, A)), runs, hash(seed, 't1h'), { tier: 'Heroic' });
  const hG = huntMany(cfg, rng => buildSquad(cfg, pickCards(cfg, pool, HUNT_ROLES, 'gold', rng, A)), runs, hash(seed, 't1h'), { tier: 'Heroic' });
  const dv = {};
  for (const inv of ['casual', 'active']) for (const r of ['normal', 'gold'])
    dv[`${inv}|${r}`] = dungeonMany(cfg, rng => buildSquad(cfg, pickCards(cfg, pool, DNG_ROLES, r, rng, cfg.v2_investment[inv])), runs, hash(seed, 't1d', inv, r)).fl;
  D.huntGap = mean(hG.dealt) / mean(hN.dealt); D.dngGap = mean(dv['active|gold']) / mean(dv['active|normal']);
  D.huntDealt = { normal: mean(hN.dealt), gold: mean(hG.dealt) };
  D.nActive5 = clearRate(dv['active|normal'], 5); D.nCasual3 = clearRate(dv['casual|normal'], 3);
  D.gActive5 = clearRate(dv['active|gold'], 5); D.gCasual3 = clearRate(dv['casual|gold'], 3);
  D.floors = Object.fromEntries(Object.entries(dv).map(([k, v]) => [k, +mean(v).toFixed(2)]));
  rows.push(['1 end gap: Hunt dealt a day, Gold / Normal (active)', 'x2.0-2.5', `${ratio(D.huntGap)} (${fmt(D.huntDealt.gold)} vs ${fmt(D.huntDealt.normal)})`, ok(D.huntGap >= 2 && D.huntGap <= 2.5)]);
  rows.push(['1 end gap: Dungeon floors, Gold / Normal (active)', 'x2.0-2.5', `${ratio(D.dngGap)} (${fmt(D.floors['active|gold'])} vs ${fmt(D.floors['active|normal'])} floors)`, ok(D.dngGap >= 2 && D.dngGap <= 2.5)]);
  rows.push(['2 Normal active clears floor 5', `>= ${pct(thr, 0)}`, pct(D.nActive5, 0), ok(D.nActive5 >= thr)]);
  rows.push(['2 Normal casual clears floor 3', `>= ${pct(thr, 0)}`, pct(D.nCasual3, 0), ok(D.nCasual3 >= thr)]);
  rows.push(['2 Gold faster / higher (floors: casual, active)', 'Gold > Normal', `${fmt(D.floors['casual|gold'])} vs ${fmt(D.floors['casual|normal'])}, ${fmt(D.floors['active|gold'])} vs ${fmt(D.floors['active|normal'])}`, ok(D.floors['casual|gold'] > D.floors['casual|normal'] && D.floors['active|gold'] > D.floors['active|normal'])]);

  // 3 shapes
  const H = [[8, 0], [7, 1], [6, 2], [5, 3], [4, 4], [3, 5], [2, 6], [1, 7]], DS = [[5, 0], [4, 1], [3, 2], [2, 3], [1, 4]];
  D.shapes = {};
  for (const inv of ['casual', 'active']) {
    const I = cfg.v2_investment[inv];
    const hv = H.map(([a, s]) => mean(huntMany(cfg, rng => buildSquad(cfg, pickCards(cfg, pool, [...randRoles(rng, ATTACKER_ROLES, a), ...randRoles(rng, SUPPORT_ROLES, s)], 'normal', rng, I)), runs, hash(seed, 't3h', inv, a), { tier: 'Heroic' }).net));
    const best = Math.max(...hv), bi = hv.indexOf(best), band = hv.slice(2, 6).map(v => v / best);
    D.shapes[`hunt|${inv}`] = hv.map(v => +(v / best).toFixed(3));
    rows.push([`3 Hunt shapes, ${inv}: 6A+2S..3A+5S vs the best (${H[bi][0]}A+${H[bi][1]}S)`, '>= x0.85', `${ratio(Math.min(...band))} (8A..1A+7S: ${hv.map(v => (v / best).toFixed(2)).join(' ')})`, ok(Math.min(...band) >= 0.85)]);
    const dd = DS.map(([a, s]) => mean(dungeonMany(cfg, rng => buildSquad(cfg, pickCards(cfg, pool, [...randRoles(rng, ATTACKER_ROLES, a), ...randRoles(rng, SUPPORT_ROLES, s)], 'normal', rng, I)), runs, hash(seed, 't3d', inv, a)).fl));
    const bd = Math.max(...dd), bandD = dd.slice(0, 4).map(v => v / bd);
    D.shapes[`dng|${inv}`] = dd.map(v => +(v / bd).toFixed(3));
    rows.push([`3 Dungeon shapes, ${inv}: 5A..2A+3S vs the best`, '>= x0.85', `${ratio(Math.min(...bandD))} (5A..1A+4S: ${dd.map(v => (v / bd).toFixed(2)).join(' ')})`, ok(Math.min(...bandD) >= 0.85)]);
  }

  // archetypes (4, 5, 7)
  const mk = t => makeCard(cfg, { key: t, role: t.split('.')[0], rarity: 'normal', template: t, ...Cs });
  const ar = {};
  for (const [name, X] of Object.entries(ARCHETYPES)) {
    const sq = X.hunt.map(mk);
    ar[name] = { n: mean(huntMany(cfg, () => sq, runs, hash(seed, 'arch'), { tier: 'Heroic', sigs: [] }).net),
      c: X.counter.length ? mean(huntMany(cfg, () => sq, runs, hash(seed, 'arch'), { tier: 'Heroic', sigs: X.counter }).net) : null };
  }
  const med = median(Object.entries(ar).filter(([n]) => !n.startsWith('Neutral')).map(([, r]) => r.n));
  D.arch = Object.fromEntries(Object.entries(ar).map(([n, r]) => [n, { vsMedian: +(r.n / med).toFixed(3), counter: r.c === null ? null : +(r.c / r.n).toFixed(3) }]));
  const ch = allChecks(cfg0); const nolock = ch.find(c => c.id === 'control.nolock');
  rows.push(['4 Lockdown vs the median archetype (Hunt)', 'rises toward x1.0', ratio(D.arch.Lockdown.vsMedian), D.arch.Lockdown.vsMedian >= 0.8 ? 'PASS' : 'CHECK']);
  rows.push(['4 no permanent lock (all 4 controls every step, Hunt boss)', `skipped ${nolock.expect}`, String(nolock.got), ok(nolock.ok)]);
  const lk = ARCHETYPES.Lockdown.hunt.map(mk); let sk = 0, tt = 0;
  for (let i = 0; i < runs; i++) { const b = huntDay(cfg, lk, { tier: 'Heroic', sigs: [], seed: hash(seed, 'lk', i) }).b; sk += b.S.controlSkips; tt += b.S.enemyTurns; }
  D.lockSkip = sk / tt;
  rows.push(['4 Lockdown squad: boss turns skipped (Hunt Heroic)', 'below 1 / (1 + immunity)', pct(D.lockSkip, 1), ok(D.lockSkip < 1 / (1 + cfg.v2_control.boss_immune))]);
  rows.push(['5 Cleave vs the median archetype (Hunt)', '<= x1.15', ratio(D.arch.Cleave.vsMedian), ok(D.arch.Cleave.vsMedian <= 1.15)]);
  // Cleaver horde edge: the same 5-card Neutral Dungeon squad, with a Cleaver (Cleave) in place of its Striker.
  const room = (list, kind, n, fl) => { let won = 0, steps = 0, hp = 0;
    for (let i = 0; i < runs; i++) { const rng = mkRng(hash(seed, 'room', kind, fl, i)); const foes = Array.from({ length: n }, () => { return setFoeMech(makeFoe(cfg, fl, 3, kind, rng), []); });
      const b = new Battle(cfg, { cards: list.map(mk), enemies: foes, mode: 'dungeon', policy: POLICIES.best, seed: hash(seed, 'room', i) }).run();
      if (b.ended === 'won') { won++; steps += b.step; } hp += b.cards.reduce((s, c) => s + c.hp / c.maxHp, 0) / b.cards.length; }
    return { win: won / runs, steps: won ? steps / won : NaN, hp: hp / runs }; };
  const NEU = ['striker.lockon', 'breaker.crush', 'finisher.execute', 'warden.shield', 'herald.empower'], CLV = ['cleaver.cleave', ...NEU.slice(1)];
  D.horde = {}; for (const [kind, n, fl] of [['horde', 4, 5], ['horde', 4, 7], ['guardian', 1, 5]]) D.horde[kind + fl] = { cleave: room(CLV, kind, n, fl), neutral: room(NEU, kind, n, fl) };
  const hs = h => `with Cleaver ${pct(h.cleave.win, 0)} win, ${fmt(h.cleave.steps)} steps, ${pct(h.cleave.hp, 0)} HP left. With Striker ${pct(h.neutral.win, 0)}, ${fmt(h.neutral.steps)} steps, ${pct(h.neutral.hp, 0)} HP`;
  rows.push(['5 Cleaver horde edge, floor 5 horde (4 foes)', 'Cleaver squad wins faster', hs(D.horde.horde5), ok(D.horde.horde5.cleave.steps < D.horde.horde5.neutral.steps && D.horde.horde5.cleave.win >= D.horde.horde5.neutral.win - 0.02)]);
  rows.push(['5 Cleaver horde edge, floor 7 horde (4 foes)', 'Cleaver squad wins more', hs(D.horde.horde7), ok(D.horde.horde7.cleave.win > D.horde.horde7.neutral.win)]);
  rows.push(['5 Cleaver vs one big foe (floor 5 guardian)', 'info (no edge expected)', hs(D.horde.guardian5), '-']);

  // 6 role values
  const off = c => { const cx = 1 + c.crit * (c.critx - 1), hit = 1 - Math.max(0, cfg.v2_hit.miss + 0.04 - c.acc); const sp = c.speedBase * Math.min(c.spdMult, cfg.v2_speed.safety_max_x);
    return c.cls === 'attacker' ? c.cp * cx * hit * sp * (1 + 0.25 * (c.abl - 1)) : (cfg.v2_support.basic_x * c.cp * cx * hit + 25 * c.power * c.abl * cx) * sp; };
  const sur = c => c.maxHp / (1 - c.def) / (1 - 0.7 * c.ddg);
  const rv = {}, tv = {}, kr = {};
  for (const role of ROLES) {
    const vals = tplOf(role).map(t => { const c = makeCard(cfg, { key: t, role, rarity: 'normal', template: t, stars: 2, level: 15 }); const v = strength(cfg, c, runs * 3, hash(seed, 'rv', role)); tv[t] = v; return [v, off(c) * sur(c)]; });
    rv[role] = mean(vals.map(x => x[0])); kr[role] = rv[role] / mean(vals.map(x => x[1]));
  }
  const mR = mean(Object.values(rv)), mK = mean(Object.values(kr));
  D.roleValue = Object.fromEntries(ROLES.map(r => [r, +(rv[r] / mR).toFixed(3)]));
  D.roleK = Object.fromEntries(ROLES.map(r => [r, +(kr[r] / mK).toFixed(3)]));
  D.tmpl = Object.fromEntries(Object.entries(tv).map(([t, v]) => [t, +(v / rv[t.split('.')[0]]).toFixed(3)]));
  const inR = Object.values(D.roleValue).every(x => x >= 0.85 && x <= 1.15), inK = Object.values(D.roleK).every(x => x >= 0.85 && x <= 1.15);
  rows.push(['6 role value (card + 4 reference cards, Hunt) / mean of the roles', '0.85-1.15', ROLES.map(r => `${r} ${fmt(D.roleValue[r], 2)}`).join(', '), ok(inR)]);
  rows.push(['6 role scale k (value / analytic value) / mean', '0.85-1.15', ROLES.map(r => `${r} ${fmt(D.roleK[r], 2)}`).join(', '), ok(inK)]);
  rows.push(['6 Envenom / Controller mean', '<= x1.20', ratio(D.tmpl['controller.envenom']), ok(D.tmpl['controller.envenom'] <= 1.2)]);
  rows.push(['6 Artillery basic attack, smite price', 'basic 0.25, price up', `basic ${cfg.v2_roles.artillery.basic_x}, smite ${cfg.v2_pp.support_pp.smite} PP per 1.0 CP`, ok(cfg.v2_roles.artillery.basic_x <= 0.25 && cfg.v2_pp.support_pp.smite > 3)]);
  const tvs = Object.values(D.tmpl);
  rows.push(['6 template value inside its role', 'info', `${ratio(Math.min(...tvs))} to ${ratio(Math.max(...tvs))}`, '-']);

  // 7 silver bullet, counters, speed, checks
  const silver = Object.entries(D.arch).filter(([n, r]) => !n.startsWith('Neutral') && r.vsMedian > 1.3 && (r.counter === null || r.counter > 0.9)).map(([n]) => n);
  const notCut = Object.entries(D.arch).filter(([, r]) => r.counter !== null && r.counter >= 1).map(([n]) => n);
  rows.push(['7 silver bullet (> x1.30 the median AND its counter cuts < 10%)', 'none', silver.join(', ') || 'none', ok(!silver.length)]);
  rows.push(['7 every counter boss cuts its archetype', 'counter < x1.00', Object.entries(D.arch).filter(([, r]) => r.counter !== null).map(([n, r]) => `${n} ${ratio(r.counter)}`).join(', '), ok(!notCut.length)]);
  rows.push(['7 archetypes vs the median (Hunt)', 'info', Object.entries(D.arch).map(([n, r]) => `${n} ${ratio(r.vsMedian)}`).join(', '), '-']);
  const sp = speed(cfg0, { runs: Math.ceil(runs * 1.5), seed }); const m = sp.head[0].match(/for (\d+) of (\d+) roles on a neutral boss/);
  D.spdBest = m ? +m[1] : null;
  rows.push(['7 Speed not dominant: roles where +10 SPD is the best stat (neutral boss)', '<= 2 of 8', `${D.spdBest} of 8`, ok(D.spdBest !== null && D.spdBest <= 2)]);
  const fails = ch.filter(c => !c.ok).map(c => c.id); D.checks = { total: ch.length, fail: fails };
  rows.push(['7 status, meter and formula checks', 'all PASS', `${ch.length - fails.length} of ${ch.length}${fails.length ? ' (FAIL ' + fails.join(', ') + ')' : ''}`, ok(!fails.length)]);

  const md = `# Tuning targets${S ? ` (pool: the real actives of Set 1${Object.values(S).some((a) => a.set === 2) ? ' + Set 2' : ''}; ${Object.keys(S).length} cards, ${pool.length} in the pool; roles and counts only)` : ''}\n\n${PROTO}\n${runs} runs a cell, seed ${seed}. Clear-rate threshold: ${pct(thr, 0)} of the runs.\n\n` + table(['target', 'goal', 'measured', 'result'], rows);
  for (const r of rows) if (r[3] === 'FAIL' || r[3] === 'CHECK') head.push(`${r[3]}: ${r[0]} = ${r[2]}`);
  head.push(`${rows.filter(r => r[3] === 'PASS').length} PASS, ${rows.filter(r => r[3] === 'FAIL').length} FAIL, ${rows.filter(r => r[3] === 'CHECK').length} CHECK.`);
  return { md, head, data: D, rows };
}
