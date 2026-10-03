/**
 * hunt_view (one call) must return the same Hunt data as the 4 separate queries it replaces
 * (server.js /api/hunt). Read-only: node scripts/test-hunt-view.mjs [player_id...]
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: hunt } = await sb.from('hunts').select('id').order('id', { ascending: false }).limit(1).maybeSingle();
// The newest boss, active or not: the view must match either way.
if (!hunt) { console.log('no hunt'); process.exitCode = 1; }
const { data: hitters } = await sb.from('hunt_hits').select('player_id, hit_date').eq('hunt_id', hunt.id).limit(50);
const cases = (process.argv.slice(2).length ? process.argv.slice(2).map((p) => ({ player_id: p, hit_date: new Date().toISOString().slice(0, 10) })) : hitters) || [];
const norm = (x) => JSON.stringify(x, Object.keys(x || {}).sort());
let bad = 0, n = 0;
for (const { player_id, hit_date } of cases) {
  const [{ data: c }, { data: hp }, { data: contrib }, { data: cs }] = await Promise.all([
    sb.from('player_cards').select('ascension, first_obtained_at, card:cards(id, name, rarity, image_url, season, subject:subjects(type, cp_mod, ability, tags))').eq('player_id', player_id),
    sb.from('hunt_card_hp').select('card_id, hp_remaining, max_hp, downed, shield, cd_until_round').eq('hunt_id', hunt.id).eq('player_id', player_id).eq('hit_date', hit_date),
    sb.from('hunt_hits').select('damage').eq('hunt_id', hunt.id).eq('player_id', player_id),
    sb.from('hunt_combat_state').select('round').eq('hunt_id', hunt.id).eq('player_id', player_id).eq('hit_date', hit_date).maybeSingle(),
  ]);
  const { data: v, error } = await sb.rpc('hunt_view', { p_player: player_id, p_hunt: hunt.id, p_day: hit_date });
  if (error) { console.log('FAIL rpc', error.message); bad++; continue; }
  const byId = (a, k) => [...(a || [])].sort((x, y) => (k(x) > k(y) ? 1 : -1));
  const cardKey = (r) => r.card.id;
  const sameCards = JSON.stringify(byId(c, cardKey).map((r) => ({ a: r.ascension, f: r.first_obtained_at && new Date(r.first_obtained_at).getTime(), c: { ...r.card, subject: r.card.subject && JSON.parse(norm(r.card.subject)) } })))
    === JSON.stringify(byId(v.cards, cardKey).map((r) => ({ a: r.ascension, f: r.first_obtained_at && new Date(r.first_obtained_at).getTime(), c: { ...r.card, subject: r.card.subject && JSON.parse(norm(r.card.subject)) } })));
  const sameHp = JSON.stringify(byId(hp, (r) => r.card_id).map(norm)) === JSON.stringify(byId(v.hp, (r) => r.card_id).map(norm));
  const dmgOld = (contrib || []).reduce((t, h) => t + h.damage, 0);
  const same = sameCards && sameHp && dmgOld === Number(v.damage) && (cs?.round || 0) === (v.round || 0);
  n++; if (!same) bad++;
  console.log(`${same ? 'PASS' : 'FAIL'} ${String(player_id).slice(-4)} ${hit_date}: cards ${(c || []).length}/${v.cards.length} ${sameCards} hp ${(hp || []).length}/${v.hp.length} ${sameHp} damage ${dmgOld}/${v.damage} round ${cs?.round || 0}/${v.round || 0}`);
}
console.log(bad ? `${bad} of ${n} FAILED` : `PASS ${n} players`);
process.exitCode = bad ? 1 : 0;
