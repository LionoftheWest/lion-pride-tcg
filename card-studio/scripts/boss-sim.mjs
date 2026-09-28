/**
 * Monte-Carlo for the Pride Hunt boss (2026-09-28, Nathan: "much heavier hitting, more
 * skills, passives that stack"). It mirrors hunt_attack (tcg-bot/supabase/
 * hunt_boss_difficulty.sql): the player damage formula is the live one; the boss turn,
 * phases and passives are the new ones. One "day" = the player's 8 attackers, each
 * attacking until the boss downs it (a stunned card waits one round when another card
 * can attack). A week = 5 daily resets (Thu 21:00 -> Mon 23:00 UTC).
 *
 *   node scripts/boss-sim.mjs            # the default deck = Nathan's top 8 (2026-09-28)
 *   node scripts/boss-sim.mjs 9,10,9     # HP multipliers per tier (the chosen values)
 */
const DECK = (process.env.DECK || '140,132,75,40,40,38,21,20').split(',').map(Number);         // cp of the top 8 attackers
const DP = DECK.reduce((a, b) => a + b, 0);                   // deployable_power()
const MULT = (process.argv[2] || '9,10,9').split(',').map(Number);
const TIERS = { Normal: { hp: MULT[0], lethal: 1.0, passives: 1 }, Heroic: { hp: MULT[1], lethal: 1.25, passives: 2 }, Mythic: { hp: MULT[2], lethal: 1.6, passives: 3 } };
const PASSIVES = ['armored', 'shrouded', 'flaming', 'volatile', 'regenerating', 'thorns', 'frenzied'];
export const B = {                                            // the boss numbers (keep in sync with the SQL)
  strike: JSON.parse(process.env.STRIKE || '[0.18,0.28]'), slam: JSON.parse(process.env.SLAM || '[0.06,0.10]'),
  drain: JSON.parse(process.env.DRAIN || '[0.15,0.22]'), drainHeal: 0.015, stunHit: 0.10,
  cataclysm: JSON.parse(process.env.CATA || '[0.15,0.20]'), regen: 0.03, regenLow: 0.05, enrage: 1.4, curse: 0.7,
  phase50: 1.3, regenPassive: 0.005, thorns: 0.10, frenzied: 0.05,
  // the roll (after the cataclysm cycle): cumulative
  roll: [['strike', 0.40], ['slam', 0.62], ['drain', 0.72], ['stun', 0.80], ['enrage', 0.87], ['curse', 0.93], ['regenerate', 1]],
};
const U = (a, b) => a + Math.random() * (b - a);
// Flat boss ATK (hunt_boss_attack.sql): damage = ATK x move x 0.85-1.15 x the multipliers.
// PCT=1 runs the old model (a percentage of the card's own HP x the tier "lethal").
const FLAT = !process.env.PCT;
const ATK = JSON.parse(process.env.ATK || '{"Normal":58,"Heroic":73,"Mythic":93}');
const COEF = { strike: 1.0, drain: 0.8, cataclysm: 0.75, stun: 0.45, slam: 0.35, burn: 0.4 };
const maxHp = (cp) => Math.max(30, Math.round(cp * 1.8));
const pick = (n) => (process.env.PASSIVES ? process.env.PASSIVES.split(',') : [...PASSIVES].sort(() => Math.random() - 0.5).slice(0, n));
const DMG = Number(process.env.DMG || 1); // calibration: real damage per attack / simulated

function fightDay(boss, deck) {
  const cards = deck.map((cp) => ({ cp, hp: maxHp(cp), max: maxHp(cp), stun: -1, debuff: 1 }));
  let round = 0, dealt = 0, healed = 0, enrUntil = -1;
  const has = (p) => boss.passives.includes(p);
  while (boss.hp > 0) {
    const alive = cards.filter((c) => c.hp > 0);
    if (!alive.length) break;
    round += 1;
    const ready = alive.filter((c) => c.stun < round);
    const card = ready[0] || alive[0];
    // The player's hit (the live formula; wmult ~1.1 average, squad synergy ~1.08).
    let dmg = 0;
    if (Math.random() >= 0.08 + (has('shrouded') ? 0.10 : 0)) {
      const crit = Math.random() < 0.12, block = !crit && Math.random() < 0.12;
      dmg = card.cp * 1.1 * U(0.85, 1.15) * 1.08 * card.debuff * DMG;
      if (has('armored') && Math.random() < 0.5) dmg *= 0.72;           // half the deck is melee
      if (crit) dmg *= 2; if (block) dmg *= 0.5;
      dmg = Math.max(1, Math.round(dmg));
    }
    boss.hp -= dmg; dealt += dmg;
    if (boss.hp <= 0) break;
    if (has('thorns') && dmg > 0) card.hp -= Math.round(dmg * B.thorns);
    // The boss turn.
    const lost = 1 - boss.hp / boss.max;
    let mult = (FLAT ? 1 : boss.lethal) * (round <= enrUntil ? B.enrage : 1) * (has('volatile') ? 1.25 : 1)
      * (lost >= 0.5 ? B.phase50 : 1) * (has('frenzied') ? 1 + B.frenzied * Math.floor(lost * 10) : 1);
    const hit = (c, r, move) => { c.hp -= Math.max(1, Math.round(FLAT ? boss.atk * COEF[move] * U(0.85, 1.15) * mult : c.max * U(r[0], r[1]) * mult)); };
    let act;
    const EVERY = Number(process.env.CATA_EVERY || 8);
    if (EVERY && round % EVERY === EVERY - 1) act = 'charging';
    else if (EVERY && round % EVERY === 0) act = 'cataclysm';
    else { const r = Math.random(); act = B.roll.find(([, p]) => r < p)[0]; }
    if (act === 'strike') hit(card, B.strike, 'strike');
    else if (act === 'slam') for (const c of alive) hit(c, B.slam, 'slam');
    else if (act === 'cataclysm') for (const c of alive) hit(c, B.cataclysm, 'cataclysm');
    else if (act === 'drain') { hit(card, B.drain, 'drain'); const h = Math.round(boss.share * B.drainHeal); boss.hp = Math.min(boss.max, boss.hp + h); healed += h; }
    else if (act === 'stun') { if (FLAT) hit(card, null, 'stun'); else card.hp -= Math.round(card.max * B.stunHit * mult); card.stun = round + 1; }
    else if (act === 'enrage') enrUntil = round + 2;
    else if (act === 'curse') card.debuff = B.curse;
    else if (act === 'regenerate') { const h = Math.round(boss.share * (lost >= 0.5 ? B.regenLow : B.regen)); boss.hp = Math.min(boss.max, boss.hp + h); healed += h; }
    if (has('flaming') && Math.random() < 0.30) card.hp -= Math.round(FLAT ? boss.atk * COEF.burn * U(0.85, 1.15) : card.max * 0.10);
    if (has('regenerating')) { const h = Math.round(boss.share * B.regenPassive); boss.hp = Math.min(boss.max, boss.hp + h); healed += h; }
    // Phase 2: below 25% the boss gains one more passive (once).
    if (!boss.phase25 && boss.hp / boss.max < 0.25) { boss.phase25 = true; const extra = PASSIVES.find((p) => !has(p)); if (extra) boss.passives.push(extra); }
  }
  return { dealt, healed, rounds: round };
}

function week(tier, players) {
  const t = TIERS[tier];
  const max = Math.round(DP * players * t.hp);
  // Heals are sized to ONE player's share of the HP (hunts.hp_share), or every extra
  // player would give the boss more healing turns than damage (found by this sim).
  const boss = { hp: max, max, share: Math.round(max / players), lethal: t.lethal, atk: ATK[tier], passives: pick(t.passives), phase25: false };
  let days = 0, rounds = 0;
  for (let d = 0; d < 5 && boss.hp > 0; d++) {
    for (let p = 0; p < players && boss.hp > 0; p++) rounds += fightDay(boss, DECK).rounds / players;
    days += 1;
  }
  return { killed: boss.hp <= 0, days, pct: Math.round(100 * (1 - Math.max(0, boss.hp) / max)), attacksPerDay: rounds / days };
}

// Fixed HP (Nathan, 2026-09-28: "a set HP that can handle tons of players regardless").
//   FIXED=80000,120000,160000 DAYS=7 CREW=10 PLAYERS=5,10,15 SCALE=1 node scripts/boss-sim.mjs
// SCALE = each player's deck as a fraction of the reference deck. BATTLE=1 prints the net
// damage of one daily battle per tier (the calibration: real Mythic 2026-09-28 = 1,556).
if (process.env.FIXED || process.env.BATTLE) {
  const HP = (process.env.FIXED || '1e9,1e9,1e9').split(',').map(Number);
  const DAYS = Number(process.env.DAYS || 7), CREW = Number(process.env.CREW || 10);
  const deck = DECK.map((cp) => cp * Number(process.env.SCALE || 1));
  const tiers = Object.keys(TIERS);
  if (process.env.BATTLE) {
    for (const [i, tier] of tiers.entries()) {
      let net = 0, n = 400;
      for (let k = 0; k < n; k++) {
        const max = 1e7, boss = { hp: max, max, share: max / 1e3, lethal: TIERS[tier].lethal, atk: ATK[tier], passives: pick(TIERS[tier].passives), phase25: false };
        fightDay(boss, deck); net += max - boss.hp;
      }
      console.log(`${tier.padEnd(7)} one battle: ${Math.round(net / n)} net damage`);
    }
    process.exit(0);
  }
  console.log(`fixed HP ${HP.join('/')}, ${DAYS} days, heal share = HP / ${CREW}, deck x${process.env.SCALE || 1}`);
  for (const players of (process.env.PLAYERS || '5,10,15,20').split(',').map(Number)) {
    for (const [i, tier] of tiers.entries()) {
      const runs = Array.from({ length: 300 }, () => {
        const max = HP[i], boss = { hp: max, max, share: Math.round(max / CREW), lethal: TIERS[tier].lethal, atk: ATK[tier], passives: pick(TIERS[tier].passives), phase25: false };
        let day = 0;
        for (; day < DAYS && boss.hp > 0; day++) for (let p = 0; p < players && boss.hp > 0; p++) fightDay(boss, deck);
        return { killed: boss.hp <= 0, day, pct: 100 * (1 - Math.max(0, boss.hp) / max) };
      });
      const k = runs.filter((r) => r.killed);
      console.log(`${String(players).padStart(2)} players  ${tier.padEnd(7)} HP ${String(HP[i]).padStart(7)}  killed ${String(Math.round(100 * k.length / runs.length)).padStart(3)}%${k.length ? ` (day ${(k.reduce((t, r) => t + r.day, 0) / k.length).toFixed(1)})` : ''}  avg ${Math.round(runs.reduce((t, r) => t + r.pct, 0) / runs.length)}% of HP`);
    }
  }
  process.exit(0);
}
if (process.env.CALIBRATE) {
  const t = TIERS[process.env.CALIBRATE];
  let dealt = 0, att = 0, n = 300;
  for (let i = 0; i < n; i++) {
    const max = Math.round(DP * t.hp);
    const boss = { hp: max, max, share: max, lethal: t.lethal, atk: ATK[tier], passives: pick(t.passives), phase25: false };
    const r = fightDay(boss, DECK); dealt += r.dealt / max; att += r.rounds;
  }
  console.log(`${process.env.CALIBRATE} one day: ${(100 * dealt / n).toFixed(1)}% of HP in ${(att / n).toFixed(1)} attacks = ${(100 * dealt / att).toFixed(2)}% per attack`);
  process.exit(0);
}
const TRIALS = 400;
console.log(`deck ${DECK.join(',')} (deployable power ${DP}), HP multipliers ${MULT.join('/')}`);
for (const players of (process.env.PLAYERS || '1,3,6').split(',').map(Number)) {
  for (const tier of Object.keys(TIERS)) {
    const runs = Array.from({ length: TRIALS }, () => week(tier, players));
    const kill = runs.filter((r) => r.killed).length / TRIALS;
    const pct = runs.reduce((t, r) => t + r.pct, 0) / TRIALS;
    const daysToKill = runs.filter((r) => r.killed).reduce((t, r) => t + r.days, 0) / Math.max(1, runs.filter((r) => r.killed).length);
    const apd = runs.reduce((t, r) => t + r.attacksPerDay, 0) / TRIALS;
    console.log(`${String(players).padStart(2)} player(s)  ${tier.padEnd(7)} HP ${String(Math.round(DP * players * TIERS[tier].hp)).padStart(6)}  week: ${String(Math.round(pct)).padStart(3)}% of HP  killed ${String(Math.round(kill * 100)).padStart(3)}%${kill ? ` (day ${daysToKill.toFixed(1)})` : ''}  attacks/player/day ${(apd).toFixed(1)}`);
  }
}
