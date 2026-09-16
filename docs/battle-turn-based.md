# Pride Hunt — Turn-Based Battle (design, 2026-09-16)

Replaces the reactive tap-until-downed model with a round-based fight. Goal: deliberate
and engaging, not spam-clicking. Ties together support cards and boss attack variety.

## The turn loop (LIVE — no telegraph, boss move is a surprise)
A round repeats until the boss falls or the squad is wiped. The player turn is real time:
each tap fires its action at once, not a batch you queue and run.

1. **Player turn (live)**
   - Tap support cards from the locked squad in any order. Each tap fires immediately —
     the buff / shield / debuff applies and animates right away. Each support has a
     **cooldown** (measured in rounds); after use it rests a few rounds.
   - Tap an attacker card to **attack**. The attack **ends the round**.
2. **Boss turn (a surprise)** — replaces the old 45% reactive counter. Right after the
   attack, the UI shows only that it is now the **boss's turn** (a brief indicator), never
   which action is coming. The boss then draws ONE action at random from its pool and the
   player sees it land. So supports are played on anticipation, not on a telegraph.

## Attacker cards (Character / Creature)
- Each attacker has daily HP (`hunt_card_hp`, the stamina model). It attacks once per round
  when chosen, and fights across rounds until the boss downs it.
- The 8-card daily squad cap and the daily reset stay.

## Support cards (Item / Place / Moment) — ability by type
- **Item → Empower**: the next attack deals extra damage.
- **Place → Guard**: shield one card; it absorbs the boss's next hit.
- **Moment → Rally**: a one-time burst — a direct hit on the boss, or a squad-wide buff.
- Each support has a cooldown (a few rounds). Timing them against the telegraph is the skill.
- (Exact numbers to tune. Abilities are data-driven so we can add more later.)

## Boss actions (telegraphed one round ahead; weighted by tier)
- **Strike**: hits the card that attacked (single target).
- **Slam (area)**: hits every squad card for less each.
- **Enrage**: raises the boss's damage for a few rounds (self-buff).
- **Curse**: weakens one card's damage (debuff).
- Higher tiers use the heavier actions more often.

## State (server-authoritative — co-op rewards, so no client trust)
- `hunt_combat_state(hunt_id, player_id, hit_date, round, boss_next, boss_next_target, boss_enrage, updated_at)`.
- Extend `hunt_card_hp` with per-card status for the day: `shield int`, `dmg_buff numeric`,
  `dmg_debuff numeric`, and support `cd_until_round int`.
- New RPCs: `hunt_support(player, hunt, card, target)` applies a support (validates cooldown,
  writes status); `hunt_turn`/updated `hunt_attack` resolves the attack + the telegraphed boss
  action + rolls the next telegraph. All idempotent and row-locked like the current RPC.

## Ability system (each card has a unique ability, 2026-09-16)
Every card (subject) carries an ability. The engine implements a small fixed set of
**effect primitives**; each card's ability is a named effect + numbers, so cards stay
unique without bespoke code. Stored on `subjects.ability jsonb`:
```
{ "name": "Power Surge", "kind": "attack"|"support", "effect": "<primitive>",
  "amount": 0.5, "target": "ally"|"self"|"boss"|"all_allies", "cooldown": 3,
  "desc": "shown in the UI" }
```

**Support effects** (active — played on your turn, cooldown-gated; Item/Place/Moment):
- `empower` — target ally's next attack deals +amount% damage.
- `shield` — grant an ally a shield of amount (absorbs the boss's next hit).
- `heal` — restore amount HP to an ally.
- `weaken` — the boss deals amount% less for N rounds.
- `expose` — the boss takes amount% more damage for N rounds.
- `smite` — deal amount direct damage to the boss (a support that also hits).
- `stun` — the boss skips its next turn.
- `cleanse` — remove debuffs from your cards.

**Attack effects** (passive — fire when the card attacks; Character/Creature):
- `lifesteal` — heal self for amount% of the damage dealt.
- `execute` — +amount% damage when the boss is below a HP threshold.
- `rampage` — amount% chance to strike twice.
- `pierce` — ignores the boss's damage-reduction (Enrage/defense).
- `focus` — +amount crit chance on this attack.

The engine resolves only these primitives. Adding a card = pick an effect + numbers +
flavor name. Boss actions stay the fixed pool (Strike/Slam/Enrage/Curse) for now; unique
boss attacks can become data-driven later the same way.

## Build phases (incremental, each shippable)
1. **Turn loop skeleton** — attack ends the turn; the boss takes a telegraphed turn (Strike +
   Slam) instead of the reactive counter. Reuse existing HP/damage. Telegraph shown in the UI.
2. **Boss variety** — add Enrage + Curse, tier weighting, boss status on the boss model.
3. **Support abilities** — Empower / Guard / Rally with cooldowns, played before the attack;
   card status (shield/buff) shown on the hand.
4. **Balance pass** — re-run `combat-sim.mjs` for the round model (area hits down cards faster,
   so retune the boss HP multipliers); tune ability and boss numbers from telemetry.
