/**
 * The Admin view editors (Phase 2): every change goes PREVIEW -> TEST on the LOCAL copy -> APPLY live -> UNDO from the log
 * (Nathan 2026-10-07: "Test, then apply"). The SQL side is tcg-bot/supabase/admin_write.sql (the admin_* write functions).
 *
 * A change: { kind, key/path/after (balance, setting), key/path/member/op (setting_member), player/amount (member_packs,
 * member_shards), player/card/amount (member_card), reason }.
 *   POST /preview  reads the LIVE value now and returns it with the difference.
 *   POST /test     runs the SAME admin_* function on the LOCAL copy inside a block that always rolls back (with the local
 *                  value as the before value), then the checks of that kind: the readers of the balance key, the pull
 *                  rate math, a Hunt simulation (private test bosses, a fixed seed, before and after), the Hunt prizes of
 *                  the last Hunt, the member balances and the three ledger reconciles. Nothing stays on the local copy.
 *   POST /apply    { change, before }: the admin_* function on LIVE with the preview value as p_before. The function
 *                  refuses (409) when the live value changed since the preview. The admin_actions row is in the same
 *                  transaction.
 *   POST /undo     { id, reason }: admin_undo on LIVE (409 when the value changed again, or the action was undone).
 *   GET  /status, /balance, /settings, /log, /member/:id/cards; POST /local/refresh + GET /local/refresh (refresh.sh in WSL).
 *
 * Protection: the admin gate of admin-routes.js (ADMIN_VIEW=1 + the studio login) AND the flag ADMIN_EDIT=1 (off = every
 * route here 404). A write needs JSON and the header X-Admin-Write: 1 (a cross-site form cannot send either; the session
 * cookie is SameSite=Strict too). The actor in the log: studio:<STUDIO_USER>.
 * The LOCAL copy: the file LOCALDB_ENV (default %TEMP%/localdb.env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PGMETA_URL, written
 * by localdb/up.sh). The SQL runs through postgres-meta as service_role (the role of the live API calls).
 * Usage in server.js: app.use('/api/admin/edit', adminWriteRouter({ live: supabase })) BEFORE the read router.
 */
import express from 'express';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { adminGate } from './admin-routes.js';

export class BadRequest extends Error {}
const KEY = /^[a-z][a-z0-9_]{0,59}$/;
const ID = /^[A-Za-z0-9_]{1,40}$/;
const SECRET = /secret|token|password|salt/i;
export const lit = (s) => `'${String(s).replace(/\0/g, '').replace(/'/g, "''")}'`;
const jlit = (v) => `${lit(JSON.stringify(v))}::jsonb`;
const arr = (path) => `${lit(`{${path.map((p) => `"${String(p).replace(/["\\]/g, (c) => `\\${c}`)}"`).join(',')}}`)}::text[]`;

// The balance keys a quick Hunt simulation measures (the sim squad has no ability, no tags, a boss with no passive).
export const SIM_KEYS = new Set(['rarity_cp', 'stars', 'stat_points', 'card_hp', 'boss_atk', 'boss_hp', 'combat', 'boss_moves', 'round_cap']);
export const SIM_SQUADS = {
  '8 Normal 3 stars': [['normal', 3, 8]],
  'Typical: 1 Gold, 3 Full Art, 2 Secret, 2 Illustrated, 0 stars': [['gold', 0, 1], ['full_art', 0, 3], ['secret_rare', 0, 2], ['illustrated_rare', 0, 2]],
  '8 Gold 5 stars': [['gold', 5, 8]],
};
export const RARITIES = ['normal', 'illustrated_rare', 'secret_rare', 'full_art', 'gold'];

export const getPath = (v, path) => path.reduce((o, k) => (o != null && typeof o === 'object' ? o[k] : undefined), v);
const isObj = (v) => v != null && typeof v === 'object';
// Every leaf that differs: [{ path, before, after }].
export function leafDiff(a, b, path = []) {
  if (isObj(a) && isObj(b) && Array.isArray(a) === Array.isArray(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    return keys.flatMap((k) => leafDiff(a[k], b[k], [...path, k]));
  }
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [{ path, before: a ?? null, after: b ?? null }];
}

const str = (v, name, min, max) => {
  if (typeof v !== 'string' || v.trim().length < min || v.length > max) throw new BadRequest(`${name} must be ${min} to ${max} characters`);
  return v;
};
const intIn = (v, name, min, max) => {
  if (!Number.isInteger(v) || v < min || v > max || v === 0) throw new BadRequest(`${name} must be a whole number from ${min} to ${max}, not 0`);
  return v;
};
const pathOf = (p) => {
  if (!Array.isArray(p) || p.length > 8) throw new BadRequest('path must be a list of up to 8 names');
  return p.map((x) => {
    const s = String(x);
    if (!s.length || s.length > 80 || /[\u0000-\u001f]/.test(s)) throw new BadRequest('a path name is not allowed');
    return s;
  });
};

// One change from the request body, checked and normalized. The SQL functions check again.
export function parseChange(c) {
  if (!isObj(c)) throw new BadRequest('change is required');
  const reason = str(c.reason, 'reason', 3, 500);
  switch (c.kind) {
    case 'balance': case 'setting': {
      if (!KEY.test(c.key || '')) throw new BadRequest('key is not allowed');
      const path = pathOf(c.path || []);
      if (c.after === undefined || c.after === null) throw new BadRequest('after is required');
      if (JSON.stringify(c.after).length > 32000) throw new BadRequest('after is too large');
      if (path.some((p) => SECRET.test(p)) || SECRET.test(c.key)) throw new BadRequest('a secret cannot be changed here');
      return { kind: c.kind, key: c.key, path, after: c.after, reason };
    }
    case 'setting_member': {
      if (!KEY.test(c.key || '')) throw new BadRequest('key is not allowed');
      if (!ID.test(c.member || '')) throw new BadRequest('member is not allowed');
      if (!['add', 'remove'].includes(c.op)) throw new BadRequest('op must be add or remove');
      return { kind: c.kind, key: c.key, path: pathOf(c.path || []), member: c.member, op: c.op, reason };
    }
    case 'member_packs': case 'member_shards': {
      if (!ID.test(c.player || '')) throw new BadRequest('player is not allowed');
      const max = c.kind === 'member_packs' ? 1000 : 1000000;
      return { kind: c.kind, player: c.player, amount: intIn(c.amount, 'amount', -max, max), reason };
    }
    case 'member_card': {
      if (!ID.test(c.player || '')) throw new BadRequest('player is not allowed');
      if (!Number.isInteger(c.card) || c.card < 1) throw new BadRequest('card must be a card id');
      return { kind: c.kind, player: c.player, card: c.card, amount: intIn(c.amount, 'amount', -100, 100), reason };
    }
    default: throw new BadRequest('kind is not allowed');
  }
}

// The rpc call of one change on LIVE (or the SQL call on LOCAL with the same arguments).
export function rpcOf(ch, before, actor, undoOf = null) {
  switch (ch.kind) {
    case 'balance': return ['admin_balance_set', { p_actor: actor, p_key: ch.key, p_path: ch.path, p_before: before, p_after: ch.after, p_reason: ch.reason, p_undo_of: undoOf }];
    case 'setting': return ['admin_setting_set', { p_actor: actor, p_key: ch.key, p_path: ch.path, p_before: before, p_after: ch.after, p_reason: ch.reason, p_undo_of: undoOf }];
    case 'setting_member': return ['admin_setting_member', { p_actor: actor, p_key: ch.key, p_path: ch.path, p_member: ch.member, p_add: ch.op === 'add', p_reason: ch.reason, p_undo_of: undoOf }];
    case 'member_packs': return ['admin_member_packs', { p_actor: actor, p_player: ch.player, p_amount: ch.amount, p_before: before, p_reason: ch.reason, p_undo_of: undoOf }];
    case 'member_shards': return ['admin_member_shards', { p_actor: actor, p_player: ch.player, p_amount: ch.amount, p_before: before, p_reason: ch.reason, p_undo_of: undoOf }];
    case 'member_card': return ['admin_member_card', { p_actor: actor, p_player: ch.player, p_card: ch.card, p_amount: ch.amount, p_before: before, p_reason: ch.reason, p_undo_of: undoOf }];
    default: throw new BadRequest('kind is not allowed');
  }
}

// The same call as SQL text, with the before value read in the block (v_before).
function sqlCall(ch, actor) {
  const r = lit(ch.reason), a = lit(actor);
  switch (ch.kind) {
    case 'balance': return `admin_balance_set(${a}, ${lit(ch.key)}, ${arr(ch.path)}, v_before, ${jlit(ch.after)}, ${r})`;
    case 'setting': return `admin_setting_set(${a}, ${lit(ch.key)}, ${arr(ch.path)}, v_before, ${jlit(ch.after)}, ${r})`;
    case 'setting_member': return `admin_setting_member(${a}, ${lit(ch.key)}, ${arr(ch.path)}, ${lit(ch.member)}, ${ch.op === 'add'}, ${r})`;
    case 'member_packs': return `admin_member_packs(${a}, ${lit(ch.player)}, ${ch.amount}, (v_before #>> '{}')::int, ${r})`;
    case 'member_shards': return `admin_member_shards(${a}, ${lit(ch.player)}, ${ch.amount}, (v_before #>> '{}')::int, ${r})`;
    case 'member_card': return `admin_member_card(${a}, ${lit(ch.player)}, ${ch.card}, ${ch.amount}, (v_before #>> '{}')::int, ${r})`;
    default: throw new BadRequest('kind is not allowed');
  }
}
function sqlBefore(ch) {
  switch (ch.kind) {
    case 'balance': return `select value #> ${arr(ch.path)} into v_before from balance where key = ${lit(ch.key)};`;
    case 'setting': case 'setting_member': return `select value #> ${arr(ch.path)} into v_before from settings where key = ${lit(ch.key)};`;
    case 'member_packs': return `select to_jsonb(pack_balance) into v_before from players where id = ${lit(ch.player)};`;
    case 'member_shards': return `select to_jsonb(shard_balance) into v_before from players where id = ${lit(ch.player)};`;
    case 'member_card': return `select to_jsonb(coalesce((select quantity from player_cards where player_id = ${lit(ch.player)} and card_id = ${ch.card}), 0)) into v_before;`;
    default: return '';
  }
}

// The member state the member actions change (packs, Shards, copies of the card) and the three ledger checks.
const memberState = (ch) => `jsonb_build_object('packs', (select pack_balance from players where id = ${lit(ch.player)}),
  'shards', (select shard_balance from players where id = ${lit(ch.player)}),
  'copies', ${ch.kind === 'member_card' ? `coalesce((select quantity from player_cards where player_id = ${lit(ch.player)} and card_id = ${ch.card}), 0)` : 'null'},
  'pack_ledger_ok', (pack_ledger_reconcile()->>'ok')::boolean, 'shard_ledger_ok', (shard_ledger_reconcile()->>'ok')::boolean,
  'card_ledger_ok', (card_ledger_reconcile()->>'ok')::boolean)`;

/** The rolled-back TEST block of one change (no simulation). */
export function testSql(ch, actor) {
  const member = ch.kind.startsWith('member_');
  const key = ch.key ? lit(ch.key) : 'null';
  return `set statement_timeout = 60000;
do $t$ declare v_before jsonb; r jsonb; chk jsonb := '{}'; f record; v_err text; v_readers jsonb := '[]'; v_pre jsonb;
begin
  perform setseed(0.42);
  perform set_config('tcg.skip_welcome', 'on', true);
  ${sqlBefore(ch)}
  ${member ? `if not exists (select 1 from players where id = ${lit(ch.player)}) then raise exception 'admin: the member is not on the local copy (refresh the local copy)'; end if;
  v_pre := ${memberState(ch)};` : ''}
  r := ${sqlCall(ch, actor)};
  ${ch.kind === 'balance' ? `-- every function that reads the key; the ones with no argument run now with the new value
  for f in select p.oid::regprocedure::text as sig, p.proname,
              (p.pronargs = 0 and p.provolatile in ('s', 'i') and p.prorettype <> 'trigger'::regtype and not p.proretset) as runnable from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.prosrc ~ ('balance_(get|num)\\(''' || ${key} || '''')
            order by p.proname loop
    v_err := null;
    if f.runnable then
      begin execute format('select count(*) from (select %s) x', f.sig); exception when others then v_err := sqlerrm; end;
    end if;
    v_readers := v_readers || jsonb_build_object('fn', f.proname, 'ran', f.runnable, 'error', v_err);
  end loop;
  chk := chk || jsonb_build_object('readers', v_readers, 'balance_log', (select count(*) from balance_log where key = ${key} and changed_at = now()));
  ${ch.key === 'hunt_prizes' ? `chk := chk || jsonb_build_object('hunt', (select jsonb_build_object('hunt', h.id, 'participants', count(t.*), 'with_damage', count(t.*) filter (where t.dmg > 0))
      from (select id from hunts where settled_at is not null order by id desc limit 1) h
      left join (select hunt_id, player_id, sum(damage) dmg from hunt_hits group by 1, 2) t on t.hunt_id = h.id group by h.id));` : ''}` : ''}
  ${ch.kind.startsWith('setting') ? `chk := chk || jsonb_build_object('settings_log', (select count(*) from settings_log where key = ${key} and changed_at = now()));` : ''}
  ${member ? `chk := chk || jsonb_build_object('member_before', v_pre, 'member_after', ${memberState(ch)},
    'ledger_rows', (select count(*) from pack_ledger where ref_kind = 'admin_action' and ref_id = r->>'action_id')
                 + (select count(*) from shard_ledger where ref_kind = 'admin_action' and ref_id = r->>'action_id')
                 + (select count(*) from card_ledger where ref_kind = 'admin_action' and ref_id = r->>'action_id'));` : ''}
  chk := chk || jsonb_build_object('admin_action', (select jsonb_build_object('action', action, 'target_kind', target_kind, 'actor', actor) from admin_actions where id = (r->>'action_id')::bigint));
  raise exception 'RES %', jsonb_build_object('before', v_before, 'result', r, 'checks', chk);
end $t$;`;
}

/** A Hunt simulation: the sim squads fight private test bosses (never the live boss row), the same seed before and after. */
export function simSql(ch, actor, { tier = 'Heroic', trials = 6 } = {}) {
  const squads = Object.entries(SIM_SQUADS).map(([name, parts]) => [name, parts.flatMap(([r, a, n]) => Array.from({ length: n }, () => [r, a, Math.min(15, 3 * a)]))]);
  return `set statement_timeout = 120000;
do $t$ declare v_before jsonb; r jsonb; P text := 'tst_admin_sim'; d date := (now() at time zone 'America/Denver')::date;
  ids bigint[]; h bigint; hp bigint; share bigint; cid bigint; dmg bigint; atks int; done boolean; tried boolean; i int; tr int; ph int;
  sq jsonb; nm text; res jsonb := '{}'; arr jsonb; squads jsonb := ${jlit(squads)}; x jsonb;
begin
  perform set_config('tcg.skip_welcome', 'on', true);
  select array_agg(id) into ids from (select c.id from cards c join subjects s on s.id = c.subject_id
     where c.rarity = 'normal' and s.type in ('Character','Creature') order by c.id limit 8) z;
  update subjects s set ability = null, tags = '{}'::jsonb, tag_slugs = '{}', cp_mod = 1.0, type = 'Character'
    where s.id in (select subject_id from cards where id = any(ids));
  insert into players (id, username) values (P, 'tst admin sim');
  for ph in 0..1 loop
    if ph = 1 then
      ${sqlBefore(ch)}
      r := ${sqlCall(ch, actor)};
    end if;
    for x in select * from jsonb_array_elements(squads) loop
      nm := x->>0; sq := x->1; arr := '[]';
      perform setseed(0.42);
      delete from player_cards where player_id = P;
      for i in 1..jsonb_array_length(sq) loop
        update cards set rarity = (sq->(i-1)->>0)::card_rarity where id = ids[i];
        insert into player_cards (player_id, card_id, quantity, ascension, stat_points) values (P, ids[i], 1, (sq->(i-1)->>1)::int,
          jsonb_build_object('attack', (sq->(i-1)->>2)::int));
      end loop;
      hp := balance_num('boss_hp', ${lit(tier)}); share := greatest(1, round(hp::numeric / balance_num('boss_hp', 'crew')));
      for tr in 1..${Math.max(1, Math.min(30, trials))} loop
        insert into hunts (name, tier, weak_points, resist_points, hp_max, hp_remaining, closes_at, passive, hp_share, stats)
          values ('Sim Boss', ${lit(tier)}, '[]', '[]', hp, hp, now() + interval '1 day', '{}'::jsonb, share,
                  jsonb_build_object('atk', balance_num('boss_atk', ${lit(tier)}))) returning id into h;
        insert into hunt_squads (hunt_id, player_id, hit_date, card_ids) values (h, P, d, ids[1:jsonb_array_length(sq)]);
        dmg := 0; atks := 0; done := false;
        while not done loop
          tried := false;
          for cid in select pc.card_id from player_cards pc join cards c on c.id = pc.card_id
                      left join hunt_card_hp hh on hh.card_id = pc.card_id and hh.player_id = P and hh.hunt_id = h
                      where pc.player_id = P and not coalesce(hh.downed, false)
                      order by (card_combat(c.rarity::text, pc.ascension, 1.0, pc.stat_points)->>'cp')::int desc, pc.card_id loop
            r := hunt_attack(P, h, cid);
            if r->>'error' in ('stunned', 'downed') then continue; end if;
            tried := true; exit;
          end loop;
          if not tried or r->>'error' is not null then done := true;
          else
            dmg := dmg + coalesce((r->>'damage')::int, 0); atks := atks + 1;
            if (r->>'round')::int >= hunt_round_cap() or coalesce((r->>'defeated')::boolean, false) then done := true; end if;
          end if;
        end loop;
        arr := arr || jsonb_build_array(jsonb_build_array(dmg, atks));
      end loop;
      res := jsonb_set(res, array[case when ph = 0 then 'before' else 'after' end], coalesce(res->case when ph = 0 then 'before' else 'after' end, '{}') || jsonb_build_object(nm, arr));
    end loop;
  end loop;
  raise exception 'RES %', res || jsonb_build_object('tier', ${lit(tier)}, 'trials', ${Math.max(1, Math.min(30, trials))});
end $t$;`;
}

/** The RES json from a rolled-back block, else the error text. */
export function readRes(out) {
  const msg = typeof out === 'string' ? out : (out?.message || out?.error || JSON.stringify(out));
  const m = /RES (\{.*\})/s.exec(msg);
  if (m) {
    let s = m[1];
    for (let i = 0; i < 3; i++) { try { return { res: JSON.parse(s) }; } catch { s = s.replace(/\n(CONTEXT|HINT|DETAIL):[\s\S]*$/, '').replace(/\\"/g, '"'); } }
  }
  return { error: String(msg).replace(/^ERROR:\s+[A-Z0-9]{5}:\s*/, '').split('\nCONTEXT:')[0].trim() };
}

const stats = (fights) => {
  const d = fights.map((x) => x[0]).sort((a, b) => a - b);
  const mean = d.reduce((s, x) => s + x, 0) / Math.max(1, d.length);
  return { mean: Math.round(mean), p10: d[Math.floor(d.length * 0.1)] ?? 0, p90: d[Math.floor(d.length * 0.9)] ?? 0,
    attacks: Math.round((fights.reduce((s, x) => s + x[1], 0) / Math.max(1, fights.length)) * 10) / 10 };
};
export function simSummary(res) {
  return Object.keys(SIM_SQUADS).map((name) => {
    const b = stats(res.before?.[name] || []), a = stats(res.after?.[name] || []);
    return { squad: name, before: b, after: a, change: b.mean ? (a.mean - b.mean) / b.mean : null };
  });
}

// Hunt prizes of one Hunt for a prize value (settle_hunt: place by damage, ranks[place - 1], else base; 0 damage = base).
export function huntPrizePacks(cfg, participants, withDamage) {
  const ranks = Array.isArray(cfg?.ranks) ? cfg.ranks : [];
  let total = 0;
  for (let place = 1; place <= withDamage; place++) total += place <= ranks.length ? Number(ranks[place - 1]) : Number(cfg?.base || 0);
  return total + Math.max(0, participants - withDamage) * Number(cfg?.base || 0);
}

// The pull rate math: the expected share per rarity, per pack and "1 in N packs".
export function pullMath(v) {
  const rates = v?.rates || {}, size = Number(v?.pack_size) || 0;
  const rows = RARITIES.map((r) => {
    const p = Number(rates[r]);
    const perPack = 1 - (1 - p) ** size;
    return { rarity: r, rate: p, per_pack: perPack, one_in_packs: perPack > 0 ? 1 / perPack : null };
  });
  const sum = rows.reduce((s, x) => s + (Number.isFinite(x.rate) ? x.rate : 0), 0);
  return { pack_size: size, rows, sum, sum_ok: Math.abs(sum - 1) <= 1e-9 };
}

/** The LOCAL copy: its env file, its SQL (postgres-meta, as service_role) and its age. */
export function localCopy(env = process.env, fetchFn = (...a) => globalThis.fetch(...a)) {
  const file = () => env.LOCALDB_ENV || join(env.TEMP || tmpdir(), 'localdb.env');
  const read = () => {
    const f = file();
    if (!existsSync(f)) return null;
    const v = Object.fromEntries(readFileSync(f, 'utf8').split(/\r?\n/).map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean)
      .map((m) => [m[1], m[2].trim().replace(/^["']|["']$/g, '')]));
    return v.PGMETA_URL ? { ...v, file: f, written_at: statSync(f).mtime.toISOString() } : null;
  };
  // The SQL runs as service_role (the role of the live API calls); { role: null } = as the postgres-meta user (the Test lab
  // cancels a run with it: pg_cancel_backend on its own session).
  const sql = async (query, { role = 'service_role' } = {}) => {
    const v = read();
    if (!v) throw new BadRequest(`The local copy is not set up: ${basename(file())} not found. Refresh the local copy.`);
    if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(v.PGMETA_URL.replace(/\/+$/, ''))) throw new BadRequest('The local copy must be on this PC (PGMETA_URL)');
    const r = await fetchFn(`${v.PGMETA_URL.replace(/\/+$/, '')}/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: role ? `set role service_role;\n${query}` : query }) });
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch { /* text */ }
    if (r.ok) return Array.isArray(j) ? j : [];
    const e = new Error(j?.message || j?.error || text);
    e.code = j?.code || null;
    throw e;
  };
  const info = async () => {
    const v = read();
    if (!v) return { configured: false, file: basename(file()) };
    try {
      const [row] = await sql(`select (select max(created_at) from pack_ledger) as newest_row, (select max(applied_at) from schema_migrations) as last_migration,
        to_regprocedure('public.admin_balance_set(text,text,text[],jsonb,jsonb,text,bigint)') is not null as has_admin_write`);
      return { configured: true, reachable: true, file: basename(v.file), written_at: v.written_at, ...row };
    } catch (e) {
      return { configured: true, reachable: false, file: basename(v.file), written_at: v.written_at, error: String(e.message).split('\n')[0] };
    }
  };
  return { sql, info, file, read };
}

/** The refresh of the local copy (localdb/refresh.sh in WSL): one at a time, the last lines kept. */
export function refresher(env = process.env, spawnFn = spawn) {
  const job = { state: 'idle', started_at: null, ended_at: null, code: null, tail: [] };
  const start = () => {
    if (job.state === 'running') return job;
    const script = env.LOCALDB_REFRESH || '/mnt/c/Users/vaugh/discord-ui-preview/localdb/refresh.sh';
    const envFile = basename(env.LOCALDB_ENV || 'localdb.env');
    const args = ['-d', env.LOCALDB_WSL_DISTRO || 'Ubuntu', '-e', 'env', `LOCALDB_ENVFILE=${envFile}`,
      ...(env.LOCALDB_DIR ? [`LOCALDB_DIR=${env.LOCALDB_DIR}`] : []), 'bash', script];
    Object.assign(job, { state: 'running', started_at: new Date().toISOString(), ended_at: null, code: null, tail: [] });
    const p = spawnFn('wsl.exe', args, { env: { ...process.env, MSYS_NO_PATHCONV: '1' }, windowsHide: true });
    const add = (b) => { job.tail.push(...String(b).split(/\r?\n/).filter(Boolean).map((l) => l.slice(0, 300))); job.tail = job.tail.slice(-30); };
    p.stdout?.on('data', add); p.stderr?.on('data', add);
    p.on('error', (e) => { add(e.message); Object.assign(job, { state: 'failed', ended_at: new Date().toISOString() }); });
    p.on('close', (code) => { if (job.state === 'running') Object.assign(job, { state: code === 0 ? 'done' : 'failed', code, ended_at: new Date().toISOString() }); });
    return job;
  };
  return { start, status: () => job };
}

const httpOf = (e) => (e instanceof BadRequest ? 400 : /LP409/.test(e.code || '') || /^admin: .* changed \(now|undone already/.test(e.message || '') ? 409 : 400);

export function adminWriteRouter({ live, local = localCopy(), refresh = refresher(), env = process.env }) {
  if (!live) throw new Error('adminWriteRouter needs the live client');
  const actor = () => `studio:${env.STUDIO_USER || 'studio'}`;
  const r = express.Router();
  r.use(adminGate(env));
  r.use((req, res, next) => (env.ADMIN_EDIT === '1' ? next() : res.status(404).json({ error: 'not found' })));
  r.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
    if (!/^application\/json\b/.test(req.headers['content-type'] || '') || req.headers['x-admin-write'] !== '1') {
      return res.status(403).json({ error: 'a write needs JSON and the header X-Admin-Write: 1' });
    }
    return next();
  });
  r.use(express.json({ limit: '64kb' }));
  const wrap = (fn) => async (req, res) => {
    try { return await fn(req, res); } catch (e) {
      if (e instanceof BadRequest) return res.status(400).json({ error: e.message });
      return res.status(500).json({ error: 'admin edit route failed' });
    }
  };
  const one = async (q) => { const { data, error } = await q; if (error) throw new BadRequest(error.message || String(error)); return data; };
  const names = async (ids) => {
    const list = [...new Set(ids.filter((x) => typeof x === 'string' && ID.test(x)))];
    if (!list.length) return {};
    const rows = await one(live.from('players').select('id, username').in('id', list));
    return Object.fromEntries((rows || []).map((p) => [p.id, p.username]));
  };

  r.get('/status', wrap(async (req, res) => res.json({ edit: true, actor: actor(), source: env.LOCALDB === '1' ? 'LOCAL' : 'LIVE',
    local: await local.info(), refresh: refresh.status() })));
  r.get('/local/refresh', (req, res) => res.json(refresh.status()));
  r.post('/local/refresh', (req, res) => res.status(202).json(refresh.start()));

  r.get('/balance', wrap(async (req, res) => res.json({ rows: await one(live.from('balance').select('key, value, note, updated_at, updated_by').order('key')) })));

  // settings: a secret shows as hidden, a member list as the members (id + name), never as a bulk id list.
  r.get('/settings', wrap(async (req, res) => {
    const rows = await one(live.from('settings').select('key, value, updated_at').order('key'));
    const lists = [];
    const walk = (key, v, path) => {
      if (Array.isArray(v) && ((key === 'discord_immune' && !path.length) || path.at(-1) === 'users' || (v.length && v.every((x) => typeof x === 'string' && /^\d{17,20}$/.test(x))))) {
        lists.push(...v);
        return { $members: v.map((id) => ({ id })) };
      }
      if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET.test(k) ? { $hidden: true } : walk(key, x, [...path, k])]));
      return v;
    };
    const out = (rows || []).map((s) => ({ key: s.key, updated_at: s.updated_at, value: SECRET.test(s.key) ? { $hidden: true } : walk(s.key, s.value, []) }));
    const nm = await names(lists);
    const fillNames = (v) => (isObj(v) ? (v.$members ? { $members: v.$members.map((m) => ({ id: m.id, username: nm[m.id] || null })) }
      : Array.isArray(v) ? v.map(fillNames) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fillNames(x)]))) : v);
    return res.json({ rows: out.map((s) => ({ ...s, value: fillNames(s.value) })) });
  }));

  r.get('/member/:id/cards', wrap(async (req, res) => {
    if (!ID.test(req.params.id)) throw new BadRequest('id is not allowed');
    const rows = await one(live.from('player_cards').select('card_id, quantity, ascension, cards(name, rarity)').eq('player_id', req.params.id).order('card_id'));
    return res.json({ rows: (rows || []).map((x) => ({ card_id: x.card_id, quantity: x.quantity, ascension: x.ascension, name: x.cards?.name, rarity: x.cards?.rarity })) });
  }));

  // The admin log: newest first, 50 a page, filters; undoable = a studio change that no action undid yet.
  r.get('/log', wrap(async (req, res) => {
    const offset = Math.max(0, Math.min(1e7, Number.parseInt(req.query.offset, 10) || 0));
    let q = live.from('admin_actions').select('*', { count: 'exact' });
    for (const f of ['action', 'target_kind', 'source']) if (req.query[f]) { if (!KEY.test(String(req.query[f]))) throw new BadRequest(`${f} is not allowed`); q = q.eq(f, String(req.query[f])); }
    if (req.query.target_id) { if (!/^[A-Za-z0-9_ .-]{1,80}$/.test(String(req.query.target_id))) throw new BadRequest('target_id is not allowed'); q = q.eq('target_id', String(req.query.target_id)); }
    const { data, error, count } = await q.order('id', { ascending: false }).range(offset, offset + 49);
    if (error) throw new BadRequest(error.message);
    const ids = (data || []).map((x) => x.id);
    const undone = ids.length ? await one(live.from('admin_actions').select('id, undo_of').in('undo_of', ids)) : [];
    const by = Object.fromEntries((undone || []).map((x) => [x.undo_of, x.id]));
    const nm = await names((data || []).flatMap((x) => [x.target_kind === 'player' ? x.target_id : null, x.after?.member]));
    const UNDO = ['balance_set', 'setting_set', 'setting_member', 'member_packs', 'member_shards', 'member_card'];
    return res.json({ offset, limit: 50, total: count ?? null, rows: (data || []).map((x) => ({ ...x,
      target_name: x.target_kind === 'player' ? nm[x.target_id] || null : null, member_name: x.after?.member ? nm[x.after.member] || null : null,
      undone_by: by[x.id] || null, undoable: x.source === 'studio' && UNDO.includes(x.action) && !by[x.id] })) });
  }));

  // PREVIEW: the live value now.
  const liveNow = async (ch) => {
    switch (ch.kind) {
      case 'balance': case 'setting': case 'setting_member': {
        const row = await one(live.from(ch.kind === 'balance' ? 'balance' : 'settings').select('key, value').eq('key', ch.key).maybeSingle());
        if (!row) throw new BadRequest(`no ${ch.kind === 'balance' ? 'balance key' : 'setting'} ${ch.key}`);
        const cur = getPath(row.value, ch.path);
        if (cur === undefined) throw new BadRequest(`${ch.key} has no value at ${ch.path.join('.')}`);
        if (ch.kind !== 'setting_member') return { before: cur, diff: leafDiff(cur, ch.after, ch.path), full: row.value };
        const nm = await names([ch.member]);
        return { before: Array.isArray(cur) && cur.includes(ch.member), member_name: nm[ch.member] || null, count: Array.isArray(cur) ? cur.length : null };
      }
      case 'member_packs': case 'member_shards': case 'member_card': {
        const p = await one(live.from('players').select('id, username, pack_balance, shard_balance').eq('id', ch.player).maybeSingle());
        if (!p) throw new BadRequest('no member with this id');
        if (ch.kind === 'member_packs') return { before: p.pack_balance, after: p.pack_balance + ch.amount, member_name: p.username };
        if (ch.kind === 'member_shards') return { before: p.shard_balance, after: p.shard_balance + ch.amount, member_name: p.username };
        const c = await one(live.from('cards').select('id, name, rarity').eq('id', ch.card).maybeSingle());
        if (!c) throw new BadRequest('no card with this id');
        const pc = await one(live.from('player_cards').select('quantity, ascension').eq('player_id', ch.player).eq('card_id', ch.card).maybeSingle());
        return { before: pc?.quantity || 0, after: (pc?.quantity || 0) + ch.amount, ascension: pc?.ascension || 0, member_name: p.username, card: c };
      }
      default: throw new BadRequest('kind is not allowed');
    }
  };
  r.post('/preview', wrap(async (req, res) => {
    const ch = parseChange(req.body?.change);
    const now = await liveNow(ch);
    const extra = ch.kind === 'balance' && ch.key === 'pulls' ? { pulls: pullMath(setAt(structuredClone(now.full), ch.path, ch.after)), pulls_now: pullMath(now.full) } : {};
    delete now.full;
    return res.json({ change: ch, live: now, ...extra, sim: ch.kind === 'balance' && SIM_KEYS.has(ch.key) });
  }));

  // TEST on the LOCAL copy (rolled back).
  r.post('/test', wrap(async (req, res) => {
    const ch = parseChange(req.body?.change);
    const out = { change: ch, local: await local.info() };
    if (!out.local.reachable) return res.status(409).json({ ...out, ok: false, error: 'The local copy does not answer. Refresh the local copy.' });
    if (!out.local.has_admin_write) return res.status(409).json({ ...out, ok: false, error: 'The local copy has no admin_write.sql. Refresh the local copy after the migration.' });
    const run = async (q) => { try { await local.sql(q); return { error: 'the test block did not roll back' }; } catch (e) { if (e instanceof BadRequest) throw e; return readRes(e.message); } };
    const t = await run(testSql(ch, actor()));
    if (t.error) return res.json({ ...out, ok: false, error: t.error });
    Object.assign(out, { ok: true, before: t.res.before, result: t.res.result, checks: t.res.checks });
    if (ch.kind === 'balance' && (t.res.checks.readers || []).some((x) => x.error)) out.ok = false;
    if (ch.kind === 'balance' && ch.key === 'pulls') {
      const full = ch.path.length ? setAt(structuredClone(await localValue(local, 'balance', 'pulls')), ch.path, ch.after) : ch.after;
      out.pulls = pullMath(full);
      if (!out.pulls.sum_ok) out.ok = false;
    }
    if (ch.kind === 'balance' && ch.key === 'hunt_prizes' && t.res.checks.hunt) {
      const cur = await localValue(local, 'balance', 'hunt_prizes');
      const next = ch.path.length ? setAt(structuredClone(cur), ch.path, ch.after) : ch.after;
      const { participants, with_damage: wd, hunt } = t.res.checks.hunt;
      out.prizes = { hunt, participants, before: huntPrizePacks(cur, participants, wd), after: huntPrizePacks(next, participants, wd) };
    }
    if (ch.kind === 'balance' && SIM_KEYS.has(ch.key) && req.body?.sim !== false) {
      const tier = ['Normal', 'Heroic', 'Mythic'].includes(ch.path[0]) ? ch.path[0] : 'Heroic';
      const s = await run(simSql(ch, actor(), { tier, trials: Number(env.ADMIN_SIM_TRIALS) || 6 }));
      out.sim = s.error ? { error: s.error } : { tier: s.res.tier, trials: s.res.trials, rows: simSummary(s.res) };
    }
    if (ch.kind.startsWith('member_')) {
      const a = t.res.checks.member_after || {};
      if (a.pack_ledger_ok === false && t.res.checks.member_before?.pack_ledger_ok !== false) out.ok = false;
      if (a.shard_ledger_ok === false && t.res.checks.member_before?.shard_ledger_ok !== false) out.ok = false;
      if (a.card_ledger_ok === false && t.res.checks.member_before?.card_ledger_ok !== false) out.ok = false;
    }
    return res.json(out);
  }));

  // APPLY on LIVE with the preview value as the before value.
  r.post('/apply', wrap(async (req, res) => {
    const ch = parseChange(req.body?.change);
    if (!('before' in (req.body || {}))) throw new BadRequest('before (the preview value) is required');
    const before = ch.kind === 'setting_member' ? null : req.body.before;
    if (ch.kind.startsWith('member_') && !Number.isInteger(before)) throw new BadRequest('before must be the balance of the preview');
    const [fn, args] = rpcOf(ch, before, actor());
    const { data, error } = await live.rpc(fn, args);
    if (error) return res.status(httpOf(error)).json({ error: String(error.message || error).replace(/^admin: /, ''), code: error.code || null });
    return res.json({ ok: true, result: data });
  }));

  r.post('/undo', wrap(async (req, res) => {
    const id = Number(req.body?.id);
    if (!Number.isInteger(id) || id < 1) throw new BadRequest('id must be an action id');
    const reason = str(req.body?.reason, 'reason', 3, 500);
    const { data, error } = await live.rpc('admin_undo', { p_actor: actor(), p_action: id, p_reason: reason });
    if (error) return res.status(httpOf(error)).json({ error: String(error.message || error).replace(/^admin: /, ''), code: error.code || null });
    return res.json({ ok: true, result: data });
  }));
  return r;
}

export function setAt(obj, path, v) {
  if (!path.length) return v;
  let o = obj;
  for (const k of path.slice(0, -1)) o = (o[k] ??= {});
  o[path.at(-1)] = v;
  return obj;
}
async function localValue(local, table, key) {
  const [row] = await local.sql(`select value from ${table === 'balance' ? 'balance' : 'settings'} where key = ${lit(key)}`);
  return row?.value ?? null;
}
