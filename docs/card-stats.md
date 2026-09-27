# Card Stats and Stat Points — Design

Status: DECIDED 2026-09-27 (Nathan). Not built.

## 1. The stats that the engine uses today (all derived, none stored)

| Stat | Today |
|---|---|
| Power (attack) | rarity base (Normal 10, IR 20, SR 40, Full Art 75, Gold 140) x ascension (star 1 = x1.25 ... star 5 = x2.5) x `subjects.cp_mod` (`card_power`) |
| HP | `max(30, Power x 1.8)` (`card_max_hp`), so most cards have 30 |
| Crit | a crit chance, x2 damage; the Focus ability adds more |
| Hit roll | +-15% damage; the attack misses 8% (18% vs a "shrouded" boss); the boss blocks 12% (half damage) |
| Element | from the card's traits (squad synergy, weaknesses, attack FX) |

The Card Information view shows these stats: Power, HP, Crit, Element, plus the Ability
and the Effect.

## 2. Stat points (Nathan's idea: "make each card the player's own card")

- Each ascension star keeps a SMALL fixed boost, and it also gives **3 stat points**.
- The player spends the points on THEIR copy (`player_cards`), so two players can build
  the same card differently.

| Stat | 1 point |
|---|---|
| Attack | +5% damage |
| Vitality | +6% HP |
| Precision | +1.5% crit chance |
| Potency | +5% boon/prank effect |
| Haste | -4% boon/prank cooldown |

- **Balance rule:** the points buy about the same total strength as today's fixed star
  bonus, so a star-5 card is not stronger in total, only shaped by its owner. The
  simulation (`combat-sim.mjs`, `boon-sim.mjs`) checks it before release.
- The per-star effect bonus from `card_effects_ascension.sql` (+10% effect, -8%
  cooldown) moves into Potency and Haste when this ships.

## 3. Decisions (Nathan, 2026-09-27)

1. **Reset:** free, for ONE card each week per player.
2. **Trade:** a traded card arrives with its points reset, and the new owner gets the
   points to spend.
3. **The 5 stats** above are a good start.

## 4. Data (proposal)

- `player_cards.stat_points jsonb default '{}'`: `{ attack, vitality, precision, potency, haste }`.
- The unspent points = 3 x ascension - the sum of the spent points.
- `players.stat_reset_week` (the ISO week of the last free reset).
- RPCs: `spend_stat_points(player, card, jsonb)` and `reset_stat_points(player, card)`.
  Both check ownership, the limits, and the weekly reset.
- `card_power`, `card_max_hp`, the crit roll in `hunt_attack`, and `play_card_effect`
  read the points of the played copy.
