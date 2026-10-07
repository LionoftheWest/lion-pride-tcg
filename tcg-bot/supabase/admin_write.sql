-- admin_write.sql: the WRITE functions of the Admin view (Phase 2, Nathan 2026-10-07: "I should be able to adjust any
-- setting ... managing players, managing rewards, card pull rates, everything"; he chose "Test, then apply").
--
-- The card studio (card-studio/src/admin-write.js) makes each change in four steps:
--   1. PREVIEW  it reads the live value and shows the difference;
--   2. TEST     it calls the SAME function below on the LOCAL copy inside a block that always rolls back, and runs
--               the checks of that kind (the balance triggers, the readers of the key, a Hunt simulation, the ledgers);
--   3. APPLY    it calls the function on LIVE with the value of the preview as p_before;
--   4. UNDO     admin_undo applies the stored before value through the same function (undo_of = the action).
--
-- Every write function here:
--   * re-checks the before value under a row lock and refuses with SQLSTATE LP409 when the live value changed since the
--     preview (an optimistic check), so two admins (or an admin and the game) cannot overwrite each other;
--   * writes the change AND its admin_actions row (admin_log_action, logs_sql.sql) in the same transaction;
--   * changes nothing itself that has a writer: a balance value goes through the balance table (balance_check and
--     balance_check_settings keep the shape, balance_log records it), a settings value through settings
--     (settings_log), packs through grant_packs, Shards through grant_shards and cards through card_move, each with
--     reason 'admin' and the ref ('admin_action', admin_actions.id);
--   * names the admin in balance.by (balance_who), so balance_log, settings_log and updated_by show the admin too;
--   * is callable by the service role only (revoke from public, anon, authenticated at the end).
-- Errors: SQLSTATE LP409 = the value changed (stale), LP400 = a bad request. Both start with "admin:".
-- No guarded function changes. No ledger reason is added: 'admin' exists in all three ledgers (ledger_reasons.sql).
-- Test: card-studio/scripts/test-admin-write.mjs (rolled back, fake members). Idempotent: create or replace only.

-- ============================================================ helpers
create or replace function public.admin_write_begin(p_actor text, p_reason text)
returns void language plpgsql set search_path = public as $$
begin
  if p_actor is null or length(btrim(p_actor)) = 0 then
    raise exception using errcode = 'LP400', message = 'admin: the actor is required';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 or length(p_reason) > 500 then
    raise exception using errcode = 'LP400', message = 'admin: a reason of 3 to 500 characters is required';
  end if;
  perform set_config('balance.by', p_actor, true);
end $$;

create or replace function public.admin_stale(p_what text, p_now jsonb, p_expected jsonb)
returns void language plpgsql set search_path = public as $$
begin
  raise exception using errcode = 'LP409',
    message = format('admin: %s changed (now %s, expected %s). Preview the change again.', p_what, coalesce(p_now::text, 'nothing'), coalesce(p_expected::text, 'nothing'));
end $$;

-- A member id list in a settings value: discord_immune (the whole value), any array named users, or an array of
-- Discord ids. These lists change only by adding or removing one member (admin_setting_member).
create or replace function public.admin_is_member_list(p_key text, p_path text[], p_value jsonb)
returns boolean language sql immutable set search_path = public as $$
  select jsonb_typeof(p_value) = 'array'
     and ((p_key = 'discord_immune' and coalesce(cardinality(p_path), 0) = 0)
          or p_path[cardinality(p_path)] = 'users'
          or (jsonb_array_length(p_value) > 0
              and not exists (select 1 from jsonb_array_elements(p_value) e where jsonb_typeof(e) <> 'string' or e #>> '{}' !~ '^\d{17,20}$')));
$$;

-- The pull rates as the bot reads them (tcg-bot/src/draw.ts pullTable): a rate for each of the 5 drawn rarities, each a
-- number of at least 0, together exactly 1 (within 1e-9), and a pack size from 1 to 20.
create or replace function public.admin_check_pulls(p_value jsonb)
returns void language plpgsql set search_path = public as $$
declare r text; v_sum numeric := 0; v jsonb;
begin
  foreach r in array array['normal', 'illustrated_rare', 'secret_rare', 'full_art', 'gold'] loop
    v := p_value #> array['rates', r];
    if jsonb_typeof(v) is distinct from 'number' or (v #>> '{}')::numeric < 0 then
      raise exception using errcode = 'LP400', message = format('admin: pulls.rates.%s must be a number of at least 0', r);
    end if;
    v_sum := v_sum + (v #>> '{}')::numeric;
  end loop;
  if abs(v_sum - 1) > 0.000000001 then
    raise exception using errcode = 'LP400', message = format('admin: the pull rates add up to %s, not 1', v_sum);
  end if;
  v := p_value->'pack_size';
  if jsonb_typeof(v) is distinct from 'number' or (v #>> '{}')::numeric % 1 <> 0 or (v #>> '{}')::numeric not between 1 and 20 then
    raise exception using errcode = 'LP400', message = 'admin: pulls.pack_size must be a whole number from 1 to 20';
  end if;
end $$;

-- ============================================================ balance
create or replace function public.admin_balance_set(p_actor text, p_key text, p_path text[], p_before jsonb, p_after jsonb,
  p_reason text, p_undo_of bigint default null)
returns jsonb language plpgsql set search_path = public as $$
declare v_val jsonb; v_cur jsonb; v_new jsonb; v_id bigint; v_path text[] := coalesce(p_path, '{}');
begin
  perform admin_write_begin(p_actor, p_reason);
  if p_after is null then raise exception using errcode = 'LP400', message = 'admin: the new value is required'; end if;
  select value into v_val from balance where key = p_key for update;
  if not found then raise exception using errcode = 'LP400', message = format('admin: no balance key %s', p_key); end if;
  v_cur := v_val #> v_path;
  if v_cur is null then raise exception using errcode = 'LP400', message = format('admin: balance %s has no value at %s', p_key, array_to_string(v_path, '.')); end if;
  if v_cur is distinct from p_before then perform admin_stale(btrim(format('balance %s %s', p_key, array_to_string(v_path, '.'))), v_cur, p_before); end if;
  if jsonb_typeof(p_after) <> jsonb_typeof(v_cur) then
    raise exception using errcode = 'LP400', message = format('admin: balance %s %s must stay a %s', p_key, array_to_string(v_path, '.'), jsonb_typeof(v_cur));
  end if;
  if p_after = v_cur then raise exception using errcode = 'LP400', message = 'admin: the new value is the same as the live value'; end if;
  v_new := case when cardinality(v_path) = 0 then p_after else jsonb_set(v_val, v_path, p_after, false) end;
  if p_key = 'pulls' then perform admin_check_pulls(v_new); end if;
  update balance set value = v_new where key = p_key;   -- balance_check and balance_check_settings check the shape here
  v_id := admin_log_action(p_actor, 'balance_set', 'balance', p_key, jsonb_build_object('path', to_jsonb(v_path), 'value', v_cur),
    jsonb_build_object('path', to_jsonb(v_path), 'value', p_after), p_reason, 'studio', p_undo_of);
  return jsonb_build_object('action_id', v_id, 'key', p_key, 'path', to_jsonb(v_path), 'before', v_cur, 'after', p_after);
end $$;

-- ============================================================ settings
create or replace function public.admin_setting_set(p_actor text, p_key text, p_path text[], p_before jsonb, p_after jsonb,
  p_reason text, p_undo_of bigint default null)
returns jsonb language plpgsql set search_path = public as $$
declare v_val jsonb; v_cur jsonb; v_new jsonb; v_id bigint; v_path text[] := coalesce(p_path, '{}'); v_s text; v_ok boolean;
begin
  perform admin_write_begin(p_actor, p_reason);
  if p_after is null then raise exception using errcode = 'LP400', message = 'admin: the new value is required'; end if;
  select value into v_val from settings where key = p_key for update;
  if not found then raise exception using errcode = 'LP400', message = format('admin: no setting %s', p_key); end if;
  v_cur := v_val #> v_path;
  if v_cur is null then raise exception using errcode = 'LP400', message = format('admin: setting %s has no value at %s', p_key, array_to_string(v_path, '.')); end if;
  if v_cur is distinct from p_before then perform admin_stale(btrim(format('setting %s %s', p_key, array_to_string(v_path, '.'))), v_cur, p_before); end if;
  if jsonb_typeof(p_after) <> jsonb_typeof(v_cur) then
    raise exception using errcode = 'LP400', message = format('admin: setting %s %s must stay a %s', p_key, array_to_string(v_path, '.'), jsonb_typeof(v_cur));
  end if;
  if admin_is_member_list(p_key, v_path, v_cur) or admin_is_member_list(p_key, v_path, p_after) then
    raise exception using errcode = 'LP400', message = 'admin: a member list changes one member at a time (admin_setting_member)';
  end if;
  if jsonb_typeof(v_cur) = 'object' then   -- an object can hold a member list: change its values one at a time
    raise exception using errcode = 'LP400', message = 'admin: change one value at a time (this part is a group of values)';
  end if;
  if p_after = v_cur then raise exception using errcode = 'LP400', message = 'admin: the new value is the same as the live value'; end if;
  -- A date stays a date and a time stays a time (the feature windows: dungeon_prizes.from, launch_event_cards ...).
  if jsonb_typeof(v_cur) = 'string' then
    v_s := p_after #>> '{}';
    if (v_cur #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$' then
      v_ok := v_s ~ '^\d{4}-\d{2}-\d{2}$';
      if v_ok then begin perform v_s::date; exception when others then v_ok := false; end; end if;
      if not v_ok then raise exception using errcode = 'LP400', message = format('admin: setting %s %s must be a date (YYYY-MM-DD)', p_key, array_to_string(v_path, '.')); end if;
    elsif (v_cur #>> '{}') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}' then
      v_ok := v_s ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$';
      if v_ok then begin perform v_s::timestamptz; exception when others then v_ok := false; end; end if;
      if not v_ok then raise exception using errcode = 'LP400', message = format('admin: setting %s %s must be a time with a zone (2026-10-15T06:00:00Z)', p_key, array_to_string(v_path, '.')); end if;
    end if;
  end if;
  v_new := case when cardinality(v_path) = 0 then p_after else jsonb_set(v_val, v_path, p_after, false) end;
  update settings set value = v_new, updated_at = now() where key = p_key;
  v_id := admin_log_action(p_actor, 'setting_set', 'setting', p_key, jsonb_build_object('path', to_jsonb(v_path), 'value', v_cur),
    jsonb_build_object('path', to_jsonb(v_path), 'value', p_after), p_reason, 'studio', p_undo_of);
  return jsonb_build_object('action_id', v_id, 'key', p_key, 'path', to_jsonb(v_path), 'before', v_cur, 'after', p_after);
end $$;

create or replace function public.admin_setting_member(p_actor text, p_key text, p_path text[], p_member text, p_add boolean,
  p_reason text, p_undo_of bigint default null)
returns jsonb language plpgsql set search_path = public as $$
declare v_val jsonb; v_cur jsonb; v_list jsonb; v_id bigint; v_path text[] := coalesce(p_path, '{}'); v_in boolean;
begin
  perform admin_write_begin(p_actor, p_reason);
  if p_member is null or p_add is null then raise exception using errcode = 'LP400', message = 'admin: the member and add or remove are required'; end if;
  select value into v_val from settings where key = p_key for update;
  if not found then raise exception using errcode = 'LP400', message = format('admin: no setting %s', p_key); end if;
  v_cur := v_val #> v_path;
  if v_cur is null or not admin_is_member_list(p_key, v_path, v_cur) then
    raise exception using errcode = 'LP400', message = format('admin: setting %s %s is not a member list', p_key, array_to_string(v_path, '.'));
  end if;
  v_in := v_cur @> jsonb_build_array(p_member);
  if p_add and v_in then perform admin_stale(btrim(format('the list %s %s', p_key, array_to_string(v_path, '.'))), 'true'::jsonb, 'false'::jsonb); end if;
  if not p_add and not v_in then perform admin_stale(btrim(format('the list %s %s', p_key, array_to_string(v_path, '.'))), 'false'::jsonb, 'true'::jsonb); end if;
  if p_add and not exists (select 1 from players where id = p_member) then
    raise exception using errcode = 'LP400', message = 'admin: no member with this id';
  end if;
  v_list := case when p_add then v_cur || jsonb_build_array(p_member)
                 else coalesce((select jsonb_agg(e order by o) from jsonb_array_elements(v_cur) with ordinality x(e, o) where e <> to_jsonb(p_member)), '[]'::jsonb) end;
  update settings set value = case when cardinality(v_path) = 0 then v_list else jsonb_set(v_val, v_path, v_list, false) end, updated_at = now()
   where key = p_key;
  v_id := admin_log_action(p_actor, 'setting_member', 'setting', p_key,
    jsonb_build_object('path', to_jsonb(v_path), 'member', p_member, 'in_list', not p_add, 'count', jsonb_array_length(v_cur)),
    jsonb_build_object('path', to_jsonb(v_path), 'member', p_member, 'in_list', p_add, 'count', jsonb_array_length(v_list)), p_reason, 'studio', p_undo_of);
  return jsonb_build_object('action_id', v_id, 'key', p_key, 'path', to_jsonb(v_path), 'member', p_member, 'in_list', p_add, 'count', jsonb_array_length(v_list));
end $$;

-- ============================================================ member balances (the ledger writers)
create or replace function public.admin_member_packs(p_actor text, p_player text, p_amount integer, p_before integer,
  p_reason text, p_undo_of bigint default null)
returns jsonb language plpgsql set search_path = public as $$
declare v_bal int; v_new int; v_id bigint;
begin
  perform admin_write_begin(p_actor, p_reason);
  if p_amount is null or p_amount = 0 or abs(p_amount) > 1000 then
    raise exception using errcode = 'LP400', message = 'admin: the pack change must be a whole number from -1000 to 1000, not 0';
  end if;
  select pack_balance into v_bal from players where id = p_player for update;
  if not found then raise exception using errcode = 'LP400', message = 'admin: no member with this id'; end if;
  if v_bal is distinct from p_before then perform admin_stale('the pack balance', to_jsonb(v_bal), to_jsonb(p_before)); end if;
  if v_bal + p_amount < 0 then raise exception using errcode = 'LP400', message = format('admin: the member has %s packs; the balance cannot go below 0', v_bal); end if;
  v_id := admin_log_action(p_actor, 'member_packs', 'player', p_player, jsonb_build_object('packs', v_bal),
    jsonb_build_object('packs', v_bal + p_amount, 'amount', p_amount), p_reason, 'studio', p_undo_of);
  v_new := grant_packs(p_player, p_amount, 'admin', null, 'admin_action', v_id::text);
  if v_new is distinct from v_bal + p_amount then raise exception 'admin: grant_packs returned % (expected %)', v_new, v_bal + p_amount; end if;
  return jsonb_build_object('action_id', v_id, 'player', p_player, 'before', v_bal, 'after', v_new, 'amount', p_amount);
end $$;

create or replace function public.admin_member_shards(p_actor text, p_player text, p_amount integer, p_before integer,
  p_reason text, p_undo_of bigint default null)
returns jsonb language plpgsql set search_path = public as $$
declare v_bal int; v_new int; v_id bigint;
begin
  perform admin_write_begin(p_actor, p_reason);
  if p_amount is null or p_amount = 0 or abs(p_amount) > 1000000 then
    raise exception using errcode = 'LP400', message = 'admin: the Shards change must be a whole number from -1000000 to 1000000, not 0';
  end if;
  select shard_balance into v_bal from players where id = p_player for update;
  if not found then raise exception using errcode = 'LP400', message = 'admin: no member with this id'; end if;
  if v_bal is distinct from p_before then perform admin_stale('the Shards balance', to_jsonb(v_bal), to_jsonb(p_before)); end if;
  if v_bal + p_amount < 0 then raise exception using errcode = 'LP400', message = format('admin: the member has %s Shards; the balance cannot go below 0', v_bal); end if;
  v_id := admin_log_action(p_actor, 'member_shards', 'player', p_player, jsonb_build_object('shards', v_bal),
    jsonb_build_object('shards', v_bal + p_amount, 'amount', p_amount), p_reason, 'studio', p_undo_of);
  v_new := grant_shards(p_player, p_amount, 'admin', 'admin_action', v_id::text);
  if v_new is distinct from v_bal + p_amount then raise exception 'admin: grant_shards returned % (expected %)', v_new, v_bal + p_amount; end if;
  return jsonb_build_object('action_id', v_id, 'player', p_player, 'before', v_bal, 'after', v_new, 'amount', p_amount);
end $$;

-- p_amount > 0 gives copies, < 0 removes them. p_before = the copies the member holds now (0 = none).
-- A removal takes only free copies (free_copies: not held by a trade offer, an auction or a bid) and never the last
-- copy of a card with stars (the stars and stat points would go, and an undo could not give them back).
create or replace function public.admin_member_card(p_actor text, p_player text, p_card bigint, p_amount integer, p_before integer,
  p_reason text, p_undo_of bigint default null)
returns jsonb language plpgsql set search_path = public as $$
declare v_q int; v_asc int; v_new int; v_id bigint;
begin
  perform admin_write_begin(p_actor, p_reason);
  if p_amount is null or p_amount = 0 or abs(p_amount) > 100 then
    raise exception using errcode = 'LP400', message = 'admin: the copy change must be a whole number from -100 to 100, not 0';
  end if;
  perform 1 from players where id = p_player for update;
  if not found then raise exception using errcode = 'LP400', message = 'admin: no member with this id'; end if;
  if not exists (select 1 from cards where id = p_card) then raise exception using errcode = 'LP400', message = 'admin: no card with this id'; end if;
  select quantity, ascension into v_q, v_asc from player_cards where player_id = p_player and card_id = p_card for update;
  v_q := coalesce(v_q, 0);
  if v_q is distinct from p_before then perform admin_stale('the copies of this card', to_jsonb(v_q), to_jsonb(p_before)); end if;
  if p_amount < 0 then
    if v_q + p_amount < 0 then raise exception using errcode = 'LP400', message = format('admin: the member has %s copies of this card', v_q); end if;
    if free_copies(p_player, p_card) < -p_amount then
      raise exception using errcode = 'LP400', message = 'admin: these copies are held by a trade offer, an auction or a bid';
    end if;
    if v_q + p_amount = 0 and coalesce(v_asc, 0) > 0 then
      raise exception using errcode = 'LP400', message = 'admin: the last copy has stars; removing it would lose the stars and the stat points';
    end if;
  end if;
  v_id := admin_log_action(p_actor, 'member_card', 'player', p_player, jsonb_build_object('card', p_card, 'copies', v_q),
    jsonb_build_object('card', p_card, 'copies', v_q + p_amount, 'amount', p_amount), p_reason, 'studio', p_undo_of);
  v_new := card_move(p_player, p_card, p_amount, 'admin', 'admin_action', v_id::text, 'admin');
  if v_new is distinct from v_q + p_amount then raise exception 'admin: card_move returned % (expected %)', v_new, v_q + p_amount; end if;
  return jsonb_build_object('action_id', v_id, 'player', p_player, 'card', p_card, 'before', v_q, 'after', v_new, 'amount', p_amount);
end $$;

-- ============================================================ undo
-- Puts the before value of one Admin view action back through the same function (so the same checks and the same
-- log), with undo_of = the action. Refused when the action was undone already, when it is not an Admin view change
-- (for example a bot gift), or when the value changed again since the action (LP409 from the write function).
create or replace function public.admin_undo(p_actor text, p_action bigint, p_reason text)
returns jsonb language plpgsql set search_path = public as $$
declare a admin_actions; v_path text[]; r jsonb;
begin
  select * into a from admin_actions where id = p_action for update;
  if not found then raise exception using errcode = 'LP400', message = 'admin: no action with this id'; end if;
  if exists (select 1 from admin_actions where undo_of = p_action) then
    raise exception using errcode = 'LP409', message = 'admin: this action was undone already';
  end if;
  if a.source <> 'studio' or a.action not in ('balance_set', 'setting_set', 'setting_member', 'member_packs', 'member_shards', 'member_card') then
    raise exception using errcode = 'LP400', message = format('admin: an action %s from %s cannot be undone here', a.action, a.source);
  end if;
  v_path := array(select jsonb_array_elements_text(coalesce(a.before->'path', '[]')));
  r := case a.action
    when 'balance_set' then admin_balance_set(p_actor, a.target_id, v_path, a.after->'value', a.before->'value', p_reason, a.id)
    when 'setting_set' then admin_setting_set(p_actor, a.target_id, v_path, a.after->'value', a.before->'value', p_reason, a.id)
    when 'setting_member' then admin_setting_member(p_actor, a.target_id, v_path, a.after->>'member', not (a.after->>'in_list')::boolean, p_reason, a.id)
    when 'member_packs' then admin_member_packs(p_actor, a.target_id, -(a.after->>'amount')::int, (a.after->>'packs')::int, p_reason, a.id)
    when 'member_shards' then admin_member_shards(p_actor, a.target_id, -(a.after->>'amount')::int, (a.after->>'shards')::int, p_reason, a.id)
    when 'member_card' then admin_member_card(p_actor, a.target_id, (a.after->>'card')::bigint, -(a.after->>'amount')::int, (a.after->>'copies')::int, p_reason, a.id)
  end;
  return r || jsonb_build_object('undo_of', a.id);
end $$;

-- ============================================================ notes
comment on function public.admin_write_begin(text, text) is $c$[admin] The start of every Admin view write: refuses an empty actor (LP400) or a reason that is not 3 to 500 characters, and sets balance.by to the actor, so balance_who (balance_log, settings_log, balance.updated_by) names the admin. Service role only.$c$;
comment on function public.admin_stale(text, jsonb, jsonb) is $c$[admin] Raises SQLSTATE LP409 "admin: <what> changed (now ..., expected ...)": the optimistic check of the Admin view writes found a live value that differs from the preview. Service role only.$c$;
comment on function public.admin_is_member_list(text, text[], jsonb) is $c$[admin] True when a settings value is a member id list: the whole value of discord_immune, an array named users (ui_v3.users, achievement_tracks.users), or a non-empty array of Discord ids. Such a list changes only one member at a time (admin_setting_member). Service role only.$c$;
comment on function public.admin_check_pulls(jsonb) is $c$[admin] Refuses (LP400) a pulls balance value that the bot draw (tcg-bot/src/draw.ts pullTable) would refuse: a rate for normal, illustrated_rare, secret_rare, full_art and gold, each a number of at least 0, together 1 (within 1e-9), and pack_size a whole number from 1 to 20. admin_balance_set calls it for the key pulls. Service role only.$c$;
comment on function public.admin_balance_set(text, text, text[], jsonb, jsonb, text, bigint) is $c$[admin] The Admin view balance editor: sets public.balance[p_key] at p_path (empty = the whole value) to p_after. Refuses (LP409) when the live value at the path is not p_before, (LP400) a missing key or path, a type change, no change, and bad pull rates (admin_check_pulls); the triggers balance_check and balance_check_settings check the shape. Writes the admin_actions row balance_set (before and after: path and value) in the same transaction; balance_log records the change with the admin as changed_by. Returns the action id, before and after. Service role only.$c$;
comment on function public.admin_setting_set(text, text, text[], jsonb, jsonb, text, bigint) is $c$[admin] The Admin view settings editor: sets one value of public.settings[p_key] at p_path (a flag, a number, a text, a date or a time) to p_after. Refuses (LP409) when the live value is not p_before, (LP400) a missing key or path, a type change, a member list (use admin_setting_member), a whole group of values (an object), no change, and a date or a time that does not parse in the same format. Writes the admin_actions row setting_set in the same transaction; settings_log records the change. Service role only.$c$;
comment on function public.admin_setting_member(text, text, text[], text, boolean, text, bigint) is $c$[admin] Adds (p_add true) or removes one member in a settings member list (admin_is_member_list). Refuses (LP409) an add of a member who is in the list and a remove of a member who is not (the list changed since the preview), (LP400) an add of an unknown member. Writes the admin_actions row setting_member (before and after: path, member, in_list, count) in the same transaction. Service role only.$c$;
comment on function public.admin_member_packs(text, text, integer, integer, text, bigint) is $c$[admin] Grants (p_amount > 0) or takes back packs of one member through grant_packs with reason admin and the ref ('admin_action', admin_actions.id). Refuses (LP409) when the pack balance is not p_before, (LP400) an amount of 0 or beyond 1000 either way, an unknown member, a balance below 0. Writes the admin_actions row member_packs first (its id is the ledger ref), in the same transaction. Service role only.$c$;
comment on function public.admin_member_shards(text, text, integer, integer, text, bigint) is $c$[admin] Grants (p_amount > 0) or takes back Shards of one member through grant_shards with reason admin and the ref ('admin_action', admin_actions.id). Refuses (LP409) when the Shards balance is not p_before, (LP400) an amount of 0 or beyond 1000000 either way, an unknown member, a balance below 0. Writes the admin_actions row member_shards first, in the same transaction. Service role only.$c$;
comment on function public.admin_member_card(text, text, bigint, integer, integer, text, bigint) is $c$[admin] Gives (p_amount > 0) or removes copies of one card of one member through card_move with reason admin, the ref ('admin_action', admin_actions.id) and first_source admin. Refuses (LP409) when the member's copies are not p_before, (LP400) an amount of 0 or beyond 100 either way, an unknown member or card, more copies than the member has, copies held by a trade offer, an auction or a bid (free_copies), and the last copy of a card with stars. Writes the admin_actions row member_card first, in the same transaction. Service role only.$c$;
comment on function public.admin_undo(text, bigint, text) is $c$[admin] Undoes one Admin view action (balance_set, setting_set, setting_member, member_packs, member_shards, member_card from the studio): calls the same write function with the stored after value as the before value and the stored before value as the new value, undo_of = the action. Refuses (LP409) a second undo and a value that changed again since the action, (LP400) an unknown action and an action of another kind or source (for example a bot gift). Service role only.$c$;

-- ============================================================ only the service role
do $g$
declare f text;
begin
  foreach f in array array[
    'public.admin_write_begin(text,text)', 'public.admin_stale(text,jsonb,jsonb)', 'public.admin_is_member_list(text,text[],jsonb)',
    'public.admin_check_pulls(jsonb)', 'public.admin_balance_set(text,text,text[],jsonb,jsonb,text,bigint)',
    'public.admin_setting_set(text,text,text[],jsonb,jsonb,text,bigint)', 'public.admin_setting_member(text,text,text[],text,boolean,text,bigint)',
    'public.admin_member_packs(text,text,integer,integer,text,bigint)', 'public.admin_member_shards(text,text,integer,integer,text,bigint)',
    'public.admin_member_card(text,text,bigint,integer,integer,text,bigint)', 'public.admin_undo(text,bigint,text)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $g$;

notify pgrst, 'reload schema';
