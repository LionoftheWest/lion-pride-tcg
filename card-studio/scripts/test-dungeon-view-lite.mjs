/**
 * Acceptance test for tcg-bot/supabase/perf_dungeon_view.sql, with NO lasting change:  node scripts/test-dungeon-view-lite.mjs
 * Invariants:
 *   1. dungeon_view(player) answers EXACTLY as the text before the file did (a reference copy ref_dungeon_view, the live text of
 *      2026-10-11, db/schema) for every player of the database (members with and without a run today).
 *   2. dungeon_view_lite(player) = dungeon_view(player) without the key 'mine' (every other key equal).
 *   3. 'mine' of a member lists exactly the cards of the member (quantity > 0), sorted by cp, and a closed Dungeon answers
 *      {ok:false, error:disabled} for the three functions.
 * One DO block; the exception rolls everything back.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();

const body = String.raw`do $t$
declare
  res jsonb := '[]'; pid text; x jsonb; y jsonb; bad int := 0; n int := 0; withrun int := 0; badlite int := 0; badmine int := 0; en jsonb;
begin
  create function ref_dungeon_view(p_player text) returns jsonb language plpgsql as $f$
  declare cfg jsonb := dungeon_cfg(); v_day date := dungeon_day(); d jsonb; r dungeon_runs; v_rank int;
  begin
    if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
    perform dungeon_settle(id, 'abandoned', false) from dungeon_runs where player_id = p_player and status = 'active' and day < v_day;
    d := dungeon_generate(v_day);
    select * into r from dungeon_runs where player_id = p_player and day = v_day and mode = 'daily';
    select (e->>'rank')::int into v_rank from jsonb_array_elements(dungeon_board(v_day, 1000)) e where e->>'player_id' = p_player;
    return jsonb_build_object('ok', true, 'day', v_day, 'next_at', (v_day + 1)::timestamp at time zone 'America/Denver',
      'name', d->>'name', 'rule', d->'rule', 'budget', coalesce((d->'rule'->>'budget')::int, balance_num('dungeon', 'budget')::int),
      'squad', balance_num('dungeon', 'squad')::int, 'cost', cfg->'cost', 'gate', adventure_gate(p_player), 'cap', balance_num('dungeon_rewards', 'run_shards_cap')::int,
      'run', case when r.id is null then null else jsonb_build_object('id', r.id, 'status', r.status, 'ended_by', r.ended_by,
        'floor', r.floor, 'room', r.room, 'turns', r.turns, 'shards', r.shards, 'cards', to_jsonb(r.cards), 'squad', to_jsonb(r.squad),
        'state', r.state, 'rank', v_rank) end,
      'mine', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'type', s.type, 'rarity', c.rarity::text,
                 'cost', balance_num('dungeon', 'cost', c.rarity::text)::int, 'cp', (x.cmb->>'cp')::int,
                 'hp', case when s.type in ('Character', 'Creature') then (x.cmb->>'hp')::int else card_max_hp(0) end,
                 'slugs', coalesce(to_jsonb(s.tag_slugs), '[]'::jsonb)) order by (x.cmb->>'cp')::int desc), '[]'::jsonb)
               from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
               cross join lateral (select card_combat(c.rarity::text, pc.ascension, s.cp_mod, pc.stat_points) cmb) x
               where pc.player_id = p_player and pc.quantity > 0),
      'rooms', (select jsonb_agg(jsonb_build_object(
                 'type', case when rm.i < coalesce(r.room, 1) or (rm.i = coalesce(r.room, 1) and r.id is not null) or rm.v->>'type' = 'guardian' then rm.v->>'type' else 'unknown' end,
                 'name', case when rm.v->>'type' = 'guardian' then rm.v->'foes'->0->>'name' end) order by rm.i)
               from jsonb_array_elements(d->'floors'->(coalesce(r.floor, 1) - 1)) with ordinality rm(v, i)),
      'floors', jsonb_array_length(d->'floors'),
      'runs_today', (select count(*) from dungeon_runs where day = v_day and mode = 'daily'),
      'top', dungeon_board(v_day, 3),
      'season_best', (select jsonb_build_object('floor', floor, 'room', room, 'day', day) from dungeon_runs where player_id = p_player and mode = 'daily'
                      order by floor desc, room desc, turns limit 1));
  end $f$;

  select value into en from settings where key = 'dungeon';
  update settings set value = value || '{"enabled": true}' where key = 'dungeon';
  for pid in select id from players loop
    n := n + 1; x := dungeon_view(pid); y := ref_dungeon_view(pid);
    if x is distinct from y then bad := bad + 1; end if;
    if y->'run' is not null and y->'run' <> 'null'::jsonb then withrun := withrun + 1; end if;
    if dungeon_view_lite(pid) is distinct from (x - 'mine') or (dungeon_view_lite(pid) ? 'mine') then badlite := badlite + 1; end if;
    if jsonb_array_length(x->'mine') <> (select count(*) from player_cards where player_id = pid and quantity > 0) then badmine := badmine + 1; end if;
  end loop;
  res := res || jsonb_build_object('case', 'dungeon_view = the old text for ' || n || ' players (' || withrun || ' with a run today)', 'ok', bad = 0 and n > 0, 'bad', bad);
  res := res || jsonb_build_object('case', 'dungeon_view_lite = dungeon_view without mine, for every player', 'ok', badlite = 0, 'bad', badlite);
  res := res || jsonb_build_object('case', 'mine has one entry per owned card', 'ok', badmine = 0, 'bad', badmine);

  update settings set value = value || '{"enabled": false}' where key = 'dungeon';
  res := res || jsonb_build_object('case', 'closed Dungeon: the three functions answer disabled', 'ok',
    dungeon_view('x') = '{"ok": false, "error": "disabled"}' and dungeon_view_lite('x') = '{"ok": false, "error": "disabled"}' and dungeon_view_core('x', true) = '{"ok": false, "error": "disabled"}');

  raise exception 'RESULTS %', res;
end $t$;`;

const out = JSON.stringify(await q(`set statement_timeout = '5min';` + String.fromCharCode(10) + body));
const m = out.match(/RESULTS (\[.*\])/);
if (!m) { console.log('NO RESULTS:', out.slice(0, 2500)); process.exit(1); }
const results = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\\n.*$/, ''));
let fail = 0;
for (const r of results) {
  const { case: name, ok, ...rest } = r;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + JSON.stringify(rest).slice(0, 700)}`);
}
console.log(fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`);
process.exitCode = fail ? 1 : 0;
