// Shared SQL snippets for the rolled-back SQL tests (scripts/test-*.mjs). Each one goes INSIDE the test's
// DO block, so it rolls back with it.

// The unlock gate (adventure_gate.sql, PR #147): a member may lock a squad or fight only with no open starter
// gift and at least 8 owned attackers (Character / Creature). This gives the test member 8 more Normal
// attackers it does not own yet. Call it AFTER the test's own player_cards rows. The extra cards are owned
// only: they never fight, because the test names every card it plays.
export const GATE = (player) => `-- the unlock gate (adventure_gate.sql): 8 more owned attackers
  insert into player_cards (player_id, card_id, quantity)
    select '${player}', c.id, 1 from cards c join subjects s on s.id = c.subject_id
     where s.type in ('Character', 'Creature') and c.rarity = 'normal'
       and not exists (select 1 from player_cards x where x.player_id = '${player}' and x.card_id = c.id)
     order by c.id limit 8;
  if not (adventure_gate('${player}')->>'ok')::boolean then raise exception 'fixture: the gate is still closed: %', adventure_gate('${player}'); end if;`;

// A mutation for the mutation proof: replace one text in the CURRENT definition of a function, inside the
// rolled-back block. It stops with "MUTATION ... does not match" when the text is not there (a stale mutation
// must not pass as a "caught" one). Usage: MUTATE=<name> node scripts/test-x.mjs, with
// MUTATIONS = { name: ['public.fn(argtypes)', 'old text', 'new text'] }.
export const mutation = (MUTATIONS) => {
  const name = process.env.MUTATE;
  if (!name) return '';
  const m = MUTATIONS[name];
  if (!m) throw new Error(`unknown mutation ${name}; known: ${Object.keys(MUTATIONS).join(' ')}`);
  for (const s of m) if (s.includes('$mq$')) throw new Error('a mutation contains $mq$');
  console.log(`MUTATE=${name}: ${m[0]}`);
  return `declare mut_src text; begin
    mut_src := replace(pg_get_functiondef('${m[0]}'::regprocedure), chr(13), '');
    if position($mq$${m[1]}$mq$ in mut_src) = 0 then raise exception 'MUTATION ${name} does not match'; end if;
    execute replace(mut_src, $mq$${m[1]}$mq$, $mq$${m[2]}$mq$);
  end;`;
};

// An OLD migration file inside a test block can put back a pack writer from before pack_ledger_ref_check
// (card_decisions.sql: every pack_ledger row has ref_kind + ref_id), for example claim_daily of dailies.sql calls
// grant_packs with no ref, and the check refuses that row. KEEP_LIVE runs the old file (sql) and then runs the
// CURRENT text of the named functions again (saved before the file ran), so the pack moves use today's writer.
// The rest of the old file stays applied. Goes inside the test's DO block (it is a nested block).
export const KEEP_LIVE = (names, sql) => {
  if (sql.includes('$m$') || sql.includes('$kl$')) throw new Error('KEEP_LIVE: the file must not contain $m$ or $kl$');
  return `declare kl_live text[]; kl_src text; begin
    kl_live := array(select pg_get_functiondef(p.oid) from pg_proc p
                      where p.pronamespace = 'public'::regnamespace and p.proname = any (array[${names.map((n) => `'${n}'`).join(', ')}]));
    if cardinality(kl_live) < ${names.length} then raise exception 'KEEP_LIVE: a function is missing: %', $kl$${names.join(' ')}$kl$; end if;
    execute $m$${sql}$m$;
    foreach kl_src in array kl_live loop execute kl_src; end loop;   -- the current pack writers (pack_ledger_ref_check)
  end;`;
};

// For a test whose subject IS an old file's pack writer, and whose rules a later file changed on purpose (so the
// current writer fails the old acceptance cases): run the old file and remove pack_ledger_ref_check inside the
// rolled-back block. The reason: that writer is no longer live, and the test checks its rules, not the ref rule.
// The ref rule has its own tests (test-card-decisions.mjs, test-pack-ledger-strict.mjs).
export const PRE_REF_FILE = (sql) => {
  if (sql.includes('$m$')) throw new Error('PRE_REF_FILE: the file must not contain $m$');
  return `execute $m$${sql}$m$;
  alter table pack_ledger drop constraint if exists pack_ledger_ref_check;   -- a pre-ref writer (fixtures.mjs PRE_REF_FILE)`;
};
