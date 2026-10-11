/**
 * Acceptance test for tcg-bot/supabase/perf_card_power_reads.sql, with NO lasting change:  node scripts/test-card-power-reads.mjs
 * Invariant: card_combat, card_cp_exact, card_max_hp, stat_pt and card_powers answer EXACTLY as the text before the file did.
 * The test builds reference copies of the old texts (ref_*, the bodies of 2026-10-11 from db/schema) inside one DO block,
 * compares them with the live functions and RAISEs the results (the exception rolls everything back).
 *   1. stat_pt: 40 point values x 2 limits.
 *   2. card_cp_exact + card_max_hp: every rarity (and one unknown) x stars -1..7 x 6 mods (and null).
 *   3. card_combat: flag ON and OFF x every rarity x stars 0..5 x 6 mods x 8 point sets.
 *   4. card_powers(null) and card_powers(player) for EVERY player of the database, flag ON and OFF.
 *   5. a bundle with a missing key raises.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)?.[1] || 'local';
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();

const body = String.raw`do $t$
declare
  res jsonb := '[]'; bad int; n int; r text; a int; m numeric; flag boolean; pts jsonb; pid text; x jsonb; y jsonb; tot int := 0; reads0 bigint; reads1 bigint;
  pset jsonb[] := array['{}'::jsonb, '{"attack":15}', '{"attack":3,"vitality":4,"precision":5,"potency":1,"haste":2}', '{"attack":99,"haste":99}',
    '{"attack":-4,"potency":"x"}', '{"vitality":2.7,"precision":15}', null, '{"haste":15,"potency":15,"attack":15,"vitality":15,"precision":15}'];
  mods numeric[] := array[1.0, 1.3, 0.85, 2.0, 0.5, null];
begin
  -- Reference copies: the OLD texts (db/schema of 2026-10-11), renamed.
  create function ref_cp_exact(p_rarity text, p_ascension integer, p_mod numeric default 1.0) returns numeric language sql stable as $f$
    select coalesce((b.rcp->>p_rarity)::numeric, (b.rcp->>'normal')::numeric)
         * coalesce((b.st->p_rarity->>greatest(0, least(5, coalesce(p_ascension, 0))))::numeric,
                    (b.st->'normal'->>greatest(0, least(5, coalesce(p_ascension, 0))))::numeric)
         * coalesce(p_mod, 1.0)
      from (select balance_get('rarity_cp') as rcp, balance_get('stars') as st) b; $f$;
  create function ref_max_hp(p_cp integer) returns integer language sql stable as $f$
    select greatest(balance_num('card_hp', 'floor'), round(p_cp * balance_num('card_hp', 'per_cp')))::int; $f$;
  create function ref_stat_pt(p_pts jsonb, p_key text) returns integer language sql stable as $f$
    select greatest(0, least(balance_num('stat_points', 'max_per_stat')::int, coalesce(case when jsonb_typeof(p_pts->p_key) = 'number'
      then floor((p_pts->>p_key)::numeric)::int end, 0))); $f$;
  create function ref_card_power(p_rarity text, p_ascension integer, p_mod numeric default 1.0) returns integer language sql stable as $f$
    select round(ref_cp_exact(p_rarity, p_ascension, p_mod))::int; $f$;
  create function ref_card_combat(p_rarity text, p_asc integer, p_mod numeric, p_pts jsonb) returns jsonb language plpgsql stable as $f$
  declare
    c jsonb := stat_cfg();
    a int := greatest(0, least(5, coalesce(p_asc, 0)));
    pts jsonb := coalesce(p_pts, '{}'::jsonb);
    v_x numeric; v_cp int; v_spent int;
  begin
    v_x := ref_cp_exact(p_rarity, a, p_mod);
    if not coalesce((c->>'enabled')::boolean, false) then
      v_cp := round(v_x)::int;
      return jsonb_build_object('on', false, 'cp', v_cp, 'hp', ref_max_hp(v_cp), 'crit', 0,
        'potency', 1, 'haste', 1, 'free', 0);
    end if;
    v_spent := ref_stat_pt(pts, 'attack') + ref_stat_pt(pts, 'vitality') + ref_stat_pt(pts, 'precision')
             + ref_stat_pt(pts, 'potency') + ref_stat_pt(pts, 'haste');
    v_cp := round(v_x * (1 + (c->>'attack')::numeric * ref_stat_pt(pts, 'attack')))::int;
    return jsonb_build_object('on', true, 'cp', v_cp,
      'hp', round(ref_max_hp(v_cp) * (1 + (c->>'vitality')::numeric * ref_stat_pt(pts, 'vitality')))::int,
      'crit', (c->>'precision')::numeric * ref_stat_pt(pts, 'precision'),
      'potency', 1 + (c->>'potency')::numeric * ref_stat_pt(pts, 'potency'),
      'haste', greatest((c->>'haste_floor')::numeric, 1 - (c->>'haste')::numeric * ref_stat_pt(pts, 'haste')),
      'free', greatest(0, (c->>'per_star')::int * a - v_spent));
  end $f$;
  create function ref_card_powers(p_player text default null) returns jsonb language sql stable as $f$
    select coalesce(jsonb_object_agg(x.id::text, x.v), '{}'::jsonb) from (
      select c.id, jsonb_build_object('power', ref_card_power(c.rarity::text, 0, s.cp_mod),
                                      'hp', ref_max_hp(ref_card_power(c.rarity::text, 0, s.cp_mod))) as v
        from cards c left join subjects s on s.id = c.subject_id where p_player is null
      union all
      select c.id, ref_card_combat(c.rarity::text, pc.ascension, s.cp_mod, pc.stat_points)
                   || jsonb_build_object('power', ref_card_power(c.rarity::text, pc.ascension, s.cp_mod))
        from player_cards pc join cards c on c.id = pc.card_id left join subjects s on s.id = c.subject_id
       where p_player is not null and pc.player_id = p_player and pc.quantity > 0) x; $f$;

  -- 1. stat_pt
  bad := 0; n := 0;
  foreach pts in array pset loop
    foreach r in array array['attack','vitality','precision','potency','haste','nope'] loop
      n := n + 1;
      if stat_pt(pts, r) is distinct from ref_stat_pt(pts, r) then bad := bad + 1; end if;
      if stat_pt(pts, r, 15) is distinct from least(15, ref_stat_pt(pts, r)) and balance_num('stat_points', 'max_per_stat') = 15 then bad := bad + 1; end if;
    end loop;
  end loop;
  res := res || jsonb_build_object('case', 'stat_pt = the old text (' || n || ' inputs)', 'ok', bad = 0 and n > 40, 'bad', bad);

  -- 2. cp_exact and max_hp
  bad := 0; n := 0;
  foreach r in array array['normal','illustrated_rare','secret_rare','full_art','gold','event','promo','nonsense'] loop
    for a in -1..7 loop
      foreach m in array mods loop
        n := n + 1;
        if card_cp_exact(r, a, m) is distinct from ref_cp_exact(r, a, m) or card_power(r, a, m) is distinct from ref_card_power(r, a, m) then bad := bad + 1; end if;
      end loop;
    end loop;
  end loop;
  for a in -5..3000 loop n := n + 1; if card_max_hp(a) is distinct from ref_max_hp(a) then bad := bad + 1; end if; end loop;
  res := res || jsonb_build_object('case', 'card_cp_exact, card_power, card_max_hp = the old text (' || n || ' inputs)', 'ok', bad = 0 and n > 400, 'bad', bad);

  -- 3. card_combat, flag on and off
  for flag in select unnest(array[true, false]) loop
    update balance set value = value || jsonb_build_object('enabled', flag) where key = 'stat_points';
    bad := 0; n := 0;
    foreach r in array array['normal','illustrated_rare','secret_rare','full_art','gold','event','promo'] loop
      for a in 0..5 loop
        foreach m in array mods loop
          foreach pts in array pset loop
            n := n + 1;
            if card_combat(r, a, m, pts) is distinct from ref_card_combat(r, a, m, pts) then bad := bad + 1; end if;
          end loop;
        end loop;
      end loop;
    end loop;
    res := res || jsonb_build_object('case', 'card_combat flag ' || flag || ' = the old text (' || n || ' inputs)', 'ok', bad = 0 and n > 2000, 'bad', bad);
  end loop;

  -- 4. card_powers: the catalog and every player, flag on and off
  for flag in select unnest(array[true, false]) loop
    update balance set value = value || jsonb_build_object('enabled', flag) where key = 'stat_points';
    bad := 0; n := 0;
    if card_powers(null) is distinct from ref_card_powers(null) then bad := bad + 1; end if;
    for pid in select id from players loop
      n := n + 1; x := card_powers(pid); y := ref_card_powers(pid);
      if x is distinct from y then bad := bad + 1; end if;
      tot := tot + jsonb_object_keys_count(x);
    end loop;
    res := res || jsonb_build_object('case', 'card_powers flag ' || flag || ' = the old text for the catalog and ' || n || ' players', 'ok', bad = 0 and n > 0, 'bad', bad);
  end loop;

  -- 5. a bundle with a missing key raises (the balance_check trigger refuses to remove the key from the table itself)
  begin perform card_combat('gold', 1, 1.0, '{}', jsonb_set(card_balance(), '{card_hp}', '{"per_cp": 1.8}')); ok_raise := false; exception when others then ok_raise := true; end;
  res := res || jsonb_build_object('case', 'a bundle without card_hp.floor raises (card_combat)', 'ok', ok_raise);

  raise exception 'RESULTS %', res;
end $t$;`;
// helper declared inline below (a DO block cannot declare functions of its own)
const full = body
  .replace('declare\n  res jsonb', 'declare\n  ok_raise boolean; res jsonb')
  .replace("  create function ref_cp_exact", "  create function jsonb_object_keys_count(j jsonb) returns int language sql immutable as $f$ select count(*)::int from jsonb_object_keys(j) $f$;\n  create function ref_cp_exact");

const out = JSON.stringify(await q(`set statement_timeout = '5min';` + String.fromCharCode(10) + full));
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
