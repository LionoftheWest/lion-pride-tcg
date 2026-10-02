import fs from 'fs';
// Acceptance test for daily_raid_board.sql (live DB, rolled back): node scripts/test-daily-raid-board.mjs
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { fileURLToPath } from 'node:url';
const ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const mig = fs.readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/daily_raid_board.sql', import.meta.url)), 'utf8');
const body = `do $t$ declare a boolean; b boolean; c boolean; n int; top int; begin
  execute $m$${mig}$m$;
  a := daily_raid_board('2026-10-03 12:00:00+00');   -- 6 AM MDT: posts
  b := daily_raid_board('2026-10-03 13:00:00+00');   -- 7 AM MDT: not the slot
  c := daily_raid_board('2026-10-03 12:30:00+00');   -- the same day again: no second post
  select count(*), max(jsonb_array_length(payload->'top')) into n, top from hunt_events where kind = 'leaderboard';
  raise exception 'R first=% other_hour=% again=% events=% top=% spawn_ok=%', a, b, c, n, top, hunt_mt_slot('spawn', '2026-10-01 21:00:00+00');
end $t$;`;
const out = await (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: body }) })).text();
const i = out.indexOf('R first'); console.log(i >= 0 ? out.slice(i, out.indexOf('CONTEXT', i) - 2) : out.slice(0, 400));
