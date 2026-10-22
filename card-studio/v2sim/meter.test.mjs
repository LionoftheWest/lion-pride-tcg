import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './util.mjs';
import { meterChecks, dummyCard, mini } from './checks.mjs';
import { makeBoss } from './modes.mjs';
const cfg = loadConfig();
for (const c of meterChecks(cfg)) test(`meter ${c.id}: ${c.what}`, () => assert.ok(c.ok, `expect ${c.expect}, got ${c.got}`));

// The action limit counts for EACH unit (SQL combat_v2_advance): the Hydra's New Head (extra_action, meter + 100) chains, and the Hydra acts
// at most max_actions_per_step times in one step. Before 2026-10-21 the simulator limited ALL units together (units x max_actions_per_step),
// so the Hydra acted 6 times in step 1 here (New Head on turns 1 to 6). SQL = the simulator action by action: test-combat-v2-e7-followup.mjs.
test('meter max_actions: a Hydra that only uses New Head acts at most max_actions_per_step times in each step, and reaches it', () => {
  const maxA = cfg.v2_speed.max_actions_per_step;
  const boss = makeBoss(cfg, 'Heroic', { boss: 'hydra' });
  const tank = (o) => dummyCard(cfg, { maxHp: 1e6, hp: 1e6, speedBase: 20, ...o });
  const b = mini(cfg, [tank(), tank()], [boss], { mode: 'hunt', cap: 6 });
  const h = b.enemies[0]; h.counterShare = 1; h.moves2 = h.moves2.filter((m) => m.id === 'new_head'); h.turn = 1; h.meter = 0;
  assert.equal(h.moves2.length, 1, 'the Hydra has a New Head move');
  const per = {}; const act0 = b.act.bind(b);
  b.act = (u) => { const k = `${b.step}:${u.side}${u.idx}`; per[k] = (per[k] || 0) + 1; act0(u); };
  b.run();
  const hydra = Object.entries(per).filter(([k]) => k.endsWith(`enemy${h.idx}`)).map(([, n]) => n);
  assert.ok(Object.values(per).every((n) => n <= maxA), `a unit acted more than ${maxA} times in one step: ${JSON.stringify(per)}`);
  assert.ok(hydra.includes(maxA), `the Hydra never reached ${maxA} actions in one step: ${JSON.stringify(per)}`);
});
