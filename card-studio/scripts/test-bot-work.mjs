// Test bot_work() (tcg-bot/supabase/bot_work.sql) on the LIVE database, every case rolled back:
// each flag is true exactly when the bot timer's own query would find work, so a gated timer
// never skips a post or an undo. Each case runs in a DO block that ends with an exception (the
// result is in the message), so nothing stays.   node scripts/test-bot-work.mjs
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/).map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim().replace(/^["']|["']$/g, '')]));
const ref = new URL(env.SUPABASE_URL).hostname.split('.')[0];
const q = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
  return r.json();
};
let bad = 0;
const ok = (c, m) => { bad += !c; console.log((c ? '  ok   ' : '  FAIL ') + m); };

// The setup every case shares: the real queues set aside (inside the rolled-back block: a live prank
// or an unposted play must not decide a case), two test members and one play between them.
const SETUP = `
  update discord_effects set status = 'done' where status in ('pending', 'active');
  update card_plays set posted_at = now() where posted_at is null;
  update hunt_events set posted_at = now() where posted_at is null;
  update auctions set notice_message_id = coalesce(notice_message_id, 'test'), notice_dirty = false
    where notice_message_id is null or (status in ('sold', 'closed', 'expired') and notice_dirty);
  insert into players (id, username) values ('tst_bw_a', 'tst a'), ('tst_bw_b', 'tst b');
  select c.id, c.subject_id into v_card, v_subject from cards c limit 1;
  insert into card_plays (player_id, target_id, aimed_at, card_id, subject_id, primitive, kind, rarity, outcome, posted_at)
    values ('tst_bw_a', 'tst_bw_b', 'tst_bw_b', v_card, v_subject, 'nickname', 'prank', 'normal', 'applied', now()) returning id into v_play;`;
async function flags(name, body) {
  const sql = `do $$ declare v_card bigint; v_subject bigint; v_play bigint; v_hunt bigint; begin
    ${SETUP}
    ${body}
    raise exception 'BW%', bot_work()::text; end $$`;
  const r = await q(sql);
  const m = JSON.stringify(r).match(/BW(\{[^}]*\})/);
  if (!m) { console.log('  ?? ', name, JSON.stringify(r).slice(0, 300)); return null; }
  return JSON.parse(m[1].replace(/\\"/g, '"'));
}
const base = await flags('base', '');
ok(base && !base.fx && !base.plays && !base.events && !base.auctions, `nothing to do: every flag is false ${JSON.stringify(base)} (a posted play does not count)`);
const C = [
  ['a pending Discord effect that is due', `insert into discord_effects (play_id, target_id, primitive) values (v_play, 'tst_bw_b', 'nickname');`, 'fx', true],
  ['a pending Discord effect that waits 1 h (delay)', `insert into discord_effects (play_id, target_id, primitive, execute_after) values (v_play, 'tst_bw_b', 'nickname', now() + interval '1 hour');`, 'fx', false],
  ['an active ping parade', `insert into discord_effects (play_id, target_id, primitive, status) values (v_play, 'tst_bw_b', 'ping_parade', 'active');`, 'fx', true],
  ['an active reaction storm', `insert into discord_effects (play_id, target_id, primitive, status) values (v_play, 'tst_bw_b', 'reaction_storm', 'active');`, 'fx', true],
  ['an active nickname that ends in 1 h', `insert into discord_effects (play_id, target_id, primitive, status, revert_at) values (v_play, 'tst_bw_b', 'nickname', 'active', now() + interval '1 hour');`, 'fx', false],
  ['an active nickname to undo now', `insert into discord_effects (play_id, target_id, primitive, status, revert_at) values (v_play, 'tst_bw_b', 'nickname', 'active', now() - interval '1 second');`, 'fx', true],
  ['an unposted card play', `update card_plays set posted_at = null where id = v_play;`, 'plays', true],
  ['an unposted hunt event', `select id into v_hunt from hunts order by id desc limit 1; insert into hunt_events (hunt_id, kind) values (v_hunt, 'spawn');`, 'events', true],
  ['a new auction (no start post yet)', `insert into auctions (seller_id, card_id, ends_at) values ('tst_bw_a', v_card, now() + interval '1 day');`, 'auctions', true],
  ['a sold auction with a changed end', `insert into auctions (seller_id, card_id, ends_at, status, notice_message_id, notice_dirty) values ('tst_bw_a', v_card, now(), 'sold', 'm1', true);`, 'auctions', true],
  ['a live auction already posted', `insert into auctions (seller_id, card_id, ends_at, notice_message_id, notice_dirty) values ('tst_bw_a', v_card, now() + interval '1 day', 'm1', true);`, 'auctions', false],
];
for (const [name, body, key, want] of C) {
  const f = await flags(name, body);
  const others = f && Object.entries(f).filter(([k, v]) => k !== key && v).map(([k]) => k);
  ok(f && f[key] === want && others.length === 0, `${name}: ${key} = ${want} ${JSON.stringify(f)}`);
}
const left = await q(`select (select count(*) from players where id like 'tst_bw_%') + (select count(*) from card_plays where player_id like 'tst_bw_%') as n`);
ok(Number(left?.[0]?.n) === 0, `nothing stays: ${JSON.stringify(left)}`);
console.log('FAILS', bad);
