-- Card effects: boons + pranks, Phase 1 (2026-09-27). Design: docs/boons-and-pranks.md.
-- Every card (subject) can carry ONE effect in subjects.effect. A member plays an owned
-- card ON another member from the Activity; play_card_effect() checks and applies it in
-- one transaction. Discord actions go to a queue that the bot executes and reverts.
--
-- Balance rules the engine enforces (design Section 4.1):
--   1. No effect causes another effect. Only `reflect` redirects, and a reflected prank
--      cannot be reflected again.
--   2. No effect changes a cooldown.
--   3. No effect gives anything back to its sender.
--   4. A non-stacking effect cannot be applied twice to the same target while active.
--   5. Every hard limit lives in effect_primitives and clamps every tier.

-- The fixed set of effect types. `enabled` rolls them out phase by phase (all OFF now).
create table if not exists effect_primitives (
  primitive      text primary key,
  kind           text not null check (kind in ('boon', 'prank', 'counter')),
  channel        text not null check (channel in ('app', 'discord', 'voice')),
  max_amount     numeric,          -- hard ceiling on the amount after tier scaling
  max_duration_s int,              -- hard ceiling on the duration after tier scaling
  stacks         boolean not null default false,
  enabled        boolean not null default false,
  note           text
);
alter table effect_primitives enable row level security;

insert into effect_primitives (primitive, kind, channel, max_amount, max_duration_s, note) values
  -- boons in the Activity
  ('lucky_pull',     'boon',    'app',     3,    null,   'next pack: one slot at rare rates x amount'),
  ('gift_pack',      'boon',    'app',     1,    null,   'target +amount packs (weekly cap)'),
  ('rally',          'boon',    'app',     25,   null,   'next Hunt attack +amount %'),
  ('mend',           'boon',    'app',     30,   null,   'heal one damaged Hunt card by amount HP'),
  ('spotlight',      'boon',    'app',     null, 172800, 'profile glow + title'),
  ('ward',           'counter', 'app',     null, 172800, 'blocks the next prank'),
  ('reflect',        'counter', 'app',     null, 172800, 'bounces the next prank to its sender'),
  ('cleanse',        'counter', 'app',     null, null,   'removes all pranks now'),
  -- pranks in the Activity
  ('sticker',        'prank',   'app',     null, 129600, 'card art on profile + showcase'),
  ('title',          'prank',   'app',     null, 129600, 'silly title from the card list'),
  ('jinx',           'prank',   'app',     null, null,   'next pack reveal in cursed style'),
  ('confetti',       'prank',   'app',     null, null,   'card art bursts on next open'),
  ('swap_showcase',  'prank',   'app',     null, 129600, 'showcase shows a random Normal'),
  -- Discord pranks
  ('nickname',       'prank',   'discord', null, 3600,   'nickname from the card list, then restored'),
  ('timeout',        'prank',   'discord', null, 60,     'Discord timeout'),
  ('ping_parade',    'prank',   'discord', 3,    300,    'amount pings over duration'),
  ('reaction_storm', 'prank',   'discord', 5,    3600,   'react to the next amount messages'),
  ('clown_role',     'prank',   'discord', null, 3600,   'colored Clown role'),
  ('voice_corner',   'prank',   'voice',   null, null,   'move to Prank Corner once'),
  ('vc_mute',        'prank',   'voice',   null, 30,     'server mute'),
  ('vc_deafen',      'prank',   'voice',   null, 30,     'server deafen'),
  ('speak_sound',    'prank',   'voice',   5,    60,     'sound when the target speaks'),
  ('entrance_sound', 'prank',   'voice',   3,    86400,  'sound on the next amount voice joins'),
  -- Discord boons
  ('crown',          'boon',    'discord', null, 172800, 'crown before the nickname'),
  ('spotlight_role', 'boon',    'discord', null, 172800, 'hoisted Spotlight role'),
  ('color_role',     'boon',    'discord', null, 172800, 'the target picks a name color'),
  ('hype',           'boon',    'discord', null, null,   'hype post with the card art'),
  ('entrance_theme', 'boon',    'voice',   3,    129600, 'the target picks their own join sound')
on conflict (primitive) do nothing;

-- Tier scaling and the caps (design 4.2 + 4.3). Nathan tunes these; 0 turns a cap off.
insert into settings (key, value) values
  ('card_effect_tiers', '{"normal":{"power":1,"cd":1},"illustrated_rare":{"power":1.15,"cd":0.9},"secret_rare":{"power":1.3,"cd":0.8},"full_art":{"power":1.3,"cd":0.75},"gold":{"power":1.5,"cd":0.65}}'::jsonb),
  ('card_effect_caps',  '{"send_per_day":10,"prank_recv_per_day":5,"timeout_recv_per_day":2,"pair_per_day":3,"gift_pack_per_week":2}'::jsonb)
on conflict (key) do nothing;

-- One row per play (the log; the bot posts rows where posted_at is null).
create table if not exists card_plays (
  id          bigserial primary key,
  player_id   text not null references players(id),
  target_id   text not null references players(id),   -- who it landed on (the sender if reflected)
  aimed_at    text not null references players(id),   -- who the sender picked
  card_id     bigint not null references cards(id),
  subject_id  bigint not null references subjects(id),
  primitive   text not null references effect_primitives(primitive),
  kind        text not null,
  rarity      text not null,
  amount      numeric,
  duration_s  int,
  outcome     text not null check (outcome in ('applied', 'blocked', 'reflected')),
  created_at  timestamptz not null default now(),
  posted_at   timestamptz
);
create index if not exists card_plays_player_day on card_plays (player_id, created_at);
create index if not exists card_plays_target_day on card_plays (target_id, created_at);
alter table card_plays enable row level security;

-- The cooldown belongs to the player + the card SUBJECT, so a trade does not reset it.
create table if not exists card_effect_cooldowns (
  player_id  text not null references players(id),
  subject_id bigint not null references subjects(id),
  ready_at   timestamptz not null,
  primary key (player_id, subject_id)
);
alter table card_effect_cooldowns enable row level security;

-- Effects that live in the Activity (and the pending counters ward/reflect).
create table if not exists player_effects (
  id             bigserial primary key,
  player_id      text not null references players(id),
  primitive      text not null references effect_primitives(primitive),
  amount         numeric,
  duration_s     int,
  options        jsonb not null default '{}'::jsonb,
  source_play_id bigint references card_plays(id),
  created_at     timestamptz not null default now(),
  expires_at     timestamptz,           -- null = until consumed
  consumed_at    timestamptz
);
create index if not exists player_effects_active on player_effects (player_id, primitive) where consumed_at is null;
alter table player_effects enable row level security;

-- Discord + voice actions for the bot: it executes pending rows and reverts at revert_at.
create table if not exists discord_effects (
  id             bigserial primary key,
  play_id        bigint not null references card_plays(id),
  target_id      text not null references players(id),
  primitive      text not null references effect_primitives(primitive),
  amount         numeric,
  duration_s     int,
  options        jsonb not null default '{}'::jsonb,
  status         text not null default 'pending' check (status in ('pending', 'active', 'done', 'failed', 'reverted', 'skipped')),
  execute_after  timestamptz not null default now(),
  revert_at      timestamptz,
  original_value text,
  error          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists discord_effects_todo on discord_effects (status, execute_after);
alter table discord_effects enable row level security;

alter table subjects add column if not exists effect jsonb;

-- Is an effect of this primitive still active on this player?
create or replace function card_effect_active(p_player text, p_primitive text)
returns boolean language sql stable set search_path = public as $$
  select exists (select 1 from player_effects
                  where player_id = p_player and primitive = p_primitive and consumed_at is null
                    and (expires_at is null or expires_at > now()))
      or exists (select 1 from discord_effects
                  where target_id = p_player and primitive = p_primitive
                    and status in ('pending', 'active') and (revert_at is null or revert_at > now()));
$$;

-- Play an owned card's effect on another member. Returns {ok, ...} or {ok:false, error}.
create or replace function play_card_effect(p_player text, p_card bigint, p_target text)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_subject bigint; v_rarity text; v_qty int; v_eff jsonb; v_prim effect_primitives%rowtype;
  v_tiers jsonb; v_caps jsonb; v_power numeric; v_cd numeric;
  v_amount numeric; v_dur int; v_cooldown_h numeric; v_ready timestamptz;
  v_day timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_final text := p_target; v_outcome text := 'applied'; v_play bigint;
  v_reflect_id bigint; v_ward_id bigint;
begin
  if p_player = p_target then return jsonb_build_object('ok', false, 'error', 'self_target'); end if;
  if not exists (select 1 from players where id = p_target) then
    return jsonb_build_object('ok', false, 'error', 'no_target');
  end if;

  -- Serialize plays that touch the same members (caps + counters), in a fixed order.
  perform 1 from players where id in (p_player, p_target) order by id for update;

  select pc.quantity, c.subject_id, c.rarity::text, s.effect
    into v_qty, v_subject, v_rarity, v_eff
  from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
  where pc.player_id = p_player and pc.card_id = p_card;
  if not found or v_qty < 1 then return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;
  if v_eff is null or v_eff->>'primitive' is null then
    return jsonb_build_object('ok', false, 'error', 'no_effect');
  end if;

  select * into v_prim from effect_primitives where primitive = v_eff->>'primitive';
  if not found or not v_prim.enabled then
    return jsonb_build_object('ok', false, 'error', 'effect_disabled', 'primitive', v_eff->>'primitive');
  end if;

  -- Cooldown (player + subject).
  select ready_at into v_ready from card_effect_cooldowns
   where player_id = p_player and subject_id = v_subject for update;
  if found and v_ready > now() then
    return jsonb_build_object('ok', false, 'error', 'cooldown', 'ready_at', v_ready);
  end if;

  -- Caps (0 or missing = off).
  select value into v_caps from settings where key = 'card_effect_caps';
  v_caps := coalesce(v_caps, '{}'::jsonb);
  if coalesce((v_caps->>'send_per_day')::int, 0) > 0
     and (select count(*) from card_plays where player_id = p_player and created_at >= v_day)
         >= (v_caps->>'send_per_day')::int then
    return jsonb_build_object('ok', false, 'error', 'send_cap');
  end if;
  if coalesce((v_caps->>'pair_per_day')::int, 0) > 0
     and (select count(*) from card_plays where player_id = p_player and aimed_at = p_target and created_at >= v_day)
         >= (v_caps->>'pair_per_day')::int then
    return jsonb_build_object('ok', false, 'error', 'pair_cap');
  end if;
  if v_prim.kind = 'prank' then
    if coalesce((v_caps->>'prank_recv_per_day')::int, 0) > 0
       and (select count(*) from card_plays where target_id = p_target and kind = 'prank' and created_at >= v_day)
           >= (v_caps->>'prank_recv_per_day')::int then
      return jsonb_build_object('ok', false, 'error', 'target_prank_cap');
    end if;
    if v_prim.primitive = 'timeout' and coalesce((v_caps->>'timeout_recv_per_day')::int, 0) > 0
       and (select count(*) from card_plays where target_id = p_target and primitive = 'timeout' and created_at >= v_day)
           >= (v_caps->>'timeout_recv_per_day')::int then
      return jsonb_build_object('ok', false, 'error', 'target_timeout_cap');
    end if;
  end if;
  if v_prim.primitive = 'gift_pack' and coalesce((v_caps->>'gift_pack_per_week')::int, 0) > 0
     and ((select count(*) from card_plays where primitive = 'gift_pack' and outcome = 'applied'
            and target_id = p_target and created_at > now() - interval '7 days') >= (v_caps->>'gift_pack_per_week')::int
       or (select count(*) from card_plays where primitive = 'gift_pack' and outcome = 'applied'
            and player_id = p_player and created_at > now() - interval '7 days') >= (v_caps->>'gift_pack_per_week')::int) then
    return jsonb_build_object('ok', false, 'error', 'gift_pack_cap');
  end if;

  -- Counters on the target, for pranks only. Find them first, consume them only after
  -- every refusal check, so a refused play never costs the target a ward or a reflect.
  -- A reflected prank is never reflected again (the sender's reflect is not checked).
  if v_prim.kind = 'prank' then
    select id into v_reflect_id from player_effects
     where player_id = p_target and primitive = 'reflect' and consumed_at is null
       and (expires_at is null or expires_at > now()) order by id limit 1;
    if v_reflect_id is not null then v_final := p_player; v_outcome := 'reflected'; end if;
    select id into v_ward_id from player_effects
     where player_id = v_final and primitive = 'ward' and consumed_at is null
       and (expires_at is null or expires_at > now()) order by id limit 1;
    if v_ward_id is not null then v_outcome := 'blocked'; end if;
  end if;

  -- No stacking (checked on the member it would land on). Refused plays keep the cooldown.
  if v_outcome <> 'blocked' and not v_prim.stacks and card_effect_active(v_final, v_prim.primitive) then
    return jsonb_build_object('ok', false, 'error', 'already_active', 'primitive', v_prim.primitive);
  end if;

  update player_effects set consumed_at = now() where id in (v_reflect_id, v_ward_id);

  -- Tier scaling, then the hard ceilings.
  select value into v_tiers from settings where key = 'card_effect_tiers';
  v_power := coalesce((v_tiers->v_rarity->>'power')::numeric, 1);
  v_cd    := coalesce((v_tiers->v_rarity->>'cd')::numeric, 1);
  v_amount := round((v_eff->'base'->>'amount')::numeric * v_power, 2);
  v_dur    := round((v_eff->'base'->>'duration_s')::numeric * v_power)::int;
  if v_prim.max_amount is not null then v_amount := least(v_amount, v_prim.max_amount); end if;
  if v_prim.max_duration_s is not null then v_dur := least(v_dur, v_prim.max_duration_s); end if;
  v_cooldown_h := coalesce((v_eff->>'cooldown_h')::numeric, 24) * v_cd;

  insert into card_plays (player_id, target_id, aimed_at, card_id, subject_id, primitive, kind,
                          rarity, amount, duration_s, outcome)
  values (p_player, v_final, p_target, p_card, v_subject, v_prim.primitive, v_prim.kind,
          v_rarity, v_amount, v_dur, v_outcome)
  returning id into v_play;

  insert into card_effect_cooldowns (player_id, subject_id, ready_at)
  values (p_player, v_subject, now() + make_interval(secs => v_cooldown_h * 3600))
  on conflict (player_id, subject_id) do update set ready_at = excluded.ready_at;

  if v_outcome <> 'blocked' then
    if v_prim.primitive = 'gift_pack' then
      perform grant_packs(v_final, greatest(1, v_amount::int), 'boon', p_player);
    elsif v_prim.primitive = 'cleanse' then
      update player_effects set consumed_at = now()
       where player_id = v_final and consumed_at is null
         and primitive in (select primitive from effect_primitives where kind = 'prank');
      update discord_effects set revert_at = now(), updated_at = now()
       where target_id = v_final and status in ('pending', 'active')
         and primitive in (select primitive from effect_primitives where kind = 'prank');
    elsif v_prim.channel = 'app' then
      insert into player_effects (player_id, primitive, amount, duration_s, options, source_play_id, expires_at)
      values (v_final, v_prim.primitive, v_amount, v_dur, coalesce(v_eff->'options', '{}'::jsonb), v_play,
              case when v_dur is not null and v_dur > 0 then now() + make_interval(secs => v_dur) end);
    else
      insert into discord_effects (play_id, target_id, primitive, amount, duration_s, options, revert_at)
      values (v_play, v_final, v_prim.primitive, v_amount, v_dur, coalesce(v_eff->'options', '{}'::jsonb),
              case when v_dur is not null and v_dur > 0 then now() + make_interval(secs => v_dur) end);
    end if;
  end if;

  return jsonb_build_object('ok', true, 'play_id', v_play, 'outcome', v_outcome, 'target', v_final,
    'primitive', v_prim.primitive, 'kind', v_prim.kind, 'rarity', v_rarity,
    'amount', v_amount, 'duration_s', v_dur, 'ready_at', now() + make_interval(secs => v_cooldown_h * 3600));
end $$;
