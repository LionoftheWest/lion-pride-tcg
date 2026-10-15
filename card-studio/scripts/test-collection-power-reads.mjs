/**
 * Acceptance test for tcg-bot/supabase/perf_collection_power.sql, with NO lasting change:  node scripts/test-collection-power-reads.mjs
 * Invariant: my_collection_power, collection_power_all and top_collection_power answer EXACTLY as the text before the file did
 * (reference copies ref_* of the live text of 2026-10-11, db/schema), for EVERY player of the database, and after a card change.
 * (2026-10-15, f3_one_power_number.sql: the power of a copy counts its stat points, so the reference sums the cp of card_combat, not card_power.)
 *   1. my_collection_power(player) = the old text, every player.
 *   2. collection_power_all() = the old text (the same rows) and = my_collection_power for each player.
 *   3. top_collection_power(100) = the old text (same players and powers, ordered by power).
 *   4. a change of the CP numbers (rarity_cp x2) and of the set bonus changes the totals as the old text does (no stale value).
 *   5. a player who completes a set gets the set bonus (the rule is unchanged): same as the old text.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();

const body = String.raw`do $t$
declare
  res jsonb := '[]'; pid text; bad int; n int; a bigint; b bigint; sid bigint; ok_ boolean; fx jsonb;
begin
  create function ref_my_cp(p_player_id text) returns bigint language sql stable as $f$
    with subj_totals as (select subject_id, count(*) tv from cards group by subject_id),
    ps as (
      select c.subject_id, sum((card_combat(c.rarity::text, pc.ascension, s.cp_mod, pc.stat_points)->>'cp')::int) base_cp, count(*) ov
      from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
      where pc.player_id = p_player_id and pc.quantity >= 1 group by c.subject_id)
    select coalesce(sum(case when ps.ov = st.tv then round(ps.base_cp * (balance_get('set_bonus') #>> '{}')::numeric) else ps.base_cp end), 0)::bigint
    from ps join subj_totals st on st.subject_id = ps.subject_id; $f$;
  create function ref_cp_all() returns table(player_id text, power bigint) language sql stable as $f$
    with subj_totals as (select subject_id, count(*) tv from cards group by subject_id),
    ps as (
      select pc.player_id, c.subject_id, sum((card_combat(c.rarity::text, pc.ascension, s.cp_mod, pc.stat_points)->>'cp')::int) base_cp, count(*) ov
        from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
       where pc.quantity >= 1 group by pc.player_id, c.subject_id)
    select ps.player_id, sum(case when ps.ov = st.tv then round(ps.base_cp * (balance_get('set_bonus') #>> '{}')::numeric) else ps.base_cp end)::bigint
      from ps join subj_totals st on st.subject_id = ps.subject_id group by ps.player_id; $f$;
  create function ref_top(p_limit integer default 20) returns table(player_id text, username text, power bigint) language sql stable as $f$
    select t.player_id, p.username, t.power from ref_cp_all() t join players p on p.id = t.player_id order by t.power desc, t.player_id
    limit greatest(1, least(100, coalesce(p_limit, 20))); $f$;

  -- 1 + 2
  bad := 0; n := 0;
  for pid in select id from players loop
    n := n + 1;
    if my_collection_power(pid) is distinct from ref_my_cp(pid) then bad := bad + 1; end if;
  end loop;
  res := res || jsonb_build_object('case', 'my_collection_power = the old text for ' || n || ' players', 'ok', bad = 0 and n > 0, 'bad', bad);
  select count(*) into bad from ((select * from collection_power_all() except select * from ref_cp_all()) union all (select * from ref_cp_all() except select * from collection_power_all())) d;
  select count(*) into n from collection_power_all();
  res := res || jsonb_build_object('case', 'collection_power_all = the old text (' || n || ' rows)', 'ok', bad = 0 and n > 0, 'bad', bad);
  select count(*) into bad from collection_power_all() x where x.power is distinct from my_collection_power(x.player_id);
  res := res || jsonb_build_object('case', 'collection_power_all = my_collection_power for each player', 'ok', bad = 0, 'bad', bad);

  -- 3
  select count(*) into bad from ((select player_id, username, power from top_collection_power(100) except select * from ref_top(100))
                                 union all (select * from ref_top(100) except select player_id, username, power from top_collection_power(100))) d;
  res := res || jsonb_build_object('case', 'top_collection_power(100) = the old text', 'ok', bad = 0, 'bad', bad);

  -- 4. new CP numbers: no stale value
  update balance set value = (select jsonb_object_agg(k, (v::numeric * 2)) from jsonb_each_text(value) e(k, v)) where key = 'rarity_cp';
  update balance set value = '1.5' where key = 'set_bonus';
  bad := 0; for pid in select id from players loop if my_collection_power(pid) is distinct from ref_my_cp(pid) then bad := bad + 1; end if; end loop;
  select count(*) into n from ((select * from collection_power_all() except select * from ref_cp_all()) union all (select * from ref_cp_all() except select * from collection_power_all())) d;
  res := res || jsonb_build_object('case', 'rarity_cp x2 and set_bonus 1.5: every total = the old text', 'ok', bad = 0 and n = 0, 'bad', bad, 'rows', n);

  -- 5. a set completed: same as the old text
  insert into players (id, username) values ('tst_cpr', 'tst cpr');
  select subject_id into sid from cards where subject_id is not null group by subject_id having count(*) >= 2 order by count(*) limit 1;
  insert into player_cards (player_id, card_id, quantity, ascension) select 'tst_cpr', id, 1, 2 from cards where subject_id = sid;
  a := my_collection_power('tst_cpr'); b := ref_my_cp('tst_cpr');
  res := res || jsonb_build_object('case', 'a completed set (' || (select count(*) from cards where subject_id = sid) || ' cards): the same total with the set bonus', 'ok', a = b and a > 0, 'new', a, 'old', b);

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
