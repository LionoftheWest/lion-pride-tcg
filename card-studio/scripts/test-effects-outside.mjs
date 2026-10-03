/**
 * effects_outside.sql (2026-10-03): pranks and boons with outside influence (the SQL side).
 * Rolled back (the result comes back in the exception):  node scripts/test-effects-outside.mjs [--old]
 * --old: run the same cases WITHOUT the migration (the baseline must fail).
 * Each case runs in its own sub-block, so a missing function or type is one FAIL line, not a crash.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const OLD = process.argv.includes('--old');
const mig = OLD ? '' : readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/effects_outside.sql', import.meta.url)), 'utf8')
  .replace(/notify pgrst[^\n]*\n/g, '');
if (mig.includes('$m$')) throw new Error('the migration must not contain $m$');
const P = 'tst_eo';
// One case: its own block; an error is a FAIL with the message.
const C = (name, body) => `
  begin
${body}
  exception when others then
    res := res || jsonb_build_object('case', ${`'${name.replace(/'/g, "''")}'`}, 'ok', false, 'r', 'error: ' || sqlerrm);
  end;`;
const body = String.raw`do $t$
declare res jsonb := '[]'; r jsonb; r0 jsonb; r1 jsonb; ok boolean; n int; e record; det text;
  before jsonb; h bigint; atk bigint; heal bigint; gc bigint; sd int; v jsonb;
  d date := (now() at time zone 'America/Denver')::date;
begin
  -- The 5 cards before the migration: their ability and tags must not change.
  select jsonb_object_agg(name, jsonb_build_object('ability', ability, 'tags', tags)) into before from subjects
   where name in ('Kroc Bot', 'Shave your Head', 'Xeno''s Stone Shovel', 'Mob''s "Hiding" Spot', 'Grim''s Pokemon Trainer');
  ${mig ? 'execute $m$' + mig + '$m$;' : ''}
  perform set_config('tcg.skip_welcome', 'on', true);
  update settings set value = value || '{"enabled": true}' where key = 'dailies';
  update settings set value = '1'::jsonb where key = 'pack_earn_multiplier';
  insert into players (id, username) select '${P}_' || x, 'tst eo ' || x
    from unnest(array['a', 'b', 'c', 'old', 'tst', 'atk', 'sup', 's1', 's2', 's3', 's4']) x;
  -- The real Discord queue set aside (bot_work cases), one play to hang the test rows on.
  update discord_effects set status = 'done' where status in ('pending', 'active');

${C('the effect types: title/sticker/crown in Discord for 1 h; heckle/fanfare/squeaky (Discord, 48 h); butterfingers (app, 48 h, max 15); streak_shield (app, 14 days, max 1)', `
    select count(*) into n from effect_primitives where (primitive, channel, max_duration_s, coalesce(max_amount, -1)) in
      (('title', 'discord', 3600, -1), ('sticker', 'discord', 3600, -1), ('crown', 'discord', 3600, -1),
       ('heckle', 'discord', 172800, -1), ('fanfare', 'discord', 172800, -1), ('squeaky', 'discord', 172800, -1),
       ('butterfingers', 'app', 172800, 15), ('streak_shield', 'app', 1209600, 1));
    select coalesce(jsonb_agg(jsonb_build_array(primitive, kind, channel, max_duration_s, max_amount, enabled)), '[]') into r from effect_primitives
     where primitive in ('title', 'sticker', 'crown', 'heckle', 'fanfare', 'squeaky', 'butterfingers', 'streak_shield');
    res := res || jsonb_build_object('case', 'the effect types: title/sticker/crown in Discord for 1 h; heckle/fanfare/squeaky (Discord, 48 h); butterfingers (app, 48 h, max 15); streak_shield (app, 14 days, max 1)', 'ok',
      n = 8 and (select bool_and(kind = case when primitive in ('crown', 'fanfare', 'streak_shield') then 'boon' else 'prank' end) from effect_primitives
        where primitive in ('title', 'sticker', 'crown', 'heckle', 'fanfare', 'squeaky', 'butterfingers', 'streak_shield')), 'r', r);`)}

${C('the 5 cards: the new effects; ability + tags the same', `
    select count(*) into n from subjects s join (values
      ('Kroc Bot', 'fanfare', 'Peaches Fanfare', 24), ('Shave your Head', 'streak_shield', 'Stream Saver', 72),
      ('Xeno''s Stone Shovel', 'butterfingers', 'Butterfingers', 12), ('Mob''s "Hiding" Spot', 'squeaky', 'Squeaky Entrance', 12),
      ('Grim''s Pokemon Trainer', 'heckle', 'Heckle', 12)) v(name, prim, ename, cd)
      on s.name = v.name and s.effect->>'primitive' = v.prim and s.effect->>'name' = v.ename and (s.effect->>'cooldown_h')::int = v.cd
     where jsonb_build_object('ability', s.ability, 'tags', s.tags) = before->s.name;
    res := res || jsonb_build_object('case', 'the 5 cards: the new effects; ability + tags the same', 'ok',
      n = 5 and (select (effect->'base'->>'amount')::int = 15 from subjects where name = 'Xeno''s Stone Shovel')
      and (select jsonb_array_length(effect->'options'->'lines') = 5 from subjects where name = 'Grim''s Pokemon Trainer')
      and (select (effect->'base'->>'duration_s')::int = 1209600 from subjects where name = 'Shave your Head'), 'n', n);`)}

${C('arm on open: a googly_eyes play waits (expires_at NULL, hidden); arm_player_effects starts it for its full length', `
    select c.id into gc from cards c join subjects s on s.id = c.subject_id where s.effect->>'primitive' = 'googly_eyes' and c.rarity::text = 'normal' order by c.id limit 1;
    insert into player_cards (player_id, card_id, quantity) values ('${P}_a', gc, 1);
    r := play_card_effect('${P}_a', gc, '${P}_b');
    select * into e from player_effects where player_id = '${P}_b' and primitive = 'googly_eyes';
    ok := (r->>'ok')::boolean and e.expires_at is null and (e.options->>'arm_s')::int = e.duration_s and e.duration_s > 0
      and not (e.starts_at <= now())                                   -- the Activity reads starts_at <= now: hidden
      and card_effect_active('${P}_b', 'googly_eyes');               -- it is on them: no second googly yet
    n := arm_player_effects('${P}_b');
    select * into e from player_effects where player_id = '${P}_b' and primitive = 'googly_eyes';
    res := res || jsonb_build_object('case', 'arm on open: a googly_eyes play waits (expires_at NULL, hidden); arm_player_effects starts it for its full length', 'ok',
      ok and n = 1 and e.starts_at = now() and e.expires_at = now() + make_interval(secs => e.duration_s)
      and not (e.options ? 'arm_s') and arm_player_effects('${P}_b') = 0, 'play', r, 'row', to_jsonb(e));`)}

${C('arm on open: an armed row 8 days old is used up (and does not block a new play); a tester row starts at once', `
    insert into player_effects (player_id, primitive, duration_s, options, expires_at) values ('${P}_old', 'fog', 120, '{}', now() + interval '120 seconds');
    update player_effects set created_at = now() - interval '8 days' where player_id = '${P}_old';
    ok := not card_effect_active('${P}_old', 'fog');
    n := arm_player_effects('${P}_old');
    select * into e from player_effects where player_id = '${P}_old';
    ok := ok and n = 0 and e.consumed_at is not null and e.expires_at is null;
    insert into player_effects (player_id, primitive, duration_s, options, expires_at) values ('${P}_tst', 'fog', 60, '{"test": true}', now() + interval '60 seconds');
    select * into e from player_effects where player_id = '${P}_tst';
    res := res || jsonb_build_object('case', 'arm on open: an armed row 8 days old is used up (and does not block a new play); a tester row starts at once', 'ok',
      ok and e.expires_at = now() + interval '60 seconds' and e.starts_at <= now(), 'row', to_jsonb(e));`)}

${C('butterfingers: the same hit (same random seed) with the prank does 15% less, reports it, and uses it up', `
    insert into hunts (name, tier, weak_points, resist_points, hp_max, hp_remaining, closes_at)
      values ('Test Boss', 'Normal', '[]', '[]', 1000000, 1000000, now() + interval '1 day') returning id into h;
    select c.id into atk from cards c join subjects s on s.id = c.subject_id
     where s.type in ('Character', 'Creature') and c.rarity::text = 'normal' order by c.id limit 1;
    insert into player_cards (player_id, card_id, quantity) values ('${P}_atk', atk, 1);
    insert into hunt_squads (hunt_id, player_id, hit_date, card_ids) values (h, '${P}_atk', d, array[atk]);
    r0 := null;
    -- A FOR variable is local to its loop: keep the seed that gave a real hit in sd.
    for seed in 1..40 loop
      begin
        perform setseed(seed / 100.0);
        r := hunt_attack('${P}_atk', h, atk);
        raise exception 'EO_ROLLBACK' using detail = r::text;
      exception when others then
        get stacked diagnostics det = pg_exception_detail;
        if sqlerrm <> 'EO_ROLLBACK' then raise; end if;
        r := det::jsonb;
      end;
      if (r->>'ok')::boolean and (r->>'damage')::int >= 20 then r0 := r; sd := seed; exit; end if;
    end loop;
    insert into player_effects (player_id, primitive, amount, options) values ('${P}_atk', 'butterfingers', 15, '{}');
    perform setseed(sd / 100.0);
    r1 := hunt_attack('${P}_atk', h, atk);
    res := res || jsonb_build_object('case', 'butterfingers: the same hit (same random seed) with the prank does 15% less, reports it, and uses it up', 'ok',
      r0 is not null and (r1->>'damage')::int = greatest(1, round((r0->>'damage')::int * 0.85))
      and (r1->>'butterfingers')::numeric = 15 and r0->'butterfingers' = 'null'::jsonb
      and not exists (select 1 from player_effects where player_id = '${P}_atk' and consumed_at is null),
      'show', true, 'seed', sd, 'without', r0->'damage', 'with', r1->'damage', 'r1_bf', r1->'butterfingers');`)}

${C('butterfingers: a support play does not use it', `
    -- Its own test boss (never the live hunt row; the block rolls it back).
    insert into hunts (name, tier, weak_points, resist_points, hp_max, hp_remaining, closes_at)
      values ('Test Boss', 'Normal', '[]', '[]', 1000000, 1000000, now() + interval '1 day') returning id into h;
    select c.id into heal from cards c join subjects s on s.id = c.subject_id where s.ability->>'effect' = 'heal' and c.rarity::text = 'normal' order by c.id limit 1;
    select c.id into atk from cards c join subjects s on s.id = c.subject_id
     where s.type in ('Character', 'Creature') and c.rarity::text = 'normal' order by c.id limit 1;
    insert into player_cards (player_id, card_id, quantity) values ('${P}_sup', heal, 1), ('${P}_sup', atk, 1);
    insert into hunt_squads (hunt_id, player_id, hit_date, card_ids) values (h, '${P}_sup', d, array[atk, heal]);
    perform hunt_commit_card(h, '${P}_sup', atk, d, 30);
    update hunt_card_hp set hp_remaining = 5 where player_id = '${P}_sup' and card_id = atk;
    insert into player_effects (player_id, primitive, amount, options) values ('${P}_sup', 'butterfingers', 15, '{}');
    r := hunt_support('${P}_sup', h, heal, atk);
    res := res || jsonb_build_object('case', 'butterfingers: a support play does not use it', 'ok',
      (r->>'ok')::boolean and exists (select 1 from player_effects where player_id = '${P}_sup' and primitive = 'butterfingers' and consumed_at is null), 'r', r);`)}

${C('streak_shield: a one-day gap keeps the streak (day 3 = bonus pack) and uses the shield', `
    insert into daily_claims (player_id, day, task, amount) values ('${P}_s1', d - 2, 'checkin', 1), ('${P}_s1', d - 3, 'checkin', 1);
    insert into player_effects (player_id, primitive, amount, options, expires_at) values ('${P}_s1', 'streak_shield', 1, '{}', now() + interval '14 days');
    v := dailies_view('${P}_s1');
    r := claim_daily('${P}_s1', 'checkin');
    res := res || jsonb_build_object('case', 'streak_shield: a one-day gap keeps the streak (day 3 = bonus pack) and uses the shield', 'ok',
      (v->'tasks'->0->>'reward')::int = 1 and (r->>'ok')::boolean and (r->'view'->'tasks'->0->>'streak')::int = 4
      and (select consumed_at is not null and options->>'shield_day' = to_char(d - 1, 'YYYY-MM-DD') from player_effects where player_id = '${P}_s1'),
      'before', v->'tasks'->0, 'after', r->'view'->'tasks'->0, 'packs', r->'packs');`)}

${C('streak_shield: the reward counts the shield (2 days + shield = day 3 = 2 packs)', `
    insert into players (id, username) values ('${P}_s5', 'tst eo s5');
    insert into daily_claims (player_id, day, task, amount) values ('${P}_s5', d - 2, 'checkin', 1);
    insert into player_effects (player_id, primitive, amount, options, expires_at) values ('${P}_s5', 'streak_shield', 1, '{}', now() + interval '14 days');
    r := claim_daily('${P}_s5', 'checkin');
    res := res || jsonb_build_object('case', 'streak_shield: the reward counts the shield (2 days + shield = day 3 = 2 packs)', 'ok',
      (r->>'ok')::boolean and (r->>'packs')::int = 2 and (r->'view'->'tasks'->0->>'streak')::int = 3, 'r', r->'view'->'tasks'->0, 'packs', r->'packs');`)}

${C('streak_shield: without a shield a one-day gap resets the streak', `
    insert into daily_claims (player_id, day, task, amount) values ('${P}_s2', d - 2, 'checkin', 1), ('${P}_s2', d - 3, 'checkin', 1);
    r := claim_daily('${P}_s2', 'checkin');
    res := res || jsonb_build_object('case', 'streak_shield: without a shield a one-day gap resets the streak', 'ok',
      (r->>'ok')::boolean and (r->'view'->'tasks'->0->>'streak')::int = 1, 'r', r->'view'->'tasks'->0);`)}

${C('streak_shield: a two-day gap resets even with a shield (the shield stays); an expired shield is not used', `
    insert into daily_claims (player_id, day, task, amount) values ('${P}_s3', d - 3, 'checkin', 1);
    insert into player_effects (player_id, primitive, amount, options, expires_at) values ('${P}_s3', 'streak_shield', 1, '{}', now() + interval '14 days');
    r := claim_daily('${P}_s3', 'checkin');
    insert into daily_claims (player_id, day, task, amount) values ('${P}_s4', d - 2, 'checkin', 1);
    insert into player_effects (player_id, primitive, amount, options, expires_at) values ('${P}_s4', 'streak_shield', 1, '{}', now() - interval '1 second');
    r1 := claim_daily('${P}_s4', 'checkin');
    res := res || jsonb_build_object('case', 'streak_shield: a two-day gap resets even with a shield (the shield stays); an expired shield is not used', 'ok',
      (r->>'ok')::boolean and (r->'view'->'tasks'->0->>'streak')::int = 1
      and exists (select 1 from player_effects where player_id = '${P}_s3' and consumed_at is null)
      and (r1->'view'->'tasks'->0->>'streak')::int = 1, 'two_day', r->'view'->'tasks'->0, 'expired', r1->'view'->'tasks'->0);`)}

${C('bot_work: a pending heckle / fanfare / squeaky is work (the bot arms it)', `
    insert into card_plays (player_id, target_id, aimed_at, card_id, subject_id, primitive, kind, rarity, outcome, posted_at)
      select '${P}_a', '${P}_c', '${P}_c', c.id, c.subject_id, 'nickname', 'prank', 'normal', 'applied', now() from cards c order by c.id limit 1;
    ok := not (bot_work()->>'fx')::boolean;
    for e in select unnest(array['heckle', 'fanfare', 'squeaky']) p loop
      insert into discord_effects (play_id, target_id, primitive, revert_at)
        values ((select max(id) from card_plays where player_id = '${P}_a'), '${P}_c', e.p, now() + interval '48 hours');
      ok := ok and (bot_work()->>'fx')::boolean;
      delete from discord_effects where target_id = '${P}_c';
    end loop;
    res := res || jsonb_build_object('case', 'bot_work: a pending heckle / fanfare / squeaky is work (the bot arms it)', 'ok', ok);`)}

${C('bot_work: an armed heckle / fanfare / squeaky is not work until revert_at; then it is', `
    ok := true;
    for e in select unnest(array['heckle', 'fanfare', 'squeaky']) p loop
      insert into discord_effects (play_id, target_id, primitive, status, revert_at)
        values ((select max(id) from card_plays where player_id = '${P}_a'), '${P}_c', e.p, 'active', now() + interval '47 hours');
      ok := ok and not (bot_work()->>'fx')::boolean;
      update discord_effects set revert_at = now() - interval '1 second' where target_id = '${P}_c';
      ok := ok and (bot_work()->>'fx')::boolean;
      delete from discord_effects where target_id = '${P}_c';
    end loop;
    res := res || jsonb_build_object('case', 'bot_work: an armed heckle / fanfare / squeaky is not work until revert_at; then it is', 'ok', ok);`)}

${C('bot_work: a voice prank waits 48 h for voice (2 h and 47 h old: not work; 49 h old: work)', `
    ok := true;
    for e in select * from (values (2, false), (47, false), (49, true)) v(hrs, want) loop
      insert into discord_effects (play_id, target_id, primitive, created_at)
        values ((select max(id) from card_plays where player_id = '${P}_a'), '${P}_c', 'vc_mute', now() - make_interval(hours => e.hrs));
      ok := ok and (bot_work()->>'fx')::boolean = e.want;
      delete from discord_effects where target_id = '${P}_c';
    end loop;
    res := res || jsonb_build_object('case', 'bot_work: a voice prank waits 48 h for voice (2 h and 47 h old: not work; 49 h old: work)', 'ok', ok);`)}

  raise exception 'RESULTS %', res;
end $t$;`;
const out = await q(`set statement_timeout = '5min';` + String.fromCharCode(10) + body);
const m = JSON.stringify(out).match(/RESULTS (\[.*\])/);
if (!m) { console.log('NO RESULTS:', JSON.stringify(out).slice(0, 1500)); process.exitCode = 1; }
else {
  const rows = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\n.*$/, ''));
  let bad = 0;
  for (const x of rows) { if (!x.ok) bad += 1; const { case: name, ok, ...rest } = x; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok && !rest.show ? '' : ' ' + JSON.stringify(rest).slice(0, 700)}`); }
  console.log(bad ? `${bad} of ${rows.length} FAILED` : `PASS all ${rows.length}`);
  if (bad) process.exitCode = 1;
}
const left = await q(`select count(*) as n from players where id like '${P}%'`);
console.log('after (nothing stays):', JSON.stringify(left));
