-- combat_v2_min_share.sql (2026-10-20): combat v2, phase 3: the minimum share of a condition. Nathan approved it on 2026-10-20 (question 1 of the
-- PR T1b, docs/combat-redesign-plan.md section 19.5). Needs combat_v2_ability_prices.sql (T1b) first.
--   The validator ability_v2_check refuses a condition whose MEASURED share is below ability_v2.limits.min_share (0.01, a balance number). Such a
--   block costs almost 0 PP (its host x the share) and almost never works. The conditions with a measured share (balance ability_v2.share, measured by
--   card-studio/v2sim/run.mjs shares): the gates self_has (share.self_has_each.<status>), enemy_charging, foes_alive, self_shield, and the trigger
--   on_kill (share.on_kill). Today this refuses self_has on Stunned, Frozen, Asleep, Paralyzed, Confused (0), Focused (0.004), Burn (0.006),
--   Blinded (0.008) and Exposed (0.009). The assumed reference shares of v2_pp.ref (payoff, frozen_share) are not measured: no change for them.
--   The simulator has the same rule (card-studio/v2sim/cards.mjs minShareErrors).
-- REPLACED: ability_v2_spec (the T1b shape + limits.min_share) and ability_v2_check (the T1 validator + the rule; it raises when balance has no
--   limits.min_share: it never accepts by a missing number). It adds no function.
-- NO CHANGE IN PLAY: no fight reads ability_v2_check, the flag combat_v2 stays OFF, and no other function changes (the test compares the md5 of every
-- other public function). Idempotent (the balance change runs only while limits has no min_share).
-- Server only. Test: card-studio/scripts/test-combat-v2-min-share.mjs (rolled back; SQL = the simulator; MUTATE=all must catch every mutation).

-- ============================================================ 1. balance ability_v2: + limits.min_share
-- @balance-begin
create or replace function public.ability_v2_spec() returns jsonb language sql immutable set search_path = public as $fn$
  select '{"pp": {"att_k": "num 1 200", "sup_cycle": "num 0.5 10", "sup_vs_k": "num 0 20", "vs_smite": "num 0 2", "line_status": "num 0 5", "quicken_all_x": "num 1 5"},
           "silver": {"stars": "int 1 5", "pp": "num 0 10"},
           "limits": {"blocks": "int 1 8", "riders": "int 0 4", "words_min": "int 1 40", "words_max": "int 1 60", "min_share": "num 0 0.2"},
           "k1_shield": "num 0 1",
           "share": {"on_kill": "num 0 1", "enemy_charging": "num 0 1", "foes_alive": "num 0 1", "self_shield": "num 0 1", "self_has": "num 0 1",
                     "self_has_each": {"empowered": "num 0 1", "focused": "num 0 1", "quickened": "num 0 1", "poison": "num 0 1", "burn": "num 0 1", "chill": "num 0 1",
                                  "weakened": "num 0 1", "stunned": "num 0 1", "slowed": "num 0 1", "blinded": "num 0 1", "confused": "num 0 1", "frozen": "num 0 1",
                                  "sleep": "num 0 1", "paralyzed": "num 0 1", "exposed": "num 0 1"},
                     "area_payoff": "num 0 1"},
           "ref": {"per_ally": "num 0 10", "list_extra": "num 0 1"}}'::jsonb;
$fn$;

select set_config('balance.by', 'nathan', true);
update public.balance set value = jsonb_set(value, '{limits,min_share}', '0.01'),
  note = note || $n$ Minimum share (Nathan 2026-10-20, approved after PR T1b; combat_v2_min_share.sql): limits.min_share = the validator refuses a condition whose measured share (share.self_has_each.<status> of a self_has, share.enemy_charging, share.foes_alive, share.self_shield, share.on_kill) is below this number: such a block costs almost 0 PP and almost never works. The limits 0 to 0.2: 0 turns the rule off. Two leaves are retired but kept (no function reads them; a balance leaf is never removed until the balance guard can retire one): pp.sup_vs_k (since T1b: pp.vs_smite) and share.self_has (since T1b: share.self_has_each).$n$
 where key = 'ability_v2' and not value->'limits' ? 'min_share';
-- @balance-end

-- ============================================================ 2. the validator (replaced from T1): + the minimum share
create or replace function public.ability_v2_check(p_role text, p_ability jsonb, p_b jsonb default null) returns jsonb
language plpgsql stable set search_path = public as $fn$
declare
  b jsonb := coalesce(p_b, ability_v2_numbers()); bl jsonb := b->'blocks'; st jsonb := b->'statuses'; pp jsonb := b->'v2_pp'; lim jsonb := b->'ability_v2'->'limits';
  errs text[] := '{}'; cls text; blocks jsonb; blk jsonb; k text; row jsonb; f text; fs jsonb; e text; i int; n int; at text;
  total numeric; spp numeric; sb jsonb; sv jsonb; si int; sf text; txt jsonb; stxt text; riders int := 0; srow jsonb; pps jsonb; hk text; host jsonb;
  budget numeric := (pp->>'budget')::numeric; tol numeric := (pp->>'tolerance')::numeric; sil jsonb := b->'ability_v2'->'silver';
  sh numeric; ms numeric := (lim->>'min_share')::numeric; low text[] := '{}';
begin
  if ms is null then raise exception 'ability_v2_check: balance ability_v2 has no limits.min_share'; end if;
  select r.class into cls from public.roles r where r.key = p_role;
  if cls is null then return jsonb_build_object('ok', false, 'errors', jsonb_build_array(format('unknown role %s', coalesce(p_role, '(none)')))); end if;
  if jsonb_typeof(p_ability) is distinct from 'object' then return jsonb_build_object('ok', false, 'role', p_role, 'class', cls, 'errors', jsonb_build_array('an ability is an object {name, blocks, silver}')); end if;
  for f in select jsonb_object_keys(p_ability) loop
    if f not in ('name', 'blocks', 'silver') then errs := errs || format('the ability has the unknown key %s', f); end if;
  end loop;
  if jsonb_typeof(p_ability->'name') is distinct from 'string' or btrim(p_ability->>'name') = '' then errs := errs || 'the ability needs a name'::text; end if;
  blocks := p_ability->'blocks';
  if jsonb_typeof(blocks) is distinct from 'array' or jsonb_array_length(blocks) < 1 or jsonb_array_length(blocks) > (lim->>'blocks')::int then
    errs := errs || format('blocks must be a list of 1 to %s blocks', lim->>'blocks');
    return jsonb_build_object('ok', false, 'role', p_role, 'class', cls, 'errors', to_jsonb(errs));
  end if;
  n := jsonb_array_length(blocks);
  -- each block: built, fits the class, its fields
  for i in 0 .. n - 1 loop
    blk := blocks->i; at := format('block %s', i + 1);
    if jsonb_typeof(blk) is distinct from 'object' or jsonb_typeof(blk->'k') is distinct from 'string' then errs := errs || format('%s must be an object with k', at); continue; end if;
    k := blk->>'k'; row := bl->k; at := format('block %s (%s)', i + 1, k);
    if row is null then errs := errs || format('%s: unknown block', at); continue; end if;
    if row->>'reserved' is not null then errs := errs || format('%s: reserved, %s', at, row->>'reserved'); continue; end if;
    if not row->'classes' ? cls then errs := errs || format('%s: not a block of a %s (role %s)', at, cls, p_role); continue; end if;
    for f in select jsonb_object_keys(blk) loop
      if f <> 'k' and not row->'fields' ? f then errs := errs || format('%s: unknown field %s', at, f); end if;
    end loop;
    for f, fs in select key, value from jsonb_each(row->'fields') loop
      if not blk ? f then
        if (fs->>'required')::boolean then errs := errs || format('%s: needs %s', at, f); end if;
        continue;
      end if;
      e := ability_v2_field_error(fs->>'type', blk->f, st);
      if e is not null then errs := errs || format('%s: %s %s', at, f, e); end if;
    end loop;
    -- a block with status or statuses (payoffs, vs_status, target_has): exactly one of the two
    if row->'fields' ? 'statuses' and (blk ? 'status') = (blk ? 'statuses') then errs := errs || format('%s: needs status or statuses (one of the two)', at); end if;
    -- a status block: stacks only for a status with stacks, a value exactly for a status with a value (Exposed, Weakened, Mark)
    if k in ('apply', 'on_crit', 'on_kill') and st->(blk->>'status') is not null then
      srow := st->(blk->>'status');
      if blk ? 'stacks' and srow->>'stacking' not in ('add', 'add_decay') then errs := errs || format('%s: %s has no stacks', at, blk->>'status'); end if;
      if srow->>'stacking' in ('add_cap', 'higher') and not blk ? 'value' then errs := errs || format('%s: %s needs a value', at, blk->>'status'); end if;
      if blk ? 'value' and srow->>'stacking' not in ('add_cap', 'higher') then errs := errs || format('%s: %s has no value', at, blk->>'status'); end if;
      if k = 'apply' and cls = 'attacker' and coalesce((blk->>'all')::boolean, false) and not exists (select 1 from jsonb_array_elements(blocks) x where x->>'k' = 'area') then
        errs := errs || format('%s: all (each area hit) needs an area block', at);
      end if;
      if k = 'apply' and cls = 'support' and blk ? 'all' then errs := errs || format('%s: all is for an attacker area rider', at); end if;
      if k = 'apply' and blk ? 'per' and (cls <> 'support' or not blk ? 'value') then errs := errs || format('%s: per is for a support status with a value (Expose, Weaken, Mark)', at); end if;
      if cls = 'attacker' or (blk->>'chance')::numeric < 1 then riders := riders + 1; end if;
    end if;
    if k = 'random_apply' then riders := riders + 1; end if;
    -- a support payoff or crit chance shapes its smite
    if cls = 'support' and k in ('payoff_dmg', 'crit_add') and not exists (select 1 from jsonb_array_elements(blocks) x where x->>'k' = 'smite') then
      errs := errs || format('%s: a support %s needs a smite block (it shapes the smite)', at, k);
    end if;
    -- an attachment: after its host, one for each host
    if row->>'attach' is not null then
      host := case when i > 0 then blocks->(i - 1) end; hk := host->>'k';
      if host is null then errs := errs || format('%s: needs a block before it (its host)', at);
      elsif bl->hk->>'attach' is not null then errs := errs || format('%s: one attachment for each block (block %s is one)', at, i);
      elsif not row->'hosts' ? hk then errs := errs || format('%s: cannot follow a %s block (it follows %s)', at, hk, array_to_string(array(select jsonb_array_elements_text(row->'hosts')), ', '));
      elsif k in ('target_has', 'more_per', 'coin') and hk = 'apply' and not host ? 'value' then errs := errs || format('%s: the apply before it needs a value (Expose, Weaken, Mark)', at);
      elsif k in ('more_per', 'coin') and host ? 'per' then errs := errs || format('%s: the apply before it has per already', at);
      elsif row->>'attach' = 'gate' and hk in ('payoff_dmg', 'payoff_crit')
            and exists (select 1 from jsonb_array_elements(blocks) x where x->>'k' in ('payoff_dmg', 'payoff_crit') and x->>'k' <> hk
                          and coalesce(x->>'status', (x->'statuses')::text) = coalesce(host->>'status', (host->'statuses')::text)) then
        errs := errs || format('%s: a gate cannot follow a payoff that shares its sentence with another payoff', at);
      end if;
    end if;
    if (row->>'once')::boolean and (select count(*) from jsonb_array_elements(blocks) x where x->>'k' = k) > 1 then
      errs := errs || format('%s: at most one %s block', at, k);
    end if;
    -- the minimum share (Nathan 2026-10-20): a condition with a measured share (a gate: self_has with the share of its status, enemy_charging,
    -- foes_alive, self_shield; the trigger on_kill) below limits.min_share is refused: it costs almost 0 PP and almost never works. These errors come
    -- last, so every other answer (pp, pps, text, Silver) stays as without the rule
    sh := case when k = 'self_has' then (b->'ability_v2'->'share'->'self_has_each'->>(blk->>'status'))::numeric
               when row->>'attach' = 'gate' or k = 'on_kill' then (b->'ability_v2'->'share'->>k)::numeric end;
    if sh < ms then
      low := low || format('%s: the condition is true at only %s of the actives (the measured share), below the minimum %s (limits.min_share): it costs almost 0 PP and almost never works',
                             case when k = 'self_has' then format('block %s (self_has %s)', i + 1, blk->>'status') else at end, sh, ms);
    end if;
  end loop;
  if cardinality(errs) = 0 then
    -- the rules that join blocks
    if (select count(*) from jsonb_array_elements(blocks) x where x->>'k' in ('apply', 'payoff_dmg', 'payoff_crit', 'per_stack')
          group by x->>'k', coalesce(x->>'status', (x->'statuses')::text) order by 1 desc limit 1) > 1 then
      errs := errs || 'one block of a kind for each status (two blocks of one kind name the same status)'::text;
    end if;
    if cls = 'attacker' and (select count(*) from jsonb_array_elements(blocks) x where x->>'k' in ('hit', 'strikes')) <> 1 then
      errs := errs || 'an attacker active has ONE main hit: one hit or one strikes block'::text;
    end if;
    if cls = 'support' and exists (select 1 from jsonb_array_elements(blocks) x where x->>'k' in ('area', 'vs_status'))
       and not exists (select 1 from jsonb_array_elements(blocks) x where x->>'k' = 'smite') then
      errs := errs || 'a support area or vs_status block needs a smite block (it shapes the smite)'::text;
    end if;
    if exists (select 1 from jsonb_array_elements(blocks) x where x->>'k' = 'line_status') and not exists (select 1 from jsonb_array_elements(blocks) x where x->>'k' = 'execute') then
      errs := errs || 'a line_status block needs an execute block'::text;
    end if;
    for i in 0 .. n - 1 loop
      if blocks->i->>'k' = 'shield' and blocks->i->>'to' = 'cured'
         and not exists (select 1 from jsonb_array_elements(blocks) with ordinality x(v, o) where x.o - 1 < i and x.v->>'k' = 'cure') then
        errs := errs || format('block %s (shield): to cured needs a cure block before it', i + 1);
      end if;
    end loop;
    if riders > (lim->>'riders')::int then errs := errs || format('%s riders: at most %s (plan 5.3)', riders, lim->>'riders'); end if;
  end if;
  if cardinality(errs) = 0 then
    pps := ability_v2_pps(cls, blocks, b);
    total := (select sum(x::numeric) from jsonb_array_elements_text(pps) x);
    if abs(total - budget) > tol then errs := errs || format('the blocks cost %s PP: the budget is %s +/- %s', round(total, 2), budget, tol); end if;
    txt := ability_v2_text(cls, blocks, b);
    if (txt->>'words')::int < (lim->>'words_min')::int or (txt->>'words')::int > (lim->>'words_max')::int then
      errs := errs || format('the card text has %s words: %s to %s', txt->>'words', lim->>'words_min', lim->>'words_max');
    end if;
    -- the Silver upgrade (plan 5.3): type 1, a stronger number on the amount of ONE block, + silver.pp PP
    sv := p_ability->'silver';
    if sv is not null and jsonb_typeof(sv) <> 'null' then
      if jsonb_typeof(sv) <> 'object' or exists (select 1 from jsonb_object_keys(sv) y where y not in ('block', 'field', 'value')) then
        errs := errs || 'silver is {block, field, value}: a Silver that adds a block (type 3) waits for the guardian price factor (plan 5.3)'::text;
      elsif jsonb_typeof(sv->'block') is distinct from 'number' or (sv->>'block')::numeric % 1 <> 0 or (sv->>'block')::int < 1 or (sv->>'block')::int > n then
        errs := errs || 'silver.block is the number of a block (1 = the first)'::text;
      else
        si := (sv->>'block')::int - 1; sf := sv->>'field'; k := blocks->si->>'k';
        if sf = 'chance' then errs := errs || 'silver: more rider chance (type 2) is cut (plan 5.3)'::text;
        elsif sf = 'stacks' then errs := errs || 'silver: one more stack (type 4) waits for the guardian price factor (plan 5.3)'::text;
        elsif sf is distinct from bl->k->>'amount' then errs := errs || format('silver: only the amount %s of block %s (%s) can grow (type 1, a stronger number)', coalesce(bl->k->>'amount', '(none)'), si + 1, k);
        elsif jsonb_typeof(sv->'value') is distinct from 'number' or (sv->>'value')::numeric <= (blocks->si->>sf)::numeric then
          errs := errs || 'silver.value must be a number above the base value (a stronger number)'::text;
        else
          e := ability_v2_field_error(bl->k->'fields'->sf->>'type', sv->'value', st);
          if e is not null then errs := errs || format('silver.value %s', e); end if;
          sb := jsonb_set(blocks, array[si::text, sf], sv->'value');
          spp := ability_v2_pp(cls, sb, b);
          if abs(spp - budget - (sil->>'pp')::numeric) > tol then
            errs := errs || format('the Silver blocks cost %s PP: the Silver budget is %s +/- %s', round(spp, 2), budget + (sil->>'pp')::numeric, tol);
          end if;
          stxt := ability_v2_silver_text(cls, blocks, sv, b);
        end if;
      end if;
    end if;
  end if;
  errs := errs || low;
  return jsonb_build_object('ok', cardinality(errs) = 0, 'errors', to_jsonb(errs), 'role', p_role, 'class', cls, 'pp', total, 'pps', pps, 'silver_pp', spp,
    'text', txt->'text', 'words', txt->'words', 'forms', txt->'forms', 'silver_text', stxt,
    'enables', coalesce((select jsonb_agg(distinct y) from (
                 select x->>'status' y from jsonb_array_elements(case when jsonb_typeof(blocks) = 'array' then blocks else '[]'::jsonb end) x
                  where x->>'k' in ('apply', 'on_crit', 'on_kill') and x ? 'status'
                 union all select o->>'status' from jsonb_array_elements(case when jsonb_typeof(blocks) = 'array' then blocks else '[]'::jsonb end) x,
                   jsonb_array_elements(case when jsonb_typeof(x->'options') = 'array' then x->'options' else '[]'::jsonb end) o where x->>'k' = 'random_apply') z where y is not null), '[]'::jsonb),
    'pays', coalesce((select jsonb_agg(distinct y) from (
                 select x->>'status' y from jsonb_array_elements(case when jsonb_typeof(blocks) = 'array' then blocks else '[]'::jsonb end) x
                  where x->>'k' in ('payoff_dmg', 'payoff_crit', 'vs_status', 'per_stack', 'target_has', 'more_per') and x ? 'status'
                 union all select x->>'per' from jsonb_array_elements(case when jsonb_typeof(blocks) = 'array' then blocks else '[]'::jsonb end) x
                  where x->>'k' = 'apply' and x ? 'per' and x->>'per' <> 'kinds'
                 union all select jsonb_array_elements_text(x->'statuses') from jsonb_array_elements(case when jsonb_typeof(blocks) = 'array' then blocks else '[]'::jsonb end) x
                  where x->>'k' in ('line_status', 'payoff_dmg', 'payoff_crit', 'vs_status', 'target_has') and jsonb_typeof(x->'statuses') = 'array') z where y is not null), '[]'::jsonb));
end $fn$;

-- ============================================================ 3. server only, and the comments of the generated docs
do $g$
declare f text;
begin
  foreach f in array array['ability_v2_spec()', 'ability_v2_check(text, jsonb, jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $g$;

comment on function public.ability_v2_spec() is $cm$[combat] The fixed shape with the limits of the balance key ability_v2 (pp att_k, sup_cycle, sup_vs_k (retired but kept: not read since T1b), vs_smite, line_status, quicken_all_x; silver stars, pp; limits blocks, riders, words_min, words_max, min_share; k1_shield; share on_kill, enemy_charging, foes_alive, self_shield, self_has (retired but kept: not read since T1b), self_has_each (one share for each card status), area_payoff; ref per_ally, list_extra). combat_v2_abilities.sql, share and ref: combat_v2_ability_builder.sql, vs_smite, self_has_each, area_payoff, list_extra: combat_v2_ability_prices.sql, min_share: combat_v2_min_share.sql.$cm$;
comment on function public.ability_v2_check(text, jsonb, jsonb) is $cm$[combat] Combat v2 THE ABILITY VALIDATOR (plan 5.4): checks an active {name, blocks, silver} for a role: every block built (not reserved) and of the class, fields and statuses (status or statuses, one of the two), once, a condition with a measured share (self_has with share.self_has_each of its status, enemy_charging, foes_alive, self_shield, on_kill) at or above limits.min_share, one main hit for an attacker, smite for a support area / vs_status / payoff_dmg / crit_add, execute for line_status, cure before a shield to the cured ally, an attachment right after a host of its hosts list (one each), apply per on a support value status, at most limits.riders riders (apply, on_crit, on_kill, random_apply), PP = budget +/- tolerance, Silver = type 1 on the amount of one block at budget + silver.pp, the card text words_min to words_max words. Answer {ok, errors, role, class, pp, pps, silver_pp, text, words, forms, silver_text, enables, pays}. Raises when balance ability_v2 has no limits.min_share. Reads only. combat_v2_ability_builder.sql, the minimum share: combat_v2_min_share.sql.$cm$;

notify pgrst, 'reload schema';
