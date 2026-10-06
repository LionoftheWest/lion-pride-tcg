-- Hunt boss movesets and counter passives (Nathan, 2026-10-06). The spec: docs/hunt-boss-moves.md.
--   Each of the 12 model bosses has 4 counter moves that punish one support type (settings.hunt_boss_moves).
--   The counter moves take 40% of the boss turns ("_share"); the usual table (combat_enemy_act) the other 60%.
--   New passives plague / shatterer / dispeller / juggernaut: the countered supports work at 10%. One per boss.
--   D-70: a support that targets a support card gives it the support HP (60).
-- A boss with no pool (any name not in the setting, for example the golden test boss) fights exactly as before:
-- card-studio/scripts/combat-golden.mjs replays the seeded fights through this file and must see no difference.
-- hunt_attack, hunt_support and spawn_hunt are rebuilt from their LIVE text; the guard refuses a changed live version.
-- Tests: card-studio/scripts/test-boss-moves.mjs, combat-golden.mjs (CANDIDATE=this file).
do $g$ begin
  if md5(replace(pg_get_functiondef('public.hunt_attack'::regproc), chr(13), '')) not in ('f84e5768628b1c4afddb89ecfe96a5ec', '9011a384a4a4a9e4210896e70eadf09b') then
    raise exception 'hunt_boss_moves.sql: the live hunt_attack changed since this file was built. Rebuild from the live text.';
  end if;
  if md5(replace(pg_get_functiondef('public.hunt_support'::regproc), chr(13), '')) not in ('beb6c2738ef2b0966054234c13fa1085', 'be3cb55e8972c6a6702e799d3af38b41') then
    raise exception 'hunt_boss_moves.sql: the live hunt_support changed since this file was built. Rebuild from the live text.';
  end if;
  if md5(replace(pg_get_functiondef('public.spawn_hunt'::regproc), chr(13), '')) not in ('c754ef43fcbf05328e8e1a90f8445007', '4b9c670ee18c6ece32d5a3a886b9df1d') then
    raise exception 'hunt_boss_moves.sql: the live spawn_hunt changed since this file was built. Rebuild from the live text.';
  end if;
end $g$;

-- The counter marks of one squad on one day (docs/hunt-boss-moves.md section 3).
alter table public.hunt_combat_state add column if not exists marks jsonb not null default '{}'::jsonb;

-- The movesets. key = the rule in hunt_counter_act; name and text = what the boss details show; w = the weight.
insert into public.settings (key, value) values ('hunt_boss_moves', $j${
  "_share": 0.4,
  "The Grind Vampire": {"counters": "heal", "moves": [
    {"key": "bloodrot", "name": "Bloodrot", "w": 1, "text": "Heals on the hit card work at 10% for 2 rounds."},
    {"key": "siphon", "name": "Siphon", "w": 1, "text": "The boss heals the HP that your squad healed this round."},
    {"key": "feast", "name": "Feast", "w": 1, "text": "Hits the card with the lowest HP."},
    {"key": "anemia", "name": "Anemia", "w": 1, "text": "Hits every card, twice as hard on heal cards."}]},
  "The AFK Warzombie": {"counters": "heal", "moves": [
    {"key": "decay", "name": "Decay", "w": 1, "text": "The hit card loses the HP that heals gave it this round."},
    {"key": "infect", "name": "Infect", "w": 1, "text": "Damage on the hit card for 3 rounds."},
    {"key": "groan", "name": "Groan", "w": 1, "text": "Heal cards wait 2 more rounds."},
    {"key": "undying", "name": "Undying", "w": 1, "text": "For 3 rounds, each heal you play also heals the boss."}]},
  "The Smurf Brute": {"counters": "shield", "moves": [
    {"key": "shatter", "name": "Shatter", "w": 1, "text": "Breaks every shield in your squad."},
    {"key": "crush", "name": "Crush", "w": 1, "text": "Each card takes half of the shield it lost to Shatter."},
    {"key": "bully", "name": "Bully", "w": 1, "text": "Hits the card with the biggest shield. The hit ignores the shield."},
    {"key": "fakerank", "name": "Fake Rank", "w": 1, "text": "Double damage to a shielded card."}]},
  "The Hardstuck Skeleton": {"counters": "shield", "moves": [
    {"key": "bonepierce", "name": "Bone Pierce", "w": 1, "text": "This hit ignores shields."},
    {"key": "rattle", "name": "Rattle", "w": 1, "text": "Cuts every shield in half."},
    {"key": "calcify", "name": "Calcify", "w": 1, "text": "New shields work at 10% for 2 rounds."},
    {"key": "stuck", "name": "Stuck", "w": 1, "text": "Shield cards wait 2 more rounds."}]},
  "Maw of the Meta": {"counters": "empower", "moves": [
    {"key": "nerf", "name": "Nerf", "w": 1, "text": "Removes empower from every card."},
    {"key": "patchnotes", "name": "Patch Notes", "w": 1, "text": "Empower works at 10% for 2 rounds."},
    {"key": "tierlist", "name": "Tier List", "w": 1, "text": "Hits the empowered card for double damage."},
    {"key": "counterpick", "name": "Counter-pick", "w": 1, "text": "For 3 rounds, an empowered attack also hurts the attacker."}]},
  "The Rage-Quit Warlord": {"counters": "weaken", "moves": [
    {"key": "tilt", "name": "Tilt", "w": 1, "text": "Ends weaken. The boss enrages for 2 rounds."},
    {"key": "altf4", "name": "Alt-F4", "w": 1, "text": "Weaken has no effect for 3 rounds."},
    {"key": "spiral", "name": "Rage Spiral", "w": 1, "text": "For 3 rounds, each weaken you play makes the boss hit 20% harder."},
    {"key": "flame", "name": "Flame", "w": 1, "text": "Hits every card, twice as hard on weaken cards."}]},
  "The Ranked Nightshade": {"counters": "expose", "moves": [
    {"key": "fade", "name": "Fade", "w": 1, "text": "Ends expose."},
    {"key": "veil", "name": "Veil", "w": 1, "text": "Expose has no effect for 3 rounds."},
    {"key": "demotion", "name": "Demotion", "w": 1, "text": "For 3 rounds, an attack on an exposed boss sends 20% back."},
    {"key": "nightshade", "name": "Nightshade", "w": 1, "text": "Damage on expose cards for 3 rounds."}]},
  "The Lagspike Parasite": {"counters": "stun", "moves": [
    {"key": "desync", "name": "Desync", "w": 1, "text": "Your next stun fails."},
    {"key": "rubberband", "name": "Rubberband", "w": 1, "text": "After your next stun, the boss hits twice."},
    {"key": "lagspike", "name": "Lag Spike", "w": 1, "text": "Stun cards wait 3 more rounds."},
    {"key": "packetloss", "name": "Packet Loss", "w": 1, "text": "Your next support play does nothing."}]},
  "The Netcode Mutant": {"counters": "smite", "moves": [
    {"key": "rollback", "name": "Rollback", "w": 1, "text": "The boss heals the damage of your last smite."},
    {"key": "hitbox", "name": "Hitbox Desync", "w": 1, "text": "Smite does 10% damage for 2 rounds."},
    {"key": "mirror", "name": "Mirror", "w": 1, "text": "Your next smite hits the smite card."},
    {"key": "pingspike", "name": "Ping Spike", "w": 1, "text": "Smite cards wait 2 more rounds."}]},
  "The Patch-Day Pumpkin": {"counters": "cleanse", "moves": [
    {"key": "hotfix", "name": "Hotfix", "w": 1, "text": "Curses the hit card. Cleanse cannot remove a curse for 3 rounds."},
    {"key": "rollout", "name": "Rollout", "w": 1, "text": "Curses every card in your squad."},
    {"key": "rot", "name": "Rot", "w": 1, "text": "For 2 rounds, a cleanse also removes empower and shields."},
    {"key": "patch", "name": "Patch", "w": 1, "text": "Cleanse cards wait 2 more rounds."}]},
  "The Ban-Wave Demon": {"counters": "support", "moves": [
    {"key": "ban", "name": "Ban", "w": 1, "text": "One support card cannot play for 3 rounds."},
    {"key": "wave", "name": "Wave", "w": 1, "text": "Every support card waits 1 more round."},
    {"key": "appeal", "name": "Appeal Denied", "w": 1, "text": "Hits the last support card that played for double damage."},
    {"key": "shadowban", "name": "Shadow Ban", "w": 1, "text": "Your next support play does nothing."}]},
  "The Zerg-Rush Queen": {"counters": "support", "moves": [
    {"key": "swarm", "name": "Swarm", "w": 1, "text": "Hits every card, twice as hard on support cards."},
    {"key": "brood", "name": "Brood", "w": 1, "text": "Hits every support card."},
    {"key": "rush", "name": "Rush", "w": 1, "text": "Two hits on the support card with the lowest HP."},
    {"key": "overrun", "name": "Overrun", "w": 1, "text": "Hits the weakest support card. If it goes down, the boss enrages."}]}
}$j$::jsonb)
on conflict (key) do update set value = excluded.value;

-- A mark that lasts until a round: {"until": n, ...}.
create or replace function public.hunt_mark_on(p_marks jsonb, p_key text, p_round int) returns boolean
language sql immutable as $$ select coalesce((p_marks->p_key->>'until')::int, -1) >= p_round; $$;

-- Add keys to the marks of one squad (the caller builds nested maps itself).
create or replace function public.hunt_marks_patch(p_hunt bigint, p_player text, p_day date, p_patch jsonb) returns void
language sql volatile set search_path = public as $$
  update hunt_combat_state set marks = coalesce(marks, '{}'::jsonb) || p_patch, updated_at = now()
    where hunt_id = p_hunt and player_id = p_player and hit_date = p_day;
$$;

-- The other cards of the squad that still stand: their HP, shield, buff and support effect.
create or replace function public.hunt_squad_cards(p_hunt bigint, p_player text, p_day date, p_card bigint)
returns table (card_id bigint, hp int, max_hp int, shield int, buff numeric, kind text, eff text)
language sql stable set search_path = public as $$
  select h.card_id, h.hp_remaining, h.max_hp, coalesce(h.shield, 0), coalesce(h.dmg_buff, 1), s.ability->>'kind', s.ability->>'effect'
    from hunt_card_hp h join cards c on c.id = h.card_id join subjects s on s.id = c.subject_id
    where h.hunt_id = p_hunt and h.player_id = p_player and h.hit_date = p_day and h.card_id <> p_card and not h.downed;
$$;

-- A counter hit on another card (not the attacker): the shield absorbs first unless p_pierce. NULL when it is down.
create or replace function public.hunt_counter_hit(p_hunt bigint, p_player text, p_day date, p_cid bigint, p_dmg int, p_pierce boolean)
returns jsonb language plpgsql volatile set search_path = public as $$
declare v jsonb; v_take int;
begin
  update hunt_card_hp h set
      hp_remaining = greatest(0, h.hp_remaining - case when p_pierce then p_dmg else greatest(0, p_dmg - coalesce(h.shield, 0)) end),
      shield = case when p_pierce then h.shield else greatest(0, coalesce(h.shield, 0) - p_dmg) end,
      downed = (h.hp_remaining - case when p_pierce then p_dmg else greatest(0, p_dmg - coalesce(h.shield, 0)) end) <= 0,
      updated_at = now()
    where h.hunt_id = p_hunt and h.player_id = p_player and h.hit_date = p_day and h.card_id = p_cid and not h.downed
    returning jsonb_build_object('card_id', h.card_id, 'dmg', p_dmg, 'hp', h.hp_remaining, 'max_hp', h.max_hp, 'downed', h.downed) into v;
  return v;
end $$;

-- "Waits N more rounds": the support cards (of one effect, or all when p_eff is null) get a later ready round.
create or replace function public.hunt_counter_cd(p_hunt bigint, p_player text, p_day date, p_eff text, p_n int, p_round int)
returns int language plpgsql volatile set search_path = public as $$
declare n int;
begin
  update hunt_card_hp h set cd_until_round = greatest(coalesce(h.cd_until_round, 0), p_round) + p_n, updated_at = now()
    from cards c join subjects s on s.id = c.subject_id
    where c.id = h.card_id and h.hunt_id = p_hunt and h.player_id = p_player and h.hit_date = p_day and not h.downed
      and s.ability->>'kind' = 'support' and (p_eff is null or s.ability->>'effect' = p_eff);
  get diagnostics n = row_count;
  return n;
end $$;

-- The damage-over-time marks (Infect, Nightshade) tick on each boss turn. Returns the attacker's tick
-- (the caller applies it, its shield first) and the hits on the other cards.
create or replace function public.hunt_counter_tick(p_hunt bigint, p_player text, p_day date, p_card bigint, p_round int)
returns jsonb language plpgsql volatile set search_path = public as $$
declare v_marks jsonb; v_att int := 0; v_tg jsonb := '[]'; v_keep jsonb := '{}'; k text; v jsonb; v_hit jsonb;
begin
  select coalesce(marks, '{}'::jsonb) into v_marks from hunt_combat_state where hunt_id = p_hunt and player_id = p_player and hit_date = p_day;
  if not coalesce(v_marks ? 'dot', false) then return jsonb_build_object('attacker', 0, 'targets', '[]'::jsonb); end if;
  for k, v in select * from jsonb_each(v_marks->'dot') loop
    if (v->>'until')::int >= p_round then
      if k::bigint = p_card then v_att := v_att + (v->>'amt')::int;
      else v_hit := hunt_counter_hit(p_hunt, p_player, p_day, k::bigint, (v->>'amt')::int, false);
           if v_hit is not null then v_tg := v_tg || jsonb_build_array(v_hit); end if;
      end if;
      if (v->>'until')::int > p_round then v_keep := v_keep || jsonb_build_object(k, v); end if;
    end if;
  end loop;
  perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('dot', v_keep));
  return jsonb_build_object('attacker', v_att, 'targets', v_tg);
end $$;

-- One counter move (docs/hunt-boss-moves.md section 4). It changes the OTHER cards and the marks itself; the
-- attacking card's changes come back for hunt_attack to apply: dmg (its shield absorbs it unless pierce), loss
-- (HP lost, no shield), shield (the new shield value), debuff. heal = the boss heal. anim = the boss animation
-- (an existing one). base = true: an effect move (or a hit with nothing to hit). Then the usual boss turn ALSO happens
-- (hunt_attack), so a squad without the countered support meets exactly the usual boss. base = false: a hit move; it
-- replaces the usual turn.
create or replace function public.hunt_counter_act(p_hunt bigint, p_player text, p_day date, p_card bigint, p_round int,
  p_atk numeric, p_bmult numeric, p_key text, p_name text, p_cardhp int, p_maxhp int, p_shield int)
returns jsonb language plpgsql volatile set search_path = public as $$
declare
  v_dmg int := 0; v_loss int := 0; v_pierce boolean := false; v_shield int; v_debuff numeric; v_heal int := 0;
  v_tg jsonb := '[]'; v_anim text := 'strike'; v_base boolean := true; v_marks jsonb; v_map jsonb; v_hit jsonb;
  r record; v_cid bigint; v_amt int;
begin
  select coalesce(marks, '{}'::jsonb) into v_marks from hunt_combat_state where hunt_id = p_hunt and player_id = p_player and hit_date = p_day;
  case p_key
  -- The Grind Vampire (heal)
  when 'bloodrot' then
    v_anim := 'curse';
    perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('heal_block_card',
      coalesce(v_marks->'heal_block_card', '{}'::jsonb) || jsonb_build_object(p_card::text, jsonb_build_object('until', p_round + 2))));
  when 'siphon' then
    v_anim := 'drain';
    select coalesce(sum(coalesce((a.result->>'gained')::int, (a.result->>'value')::int)), 0) into v_heal from combat_actions a
      where a.mode = 'hunt' and a.ref_id = p_hunt and a.player_id = p_player and a.game_day = p_day and a.effect = 'heal' and a.round >= p_round - 1;
  when 'feast' then
    select h.card_id, h.hp, h.max_hp, h.shield into r from hunt_squad_cards(p_hunt, p_player, p_day, p_card) h
      order by h.hp::numeric / greatest(1, h.max_hp), h.card_id limit 1;
    if r.card_id is not null and r.hp::numeric / greatest(1, r.max_hp) < p_cardhp::numeric / greatest(1, p_maxhp) then
      v_hit := hunt_counter_hit(p_hunt, p_player, p_day, r.card_id, combat_area_roll(p_atk, 1.0, p_bmult), false);
      v_tg := v_tg || jsonb_build_array(v_hit);
    else
      v_dmg := combat_area_roll(p_atk, 1.0, p_bmult);
    end if;
    v_base := false;
  when 'anemia' then
    v_anim := 'slam'; v_base := false; v_dmg := combat_area_roll(p_atk, 0.35, p_bmult);
    for r in select * from hunt_squad_cards(p_hunt, p_player, p_day, p_card) loop
      v_hit := hunt_counter_hit(p_hunt, p_player, p_day, r.card_id, combat_area_roll(p_atk, 0.35, p_bmult) * case when r.eff = 'heal' then 2 else 1 end, false);
      if v_hit is not null then v_tg := v_tg || jsonb_build_array(v_hit); end if;
    end loop;
  -- The AFK Warzombie (heal)
  when 'decay' then
    v_anim := 'curse';
    select coalesce(sum(coalesce((a.result->>'gained')::int, (a.result->>'value')::int)), 0) into v_loss from combat_actions a
      where a.mode = 'hunt' and a.ref_id = p_hunt and a.player_id = p_player and a.game_day = p_day and a.effect = 'heal'
        and a.target_card = p_card and a.round >= p_round - 1;
  when 'infect' then
    v_anim := 'curse'; v_base := false; v_dmg := combat_area_roll(p_atk, 0.35, p_bmult);
    perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('dot', coalesce(v_marks->'dot', '{}'::jsonb)
      || jsonb_build_object(p_card::text, jsonb_build_object('amt', combat_area_roll(p_atk, 0.25, p_bmult), 'until', p_round + 3))));
  when 'groan' then
    v_anim := 'stun'; perform hunt_counter_cd(p_hunt, p_player, p_day, 'heal', 2, p_round);
  when 'undying' then
    v_anim := 'regenerate'; perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('undying', jsonb_build_object('until', p_round + 3)));
  -- The Smurf Brute (shield)
  when 'shatter' then
    v_anim := 'slam'; v_map := '{}'::jsonb;
    for r in select * from hunt_squad_cards(p_hunt, p_player, p_day, p_card) where shield > 0 loop
      v_map := v_map || jsonb_build_object(r.card_id::text, r.shield);
      update hunt_card_hp set shield = 0, updated_at = now() where hunt_id = p_hunt and player_id = p_player and hit_date = p_day and card_id = r.card_id;
    end loop;
    if p_shield > 0 then v_map := v_map || jsonb_build_object(p_card::text, p_shield); v_shield := 0; end if;
    perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('shattered', v_map));
  when 'crush' then
    v_anim := 'slam'; v_base := false; v_map := coalesce(v_marks->'shattered', '{}'::jsonb);
    if v_map = '{}'::jsonb then
      v_dmg := combat_area_roll(p_atk, 0.35, p_bmult);
      for r in select * from hunt_squad_cards(p_hunt, p_player, p_day, p_card) loop
        v_hit := hunt_counter_hit(p_hunt, p_player, p_day, r.card_id, combat_area_roll(p_atk, 0.35, p_bmult), false);
        if v_hit is not null then v_tg := v_tg || jsonb_build_array(v_hit); end if;
      end loop;
    else
      if v_map ? p_card::text then v_dmg := greatest(1, (v_map->>p_card::text)::int / 2); end if;
      for r in select * from hunt_squad_cards(p_hunt, p_player, p_day, p_card) where v_map ? card_id::text loop
        v_hit := hunt_counter_hit(p_hunt, p_player, p_day, r.card_id, greatest(1, (v_map->>r.card_id::text)::int / 2), false);
        if v_hit is not null then v_tg := v_tg || jsonb_build_array(v_hit); end if;
      end loop;
      if v_dmg = 0 and v_tg = '[]'::jsonb then v_base := true; end if;   -- the shattered cards are down
      perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('shattered', '{}'::jsonb));
    end if;
  when 'bully' then
    select h.card_id, h.shield into r from hunt_squad_cards(p_hunt, p_player, p_day, p_card) h where h.shield > 0 order by h.shield desc, h.card_id limit 1;
    if p_shield > 0 and (r.card_id is null or p_shield >= r.shield) then
      v_dmg := combat_area_roll(p_atk, 1.0, p_bmult); v_pierce := true; v_base := false;
    elsif r.card_id is not null then
      v_tg := v_tg || jsonb_build_array(hunt_counter_hit(p_hunt, p_player, p_day, r.card_id, combat_area_roll(p_atk, 1.0, p_bmult), true)); v_base := false;
    end if;
  when 'fakerank' then
    v_base := false; v_dmg := combat_area_roll(p_atk, 1.0, p_bmult) * case when p_shield > 0 then 2 else 1 end;
  -- The Hardstuck Skeleton (shield)
  when 'bonepierce' then
    v_base := false; v_pierce := true; v_dmg := combat_area_roll(p_atk, 1.0, p_bmult);
  when 'rattle' then
    v_anim := 'slam';
    update hunt_card_hp set shield = coalesce(shield, 0) / 2, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and hit_date = p_day and card_id <> p_card and not downed and coalesce(shield, 0) > 0;
    if p_shield > 0 then v_shield := p_shield / 2; end if;
  when 'calcify' then
    v_anim := 'curse'; perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('block_shield', jsonb_build_object('until', p_round + 2, 'mult', 0.1)));
  when 'stuck' then
    v_anim := 'stun'; perform hunt_counter_cd(p_hunt, p_player, p_day, 'shield', 2, p_round);
  -- Maw of the Meta (empower)
  when 'nerf' then
    v_anim := 'curse';
    update hunt_card_hp set dmg_buff = 1, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and hit_date = p_day and card_id <> p_card and coalesce(dmg_buff, 1) > 1;
  when 'patchnotes' then
    v_anim := 'curse'; perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('block_empower', jsonb_build_object('until', p_round + 2, 'mult', 0.1)));
  when 'tierlist' then
    select h.card_id into v_cid from hunt_squad_cards(p_hunt, p_player, p_day, p_card) h where h.buff > 1 order by h.buff desc, h.card_id limit 1;
    if v_cid is not null then
      v_tg := v_tg || jsonb_build_array(hunt_counter_hit(p_hunt, p_player, p_day, v_cid, combat_area_roll(p_atk, 2.0, p_bmult), false)); v_base := false;
    end if;
  when 'counterpick' then
    v_anim := 'curse'; perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('counterpick', jsonb_build_object('until', p_round + 3)));
  -- The Rage-Quit Warlord (weaken)
  when 'tilt' then
    v_anim := 'enrage';
    update hunt_combat_state set boss_weaken = 0, weaken_until = 0, boss_enrage = 1.4, enrage_until = p_round + 2, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and hit_date = p_day;
  when 'altf4' then
    v_anim := 'curse'; perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('block_weaken', jsonb_build_object('until', p_round + 3, 'mult', 0)));
  when 'spiral' then
    v_anim := 'enrage'; perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('spiral', jsonb_build_object('until', p_round + 3, 'bonus', 0)));
  when 'flame' then
    v_anim := 'slam'; v_base := false; v_dmg := combat_area_roll(p_atk, 0.35, p_bmult);
    for r in select * from hunt_squad_cards(p_hunt, p_player, p_day, p_card) loop
      v_hit := hunt_counter_hit(p_hunt, p_player, p_day, r.card_id, combat_area_roll(p_atk, 0.35, p_bmult) * case when r.eff = 'weaken' then 2 else 1 end, false);
      if v_hit is not null then v_tg := v_tg || jsonb_build_array(v_hit); end if;
    end loop;
  -- The Ranked Nightshade (expose)
  when 'fade' then
    v_anim := 'curse';
    update hunt_combat_state set boss_expose = 0, expose_until = 0, updated_at = now() where hunt_id = p_hunt and player_id = p_player and hit_date = p_day;
  when 'veil' then
    v_anim := 'curse'; perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('block_expose', jsonb_build_object('until', p_round + 3, 'mult', 0)));
  when 'demotion' then
    v_anim := 'curse'; perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('demotion', jsonb_build_object('until', p_round + 3)));
  when 'nightshade' then
    v_anim := 'curse'; v_map := coalesce(v_marks->'dot', '{}'::jsonb);
    for r in select * from hunt_squad_cards(p_hunt, p_player, p_day, p_card) where eff = 'expose' loop
      v_map := v_map || jsonb_build_object(r.card_id::text, jsonb_build_object('amt', combat_area_roll(p_atk, 0.25, p_bmult), 'until', p_round + 3));
    end loop;
    perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('dot', v_map));
  -- The Lagspike Parasite (stun)
  when 'desync' then
    v_anim := 'curse'; perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('stun_fail', true));
  when 'rubberband' then
    v_anim := 'enrage'; perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('rubberband', true));
  when 'rubberband_hit' then   -- the turn after a stun, set up by Rubberband (hunt_attack calls it)
    v_base := false; v_dmg := combat_area_roll(p_atk, 1.0, p_bmult) + combat_area_roll(p_atk, 1.0, p_bmult);
    update hunt_combat_state set marks = marks - 'double_next', updated_at = now() where hunt_id = p_hunt and player_id = p_player and hit_date = p_day;
  when 'lagspike' then
    v_anim := 'stun'; perform hunt_counter_cd(p_hunt, p_player, p_day, 'stun', 3, p_round);
  when 'packetloss' then
    v_anim := 'curse'; perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('null_next', true));
  -- The Netcode Mutant (smite)
  when 'rollback' then
    v_anim := 'drain';
    select coalesce((a.result->>'value')::int, 0) into v_heal from combat_actions a
      where a.mode = 'hunt' and a.ref_id = p_hunt and a.player_id = p_player and a.game_day = p_day and a.effect = 'smite'
        and not coalesce((a.result->>'mirrored')::boolean, false)
      order by a.id desc limit 1;
    v_heal := coalesce(v_heal, 0);
  when 'hitbox' then
    v_anim := 'curse'; perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('block_smite', jsonb_build_object('until', p_round + 2, 'mult', 0.1)));
  when 'mirror' then
    v_anim := 'curse'; perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('mirror', true));
  when 'pingspike' then
    v_anim := 'stun'; perform hunt_counter_cd(p_hunt, p_player, p_day, 'smite', 2, p_round);
  -- The Patch-Day Pumpkin (cleanse)
  when 'hotfix' then
    v_anim := 'curse'; v_debuff := 0.7;
    perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('lock_cleanse', jsonb_build_object('until', p_round + 3)));
  when 'rollout' then
    v_anim := 'curse'; v_debuff := 0.7;
    update hunt_card_hp set dmg_debuff = 0.7, updated_at = now() where hunt_id = p_hunt and player_id = p_player and hit_date = p_day and card_id <> p_card and not downed;
  when 'rot' then
    v_anim := 'curse'; perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('rot', jsonb_build_object('until', p_round + 2)));
  when 'patch' then
    v_anim := 'stun'; perform hunt_counter_cd(p_hunt, p_player, p_day, 'cleanse', 2, p_round);
  -- The Ban-Wave Demon (all supports)
  when 'ban' then
    v_anim := 'stun';
    select h.card_id into v_cid from hunt_squad_cards(p_hunt, p_player, p_day, p_card) h where h.kind = 'support' order by random() limit 1;
    if v_cid is not null then
      update hunt_card_hp set cd_until_round = greatest(coalesce(cd_until_round, 0), p_round) + 3, updated_at = now()
        where hunt_id = p_hunt and player_id = p_player and hit_date = p_day and card_id = v_cid;
    end if;
  when 'wave' then
    v_anim := 'stun'; perform hunt_counter_cd(p_hunt, p_player, p_day, null, 1, p_round);
  when 'appeal' then
    select a.card_id into v_cid from combat_actions a
      where a.mode = 'hunt' and a.ref_id = p_hunt and a.player_id = p_player and a.game_day = p_day and a.kind = 'support'
      order by a.id desc limit 1;
    if v_cid is not null then
      v_hit := hunt_counter_hit(p_hunt, p_player, p_day, v_cid, combat_area_roll(p_atk, 2.0, p_bmult), false);
      if v_hit is not null then v_tg := v_tg || jsonb_build_array(v_hit); v_base := false; end if;
    end if;
  when 'shadowban' then
    v_anim := 'curse'; perform hunt_marks_patch(p_hunt, p_player, p_day, jsonb_build_object('null_next', true));
  -- The Zerg-Rush Queen (all supports)
  when 'swarm' then
    v_anim := 'slam'; v_base := false; v_dmg := combat_area_roll(p_atk, 0.35, p_bmult);
    for r in select * from hunt_squad_cards(p_hunt, p_player, p_day, p_card) loop
      v_hit := hunt_counter_hit(p_hunt, p_player, p_day, r.card_id, combat_area_roll(p_atk, 0.35, p_bmult) * case when r.kind = 'support' then 2 else 1 end, false);
      if v_hit is not null then v_tg := v_tg || jsonb_build_array(v_hit); end if;
    end loop;
  when 'brood' then
    v_anim := 'slam';
    for r in select * from hunt_squad_cards(p_hunt, p_player, p_day, p_card) where kind = 'support' loop
      v_hit := hunt_counter_hit(p_hunt, p_player, p_day, r.card_id, combat_area_roll(p_atk, 0.5, p_bmult), false);
      if v_hit is not null then v_tg := v_tg || jsonb_build_array(v_hit); v_base := false; end if;
    end loop;
  when 'rush', 'overrun' then
    select h.card_id into v_cid from hunt_squad_cards(p_hunt, p_player, p_day, p_card) h where h.kind = 'support'
      order by h.hp::numeric / greatest(1, h.max_hp), h.card_id limit 1;
    if v_cid is not null then
      v_base := false;
      v_amt := case when p_key = 'rush' then combat_area_roll(p_atk, 0.6, p_bmult) + combat_area_roll(p_atk, 0.6, p_bmult) else combat_area_roll(p_atk, 1.0, p_bmult) end;
      v_hit := hunt_counter_hit(p_hunt, p_player, p_day, v_cid, v_amt, false);
      v_tg := v_tg || jsonb_build_array(v_hit);
      if p_key = 'overrun' and coalesce((v_hit->>'downed')::boolean, false) then
        v_anim := 'enrage';
        update hunt_combat_state set boss_enrage = 1.4, enrage_until = p_round + 2, updated_at = now() where hunt_id = p_hunt and player_id = p_player and hit_date = p_day;
      end if;
    end if;
  else
    raise exception 'hunt_counter_act: unknown move %', p_key;
  end case;
  return jsonb_build_object('action', 'counter', 'key', p_key, 'move', p_name, 'anim', v_anim, 'base', v_base, 'dmg', v_dmg, 'loss', v_loss,
    'pierce', v_pierce, 'shield', v_shield, 'debuff', v_debuff, 'heal', v_heal, 'targets', v_tg);
end $$;

-- A counter move drawn from the boss pool, or NULL (the usual table then acts). p_act = the usual draw: the counter
-- replaces only a normal turn (never Stunned, Charging or the Cataclysm). Rubberband: a stunned turn arms a double hit.
create or replace function public.hunt_counter_pick(p_hunt bigint, p_player text, p_day date, p_boss text, p_act text)
returns jsonb language plpgsql volatile set search_path = public as $$
declare v_cfg jsonb; v_pool jsonb; v_marks jsonb; v_total numeric; v_r numeric; m jsonb;
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
  if random() >= coalesce((v_cfg->>'_share')::numeric, 0.4) then return null; end if;
  select sum(coalesce((e->>'w')::numeric, 1)) into v_total from jsonb_array_elements(v_pool) e;
  v_r := random() * v_total;
  for m in select e from jsonb_array_elements(v_pool) e loop
    v_r := v_r - coalesce((m->>'w')::numeric, 1);
    if v_r <= 0 then return jsonb_build_object('key', m->>'key', 'name', m->>'name'); end if;
  end loop;
  return jsonb_build_object('key', v_pool->-1->>'key', 'name', v_pool->-1->>'name');
end $$;

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
  v_sq jsonb; v_wk jsonb; v_hit jsonb; v_act jsonb; v_ab jsonb; v_area numeric;
  v_bname text; v_marks jsonb; v_pick jsonb; v_ctr jsonb; v_tick jsonb;
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
    select coalesce((select (value #>> '{}')::int from settings where key = 'hunt_daily_card_cap'), 8) into v_cap;
    if (select count(*) from hunt_card_hp where hunt_id = p_hunt and player_id = p_player and hit_date = v_day) >= v_cap then
      return jsonb_build_object('ok', false, 'error', 'day_limit', 'cap', v_cap);
    end if;
  else
    select coalesce((select (value #>> '{}')::int from settings where key = 'hunt_daily_card_cap'), 8) into v_cap;
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
    0.08 + case when 'shrouded' = any(v_plist) then 0.10 else 0 end,                  -- shrouded: more misses
    v_aeff, v_aamt, v_athresh, 'armored' = any(v_plist) and 'trait:melee' = any(v_tags),
    case when v_exp_until >= v_round and v_expose > 0 and not hunt_mark_on(v_marks, 'block_expose', v_round) then v_expose else 0 end, v_hp, v_hpmax);   -- Veil (hunt_boss_moves.sql)
  v_miss := (v_hit->>'miss')::boolean; v_crit := (v_hit->>'crit')::boolean; v_block := (v_hit->>'block')::boolean;
  v_dmg := (v_hit->>'dmg')::int; v_outcome := v_hit->>'outcome'; v_double := (v_hit->>'double')::boolean;
  if not v_miss then
    -- Rally (a boon): the next hit deals +amount % (the boon is used up by this hit).
    v_rally := take_player_effect(p_player, 'rally');
    if v_rally is not null then v_dmg := greatest(1, round(v_dmg * (1 + least(v_rally, 100) / 100.0))); end if;
    -- Butterfingers (a prank, effects_outside.sql): the next hit deals -amount % (used up by this hit).
    v_bf := take_player_effect(p_player, 'butterfingers');
    if v_bf is not null and v_dmg > 0 then v_dmg := greatest(1, round(v_dmg * (1 - least(v_bf, 100) / 100.0))); end if;
    -- Launch Party (the Launch Day Player boon, launch_event_cards.sql): +amount % on each of the
    -- next N hits (options.uses), one charge per hit.
    v_party := use_effect_charge(p_player, 'launch_party');
    if v_party is not null then v_dmg := greatest(1, round(v_dmg * (1 + least((v_party->>'amount')::numeric, 100) / 100.0))); end if;
    -- Raid Crasher (the Launch Day Raider prank): the boss takes +amount % more on each of the next N
    -- hits, and that extra damage counts for the prankster (options.credit_to) on the leaderboard.
    v_crash := use_effect_charge(p_player, 'raid_crasher');
    if v_crash is not null then
      v_crash_dmg := greatest(1, round(v_dmg * least((v_crash->>'amount')::numeric, 100) / 100.0))::int;
      v_crash_to := coalesce(v_crash->'options'->>'credit_to', v_crash->'options'->>'sender_id');
      v_crash_card := (v_crash->'options'->>'card_id')::bigint;
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
  -- bonus) and Demotion (an attack on an exposed boss sends 20% back).
  if v_dmg > 0 and v_buff > 1 and hunt_mark_on(v_marks, 'counterpick', v_round) then
    v_cardhp := greatest(0, v_cardhp - greatest(1, round(v_dmg * (v_buff - 1) / v_buff))::int);
  end if;
  if v_dmg > 0 and v_exp_until >= v_round and v_expose > 0 and hunt_mark_on(v_marks, 'demotion', v_round)
     and not hunt_mark_on(v_marks, 'block_expose', v_round) then
    v_cardhp := greatest(0, v_cardhp - greatest(1, round(v_dmg * 0.2))::int);
  end if;
  v_buff := 1;

  -- The boss ATK (Nathan, 2026-09-28: flat stats, so tougher cards survive more hits).
  -- hunts.stats.atk is set at spawn; an older hunt uses the tier default.
  v_atk := coalesce((v_stats->>'atk')::numeric,
    (select (value->>v_tier)::numeric from settings where key = 'hunt_atk'),
    case v_tier when 'Heroic' then 73 when 'Mythic' then 93 else 58 end);
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
    if hunt_mark_on(v_marks, 'spiral', v_round) then   -- Rage Spiral: +20% for each weaken played
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
    -- A counter move (hunt_boss_moves.sql): 40% of the normal turns of a boss with a move pool. An effect move comes on
    -- top of the usual turn (base); a hit move replaces it.
    v_pick := hunt_counter_pick(p_hunt, p_player, v_day, v_bname, v_bossact);
    if v_pick is not null then
      v_ctr := hunt_counter_act(p_hunt, p_player, v_day, p_card, v_round, v_atk, v_bmult, v_pick->>'key', v_pick->>'name',
        v_cardhp, v_maxhp, v_shield);
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
      update hunt_combat_state set boss_enrage = 1.4, enrage_until = v_round + 2, updated_at = now()
        where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
    elsif v_bossact = 'curse' then
      v_debuff := 0.7;
    end if;
    if 'regenerating' = any(v_plist) and v_bossact <> 'stunned' then v_bheal := v_bheal + combat_regen(v_share); end if;
    if 'thorns' = any(v_plist) and v_dmg > 0 then
      v_cardhp := greatest(0, v_cardhp - combat_thorns(v_dmg));
    end if;
    if v_bheal > 0 then
      update hunts set hp_remaining = least(hp_max, hp_remaining + v_bheal) where id = p_hunt and status = 'active'
        returning hp_remaining into v_hp;
    end if;
    -- Phase 2 below 25% HP: the boss gains one more passive (once per hunt).
    v_phase := null;
    if v_hp::numeric / greatest(1, v_hpmax) < 0.25 and not coalesce((v_passive->>'phase2')::boolean, false) then
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
    elsif (v_hp + v_dmg)::numeric / greatest(1, v_hpmax) >= 0.5 and v_hp::numeric / greatest(1, v_hpmax) < 0.5 then
      v_phase := 'rage';                            -- this hit took the boss below 50%
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
    v_dmg, v_counter, v_cdmg, v_cardhp, v_downed, v_hp);

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
    'synergy', case when v_syn >= 3 then jsonb_build_object('element', v_elem, 'count', v_syn) else null end,
    'boss_action', case when v_bossact is null then null
      else jsonb_build_object('kind', case when v_bossact = 'counter' then v_ctr->>'anim' else v_bossact end, 'round', v_round, 'targets', v_targets)
        || case when v_ctr is null then '{}'::jsonb else jsonb_build_object('move', v_ctr->>'move', 'counter', v_ctr->>'key') end end);
end $function$
;

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
  if coalesce((v_marks->>'null_next')::boolean, false) then   -- Packet Loss / Shadow Ban: this play does nothing
    update hunt_combat_state set marks = marks - 'null_next', updated_at = now() where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
    update hunt_card_hp set cd_until_round = v_round + v_cd, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and card_id = p_card and hit_date = v_day;
    insert into combat_actions (mode, ref_id, player_id, card_id, kind, game_day, round, effect, amount, target_card, result)
      values ('hunt', p_hunt, p_player, p_card, 'support', v_day, v_round, v_eff, 0, case when v_tgt in ('ally', 'self') then p_target end,
              jsonb_build_object('nullified', true, 'countered', jsonb_build_array('null_next')));
    return jsonb_build_object('ok', true, 'effect', v_eff, 'nullified', true, 'countered', jsonb_build_array('null_next'),
      'ready_round', v_round + v_cd, 'round', v_round, 'boss_hp', (select hp_remaining from hunts where id = p_hunt), 'defeated', false);
  end if;
  if v_eff = 'heal' and 'plague' = any(v_plist) then v_f := v_f * 0.1; v_ctr := v_ctr || 'plague'::text; end if;
  if v_eff in ('shield', 'smite') and 'shatterer' = any(v_plist) then v_f := v_f * 0.1; v_ctr := v_ctr || 'shatterer'::text; end if;
  if v_eff in ('empower', 'expose') and 'dispeller' = any(v_plist) then v_f := v_f * 0.1; v_ctr := v_ctr || 'dispeller'::text; end if;
  if v_eff = 'weaken' and 'juggernaut' = any(v_plist) then v_f := v_f * 0.1; v_ctr := v_ctr || 'juggernaut'::text; end if;
  if v_eff = 'heal' and p_target is not null and hunt_mark_on(v_marks->'heal_block_card', p_target::text, v_round) then
    v_f := v_f * 0.1; v_ctr := v_ctr || 'bloodrot'::text;
  end if;
  if v_eff in ('shield', 'empower', 'weaken', 'expose', 'smite') and hunt_mark_on(v_marks, 'block_' || v_eff, v_round) then
    v_f := v_f * coalesce((v_marks->('block_' || v_eff)->>'mult')::numeric, 0.1); v_ctr := v_ctr || ('block_' || v_eff);
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
    if v_matched then v_amt := v_amt * 1.8; end if;

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
    if hunt_mark_on(v_marks, 'spiral', v_round) then   -- Rage Spiral: each weaken adds 20% to the boss damage
      perform hunt_marks_patch(p_hunt, p_player, v_day, jsonb_build_object('spiral', (v_marks->'spiral')
        || jsonb_build_object('bonus', coalesce((v_marks->'spiral'->>'bonus')::numeric, 0) + 0.2)));
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
      return jsonb_build_object('ok', false, 'error', 'boss_stun_immune', 'ready_round', v_stun_until + 2);
    end if;
    -- Desync / Juggernaut (hunt_boss_moves.sql): the stun fails; the card still goes on cooldown.
    if coalesce((v_marks->>'stun_fail')::boolean, false) then
      v_fail := true; v_ctr := v_ctr || 'desync'::text;
      update hunt_combat_state set marks = marks - 'stun_fail', updated_at = now() where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
    elsif 'juggernaut' = any(v_plist) then
      if random() < 0.9 then v_fail := true; v_ctr := v_ctr || 'juggernaut'::text; end if;
    end if;
    if not v_fail then
    update hunt_combat_state set stunned_until = v_round + 1, updated_at = now()
      where hunt_id = p_hunt and player_id = p_player and hit_date = v_day;
    end if;
  elsif v_eff = 'cleanse' then
    if hunt_mark_on(v_marks, 'lock_cleanse', v_round) then   -- Hotfix (hunt_boss_moves.sql): the curse stays
      v_ctr := v_ctr || 'hotfix'::text;
    elsif 'plague' = any(v_plist) then                         -- Plague: removes only 10% of a curse
      v_ctr := v_ctr || 'plague'::text;
      update hunt_card_hp set dmg_debuff = dmg_debuff + (1 - dmg_debuff) * 0.1, updated_at = now()
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
end $function$
;

CREATE OR REPLACE FUNCTION public.spawn_hunt(p_days integer DEFAULT 3, p_tier text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_players int; v_tier text; v_nweak int; v_nresist int; v_tiermult numeric;
  v_weak jsonb; v_resist jsonb; v_hp bigint; v_name text; v_id bigint; v_pow bigint;
  v_pool text[]; v_recent text[]; v_fresh text[]; v_weaktags text[]; v_resisttags text[];
  v_passive jsonb; v_pk text; v_plist jsonb; v_hunters int;
  v_cfg jsonb; v_atk int;
  v_plabels jsonb := jsonb_build_object(
    'armored',      'Armored: melee attackers deal less',
    'shrouded',     'Shrouded: attacks miss more often',
    'flaming',      'Flaming: burns the attacking card',
    'volatile',     'Volatile: counterattacks hit harder',
    'regenerating', 'Regenerating: heals a little every turn',
    'thorns',       'Thorns: part of your damage comes back to your card',
    'frenzied',     'Frenzied: hits harder as it loses HP',
    -- The counter passives (hunt_boss_moves.sql): at most one on a boss.
    'plague',       'Plague: heals and cleanse barely work',
    'shatterer',    'Shatterer: shields and smite barely work',
    'dispeller',    'Dispeller: empower and expose barely work',
    'juggernaut',   'Juggernaut: weaken and stun barely work');
  -- Only the rigged model bosses (tcg-activity/src/boss-model.js MODEL_BOSSES).
  c_names text[] := array['The Rage-Quit Warlord','The Netcode Mutant','Maw of the Meta',
                          'The Lagspike Parasite','The Patch-Day Pumpkin','The Ranked Nightshade',
                          'The Grind Vampire','The Ban-Wave Demon','The Smurf Brute',
                          'The AFK Warzombie','The Hardstuck Skeleton','The Zerg-Rush Queen'];
begin
  update hunts set status = 'expired' where status = 'active';
  -- p_tier picks the tier (an early boss, Nathan 2026-10-04); NULL = random, as the weekly spawn does.
  if p_tier is not null and p_tier not in ('Normal', 'Heroic', 'Mythic') then raise exception 'bad tier %', p_tier; end if;
  v_tier := coalesce(p_tier, (array['Normal','Heroic','Mythic'])[1 + floor(random() * 3)]);
  v_nweak   := case v_tier when 'Normal' then 1 when 'Heroic' then 2 else 3 end;
  v_nresist := case v_tier when 'Normal' then 0 when 'Heroic' then 1 else 2 end;

  -- Weak/resist tags come only from slugs that a FAIR SHARE of the draw-pool
  -- attackers carry: at least 4 cards (and 7%), at most 35%. A tag with 1 card is a
  -- weakness nobody can use; origin:smash (59% of attackers) makes every squad match.
  -- If the band has too few tags for this tier, fall back to every tag held by 2+.
  with att as (
    select s.id, s.tag_slugs from subjects s
    where s.tags->>'class' = 'attacker'
      and exists (select 1 from cards c where c.subject_id = s.id and c.in_draw_pool)
  ), cov as (
    select slug, count(distinct att.id) n from att, unnest(att.tag_slugs) slug
    where slug like 'trait:%' or slug like 'origin:%' group by slug
  ), tot as (select count(*) total from att)
  select array_agg(slug), (select array_agg(slug) from cov where n >= 2)
    into v_pool, v_fresh
  from cov, tot
  where n >= greatest(4, ceil(tot.total * 0.07)) and n <= floor(tot.total * 0.35);
  if coalesce(array_length(v_pool, 1), 0) < v_nweak + v_nresist then v_pool := v_fresh; end if;

  select coalesce(array_agg(distinct e->>'value'), '{}') into v_recent
  from (select weak_points from hunts order by id desc limit 4) h,
       lateral jsonb_array_elements(coalesce(h.weak_points, '[]'::jsonb)) e
  where e->>'kind' = 'tag';

  if v_pool is null or array_length(v_pool, 1) is null then
    v_weak := '[]'::jsonb; v_resist := '[]'::jsonb;
  else
    select coalesce(array_agg(p), '{}') into v_fresh
      from unnest(v_pool) p where p <> all(v_recent);
    select array_agg(t) into v_weaktags from (
      select t from unnest(case when coalesce(array_length(v_fresh, 1), 0) >= v_nweak then v_fresh else v_pool end) t
      order by random() limit v_nweak) x;
    select array_agg(t) into v_resisttags from (
      select t from unnest(v_pool) t where t <> all(coalesce(v_weaktags, '{}'))
      order by random() limit v_nresist) x;
    select coalesce(jsonb_agg(jsonb_build_object('kind', 'tag', 'value', t)), '[]'::jsonb)
      into v_weak from unnest(coalesce(v_weaktags, '{}')) t;
    select coalesce(jsonb_agg(jsonb_build_object('kind', 'tag', 'value', t)), '[]'::jsonb)
      into v_resist from unnest(coalesce(v_resisttags, '{}')) t;
  end if;

  -- Stacking passives (Nathan, 2026-09-28): Normal 1, Heroic 2, Mythic 3, all different.
  -- passive.kind/label = the first (older readers); passive.list = all of them.
  select coalesce(jsonb_agg(jsonb_build_object('kind', k, 'label', v_plabels->>k)), '[]'::jsonb) into v_plist
    from (select k from unnest(array['armored','shrouded','flaming','volatile','regenerating','thorns','frenzied',
                               (array['plague','shatterer','dispeller','juggernaut'])[1 + floor(random() * 4)::int]]) k
          order by random() limit case v_tier when 'Normal' then 1 when 'Heroic' then 2 else 3 end) x;
  v_passive := jsonb_build_object('kind', v_plist->0->>'kind', 'label', v_plist->0->>'label', 'list', v_plist);

  -- Fixed HP per tier (the settings dial 'hunt_hp', see the header).
  select value into v_cfg from settings where key = 'hunt_hp';
  v_cfg := coalesce(v_cfg, '{"Normal":60000,"Heroic":80000,"Mythic":80000,"crew":10}'::jsonb);
  v_hp := greatest(500, coalesce((v_cfg->>v_tier)::bigint, 80000));
  v_hunters := greatest(1, coalesce((v_cfg->>'crew')::int, 10));
  v_name := c_names[1 + floor(random() * array_length(c_names, 1))];
  -- Boss stats: the tier ATK (settings hunt_atk) x this boss's own multiplier
  -- (settings hunt_boss_stats, by name, for example {"The Smurf Brute": {"atk_mult": 1.2}}).
  v_atk := round(coalesce((select (value->>v_tier)::numeric from settings where key = 'hunt_atk'),
                          case v_tier when 'Heroic' then 73 when 'Mythic' then 93 else 58 end)
                 * coalesce((select (value->v_name->>'atk_mult')::numeric from settings where key = 'hunt_boss_stats'), 1));
  -- The boss heals are sized to HP / crew (boss-sim.mjs: heals sized to the FULL HP make
  -- every heal worth several squad battles).
  insert into hunts (name, tier, weak_points, resist_points, passive, hp_max, hp_remaining, closes_at, hp_share, stats)
    values (v_name, v_tier, v_weak, v_resist, v_passive, v_hp, v_hp, now() + make_interval(days => p_days),
            -- the heal share: a fixed size (hunt_hp.heal_share), not HP / crew, so more HP does not mean more healing
            coalesce((v_cfg->>'heal_share')::bigint, greatest(1, round(v_hp::numeric / v_hunters))), jsonb_build_object('atk', v_atk))
    returning id into v_id;
  return v_id;
end $function$
;

notify pgrst, 'reload schema';
