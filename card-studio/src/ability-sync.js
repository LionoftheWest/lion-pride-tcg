// Write one card ability to its live subject (F-3 4a: the database refuses an ability that does not fit its kind, see
// tcg-bot/supabase/f3_ability_kinds.sql). Returns { refused: <the database message> } when the database refused it, so that
// the studio can show the reason to the owner. A failure with no database code (the network is down, the project sleeps) stays
// best-effort, as before: it does not refuse, because the card file is the source of truth and push-abilities.mjs syncs it later.
export async function syncAbilityLive(supabase, key, ability) {
  try {
    const { data: subject } = await supabase.from('subjects').select('id').eq('key', key).maybeSingle();
    if (!subject) return { refused: null, synced: false };
    const { error } = await supabase.from('subjects').update({ ability }).eq('id', subject.id);
    if (error && error.code) return { refused: error.message || 'the database refused the ability', synced: false };
    return { refused: null, synced: !error };
  } catch {
    return { refused: null, synced: false };
  }
}
