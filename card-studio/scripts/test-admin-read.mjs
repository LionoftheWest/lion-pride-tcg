/**
 * Acceptance test for tcg-bot/supabase/admin_read.sql (the READ ONLY data layer of the Admin view). Rolled back: one DO
 * block seeds 3 FAKE members (tst_admin_1..3) and a PRIVATE Hunt in March 2026 (before the first real member, so no real
 * row falls in the test periods), calls each admin_ function, and returns the results in the exception.
 *   node scripts/test-admin-read.mjs              the migration file, executed inside the block
 *   node scripts/test-admin-read.mjs --old        the database as it is (the baseline: it must FAIL before the file)
 *   node scripts/test-admin-read.mjs --mutations  each mutation of the file must make at least one case FAIL
 * Invariants:
 *   A1 the active rule (admin_active_days): a member is active on a day with a game action; chat and voice are discord only
 *   A2 admin_overview gives the exact numbers of the seeded week (members, packs, Shards, cards, pulls, trades, gifts, Hunt, effects)
 *   A3 admin_economy: the supply at the end of each bucket = the ledger sums; the ratios
 *   A4 admin_members: search, sort, offset pages; the balances and the counts of a row
 *   A5 admin_member: balances = ledger sums, collection by rarity, activity, Hunt, trading
 *   A6 admin_member_timeline: every source appears, newest first, and keyset pages (size 4) join to the full list with no gap
 *      and no repeat, also where rows share one time
 *   A7 admin_cards, admin_hunts, admin_hunt (rank buckets, prizes, reconcile; a hunt_hits change with no log shows)
 *   A8 admin_health: the reconciles see a broken pack balance; refs_missing sees a ledger row with no source row
 *   A9 admin_report_catalog / admin_report: every report runs, the Hunt board and pull luck are exact, an unknown key is refused
 *   A10 admin_growth: cohorts, D1/D7/D30, the funnel, churn and feature reach of the seeded members
 *   A11 security: only the service role can execute; search_path = public; not volatile (cannot write); only admin_health is
 *       security definer; every function has a comment
 * The 2026-10-07 update (2 more FAKE members tst_adread_4 and _5 in May 2026, so the March cases above do not change):
 *   A12 admin_member_timeline: every new log kind (guild, visit with its screens, tutorial, profile, wishlist, stat points,
 *       note reads, admin actions on the member, a report about the member, one fight row per Dungeon run) with its exact text
 *       and amount, newest first; the totals per kind; the kind filter with keyset pages; an unknown kind is refused
 *   A13 admin_member: the avatar URL (only a Discord hash), the power rank, the Discord server join and leave, the app counts,
 *       the reports against the member
 *   A14 admin_cards name search (LIKE characters escaped) and admin_card (the changes that the seed makes, measured against
 *       the same card before the seed: owners, copies, stars, trades, Hunt, Dungeon fight, plays, wishlist)
 *   A15 admin_dungeon: runs, rooms reached, deaths, kills by monster type, Shards / cards / packs paid, the boards, the Gauntlet
 *       week, the damage of each card, the reconcile (and a broken run HP shows)
 *   A16 admin_feed: the whole game, newest first, the kinds, the keyset pages, the kind filter, an unknown kind is refused
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).text();
const OLD = process.argv.includes('--old');
const src = readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/admin_read.sql', import.meta.url)), 'utf8').replace(/\r/g, '').replace(/notify pgrst[^\n]*\n/g, '');
if (/\$(m|t)\$/.test(src)) throw new Error('admin_read.sql must not contain $m$ or $t$');

const MUTATIONS = {
  'A1 the active rule ignores Hunt attacks': ["from hunt_combat_log h, b where h.ts >= b.t0", "from hunt_combat_log h, b where false and h.ts >= b.t0"],
  'A1 chat counts as a game action': ["select d.player_id, d.activity_date, 'chat', false", "select d.player_id, d.activity_date, 'chat', true"],
  'A2 expected pulls off by one card': ["'expected', round(n_pulled * coalesce(m.rate, 0), 2)", "'expected', round((n_pulled + 1) * coalesce(m.rate, 0), 2)"],
  'A2 earned packs count member gifts': ["and l.amount > 0 and l.reason <> 'gift_received'),\n    'opened'", "and l.amount > 0),\n    'opened'"],
  'A4 search ignores the name': ['or p.id ilike v_like or p.username ilike v_like)', 'or p.id ilike v_like)'],
  'A6 the timeline drops the Shard ledger': ['from shard_ledger s where s.player_id = p_player', 'from shard_ledger s where s.player_id = p_player and false'],
  'A6 the keyset repeats a row': ['and sel.key < p_before_key)', 'and sel.key <= p_before_key)'],
  'A12 a visit loses its screens': ['where pv.sid is not null group by pv.sid, pv.view', 'where pv.sid is null group by pv.sid, pv.view'],
  'A12 a view just before its visit does not join it': ["s2.started_at <= v.at + interval '1 minute'\n                                                         order by", "s2.started_at <= v.at\n                                                         order by"],
  'A12 the tutorial rows of profile_log show': ["from profile_log f where f.player_id = p_player and f.field not like 'tutorial%'", 'from profile_log f where f.player_id = p_player'],
  'A12 the kind filter is ignored': ['sel as (select * from ev where ev.kind = any (v_kinds))', 'sel as (select * from ev)'],
  'A12 an admin action on another target kind shows': ["from admin_actions a where a.target_id = p_player and coalesce(a.target_kind, 'player') in ('player', 'member')\n    union all", 'from admin_actions a where a.target_id = p_player\n    union all'],
  'A12 note reads one row per note': ['from notifications n where n.player_id = p_player and n.read_at is not null group by n.read_at', 'from notifications n where n.player_id = p_player and n.read_at is not null group by n.read_at, n.id'],
  'A12 the Dungeon fight counts heals as damage taken': ["coalesce(sum((a.result->>'value')::numeric) filter (where a.result->>'side' = 'card' and a.result->>'dir' = 'dmg'), 0) || ' taken, '", "coalesce(sum((a.result->>'value')::numeric) filter (where a.result->>'side' = 'card'), 0) || ' taken, '"],
  'A13 the avatar URL takes any text': ["case when p.avatar ~ '^(a_)?[0-9a-f]{32}$' then", 'case when p.avatar is not null then'],
  'A13 the power rank counts the member': ['from collection_power_all() w where w.power > v_pw', 'from collection_power_all() w where w.power >= v_pw'],
  'A14 the card search does not escape LIKE': ["replace(replace(replace(coalesce(v_q, ''), '\\', '\\\\'), '%', '\\%'), '_', '\\_')", "coalesce(v_q, '')"],
  'A14 a swap counts only the offered side': ["'swaps', (select count(*) from card_trades t where p_card = any (t.from_cards || t.to_cards))", "'swaps', (select count(*) from card_trades t where p_card = any (t.from_cards))"],
  'A15 a kill reads the first foe': ["(coalesce(l.action->>'target', l.action->>'target_foe'))::int as f) x", '0 as f) x'],
  'A15 damage taken counts the heals': ["filter (where a.card_id is null and a.result->>'side' = 'card' and a.result->>'dir' = 'dmg'), 0) taken", "filter (where a.card_id is null and a.result->>'side' = 'card'), 0) taken"],
  'A15 the reconcile takes runs from before the log': ['from runs r where r.started_at >= v_log),', 'from runs r),'],
  'A16 the feed misses a big pull': ['rarity_rank(k.rarity::text) >= 2', 'rarity_rank(k.rarity::text) >= 5'],
  'A16 the feed keyset repeats a row': ['ev.key < p_before_key))', 'ev.key <= p_before_key))'],
  'A16 the feed kind filter lets pulls in': ["where 'pull' = any (v_k) and", 'where true and'],
  'A7 reconcile is always ok': ["'unexplained', (select coalesce(sum(unexplained), 0) from rec), 'ok', not exists (select 1 from rec where unexplained <> 0)", "'unexplained', (select coalesce(sum(unexplained), 0) from rec), 'ok', true"],
  'A10 D1 looks one day late': ['ad.day = j.jd + x.nd)) kept', 'ad.day = j.jd + x.nd + 1)) kept'],
  'A11 anon can execute': ["execute format('revoke execute on function %s from public, anon, authenticated', f);", "execute format('grant execute on function %s to anon', f);"],
};

const A = 'tst_admin_1', B = 'tst_admin_2', C = 'tst_admin_3';
// The 2026-10-07 update: two more fake members in May 2026 (another id prefix: the tst_admin search cases stay the same).
const D = 'tst_adread_4', E = 'tst_adread_5';
const HASH = 'a_0123456789abcdef0123456789abcdef';
// What the seed adds to a number of admin_card (o = after, b = before the seed): a jsonb path, or the field of one array item.
const dl = (o, b, path) => `((${o} #>> '{${path}}')::numeric - coalesce((${b} #>> '{${path}}')::numeric, 0))`;
const darr = (o, b, arr, key, val, field) => `((select coalesce(sum((e->>'${field}')::numeric), 0) from jsonb_array_elements(${o}->'${arr}') e where e->>'${key}' = '${val}')`
  + ` - (select coalesce(sum((e->>'${field}')::numeric), 0) from jsonb_array_elements(${b}->'${arr}') e where e->>'${key}' = '${val}'))`;
// The read functions = the grant list at the end of admin_read.sql.
const READ_FNS = src.match(/foreach f in array array\[([\s\S]*?)\] loop/)[1].replace(/\s+/g, ' ').trim();
const mt = (s) => `timestamptz '${s} America/Denver'`;
const body = (mig) => String.raw`do $t$
#variable_conflict use_column
declare res jsonb := '[]'; o jsonb; o2 jsonb; e jsonb; h bigint; nrm bigint[]; ir bigint[]; x bigint; y bigint; z bigint; g bigint; sp bigint;
  prim text; ok boolean; n int; i int; full_list jsonb; paged jsonb; cur jsonb; rate_n numeric; rate_ir numeric; fns text[];
  k text; v_before int;
  bx jsonb; by_ jsonb; bz jsonb; run_d bigint; fa bigint; want jsonb; n_more int; pw_d bigint; t_all int; t_pct int;
begin
  ${mig ? `execute $m$${mig}$m$;` : '-- the database as it is'}
  perform set_config('tcg.skip_welcome', 'on', true);
  select array_agg(id order by id) into nrm from (select id from cards where rarity = 'normal' order by id limit 9) c;
  select array_agg(id order by id) into ir from (select id from cards where rarity = 'illustrated_rare' order by id limit 2) c;
  y := nrm[1]; z := nrm[2]; x := nrm[9];
  select id into fa from cards where rarity = 'full_art' order by id limit 1;
  -- A14: the three cards before the seed (admin_card counts all members; the test checks what the seed adds)
  bx := admin_card(x); by_ := admin_card(y); bz := admin_card(z);
  select primitive into prim from effect_primitives where kind = 'prank' order by primitive limit 1;
  rate_n := (balance_get('pulls')->'rates'->>'normal')::numeric; rate_ir := (balance_get('pulls')->'rates'->>'illustrated_rare')::numeric;

  -- ---------------------------------------------------------------- the seed (all times Mountain Time, March 2026)
  insert into players (id, username, created_at) values
    ('${A}', 'tst admin one', ${mt('2026-03-02 10:00')}), ('${B}', 'tst admin two', ${mt('2026-03-03 08:00')}), ('${C}', 'tst admin three', ${mt('2026-03-09 09:00')});
  insert into hunts (name, tier, weak_points, resist_points, hp_max, hp_remaining, opens_at, closes_at, status, created_at, settled_at)
    values ('Test Admin Boss', 'Normal', '[]', '[]', 10000, 9000, ${mt('2026-03-03 00:00')}, ${mt('2026-03-05 17:00')}, 'expired', ${mt('2026-03-03 00:00')}, ${mt('2026-03-05 18:00')})
    returning id into h;
  -- A: the check-in, an open of 2 packs (8 normal + 2 illustrated rare)
  insert into daily_claims (player_id, day, task, amount, created_at) values ('${A}', '2026-03-02', 'checkin', 5, ${mt('2026-03-02 12:00')});
  insert into pack_ledger (player_id, amount, reason, ref_kind, ref_id, created_at) values ('${A}', 5, 'earned_checkin', 'daily_claim', '2026-03-02:checkin', ${mt('2026-03-02 12:00')}),
    ('${A}', -1, 'opened', 'open', 'tst-open-1', ${mt('2026-03-02 12:05')}), ('${A}', -1, 'opened', 'open', 'tst-open-1', ${mt('2026-03-02 12:05')});
  insert into card_ledger (player_id, card_id, amount, reason, ref_kind, ref_id, created_at)
    select '${A}', c, 1, 'pack', 'open', 'tst-open-1', ${mt('2026-03-02 12:05')} from unnest(nrm[1:8] || ir) c;
  insert into player_cards (player_id, card_id, quantity, first_obtained_at) select '${A}', c, 1, ${mt('2026-03-02 12:05')} from unnest(nrm[1:8] || ir) c;
  -- A: the Hunt daily (1 pack + 40 Shards) and 3 attacks (600)
  insert into daily_claims (player_id, day, task, amount, created_at) values ('${A}', '2026-03-03', 'hunt', 1, ${mt('2026-03-03 09:00')});
  insert into pack_ledger (player_id, amount, reason, ref_kind, ref_id, created_at) values ('${A}', 1, 'earned_hunt', 'daily_claim', '2026-03-03:hunt', ${mt('2026-03-03 09:00')});
  insert into shard_ledger (player_id, amount, reason, ref_kind, ref_id, created_at) values ('${A}', 40, 'daily', 'daily_claim', '2026-03-03:hunt', ${mt('2026-03-03 09:00')});
  insert into hunt_combat_log (hunt_id, player_id, card_id, ts, outcome, damage) values
    (h, '${A}', z, ${mt('2026-03-03 10:00')}, 'hit', 100), (h, '${A}', z, ${mt('2026-03-03 10:01')}, 'hit', 200), (h, '${A}', z, ${mt('2026-03-03 10:02')}, 'hit', 300);
  insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage, created_at) values (h, '${A}', z, '2026-03-03', 600, ${mt('2026-03-03 10:00')});
  -- B: a Dungeon prize card, 1 attack (400), the welcome gift claimed, a trade offer (X for A's Y) that A accepts
  insert into card_ledger (player_id, card_id, amount, reason, ref_kind, ref_id, created_at) values ('${B}', x, 1, 'dungeon_prize', 'dungeon_payout', 'daily:2026-03-03', ${mt('2026-03-03 08:30')});
  insert into hunt_combat_log (hunt_id, player_id, card_id, ts, outcome, damage) values (h, '${B}', x, ${mt('2026-03-03 10:30')}, 'hit', 400);
  insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage, created_at) values (h, '${B}', x, '2026-03-03', 400, ${mt('2026-03-03 10:30')});
  insert into gift_claims (player_id, kind, title, amount, reason, created_at, claimed_at) values ('${B}', 'new_player', 'New Player Bonus', 10, 'welcome', ${mt('2026-03-03 08:00')}, ${mt('2026-03-04 10:00')})
    returning id into g;
  insert into pack_ledger (player_id, amount, reason, ref_kind, ref_id, created_at) values ('${B}', 10, 'welcome', 'gift', g::text, ${mt('2026-03-04 10:00')});
  insert into trade_offers (from_id, to_id, offer_card_id, request_card_id, status, created_at, resolved_at)
    values ('${B}', '${A}', x, y, 'accepted', ${mt('2026-03-04 11:00')}, ${mt('2026-03-04 12:00')}) returning id into i;
  insert into card_ledger (player_id, card_id, amount, reason, ref_kind, ref_id, created_at) values
    ('${B}', x, -1, 'trade', 'trade_offer', i::text, ${mt('2026-03-04 12:00')}), ('${A}', x, 1, 'trade', 'trade_offer', i::text, ${mt('2026-03-04 12:00')}),
    ('${A}', y, -1, 'trade', 'trade_offer', i::text, ${mt('2026-03-04 12:00')}), ('${B}', y, 1, 'trade', 'trade_offer', i::text, ${mt('2026-03-04 12:00')});
  delete from player_cards where player_id = '${A}' and card_id = y;
  insert into player_cards (player_id, card_id, quantity, first_obtained_at) values ('${A}', x, 1, ${mt('2026-03-04 12:00')}), ('${B}', y, 1, ${mt('2026-03-04 12:00')});
  -- B gives A 2 packs (a member gift: a transfer, not earned)
  insert into gift_claims (player_id, kind, title, amount, reason, from_id, created_at, claimed_at)
    values ('${A}', 'member_gift', '2 packs from a member', 2, 'gift_received', '${B}', ${mt('2026-03-04 13:00')}, ${mt('2026-03-04 14:00')}) returning id into g;
  insert into pack_ledger (player_id, amount, reason, granted_by, ref_kind, ref_id, created_at) values
    ('${B}', -2, 'gift_sent', '${A}', 'gift', g::text, ${mt('2026-03-04 13:00')}), ('${A}', 2, 'gift_received', '${B}', 'gift', g::text, ${mt('2026-03-04 14:00')});
  -- A: a Shop pack for 30 Shards, the Hunt prize (3 packs), chat; B: voice; C: chat only
  insert into shop_purchases (player_id, day, kind, qty, price, created_at) values ('${A}', '2026-03-04', 'pack', 1, 30, ${mt('2026-03-04 15:00')}) returning id into sp;
  insert into shard_ledger (player_id, amount, reason, ref_kind, ref_id, created_at) values ('${A}', -30, 'shop', 'shop_purchase', sp::text, ${mt('2026-03-04 15:00')});
  insert into pack_ledger (player_id, amount, reason, ref_kind, ref_id, created_at) values ('${A}', 1, 'shop', 'shop_purchase', sp::text, ${mt('2026-03-04 15:00')}),
    ('${A}', 3, 'hunt_reward', 'hunt', h::text, ${mt('2026-03-05 18:00')});
  insert into daily_activity (player_id, activity_date, message_count) values ('${A}', '2026-03-05', 12), ('${C}', '2026-03-09', 3);
  insert into voice_minutes (player_id, day, minutes) values ('${B}', '2026-03-05', 30);
  -- A: week 2, a prank on B
  insert into card_plays (player_id, target_id, aimed_at, card_id, subject_id, primitive, kind, rarity, amount, outcome, created_at)
    values ('${A}', '${B}', '${B}', z, (select subject_id from cards where id = z), prim, 'prank', 'normal', 1, 'applied', ${mt('2026-03-10 13:00')});
  -- A: week 2, a Dungeon run that ends with 5 Shards
  insert into dungeon_runs (player_id, day, squad, state, floor, room, turns, status, ended_by, shards, mode, started_at, ended_at)
    values ('${A}', '2026-03-11', array[z], '{}', 2, 3, 9, 'over', 'fell', 5, 'daily', ${mt('2026-03-11 19:00')}, ${mt('2026-03-11 19:20')}) returning id into i;
  insert into shard_ledger (player_id, amount, reason, ref_kind, ref_id, created_at) values ('${A}', 5, 'dungeon', 'run', i::text, ${mt('2026-03-11 19:20')});
  -- A15: a support of A's run killed the guardian golem in foe slot 1 (the dungeon_log row holds the kill state)
  insert into dungeon_log (run_id, n, action, result, created_at) values (i, 1, jsonb_build_object('kind', 'support', 'card', z, 'target_card', null, 'target_foe', 1),
    '{"kill": {"state": {"foes": [{"key": "slime", "kind": "fight"}, {"key": "golem", "kind": "guardian"}]}}}', ${mt('2026-03-11 19:10')});
  update players p set pack_balance = (select coalesce(sum(amount), 0) from pack_ledger l where l.player_id = p.id),
                       shard_balance = (select coalesce(sum(amount), 0) from shard_ledger l where l.player_id = p.id) where p.id like 'tst_admin_%';

  -- ---------------------------------------------------------------- the May seed (A12 - A16): D has a row of every new log
  -- The combat log starts on 2026-05-01 here (dungeon_combat_log.sql in schema_migrations), so D's run is reconciled and A's is not.
  update schema_migrations set applied_at = ${mt('2026-05-01 00:00')} where file = 'dungeon_combat_log.sql';
  if not found then insert into schema_migrations (file, sha256, applied_at) values ('dungeon_combat_log.sql', 'tst', ${mt('2026-05-01 00:00')}); end if;
  insert into players (id, username, created_at, avatar, guild_joined_at, left_guild_at) values
    ('${D}', 'tst read four', ${mt('2026-05-04 09:00')}, '${HASH}', ${mt('2026-05-04 08:00')}, ${mt('2026-05-06 12:00')}),
    ('${E}', 'tst read five', ${mt('2026-05-04 08:00')}, 'not-a-hash', null, null);
  -- E pulls a Full Art (a big pull for the feed)
  insert into card_ledger (player_id, card_id, amount, reason, ref_kind, ref_id, created_at) values ('${E}', fa, 1, 'pack', 'open', 'tst-open-e', ${mt('2026-05-04 08:10')});
  insert into player_cards (player_id, card_id, quantity, first_obtained_at) values ('${E}', fa, 1, ${mt('2026-05-04 08:10')});
  -- D: two visits, five screen views (one before any visit, one 30 s before the first visit), two walkthrough steps
  insert into app_sessions (player_id, started_at, last_seen_at, ended_at, client) values
    ('${D}', ${mt('2026-05-04 09:05')}, ${mt('2026-05-04 09:25')}, ${mt('2026-05-04 09:25')}, '{"platform": "desktop"}'),
    ('${D}', ${mt('2026-05-05 20:00')}, ${mt('2026-05-05 20:00')}, null, '{}');
  insert into page_views (player_id, view, ref, at) values ('${D}', 'leaderboard', null, ${mt('2026-05-04 08:30')}), ('${D}', 'auction', '7', ${mt('2026-05-04 09:04:30')}),
    ('${D}', 'shop', null, ${mt('2026-05-04 09:06')}), ('${D}', 'shop', null, ${mt('2026-05-04 09:16')}), ('${D}', 'hall', null, ${mt('2026-05-04 09:20')});
  insert into tutorial_steps (player_id, step, done_at) values ('${D}', 'open', ${mt('2026-05-04 09:10')}), ('${D}', 'seen:shop', ${mt('2026-05-04 09:11')});
  -- D: the profile, wishlist and stat point logs (the triggers write them in the game; here the rows directly)
  insert into profile_log (player_id, field, old_value, new_value, changed_at, changed_by) values
    ('${D}', 'username', '"tst old"', '"tst read four"', ${mt('2026-05-04 09:12')}, 'authenticator'),
    ('${D}', 'title', null, '"Rookie"', ${mt('2026-05-04 09:13')}, 'studio:test'),
    ('${D}', 'tutorial.done', '[]', '["open"]', ${mt('2026-05-04 09:13')}, 'authenticator');
  insert into wishlist_log (player_id, slot, op, card_id, old_card_id, changed_at, changed_by) values
    ('${D}', 1, 'add', y, null, ${mt('2026-05-04 09:14')}, 'authenticator'), ('${D}', 1, 'replace', z, y, ${mt('2026-05-04 09:15')}, 'authenticator');
  insert into stat_point_log (player_id, card_id, stat, delta, points, reason, changed_at, changed_by) values
    ('${D}', z, 'attack', 1, 1, 'spend', ${mt('2026-05-04 09:17')}, 'authenticator'), ('${D}', z, 'vitality', 2, 2, 'spend', ${mt('2026-05-04 09:17')}, 'authenticator');
  -- D: two bell notes read together; two admin actions (on D, and on a card with the same id text: not D's); a report by E about D
  insert into notifications (player_id, kind, message, read, created_at, read_at) values
    ('${D}', 'tst', 'tst note', true, ${mt('2026-05-04 09:18')}, ${mt('2026-05-04 09:19')}), ('${D}', 'tst', 'tst note', true, ${mt('2026-05-04 09:18')}, ${mt('2026-05-04 09:19')});
  insert into admin_actions (at, actor, action, target_kind, target_id, reason, source) values
    (${mt('2026-05-04 09:20')}, 'studio:test', 'hide', 'card', '${D}', null, 'studio'),
    (${mt('2026-05-04 09:21')}, 'studio:test', 'grant_packs', 'player', '${D}', 'test', 'studio');
  insert into player_reports (player_id, kind, body, created_at, target_id, synced_at) values ('${E}', 'bug', 'tst report body', ${mt('2026-05-04 09:22')}, '${D}', now());
  -- D: a Gauntlet run (week of Sunday 3 May) that fell on floor 1 room 1: Z hit the slime twice (50 crit, 30 = down), the slime hit
  -- Z (20), Y healed Z (10), the slime downed Y (60). The state at the end matches the log (the reconcile is 0).
  insert into gauntlet_weeks (week, name, squad, theme, floors) values ('2026-05-03', 'tst week', array[z, y], null, '[]');
  insert into dungeon_runs (player_id, day, squad, state, floor, room, turns, status, ended_by, shards, cards, mode, started_at, ended_at)
    values ('${D}', '2026-05-05', array[z, y], jsonb_build_object('cards', jsonb_build_object(z::text, '{"hp": 50, "max": 60, "down": false}'::jsonb, y::text, '{"hp": 0, "max": 60, "down": true}'::jsonb),
            'foes', '[{"key": "slime", "kind": "fight", "hp": 0, "max": 80}]'::jsonb),
            1, 1, 2, 'over', 'fell', 12, array[x], 'gauntlet', ${mt('2026-05-05 10:00')}, ${mt('2026-05-05 10:06')}) returning id into run_d;
  insert into combat_actions (mode, ref_id, player_id, card_id, kind, game_day, round, effect, amount, target_card, target_foe, result, created_at) values
    ('gauntlet', run_d, '${D}', z, 'attack', '2026-05-05', 1, null, null, null, 0, '{"side": "foe", "dir": "dmg", "value": 50, "hp_after": 30, "max": 80, "floor": 1, "room": 1, "crit": true}', ${mt('2026-05-05 10:00')}),
    ('gauntlet', run_d, '${D}', null, 'enemy', '2026-05-05', 2, 'strike', null, z, 0, '{"side": "card", "dir": "dmg", "value": 20, "hp_after": 40, "max": 60, "floor": 1, "room": 1}', ${mt('2026-05-05 10:01')}),
    ('gauntlet', run_d, '${D}', z, 'attack', '2026-05-05', 2, null, null, null, 0, '{"side": "foe", "dir": "dmg", "value": 30, "hp_after": 0, "max": 80, "floor": 1, "room": 1}', ${mt('2026-05-05 10:02')}),
    ('gauntlet', run_d, '${D}', y, 'support', '2026-05-05', 2, 'heal', 10, z, null, '{"side": "card", "dir": "heal", "value": 10, "hp_after": 50, "max": 60, "floor": 1, "room": 1}', ${mt('2026-05-05 10:03')}),
    ('gauntlet', run_d, '${D}', null, 'enemy', '2026-05-05', 3, 'strike', null, y, 0, '{"side": "card", "dir": "dmg", "value": 60, "hp_after": 0, "max": 60, "floor": 1, "room": 1}', ${mt('2026-05-05 10:04')});
  insert into dungeon_log (run_id, n, action, result, created_at) values (run_d, 1, jsonb_build_object('kind', 'attack', 'card', z, 'target', 0),
    '{"dmg": 30, "kill": {"state": {"foes": [{"key": "slime", "kind": "fight"}]}}}', ${mt('2026-05-05 10:02')});
  insert into shard_ledger (player_id, amount, reason, ref_kind, ref_id, created_at) values ('${D}', 12, 'dungeon', 'run', run_d::text, ${mt('2026-05-05 10:06')});
  insert into card_ledger (player_id, card_id, amount, reason, ref_kind, ref_id, created_at) values ('${D}', x, 1, 'dungeon_loot', 'dungeon_run', run_d::text, ${mt('2026-05-05 10:06')});
  -- The Gauntlet board of the week paid D: 50 Shards, 1 pack, 1 card
  insert into dungeon_payouts (mode, period, winners, paid_at) values ('gauntlet', '2026-05-03',
    jsonb_build_array(jsonb_build_object('rank', 1, 'player_id', '${D}', 'shards', 50, 'packs', 1, 'cards', jsonb_build_array(jsonb_build_object('id', x, 'rarity', 'normal')))), ${mt('2026-05-10 18:00')});
  insert into shard_ledger (player_id, amount, reason, ref_kind, ref_id, created_at) values ('${D}', 50, 'dungeon', 'dungeon_payout', 'gauntlet:2026-05-03', ${mt('2026-05-10 18:00')});
  insert into pack_ledger (player_id, amount, reason, ref_kind, ref_id, created_at) values ('${D}', 1, 'dungeon_prize', 'dungeon_payout', 'gauntlet:2026-05-03', ${mt('2026-05-10 18:00')});
  insert into card_ledger (player_id, card_id, amount, reason, ref_kind, ref_id, created_at) values ('${D}', x, 1, 'dungeon_prize', 'dungeon_payout', 'gauntlet:2026-05-03', ${mt('2026-05-10 18:00')});
  insert into player_cards (player_id, card_id, quantity, first_obtained_at) values ('${D}', x, 2, ${mt('2026-05-05 10:06')});
  update players p set pack_balance = (select coalesce(sum(amount), 0) from pack_ledger l where l.player_id = p.id),
                       shard_balance = (select coalesce(sum(amount), 0) from shard_ledger l where l.player_id = p.id) where p.id like 'tst_adread_%';

  -- ---------------------------------------------------------------- A1 + A2: the overview of week 1
  o := admin_overview('2026-03-02', '2026-03-08');
  res := res || jsonb_build_object('case', 'A1 active by day: game actions only, chat and voice are discord only', 'ok', o->'members'->'by_day' = '[
     {"day":"2026-03-02","new":1,"active":1,"discord_only":0},{"day":"2026-03-03","new":1,"active":2,"discord_only":0},
     {"day":"2026-03-04","new":0,"active":2,"discord_only":0},{"day":"2026-03-05","new":0,"active":0,"discord_only":2},
     {"day":"2026-03-06","new":0,"active":0,"discord_only":0},{"day":"2026-03-07","new":0,"active":0,"discord_only":0},
     {"day":"2026-03-08","new":0,"active":0,"discord_only":0}]'::jsonb, 'got', o->'members'->'by_day');
  res := res || jsonb_build_object('case', 'A2 members: total 2, new 2, active 2, discord only 0, avg 0.71, week 2', 'ok',
    o->'members'->'total' = '2' and o->'members'->'new' = '2' and o->'members'->'active' = '2' and o->'members'->'discord_only' = '0'
    and (o->'members'->>'avg_daily_active')::numeric = 0.71 and o->'members'->'by_week' = '[{"week":"2026-03-02","active":2}]', 'got', (o->'members') - 'by_day');
  res := res || jsonb_build_object('case', 'A2 packs: earned 20, opened 2, held at end 18, open/earn 0.1', 'ok',
    o->'packs'->'earned' = '20' and o->'packs'->'opened' = '2' and o->'packs'->'gifted_between_members' = '2' and o->'packs'->'held_at_end' = '18' and (o->'packs'->>'open_earn_ratio')::numeric = 0.1
    and (select (e->>'packs')::int = -2 and (e->>'rows')::int = 2 from jsonb_array_elements(o->'packs'->'by_reason') e where e->>'reason' = 'opened'), 'got', o->'packs');
  res := res || jsonb_build_object('case', 'A2 Shards: earned 40 (daily), spent 30 (shop), ratio 0.75, held 10', 'ok',
    o->'shards'->'earned' = '40' and o->'shards'->'spent' = '30' and (o->'shards'->>'spend_earn_ratio')::numeric = 0.75 and o->'shards'->'held_at_end' = '10'
    and o->'shards'->'earned_by_reason' = '[{"reason":"daily","rows":1,"shards":40}]' and o->'shards'->'spent_by_reason' = '[{"reason":"shop","rows":1,"shards":30}]', 'got', o->'shards');
  res := res || jsonb_build_object('case', 'A2 cards: in pack 10, dungeon_prize 1, trade 2; out trade 2; 11 held', 'ok',
    o->'cards'->'in_by_reason' = '[{"reason":"dungeon_prize","copies":1},{"reason":"pack","copies":10},{"reason":"trade","copies":2}]'
    and o->'cards'->'out_by_reason' = '[{"reason":"trade","copies":2}]' and o->'cards'->'copies_held_at_end' = '11', 'got', o->'cards');
  select e into e from jsonb_array_elements(o->'pulls'->'by_rarity') e where e->>'rarity' = 'illustrated_rare';
  res := res || jsonb_build_object('case', 'A2 pulls: 10 cards, 2 illustrated rare against 10 x the rate (ratio and z)', 'ok',
    o->'pulls'->'cards_pulled' = '10' and (e->>'actual')::int = 2 and (e->>'expected')::numeric = round(10 * rate_ir, 2)
    and (e->>'ratio')::numeric = round(2 / (10 * rate_ir), 3) and (e->>'z')::numeric = round((2 - 10 * rate_ir) / sqrt(10 * rate_ir * (1 - rate_ir)), 2)
    and (select (e2->>'actual')::int = 8 from jsonb_array_elements(o->'pulls'->'by_rarity') e2 where e2->>'rarity' = 'normal'), 'got', o->'pulls');
  res := res || jsonb_build_object('case', 'A2 trades 1 made, 1 accepted, 1 swap, 2 traders; gifts; Hunt 1 boss, 2 fighters, 4 attacks, 1000 damage, 3 prize packs', 'ok',
    o->'trades' = '{"swaps":1,"traders":2,"accepted":1,"declined":0,"listings":0,"cancelled":0,"offers_made":1}'
    and o->'gifts' = '{"claimed":2,"made_by_kind":[{"kind":"member_gift","made":1,"packs":2,"shards":0},{"kind":"new_player","made":1,"packs":10,"shards":0}],"member_to_member":1}'
    and o->'hunt' = '{"hunts":1,"damage":1000,"attacks":4,"fighters":2,"supports":0,"prize_packs":3}' and o->'effects'->'by_kind' = '[]', 'got', jsonb_build_object('t', o->'trades', 'g', o->'gifts', 'h', o->'hunt'));
  o := admin_overview('2026-03-09', '2026-03-15');
  res := res || jsonb_build_object('case', 'A2 week 2: 1 new, 1 active, 1 discord only, 1 prank play', 'ok',
    o->'members'->'new' = '1' and o->'members'->'active' = '1' and o->'members'->'discord_only' = '1'
    and o->'effects'->'by_kind' = '[{"kind":"prank","plays":1,"senders":1,"targets":1,"applied":1,"blocked":0,"refunded":0}]', 'got', jsonb_build_object('m', (o->'members') - 'by_day', 'e', o->'effects'));

  -- ---------------------------------------------------------------- A3 economy
  o := admin_economy('2026-03-02', '2026-03-15', 'week');
  res := res || jsonb_build_object('case', 'A3 supply per week = ledger sums; ratios', 'ok',
    o->'supply' = '[{"t":"2026-03-02","packs_held":18,"copies_held":11,"shards_held":10},{"t":"2026-03-09","packs_held":18,"copies_held":11,"shards_held":15}]'
    and (o->'ratios'->0->>'open_earn')::numeric = 0.1 and (o->'ratios'->0->>'spend_earn')::numeric = 0.75 and o->'ratios'->1->'open_earn' = 'null'
    and (o->'ratios'->1->>'spend_earn')::numeric = 0 and o->'ratios'->1->'shards_earned' = '5'
    and (select (e->>'in')::int = 10 from jsonb_array_elements(o->'series'->'pack') e where e->>'reason' = 'welcome'), 'got', o - 'series');
  begin perform admin_economy('2026-03-02', '2026-03-15', 'month'); ok := false; exception when others then ok := sqlerrm like '%p_bucket%'; end;
  res := res || jsonb_build_object('case', 'A3 an unknown bucket is refused', 'ok', ok);

  -- ---------------------------------------------------------------- A4 members
  o := admin_members('tst_admin', 'name_asc', 2, 0); o2 := admin_members('tst admin', 'name_asc', 2, 2);
  res := res || jsonb_build_object('case', 'A4 search by id or name, name order, offset pages', 'ok',
    o->'total' = '3' and (select jsonb_agg(e->'username') from jsonb_array_elements(o->'rows') e) = '["tst admin one","tst admin three"]'
    and (select jsonb_agg(e->'username') from jsonb_array_elements(o2->'rows') e) = '["tst admin two"]', 'got', jsonb_build_object('p1', o->'rows', 'p2', o2->'rows'));
  o := admin_members('tst_admin', 'last_active', 50, 0);
  e := o->'rows'->0;
  res := res || jsonb_build_object('case', 'A4 last_active order (A 03-11, B 03-04, C never) and the row of A', 'ok',
    (select jsonb_agg(r->'id') from jsonb_array_elements(o->'rows') r) = '["${A}","${B}","${C}"]'
    and e->'last_active' = '"2026-03-11"' and e->'packs' = '10' and e->'shards' = '15' and e->'copies' = '10' and e->'unique_cards' = '10'
    and e->'hunts' = '1' and e->'hunt_damage' = '600' and o->'rows'->2->'last_active' = 'null', 'got', o->'rows');
  begin perform admin_members(null, 'bogus', 5, 0); ok := false; exception when others then ok := sqlerrm like '%unknown sort%'; end;
  res := res || jsonb_build_object('case', 'A4 an unknown sort is refused', 'ok', ok);

  -- ---------------------------------------------------------------- A5 one member
  o := admin_member('${A}');
  res := res || jsonb_build_object('case', 'A5 member A: balances = ledger sums, collection, activity, Hunt, trading', 'ok',
    o->'balances'->'packs' = '10' and o->'balances'->'pack_ledger_sum' = '10' and o->'balances'->'shards' = '15' and o->'balances'->'shard_ledger_sum' = '15'
    and o->'balances'->'packs_opened' = '2' and o->'collection'->'unique_cards' = '10' and o->'collection'->'pulls' = '10' and o->'collection'->'pulls_rare_plus' = '2'
    and o->'collection'->'by_rarity' = '[{"rarity":"normal","unique":8,"copies":8},{"rarity":"illustrated_rare","unique":2,"copies":2}]'
    and o->'activity'->'first_active' = '"2026-03-02"' and o->'activity'->'last_active' = '"2026-03-11"' and o->'activity'->'active_days' = '5'
    and o->'dungeon' = '[{"mode":"daily","runs":1,"best_floor":2,"shards":5}]'
    and o->'activity'->'chat_days' = '1' and o->'hunt' = '{"hunts":1,"damage":600,"attacks":3,"supports":0,"prize_packs":3}'
    and o->'effect_plays'->'sent' = '1' and o->'trading'->'swaps' = '1' and o->'reports'->'by_count' = '0', 'got', o - 'profile');
  res := res || jsonb_build_object('case', 'A5 an unknown member gives found false', 'ok', admin_member('tst_admin_none') = '{"found":false,"player":"tst_admin_none"}');

  -- ---------------------------------------------------------------- A6 the timeline
  full_list := admin_member_timeline('${A}', null, 200)->'rows';
  res := res || jsonb_build_object('case', 'A6 timeline of A: 24 rows from 14 kinds, newest first', 'ok',
    jsonb_array_length(full_list) = 24
    and (select jsonb_agg(distinct r->>'kind') from jsonb_array_elements(full_list) r) = '["card","chat","daily","dungeon","dungeon_over","effect_sent","gift","gift_claim","hunt","joined","pack","shard","shop","trade"]'
    and (select bool_and(((full_list->(i - 1))->>'at')::timestamptz >= ((full_list->i)->>'at')::timestamptz) from generate_series(1, jsonb_array_length(full_list) - 1) i)
    and full_list->2->>'kind' = 'dungeon' and full_list->23->>'kind' = 'joined'
    and (select (r->>'amount')::int = 5 from jsonb_array_elements(full_list) r where r->>'kind' = 'dungeon_over')
    and (select (r->>'amount')::int = 600 from jsonb_array_elements(full_list) r where r->>'kind' = 'hunt'), 'got', full_list);
  paged := '[]'; cur := null; n := 0;
  loop
    o := admin_member_timeline('${A}', (cur->>'before')::timestamptz, 4, cur->>'before_key');
    paged := paged || (o->'rows'); cur := o->'next'; n := n + 1;
    exit when cur is null or cur = 'null'::jsonb or n > 20;
  end loop;
  res := res || jsonb_build_object('case', 'A6 keyset pages of 4 join to the full list (6 full pages + 1 empty, no gap, no repeat)', 'ok', paged = full_list and n = 7, 'pages', n,
    'got', (select jsonb_agg(r->'key') from jsonb_array_elements(paged) r));
  o := admin_member_timeline('${B}', null, 200);
  res := res || jsonb_build_object('case', 'A6 timeline of B: gift made and claimed, welcome packs, gift sent, effect received, voice (12 rows)', 'ok',
    jsonb_array_length(o->'rows') = 12 and o->'next' = 'null'
    and (select jsonb_agg(distinct r->>'kind') from jsonb_array_elements(o->'rows') r) = '["card","effect_received","gift","gift_claim","hunt","joined","pack","trade","voice"]', 'got', o->'rows');

  -- ---------------------------------------------------------------- A7 cards and Hunts
  o := admin_cards('2026-03-02', '2026-03-08', 'damage', 2, 0);
  res := res || jsonb_build_object('case', 'A7 cards by damage: Z 600 (3 attacks, 0.6), X 400; trades and pulls', 'ok',
    (o->'rows'->0->>'id')::bigint = z and o->'rows'->0->'damage' = '600' and o->'rows'->0->'attacks' = '3' and (o->'rows'->0->>'damage_share')::numeric = 0.6
    and (o->'rows'->1->>'id')::bigint = x and o->'rows'->1->'trades' = '1' and o->'hunt_damage_total' = '1000' and o->'rows'->0->'pulls' = '1'
    and jsonb_array_length(o->'rows') = 2, 'got', o->'rows');
  o := admin_hunts(1, 0);
  res := res || jsonb_build_object('case', 'A7 admin_hunts: the newest is the test boss, 2 fighters, 1000 damage, 3 prize packs', 'ok',
    (o->'rows'->0->>'id')::bigint = h and o->'rows'->0->'fighters' = '2' and o->'rows'->0->'damage' = '1000' and o->'rows'->0->'prize_packs' = '3', 'got', o->'rows');
  o := admin_hunt(h);
  res := res || jsonb_build_object('case', 'A7 admin_hunt: rank buckets, top share, prizes, reconcile ok', 'ok',
    o->'rank_buckets' = '[{"ranks":"1","members":1,"damage":600,"share":0.6},{"ranks":"2-3","members":1,"damage":400,"share":0.4}]'
    and (o->>'top_share')::numeric = 0.6 and (o->>'top3_share')::numeric = 1 and o->'prizes' = '{"members":1,"packs":3}'
    and o->'reconcile'->'ok' = 'true' and o->'reconcile'->'logged' = '1000' and o->'hp_dealt' = '1000' and o->'attacks' = '4', 'got', o - 'hunt');
  update hunt_hits set damage = damage + 50 where hunt_id = h and player_id = '${B}';
  o := admin_hunt(h);
  res := res || jsonb_build_object('case', 'A7 a hunt_hits change with no log row: reconcile not ok, 50 unexplained', 'ok',
    o->'reconcile'->'ok' = 'false' and o->'reconcile'->'unexplained' = '50' and o->'reconcile'->'members_unexplained' = '1', 'got', o->'reconcile');
  update hunt_hits set damage = damage - 50 where hunt_id = h and player_id = '${B}';
  res := res || jsonb_build_object('case', 'A7 an unknown Hunt gives found false', 'ok', admin_hunt(-1)->'found' = 'false');

  -- ---------------------------------------------------------------- A8 health
  o := admin_health();
  res := res || jsonb_build_object('case', 'A8 health: the three reconciles ok, the test Hunt has 0 unexplained', 'ok',
    o->'reconcile'->'pack'->'ok' = 'true' and o->'reconcile'->'card'->'ok' = 'true' and o->'reconcile'->'shard'->'ok' = 'true'
    and (select (r->>'members_unexplained')::int = 0 and (r->>'members')::int = 2 from jsonb_array_elements(o->'hunts') r where (r->>'hunt')::bigint = h)
    and jsonb_typeof(o->'tables') = 'array' and jsonb_typeof(o->'migrations_last') = 'array', 'got', o->'reconcile');
  v_before := (o->'refs_missing'->>'pack_hunt')::int;
  update players set pack_balance = pack_balance + 1 where id = '${A}';
  insert into pack_ledger (player_id, amount, reason, ref_kind, ref_id, created_at) values ('${B}', 1, 'hunt_reward', 'hunt', '-424242', ${mt('2026-03-05 18:00')});
  update players set pack_balance = pack_balance + 1 where id = '${B}';
  o := admin_health();
  res := res || jsonb_build_object('case', 'A8 health sees a broken pack balance and a ref to no Hunt', 'ok',
    o->'reconcile'->'pack'->'ok' = 'false' and (o->'refs_missing'->>'pack_hunt')::int = v_before + 1, 'got', jsonb_build_object('pack', o->'reconcile'->'pack', 'refs', o->'refs_missing'));
  delete from pack_ledger where ref_id = '-424242';
  update players set pack_balance = pack_balance - 1 where id in ('${A}', '${B}');

  -- ---------------------------------------------------------------- A9 reports
  ok := true;
  for e in select * from jsonb_array_elements(admin_report_catalog()) loop
    begin
      o := admin_report(e->>'key', '{}');
      if jsonb_typeof(o->'rows') <> 'array' or o->'columns' <> e->'columns' then ok := false; end if;
      if jsonb_array_length(o->'rows') > 0 and (select array_agg(k2 order by k2) from jsonb_object_keys(o->'rows'->0) k2) <> (select array_agg(c order by c) from jsonb_array_elements_text(e->'columns') c) then ok := false; end if;
    exception when others then ok := false; res := res || jsonb_build_object('case', 'A9 report ' || (e->>'key') || ' ran', 'ok', false, 'error', sqlerrm);
    end;
  end loop;
  res := res || jsonb_build_object('case', 'A9 every catalog report runs and its rows have exactly the catalog columns', 'ok', ok);
  o := admin_report('hunt_board', jsonb_build_object('hunt', h));
  res := res || jsonb_build_object('case', 'A9 the Hunt board of the test boss', 'ok', o->'rows' = jsonb_build_array(
      jsonb_build_object('rank', 1, 'player_id', '${A}', 'username', 'tst admin one', 'damage', 600, 'share', 0.6, 'prize_packs', 3),
      jsonb_build_object('rank', 2, 'player_id', '${B}', 'username', 'tst admin two', 'damage', 400, 'share', 0.4, 'prize_packs', 0)), 'got', o->'rows');
  o := admin_report('pull_luck', '{"min_pulls": 10, "limit": 1000}');
  select r into e from jsonb_array_elements(o->'rows') r where r->>'player_id' = '${A}';
  res := res || jsonb_build_object('case', 'A9 pull luck of A: 10 pulls, 2 rare+, expected 10 x (1 - normal rate)', 'ok',
    (e->>'pulls')::int = 10 and (e->>'rare_plus')::int = 2 and (e->>'expected_rare_plus')::numeric = round(10 * (1 - rate_n), 2)
    and (e->>'z')::numeric = round((2 - 10 * (1 - rate_n)) / sqrt(10 * (1 - rate_n) * rate_n), 2), 'got', e);
  begin perform admin_report('no_such_report', '{}'); ok := false; exception when others then ok := sqlerrm like '%unknown report%'; end;
  res := res || jsonb_build_object('case', 'A9 an unknown report is refused', 'ok', ok);

  -- ---------------------------------------------------------------- A10 growth
  o := admin_growth('2026-03-02', '2026-04-05');
  res := res || jsonb_build_object('case', 'A10 retention D1 2 of 3, D7 0 of 3, D30 0 of 2', 'ok',
    o->'retention' = '{"d1":{"eligible":3,"kept":2,"share":0.6667},"d7":{"eligible":3,"kept":0,"share":0},"d30":{"eligible":2,"kept":0,"share":0}}', 'got', o->'retention');
  res := res || jsonb_build_object('case', 'A10 funnel: 3 joined, 1 welcome, 1 first pack (2.08 h), 2 fights, 2 trades, week 2 active 1 of 3', 'ok',
    o->'funnel' = '{"joined":3,"claimed_welcome":1,"opened_first_pack":1,"first_fight":2,"first_trade":2,"week2_eligible":3,"active_week2":1,"median_hours_to_first_open":2.08}', 'got', o->'funnel');
  res := res || jsonb_build_object('case', 'A10 cohorts by join week', 'ok', o->'cohorts' = '[
     {"week":"2026-03-02","size":2,"weeks":[{"week":0,"active":2,"share":1},{"week":1,"active":1,"share":0.5},{"week":2,"active":0,"share":0},{"week":3,"active":0,"share":0},{"week":4,"active":0,"share":0}]},
     {"week":"2026-03-09","size":1,"weeks":[{"week":0,"active":0,"share":0},{"week":1,"active":0,"share":0},{"week":2,"active":0,"share":0},{"week":3,"active":0,"share":0}]}]', 'got', o->'cohorts');
  res := res || jsonb_build_object('case', 'A10 churn and feature reach', 'ok',
    (o->'churn') - 'previous_period' = '{"active_previous":0,"active_now":2,"kept":0,"churned":0,"churn_rate":null,"new_active":2,"returned":0}'
    and o->'feature_reach' = '{"active":2,"features":[{"feature":"dailies","members":1,"share":0.5},{"feature":"dungeon","members":1,"share":0.5},{"feature":"effects","members":1,"share":0.5},{"feature":"gifts","members":2,"share":1},{"feature":"hunt","members":2,"share":1},{"feature":"packs","members":1,"share":0.5},{"feature":"shop","members":1,"share":0.5},{"feature":"trades","members":2,"share":1}]}'
    and o->'new_by_week' = '[{"week":"2026-03-02","new":2},{"week":"2026-03-09","new":1}]', 'got', jsonb_build_object('c', o->'churn', 'f', o->'feature_reach', 'w', o->'new_by_week'));
  begin perform admin_growth('2026-03-09', '2026-03-02'); ok := false; exception when others then ok := sqlerrm like '%after p_to%'; end;
  res := res || jsonb_build_object('case', 'A10 p_from after p_to is refused', 'ok', ok);

  -- ---------------------------------------------------------------- A12 the timeline: the new logs (member D)
  full_list := admin_member_timeline('${D}', null, 200)->'rows';
  want := jsonb_build_array(
    jsonb_build_array('shard', 'dungeon', 50), jsonb_build_array('pack', 'dungeon_prize', 1), jsonb_build_array('card', 'dungeon_prize: normal (1 cards)', 1),
    jsonb_build_array('guild', 'Left the Discord server', null), jsonb_build_array('visit', 'Visit to the Activity', 0),
    jsonb_build_array('shard', 'dungeon', 12), jsonb_build_array('dungeon_over', 'Gauntlet run ended (fell, floor 1, room 1)', 12),
    jsonb_build_array('card', 'dungeon_loot: normal (1 cards)', 1),
    jsonb_build_array('dungeon_combat', 'Gauntlet run fight: 2 attacks, 80 damage dealt, 80 taken, 1 supports, 1 foes down, 1 cards down', 80),
    jsonb_build_array('dungeon', 'Gauntlet run started', null), jsonb_build_array('report_about', 'Named in a report by a member: bug', null),
    jsonb_build_array('admin', 'Admin grant_packs by studio:test (studio): test', null), jsonb_build_array('note_read', 'Bell notes read: 2', 2),
    jsonb_build_array('note', 'Bell note: tst', null), jsonb_build_array('note', 'Bell note: tst', null),
    jsonb_build_array('stat_points', 'Stat points spend on ' || (select name from cards where id = z) || ': attack +1, vitality +2', 3),
    jsonb_build_array('wishlist', 'Wishlist slot 1: ' || (select name from cards where id = y) || ' replaced by ' || (select name from cards where id = z), null),
    jsonb_build_array('wishlist', 'Wishlist slot 1: added ' || (select name from cards where id = y), null),
    jsonb_build_array('profile', 'Title: Rookie (by studio:test)', null), jsonb_build_array('profile', 'Name changed: tst old to tst read four', null),
    jsonb_build_array('tutorial', 'Explainer seen: shop', null), jsonb_build_array('tutorial', 'Walkthrough: open', null),
    jsonb_build_array('visit', 'Visit to the Activity (desktop), screens: auction, shop x2, hall', 20),
    jsonb_build_array('joined', 'Joined (first seen by the bot, the Activity or a gift)', null), jsonb_build_array('visit', 'Screens viewed: leaderboard', null),
    jsonb_build_array('guild', 'Joined the Discord server', null));
  res := res || jsonb_build_object('case', 'A12 timeline of D: 26 rows of the new logs, newest first, each with its exact text and amount', 'ok',
    (select jsonb_agg(jsonb_build_array(r->'kind', r->'text', r->'amount')) from jsonb_array_elements(full_list) r) = want,
    'got', (select jsonb_agg(jsonb_build_array(r->'kind', r->'text', r->'amount')) from jsonb_array_elements(full_list) r));
  o := admin_member_timeline('${D}', null, 3);
  res := res || jsonb_build_object('case', 'A12 the totals per kind (all kinds, every page) and the matching count', 'ok',
    o->'totals' = '{"admin":1,"card":2,"dungeon":1,"dungeon_combat":1,"dungeon_over":1,"guild":2,"joined":1,"note":2,"note_read":1,"pack":1,"profile":2,"report_about":1,"shard":2,"stat_points":1,"tutorial":2,"visit":3,"wishlist":2}'
    and o->'total' = '26' and o->'matching' = '26' and jsonb_array_length(o->'rows') = 3 and o->'kinds' = 'null', 'got', o - 'rows');
  full_list := admin_member_timeline('${D}', null, 200, null, array['visit', 'wishlist'])->'rows';
  paged := '[]'; cur := null; n := 0;
  loop
    o := admin_member_timeline('${D}', (cur->>'before')::timestamptz, 2, cur->>'before_key', array['wishlist', 'visit']);
    paged := paged || (o->'rows'); cur := o->'next'; n := n + 1;
    exit when cur is null or cur = 'null'::jsonb or n > 20;
  end loop;
  res := res || jsonb_build_object('case', 'A12 the kind filter: 5 visit and wishlist rows; pages of 2 join to them (3 pages); the totals stay', 'ok',
    (select jsonb_agg(r->>'kind') from jsonb_array_elements(full_list) r) = '["visit","wishlist","wishlist","visit","visit"]'
    and paged = full_list and n = 3 and o->'matching' = '5' and o->'total' = '26' and o->'kinds' = '["wishlist","visit"]', 'pages', n, 'got', full_list);
  begin perform admin_member_timeline('${D}', null, 5, null, array['visit', 'bogus']); ok := false; exception when others then ok := sqlerrm like '%unknown kind bogus%'; end;
  res := res || jsonb_build_object('case', 'A12 an unknown kind is refused', 'ok', ok);

  -- ---------------------------------------------------------------- A13 one member: avatar, rank, server, app counts, reports against
  o := admin_member('${D}');
  pw_d := my_collection_power('${D}');
  res := res || jsonb_build_object('case', 'A13 member D: the avatar URL, left the server, the app counts, 1 report against', 'ok',
    o->'profile'->>'avatar_url' = 'https://cdn.discordapp.com/avatars/${D}/${HASH}.png?size=128' and o->'profile'->'in_guild' = 'false'
    and (o->'profile'->>'guild_joined_at')::timestamptz = ${mt('2026-05-04 08:00')} and (o->'profile'->>'left_guild_at')::timestamptz = ${mt('2026-05-06 12:00')}
    and (o->'app') - 'last_visit' = '{"visits":2,"views":5,"views_by_screen":{"auction":1,"hall":1,"leaderboard":1,"shop":2},"tutorial_steps":2,"notes":2,"notes_unread":0,"profile_changes":2,"wishlist_changes":2,"admin_actions":1}'
    and (o->'app'->>'last_visit')::timestamptz = ${mt('2026-05-05 20:00')}
    and o->'reports'->'against_count' = '1' and o->'reports'->'against'->0->>'by' = '${E}' and o->'reports'->'by_count' = '0', 'got', jsonb_build_object('p', o->'profile', 'a', o->'app', 'r', o->'reports'));
  res := res || jsonb_build_object('case', 'A13 the power rank of D = 1 + the members with more power; of = the members with power', 'ok',
    pw_d > 0 and (o->'collection'->>'power_rank')::int = 1 + (select count(*) from players p where my_collection_power(p.id) > pw_d)
    and (o->'collection'->>'power_rank_of')::int = (select count(*) from players p where my_collection_power(p.id) > 0),
    'got', jsonb_build_object('power', pw_d, 'rank', o->'collection'->'power_rank', 'of', o->'collection'->'power_rank_of'));
  res := res || jsonb_build_object('case', 'A13 no avatar URL for a value that is not a Discord hash; no rank with no cards; server unknown', 'ok',
    admin_member('${E}')->'profile'->'avatar_url' = 'null' and admin_member('${E}')->'profile'->'in_guild' = 'null'
    and admin_member('${C}')->'collection'->'power_rank' = 'null', 'got', admin_member('${E}')->'profile');

  -- ---------------------------------------------------------------- A14 cards: the name search and one card
  k := (select name from cards where id = z);
  o := admin_cards(null, null, 'id', 200, 0, upper(k));
  res := res || jsonb_build_object('case', 'A14 the name search: case does not matter, every match and only matches', 'ok',
    (o->>'total')::int = (select count(*) from cards c where strpos(lower(c.name), lower(k)) > 0)
    and exists (select 1 from jsonb_array_elements(o->'rows') r where (r->>'id')::bigint = z)
    and not exists (select 1 from jsonb_array_elements(o->'rows') r where strpos(lower(r->>'name'), lower(k)) = 0), 'got', o->'total');
  t_all := (admin_cards(null, null, 'id', 1, 0)->>'total')::int;
  t_pct := (admin_cards(null, null, 'id', 1, 0, '_')->>'total')::int;
  res := res || jsonb_build_object('case', 'A14 the LIKE characters are text: _ finds only names with _; the id finds the card', 'ok',
    t_pct = (select count(*) from cards where strpos(name, '_') > 0) and t_all = (select count(*) from cards)
    and (admin_cards(null, null, 'id', 200, 0, '%')->>'total')::int = (select count(*) from cards where strpos(name, '%') > 0)
    and exists (select 1 from jsonb_array_elements(admin_cards(null, null, 'id', 200, 0, x::text)->'rows') r where (r->>'id')::bigint = x),
    'got', jsonb_build_object('all', t_all, 'underscore', t_pct));
  o := admin_card(x);
  res := res || jsonb_build_object('case', 'A14 card X: +2 owners, +3 copies (star 0), in: 2 dungeon_prize, 1 loot, 1 trade; out 1 trade; 1 swap; Hunt +1 attack, +400', 'ok',
    o->'found' = 'true' and (o->'card'->>'id')::bigint = x
    and ${dl('o', 'bx', 'owners')} = 2 and ${dl('o', 'bx', 'copies')} = 3 and ${dl('o', 'bx', 'stars')} = 0
    and ${darr('o', 'bx', 'by_star', 'stars', '0', 'owners')} = 2 and ${darr('o', 'bx', 'by_star', 'stars', '0', 'copies')} = 3
    and ${darr('o', 'bx', 'in_by_reason', 'reason', 'dungeon_prize', 'copies')} = 2 and ${darr('o', 'bx', 'in_by_reason', 'reason', 'dungeon_loot', 'copies')} = 1
    and ${darr('o', 'bx', 'in_by_reason', 'reason', 'trade', 'copies')} = 1 and ${darr('o', 'bx', 'out_by_reason', 'reason', 'trade', 'copies')} = 1
    and ${dl('o', 'bx', 'trading,swaps')} = 1 and ${dl('o', 'bx', 'trading,offers_by_status,accepted')} = 1 and ${dl('o', 'bx', 'pulls,total')} = 0
    and ${dl('o', 'bx', 'hunt,attacks')} = 1 and ${dl('o', 'bx', 'hunt,damage')} = 400 and ${dl('o', 'bx', 'hunt,hunts')} = 1, 'got', o - 'card' - 'top_owners');
  o := admin_card(y);
  res := res || jsonb_build_object('case', 'A14 card Y: the swap (the asked side), a wishlist add, the Gauntlet support (heal 10), 60 taken, 1 down', 'ok',
    ${dl('o', 'by_', 'trading,swaps')} = 1 and ${dl('o', 'by_', 'trading,wishlist_adds')} = 1
    and o->'dungeon'->1->>'mode' = 'gauntlet' and ${dl('o', 'by_', 'dungeon,1,runs')} = 1 and ${dl('o', 'by_', 'dungeon,1,supports')} = 1
    and ${dl('o', 'by_', 'dungeon,1,healed')} = 10 and ${dl('o', 'by_', 'dungeon,1,taken')} = 60 and ${dl('o', 'by_', 'dungeon,1,downs')} = 1
    and ${dl('o', 'by_', 'dungeon,1,attacks')} = 0 and ${dl('o', 'by_', 'dungeon,1,damage')} = 0, 'got', o->'dungeon');
  o := admin_card(z);
  res := res || jsonb_build_object('case', 'A14 card Z: 1 pull, 1 play, 3 Hunt attacks (600), a daily run, the Gauntlet fight (2 attacks, 80 dealt, 20 taken)', 'ok',
    ${dl('o', 'bz', 'pulls,total')} = 1 and ${dl('o', 'bz', 'plays,total')} = 1 and ${dl('o', 'bz', 'hunt,attacks')} = 3 and ${dl('o', 'bz', 'hunt,damage')} = 600
    and ${dl('o', 'bz', 'dungeon,0,runs')} = 1 and ${dl('o', 'bz', 'dungeon,1,runs')} = 1 and ${dl('o', 'bz', 'dungeon,1,attacks')} = 2
    and ${dl('o', 'bz', 'dungeon,1,damage')} = 80 and ${dl('o', 'bz', 'dungeon,1,taken')} = 20 and ${dl('o', 'bz', 'dungeon,1,downs')} = 0
    and ${dl('o', 'bz', 'trading,wishlist_adds')} = 1, 'got', jsonb_build_object('d', o->'dungeon', 'p', o->'pulls', 'h', o->'hunt'));
  res := res || jsonb_build_object('case', 'A14 an unknown card gives found false', 'ok', admin_card(-1) = '{"found":false,"card":-1}');

  -- ---------------------------------------------------------------- A15 the Dungeon and the Gauntlet
  o := admin_dungeon('2026-05-01', '2026-05-10');
  res := res || jsonb_build_object('case', 'A15 May: 1 Gauntlet run (fell, floor 1 room 1, 12 Shards, 1 card), reached, deaths', 'ok',
    o->'by_mode' = '[{"mode":"gauntlet","runs":1,"members":1,"cleared":0,"fell":1,"retreat":0,"abandoned":0,"active":0,"shards":12,"cards":1,"best_floor":1,"avg_floor":1,"avg_rooms":1,"avg_turns":2}]'
    and o->'by_day' = '[{"day":"2026-05-05","mode":"gauntlet","runs":1,"members":1,"cleared":0,"fell":1,"shards":12}]'
    and o->'reached' = '[{"mode":"gauntlet","floor":1,"room":1,"runs":1,"fell":1}]'
    and o->'deaths' = '{"runs_fell":1,"cards_down_at_end":{"gauntlet":1},"card_downs_logged":1}', 'got', jsonb_build_object('m', o->'by_mode', 'r', o->'reached', 'd', o->'deaths'));
  res := res || jsonb_build_object('case', 'A15 May: 1 kill (slime, fight); paid 62 Shards (50 board + 12 run), 2 cards, 1 pack, the board', 'ok',
    o->'kills' = jsonb_build_array(jsonb_build_object('key', 'slime', 'name', (select name from dungeon_monsters where key = 'slime'), 'kills', 1, 'daily', 0, 'gauntlet', 1, 'by_kind', '{"fight":1}'::jsonb))
    and o->'kills_total' = '1' and o->'paid'->'shards' = '62' and o->'paid'->'cards' = '2' and o->'paid'->'packs' = '1'
    and o->'paid'->'shards_by_source' = '[{"mode":"gauntlet","source":"dungeon_payout","shards":50,"rows":1},{"mode":"gauntlet","source":"run","shards":12,"rows":1}]'
    and o->'paid'->'cards_by_rarity' = '[{"reason":"dungeon_loot","rarity":"normal","copies":1},{"reason":"dungeon_prize","rarity":"normal","copies":1}]'
    and (select jsonb_agg(b - 'paid_at') from jsonb_array_elements(o->'paid'->'boards') b) = '[{"mode":"gauntlet","period":"2026-05-03","winners":1,"shards":50,"packs":1,"cards":1}]',
    'got', jsonb_build_object('k', o->'kills', 'p', o->'paid'));
  res := res || jsonb_build_object('case', 'A15 the Gauntlet week (squad, runs, best run, paid) and the damage of each card', 'ok',
    jsonb_array_length(o->'gauntlet_weeks') = 1 and o->'gauntlet_weeks'->0->>'week' = '2026-05-03' and o->'gauntlet_weeks'->0->>'name' = 'tst week'
    and (select jsonb_agg((s->>'id')::bigint) from jsonb_array_elements(o->'gauntlet_weeks'->0->'squad') s) = jsonb_build_array(z, y)
    and o->'gauntlet_weeks'->0->'runs' = '1' and o->'gauntlet_weeks'->0->'members' = '1' and o->'gauntlet_weeks'->0->'cleared' = '0'
    and o->'gauntlet_weeks'->0->'best' = '{"floor":1,"room":1,"turns":2}' and o->'gauntlet_weeks'->0->'paid' = 'true'
    and (select jsonb_agg(c - 'name' - 'rarity') from jsonb_array_elements(o->'card_damage') c) = jsonb_build_array(
      jsonb_build_object('card_id', z, 'attacks', 2, 'damage', 80, 'damage_dungeon', 0, 'damage_gauntlet', 80, 'foes_down', 1, 'crits', 1, 'supports', 0, 'healed', 0, 'taken', 20, 'downs', 0),
      jsonb_build_object('card_id', y, 'attacks', 0, 'damage', 0, 'damage_dungeon', 0, 'damage_gauntlet', 0, 'foes_down', 0, 'crits', 0, 'supports', 1, 'healed', 10, 'taken', 60, 'downs', 1))
    and o->'combat_rows' = '5', 'got', jsonb_build_object('w', o->'gauntlet_weeks', 'c', o->'card_damage'));
  res := res || jsonb_build_object('case', 'A15 the reconcile: the run after the log start is checked and ok', 'ok',
    (o->'reconcile') - 'log_from' = '{"runs_checked":1,"runs_ok":1,"runs_before_log":0,"rows_unexplained":0,"hp_unexplained":0,"ok":true,"bad_runs":[]}', 'got', o->'reconcile');
  update dungeon_runs set state = jsonb_set(state, array['cards', z::text, 'hp'], '45') where id = run_d;
  o := admin_dungeon('2026-05-01', '2026-05-10');
  res := res || jsonb_build_object('case', 'A15 a card HP with no log row: the reconcile is not ok, 5 HP unexplained, the run is named', 'ok',
    o->'reconcile'->'ok' = 'false' and o->'reconcile'->'hp_unexplained' = '5' and o->'reconcile'->'rows_unexplained' = '1'
    and o->'reconcile'->'bad_runs' = jsonb_build_array(jsonb_build_object('run', run_d, 'mode', 'gauntlet', 'rows', 1, 'hp', 5)), 'got', o->'reconcile');
  update dungeon_runs set state = jsonb_set(state, array['cards', z::text, 'hp'], '50') where id = run_d;
  o := admin_dungeon('2026-03-02', '2026-03-15');
  res := res || jsonb_build_object('case', 'A15 March: the daily run of A (8 rooms), the golem kill of slot 1, not reconciled (before the log), the prize card', 'ok',
    o->'by_mode'->0->>'mode' = 'daily' and o->'by_mode'->0->'runs' = '1' and o->'by_mode'->0->'shards' = '5' and o->'by_mode'->0->'avg_rooms' = '8'
    and (select jsonb_agg(k2 - 'name') from jsonb_array_elements(o->'kills') k2) = '[{"key":"golem","kills":1,"daily":1,"gauntlet":0,"by_kind":{"guardian":1}}]'
    and o->'reconcile'->'runs_checked' = '0' and o->'reconcile'->'runs_before_log' = '1'
    and o->'paid'->'shards_by_source' = '[{"mode":"daily","source":"run","shards":5,"rows":1}]'
    and o->'paid'->'cards_by_rarity' = '[{"reason":"dungeon_prize","rarity":"normal","copies":1}]' and o->'gauntlet_weeks' = '[]', 'got', o - 'by_day' - 'card_damage');

  -- ---------------------------------------------------------------- A16 the game feed (no real row is older than May 2026)
  full_list := admin_feed(null, ${mt('2026-05-11 00:00')}, 200)->'rows';
  want := jsonb_build_array(
    jsonb_build_array('dungeon', 'Gauntlet board paid (2026-05-03), winners: 1', null, null),
    jsonb_build_array('member', 'Left the Discord server', '${D}', null),
    jsonb_build_array('report', 'Report: bug', '${E}', '${D}'),
    jsonb_build_array('admin', 'Admin grant_packs on player ${D}: test', '${D}', null),
    jsonb_build_array('admin', 'Admin hide on card ${D}', null, null),
    jsonb_build_array('member', 'New member', '${D}', null),
    jsonb_build_array('pull', 'Pulled Full Art: ' || (select name from cards where id = fa), '${E}', null),
    jsonb_build_array('member', 'New member', '${E}', null),
    jsonb_build_array('effect', 'Played ' || prim || ' (prank): applied', '${A}', '${B}'),
    jsonb_build_array('member', 'New member', '${C}', null),
    jsonb_build_array('hunt', 'Hunt settled: Test Admin Boss (expired)', null, null),
    jsonb_build_array('trade', 'Trade (offer): 1 for 1 cards', '${B}', '${A}'),
    jsonb_build_array('member', 'New member', '${B}', null),
    jsonb_build_array('hunt', 'Boss spawned: Test Admin Boss (Normal)', null, null),
    jsonb_build_array('member', 'New member', '${A}', null));
  res := res || jsonb_build_object('case', 'A16 the feed before 11 May: 15 events of 9 kinds, newest first, with the member and the other side', 'ok',
    (select jsonb_agg(jsonb_build_array(r->'kind', r->'text', r->'player_id', r->'other_id')) from jsonb_array_elements(full_list) r) = want,
    'got', (select jsonb_agg(jsonb_build_array(r->'kind', r->'text', r->'player_id', r->'other_id')) from jsonb_array_elements(full_list) r));
  res := res || jsonb_build_object('case', 'A16 feed rows: names, the admin actor, the boss HP, the play amount', 'ok',
    full_list->2->>'username' = 'tst read five' and full_list->2->>'other_name' = 'tst read four' and full_list->3->>'actor' = 'studio:test (studio)'
    and full_list->13->'amount' = '10000' and full_list->8->'amount' = '1', 'got', jsonb_build_array(full_list->2, full_list->3));
  paged := '[]'; cur := jsonb_build_object('before', ${mt('2026-05-11 00:00')}, 'before_key', null); n := 0;
  loop
    o := admin_feed(null, (cur->>'before')::timestamptz, 4, cur->>'before_key');
    paged := paged || (o->'rows'); cur := o->'next'; n := n + 1;
    exit when cur is null or cur = 'null'::jsonb or n > 20;
  end loop;
  res := res || jsonb_build_object('case', 'A16 feed keyset pages of 4 join to the full list (4 pages, no gap, no repeat)', 'ok', paged = full_list and n = 4, 'pages', n);
  o := admin_feed(array['member'], ${mt('2026-05-11 00:00')}, 200);
  res := res || jsonb_build_object('case', 'A16 the kind filter: 6 member rows only', 'ok',
    (select jsonb_agg(r->>'player_id') from jsonb_array_elements(o->'rows') r) = '["${D}","${D}","${E}","${C}","${B}","${A}"]'
    and o->'kinds' = '["member"]', 'got', o->'rows');
  begin perform admin_feed(array['bogus'], null, 5); ok := false; exception when others then ok := sqlerrm like '%unknown kind bogus%'; end;
  res := res || jsonb_build_object('case', 'A16 an unknown feed kind is refused', 'ok', ok);

  -- ---------------------------------------------------------------- A11 security
  -- The read functions of admin_read.sql (its grant list; other files add admin_ functions of their own, for example the writers).
  fns := array[${READ_FNS}];
  res := res || jsonb_build_object('case', 'A11 the ' || cardinality(fns) || ' admin read functions exist; the old timeline and cards signatures are gone', 'ok',
    cardinality(fns) = 19 and (select bool_and(to_regprocedure(f) is not null) from unnest(fns) f)
    and to_regprocedure('public.admin_member_timeline(text,timestamp with time zone,integer,text)') is null
    and to_regprocedure('public.admin_cards(date,date,text,integer,integer)') is null,
    'got', (select jsonb_agg(f) from unnest(fns) f where to_regprocedure(f) is null));
  if exists (select 1 from unnest(fns) f where to_regprocedure(f) is null) then raise exception 'RESULTS %', res; end if;
  res := res || jsonb_build_object('case', 'A11 anon, authenticated and public cannot execute; service_role can', 'ok',
    coalesce((select bool_and(not has_function_privilege('anon', f, 'execute') and not has_function_privilege('authenticated', f, 'execute')
      and has_function_privilege('service_role', f, 'execute')
      and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = f::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE'))
      from unnest(fns) f), false),
    'got', (select jsonb_agg(f) from unnest(fns) f where has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute')));
  res := res || jsonb_build_object('case', 'A11 search_path = public, not volatile, a comment, only admin_health is security definer', 'ok',
    coalesce((select bool_and(p.proconfig @> array['search_path=public'] and p.provolatile <> 'v' and obj_description(p.oid, 'pg_proc') is not null
      and p.prosecdef = (p.proname = 'admin_health')) from pg_proc p where p.oid = any (fns::regprocedure[])), false));

  raise exception 'RESULTS %', res;
exception when others then
  if sqlerrm like 'RESULTS%' then raise; end if;
  raise exception 'RESULTS %', res || jsonb_build_object('case', 'the block ran without an error', 'ok', false, 'error', sqlerrm);
end $t$;`;

const runOnce = async (mig) => {
  const out = await q(body(mig));
  let msg = out; try { msg = JSON.parse(out).message || out; } catch { /* the raw text */ }
  const m = msg.match(/RESULTS (\[.*\])/s);
  if (!m) return { results: null, raw: out.slice(0, 1500) };
  return { results: JSON.parse(m[1]) };
};

if (process.argv.includes('--mutations')) {
  let missed = 0;
  for (const [name, [a, b]] of Object.entries(MUTATIONS)) {
    if (src.split(a).length !== 2) { console.log(`FAIL mutation "${name}": the text to change is not in the file once`); missed++; continue; }
    const { results, raw } = await runOnce(src.replace(a, b));
    const failed = results ? results.filter((r) => !r.ok).map((r) => r.case) : ['no results: ' + raw];
    if (failed.length) console.log(`caught  "${name}": ${failed.length} case(s) fail, first: ${failed[0]}`);
    else { console.log(`FAIL mutation "${name}" was NOT caught`); missed++; }
  }
  console.log(missed ? `${missed} of ${Object.keys(MUTATIONS).length} mutations NOT caught` : `PASS all ${Object.keys(MUTATIONS).length} mutations caught`);
  process.exitCode = missed ? 1 : 0;
} else {
  const { results, raw } = await runOnce(OLD ? '' : src);
  if (!results) { console.log('FAIL NO RESULTS:', raw); process.exit(1); }
  let fail = 0;
  for (const r of results) { if (!r.ok) fail++; console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.case}${r.ok ? '' : '  ' + JSON.stringify(r).slice(0, 900)}`); }
  console.log(`${OLD ? '[--old baseline] ' : ''}${fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`}`);
  process.exitCode = fail ? 1 : 0;
}
