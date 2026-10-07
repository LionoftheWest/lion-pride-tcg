-- hunt_counter_balance.sql (2026-10-07). Nathan's rule (CLAUDE.md "Database design"): every number that changes
-- combat or a reward lives in public.balance, never in code. The Hunt boss counter moves (hunt_boss_moves.sql) had
-- their numbers in two other places:
--   settings.hunt_boss_moves   the share of the normal turns (_share 0.4, the boss share 0.5 / 0.6) and the move weights
--   the code                   hunt_counter_act (the hit sizes, the x2 / x3 hits, the 10% / 25% / 50% marks, the
--                              enrage 1.4 for 2 rounds, the wait rounds, the curse 0.7, ...), hunt_attack (Counter-pick
--                              x2, Demotion 20%) and hunt_support (Rage Spiral +20%, the counter passives 10%, the
--                              Juggernaut stun fail 90%, the Plague cleanse 10%, the 10% / 50% mark defaults)
-- They move into ONE new balance key boss_counters (share, boss_share, weights, moves) and 6 new leaves of balance
-- boss_passives, with the SAME values: every Hunt fight comes out the same (card-studio/scripts/
-- test-boss-counters-golden.mjs replays seeded fights on private bosses through the live code and this file).
-- settings.hunt_boss_moves keeps only the content: the pools (counters, key, name, text). A move text that quotes a
-- number is a template ({pct:bloodrot.heal}, {n:groan.wait}, ...); hunt_boss_move_list renders it from balance, so a
-- balance change cannot make the text wrong. The Activity reads the texts through hunt_boss_move_list.
-- Not numbers (rules, they stay in code): until 999 = the rest of the squad day; Alt-F4, Veil and Infect BLOCK the
-- effect (mult 0: hunt_attack also ignores a weaken or expose that is already on); "this round" = the round before;
-- the Rage Spiral starts at 0.
-- hunt_counter_act, hunt_counter_pick, hunt_attack and hunt_support are rebuilt from their LIVE text (2026-10-07) with
-- only the number lines changed. balance_table.sql carries the same hunt_attack / hunt_support text and its guard
-- accepts the new md5, so a re-run of it does not revert this file. Idempotent.
-- Test: card-studio/scripts/test-boss-counters-golden.mjs (golden + one mutation per balance value) and
-- card-studio/scripts/test-boss-moves.mjs (every move through hunt_attack).

-- GUARD (the combat_core.sql rule): each function must be the live text this file was built from, or its result.
do $g$
declare x text[]; m text;
begin
  if to_regclass('public.balance') is null or not exists (select 1 from public.balance where key = 'boss_passives') then
    raise exception 'hunt_counter_balance.sql: apply balance_table.sql first';
  end if;
  if not exists (select 1 from public.settings where key = 'hunt_boss_moves') then
    raise exception 'hunt_counter_balance.sql: apply hunt_boss_moves.sql first';
  end if;
  foreach x slice 1 in array array[
    ['hunt_counter_act(bigint,text,date,bigint,integer,numeric,numeric,text,text,integer,integer,integer,numeric)', '79b07ed05bcf90ad1461a9918130dd80', '10546dab212ee7b6498670cf6613e2e0'],
    ['hunt_counter_pick(bigint,text,date,text,text)', '07cbc49b11a9bb2f7fdd8a7a2a4e82a4', 'a85143f9363784915b92bb2cdc8fab0b'],
    ['hunt_attack(text,bigint,bigint)', '5cfa1a4779226661d56ceda56045b58c', 'ca913fda0dbc186723793afac8570779'],
    ['hunt_support(text,bigint,bigint,bigint)', 'a9addaf61d3a15508001be519589694b', 'fc9e9f0040a9c09d090d75145820b6c3']] loop
    select md5(replace(pg_get_functiondef(('public.' || x[1])::regprocedure), chr(13), '')) into strict m;
    if m not in (x[2], x[3]) then raise exception 'hunt_counter_balance.sql: the live % changed since this file was built. Rebuild it from the live text.', x[1]; end if;
  end loop;
end $g$;
-- GUARD-END

-- 1. The shape rules (on top of balance_check, which refuses a negative number or a lost / retyped leaf). A separate
--    trigger, so that a re-run of another balance file does not remove them. A leaf that is there must have the right
--    shape (a BEFORE INSERT trigger also sees the row of an insert that ends in "on conflict do nothing").
create or replace function public.balance_check_boss_counters() returns trigger
language plpgsql set search_path to 'public' as $$
declare v_bad text;
begin
  if new.key = 'boss_counters' then
    -- Every leaf is a number (the move names and texts are content: settings.hunt_boss_moves).
    select string_agg(array_to_string(l.path, '.'), ', ') into v_bad from balance_leaves(new.value) l
     where l.typ <> 'number' and not (l.typ = 'object' and l.path in (array['boss_share'], array['weights']));   -- an empty map: {}
    if v_bad is not null then raise exception 'balance boss_counters: % must be a number', v_bad; end if;
    -- A share of the turns, a share of an effect, a curse and a kept share are 0 to 1.
    select string_agg(array_to_string(l.path, '.'), ', ') into v_bad from balance_leaves(new.value) l
     where l.num > 1 and (l.path[1] in ('share', 'boss_share')
        or (l.path[1] = 'moves' and l.path[3] in ('heal', 'shield', 'empower', 'expose', 'smite', 'share', 'keep', 'curse', 'back')));
    if v_bad is not null then raise exception 'balance boss_counters: % must be from 0 to 1', v_bad; end if;
    -- Rounds, waits, plays, cards and hits are whole numbers; a hit count and a play count are at least 1.
    select string_agg(array_to_string(l.path, '.'), ', ') into v_bad from balance_leaves(new.value) l
     where l.path[1] = 'moves' and l.path[3] in ('rounds', 'wait', 'plays', 'cards', 'hits')
       and (l.num % 1 <> 0 or (l.path[3] in ('plays', 'hits') and l.num < 1));
    if v_bad is not null then raise exception 'balance boss_counters: % must be a whole number (plays and hits at least 1)', v_bad; end if;
    -- A hit size and a multiplier are above 0 (0 would make a move do nothing: change the pool instead).
    select string_agg(array_to_string(l.path, '.'), ', ') into v_bad from balance_leaves(new.value) l
     where l.path[1] = 'moves' and (l.path[3] like '%\_x' or l.path[3] in ('x', 'times', 'enrage')) and l.num <= 0;
    if v_bad is not null then raise exception 'balance boss_counters: % must be above 0', v_bad; end if;
    if (select sum(l.num) from balance_leaves(new.value) l where l.path[1] = 'weights') <= 0 then
      raise exception 'balance boss_counters: the weights must add up to more than 0';
    end if;
  elsif new.key = 'boss_passives' then
    -- The counter passives: a share of a support (_x), a share of a curse and a chance are 0 to 1.
    select string_agg(k, ', ') into v_bad from unnest(array['plague_x', 'shatterer_x', 'dispeller_x', 'juggernaut_x', 'juggernaut_stun_fail', 'plague_cleanse']) k
     where new.value ? k and (jsonb_typeof(new.value->k) <> 'number' or (new.value->>k)::numeric > 1);
    if v_bad is not null then raise exception 'balance boss_passives: % must be a number from 0 to 1', v_bad; end if;
  end if;
  return new;
end $$;
drop trigger if exists balance_check_boss_counters on public.balance;
create trigger balance_check_boss_counters before insert or update on public.balance
  for each row execute function public.balance_check_boss_counters();
revoke all on function public.balance_check_boss_counters() from public, anon, authenticated;

-- 2. The values. share, boss_share and weights move from settings.hunt_boss_moves with their LIVE values; the move
--    numbers are the numbers of the code. A value that is already in balance stays (a re-run never resets a tuned value).
insert into public.balance (key, value, note)
select 'boss_counters', jsonb_build_object(
  'share', coalesce((s.value->>'_share')::numeric, 0.4),
  'boss_share', coalesce((select jsonb_object_agg(b.key, (b.value->>'share')::numeric) from jsonb_each(s.value) b
                           where b.key <> '_share' and b.value ? 'share'), '{}'::jsonb),
  'weights', coalesce((select jsonb_object_agg(m->>'key', coalesce((m->>'w')::numeric, 1)) from jsonb_each(s.value) b, jsonb_array_elements(b.value->'moves') m
               where b.key <> '_share'), '{}'::jsonb),
  'moves', $j${
    "bloodrot":   {"heal": 0.1},
    "feast":      {"hit_x": 1.0},
    "anemia":     {"hit_x": 0.35, "heal_x": 2},
    "decay":      {"heal": 0.5},
    "infect":     {"hit_x": 0.35, "dot_x": 0.25, "rounds": 3},
    "groan":      {"wait": 4},
    "shatter":    {"shield": 0.1},
    "crush":      {"share": 0.5},
    "bully":      {"hit_x": 1.0},
    "fakerank":   {"hit_x": 1.0, "times": 2},
    "bonepierce": {"hit_x": 1.0},
    "rattle":     {"keep": 0.5, "shield": 0.25},
    "calcify":    {"shield": 0.1},
    "stuck":      {"wait": 6},
    "nerf":       {"empower": 0.25},
    "patchnotes": {"empower": 0.1},
    "tierlist":   {"hit_x": 2.0},
    "counterpick": {"x": 2},
    "tilt":       {"enrage": 1.4, "rounds": 2},
    "spiral":     {"step": 0.2},
    "flame":      {"hit_x": 0.35, "weaken_x": 2},
    "fade":       {"expose": 0.5},
    "demotion":   {"back": 0.2},
    "nightshade": {"dot_x": 0.25, "rounds": 3},
    "rubberband": {"hit_x": 1.0, "hits": 2},
    "lagspike":   {"wait": 4},
    "packetloss": {"plays": 1},
    "rollback":   {"smite": 0.5},
    "hitbox":     {"smite": 0.1},
    "pingspike":  {"wait": 4},
    "hotfix":     {"curse": 0.7},
    "rollout":    {"curse": 0.7},
    "patch":      {"wait": 4},
    "ban":        {"cards": 2},
    "wave":       {"wait": 5},
    "appeal":     {"hit_x": 2.0},
    "shadowban":  {"plays": 3},
    "swarm":      {"hit_x": 0.35, "support_x": 3},
    "brood":      {"hit_x": 0.8},
    "rush":       {"hit_x": 0.8, "hits": 2},
    "overrun":    {"hit_x": 1.0, "enrage": 1.4, "rounds": 2}
  }$j$::jsonb),
  $n$The Hunt boss counter moves (the boss pools are content in settings.hunt_boss_moves: counters, key, name, text). share = the share of the normal boss turns that a counter move takes (boss_share = a boss's own share); weights = the draw weight of each move (hunt_counter_pick). moves = the numbers of each move (hunt_counter_act, hunt_attack, hunt_support): hit_x = ATK multiplier of one hit (combat_area_roll), heal_x / weaken_x / support_x / times = the hit on that card type x this, hits = the number of hits; heal / shield / empower / expose / smite = that support works at this share for the rest of the day; wait = the extra rounds of the support cooldown; rounds = the rounds of a damage-over-time (dot_x = ATK multiplier per round) or an enrage (enrage = the boss damage x this); share = Crush: the share of the lost shield; keep = Rattle: the share of each shield that stays; curse = the damage x of a cursed card; back = Demotion: the share of the damage that comes back; x = Counter-pick: the bonus x this hurts the attacker; step = Rage Spiral: the boss damage added by each weaken; plays = the support plays that do nothing; cards = Ban: the support cards that stop. The move texts quote these numbers (hunt_boss_move_list). balance_check_boss_counters checks the shape.$n$
from public.settings s where s.key = 'hunt_boss_moves'
on conflict (key) do nothing;

-- The counter passives (one at most on a boss, spawn_hunt): new leaves of boss_passives. An existing leaf stays.
update public.balance
   set value = '{"plague_x":0.1,"shatterer_x":0.1,"dispeller_x":0.1,"juggernaut_x":0.1,"juggernaut_stun_fail":0.9,"plague_cleanse":0.1}'::jsonb || value,
       note = note || case when note like '%plague_x%' then '' else ' The counter passives (hunt_support): plague_x = a heal works at this share, shatterer_x = a shield and a smite, dispeller_x = an empower and an expose, juggernaut_x = a weaken; juggernaut_stun_fail = the chance that a stun fails; plague_cleanse = the share of a curse that a cleanse removes under Plague.' end
 where key = 'boss_passives'
   and not (value ? 'plague_x' and value ? 'shatterer_x' and value ? 'dispeller_x' and value ? 'juggernaut_x' and value ? 'juggernaut_stun_fail' and value ? 'plague_cleanse');

-- 3. settings.hunt_boss_moves: the content only (the pools). The numbers are gone (balance boss_counters); a text that
--    quotes a number is a template that hunt_boss_move_list renders: {pct:m.f} = 10%, {n:m.f} = 4, {times:m.f} = twice
--    / 3 times, {work:m.f} / {works:m.f} = work at 50% / works at 50%, {plays:m.f} = next support play does nothing /
--    next 3 support plays do nothing, {cards:m.f} = 2 support cards, {hits:m.f} = 2 hits (m.f = moves.<m>.<f>).
update public.settings set value = $j${
  "The Grind Vampire": {"counters": "heal", "moves": [
    {"key": "bloodrot", "name": "Bloodrot", "text": "Heals on the hit card {work:bloodrot.heal} for the rest of the day."},
    {"key": "siphon", "name": "Siphon", "text": "The boss heals the HP that your squad healed this round."},
    {"key": "feast", "name": "Feast", "text": "Hits the card with the lowest HP."},
    {"key": "anemia", "name": "Anemia", "text": "Hits every card, {times:anemia.heal_x} as hard on heal cards."}]},
  "The AFK Warzombie": {"counters": "heal", "moves": [
    {"key": "decay", "name": "Decay", "text": "The hit card loses the HP that heals gave it this round. Heals {work:decay.heal} for the rest of the day."},
    {"key": "infect", "name": "Infect", "text": "Damage on the hit card for {n:infect.rounds} rounds. It cannot be healed for the rest of the day."},
    {"key": "groan", "name": "Groan", "text": "Heal cards wait {n:groan.wait} more rounds."},
    {"key": "undying", "name": "Undying", "text": "For the rest of the day, each heal you play also heals the boss."}]},
  "The Smurf Brute": {"counters": "shield", "moves": [
    {"key": "shatter", "name": "Shatter", "text": "Breaks every shield in your squad. Shields {work:shatter.shield} for the rest of the day."},
    {"key": "crush", "name": "Crush", "text": "Each card takes {pct:crush.share} of the shield it lost to Shatter."},
    {"key": "bully", "name": "Bully", "text": "Hits the card with the biggest shield. The hit ignores the shield."},
    {"key": "fakerank", "name": "Fake Rank", "text": "Hits a shielded card {times:fakerank.times} as hard."}]},
  "The Hardstuck Skeleton": {"counters": "shield", "moves": [
    {"key": "bonepierce", "name": "Bone Pierce", "text": "This hit ignores shields."},
    {"key": "rattle", "name": "Rattle", "text": "Cuts every shield to {pct:rattle.keep}. Shields {work:rattle.shield} for the rest of the day."},
    {"key": "calcify", "name": "Calcify", "text": "New shields {work:calcify.shield} for the rest of the day."},
    {"key": "stuck", "name": "Stuck", "text": "Shield cards wait {n:stuck.wait} more rounds."}]},
  "Maw of the Meta": {"counters": "empower", "moves": [
    {"key": "nerf", "name": "Nerf", "text": "Removes empower from every card. Empower {works:nerf.empower} for the rest of the day."},
    {"key": "patchnotes", "name": "Patch Notes", "text": "Empower {works:patchnotes.empower} for the rest of the day."},
    {"key": "tierlist", "name": "Tier List", "text": "Hits a card that uses empower {times:tierlist.hit_x} as hard."},
    {"key": "counterpick", "name": "Counter-pick", "text": "For the rest of the day, an empowered attack hurts the attacker by {times:counterpick.x} the bonus."}]},
  "The Rage-Quit Warlord": {"counters": "weaken", "moves": [
    {"key": "tilt", "name": "Tilt", "text": "Ends weaken. The boss enrages for {n:tilt.rounds} rounds."},
    {"key": "altf4", "name": "Alt-F4", "text": "Weaken has no effect for the rest of the day."},
    {"key": "spiral", "name": "Rage Spiral", "text": "For the rest of the day, each weaken you play makes the boss hit {pct:spiral.step} harder."},
    {"key": "flame", "name": "Flame", "text": "Hits every card, {times:flame.weaken_x} as hard on weaken cards."}]},
  "The Ranked Nightshade": {"counters": "expose", "moves": [
    {"key": "fade", "name": "Fade", "text": "Ends expose. Expose {works:fade.expose} for the rest of the day."},
    {"key": "veil", "name": "Veil", "text": "Expose has no effect for the rest of the day."},
    {"key": "demotion", "name": "Demotion", "text": "For the rest of the day, an attack on an exposed boss sends {pct:demotion.back} back."},
    {"key": "nightshade", "name": "Nightshade", "text": "Damage on expose cards for {n:nightshade.rounds} rounds."}]},
  "The Lagspike Parasite": {"counters": "stun", "moves": [
    {"key": "desync", "name": "Desync", "text": "Your next stun fails."},
    {"key": "rubberband", "name": "Rubberband", "text": "After your next stun, the boss hits {times:rubberband.hits}."},
    {"key": "lagspike", "name": "Lag Spike", "text": "Stun cards wait {n:lagspike.wait} more rounds."},
    {"key": "packetloss", "name": "Packet Loss", "text": "Your {plays:packetloss.plays}."}]},
  "The Netcode Mutant": {"counters": "smite", "moves": [
    {"key": "rollback", "name": "Rollback", "text": "The boss heals the damage of your last smite. Smite {works:rollback.smite} for the rest of the day."},
    {"key": "hitbox", "name": "Hitbox Desync", "text": "Smite does {pct:hitbox.smite} damage for the rest of the day."},
    {"key": "mirror", "name": "Mirror", "text": "Your next smite hits the smite card."},
    {"key": "pingspike", "name": "Ping Spike", "text": "Smite cards wait {n:pingspike.wait} more rounds."}]},
  "The Patch-Day Pumpkin": {"counters": "cleanse", "moves": [
    {"key": "hotfix", "name": "Hotfix", "text": "Curses the hit card. Cleanse cannot remove a curse for the rest of the day."},
    {"key": "rollout", "name": "Rollout", "text": "Curses every card in your squad."},
    {"key": "rot", "name": "Rot", "text": "For the rest of the day, a cleanse also removes empower and shields."},
    {"key": "patch", "name": "Patch", "text": "Cleanse cards wait {n:patch.wait} more rounds."}]},
  "The Ban-Wave Demon": {"counters": "support", "moves": [
    {"key": "ban", "name": "Ban", "text": "{cards:ban.cards} cannot play for the rest of the day."},
    {"key": "wave", "name": "Wave", "text": "Every support card waits {n:wave.wait} more rounds."},
    {"key": "appeal", "name": "Appeal Denied", "text": "Hits the last support card that played {times:appeal.hit_x} as hard."},
    {"key": "shadowban", "name": "Shadow Ban", "text": "Your {plays:shadowban.plays}."}]},
  "The Zerg-Rush Queen": {"counters": "support", "moves": [
    {"key": "swarm", "name": "Swarm", "text": "Hits every card, {times:swarm.support_x} as hard on support cards."},
    {"key": "brood", "name": "Brood", "text": "Hits every support card."},
    {"key": "rush", "name": "Rush", "text": "{hits:rush.hits} on the support card with the lowest HP."},
    {"key": "overrun", "name": "Overrun", "text": "Hits the weakest support card. If it goes down, the boss enrages."}]}
}$j$::jsonb
where key = 'hunt_boss_moves';

-- 4. The helpers.
-- One number of one counter move (fails closed: a missing number stops the action with an error).
create or replace function public.hunt_counter_num(p_move text, p_field text) returns numeric
language sql stable set search_path = public as $$ select balance_num('boss_counters', 'moves', p_move, p_field); $$;

-- The share of a support under a mark that has no "mult" (written before this file, or by Bloodrot, Decay, Fade
-- and Rollback, which read the share here when it is used): the balance value of the move that sets the mark.
create or replace function public.hunt_counter_mult(p_mark text) returns numeric
language plpgsql stable set search_path = public as $$
declare v numeric;
begin
  v := case p_mark
    when 'heal_block_card' then hunt_counter_num('bloodrot', 'heal')
    when 'half_heal' then hunt_counter_num('decay', 'heal')
    when 'half_expose' then hunt_counter_num('fade', 'expose')
    when 'half_smite' then hunt_counter_num('rollback', 'smite')
    when 'half_shield' then hunt_counter_num('shatter', 'shield')
    when 'half_empower' then hunt_counter_num('nerf', 'empower')
    when 'block_shield' then hunt_counter_num('calcify', 'shield')
    when 'block_empower' then hunt_counter_num('patchnotes', 'empower')
    when 'block_smite' then hunt_counter_num('hitbox', 'smite')
    when 'block_weaken' then 0   -- Alt-F4 blocks weaken (a rule, not a number)
    when 'block_expose' then 0   -- Veil blocks expose (a rule, not a number)
  end;
  if v is null then raise exception 'hunt_counter_mult: no balance value for the mark %', p_mark; end if;
  return v;
end $$;

-- A move text with its numbers from balance (the templates of section 3). An unknown format raises.
create or replace function public.hunt_counter_text(p_text text) returns text
language plpgsql stable set search_path = public as $$
declare m text[]; v numeric; n text; pct text; s text; r text := p_text;
begin
  for m in select regexp_matches(p_text, '\{([a-z]+):([a-z0-9_]+)\.([a-z0-9_]+)\}', 'g') loop
    v := hunt_counter_num(m[2], m[3]);
    n := trim_scale(v)::text;
    pct := trim_scale(round(v * 100, 1))::text || '%';
    s := case m[1]
      when 'pct' then pct
      when 'n' then n
      when 'times' then case v when 1 then 'once' when 2 then 'twice' else n || ' times' end
      when 'work' then case when v = 0 then 'have no effect' else 'work at ' || pct end
      when 'works' then case when v = 0 then 'has no effect' else 'works at ' || pct end
      when 'plays' then case when v = 1 then 'next support play does nothing' else 'next ' || n || ' support plays do nothing' end
      when 'cards' then case when v = 1 then '1 support card' else n || ' support cards' end
      when 'hits' then case when v = 1 then '1 hit' else n || ' hits' end
    end;
    if s is null then raise exception 'hunt_counter_text: unknown format % in %', m[1], p_text; end if;
    r := replace(r, '{' || m[1] || ':' || m[2] || '.' || m[3] || '}', s);
  end loop;
  return r;
end $$;

-- The counter moves of one boss for the boss details (the Activity, GET /api/hunt): [{name, text}] in pool order,
-- the texts with their numbers from balance. [] for a boss with no pool.
create or replace function public.hunt_boss_move_list(p_boss text) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', m->>'name', 'text', hunt_counter_text(m->>'text')) order by o), '[]'::jsonb)
    from settings s, jsonb_array_elements(case when jsonb_typeof(s.value->p_boss->'moves') = 'array' then s.value->p_boss->'moves' else '[]'::jsonb end) with ordinality x(m, o)
   where s.key = 'hunt_boss_moves';
$$;
revoke all on function public.hunt_counter_num(text, text), public.hunt_counter_mult(text), public.hunt_counter_text(text),
  public.hunt_boss_move_list(text) from public, anon, authenticated;

-- 5. hunt_counter_act: the LIVE text, the numbers from balance boss_counters.moves (hunt_counter_num).
CREATE OR REPLACE FUNCTION public.hunt_counter_act(p_hunt bigint, p_player text, p_day date, p_card bigint, p_round integer, p_atk numeric, p_bmult numeric, p_key text, p_name text, p_cardhp integer, p_maxhp integer, p_shield integer, p_ubuff numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_dmg int := 0; v_loss int := 0; v_pierce boolean := false; v_shield int; v_debuff numeric; v_heal int := 0;
  v_tg jsonb := '[]'; v_anim text := 'strike'; v_base boolean := true; v_marks jsonb; v_map jsonb; v_hit jsonb;
  r record; v_cid bigint; v_amt int; i int;
begin
  select coalesce(marks, '{}'::jsonb) into v_marks from hunt_combat_state where hunt_id = p_hunt and player_id = p_player and hit_date = p_day;
  case p_key
  -- The Grind Vampire (heal)
  when 'bloodrot' then
    v_anim := 'curse';
    perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('heal_block_card',
      coalesce(v_marks->'heal_block_card', '{}'::jsonb) || jsonb_build_object(p_card::text, jsonb_build_object('until', 999))));   -- the share: hunt_counter_mult (bloodrot.heal)
  when 'siphon' then
    v_anim := 'drain';
    select coalesce(sum(coalesce((a.result->>'gained')::int, (a.result->>'value')::int)), 0) into v_heal from combat_actions a
      where a.mode = 'hunt' and a.ref_id = p_hunt and a.player_id = p_player and a.game_day = p_day and a.effect = 'heal' and a.round >= p_round - 1;
  when 'feast' then
    select h.card_id, h.hp, h.max_hp, h.shield into r from hunt_squad_cards(p_hunt, p_player, p_day, p_card) h
      order by h.hp::numeric / greatest(1, h.max_hp), h.card_id limit 1;
    if r.card_id is not null and r.hp::numeric / greatest(1, r.max_hp) < p_cardhp::numeric / greatest(1, p_maxhp) then
      v_hit := hunt_counter_hit(p_hunt, p_player, p_day, r.card_id, combat_area_roll(p_atk, hunt_counter_num('feast', 'hit_x'), p_bmult), false);
      v_tg := v_tg || jsonb_build_array(v_hit);
    else
      v_dmg := combat_area_roll(p_atk, hunt_counter_num('feast', 'hit_x'), p_bmult); v_base := false;
    end if;
  when 'anemia' then
    v_anim := 'slam';
    for r in select * from hunt_squad_cards(p_hunt, p_player, p_day, p_card) loop
      v_hit := hunt_counter_hit(p_hunt, p_player, p_day, r.card_id, round(combat_area_roll(p_atk, hunt_counter_num('anemia', 'hit_x'), p_bmult) * case when r.eff = 'heal' then hunt_counter_num('anemia', 'heal_x') else 1 end)::int, false);
      if v_hit is not null then v_tg := v_tg || jsonb_build_array(v_hit); end if;
    end loop;
  -- The AFK Warzombie (heal)
  when 'decay' then
    v_anim := 'curse';
    select coalesce(sum(coalesce((a.result->>'gained')::int, (a.result->>'value')::int)), 0) into v_loss from combat_actions a
      where a.mode = 'hunt' and a.ref_id = p_hunt and a.player_id = p_player and a.game_day = p_day and a.effect = 'heal'
        and a.target_card = p_card and a.round >= p_round - 1;
    perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('half_heal', jsonb_build_object('until', 999)));   -- and heal works at decay.heal for the rest of the day (hunt_counter_mult)
  when 'infect' then
    v_anim := 'curse'; v_base := false; v_dmg := combat_area_roll(p_atk, hunt_counter_num('infect', 'hit_x'), p_bmult);
    perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('dot', coalesce(v_marks->'dot', '{}'::jsonb)
      || jsonb_build_object(p_card::text, jsonb_build_object('amt', combat_area_roll(p_atk, hunt_counter_num('infect', 'dot_x'), p_bmult), 'until', p_round + hunt_counter_num('infect', 'rounds')::int)),
      'heal_block_card', coalesce(v_marks->'heal_block_card', '{}'::jsonb) || jsonb_build_object(p_card::text, jsonb_build_object('until', 999, 'mult', 0))));   -- and no heals on it (a rule: it blocks)
  when 'groan' then
    v_anim := 'stun'; perform hunt_counter_cd(p_hunt, p_player, p_day, 'heal', hunt_counter_num('groan', 'wait')::int, p_round);
  when 'undying' then
    v_anim := 'regenerate'; perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('undying', jsonb_build_object('until', 999)));
  -- The Smurf Brute (shield)
  when 'shatter' then
    v_anim := 'slam'; v_map := '{}'::jsonb;
    for r in select * from hunt_squad_cards(p_hunt, p_player, p_day, p_card) where shield > 0 loop
      v_map := v_map || jsonb_build_object(r.card_id::text, r.shield);
      update hunt_card_hp set shield = 0, updated_at = now() where hunt_id = p_hunt and player_id = p_player and hit_date = p_day and card_id = r.card_id;
    end loop;
    if p_shield > 0 then v_map := v_map || jsonb_build_object(p_card::text, p_shield); v_shield := 0; end if;
    perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('shattered', v_map));
    perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('half_shield', jsonb_build_object('until', 999, 'mult', hunt_counter_num('shatter', 'shield'))));   -- and shields work at shatter.shield for the rest of the day
  when 'crush' then
    v_anim := 'slam'; v_map := coalesce(v_marks->'shattered', '{}'::jsonb);
    if v_map = '{}'::jsonb then
      null;   -- no Shatter today: only the usual turn
    else
      if v_map ? p_card::text then v_loss := greatest(1, floor((v_map->>p_card::text)::int * hunt_counter_num('crush', 'share'))::int); end if;
      for r in select * from hunt_squad_cards(p_hunt, p_player, p_day, p_card) where v_map ? card_id::text loop
        v_hit := hunt_counter_hit(p_hunt, p_player, p_day, r.card_id, greatest(1, floor((v_map->>r.card_id::text)::int * hunt_counter_num('crush', 'share'))::int), false);
        if v_hit is not null then v_tg := v_tg || jsonb_build_array(v_hit); end if;
      end loop;
      perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('shattered', '{}'::jsonb));
    end if;
  when 'bully' then
    select h.card_id, h.shield into r from hunt_squad_cards(p_hunt, p_player, p_day, p_card) h where h.shield > 0 order by h.shield desc, h.card_id limit 1;
    if p_shield > 0 and (r.card_id is null or p_shield >= r.shield) then
      v_dmg := combat_area_roll(p_atk, hunt_counter_num('bully', 'hit_x'), p_bmult); v_pierce := true; v_base := false;
    elsif r.card_id is not null then
      v_tg := v_tg || jsonb_build_array(hunt_counter_hit(p_hunt, p_player, p_day, r.card_id, combat_area_roll(p_atk, hunt_counter_num('bully', 'hit_x'), p_bmult), true));
    end if;
  when 'fakerank' then
    if p_shield > 0 then v_base := false; v_dmg := round(hunt_counter_num('fakerank', 'times') * combat_area_roll(p_atk, hunt_counter_num('fakerank', 'hit_x'), p_bmult))::int; end if;   -- no shield: the usual turn
  -- The Hardstuck Skeleton (shield)
  when 'bonepierce' then
    if p_shield > 0 then v_base := false; v_pierce := true; v_dmg := combat_area_roll(p_atk, hunt_counter_num('bonepierce', 'hit_x'), p_bmult); end if;   -- no shield: the usual turn
  when 'rattle' then
    v_anim := 'slam';
    update hunt_card_hp set shield = floor(coalesce(shield, 0) * hunt_counter_num('rattle', 'keep'))::int, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and hit_date = p_day and card_id <> p_card and not downed and coalesce(shield, 0) > 0;
    if p_shield > 0 then v_shield := floor(p_shield * hunt_counter_num('rattle', 'keep'))::int; end if;
    perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('half_shield', jsonb_build_object('until', 999, 'mult', hunt_counter_num('rattle', 'shield'))));   -- and shields work at rattle.shield for the rest of the day
  when 'calcify' then
    v_anim := 'curse'; perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('block_shield', jsonb_build_object('until', 999, 'mult', hunt_counter_num('calcify', 'shield'))));
  when 'stuck' then
    v_anim := 'stun'; perform hunt_counter_cd(p_hunt, p_player, p_day, 'shield', hunt_counter_num('stuck', 'wait')::int, p_round);
  -- Maw of the Meta (empower)
  when 'nerf' then
    v_anim := 'curse';
    update hunt_card_hp set dmg_buff = 1, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and hit_date = p_day and card_id <> p_card and coalesce(dmg_buff, 1) > 1;
    perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('half_empower', jsonb_build_object('until', 999, 'mult', hunt_counter_num('nerf', 'empower'))));   -- and empower works at nerf.empower for the rest of the day
  when 'patchnotes' then
    v_anim := 'curse'; perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('block_empower', jsonb_build_object('until', 999, 'mult', hunt_counter_num('patchnotes', 'empower'))));
  when 'tierlist' then
    if p_ubuff > 1 then   -- this attack used empower
      v_dmg := combat_area_roll(p_atk, hunt_counter_num('tierlist', 'hit_x'), p_bmult); v_base := false;
    else
      select h.card_id into v_cid from hunt_squad_cards(p_hunt, p_player, p_day, p_card) h where h.buff > 1 order by h.buff desc, h.card_id limit 1;
      if v_cid is not null then
        v_tg := v_tg || jsonb_build_array(hunt_counter_hit(p_hunt, p_player, p_day, v_cid, combat_area_roll(p_atk, hunt_counter_num('tierlist', 'hit_x'), p_bmult), false));
      end if;
    end if;
  when 'counterpick' then
    v_anim := 'curse'; perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('counterpick', jsonb_build_object('until', 999)));
  -- The Rage-Quit Warlord (weaken)
  when 'tilt' then
    v_anim := 'enrage';
    update hunt_combat_state set boss_weaken = 0, weaken_until = 0, boss_enrage = hunt_counter_num('tilt', 'enrage'), enrage_until = p_round + hunt_counter_num('tilt', 'rounds')::int, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and hit_date = p_day;
  when 'altf4' then
    v_anim := 'curse'; perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('block_weaken', jsonb_build_object('until', 999, 'mult', 0)));   -- a rule: it blocks
  when 'spiral' then
    v_anim := 'enrage'; perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('spiral', jsonb_build_object('until', 999, 'bonus', 0)));
  when 'flame' then
    v_anim := 'slam';
    for r in select * from hunt_squad_cards(p_hunt, p_player, p_day, p_card) loop
      v_hit := hunt_counter_hit(p_hunt, p_player, p_day, r.card_id, round(combat_area_roll(p_atk, hunt_counter_num('flame', 'hit_x'), p_bmult) * case when r.eff = 'weaken' then hunt_counter_num('flame', 'weaken_x') else 1 end)::int, false);
      if v_hit is not null then v_tg := v_tg || jsonb_build_array(v_hit); end if;
    end loop;
  -- The Ranked Nightshade (expose)
  when 'fade' then
    v_anim := 'curse';
    update hunt_combat_state set boss_expose = 0, expose_until = 0, updated_at = now() where hunt_id = p_hunt and player_id = p_player and hit_date = p_day;
    perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('half_expose', jsonb_build_object('until', 999)));   -- and expose works at fade.expose for the rest of the day (hunt_counter_mult)
  when 'veil' then
    v_anim := 'curse'; perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('block_expose', jsonb_build_object('until', 999, 'mult', 0)));   -- a rule: it blocks
  when 'demotion' then
    v_anim := 'curse'; perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('demotion', jsonb_build_object('until', 999)));
  when 'nightshade' then
    v_anim := 'curse'; v_map := coalesce(v_marks->'dot', '{}'::jsonb);
    for r in select * from hunt_squad_cards(p_hunt, p_player, p_day, p_card) where eff = 'expose' loop
      v_map := v_map || jsonb_build_object(r.card_id::text, jsonb_build_object('amt', combat_area_roll(p_atk, hunt_counter_num('nightshade', 'dot_x'), p_bmult), 'until', p_round + hunt_counter_num('nightshade', 'rounds')::int));
    end loop;
    perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('dot', v_map));
  -- The Lagspike Parasite (stun)
  when 'desync' then
    v_anim := 'curse'; perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('stun_fail', true));
  when 'rubberband' then
    v_anim := 'enrage'; perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('rubberband', true));
  when 'rubberband_hit' then   -- the turn after a stun, set up by Rubberband (hunt_attack calls it)
    v_base := false; v_dmg := 0;
    for i in 1..hunt_counter_num('rubberband', 'hits')::int loop v_dmg := v_dmg + combat_area_roll(p_atk, hunt_counter_num('rubberband', 'hit_x'), p_bmult); end loop;
    update hunt_combat_state set marks = marks - 'double_next', updated_at = now() where hunt_id = p_hunt and player_id = p_player and hit_date = p_day;
  when 'lagspike' then
    v_anim := 'stun'; perform hunt_counter_cd(p_hunt, p_player, p_day, 'stun', hunt_counter_num('lagspike', 'wait')::int, p_round);
  when 'packetloss' then
    v_anim := 'curse'; perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('null_next', hunt_counter_num('packetloss', 'plays')::int));
  -- The Netcode Mutant (smite)
  when 'rollback' then
    v_anim := 'drain';
    select coalesce((a.result->>'value')::int, 0) into v_heal from combat_actions a
      where a.mode = 'hunt' and a.ref_id = p_hunt and a.player_id = p_player and a.game_day = p_day and a.effect = 'smite'
        and not coalesce((a.result->>'mirrored')::boolean, false)
      order by a.id desc limit 1;
    v_heal := coalesce(v_heal, 0);
    perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('half_smite', jsonb_build_object('until', 999)));   -- and smite works at rollback.smite for the rest of the day (hunt_counter_mult)
  when 'hitbox' then
    v_anim := 'curse'; perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('block_smite', jsonb_build_object('until', 999, 'mult', hunt_counter_num('hitbox', 'smite'))));
  when 'mirror' then
    v_anim := 'curse'; perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('mirror', true));
  when 'pingspike' then
    v_anim := 'stun'; perform hunt_counter_cd(p_hunt, p_player, p_day, 'smite', hunt_counter_num('pingspike', 'wait')::int, p_round);
  -- The Patch-Day Pumpkin (cleanse)
  when 'hotfix' then
    v_anim := 'curse'; v_debuff := hunt_counter_num('hotfix', 'curse');
    perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('lock_cleanse', jsonb_build_object('until', 999)));
  when 'rollout' then
    v_anim := 'curse'; v_debuff := hunt_counter_num('rollout', 'curse');
    update hunt_card_hp set dmg_debuff = hunt_counter_num('rollout', 'curse'), updated_at = now() where hunt_id = p_hunt and player_id = p_player and hit_date = p_day and card_id <> p_card and not downed;
  when 'rot' then
    v_anim := 'curse'; perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('rot', jsonb_build_object('until', 999)));
  when 'patch' then
    v_anim := 'stun'; perform hunt_counter_cd(p_hunt, p_player, p_day, 'cleanse', hunt_counter_num('patch', 'wait')::int, p_round);
  -- The Ban-Wave Demon (all supports)
  when 'ban' then
    v_anim := 'stun';
    for v_cid in select h.card_id from hunt_squad_cards(p_hunt, p_player, p_day, p_card) h where h.kind = 'support' and coalesce((select x.cd_until_round from hunt_card_hp x
        where x.hunt_id = p_hunt and x.player_id = p_player and x.hit_date = p_day and x.card_id = h.card_id), 0) < 999 order by random() limit hunt_counter_num('ban', 'cards')::int loop
      update hunt_card_hp set cd_until_round = greatest(coalesce(cd_until_round, 0), p_round) + 999, updated_at = now()   -- the rest of the day
        where hunt_id = p_hunt and player_id = p_player and hit_date = p_day and card_id = v_cid;
    end loop;
  when 'wave' then
    v_anim := 'stun'; perform hunt_counter_cd(p_hunt, p_player, p_day, null, hunt_counter_num('wave', 'wait')::int, p_round);
  when 'appeal' then
    select a.card_id into v_cid from combat_actions a
      where a.mode = 'hunt' and a.ref_id = p_hunt and a.player_id = p_player and a.game_day = p_day and a.kind = 'support'
      order by a.id desc limit 1;
    if v_cid is not null then
      v_hit := hunt_counter_hit(p_hunt, p_player, p_day, v_cid, combat_area_roll(p_atk, hunt_counter_num('appeal', 'hit_x'), p_bmult), false);
      if v_hit is not null then v_tg := v_tg || jsonb_build_array(v_hit); end if;
    end if;
  when 'shadowban' then
    v_anim := 'curse'; perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('null_next', hunt_counter_num('shadowban', 'plays')::int));   -- the next support plays
  -- The Zerg-Rush Queen (all supports)
  when 'swarm' then
    v_anim := 'slam';
    for r in select * from hunt_squad_cards(p_hunt, p_player, p_day, p_card) loop
      v_hit := hunt_counter_hit(p_hunt, p_player, p_day, r.card_id, round(combat_area_roll(p_atk, hunt_counter_num('swarm', 'hit_x'), p_bmult) * case when r.kind = 'support' then hunt_counter_num('swarm', 'support_x') else 1 end)::int, false);
      if v_hit is not null then v_tg := v_tg || jsonb_build_array(v_hit); end if;
    end loop;
  when 'brood' then
    v_anim := 'slam';
    for r in select * from hunt_squad_cards(p_hunt, p_player, p_day, p_card) where kind = 'support' loop
      v_hit := hunt_counter_hit(p_hunt, p_player, p_day, r.card_id, combat_area_roll(p_atk, hunt_counter_num('brood', 'hit_x'), p_bmult), false);
      if v_hit is not null then v_tg := v_tg || jsonb_build_array(v_hit); end if;
    end loop;
  when 'rush', 'overrun' then
    select h.card_id into v_cid from hunt_squad_cards(p_hunt, p_player, p_day, p_card) h where h.kind = 'support'
      order by h.hp::numeric / greatest(1, h.max_hp), h.card_id limit 1;
    if v_cid is not null then
      if p_key = 'rush' then
        v_amt := 0;
        for i in 1..hunt_counter_num('rush', 'hits')::int loop v_amt := v_amt + combat_area_roll(p_atk, hunt_counter_num('rush', 'hit_x'), p_bmult); end loop;
      else
        v_amt := combat_area_roll(p_atk, hunt_counter_num('overrun', 'hit_x'), p_bmult);
      end if;
      v_hit := hunt_counter_hit(p_hunt, p_player, p_day, v_cid, v_amt, false);
      v_tg := v_tg || jsonb_build_array(v_hit);
      if p_key = 'overrun' and coalesce((v_hit->>'downed')::boolean, false) then
        v_anim := 'enrage';
        update hunt_combat_state set boss_enrage = hunt_counter_num('overrun', 'enrage'), enrage_until = p_round + hunt_counter_num('overrun', 'rounds')::int, updated_at = now() where hunt_id = p_hunt and player_id = p_player and hit_date = p_day;
      end if;
    end if;
  else
    raise exception 'hunt_counter_act: unknown move %', p_key;
  end case;
  return jsonb_build_object('action', 'counter', 'key', p_key, 'move', p_name, 'anim', v_anim, 'base', v_base, 'dmg', v_dmg, 'loss', v_loss,
    'pierce', v_pierce, 'shield', v_shield, 'debuff', v_debuff, 'heal', v_heal, 'targets', v_tg);
end $function$;

-- 6. hunt_counter_pick: the LIVE text, the share and the weights from balance boss_counters (the pool stays in settings).
CREATE OR REPLACE FUNCTION public.hunt_counter_pick(p_hunt bigint, p_player text, p_day date, p_boss text, p_act text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_cfg jsonb; v_pool jsonb; v_marks jsonb; v_total numeric; v_r numeric; m jsonb; v_ctrs text; v_bal jsonb;
begin
  select value into v_cfg from settings where key = 'hunt_boss_moves';
  v_pool := v_cfg->p_boss->'moves';
  if v_pool is null or jsonb_typeof(v_pool) <> 'array' or jsonb_array_length(v_pool) = 0 then return null; end if;
  select coalesce(marks, '{}'::jsonb) into v_marks from hunt_combat_state where hunt_id = p_hunt and player_id = p_player and hit_date = p_day;
  if p_act = 'stunned' then
    if coalesce((v_marks->>'rubberband')::boolean, false) then
      update hunt_combat_state set marks = (marks - 'rubberband') || '{"double_next": true}'::jsonb, updated_at = now()
        where hunt_id = p_hunt and player_id = p_player and hit_date = p_day;
    end if;
    return null;
  end if;
  if p_act in ('charging', 'cataclysm') then return null; end if;
  if coalesce((v_marks->>'double_next')::boolean, false) then
    return jsonb_build_object('key', 'rubberband_hit', 'name', 'Rubberband');
  end if;
  -- A squad with none of the countered support meets the usual boss (Nathan, 2026-10-06: cut the support, not the squad).
  v_ctrs := v_cfg->p_boss->>'counters';
  if v_ctrs is not null and not exists (select 1 from hunt_card_hp h join cards c on c.id = h.card_id join subjects s on s.id = c.subject_id
      where h.hunt_id = p_hunt and h.player_id = p_player and h.hit_date = p_day and s.ability->>'kind' = 'support'
        and (v_ctrs = 'support' or s.ability->>'effect' = v_ctrs)) then return null; end if;
  -- The share of the normal turns (balance boss_counters): the boss's own share (boss_share), else share.
  -- The pool (the move keys) is content in settings.hunt_boss_moves; the weights are balance boss_counters.weights.
  v_bal := balance_get('boss_counters');
  if random() >= coalesce((v_bal->'boss_share'->>p_boss)::numeric, balance_num('boss_counters', 'share')) then return null; end if;
  select sum(balance_num('boss_counters', 'weights', e->>'key')) into v_total from jsonb_array_elements(v_pool) e;
  v_r := random() * v_total;
  for m in select e from jsonb_array_elements(v_pool) e loop
    v_r := v_r - balance_num('boss_counters', 'weights', m->>'key');
    if v_r <= 0 then return jsonb_build_object('key', m->>'key', 'name', m->>'name'); end if;
  end loop;
  return jsonb_build_object('key', v_pool->-1->>'key', 'name', v_pool->-1->>'name');
end $function$;

-- 7. hunt_attack: the LIVE text, Counter-pick and Demotion from balance boss_counters.
CREATE OR REPLACE FUNCTION public.hunt_attack(p_player text, p_hunt bigint, p_card bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_rcap int;
  v_status text; v_closes timestamptz; v_weak jsonb; v_tier text;
  v_qty int; v_asc int; v_rarity text; v_season text; v_type text; v_mod numeric; v_cardname text;
  v_cp int; v_bonus boolean; v_day date; v_hp bigint; v_hpmax bigint;
  v_maxhp int; v_cardhp int; v_downed boolean;
  v_miss boolean; v_crit boolean; v_block boolean; v_outcome text;
  v_base numeric; v_dmg int;
  v_counter boolean; v_cdmg int; v_tmult numeric;
  v_feed text; v_settle jsonb; v_milestone boolean;
  v_total bigint; v_used int; v_topcard text; v_topdmg bigint; v_cap int;
  v_bossact text; v_slam jsonb; v_round int; v_targets jsonb;
  v_ability jsonb; v_aeff text; v_aamt numeric; v_athresh numeric; v_heal int;
  v_buff numeric; v_debuff numeric; v_shield int; v_absorb int; v_critchance numeric;
  v_enrage numeric; v_enr_until int; v_weaken numeric; v_wk_until int; v_expose numeric; v_exp_until int; v_stun_until int;
  v_bmult numeric; v_r numeric;
  v_resist jsonb; v_tags text[]; v_wtags text[]; v_wm int; v_rm int; v_stack int; v_wmult numeric;
  v_plist text[]; v_share bigint; v_bheal int; v_lost numeric; v_phase text; v_extra text; v_stunned_card boolean;
  v_passive jsonb; v_pk text; v_elem text; v_syn int; v_synmult numeric; v_burn int; v_burned boolean;
  v_origin text; v_osyn int; v_omult numeric; v_ksyn int; v_kmult numeric;
  v_stats jsonb; v_atk numeric; v_pts jsonb; v_cmb jsonb;
  v_double boolean := false; v_rally numeric; v_mend numeric; v_bf numeric;
  v_party jsonb; v_crash jsonb; v_crash_dmg int := 0; v_crash_to text; v_crash_card bigint;
  v_crash_fb boolean := false; v_crash_round int; v_clog bigint;
  v_sq jsonb; v_wk jsonb; v_hit jsonb; v_act jsonb; v_ab jsonb; v_area numeric;
  v_bname text; v_marks jsonb; v_pick jsonb; v_ctr jsonb; v_tick jsonb; v_ubuff numeric := 1;
begin
  select status, closes_at, weak_points, resist_points, tier, hp_max, passive, coalesce(hp_share, hp_max), stats, hp_remaining, name
    into v_status, v_closes, v_weak, v_resist, v_tier, v_hpmax, v_passive, v_share, v_stats, v_hp, v_bname
    from hunts where id = p_hunt for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_hunt'); end if;
  if v_status <> 'active' or now() >= v_closes then
    return jsonb_build_object('ok', false, 'error', 'hunt_over'); end if;
  v_pk := v_passive->>'kind';
  -- Every passive the boss has (passive.list; an older hunt has only passive.kind).
  select coalesce(array_agg(x->>'kind'), array[v_pk]) into v_plist
    from jsonb_array_elements(coalesce(v_passive->'list', '[]'::jsonb)) x;
  v_plist := array_remove(v_plist, null);

  select pc.quantity, pc.ascension, c.rarity::text, c.season, s.type, s.cp_mod, c.name, s.ability, s.tag_slugs, pc.stat_points
    into v_qty, v_asc, v_rarity, v_season, v_type, v_mod, v_cardname, v_ability, v_tags, v_pts
  from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
  where pc.player_id = p_player and pc.card_id = p_card;
  if not found or v_qty < 1 then return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;
  if v_type not in ('Character', 'Creature') then
    return jsonb_build_object('ok', false, 'error', 'not_attacker', 'card_type', v_type);
  end if;

  v_day := (now() at time zone 'America/Denver')::date;
  -- One squad per day (hunt_squads.sql): a locked squad fights only with its own cards.
  if not hunt_squad_allows(p_hunt, p_player, v_day, p_card) then
    return jsonb_build_object('ok', false, 'error', 'not_in_squad');
  end if;
  -- The round limit (hunt_loop_caps.sql): a squad fights at most hunt_round_cap rounds a day.
  v_rcap := hunt_round_cap();
  if coalesce((select round from hunt_combat_state where hunt_id = p_hunt and player_id = p_player and hit_date = v_day), 0) >= v_rcap then
    return jsonb_build_object('ok', false, 'error', 'round_cap', 'cap', v_rcap);
  end if;
  -- The stat points of this copy (stat_points.sql). With the flag off: card_power + card_max_hp.
  v_cmb := card_combat(v_rarity, v_asc, v_mod, v_pts);
  v_cp := (v_cmb->>'cp')::int;
  v_maxhp := (v_cmb->>'hp')::int;

  select hp_remaining, downed, coalesce(dmg_buff, 1), coalesce(dmg_debuff, 1), coalesce(shield, 0)
    into v_cardhp, v_downed, v_buff, v_debuff, v_shield
    from hunt_card_hp where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = v_day;
  if not found then
    v_cardhp := v_maxhp; v_downed := false; v_buff := 1; v_debuff := 1; v_shield := 0;
    v_cap := hunt_card_cap();
    if (select count(*) from hunt_card_hp where hunt_id = p_hunt and player_id = p_player and hit_date = v_day) >= v_cap then
      return jsonb_build_object('ok', false, 'error', 'day_limit', 'cap', v_cap);
    end if;
  else
    v_cap := hunt_card_cap();
  end if;
  if v_downed or v_cardhp <= 0 then
    return jsonb_build_object('ok', false, 'error', 'downed', 'card_hp', 0, 'card_max_hp', v_maxhp);
  end if;

  v_round := hunt_state_round(p_hunt, p_player, v_day);
  select coalesce(cd_until_round, 0) >= v_round + 1 into v_stunned_card
    from hunt_card_hp where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = v_day;
  if coalesce(v_stunned_card, false) and (
       exists (select 1 from hunt_card_hp h where h.hunt_id = p_hunt and h.player_id = p_player and h.hit_date = v_day
               and h.card_id <> p_card and not h.downed and coalesce(h.cd_until_round, 0) < v_round + 1
               and exists (select 1 from cards c join subjects s on s.id = c.subject_id where c.id = h.card_id and s.type in ('Character', 'Creature')))
       or (select count(*) from hunt_card_hp where hunt_id = p_hunt and player_id = p_player and hit_date = v_day) < v_cap) then
    return jsonb_build_object('ok', false, 'error', 'stunned', 'ready_round', v_round + 2);
  end if;
  -- Mend (a boon): the first hurt card that attacks heals the waiting amount first
  -- (after the downed / stunned checks, so a refused attack keeps the boon).
  if v_cardhp < v_maxhp then
    v_mend := take_player_effect(p_player, 'mend');
    if v_mend is not null then v_cardhp := least(v_maxhp, v_cardhp + greatest(1, round(v_mend))::int); end if;
  end if;
  select boss_enrage, enrage_until, boss_weaken, weaken_until, boss_expose, expose_until, stunned_until, marks
    into v_enrage, v_enr_until, v_weaken, v_wk_until, v_expose, v_exp_until, v_stun_until, v_marks
    from hunt_combat_state where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;

  v_aeff := case when v_ability->>'kind' = 'attack' then v_ability->>'effect' else null end;
  v_aamt := coalesce((v_ability->>'amount')::numeric, 0);
  v_athresh := coalesce((v_ability->>'threshold')::numeric, 0);

  -- The squad in this fight (combat_core.sql: combat_squad): the other cards and their tags.
  v_sq := combat_squad(v_tags,
    exists (select 1 from hunt_card_hp where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = v_day),
    (select coalesce(jsonb_agg(to_jsonb(s.tag_slugs)), '[]'::jsonb)
       from (select distinct h.card_id from hunt_card_hp h where h.hunt_id = p_hunt and h.player_id = p_player and h.hit_date = v_day and h.card_id <> p_card) hc
       join cards c on c.id = hc.card_id join subjects s on s.id = c.subject_id),
    v_weak);
  v_stack := (v_sq->>'stack')::int;
  v_wk := combat_weak(v_weak, v_resist, v_type, v_rarity, v_season, v_tags, v_stack);
  v_wm := (v_wk->>'wm')::int; v_rm := (v_wk->>'rm')::int; v_wmult := (v_wk->>'mult')::numeric;
  v_bonus := v_wm > 0;
  v_elem := v_sq->>'elem'; v_syn := (v_sq->>'syn')::int; v_synmult := (v_sq->>'synmult')::numeric;

  v_critchance := combat_crit_chance(v_bonus, v_aeff, v_aamt, v_cmb);
  v_hit := combat_hit(v_cp, v_wmult, v_buff, v_debuff, v_synmult, v_critchance,
    combat_miss('shrouded' = any(v_plist)),                                          -- shrouded: more misses
    v_aeff, v_aamt, v_athresh, 'armored' = any(v_plist) and 'trait:melee' = any(v_tags),
    case when v_exp_until >= v_round and v_expose > 0 and not hunt_mark_on(v_marks, 'block_expose', v_round) then v_expose else 0 end, v_hp, v_hpmax);   -- Veil (hunt_boss_moves.sql)
  v_miss := (v_hit->>'miss')::boolean; v_crit := (v_hit->>'crit')::boolean; v_block := (v_hit->>'block')::boolean;
  v_dmg := (v_hit->>'dmg')::int; v_outcome := v_hit->>'outcome'; v_double := (v_hit->>'double')::boolean;
  if not v_miss then
    -- Rally (a boon): the next hit deals +amount % (the boon is used up by this hit).
    v_rally := take_player_effect(p_player, 'rally');
    if v_rally is not null then v_dmg := greatest(1, round(v_dmg * (1 + least(v_rally, balance_num('combat', 'effect_cap_pct')) / 100.0))); end if;
    -- Butterfingers (a prank, effects_outside.sql): the next hit deals -amount % (used up by this hit).
    v_bf := take_player_effect(p_player, 'butterfingers');
    if v_bf is not null and v_dmg > 0 then v_dmg := greatest(1, round(v_dmg * (1 - least(v_bf, balance_num('combat', 'effect_cap_pct')) / 100.0))); end if;
    -- Launch Party (the Launch Day Player boon, launch_event_cards.sql): +amount % on each of the
    -- next N hits (options.uses), one charge per hit.
    v_party := use_effect_charge(p_player, 'launch_party');
    if v_party is not null then v_dmg := greatest(1, round(v_dmg * (1 + least((v_party->>'amount')::numeric, balance_num('combat', 'effect_cap_pct')) / 100.0))); end if;
    -- Raid Crasher (the Launch Day Raider prank): the boss takes +amount % more on each of the next N
    -- hits, and that extra damage counts for the prankster (options.credit_to) on the leaderboard.
    v_crash := use_effect_charge(p_player, 'raid_crasher');
    if v_crash is not null then
      v_crash_dmg := greatest(1, round(v_dmg * least((v_crash->>'amount')::numeric, balance_num('combat', 'effect_cap_pct')) / 100.0))::int;
      v_crash_to := coalesce(v_crash->'options'->>'credit_to', v_crash->'options'->>'sender_id');
      v_crash_card := (v_crash->'options'->>'card_id')::bigint;
      -- No owner or no card (damage_log.sql): the extra damage still hits the boss, so the attacker gets the credit on
      -- the attacking card. Boss HP and hunt_hits then agree; the log row says fallback.
      if v_crash_to is null or v_crash_card is null then
        v_crash_to := p_player; v_crash_card := p_card; v_crash_fb := true;
      end if;
      v_crash_round := v_round;
    end if;
  end if;

  if v_dmg > 0 then
    insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage)
      values (p_hunt, p_player, p_card, v_day, v_dmg)
      on conflict (hunt_id, player_id, card_id, hit_date)
      do update set damage = hunt_hits.damage + excluded.damage;
    -- The Raid Crasher share: the prankster's own hunt_hits row (their Raider card), so it counts
    -- for the leaderboard and the prizes.
    if v_crash_dmg > 0 and v_crash_to is not null and v_crash_card is not null then
      insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage)
        values (p_hunt, v_crash_to, v_crash_card, v_day, v_crash_dmg)
        on conflict (hunt_id, player_id, card_id, hit_date)
        do update set damage = hunt_hits.damage + excluded.damage;
    end if;
    update hunts set hp_remaining = greatest(0, hp_remaining - v_dmg - v_crash_dmg),
      status      = case when hp_remaining - v_dmg - v_crash_dmg <= 0 then 'defeated' else status end,
      defeated_at = case when hp_remaining - v_dmg - v_crash_dmg <= 0 then now() else defeated_at end
      where id = p_hunt;
  end if;
  select hp_remaining, status into v_hp, v_status from hunts where id = p_hunt;

  v_heal := 0;
  if v_aeff = 'lifesteal' and v_dmg > 0 then
    v_heal := combat_lifesteal(v_dmg, v_aamt, v_maxhp);  -- cap: lifesteal cannot out-heal the boss
    v_cardhp := least(v_maxhp, v_cardhp + v_heal);
  end if;
  -- Counter marks on this attack (hunt_boss_moves.sql): Counter-pick (an empowered attack hurts the attacker by the
  -- bonus x counterpick.x) and Demotion (an attack on an exposed boss sends demotion.back back): balance boss_counters.
  if v_dmg > 0 and v_buff > 1 and hunt_mark_on(v_marks, 'counterpick', v_round) then
    v_cardhp := greatest(0, v_cardhp - greatest(1, round(hunt_counter_num('counterpick', 'x') * v_dmg * (v_buff - 1) / v_buff))::int);
  end if;
  if v_dmg > 0 and v_exp_until >= v_round and v_expose > 0 and hunt_mark_on(v_marks, 'demotion', v_round)
     and not hunt_mark_on(v_marks, 'block_expose', v_round) then
    v_cardhp := greatest(0, v_cardhp - greatest(1, round(v_dmg * hunt_counter_num('demotion', 'back')))::int);
  end if;
  v_ubuff := v_buff;   -- the empower this attack used (Tier List)
  v_buff := 1;

  -- The boss ATK (Nathan, 2026-09-28: flat stats, so tougher cards survive more hits).
  -- hunts.stats.atk is set at spawn; an older hunt uses the tier default.
  v_atk := coalesce((v_stats->>'atk')::numeric, balance_num('boss_atk', v_tier));
  v_bossact := null; v_cdmg := 0; v_slam := '[]'::jsonb;
  if v_status <> 'defeated' then
    update hunt_combat_state set round = round + 1, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and hit_date = v_day
      returning round into v_round;
    -- Phase 1 below 50% HP: permanent rage. Frenzied: +5% per 10% of HP lost (combat_enemy_mult).
    v_lost := 1 - v_hp::numeric / greatest(1, v_hpmax);
    v_bmult := combat_enemy_mult(v_enrage, v_enr_until,
      case when hunt_mark_on(v_marks, 'block_weaken', v_round) then 0 else v_weaken end,   -- Alt-F4 (hunt_boss_moves.sql)
      v_wk_until, v_round, 'volatile' = any(v_plist), v_lost, 'frenzied' = any(v_plist));
    if hunt_mark_on(v_marks, 'spiral', v_round) then   -- Rage Spiral: + spiral.step for each weaken played
      v_bmult := v_bmult * (1 + coalesce((v_marks->'spiral'->>'bonus')::numeric, 0));
    end if;
    v_bheal := 0;

    -- The enemy turn (combat_core.sql: combat_enemy_act): a surprise draw.
    -- The damage-over-time marks tick first (hunt_boss_moves.sql: Infect, Nightshade).
    v_tick := hunt_counter_tick(p_hunt, p_player, v_day, p_card, v_round);
    if (v_tick->>'attacker')::int > 0 then
      v_ab := combat_absorb(v_shield, (v_tick->>'attacker')::int); v_shield := (v_ab->>'shield')::int;
      v_cardhp := greatest(0, v_cardhp - (v_ab->>'dmg')::int);
    end if;
    v_act := combat_enemy_act(v_atk, v_bmult, v_round, v_stun_until, v_lost, v_share);
    v_bossact := v_act->>'action'; v_cdmg := (v_act->>'dmg')::int; v_area := (v_act->>'area')::numeric;
    v_bheal := v_bheal + (v_act->>'heal')::int;
    -- A counter move (hunt_boss_moves.sql): a share of the normal turns of a boss with a move pool (balance boss_counters). An effect move comes on
    -- top of the usual turn (base); a hit move replaces it.
    v_pick := hunt_counter_pick(p_hunt, p_player, v_day, v_bname, v_bossact);
    if v_pick is not null then
      v_ctr := hunt_counter_act(p_hunt, p_player, v_day, p_card, v_round, v_atk, v_bmult, v_pick->>'key', v_pick->>'name',
        v_cardhp, v_maxhp, v_shield, v_ubuff);
      if v_ctr->>'shield' is not null then v_shield := (v_ctr->>'shield')::int; end if;
      if v_ctr->>'debuff' is not null then v_debuff := (v_ctr->>'debuff')::numeric; end if;
      v_cardhp := greatest(0, v_cardhp - (v_ctr->>'loss')::int);
      v_bheal := v_bheal + (v_ctr->>'heal')::int;
      if not (v_ctr->>'base')::boolean then   -- a hit move: no usual turn
        v_bheal := v_bheal - (v_act->>'heal')::int;
        v_bossact := 'counter'; v_area := 0; v_cdmg := (v_ctr->>'dmg')::int;
        if not (v_ctr->>'pierce')::boolean then
          v_ab := combat_absorb(v_shield, v_cdmg); v_shield := (v_ab->>'shield')::int; v_cdmg := (v_ab->>'dmg')::int;
        end if;
        v_cardhp := greatest(0, v_cardhp - v_cdmg);
      end if;
    end if;
    if v_bossact in ('cataclysm', 'strike', 'slam', 'drain', 'stun') then
      v_ab := combat_absorb(v_shield, v_cdmg); v_shield := (v_ab->>'shield')::int; v_cdmg := (v_ab->>'dmg')::int;
      v_cardhp := greatest(0, v_cardhp - v_cdmg);
    end if;
    if v_area > 0 then   -- Slam / Cataclysm: every other card standing rolls its own hit
      with tgt as (
        select h.card_id, greatest(0, h.raw - coalesce(h.shield, 0)) as dmg,
               greatest(0, coalesce(h.shield, 0) - h.raw) as shleft
               from (select x.*, combat_area_roll(v_atk, v_area, v_bmult) as raw
                     from hunt_card_hp x
                     where x.hunt_id = p_hunt and x.player_id = p_player and x.hit_date = v_day and x.card_id <> p_card and not x.downed) h
      ), upd as (
        update hunt_card_hp h set hp_remaining = greatest(0, h.hp_remaining - t.dmg),
            shield = t.shleft, downed = (h.hp_remaining - t.dmg) <= 0, updated_at = now()
        from tgt t where h.hunt_id = p_hunt and h.player_id = p_player and h.hit_date = v_day and h.card_id = t.card_id
        returning h.card_id, h.hp_remaining, h.max_hp, h.downed, t.dmg
      )
      select coalesce(jsonb_agg(jsonb_build_object('card_id', card_id, 'dmg', dmg, 'hp', hp_remaining, 'max_hp', max_hp, 'downed', downed)), '[]'::jsonb)
        into v_slam from upd;
    end if;
    if v_bossact = 'enrage' then
      update hunt_combat_state set boss_enrage = balance_num('boss_moves', 'enrage_x'), enrage_until = v_round + balance_num('boss_moves', 'enrage_rounds')::int, updated_at = now()
        where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
    elsif v_bossact = 'curse' then
      v_debuff := balance_num('boss_moves', 'curse_x');
    end if;
    if 'regenerating' = any(v_plist) and v_bossact <> 'stunned' then v_bheal := v_bheal + combat_regen(v_share); end if;
    if 'thorns' = any(v_plist) and v_dmg > 0 then
      v_cardhp := greatest(0, v_cardhp - combat_thorns(v_dmg));
    end if;
    if v_bheal > 0 then
      update hunts set hp_remaining = least(hp_max, hp_remaining + v_bheal) where id = p_hunt and status = 'active'
        returning hp_remaining into v_hp;
    end if;
    -- Phase 2 below boss_moves.phase2_at HP: the boss gains one more passive (once per hunt).
    v_phase := null;
    if v_hp::numeric / greatest(1, v_hpmax) < balance_num('boss_moves', 'phase2_at') and not coalesce((v_passive->>'phase2')::boolean, false) then
      select k into v_extra from unnest(array['armored','shrouded','flaming','volatile','regenerating','thorns','frenzied']) k
        where k <> all(v_plist) order by random() limit 1;
      update hunts set passive = coalesce(passive, '{}'::jsonb) || jsonb_build_object('phase2', true,
          'list', coalesce(passive->'list', '[]'::jsonb) || case when v_extra is null then '[]'::jsonb
            else jsonb_build_array(jsonb_build_object('kind', v_extra, 'label', case v_extra
              when 'armored' then 'Armored: melee attackers deal less' when 'shrouded' then 'Shrouded: attacks miss more often'
              when 'flaming' then 'Flaming: burns the attacking card' when 'volatile' then 'Volatile: counterattacks hit harder'
              when 'regenerating' then 'Regenerating: heals a little every turn' when 'thorns' then 'Thorns: part of your damage comes back to your card'
              else 'Frenzied: hits harder as it loses HP' end)) end)
        where id = p_hunt;
      v_phase := coalesce(v_extra, 'phase2');
    elsif (v_hp + v_dmg)::numeric / greatest(1, v_hpmax) >= balance_num('boss_moves', 'rage_at') and v_hp::numeric / greatest(1, v_hpmax) < balance_num('boss_moves', 'rage_at') then
      v_phase := 'rage';                            -- this hit took the boss below rage_at
    end if;
  end if;

  -- Flaming boss: a chance the attacking card catches burn after acting.
  v_burned := false;
  if 'flaming' = any(v_plist) and v_status <> 'defeated' then
    v_burn := combat_burn(v_atk);
    if v_burn > 0 then
      v_ab := combat_absorb(v_shield, v_burn); v_shield := (v_ab->>'shield')::int; v_burn := (v_ab->>'dmg')::int;
      v_cardhp := greatest(0, v_cardhp - v_burn); v_burned := v_burn > 0;
    end if;
  end if;

  v_downed := v_cardhp <= 0;
  v_counter := v_bossact is not null and v_bossact not in ('stunned', 'enrage', 'curse', 'regenerate', 'charging');

  insert into hunt_card_hp (hunt_id, player_id, card_id, hit_date, hp_remaining, max_hp, downed, dmg_buff, dmg_debuff, shield, cd_until_round)
    values (p_hunt, p_player, p_card, v_day, v_cardhp, v_maxhp, v_downed, v_buff, v_debuff, v_shield,
            case when v_bossact = 'stun' then v_round + 1 else 0 end)
    on conflict (hunt_id, player_id, card_id, hit_date)
    do update set hp_remaining = excluded.hp_remaining, downed = excluded.downed,
      dmg_buff = excluded.dmg_buff, dmg_debuff = excluded.dmg_debuff, shield = excluded.shield,
      cd_until_round = greatest(excluded.cd_until_round, hunt_card_hp.cd_until_round), updated_at = now();

  insert into hunt_combat_log (hunt_id, player_id, card_id, cp, outcome, bonus, crit, block,
    damage, countered, counter_dmg, card_hp_after, card_downed, boss_hp_after)
  values (p_hunt, p_player, p_card, v_cp, v_outcome, v_bonus, v_crit, v_block,
    v_dmg, v_counter, v_cdmg, v_cardhp, v_downed, v_hp)
  returning id into v_clog;

  -- The Hunt Crasher log row (damage_log.sql): the extra damage that hunt_hits credits to the prankster's Raider card.
  -- amount = the charge amount (%), result.value = the damage, combat_log_id = the attack it rode on.
  if v_dmg > 0 and v_crash_dmg > 0 then
    insert into combat_actions (mode, ref_id, player_id, card_id, kind, game_day, round, effect, amount, result)
    values ('hunt', p_hunt, v_crash_to, v_crash_card, 'effect', v_day, v_crash_round, 'raid_crasher', (v_crash->>'amount')::numeric,
      jsonb_build_object('value', v_crash_dmg, 'attacker', p_player, 'attack_card', p_card, 'combat_log_id', v_clog, 'fallback', v_crash_fb));
  end if;

  if v_status = 'defeated' then
    v_settle := settle_hunt(p_hunt);
    insert into hunt_events (hunt_id, kind, payload)
      values (p_hunt, 'defeat', jsonb_build_object(
        'name', (select name from hunts where id = p_hunt), 'tier', v_tier, 'settle', v_settle,
        'top', (select jsonb_agg(jsonb_build_object('player_id', player_id, 'damage', damage))
                from (select player_id, sum(damage) as damage from hunt_hits where hunt_id = p_hunt
                      group by player_id order by sum(damage) desc limit 3) t)));
  end if;

  select coalesce((select value #>> '{}' from settings where key = 'hunt_attack_feed'), 'milestones') into v_feed;
  v_milestone := v_crit or v_downed;
  if v_status <> 'defeated' and not v_miss and (v_feed = 'all' or (v_feed = 'milestones' and v_milestone)) then
    insert into hunt_events (hunt_id, kind, payload)
      values (p_hunt, 'attack', jsonb_build_object('player_id', p_player, 'card', v_cardname,
        'damage', v_dmg, 'outcome', v_outcome, 'crit', v_crit, 'bonus', v_bonus, 'downed', v_downed));
  end if;

  -- The end-of-day summary (hunt_squad_done.sql): when every attacker of the locked squad is down,
  -- once per member per day. It needed 8 cards used, so a short squad (or the old squad bug) never posted.
  -- The round limit also ends the squad, so its summary posts then too (hunt_loop_caps.sql).
  if v_status <> 'defeated' and ((v_downed and hunt_squad_done(p_hunt, p_player, v_day, v_cap)) or v_round >= v_rcap)
     and not exists (select 1 from hunt_events where hunt_id = p_hunt and kind = 'player_done'
                       and payload->>'player_id' = p_player and created_at >= (v_day::timestamp at time zone 'America/Denver')) then
    select coalesce(sum(damage), 0), count(distinct card_id) into v_total, v_used
      from hunt_hits where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
    select c.name, sub.d into v_topcard, v_topdmg
      from (select card_id, sum(damage) d from hunt_hits where hunt_id = p_hunt and player_id = p_player and hit_date = v_day
            group by card_id order by d desc limit 1) sub join cards c on c.id = sub.card_id;
    insert into hunt_events (hunt_id, kind, payload)
      values (p_hunt, 'player_done', jsonb_build_object('player_id', p_player,
        'total', v_total, 'cards_used', v_used, 'top_card', v_topcard, 'top_damage', v_topdmg,
        'boss_hp', v_hp, 'boss_hp_max', v_hpmax));
  end if;

  v_targets := jsonb_build_array(jsonb_build_object('card_id', p_card, 'dmg', v_cdmg,
      'hp', v_cardhp, 'max_hp', v_maxhp, 'downed', v_downed)) || coalesce(v_slam, '[]'::jsonb) || coalesce(v_tick->'targets', '[]'::jsonb)
      || coalesce(v_ctr->'targets', '[]'::jsonb);

  return jsonb_build_object('ok', true, 'damage', v_dmg, 'outcome', v_outcome,
    'bonus', v_bonus, 'resisted', v_rm > 0, 'crit', v_crit, 'cp', v_cp, 'heal', v_heal, 'ability', v_aeff,
    'hp_remaining', v_hp, 'status', v_status, 'defeated', v_status = 'defeated',
    'countered', v_counter, 'counter_dmg', v_cdmg,
    'round', v_round, 'round_cap', v_rcap,
    'card_hp', v_cardhp, 'card_max_hp', v_maxhp, 'card_downed', v_downed, 'shield', v_shield,
    'burned', v_burned, 'double', v_double, 'rally', v_rally, 'butterfingers', v_bf, 'mend', v_mend, 'party', v_party->'amount', 'crashed', nullif(v_crash_dmg, 0), 'atk', round(v_atk), 'boss_heal', coalesce(v_bheal, 0), 'phase', v_phase, 'passives', to_jsonb(v_plist),
    'synergy', case when v_syn >= balance_num('combat', 'syn_small_at') then jsonb_build_object('element', v_elem, 'count', v_syn) else null end,
    'boss_action', case when v_bossact is null then null
      else jsonb_build_object('kind', case when v_bossact = 'counter' then v_ctr->>'anim' else v_bossact end, 'round', v_round, 'targets', v_targets)
        || case when v_ctr is null then '{}'::jsonb else jsonb_build_object('move', v_ctr->>'move', 'counter', v_ctr->>'key') end end);
end $function$;

-- 8. hunt_support: the LIVE text, the counter passives (balance boss_passives), Rage Spiral and the mark defaults
--    (balance boss_counters).
CREATE OR REPLACE FUNCTION public.hunt_support(p_player text, p_hunt bigint, p_card bigint, p_target bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_rcap int; v_sdown boolean; v_stun_until int;
  v_status text; v_closes timestamptz; v_tier text; v_hp bigint;
  v_qty int; v_type text; v_ability jsonb; v_eff text; v_amt numeric; v_dur int; v_cd int; v_tgt text;
  v_day date; v_round int; v_cd_until int; v_cap int; v_maxhp int;
  v_tqty int; v_trar text; v_tasc int; v_tmod numeric; v_tmaxhp int; v_tcp int;
  v_tpts jsonb; v_srar text; v_sasc int; v_smod numeric; v_spts jsonb;
  v_aff text; v_ttags text[]; v_affcount int := 0; v_scale numeric := 1; v_matched boolean := false; v_sdmg int;
  v_settle jsonb;
  v_marks jsonb; v_plist text[]; v_f numeric := 1; v_ctr text[] := '{}'; v_gain int; v_tkind text; v_fail boolean := false;
begin
  select status, closes_at, tier into v_status, v_closes, v_tier from hunts where id = p_hunt for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_hunt'); end if;
  if v_status <> 'active' or now() >= v_closes then return jsonb_build_object('ok', false, 'error', 'hunt_over'); end if;
  select coalesce(array_agg(x->>'kind'), '{}') into v_plist from hunts h, jsonb_array_elements(coalesce(h.passive->'list', '[]'::jsonb)) x where h.id = p_hunt;

  select pc.quantity, s.type, s.ability, c.rarity::text, pc.ascension, s.cp_mod, pc.stat_points
    into v_qty, v_type, v_ability, v_srar, v_sasc, v_smod, v_spts
  from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
  where pc.player_id = p_player and pc.card_id = p_card;
  if not found or v_qty < 1 then return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;
  if v_ability is null or v_ability->>'kind' <> 'support' then return jsonb_build_object('ok', false, 'error', 'not_support'); end if;

  v_eff := v_ability->>'effect';
  v_amt := coalesce((v_ability->>'amount')::numeric, 0);
  -- Potency points of this support copy make its effect stronger (1 with the flag off).
  v_amt := v_amt * coalesce((card_combat(v_srar, v_sasc, v_smod, v_spts)->>'potency')::numeric, 1);
  v_dur := coalesce((v_ability->>'duration')::int, 1);
  v_cd  := coalesce((v_ability->>'cooldown')::int, 1);
  v_tgt := coalesce(v_ability->>'target', 'boss');
  v_aff := v_ability->>'affinity';
  v_day := (now() at time zone 'America/Denver')::date;
  if not hunt_squad_allows(p_hunt, p_player, v_day, p_card) then -- hunt_squads.sql
    return jsonb_build_object('ok', false, 'error', 'not_in_squad');
  end if;
  v_round := hunt_state_round(p_hunt, p_player, v_day);

  -- The round limit (hunt_loop_caps.sql).
  v_rcap := hunt_round_cap();
  if v_round >= v_rcap then return jsonb_build_object('ok', false, 'error', 'round_cap', 'cap', v_rcap); end if;
  select cd_until_round, downed or hp_remaining <= 0 into v_cd_until, v_sdown from hunt_card_hp
    where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = v_day;
  -- A support card that is down does nothing (hunt_loop_caps.sql: a downed heal card kept a squad alive).
  if coalesce(v_sdown, false) then return jsonb_build_object('ok', false, 'error', 'support_downed'); end if;
  if found and v_round < coalesce(v_cd_until, 0) then
    return jsonb_build_object('ok', false, 'error', 'cooldown', 'ready_round', v_cd_until, 'round', v_round);
  end if;

  v_maxhp := card_max_hp(0);   -- a support card: the HP floor (60 since hunt_launch_balance.sql)
  if not hunt_commit_card(p_hunt, p_player, p_card, v_day, v_maxhp) then
    return jsonb_build_object('ok', false, 'error', 'day_limit');
  end if;

  -- Affinity synergy: how many committed squad cards share this support's affinity tag.
  if v_aff is not null then
    select count(distinct h.card_id) into v_affcount
    from hunt_card_hp h join cards c on c.id = h.card_id join subjects s on s.id = c.subject_id
    where h.hunt_id = p_hunt and h.player_id = p_player and h.hit_date = v_day and v_aff = any(s.tag_slugs);
  end if;
  v_scale := combat_aff_scale(v_affcount);

  -- Counters (hunt_boss_moves.sql): the counter passives and the boss marks make this support weaker.
  select marks into v_marks from hunt_combat_state where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
  v_marks := coalesce(v_marks, '{}'::jsonb);
  if coalesce((v_marks->>'null_next')::int, 0) > 0 then   -- Packet Loss (1) / Shadow Ban (2): this play does nothing
    update hunt_combat_state set marks = case when (marks->>'null_next')::int > 1 then jsonb_set(marks, '{null_next}', to_jsonb((marks->>'null_next')::int - 1))
      else marks - 'null_next' end, updated_at = now() where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
    update hunt_card_hp set cd_until_round = v_round + v_cd, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = v_day;
    insert into combat_actions (mode, ref_id, player_id, card_id, kind, game_day, round, effect, amount, target_card, result)
      values ('hunt', p_hunt, p_player, p_card, 'support', v_day, v_round, v_eff, 0, case when v_tgt in ('ally', 'self') then p_target end,
              jsonb_build_object('nullified', true, 'countered', jsonb_build_array('null_next')));
    return jsonb_build_object('ok', true, 'effect', v_eff, 'nullified', true, 'countered', jsonb_build_array('null_next'),
      'ready_round', v_round + v_cd, 'round', v_round, 'boss_hp', (select hp_remaining from hunts where id = p_hunt), 'defeated', false);
  end if;
  if v_eff = 'heal' and 'plague' = any(v_plist) then v_f := v_f * balance_num('boss_passives', 'plague_x'); v_ctr := v_ctr || 'plague'::text; end if;
  if v_eff in ('shield', 'smite') and 'shatterer' = any(v_plist) then v_f := v_f * balance_num('boss_passives', 'shatterer_x'); v_ctr := v_ctr || 'shatterer'::text; end if;
  if v_eff in ('empower', 'expose') and 'dispeller' = any(v_plist) then v_f := v_f * balance_num('boss_passives', 'dispeller_x'); v_ctr := v_ctr || 'dispeller'::text; end if;
  if v_eff = 'weaken' and 'juggernaut' = any(v_plist) then v_f := v_f * balance_num('boss_passives', 'juggernaut_x'); v_ctr := v_ctr || 'juggernaut'::text; end if;
  if v_eff = 'heal' and p_target is not null and hunt_mark_on(v_marks->'heal_block_card', p_target::text, v_round) then
    v_f := v_f * coalesce((v_marks->'heal_block_card'->p_target::text->>'mult')::numeric, hunt_counter_mult('heal_block_card')); v_ctr := v_ctr || 'bloodrot'::text;
  end if;
  if v_eff in ('shield', 'empower', 'weaken', 'expose', 'smite') and hunt_mark_on(v_marks, 'block_' || v_eff, v_round) then
    v_f := v_f * coalesce((v_marks->('block_' || v_eff)->>'mult')::numeric, hunt_counter_mult('block_' || v_eff)); v_ctr := v_ctr || ('block_' || v_eff);
  end if;
  if hunt_mark_on(v_marks, 'half_' || v_eff, v_round) then   -- Shatter, Rattle, Nerf, Fade, Rollback, Decay for the day (balance boss_counters)
    v_f := v_f * coalesce((v_marks->('half_' || v_eff)->>'mult')::numeric, hunt_counter_mult('half_' || v_eff)); v_ctr := v_ctr || ('half_' || v_eff);
  end if;
  if v_f <> 1 then v_amt := v_amt * v_f; end if;

  -- resolve ally-targeted effects (need a committed target row)
  if v_tgt in ('ally', 'self') then
    if p_target is null then return jsonb_build_object('ok', false, 'error', 'need_target'); end if;
    select pc.quantity, c.rarity::text, pc.ascension, s.cp_mod, s.tag_slugs, pc.stat_points, s.ability->>'kind'
      into v_tqty, v_trar, v_tasc, v_tmod, v_ttags, v_tpts, v_tkind
    from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
    where pc.player_id = p_player and pc.card_id = p_target;
    if not found or v_tqty < 1 then return jsonb_build_object('ok', false, 'error', 'bad_target'); end if;
    v_tcp := (card_combat(v_trar, v_tasc, v_tmod, v_tpts)->>'cp')::int;
    v_tmaxhp := (card_combat(v_trar, v_tasc, v_tmod, v_tpts)->>'hp')::int;
    if v_tkind = 'support' then v_tmaxhp := card_max_hp(0); end if;   -- D-70: a support target has the support HP
    perform hunt_commit_card(p_hunt, p_player, p_target, v_day, v_tmaxhp);

    -- matched ally gets the stronger effect
    v_matched := v_aff is not null and v_ttags is not null and v_aff = any(v_ttags);
    if v_matched then v_amt := v_amt * balance_num('support', 'matched_x'); end if;

    if v_eff = 'empower' then
      update hunt_card_hp set dmg_buff = combat_support_value('empower', v_amt, 1, null), updated_at = now()
        where hunt_id = p_hunt and player_id = p_player and card_id = p_target and hit_date = v_day;
    elsif v_eff = 'shield' then
      -- amount = a fraction of the TARGET's max HP (was flat 60 on 30-HP cards).
      update hunt_card_hp set shield = shield + combat_support_value('shield', v_amt, 1, max_hp)::int, updated_at = now()
        where hunt_id = p_hunt and player_id = p_player and card_id = p_target and hit_date = v_day;
    elsif v_eff = 'heal' then
      -- amount = a fraction of the TARGET's max HP (was flat 60, a full heal on the
      -- 30-HP cards). A heal never revives a downed card (that is a separate boon).
      if exists (select 1 from hunt_card_hp where hunt_id = p_hunt and player_id = p_player
                  and card_id = p_target and hit_date = v_day and downed) then
        return jsonb_build_object('ok', false, 'error', 'target_downed');
      end if;
      select hp_remaining into v_gain from hunt_card_hp where hunt_id = p_hunt and player_id = p_player and card_id = p_target and hit_date = v_day;
      update hunt_card_hp set hp_remaining = least(max_hp, hp_remaining + combat_support_value('heal', v_amt, 1, max_hp)::int),
        updated_at = now()
        where hunt_id = p_hunt and player_id = p_player and card_id = p_target and hit_date = v_day
        returning hp_remaining - v_gain into v_gain;
      if v_gain > 0 and hunt_mark_on(v_marks, 'undying', v_round) then   -- Undying: the boss heals the same
        update hunts set hp_remaining = least(hp_max, hp_remaining + v_gain) where id = p_hunt and status = 'active';
        v_ctr := v_ctr || 'undying'::text;
      end if;
    else
      return jsonb_build_object('ok', false, 'error', 'bad_ally_effect');
    end if;

  -- boss-targeted / team effects (scaled by affinity synergy)
  elsif v_eff = 'weaken' then
    update hunt_combat_state set boss_weaken = combat_support_value('weaken', v_amt, v_scale, null), weaken_until = v_round + v_dur, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
    if hunt_mark_on(v_marks, 'spiral', v_round) then   -- Rage Spiral: each weaken adds spiral.step to the boss damage
      perform hunt_marks_patch(p_hunt, p_player, v_day, jsonb_build_object('spiral', (v_marks->'spiral')
        || jsonb_build_object('bonus', coalesce((v_marks->'spiral'->>'bonus')::numeric, 0) + hunt_counter_num('spiral', 'step'))));
      v_ctr := v_ctr || 'spiral'::text;
    end if;
  elsif v_eff = 'expose' then
    update hunt_combat_state set boss_expose = combat_support_value('expose', v_amt, v_scale, null), expose_until = v_round + v_dur, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
  elsif v_eff = 'stun' then
    -- Stun immunity (hunt_loop_caps.sql): after a stun the boss cannot be stunned for 2 rounds, so
    -- 4 stun cards cannot lock it (at most 1 stunned round in 3).
    select stunned_until into v_stun_until from hunt_combat_state where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
    if combat_stun_immune(v_stun_until, v_round) then
      return jsonb_build_object('ok', false, 'error', 'boss_stun_immune', 'ready_round', v_stun_until + balance_num('support', 'stun_immune_rounds')::int);
    end if;
    -- Desync / Juggernaut (hunt_boss_moves.sql): the stun fails; the card still goes on cooldown.
    if coalesce((v_marks->>'stun_fail')::boolean, false) then
      v_fail := true; v_ctr := v_ctr || 'desync'::text;
      update hunt_combat_state set marks = marks - 'stun_fail', updated_at = now() where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
    elsif 'juggernaut' = any(v_plist) then
      if random() < balance_num('boss_passives', 'juggernaut_stun_fail') then v_fail := true; v_ctr := v_ctr || 'juggernaut'::text; end if;
    end if;
    if not v_fail then
    update hunt_combat_state set stunned_until = v_round + 1, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
    end if;
  elsif v_eff = 'cleanse' then
    if hunt_mark_on(v_marks, 'lock_cleanse', v_round) then   -- Hotfix (hunt_boss_moves.sql): the curse stays
      v_ctr := v_ctr || 'hotfix'::text;
    elsif 'plague' = any(v_plist) then                         -- Plague: removes only plague_cleanse of a curse
      v_ctr := v_ctr || 'plague'::text;
      update hunt_card_hp set dmg_debuff = dmg_debuff + (1 - dmg_debuff) * balance_num('boss_passives', 'plague_cleanse'), updated_at = now()
        where hunt_id = p_hunt and player_id = p_player and hit_date = v_day and dmg_debuff <> 1;
    else
    update hunt_card_hp set dmg_debuff = 1, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and hit_date = v_day and dmg_debuff <> 1;
    end if;
    if hunt_mark_on(v_marks, 'rot', v_round) then              -- Rot: the cleanse also removes empower and shields
      update hunt_card_hp set dmg_buff = 1, shield = 0, updated_at = now() where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
      v_ctr := v_ctr || 'rot'::text;
    end if;
  elsif v_eff = 'smite' then
    v_sdmg := combat_support_value('smite', v_amt, v_scale, null)::int;
    if coalesce((v_marks->>'mirror')::boolean, false) then   -- Mirror (hunt_boss_moves.sql): the smite hits the smite card
      update hunt_combat_state set marks = marks - 'mirror', updated_at = now() where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
      update hunt_card_hp set hp_remaining = greatest(0, hp_remaining - v_sdmg), downed = hp_remaining - v_sdmg <= 0, updated_at = now()
        where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = v_day;
      v_ctr := v_ctr || 'mirror'::text;
    else
    update hunts set hp_remaining = greatest(0, hp_remaining - v_sdmg),
      status = case when hp_remaining - v_sdmg <= 0 then 'defeated' else status end,
      defeated_at = case when hp_remaining - v_sdmg <= 0 then now() else defeated_at end
      where id = p_hunt;
    insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage) values (p_hunt, p_player, p_card, v_day, v_sdmg)
      on conflict (hunt_id, player_id, card_id, hit_date) do update set damage = hunt_hits.damage + excluded.damage;
    select hp_remaining, status into v_hp, v_status from hunts where id = p_hunt;
    -- The killing Smite: settle once + the same 'defeat' notification as hunt_attack (2026-10-03).
    if v_status = 'defeated' then
      v_settle := settle_hunt(p_hunt);
      insert into hunt_events (hunt_id, kind, payload)
        values (p_hunt, 'defeat', jsonb_build_object(
          'name', (select name from hunts where id = p_hunt), 'tier', v_tier, 'settle', v_settle,
          'top', (select jsonb_agg(jsonb_build_object('player_id', player_id, 'damage', damage))
                  from (select player_id, sum(damage) as damage from hunt_hits where hunt_id = p_hunt
                        group by player_id order by sum(damage) desc limit 3) t)));
    end if;
    end if;
  else
    return jsonb_build_object('ok', false, 'error', 'unknown_effect', 'effect', v_eff);
  end if;

  -- The action log (combat_actions.sql, Nathan 2026-10-06): every support play that worked, for the balance data.
  insert into combat_actions (mode, ref_id, player_id, card_id, kind, game_day, round, effect, amount, target_card, result)
  values ('hunt', p_hunt, p_player, p_card, 'support', v_day, v_round, v_eff, v_amt,
    case when v_tgt in ('ally', 'self') then p_target end,
    jsonb_build_object('gained', case when v_eff = 'heal' then v_gain end, 'mirrored', 'mirror' = any(v_ctr), 'countered', to_jsonb(v_ctr),
      'scale', v_scale, 'matched', v_matched, 'aff_count', v_affcount, 'affinity', v_aff, 'cooldown', v_cd,
      'value', case
        when v_eff = 'smite' then v_sdmg
        when v_eff in ('weaken', 'expose') then combat_support_value(v_eff, v_amt, v_scale, null)
        when v_eff = 'empower' then combat_support_value('empower', v_amt, 1, null)
        when v_eff in ('heal', 'shield') then (select combat_support_value(v_eff, v_amt, 1, h.max_hp) from hunt_card_hp h
          where h.hunt_id = p_hunt and h.player_id = p_player and h.card_id = p_target and h.hit_date = v_day)
      end,
      'target_after', (select jsonb_build_object('hp', h.hp_remaining, 'max_hp', h.max_hp, 'shield', h.shield, 'dmg_buff', h.dmg_buff, 'downed', h.downed)
        from hunt_card_hp h where h.hunt_id = p_hunt and h.player_id = p_player and h.card_id = p_target and h.hit_date = v_day)));

  update hunt_card_hp set cd_until_round = v_round + v_cd, updated_at = now()
    where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = v_day;

  return jsonb_build_object('ok', true, 'effect', v_eff, 'amount', v_amt, 'target', p_target,
    'affinity', v_aff, 'aff_count', v_affcount, 'matched', v_matched,
    'ready_round', v_round + v_cd, 'round', v_round,
    'boss_hp', (select hp_remaining from hunts where id = p_hunt),
    'defeated', (select status from hunts where id = p_hunt) = 'defeated')
    || case when cardinality(v_ctr) > 0 then jsonb_build_object('countered', to_jsonb(v_ctr)) else '{}'::jsonb end;
end $function$;

-- 9. The comments (the same text is in db_comments.sql, so a re-run of it keeps them).
comment on function public.balance_check_boss_counters() is $c$Trigger (before insert, update on balance): boss_counters must hold only numbers; share, boss_share and the move shares (heal, shield, empower, expose, smite, share, keep, curse, back) from 0 to 1; rounds, wait, plays, cards and hits whole numbers (plays and hits at least 1); hit sizes and multipliers above 0; the weights add up to more than 0. boss_passives: the counter passive numbers (plague_x, shatterer_x, dispeller_x, juggernaut_x, juggernaut_stun_fail, plague_cleanse) from 0 to 1.$c$;
comment on function public.hunt_counter_num(text,text) is $c$[hunt] One number of one boss counter move: balance boss_counters.moves.<move>.<field> (raises when it is missing). Used by hunt_counter_act, hunt_counter_mult, hunt_counter_text, hunt_attack and hunt_support.$c$;
comment on function public.hunt_counter_mult(text) is $c$[hunt] The share that a support works at under a counter mark with no mult (Bloodrot heal_block_card, Decay half_heal, Fade half_expose, Rollback half_smite, and older marks): the balance boss_counters value of the move that sets the mark. Alt-F4 and Veil block (0, a rule). Raises for an unknown mark. Internal helper of hunt_support.$c$;
comment on function public.hunt_counter_text(text) is $c$[hunt] Renders a counter move text: each {format:move.field} becomes the balance boss_counters number (pct 10%, n 4, times twice, work / works, plays, cards, hits). Raises on an unknown format. Internal helper of hunt_boss_move_list.$c$;
comment on function public.hunt_boss_move_list(text) is $c$[hunt] The counter moves of one boss for the boss details: [{name, text}] in pool order from settings key hunt_boss_moves, the texts with their numbers from balance boss_counters (hunt_counter_text). [] for a boss with no pool. Called by the Activity (GET /api/hunt). Writes nothing.$c$;
comment on function public.hunt_counter_pick(bigint,text,date,text,text) is $c$[hunt] Picks a counter move for the boss turn from the boss pool in settings key hunt_boss_moves, with the share and the weights of balance boss_counters, or returns null for the usual turn. Also handles the Rubberband mark on a stunned turn. Internal helper of hunt_attack.$c$;
comment on function public.hunt_counter_act(bigint,text,date,bigint,integer,numeric,numeric,text,text,integer,integer,integer,numeric) is $c$[hunt] Applies one counter move by key: damage, marks in hunt_combat_state, shield and HP changes in hunt_card_hp. Every number is in balance boss_counters.moves (hunt_counter_num). Returns {key, move, anim, base, dmg, loss, pierce, shield, debuff, heal, targets}. Internal helper of hunt_attack.$c$;
comment on column public.hunts.name is $c$The boss name, a random pick from the fixed list of rigged model bosses in spawn_hunt. hunt_counter_pick uses it to find the boss moves in settings key hunt_boss_moves (and its share in balance boss_counters.boss_share).$c$;
comment on table public.settings is $c$One row per feature flag, member list, date or seed (key, jsonb). Every game number (card power, combat, rewards, costs, odds) is in public.balance. Migrations write most rows. Keys: dailies, gauntlet, shards (enabled flags); dungeon (enabled, salt: the seed of the daily dungeon); dungeon_prizes (enabled, from: the first paid day); achievement_tracks, ui_v3 (flags and member lists); reports (per_day: the player report limit); hunt_attack_feed; hunt_boss_moves (the counter-move pools of each boss: the countered support, the move keys, names and texts; the numbers are in balance boss_counters); launch_event_cards (the launch event cards and dates); discord_immune (the bot writes it).$c$;

notify pgrst, 'reload schema';
