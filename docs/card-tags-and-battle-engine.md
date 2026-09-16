# Card Tags and the Battle Engine — Design

Status: DRAFT for approval. Author: build session, 2026-09-16.

This document describes the deeper card system for the Lion Pride TCG. It adds a
faceted tag model to every card. The tags drive the animations, the classes, the
raid-boss weaknesses, the ability balance, the auto-pick, and the future prank
system. See also [battle-turn-based.md](./battle-turn-based.md) and
[pve-and-social-design.md](./pve-and-social-design.md).

## 1. Goals

- Give each card tags that describe where the card comes from and what it is.
- Use the tags to assign animations and classes across all cards.
- Make raid bosses weak to some tags and resistant to other tags.
- Make squad planning deep and fun, but keep the system fair.
- Show the tags and the ability in the Card Information view.
- Add an auto-pick option that builds a good squad for the current boss.
- Let the future prank system target cards by tag.
- Keep no card and no deck too strong. Give every player a chance to shine.

## 2. The faceted tag model

Each card carries tags in named facets. A facet is one dimension of meaning. The
approved structure is FACETED.

The facets are:

- `class`: the battle role. One value. For example `attacker` or `support`.
- `type`: the card kind. One value. `Character`, `Creature`, `Item`, `Place`,
  or `Moment`. This column exists today.
- `origin`: the source game, show, or franchise. One or more values. For
  example `halo` or `zelda`.
- `genre`: the source genre. One or more values. For example `shooter` or `rpg`.
- `realm`: the setting or location. One or more values. For example `sci-fi`
  or `fantasy`.
- `traits`: a free bag of descriptive tags. One or more values. For example
  `fire`, `undead`, `armored`, `ranged`, `mechanical`, or `royal`.

The tags are NOT shown on the card face. The card face keeps its current look.
The tags appear only in the Card Information view (see Section 5).

### 2.1 Data model

Add one column to the `subjects` table:

- `tags jsonb not null default '{}'`. This holds the facets. Example:

```json
{
  "class": "attacker",
  "origin": ["halo"],
  "genre": ["shooter"],
  "realm": ["sci-fi"],
  "traits": ["armored", "human", "ranged"]
}
```

Add one generated helper for fast lookups:

- `tag_slugs text[]`. This is a flat list of every tag value, each prefixed by
  its facet. For example `["class:attacker", "type:character", "origin:halo",
  "trait:armored", "trait:ranged"]`. Build it with a trigger or a generated
  column. Add a GIN index so the boss engine can test membership quickly.

The `class` facet replaces the current attacker/support split that the code
derives from `type`. The engine reads `class` first, and falls back to the type
rule only when `class` is absent.

## 3. Boss weakness and resistance

The approved model is WEAKNESS plus RESISTANCE. It extends the current
`weak_points` system.

The `hunts` table already has `weak_points jsonb`. Each entry has a `kind` and a
`value`. Add a new kind `tag`, so a weak point can target any tag slug. Add a
second column `resist_points jsonb` with the same shape for tags the boss
resists.

The damage multiplier for one attack is:

- Start at 1.0.
- Add a weakness bonus for each of the attacker's tags that the boss is weak to.
- Subtract a resistance penalty for each of the attacker's tags that the boss
  resists.
- Apply the soft cap from Section 4.

Proposed base numbers, open to tuning:

- Weakness bonus: plus 0.5 for the first matching tag.
- Resistance penalty: minus 0.4 for the first matching tag.
- The final multiplier has a floor of 0.25 and a ceiling of 2.5.

The boss can also gain its own traits (for example `enraged` or `shielded`).
The current enrage and curse actions already work this way. Tags make this
system consistent.

## 4. Balance — no OP cards, no meta decks

The approved model is ROTATE plus SOFT CAPS. It has three parts.

### 4.1 Weekly rotation

- The boss weakness tags rotate every week. The spawn job picks the tags.
- The job tracks recent weeks and avoids a repeat, so coverage stays broad.
- Every card gets its week to shine. No single tag stays strong for long.

### 4.2 Soft caps on stacking

- The weakness bonus applies fully to the first few cards that share the tag.
- After that, the bonus decays for each extra card that shares the tag.
- Proposed curve: full bonus for the first 3 cards, then the bonus halves for
  each card after that.
- This stops a squad of eight identical-tag cards from being the only answer.

### 4.3 Ability power budget

Each ability has a value. The value must stay inside a budget. The budget keeps
every card near the same total strength.

- Compute a card base value from its rarity and its ascension. This is the CP.
- Give each ability a point cost from a fixed table (damage, heal, shield,
  stun, and so on).
- Normalize the ability cost against the CP, so a strong card does not also get
  a strong ability for free.
- Record the budget math in `card-studio/scripts/combat-sim.mjs` and test it.

The result: a rare card hits harder, but a common card can still shine when its
tag matches the boss. Strategy beats raw rarity.

## 5. The Card Information view

The card viewer (`openViewer` in `tcg-activity/src/main.js`) gains two sections.

- A Tags section. It groups the tags by facet. It shows `class`, `type`,
  `origin`, `genre`, `realm`, and `traits`. It hides an empty facet.
- An Ability section. It shows the ability name, the effect in plain words, the
  target, and the cooldown.

The squad picker also shows the ability clearly. When a player picks a squad for
the day, the player can read what each card does. This helps the player plan
against the current boss.

## 6. Auto-pick

The approved model is BEST VERSUS TODAY'S BOSS.

- Read the player's owned cards and the boss weak and resist tags.
- Score each owned attacker by the expected damage. Use the CP, the weakness
  and resistance multiplier, and the ability value.
- Pick the top attackers up to the daily cap.
- Include a small number of the best support cards.
- Return the chosen card ids. The client fills the squad and the player can edit
  it before Lock In.

The auto-pick is a helper, not a requirement. A player who wants to plan deeply
can ignore it.

## 7. The prank system hooks

The prank system is not built yet. The tags prepare it.

- A prank can target cards by tag. For example, a prank affects only `fire`
  cards, or only `meme` origin cards.
- A prank can read the same `tag_slugs`, so no new data is needed.
- The design keeps the prank guardrails from
  [pve-and-social-design.md](./pve-and-social-design.md).

## 8. Build phases

Build the system in small, safe steps. Test each step before the next.

1. Schema: add `subjects.tags`, add `tag_slugs` with a GIN index, add
   `hunts.resist_points`. Seed a starter taxonomy for the 32 subjects.
2. Card Portal: make the tags, the ability, and all card information editable and
   pushable (Section 11).
3. Per-tier tradeability: make the tradeable flag a per-tier value (Section 12).
4. Card Information view: show the tags and the ability.
5. Boss engine: apply the weakness and resistance multiplier and the soft cap in
   `hunt_attack`.
6. Rotation: the spawn job picks the weekly weak and resist tags.
7. Auto-pick: add the endpoint and the button.
8. Balance pass: apply the ability budget and re-run the simulation.
9. Prank hooks: add tag targeting when the prank system starts.

## 9. Starter taxonomy (proposal)

The build session writes the first-pass tags for all 32 subjects. The owner then
tweaks the values. This matches the ability authoring pattern.

The starter trait vocabulary (open to change):

- Element: `fire`, `water`, `earth`, `air`, `ice`, `lightning`, `shadow`,
  `light`, `nature`, `arcane`.
- Kind: `human`, `beast`, `undead`, `robot`, `spirit`, `royal`, `monster`.
- Style: `melee`, `ranged`, `caster`, `armored`, `stealth`, `support`.

## 10. Personal GitHub (point 5)

Nothing is on the personal GitHub yet. The facts:

- The `discord` folder is not its own git repository. The home folder is the
  repository.
- The personal GitHub account is `LionoftheWest`.
- The active GitHub CLI account is the R3VCORE account, not the personal
  account.

The recommended setup:

- Create a dedicated repository for the project.
- Keep the R3VCORE identity out of it. Use the `LionoftheWest` identity.
- Make the repository private.

Two open decisions for the owner:

- The repository name. For example `lion-pride-tcg`.
- Whether to move the folder to `C:/Users/vaugh/dev/personal/`, so the personal
  git identity applies automatically.

The build session will not publish anything until the owner authenticates the
`LionoftheWest` account and confirms these two decisions.

## 11. The Card Portal is the single edit surface

The Card Portal is the Card Studio web app at `card-studio` (`src/server.js`,
`public/app.js`, `public/index.html`). It pushes to Supabase through
`src/push.js`.

Rule: every field that appears in the Card Information view must be editable in
the portal and pushable to Supabase. Nothing that a player can read lives only
in a SQL migration.

Today the portal pushes only some fields. `push.js` writes the subject `type`
and the per-card `name`, `lore`, `artist_credit`, `season`, `event`,
`image_url`, `in_draw_pool`, and `tradeable`. It does NOT write the tags or the
ability. The abilities live in a SQL migration (`hunt_abilities.sql`). This must
change.

The portal gains these edit controls:

- A Tags editor. It edits every facet: `class`, `type`, `origin`, `genre`,
  `realm`, and `traits`. It writes `subjects.tags`.
- An Ability editor. It edits the ability name, the kind, the effect, the
  amount, the target, and the cooldown. It writes `subjects.ability`.
- The existing text fields stay editable: `name`, `lore`, `season`, `event`,
  and the artist.

Data flow:

- The portal card model is `cards.json` through `src/cardstore.js`. Add `tags`
  and `ability` to the card object.
- `src/push.js` writes `subjects.tags` and `subjects.ability` in the subject
  upsert, next to `type`.
- The ability editor uses a form, because the ability is structured. The form
  must match the ability schema in [battle-turn-based.md](./battle-turn-based.md).

Safety:

- The portal already reaches Supabase with the service role key. Keep this key
  server-side only. Do not expose it to the browser.
- The portal is a personal tool. Keep the remote access (cloudflared and
  Tailscale) private.

## 12. Per-tier tradeability

Requirement: the tradeable flag is per tier, not per card in general.

The facts:

- Each rarity finish is its own row in the `cards` table.
- The `cards` table already has a `tradeable` column per row. So the data model
  already supports a per-tier value.
- The portal writes ONE `card.tradeable` value to every tier (`push.js`). This
  is the gap.
- The portal already has a per-tier override system, `tierDetails[slot]`, for
  the genre, the lore, the season, and the event (`cardstore.js`).

The change:

- Add `tradeable` to the per-tier override in `slotDetails` and
  `setSlotDetails`.
- The portal Tags/Info editor shows a tradeable toggle for each tier.
- `push.js` writes `tradeable` per rarity from the tier override, not one value
  for all tiers.

The gold rule (owner decision, 2026-09-16):

- Gold never trades. Keep the hardcoded rule `c.rarity = 'gold'` in `trades.sql`.
- The per-tier tradeable flag controls the other four tiers only: `normal`,
  `illustrated_rare`, `secret_rare`, and `full_art`.
- The portal shows the per-tier toggle for the four non-gold tiers. The portal
  shows gold as locked and does not offer a toggle for it.
- The same-rarity trade rule stays. A trade still swaps a card for a card of the
  same tier.
