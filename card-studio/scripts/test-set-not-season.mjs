/**
 * Acceptance test for tcg-bot/supabase/f2_set_not_season.sql (F-2 PR 4, SQL part): a set works like Season 1 with no read of the
 * season TEXT. NO lasting change (one DO block; the final RAISE rolls it back), on the LOCAL copy only:
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-set-not-season.mjs          must PASS (the file is applied twice)
 *   MUTATE=<name> ...                                                                             must FAIL, for every name printed by MUTATE=list
 *   MUTATE=all ...                                                                                runs every mutation, one line each
 * The old text of each function (the reference copies pg_temp.ref_<name>) is the file's text with every edit of
 * test-set-not-season.edits.json put back (the edits that made the file from the live text of 2026-10-12). One mutation puts back ONE edit.
 * Invariants:
 *   A. Season 1 gives the SAME answers as before: ach_track_values, ach_tag_badges (rows tag:S1:...), combat_weak (every kind, stack 0 and 2),
 *      hunt_card_crits, hunt_pick_pool, hunt_attack, dungeon_attack (the same seed), dungeon_card and dungeon_card_base (the same keys).
 *   B. A test set (id T93, season 93, pullable) works like S1: its card counts for the draw-pool achievements and stops counting when the set is
 *      not pullable (the old text counted it anyway); it has its tag badge (key tag:S93:..., season 'Season 93', short 'S93'); the weak point
 *      kind 'set' (and the older kind 'season') hits a card of that set in combat_weak, hunt_card_crits, hunt_pick_pool, hunt_attack and
 *      dungeon_attack; the dungeon card info has the key 'set'.
 */
import './localdb-guard.mjs';
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
if (ref !== 'kgvdqqehefezbypozvrh') throw new Error(`wrong Supabase project: ${ref}`);
if (process.env.LOCALDB !== '1') throw new Error('run this test on the LOCAL copy only (LOCALDB=1 and the localdb preload)');
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();

let mig = readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/f2_set_not_season.sql', import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
mig = mig.replace(/-- GUARD \(the combat_core[\s\S]*?-- GUARD-END\n/, '');   // the guard checks the live database, not this block
const EDITS = JSON.parse(readFileSync(fileURLToPath(new URL('./test-set-not-season.edits.json', import.meta.url)), 'utf8'));
const sectionOf = (src, name) => { const s = src.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`); if (s < 0) throw new Error(`no ${name} in the file`); const e = src.indexOf('$function$;', s); return [s, e + 11]; };
// Mutations: put back ONE edit (in its function only).
const MUT = {};
for (const [name, pairs] of Object.entries(EDITS)) pairs.forEach(([a, b], i) => { MUT[`${name}#${i}`] = [`CREATE OR REPLACE FUNCTION public.${name}(`, b, a]; });
if (process.env.MUTATE === 'list') { console.log(Object.keys(MUT).join('\n')); process.exit(0); }
// An edit with no visible effect: cards_set_rules makes cards.season = 'Season ' || card_sets.season, so the old short-name formula gives the same text.
const EQUIVALENT = new Set(['ach_tag_badges#5']);
if (process.env.MUTATE === 'all') {
  let ok = true;
  for (const name of Object.keys(MUT)) {
    const r = spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, MUTATE: name }, encoding: 'utf8' });
    const line = (r.stdout || '').trim().split(/\r?\n/).pop() || '';
    const caught = r.status !== 0 && /^(FAIL|ERROR) /.test(line);
    if (!caught && !EQUIVALENT.has(name)) ok = false;
    console.log(`mutation ${name.padEnd(24)} ${caught ? 'caught (test FAILS)' : EQUIVALENT.has(name) ? 'equivalent (same text)' : 'NOT CAUGHT'}  ${line.slice(0, 150)}`);
  }
  console.log(ok ? 'mutations: all caught' : 'mutations: FAIL (a mutation was not caught)');
  process.exit(ok ? 0 : 1);
}
// The reference copies (the OLD text): built from the UNMUTATED file; each call of combat_weak goes to the old combat_weak.
const refs = Object.entries(EDITS).map(([name, pairs]) => {
  const [s, e] = sectionOf(mig, name); let txt = mig.slice(s, e);
  for (const [a, b] of pairs) { if (!txt.includes(b)) throw new Error(`${name}: the edit is not in the file: ${b.slice(0, 60)}`); txt = txt.split(b).join(a); }
  return txt.replace(`public.${name}(`, `pg_temp.ref_${name}(`).replace(/(?<![\w.])combat_weak\(/g, 'pg_temp.ref_combat_weak(');
}).join('\n\n');
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE];
  const s = m && mig.indexOf(m[0]); const i = s >= 0 ? mig.indexOf(m[1], s) : -1;
  if (!m || s < 0 || i < 0) throw new Error(`the mutation ${process.env.MUTATE} does not match the migration`);
  mig = mig.slice(0, i) + m[2] + mig.slice(i + m[1].length);
}
if (mig.includes('$m$') || mig.includes('$t$') || refs.includes('$m$') || refs.includes('$t$')) throw new Error('the migration must not contain $m$ or $t$');

// The dungeon run fixture of test-dungeon-stun-pass.mjs (a member, a run with a huge monster), taken from that file.
const stun = readFileSync(fileURLToPath(new URL('./test-dungeon-stun-pass.mjs', import.meta.url)), 'utf8').replace(/\r/g, '');
const fa = stun.indexOf('  create function pg_temp.dsp_member('), fb = stun.indexOf('  -- S1 one attacker stunned');
if (fa < 0 || fb < 0 || fb < fa) throw new Error('the dungeon fixture of test-dungeon-stun-pass.mjs moved');
const dungeonFixture = stun.slice(fa, fb);
if (dungeonFixture.includes('$m$') || dungeonFixture.includes('$t$')) throw new Error('the fixture contains $m$ or $t$');

const P = 'tst_fsn_', SET = 'T93';
const body = String.raw`do $t$
declare res jsonb := '[]'; a jsonb; b jsonb; c0 bigint; x bigint; sx bigint; h1 bigint; h2 bigint; h3 bigint; h4 bigint; v_tag text; d date := (now() at time zone 'America/Denver')::date;
  v_day date; w jsonb; kinds jsonb[]; k jsonb; ok boolean; n int; da numeric; db numeric; ids bigint[]; n_keys text[]; ra jsonb; rb jsonb; rc jsonb;
begin
  perform set_config('tcg.skip_welcome', 'on', true);
  execute $m$${mig}$m$;
  execute $m$${mig}$m$;   -- two times: idempotent
  execute $m$${refs}$m$;
  update settings set value = value || '{"enabled": true}' where key in ('dungeon', 'gauntlet');

  -- members: P1 owns 60 Season 1 cards, P2 the same (for the same-answer pairs)
  insert into players (id, username) values ('${P}1', 'tst1'), ('${P}2', 'tst2'), ('${P}3', 'tst3'), ('${P}4', 'tst4');
  insert into player_cards (player_id, card_id, quantity) select p, c.id, 2 from cards c, (values ('${P}1'), ('${P}2')) v(p) where c.set_id = 'S1' order by c.id limit 120;
  -- the test set: a free season (93), pullable; its card is a second card of an attacker subject that has an origin tag
  if exists (select 1 from card_sets where season = 93 or id = '${SET}' or code = 'TST93') then raise exception 'the test set (season 93) exists already'; end if;
  insert into card_sets (id, name, code, pack_color, season, pullable) values ('${SET}', 'Test set 93', 'TST93', '#112233', 93, true);
  select s.id, (select t from unnest(s.tag_slugs) t where t like 'origin:%' limit 1) into sx, v_tag
    from subjects s where s.type = 'Character' and exists (select 1 from unnest(s.tag_slugs) t where t like 'origin:%')
      and not exists (select 1 from cards c where c.subject_id = s.id and c.rarity = 'gold') and exists (select 1 from cards c where c.subject_id = s.id and c.set_id = 'S1') order by s.id limit 1;
  insert into cards (subject_id, name, rarity, set_id) values (sx, 'Test card 93', 'gold', '${SET}') returning id into x;
  insert into player_cards (player_id, card_id, quantity) values ('${P}3', x, 1), ('${P}4', x, 1);
  insert into player_cards (player_id, card_id, quantity) select p, c.id, 1 from cards c, (values ('${P}3'), ('${P}4')) v(p) where c.set_id = 'S1' and c.id <> x order by c.id limit 20 on conflict do nothing;

  -- A1 the achievement counters of Season 1: the same answer as the old text
  a := ach_track_values('${P}1'); b := pg_temp.ref_ach_track_values('${P}1');
  res := res || jsonb_build_object('case', 'A1 S1: ach_track_values = the old text', 'ok', a = b and (a->>'collector')::int > 0, 'a', left(a::text, 120), 'b', left(b::text, 120));
  -- A2 the tag badges of Season 1: the same rows
  select count(*) into n from ach_tag_badges('${P}1') where key like 'tag:S1:%';
  res := res || jsonb_build_object('case', 'A2 S1: ach_tag_badges rows tag:S1:... = the old text (same rows, same order)', 'ok', n > 0 and
    (select jsonb_agg(to_jsonb(r)) from ach_tag_badges('${P}1') r where r.key like 'tag:S1:%') = (select jsonb_agg(to_jsonb(r)) from pg_temp.ref_ach_tag_badges('${P}1') r where r.key like 'tag:S1:%'), 'rows', n);
  res := res || jsonb_build_object('case', 'A2b S1 badge shape: season Season 1, short S1', 'ok', (select bool_and(season = 'Season 1' and short = 'S1') from ach_tag_badges('${P}1') where key like 'tag:S1:%'));

  -- A3 combat_weak: every kind, the same answer (new: the set id S1; old: the season text)
  ok := true; n := 0;
  foreach k in array array['[{"kind":"type","value":"Character"}]', '[{"kind":"type","value":"Item"}]', '[{"kind":"rarity","value":"normal"}]', '[{"kind":"tag","value":"x:y"}]',
      '[{"kind":"season","value":"Season 1"}]', '[{"kind":"season","value":"Season 2"}]', '[{"kind":"type","value":"Character"},{"kind":"season","value":"Season 1"},{"kind":"rarity","value":"normal"}]', '[]']::jsonb[] loop
    foreach da in array array[0, 2] loop
      n := n + 1;
      if combat_weak(k, '[{"kind":"rarity","value":"gold"},{"kind":"season","value":"Season 1"}]', 'Character', 'normal', 'S1', array['x:y'], da::int)
         is distinct from pg_temp.ref_combat_weak(k, '[{"kind":"rarity","value":"gold"},{"kind":"season","value":"Season 1"}]', 'Character', 'normal', 'Season 1', array['x:y'], da::int)
        or combat_weak(null, k, 'Character', 'normal', 'S1', array['x:y'], da::int) is distinct from pg_temp.ref_combat_weak(null, k, 'Character', 'normal', 'Season 1', array['x:y'], da::int)
        then ok := false; end if;
    end loop;
  end loop;
  res := res || jsonb_build_object('case', 'A3 S1: combat_weak (every kind as weak and as resist, stack 0 and 2) = the old text', 'ok', ok and n = 16, 'n', n);

  -- B1 combat_weak: the kind set (and the older kind season) hits a card of the test set
  res := res || jsonb_build_object('case', 'B1 combat_weak: kind set hits its set only; kind season hits the season of the set; no set: no hit', 'ok',
    (combat_weak('[{"kind":"set","value":"${SET}"}]', null, 'Character', 'gold', '${SET}', '{}', 0)->>'wm')::int = 1
    and (combat_weak('[{"kind":"set","value":"${SET}"}]', null, 'Character', 'gold', 'S1', '{}', 0)->>'wm')::int = 0
    and (combat_weak('[{"kind":"set","value":"S1"}]', null, 'Character', 'gold', '${SET}', '{}', 0)->>'wm')::int = 0
    and (combat_weak('[{"kind":"season","value":"Season 93"}]', null, 'Character', 'gold', '${SET}', '{}', 0)->>'wm')::int = 1
    and (combat_weak('[{"kind":"season","value":"Season 93"}]', null, 'Character', 'gold', 'S1', '{}', 0)->>'wm')::int = 0
    and (combat_weak(null, '[{"kind":"set","value":"${SET}"}]', 'Character', 'gold', '${SET}', '{}', 0)->>'rm')::int = 1
    and (combat_weak('[{"kind":"set","value":"${SET}"}]', null, 'Character', 'gold', null, '{}', 0)->>'wm')::int = 0);

  -- B2 the achievements: the card of the test set counts in the draw pool, and not when the set is not pullable (the old text counted it anyway)
  a := ach_track_values('${P}3'); b := pg_temp.ref_ach_track_values('${P}3');
  update card_sets set pullable = false where id = '${SET}';
  rb := ach_track_values('${P}3'); ra := pg_temp.ref_ach_track_values('${P}3');
  update card_sets set pullable = true where id = '${SET}';
  res := res || jsonb_build_object('case', 'B2 ach_track_values: a card of a pullable test set counts; with the set not pullable it does not (the old text counted it in both)', 'ok',
    (a->>'collector')::int = (rb->>'collector')::int + 1 and (b->>'collector') = (ra->>'collector') and (a->>'collector')::int = (b->>'collector')::int, 'pullable', a->'collector', 'not_pullable', rb->'collector', 'old_not_pullable', ra->'collector');
  -- B3 the tag badge of the test set
  select count(*) into n from ach_tag_badges('${P}3') where key = 'tag:S93:' || v_tag and season = 'Season 93' and short = 'S93' and need = 1 and have = 1;
  update card_sets set pullable = false where id = '${SET}';
  da := (select count(*) from ach_tag_badges('${P}3') where key like 'tag:S93:%');
  update card_sets set pullable = true where id = '${SET}';
  res := res || jsonb_build_object('case', 'B3 ach_tag_badges: the test set has its badge (tag:S93:..., Season 93, short S93, 1 of 1); no badge while the set is not pullable', 'ok', n = 1 and da = 0, 'badge', v_tag, 'n', n, 'not_pullable', da);

  -- B3b the badges are ordered by the season NUMBER (Season 100 after Season 93; the old text order put 'Season 100' first)
  insert into card_sets (id, name, code, pack_color, season, pullable) values ('T100', 'Test set 100', 'TST100', '#112244', 100, true);
  insert into cards (subject_id, name, rarity, set_id) values (sx, 'Test card 100', 'secret_rare', 'T100') returning id into h1;
  insert into player_cards (player_id, card_id, quantity) values ('${P}3', h1, 1);
  select array_agg(r.key order by r.ord) into n_keys from (select key, row_number() over () ord from ach_tag_badges('${P}3')) r where r.key in ('tag:S93:' || v_tag, 'tag:S100:' || v_tag);
  res := res || jsonb_build_object('case', 'B3b ach_tag_badges: the order is by season number (S93 before S100)', 'ok', n_keys = array['tag:S93:' || v_tag, 'tag:S100:' || v_tag], 'keys', to_jsonb(n_keys));
  -- B3c fullsets: a subject whose every card (2) is in the draw pool and owned counts; not when its set is not pullable (the old text counted it)
  insert into subjects (key, name, type) values ('${P}sub', 'Test subject 93', 'Item') returning id into h2;
  insert into cards (subject_id, name, rarity, set_id) values (h2, 'Test sub a', 'normal', '${SET}'), (h2, 'Test sub b', 'gold', '${SET}');
  insert into players (id, username) values ('${P}5', 'tst5') on conflict do nothing;
  insert into player_cards (player_id, card_id, quantity) select '${P}5', id, 1 from cards where subject_id = h2;
  a := ach_track_values('${P}5'); b := pg_temp.ref_ach_track_values('${P}5');
  update card_sets set pullable = false where id = '${SET}';
  rb := ach_track_values('${P}5'); ra := pg_temp.ref_ach_track_values('${P}5');
  update card_sets set pullable = true where id = '${SET}';
  res := res || jsonb_build_object('case', 'B3c ach_track_values fullsets: a complete subject of a pullable set counts; 0 when the set is not pullable (the old text: 1 in both)', 'ok',
    (a->>'fullsets')::int = 1 and (rb->>'fullsets')::int = 0 and (b->>'fullsets')::int = 1 and (ra->>'fullsets')::int = 1, 'on', a->'fullsets', 'off', rb->'fullsets');

  -- B4 the dungeon card info has the set (every old key is unchanged)
  res := res || jsonb_build_object('case', 'B4 dungeon_card / dungeon_card_base: key set; every old key unchanged (S1 and the test set)', 'ok',
    dungeon_card_base(x)->>'set' = '${SET}' and dungeon_card('${P}3', x)->>'set' = '${SET}'
    and dungeon_card('${P}1', (select min(card_id) from player_cards where player_id = '${P}1')) - 'set' = pg_temp.ref_dungeon_card('${P}1', (select min(card_id) from player_cards where player_id = '${P}1'))
    and dungeon_card_base((select min(id) from cards where set_id = 'S1')) - 'set' = pg_temp.ref_dungeon_card_base((select min(id) from cards where set_id = 'S1')) and dungeon_card('${P}1', (select min(card_id) from player_cards where player_id = '${P}1'))->>'set' = 'S1');

  -- The Hunt: a boss (no weak point it uses besides the rows below), the same row twice for the pairs
  create function pg_temp.mk_hunt(p_weak jsonb, p_resist jsonb) returns bigint language plpgsql as $f$
  declare h bigint;
  begin
    insert into hunts (name, tier, weak_points, resist_points, passive, hp_max, hp_remaining, closes_at, hp_share, stats)
      values ('Test boss 93', 'Normal', p_weak, p_resist, '{"list": []}'::jsonb, 9000000, 9000000, now() + interval '1 day', 3000, '{"atk": 40}') returning id into h;
    return h;
  end $f$;
  -- A4/A5 Season 1: hunt_card_crits and hunt_pick_pool = the old text (a weak rarity + a weak season, a resist type)
  h1 := pg_temp.mk_hunt('[{"kind":"rarity","value":"normal"},{"kind":"season","value":"Season 1"}]', '[{"kind":"type","value":"Creature"}]');
  -- the old text reads kind season; the new text reads it through the set of the card: the same hunt row, the same answer
  res := res || jsonb_build_object('case', 'A4 S1: hunt_card_crits = the old text (weak kind season and rarity)', 'ok',
    hunt_card_crits('${P}1', h1) = pg_temp.ref_hunt_card_crits('${P}1', h1) and hunt_card_crits('${P}1', h1) <> '{}'::jsonb);
  res := res || jsonb_build_object('case', 'A5 S1: hunt_pick_pool = the old text', 'ok',
    hunt_pick_pool('${P}1', h1) = pg_temp.ref_hunt_pick_pool('${P}1', h1) and jsonb_array_length(hunt_pick_pool('${P}1', h1)) > 0 and exists (select 1 from jsonb_array_elements(hunt_pick_pool('${P}1', h1)) e where (e->>'wm')::int >= 2));
  -- B5 the test set through the kind set: crit and pool
  h2 := pg_temp.mk_hunt('[{"kind":"set","value":"${SET}"}]', '[]');
  h3 := pg_temp.mk_hunt('[]', '[]');
  res := res || jsonb_build_object('case', 'B5a hunt_card_crits: a weak point of kind set raises the crit of the card of that set, and only that card', 'ok',
    (hunt_card_crits('${P}3', h2)->>(x::text))::numeric > (hunt_card_crits('${P}3', h3)->>(x::text))::numeric
    and (select bool_and(e.value = hunt_card_crits('${P}3', h3)->e.key) from jsonb_each(hunt_card_crits('${P}3', h2)) e where e.key <> x::text),
    'with', hunt_card_crits('${P}3', h2)->(x::text), 'without', hunt_card_crits('${P}3', h3)->(x::text));
  res := res || jsonb_build_object('case', 'B5b hunt_pick_pool: the card of the test set has wm 1 under a weak point of kind set; the S1 cards have 0', 'ok',
    (select (e->>'wm')::int from jsonb_array_elements(hunt_pick_pool('${P}3', h2)) e where (e->>'id')::bigint = x) = 1
    and (select bool_and((e->>'wm')::int = 0) from jsonb_array_elements(hunt_pick_pool('${P}3', h2)) e where (e->>'id')::bigint <> x));
  -- A6 / B6 hunt_attack: the same seed, two members, two hunts with the same weak points: the new text = the old text; the kind set is a weak hit
  h1 := pg_temp.mk_hunt('[{"kind":"season","value":"Season 1"}]', '[]');
  h4 := pg_temp.mk_hunt('[{"kind":"season","value":"Season 1"}]', '[]');
  c0 := (select pc.card_id from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
          where pc.player_id = '${P}1' and s.type in ('Character', 'Creature') order by pc.card_id limit 1);
  perform hunt_state_round(h1, '${P}1', d); perform hunt_commit_card(h1, '${P}1', c0, d, 60);
  perform hunt_state_round(h4, '${P}2', d); perform hunt_commit_card(h4, '${P}2', c0, d, 60);
  perform setseed(0.42); ra := hunt_attack('${P}1', h1, c0);
  perform setseed(0.42); rb := pg_temp.ref_hunt_attack('${P}2', h4, c0);
  res := res || jsonb_build_object('case', 'A6 S1: hunt_attack (weak kind season) = the old text: damage, outcome, crit, bonus', 'ok',
    (ra->>'ok')::boolean and (rb->>'ok')::boolean and (ra->'damage') = (rb->'damage') and (ra->'outcome') = (rb->'outcome') and (ra->'crit') = (rb->'crit') and (ra->'bonus') = (rb->'bonus') and (ra->>'bonus')::boolean,
    'new', left(ra::text, 150), 'old', left(rb::text, 150));
  h1 := pg_temp.mk_hunt('[{"kind":"set","value":"${SET}"}]', '[]'); h4 := pg_temp.mk_hunt('[]', '[]');
  perform hunt_state_round(h1, '${P}3', d); perform hunt_commit_card(h1, '${P}3', x, d, 60);
  perform hunt_state_round(h4, '${P}4', d); perform hunt_commit_card(h4, '${P}4', x, d, 60);
  perform setseed(0.42); ra := hunt_attack('${P}3', h1, x);
  perform setseed(0.42); rb := hunt_attack('${P}4', h4, x);
  res := res || jsonb_build_object('case', 'B6 hunt_attack: a weak point of kind set on the test set is a weak hit (bonus true, more damage than with no weak point)', 'ok',
    (ra->>'ok')::boolean and (ra->>'bonus')::boolean and not (rb->>'bonus')::boolean and (ra->>'damage')::numeric > (rb->>'damage')::numeric, 'with', ra->'damage', 'without', rb->'damage', 'rb', left(rb::text, 200));

  -- The Dungeon: the same seed, the same run, three monsters' weak lists: the new text = the old text (weak kind season); kind set on S1 = kind season
${dungeonFixture}
  create function pg_temp.fsn_attack(p text, p_weak jsonb, p_old boolean) returns jsonb language plpgsql as $f$
  declare r jsonb; cards bigint[];
  begin
    perform pg_temp.dsp_run(p, 'daily', 5, 0);
    update dungeon_runs set state = jsonb_set(state, '{foes,0,weak}', p_weak) where player_id = p and day = dungeon_day();
    cards := pg_temp.dsp_cards(p, 'daily');
    perform setseed(0.42);
    if p_old then r := pg_temp.ref_dungeon_attack(p, cards[1], 0, 'daily'); else r := dungeon_attack(p, cards[1], 0, 'daily'); end if;
    return r;
  end $f$;
  v_day := dungeon_day();
  perform dungeon_generate(v_day);
  update dungeon_days set rule = '{}'::jsonb where day = v_day;
  ra := pg_temp.fsn_attack('${P}d1', '[{"kind":"season","value":"Season 1"}]', false);
  rb := pg_temp.fsn_attack('${P}d2', '[{"kind":"season","value":"Season 1"}]', true);
  rc := pg_temp.fsn_attack('${P}d3', '[{"kind":"set","value":"S1"}]', false);
  res := res || jsonb_build_object('case', 'A7 S1: dungeon_attack (weak kind season) = the old text, and kind set S1 gives the same damage', 'ok',
    (ra->>'ok')::boolean and (ra->>'damage') = (rb->>'damage') and (ra->>'outcome') = (rb->>'outcome') and (ra->'crit') = (rb->'crit') and (rc->>'damage') = (ra->>'damage'),
    'new', left(ra::text, 120), 'old', left(rb::text, 120), 'set', rc->'damage');
  rb := pg_temp.fsn_attack('${P}d4', '[]', false);
  res := res || jsonb_build_object('case', 'B7 dungeon_attack: a weak point of kind set is a weak hit (more damage than with no weak point)', 'ok',
    (rb->>'ok')::boolean and (rc->>'damage')::numeric > (rb->>'damage')::numeric, 'weak', rc->'damage', 'none', rb->'damage');

  raise exception 'RESULTS %', res;
exception when others then
  if sqlerrm like 'RESULTS%' then raise; end if;
  raise exception 'ERROR % %', sqlstate, sqlerrm;
end $t$;`;

const out = await q(body);
const m = JSON.stringify(out).match(/RESULTS (\[.*\])/);
if (!m) { console.log('ERROR ' + JSON.stringify(out).slice(0, 700)); process.exit(1); }
const rows = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
let bad = 0;
for (const x of rows) { if (!x.ok) bad += 1; console.log(`${x.ok ? 'PASS' : 'FAIL'} ${x.case}${x.ok ? '' : ' ' + JSON.stringify(x).slice(0, 500)}`); }
console.log(bad ? `FAIL ${bad} of ${rows.length} cases (${rows.filter((x) => !x.ok).map((x) => x.case.split(' ')[0]).join(' ')})` : `PASS all ${rows.length} cases`);
process.exit(bad ? 1 : 0);
