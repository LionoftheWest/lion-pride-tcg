# Hunt boss movesets and counter passives

Status: APPROVED by Nathan on 2026-10-06 (the decisions below). The exact rules in sections 3 to 6 are the build spec.
The open interpretations are marked **(spec)**: they make an approved line exact. Nathan can change them.

## 1. Nathan's decisions (2026-10-06)

- No theme on a boss. "I don't want an 'overarching' theme on a boss actually. Thats what passives do."
- The moves counter the supports. "I DO want the bosses to have their moveset THEME'D around countering a support type,
  meaning their moves they do are what counters the supports."
- More moves. "The boss should have like 3-4 moves that all counter supports/their effects/etc." Each boss has 4.
- The counter moves together take 40% of the boss turns (10% each). The usual moves take 60%. Measure on the local
  copy first. ("Yes that is a good start")
- Plague, Shatterer, Dispeller and Juggernaut are passives, not themes: "these would be awesome passives instead of
  themes". A countered support works at 10%. At most one of these four on a boss. ("Yes")
- The boss details list the boss moves before the squad locks. ("Yes") This is UI work: lane A (UI-20).
- The move list in section 4: "Agreed".

The reason: support stacking (for example 3 attackers + 5 supports) is a good strategy, and Nathan does not want to
cap attacks. Each boss now punishes a different support type, so no one squad is the best for every boss.

## 2. The boss turn

1. Stunned, Charging and Cataclysm come first, as today (`combat_enemy_act`).
2. Else the boss draws: with chance `counter_share` (0.40) it uses one of its 4 counter moves (equal weights).
   Else it uses the usual table (strike, slam, drain, stun, enrage, curse, regenerate) as today.
3. A boss with no move pool (a boss name not in `settings.hunt_boss_moves`) uses only the usual table.

**(spec)** Each counter move also hits the attacking card for ATK x 0.5, unless the move is a hit itself (its own
numbers below). **(spec)** A counter move that finds nothing to counter (for example Shatter when no card has a shield)
only does that ATK x 0.5 hit. So a squad that adapts to the boss takes less damage.

All hits use the usual roll (x 0.85 to 1.15) and the boss damage multiplier (enrage, weaken, rage, passives).
A "round" is the squad round (`hunt_combat_state.round`). "For N rounds" = until the round counter passes round + N.

## 3. The state

- `hunt_combat_state.marks` (jsonb, new): the counter marks of one squad on one day, for example
  `{"block": {"heal": {"until": 7, "mult": 0.1}}, "stun_fail": true, "dot": {"123": {"amt": 14, "until": 9}}}`.
- Cooldowns use the existing `hunt_card_hp.cd_until_round` (a support card cannot play while round < cd_until_round).
- The squad plays of this round come from `combat_actions` (support plays, PR #214).

## 4. The movesets (approved list)

The numbers are the first values. They live in `settings.hunt_boss_moves`.

### The Grind Vampire: counters heal
- **Bloodrot:** heals on the hit card work at 10% for 2 rounds.
- **Siphon:** the boss heals the total HP that the squad healed this round.
- **Feast:** hits the card with the lowest HP for ATK x 1.0.
- **Anemia:** an area hit (ATK x 0.35 on each card), x 2 on heal cards.

### The AFK Warzombie: counters heal
- **Decay:** the hit card loses the HP that heals gave it this round.
- **Infect:** ATK x 0.35 now, then ATK x 0.25 on each boss turn for 3 rounds, on the hit card.
- **Groan:** each heal card waits 2 more rounds.
- **Undying:** for 3 rounds, each heal that the squad plays also heals the boss by the same amount.

### The Smurf Brute: counters shield
- **Shatter:** breaks every shield in the squad.
- **Crush:** an area hit. Each card takes half of the shield that it lost to Shatter today. **(spec)** With no Shatter today: ATK x 0.35 on each card.
- **Bully:** hits the card with the biggest shield for ATK x 1.0. The hit ignores the shield.
- **Fake Rank:** hits the attacking card for ATK x 1.0, x 2 if it has a shield.

### The Hardstuck Skeleton: counters shield
- **Bone Pierce:** hits the attacking card for ATK x 1.0. The hit ignores the shield.
- **Rattle:** cuts every shield in half.
- **Calcify:** new shields work at 10% for 2 rounds.
- **Stuck:** each shield card waits 2 more rounds.

### Maw of the Meta: counters empower
- **Nerf:** removes empower from every card.
- **Patch Notes:** empower works at 10% for 2 rounds.
- **Tier List:** hits the empowered card for ATK x 2.0. **(spec)** With no empowered card: the attacking card, ATK x 0.5.
- **Counter-pick:** for 3 rounds **(spec)**, an empowered attack also hurts the attacker by the bonus damage.

### The Rage-Quit Warlord: counters weaken
- **Tilt:** ends weaken. The boss enrages (x 1.4) for 2 rounds.
- **Alt-F4:** weaken has no effect for 3 rounds.
- **Rage Spiral:** for 3 rounds, each weaken played adds x 0.2 to the boss damage (until the spiral ends).
- **Flame:** an area hit (ATK x 0.35 on each card), x 2 on weaken cards.

### The Ranked Nightshade: counters expose
- **Fade:** ends expose.
- **Veil:** expose has no effect for 3 rounds.
- **Demotion:** for 3 rounds **(spec)**, an attack on an exposed boss sends 20% of its damage back to the attacker.
- **Nightshade:** ATK x 0.25 on each boss turn for 3 rounds, on each expose card.

### The Lagspike Parasite: counters stun
- **Desync:** the next stun fails.
- **Rubberband:** **(spec)** the next boss turn after a stun hits twice (two hits of ATK x 1.0).
- **Lag Spike:** each stun card waits 3 more rounds.
- **Packet Loss:** the next support play does nothing (the card still goes on cooldown).

### The Netcode Mutant: counters smite
- **Rollback:** the boss heals the damage of the last smite today.
- **Hitbox Desync:** smite does 10% damage for 2 rounds.
- **Mirror:** the next smite hits the smite card instead of the boss.
- **Ping Spike:** each smite card waits 2 more rounds.

### The Patch-Day Pumpkin: counters cleanse
- **Hotfix:** curses the hit card (x 0.7). Cleanse cannot remove a curse for 3 rounds.
- **Rollout:** curses every card in the squad.
- **Rot:** for 2 rounds, a cleanse also removes empower and shields.
- **Patch:** each cleanse card waits 2 more rounds.

### The Ban-Wave Demon: counters all support cards
- **Ban:** one support card (random, not down) cannot play for 3 rounds.
- **Wave:** every support card waits 1 more round.
- **Appeal Denied:** hits the last support card that played for ATK x 2.0.
- **Shadow Ban:** the next support play does nothing (the card still goes on cooldown).

### The Zerg-Rush Queen: counters all support cards
- **Swarm:** an area hit (ATK x 0.35 on each card), x 2 on support cards.
- **Brood:** hits every support card for ATK x 0.5.
- **Rush:** two hits of ATK x 0.6 on the support card with the lowest HP.
- **Overrun:** **(spec)** hits the support card with the lowest HP for ATK x 1.0. If it goes down, the boss enrages for 2 rounds.

"Heal card", "shield card" and so on = a support card in the squad with that effect.

## 5. The counter passives

| Passive | Label | Rule |
|---|---|---|
| plague | Plague: heals and cleanse barely work | Heal x 0.1. Cleanse removes only 10% of a curse. |
| shatterer | Shatterer: shields and smite barely work | Shield x 0.1. Smite x 0.1. |
| dispeller | Dispeller: empower and expose barely work | Empower bonus x 0.1. Expose x 0.1. |
| juggernaut | Juggernaut: weaken and stun barely work | Weaken x 0.1. A stun fails 9 times in 10. |

- A spawn draws its passives as today (Normal 1, Heroic 2, Mythic 3, all different). The pool now has 11 kinds.
  At most one of the four counter passives on a boss.
- The phase 2 passive (below 25% HP) comes from the 7 old kinds only, so the rule of one counter passive holds.

## 6. Other server changes in the same build

- D-70 (supports on supports): a support that targets a support card gives it the support HP (60), not an attacker HP.
- `/api/hunt` returns the boss moves (name and text), so the boss details can list them (D-71, lane A).

## 7. Measurement before it goes live

Scripted fights on the local copy: the same squads (support-heavy, attacker-heavy, mixed) against each boss, with and
without the counter moves. The result: the damage per squad-day for each boss. The build goes live only after Nathan
sees the table.
