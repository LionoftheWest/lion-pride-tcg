// The live text of functions BEFORE f3_one_power_number.sql (F-3 one power number): f3-power-before.sql. Older migration files guard these
// functions with the md5 of that text. Their tests put it in place first, inside the rolled-back block, so the old file runs as it did
// (the same fix as f1-live-before.mjs for game_vars_all.sql).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function beforeOnePowerNumber(names) {
  const all = readFileSync(fileURLToPath(new URL('./f3-power-before.sql', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
  return names.map((name) => {
    const s = all.indexOf(`-- @fn ${name}\n`);
    if (s < 0) throw new Error(`f3-power-before: no ${name}`);
    const from = all.indexOf('CREATE OR REPLACE FUNCTION', s);
    return all.slice(from, all.indexOf('$function$;', from) + 11);
  }).join('\n\n');
}
