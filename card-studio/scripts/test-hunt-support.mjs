/**
 * Test a hunt_support definition against the live DB with NO lasting change:
 *   node scripts/test-hunt-support.mjs [file-with-CREATE-hunt_support.sql]
 *   Without a file it tests the CURRENT hunt_support (test-all-local.mjs runs this mode).
 *   MUTATE=revive|fullheal|shield node scripts/test-hunt-support.mjs   must FAIL.
 * One DO block: apply it, make a test boss + member, check heal/shield sizes and that a
 * heal never revives a downed card, then RAISE the results (everything rolls back).
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { GATE, mutation } from './fixtures.mjs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const mig = process.argv[2] ? readFileSync(process.argv[2], 'utf8') : '';
const SUP = 'public.hunt_support(text,bigint,bigint,bigint)';
const MUT = mutation({
  revive: [SUP, 'and card_id = p_target and hit_date = v_day and downed) then', 'and false) then'],
  fullheal: [SUP, "least(max_hp, hp_remaining + combat_support_value('heal', v_amt, 1, max_hp)::int)", 'max_hp'],
  shield: [SUP, "shield + combat_support_value('shield', v_amt, 1, max_hp)::int", 'shield + 60'],
});
const body = String.raw`do $t$ declare h bigint; heal bigint; shl bigint; tgt bigint; pk bigint; r jsonb; res jsonb := '[]'; v int;
begin
  ${mig ? `execute $m$${mig}$m$;` : '-- the current hunt_support'}
  ${MUT}
  insert into hunts (name, tier, weak_points, resist_points, hp_max, hp_remaining, closes_at) values ('Test Boss', 'Normal', '[]', '[]', 5000, 5000, now() + interval '1 day') returning id into h;
  select c.id into heal from cards c join subjects s on s.id=c.subject_id where s.key='zeoic-s-redstone-machine' and c.rarity::text='normal' limit 1;
  select c.id into shl from cards c join subjects s on s.id=c.subject_id where s.ability->>'effect'='shield' and c.rarity::text='normal' limit 1;
  select c.id into tgt from cards c join subjects s on s.id=c.subject_id where s.tags->>'class'='attacker' and not ('origin:pokemon' = any(s.tag_slugs)) and c.rarity::text='normal' and card_max_hp(card_power('normal',0,s.cp_mod))=card_max_hp(0) limit 1;
  select c.id into pk from cards c join subjects s on s.id=c.subject_id where s.tags->>'class'='attacker' and 'origin:pokemon' = any(s.tag_slugs) and c.rarity::text='normal' and card_max_hp(card_power('normal',0,s.cp_mod))=card_max_hp(0) limit 1;
  insert into players (id, username) values ('tst_heal','tst heal');
  insert into player_cards (player_id, card_id, quantity) values ('tst_heal',heal,1),('tst_heal',shl,1),('tst_heal',tgt,1),('tst_heal',pk,1);
  ${GATE('tst_heal')}
  -- heal a 30-HP card at 5 HP: 30% of 30 = 9 -> 14
  perform hunt_commit_card(h, 'tst_heal', tgt, (now() at time zone 'America/Denver')::date, 30); -- the MT game day (mt_clock.sql)
  update hunt_card_hp set hp_remaining = 5 where player_id='tst_heal' and card_id=tgt;
  r := hunt_support('tst_heal', h, heal, tgt);
  select hp_remaining into v from hunt_card_hp where player_id='tst_heal' and card_id=tgt;
  res := res || jsonb_build_object('case','heal = 30% of max HP (5 -> 14), not full','ok', (r->>'ok')::boolean and v = 14, 'hp', v, 'r', r);
  -- shield: 40% of 30 = 12
  r := hunt_support('tst_heal', h, shl, tgt);
  select shield into v from hunt_card_hp where player_id='tst_heal' and card_id=tgt;
  res := res || jsonb_build_object('case','shield = 40% of max HP (+12)','ok', v = 12, 'shield', v, 'r', r);
  -- affinity match (a Pokemon card): 54% of 30 = 16
  perform hunt_commit_card(h, 'tst_heal', pk, (now() at time zone 'America/Denver')::date, 30); -- the MT game day (mt_clock.sql)
  update hunt_card_hp set hp_remaining = 2 where player_id='tst_heal' and card_id=pk;
  update hunt_combat_state set round = round + 5 where player_id='tst_heal'; -- past the heal cooldown
  r := hunt_support('tst_heal', h, heal, pk);
  select hp_remaining into v from hunt_card_hp where player_id='tst_heal' and card_id=pk;
  res := res || jsonb_build_object('case','matched heal = 54% (2 -> 18)','ok', v = 18, 'hp', v, 'r', r);
  -- a downed card is not revived
  update hunt_card_hp set hp_remaining = 0, downed = true where player_id='tst_heal' and card_id=tgt;
  update hunt_combat_state set round = round + 5 where player_id='tst_heal';
  r := hunt_support('tst_heal', h, heal, tgt);
  select hp_remaining into v from hunt_card_hp where player_id='tst_heal' and card_id=tgt;
  res := res || jsonb_build_object('case','a heal does not revive a downed card','ok', r->>'error' = 'target_downed' and v = 0, 'r', r);
  res := res || jsonb_build_object('case','ability amounts are fractions now','ok',
    (select bool_and((ability->>'amount')::numeric < 1) from subjects where ability->>'effect' in ('heal','shield')), 'r', null);
  raise exception 'RES %', res;
end $t$;`;
const out = JSON.stringify(await q(body)); const m = out.match(/RES (\[.*\])/);
if (!m) { console.log(out.slice(0, 1500)); process.exitCode = 1; }
else { const rs = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\n.*$/, '')); let f = 0; for (const x of rs) { if (!x.ok) f++; console.log(`${x.ok ? 'PASS' : 'FAIL'}  ${x.case}${x.ok ? '' : '  ' + JSON.stringify(x)}`); } process.exitCode = f ? 1 : 0; }
console.log('after:', JSON.stringify(await q(`select (select count(*) from players where id='tst_heal') test_player, (select ability->>'amount' from subjects where key='zeoic-s-redstone-machine') live_amount`)));
