/**
 * Monte-Carlo balance for the TAG battle engine (2026-09-16). Each player deploys up to
 * 8 cards/day; only Character/Creature attack. A card fights until the boss counter downs
 * it, so a player's daily damage is the sum over their best 8 attackers of
 * (attacks-until-downed x damage). Boss HP = deployable power (sum of top-8 attacker CP)
 * x a tier multiplier.
 *
 * The tag engine (Phase 5/6): a boss is weak to some TAGS and resists others. Per attack
 * the damage multiplier is
 *     mult = clamp(1 + (1 - 0.5^wm) * softcap - 0.8 * (1 - 0.5^rm), 0.25, 2.5)
 * where wm / rm = how many of the card's tags match the boss weak / resist tags, and the
 * squad soft cap = 0.5^(stack-3) once more than 3 of the player's squad share a weak tag
 * (so a mono-tag deck is not the only answer).
 *
 *   node scripts/combat-sim.mjs
 */
const TRIALS = 80;
const CAP = 8;
const ATTACKERS = new Set(['Character', 'Creature']);
const TYPE_W = [{ t: 'Character', w: 22 }, { t: 'Creature', w: 22 }, { t: 'Moment', w: 40 }, { t: 'Item', w: 9 }, { t: 'Place', w: 7 }];
const ASC_MULT = [1, 1.25, 1.5, 1.75, 2.0, 2.5];
// The tag universe an attacker draws from (traits + origins), ~mirrors the real 30-slug pool.
const TAG_POOL = ['fire', 'water', 'earth', 'air', 'ice', 'lightning', 'shadow', 'light', 'nature', 'arcane',
  'beast', 'human', 'robot', 'royal', 'melee', 'ranged', 'pokemon', 'smash', 'meme', 'community'];

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
  const type = wpick(TYPE_W).t;
  const nTags = 2 + Math.floor(rnd() * 2); // 2-3 tags per card
  return { cp, type, tags: sample(TAG_POOL, nTags) };
}

const clamp = (x) => Math.max(0.25, Math.min(2.5, x));
const count = (tags, set) => tags.reduce((n, t) => n + (set.has(t) ? 1 : 0), 0);
// The per-attack damage multiplier for a card, given how many weak/resist tags it matches
// and the squad soft-cap factor (0..1) applied to the weakness bonus.
function multOf(wm, rm, softcap) {
  return clamp(1 + (1 - 0.5 ** wm) * softcap - 0.8 * (1 - 0.5 ** rm));
}
const softcapFactor = (stack) => (stack <= 3 ? 1 : 0.5 ** (stack - 3));

function attack(cp, mult, wm) {
  if (rnd() < 0.08) return 0;                 // miss
  const crit = rnd() < (wm > 0 ? 0.20 : 0.10);
  const block = !crit && rnd() < 0.12;
  let dmg = cp * mult * (0.85 + rnd() * 0.30);
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

// A player's squad = their top-8 attackers by score (cp x per-card multiplier vs the boss).
function squadOf(cards, weakSet, resistSet) {
  const score = (c) => c.cp * multOf(count(c.tags, weakSet), count(c.tags, resistSet), 1);
  return cards.filter((c) => ATTACKERS.has(c.type)).sort((a, b) => score(b) - score(a)).slice(0, CAP);
}

const cardMaxHp = (cp) => Math.max(30, Math.round(cp * 1.8));
function fightUntilDowned(cp, mult, wm, counterMult) {
  let hp = cardMaxHp(cp), dmg = 0, guard = 0;
  while (hp > 0 && guard < 300) {
    guard += 1;
    dmg += attack(cp, mult, wm);
    if (rnd() < 0.45) hp -= Math.max(1, Math.round(cardMaxHp(cp) * (0.14 + rnd() * 0.16) * counterMult));
  }
  return dmg;
}

// tier: w weak tags, r resist tags, cm boss counter multiplier, k HP multiplier.
const TIER = {
  Normal: { w: 1, r: 0, cm: 1.0, k: 8 },
  Heroic: { w: 2, r: 1, cm: 1.25, k: 12 },
  Mythic: { w: 3, r: 2, cm: 1.6, k: 15 },
};

for (const [scName, sc] of Object.entries(SCENARIOS)) {
  console.log(`\n########## ${scName.toUpperCase()}  (${sc.players} players) ##########`);
  for (const [tier, cfg] of Object.entries(TIER)) {
    const agg = { deploy: 0, hp: 0, dmg: 0, atk: 0, weak: 0, mult: 0 };
    for (let tr = 0; tr < TRIALS; tr++) {
      const weakSet = new Set(sample(TAG_POOL, cfg.w));
      const resistSet = new Set(sample(TAG_POOL.filter((t) => !weakSet.has(t)), cfg.r));
      const players = buildRoster(sc);
      let deploy = 0, dayDmg = 0, atk = 0;
      for (const cards of players) {
        const squad = squadOf(cards, weakSet, resistSet);
        const stack = squad.filter((c) => count(c.tags, weakSet) > 0).length; // squad cards sharing a weak tag
        const sc2 = softcapFactor(stack);
        for (const c of squad) {
          deploy += c.cp;
          const wm = count(c.tags, weakSet), rm = count(c.tags, resistSet);
          const mult = multOf(wm, rm, sc2);
          dayDmg += fightUntilDowned(c.cp, mult, wm, cfg.cm);
          atk += 1; agg.mult += mult; if (wm > 0) agg.weak += 1;
        }
      }
      const hp = Math.max(500, Math.round(deploy * cfg.k));
      agg.deploy += deploy; agg.hp += hp; agg.dmg += dayDmg; agg.atk += atk;
    }
    const f = (n) => Math.round(n / TRIALS).toLocaleString();
    const dailyFull = agg.dmg / TRIALS;
    const hp = agg.hp / TRIALS;
    const days = (p) => { const d = hp / (dailyFull * p); return d < 1 ? '<1' : d.toFixed(1); };
    const weakPct = Math.round((100 * agg.weak) / agg.atk);
    const avgMult = (agg.mult / agg.atk).toFixed(2);
    console.log(`  ${tier.padEnd(7)} deploy ${f(agg.deploy).padStart(7)}  HP ${f(agg.hp).padStart(8)}  daily ${Math.round(dailyFull).toLocaleString().padStart(8)}` +
      `  |  days @100% ${days(1.0)}  @50% ${days(0.5)}  @25% ${days(0.25)}  |  weak ${String(weakPct).padStart(2)}%  avgMult ${avgMult}`);
  }
}

// Anti-meta check: what a MONO-tag whale (8 cards that all share the weak tag) actually
// gets, vs a DIVERSE squad (each card has different tags). The soft cap should keep the
// mono squad from running away.
console.log('\n########## ANTI-META (mono-tag vs diverse, avg per-attack multiplier) ##########');
for (const w of [1, 2, 3]) {
  const monoStack = 8, diverseStack = Math.min(3, Math.ceil(8 * 0.35)); // ~diverse: few share the tag
  const monoMult = multOf(w, 0, softcapFactor(monoStack));
  const first3Mult = multOf(w, 0, softcapFactor(3));
  const diverseMult = multOf(w, 0, softcapFactor(diverseStack));
  console.log(`  weak=${w}: mono(8-stack) each x${monoMult.toFixed(2)}  vs  first-3 x${first3Mult.toFixed(2)}  vs  diverse(${diverseStack}-stack) x${diverseMult.toFixed(2)}`);
}
console.log('\nWindow target ~4 days (Thu 21:00 -> Mon 23:00 UTC).\n');
