// The live text of functions BEFORE game_vars_all.sql (F-1 PR 6): the file's new text with its edits put back
// (test-game-vars-all.edits.json, the edits that made the file from the live text). Older migration files guard these
// functions with the md5 of that text. Their tests put it in place first, inside the rolled-back block, so the old file
// runs as it did (the same fix as the ach_track_values text in test-pack-ledger-strict.mjs).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function beforeGameVarsAll(names) {
  const mig = readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/game_vars_all.sql', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
  const edits = JSON.parse(readFileSync(fileURLToPath(new URL('./test-game-vars-all.edits.json', import.meta.url)), 'utf8'));
  return names.map((name) => {
    const s = mig.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    if (s < 0 || !edits[name]) throw new Error(`f1-live-before: no ${name} in game_vars_all.sql`);
    let txt = mig.slice(s, mig.indexOf('$function$;', s) + 11);
    for (const [a, b] of edits[name]) { if (!txt.includes(b)) throw new Error(`f1-live-before: ${name}: an edit is not in the file`); txt = txt.replace(b, a); }
    return txt;
  }).join('\n\n');
}
