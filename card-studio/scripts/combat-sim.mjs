/**
 * Monte-Carlo balance for the SQUAD model (2026-09-15). Each player deploys up to 8
 * cards per day. Only Character/Creature cards attack (Item/Place/Moment are support).
 * Each squad card attacks the boss REPEATEDLY until the boss counter downs it — the team
 * fights until wiped. So a player's daily damage is the sum, over their best 8 attacker
 * cards, of (attacks-until-downed x damage).
 *
 * Boss HP scales to DEPLOYABLE POWER = the sum over players of their top-8 attacker CP.
 * This script finds the tier multiplier so the fight lasts the wanted number of days.
 *   node scripts/combat-sim.mjs
 */
const TRIALS = 60;
const CAP = 8;                              // daily card cap
const TYPES = ['Character', 'Creature', 'Item', 'Place', 'Moment'];
const ATTACKERS = new Set(['Character', 'Creature']);
// Type mix roughly mirrors the subject pool (~44% attackers).
const TYPE_W = [{ t: 'Character', w: 22 }, { t: 'Creature', w: 22 }, { t: 'Moment', w: 40 }, { t: 'Item', w: 9 }, { t: 'Place', w: 7 }];
const ASC_MULT = [1, 1.25, 1.5, 1.75, 2.0, 2.5];

const SCENARIOS = {
  launch:  { players: 15, min: 3, max: 6,
    rarity: [{ base: 10, w: 80 }, { base: 20, w: 18 }, { base: 40, w: 2 }],
    asc:    [{ a: 0, w: 94 }, { a: 1, w: 6 }] },
  growing: { players: 50, min: 6, max: 12,
    rarity: [{ base: 10, w: 62 }, { base: 20, w: 22 }, { base: 40, w: 11 }, { base: 75, w: 4 }, { base: 140, w: 1 }],
    asc:    [{ a: 0, w: 70 }, { a: 1, w: 18 }, { a: 2, w: 8 }, { a: 3, w: 4 }] },
  mature:  { players: 100, min: 8, max: 20,
    rarity: [{ base: 10, w: 55 }, { base: 20, w: 22 }, { base: 40, w: 12 }, { base: 75, w: 6 }, { base: 140, w: 3 }],
    asc:    [{ a: 0, w: 60 }, { a: 1, w: 20 }, { a: 2, w: 10 }, { a: 3, w: 6 }, { a: 4, w: 3 }, { a: 5, w: 1 }] },
};

const rnd = () => Math.random();
function wpick(arr) { const tot = arr.reduce((s, x) => s + x.w, 0); let r = rnd() * tot; for (const x of arr) { if ((r -= x.w) <= 0) return x; } return arr[0]; }
function sample(arr, n) { return [...arr].sort(() => rnd() - 0.5).slice(0, n); }

function newCard(sc) {
  const rar = wpick(sc.rarity); const a = wpick(sc.asc).a;
  const cp = Math.max(1, Math.round(rar.base * ASC_MULT[a] * (0.9 + rnd() * 0.2)));
  return { cp, type: wpick(TYPE_W).t };
}

// One attack (the exact SQL rolls). Returns damage to the boss.
function attack(cp, isWeak) {
  if (rnd() < 0.08) return 0;                 // miss
  const crit = rnd() < (isWeak ? 0.20 : 0.10);
  const block = !crit && rnd() < 0.12;
  let dmg = cp * (isWeak ? 2 : 1) * (0.85 + rnd() * 0.30);
  if (crit) dmg *= 2; if (block) dmg *= 0.5;
  return Math.max(1, Math.round(dmg));
}

function buildRoster(sc) {
  const players = [];
  for (let p = 0; p < sc.players; p++) {
    const n = sc.min + Math.floor(rnd() * (sc.max - sc.min + 1));
    const cards = [];
    for (let i = 0; i < n; i++) cards.push(newCard(sc));
    players.push(cards);
  }
  return players;
}

// A player's squad = their top-8 attacker cards by base power (weak match doubles value).
function squadOf(cards, weak) {
  return cards.filter((c) => ATTACKERS.has(c.type))
    .sort((a, b) => (b.cp * (weak.includes(b.type) ? 2 : 1)) - (a.cp * (weak.includes(a.type) ? 2 : 1)))
    .slice(0, CAP);
}

const cardMaxHp = (cp) => Math.max(30, Math.round(cp * 1.8));
// One card fights until the boss counter downs it. Returns total damage it deals.
function fightUntilDowned(cp, isWeak, counterMult) {
  let hp = cardMaxHp(cp), dmg = 0, guard = 0;
  while (hp > 0 && guard < 200) {
    guard += 1;
    dmg += attack(cp, isWeak);
    if (rnd() < 0.45) hp -= Math.max(1, Math.round(cardMaxHp(cp) * (0.14 + rnd() * 0.16) * counterMult));
  }
  return dmg;
}

// hp = deployable_power * tierK.  deployable = sum of top-8 attacker CP.
// w = weak-type count, cm = boss counter multiplier (downs cards faster at higher tiers).
const TIER = { Normal: { w: 1, cm: 1.0, k: 10 }, Heroic: { w: 2, cm: 1.25, k: 16 }, Mythic: { w: 3, cm: 1.6, k: 22 } };

for (const [scName, sc] of Object.entries(SCENARIOS)) {
  console.log(`\n########## ${scName.toUpperCase()}  (${sc.players} players) ##########`);
  for (const [tier, cfg] of Object.entries(TIER)) {
    const agg = { deploy: 0, hp: 0, dmg: 0, atk: 0, hits: 0, weak: 0 };
    for (let tr = 0; tr < TRIALS; tr++) {
      const weak = sample(TYPES, cfg.w);
      const players = buildRoster(sc);
      let deploy = 0, dayDmg = 0, atk = 0;
      for (const cards of players) {
        const squad = squadOf(cards, weak);
        for (const c of squad) {
          deploy += c.cp;
          const isWeak = weak.includes(c.type);
          dayDmg += fightUntilDowned(c.cp, isWeak, cfg.cm); // fight until downed
          atk += 1; if (isWeak) agg.weak += 1;
        }
      }
      const hp = Math.max(500, Math.round(deploy * cfg.k));
      agg.deploy += deploy; agg.hp += hp; agg.dmg += dayDmg; agg.atk += atk; agg.hits += atk;
    }
    const f = (n) => Math.round(n / TRIALS).toLocaleString();
    const dailyFull = agg.dmg / TRIALS;   // full-participation daily damage
    const hp = agg.hp / TRIALS;
    const dailyStr = Math.round(dailyFull).toLocaleString();
    const days = (p) => { const d = hp / (dailyFull * p); return d < 1 ? '<1' : d.toFixed(1); };
    console.log(`  ${tier.padEnd(7)} deploy pow ${f(agg.deploy).padStart(7)}  boss HP ${f(agg.hp).padStart(8)}  daily ${dailyStr.padStart(7)}` +
      `  |  days @100% ${days(1.0)}  @50% ${days(0.5)}  @25% ${days(0.25)}`);
  }
}
console.log('\nWindow is ~4 days (Thu 21:00 -> Mon 23:00 UTC). weak-hit share ~%d of attacks.\n');
