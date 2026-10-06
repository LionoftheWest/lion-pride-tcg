/**
 * effects_spread.sql (2026-10-03): the spread of boons and pranks (max 5 subjects per effect type) and
 * the new Discord pranks. Rolled back (the result comes back in the exception):
 *   node scripts/test-effects-spread.mjs [--old]
 * --old: run the same cases WITHOUT the migration (the baseline must fail).
 * Needs effects_outside.sql (PR #144) on the database first. Each case runs in its own sub-block.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const OLD = process.argv.includes('--old');
const mig = OLD ? '' : readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/effects_spread.sql', import.meta.url)), 'utf8')
  .replace(/notify pgrst[^\n]*\n/g, '');
if (mig.includes('$m$')) throw new Error('the migration must not contain $m$');
const P = 'tst_es';
const C = (name, body) => `
  begin
${body}
  exception when others then
    res := res || jsonb_build_object('case', ${`'${name.replace(/'/g, "''")}'`}, 'ok', false, 'r', 'error: ' || sqlerrm);
  end;`;
const NEW = `array['slowmode', 'hot_take_poll', 'body_swap', 'parrot', 'spongebob']`;
const body = String.raw`do $t$
declare res jsonb := '[]'; r jsonb; ok boolean; n int; e record; before jsonb; c bigint;
begin
  -- Every subject's ability and tags before the migration (they must not change).
  select jsonb_object_agg(key, jsonb_build_object('ability', ability, 'tags', tags)) into before from subjects;
  -- The first-apply state: live enabled some of the 5 pranks after the deploy (2026-10-05), and a row that
  -- exists keeps its "enabled", so the migration's fail-closed start is checked from a disabled row.
  update effect_primitives set enabled = false where primitive = any(${NEW});
  ${mig ? 'execute $m$' + mig + '$m$;' : ''}
  perform set_config('tcg.skip_welcome', 'on', true);
  insert into players (id, username) select '${P}_' || x, 'tst es ' || x from unnest(array['a', 'b', 'c', 'd', 'e', 'f']) x;

${C('no effect type is on more than 5 subjects', `
    select coalesce(jsonb_agg(jsonb_build_array(p, cnt)), '[]') into r from (select effect->>'primitive' p, count(*) cnt from subjects
      where effect is not null group by 1 having count(*) > 5) x;
    res := res || jsonb_build_object('case', 'no effect type is on more than 5 subjects', 'ok', jsonb_array_length(r) = 0, 'over', r);`)}

${C('every effect subject has a unique effect name and a description', `
    select coalesce(jsonb_agg(name), '[]') into r from (select effect->>'name' name from subjects where effect is not null
      group by 1 having count(*) > 1) x;
    select count(*) into n from subjects where effect is not null and (coalesce(trim(effect->>'desc'), '') = '' or coalesce(trim(effect->>'name'), '') = '');
    res := res || jsonb_build_object('case', 'every effect subject has a unique effect name and a description', 'ok', jsonb_array_length(r) = 0 and n = 0,
      'dup_names', r, 'no_text', n);`)}

${C('the 5 new Discord pranks exist and start DISABLED', `
    select count(*) into n from effect_primitives where primitive = any(${NEW}) and kind = 'prank' and channel = 'discord' and not enabled
      and (primitive, coalesce(max_amount, -1), max_duration_s) in (('slowmode', 45, 300), ('hot_take_poll', -1, 3600), ('body_swap', -1, 3600),
                                                                   ('parrot', -1, 172800), ('spongebob', -1, 172800));
    select coalesce(jsonb_agg(jsonb_build_array(primitive, kind, channel, max_amount, max_duration_s, enabled)), '[]') into r from effect_primitives where primitive = any(${NEW});
    res := res || jsonb_build_object('case', 'the 5 new Discord pranks exist and start DISABLED', 'ok', n = 5, 'r', r);`)}

${C('the cards Nathan decided: slowmode, 1-min timeout, parrot, spongebob, Discord spotlight, mustache kept, name swap, no hijack', `
    select count(*) into n from subjects s join (values
      ('Australian Connections', 'slowmode', 'Lag Spike'), ('Bonzan''s Donkey Kong', 'timeout', 'Speechless'),
      ('Call of Dragons', 'parrot', 'World Chat'), ('Lorcana Prices', 'spongebob', 'Go Back to Pokemon'),
      ('Baego', 'spotlight_role', 'Better Side'), ('Beetle''s Cloud', 'mustache', 'Grown-Up Stache'),
      ('Krool Name Swap', 'body_swap', 'Name Swap'), ('Fluffy''s REPO Clutch', 'cleanse', 'Clutch Save'),
      ('B Button Spam', 'ping_parade', 'B...B...B...'), ('Shave your Head', 'streak_shield', 'Streak Shield')) v(name, prim, ename)
      on s.name = v.name and s.effect->>'primitive' = v.prim and s.effect->>'name' = v.ename;
    ok := n = 10
      and (select bool_and(jsonb_array_length(effect->'options'->'polls') between 3 and 4) from subjects where effect->>'primitive' = 'hot_take_poll')
      and (select (effect->'base'->>'duration_s')::int = 60 from subjects where name = 'Bonzan''s Donkey Kong')
      and (select (effect->'base'->>'duration_s')::int = 300 and (effect->'base'->>'amount')::int = 30 from subjects where name = 'Australian Connections')
      and not exists (select 1 from subjects where effect->>'primitive' = 'hijack');
    res := res || jsonb_build_object('case', 'the cards Nathan decided: slowmode, 1-min timeout, parrot, spongebob, Discord spotlight, mustache kept, name swap, no hijack', 'ok', ok, 'n', n);`)}

${C('Raid Crasher text: the extra damage counts for the prankster, not the target', `
    res := res || jsonb_build_object('case', 'Raid Crasher text: the extra damage counts for the prankster, not the target', 'ok',
      (select effect->>'desc' ~* 'prankster' and effect->>'desc' ~* 'not for the target' from subjects where name = 'Launch Day Raider'),
      'desc', (select effect->>'desc' from subjects where name = 'Launch Day Raider'));`)}

${C('the word is Hunt: no effect text says raid (Nathan, 2026-10-03)', `
    select coalesce(jsonb_agg(name), '[]') into r from subjects where effect->>'desc' ~* '\\mraid\\M';
    res := res || jsonb_build_object('case', 'the word is Hunt: no effect text says raid (Nathan, 2026-10-03)', 'ok',
      jsonb_array_length(r) = 0 and (select effect->>'desc' ~ 'next 3 Hunt attacks' from subjects where name = 'Launch Day Raider'), 'raid', r);`)}

${C('every effect uses a known type; abilities and tags did not change', `
    select count(*) into n from subjects s where s.effect is not null and not exists (select 1 from effect_primitives p where p.primitive = s.effect->>'primitive');
    ok := n = 0 and not exists (select 1 from subjects where jsonb_build_object('ability', ability, 'tags', tags) is distinct from before->key);
    res := res || jsonb_build_object('case', 'every effect uses a known type; abilities and tags did not change', 'ok', ok, 'unknown', n);`)}

${C('fail closed: a play of a disabled new prank is refused and writes nothing', `
    select c2.id into c from cards c2 join subjects s on s.id = c2.subject_id where s.name = 'Australian Connections' order by c2.id limit 1;
    insert into player_cards (player_id, card_id, quantity) values ('${P}_a', c, 1);
    r := play_card_effect('${P}_a', c, '${P}_b');
    ok := r->>'error' = 'effect_disabled' and not exists (select 1 from discord_effects where target_id = '${P}_b');
    res := res || jsonb_build_object('case', 'fail closed: a play of a disabled new prank is refused and writes nothing', 'ok', ok, 'r', r);`)}

${C('enabled: slowmode = a Discord row for 5 min (gap 30 s); parrot = a row that waits 48 h', `
    update effect_primitives set enabled = true where primitive = any(${NEW});
    r := play_card_effect('${P}_a', c, '${P}_b');
    select * into e from discord_effects where target_id = '${P}_b' and primitive = 'slowmode';
    ok := (r->>'ok')::boolean and e.status = 'pending' and e.amount = 30 and e.duration_s = 300
      and abs(extract(epoch from e.revert_at - e.execute_after) - 300) < 1;
    select c2.id into c from cards c2 join subjects s on s.id = c2.subject_id where s.name = 'Call of Dragons' order by c2.id limit 1;
    insert into player_cards (player_id, card_id, quantity) values ('${P}_a', c, 1);
    r := play_card_effect('${P}_a', c, '${P}_b');
    select * into e from discord_effects where target_id = '${P}_b' and primitive = 'parrot';
    ok := ok and (r->>'ok')::boolean and e.status = 'pending' and e.duration_s = 172800 and (bot_work()->>'fx')::boolean;
    res := res || jsonb_build_object('case', 'enabled: slowmode = a Discord row for 5 min (gap 30 s); parrot = a row that waits 48 h', 'ok', ok, 'r', r);`)}

${C('refund: outcome refunded, the cooldown is cleared, and the play counts in no daily cap (the same card plays again at send_per_day 1)', `
    insert into settings (key, value) values ('card_effect_caps', '{"send_per_day": 1}')
      on conflict (key) do update set value = coalesce(settings.value, '{}'::jsonb) || '{"send_per_day": 1}'::jsonb;
    select c2.id into c from cards c2 join subjects s on s.id = c2.subject_id where s.effect->>'primitive' = 'title' and c2.rarity::text = 'normal' order by c2.id limit 1;
    insert into player_cards (player_id, card_id, quantity) values ('${P}_c', c, 1);
    r := play_card_effect('${P}_c', c, '${P}_d');
    ok := (r->>'ok')::boolean and exists (select 1 from card_effect_cooldowns where player_id = '${P}_c');
    -- before the refund: the send cap (1) and the cooldown both refuse a second play
    ok := ok and (play_card_effect('${P}_c', c, '${P}_e')->>'ok')::boolean is not true;
    r := refund_card_play((r->>'play_id')::bigint, 'not_manageable');
    ok := ok and (r->>'ok')::boolean
      and (select outcome = 'refunded' and refund_reason = 'not_manageable' and refund_seen_at is null from card_plays where player_id = '${P}_c' order by id limit 1)
      and not exists (select 1 from card_effect_cooldowns where player_id = '${P}_c');
    ok := ok and (refund_card_play((select min(id) from card_plays where player_id = '${P}_c'), 'x')->>'ok')::boolean is not true;  -- once only
    r := play_card_effect('${P}_c', c, '${P}_e');
    res := res || jsonb_build_object('case', 'refund: outcome refunded, the cooldown is cleared, and the play counts in no daily cap (the same card plays again at send_per_day 1)', 'ok',
      ok and (r->>'ok')::boolean, 'r', r);`)}

${C('poll pick: no pick or a bad index is refused (nothing spent); a good index posts that question', `
    update effect_primitives set enabled = true where primitive = 'hot_take_poll';
    select c2.id into c from cards c2 join subjects s on s.id = c2.subject_id where s.name = 'The Best Sauce is…?' order by c2.id limit 1;
    insert into player_cards (player_id, card_id, quantity) values ('${P}_f', c, 1);
    ok := play_card_effect('${P}_f', c, '${P}_d')->>'error' = 'bad_choice'
      and play_card_effect_choice('${P}_f', c, '${P}_d', 4)->>'error' = 'bad_choice'
      and play_card_effect_choice('${P}_f', c, '${P}_d', -1)->>'error' = 'bad_choice'
      and not exists (select 1 from card_plays where player_id = '${P}_f')
      and not exists (select 1 from card_effect_cooldowns where player_id = '${P}_f');
    r := play_card_effect_choice('${P}_f', c, '${P}_d', 1);
    select * into e from discord_effects where target_id = '${P}_d' and primitive = 'hot_take_poll';
    ok := ok and (r->>'ok')::boolean and (e.options->>'choice')::int = 1
      and e.options->>'question' = (select effect->'options'->'polls'->1->>'question' from subjects where name = 'The Best Sauce is…?')
      and jsonb_array_length(e.options->'answers') >= 2 and not (e.options ? 'polls')
      and current_setting('tcg.effect_choice', true) = '';
    res := res || jsonb_build_object('case', 'poll pick: no pick or a bad index is refused (nothing spent); a good index posts that question', 'ok', ok, 'r', r);`)}

  raise exception 'RESULTS %', res;
end $t$;`;
const out = await q(`set statement_timeout = '5min';` + String.fromCharCode(10) + body);
const m = JSON.stringify(out).match(/RESULTS (\[.*\])/);
if (!m) { console.log('NO RESULTS:', JSON.stringify(out).slice(0, 1500)); process.exitCode = 1; }
else {
  const rows = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\n.*$/, ''));
  let bad = 0;
  for (const x of rows) { if (!x.ok) bad += 1; const { case: name, ok, ...rest } = x; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + JSON.stringify(rest).slice(0, 700)}`); }
  console.log(`${OLD ? '[--old baseline] ' : ''}${bad ? `${bad} of ${rows.length} FAILED` : `PASS all ${rows.length}`}`);
  if (bad) process.exitCode = 1;
}
const left = await q(`select count(*) as n from players where id like '${P}%'`);
console.log('after (nothing stays):', JSON.stringify(left));
