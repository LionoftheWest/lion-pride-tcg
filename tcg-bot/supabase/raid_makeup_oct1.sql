-- The Oct 1 raid make-up (Nathan, 2026-10-02). The squad bug stopped 15 of 16 fighters on Oct 1
-- after 1-7 cards. Each fighter's Oct 1 score becomes the higher of their real damage and their
-- simulated best squad (card-studio/_sim-oct1-best.mjs: their cards at their first Oct 1 attack,
-- the auto-pick squad of 8, the real hunt_attack, 90 runs). The extra is leaderboard credit only
-- (hunt_hits on their best Oct 1 card); the boss HP does not change. Plus a 5-pack gift (redeemed in
-- the bell) to every active player (opened a pack or started the tutorial). Runs once (guards).

create table if not exists public.hunt_adjustments (
  id bigserial primary key,
  hunt_id bigint not null references public.hunts(id) on delete cascade,
  player_id text not null references public.players(id) on delete cascade,
  hit_date date not null,
  damage int not null,
  reason text not null,
  created_at timestamptz not null default now(),
  unique (hunt_id, player_id, hit_date, reason)
);
alter table public.hunt_adjustments enable row level security;

-- APPLIED ONCE on 2026-10-02. Do not run this file again.
-- The per-member make-up (15 fighters, hunt 101698, hit_date 2026-10-01) is stored in Supabase:
--   public.hunt_adjustments, reason = 'oct1_squad_bug' (player_id, damage = the extra credit).
-- The same transaction added each extra to that member's best Oct 1 hunt_hits row (the highest
-- damage card). The member rows are not in this public repository (Nathan,
-- 2026-10-03: no member data in a public repo).

select give_gift(p.id, 'promo', 'Raid bug make-up', 5, 'raid_makeup_oct1')
  from players p
 where (exists (select 1 from player_cards pc where pc.player_id = p.id)
        or (p.tutorial is not null and p.tutorial::text not in ('{}', 'null')))
   and not exists (select 1 from gift_claims g where g.player_id = p.id and g.reason = 'raid_makeup_oct1');

-- Oct 2: the members who fought today BEFORE the squad fix (12:02 UTC, no locked squad) get a fresh
-- squad of 8: today's battle cards and rounds are cleared (their damage today stays). Once per member
-- (a marker row in hunt_adjustments).
with who as (
  select h.player_id from hunt_hits h
   where h.hunt_id = 101698 and h.hit_date = '2026-10-02'
     and not exists (select 1 from hunt_squads s where s.hunt_id = 101698 and s.player_id = h.player_id and s.hit_date = '2026-10-02')
   group by h.player_id having min(h.created_at) < '2026-10-02 12:02:00+00'
), mark as (
  insert into hunt_adjustments (hunt_id, player_id, hit_date, damage, reason)
  select 101698, player_id, '2026-10-02', 0, 'oct2_squad_reset' from who on conflict do nothing returning player_id
), d1 as (
  delete from hunt_card_hp h using mark m where h.hunt_id = 101698 and h.hit_date = '2026-10-02' and h.player_id = m.player_id returning h.player_id
)
delete from hunt_combat_state c using mark m where c.hunt_id = 101698 and c.hit_date = '2026-10-02' and c.player_id = m.player_id;
