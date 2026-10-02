# The Den — Design

Status: DRAFT for Nathan's review (2026-10-02). Not built. This is the most expensive
system, and it comes last.

Each member has a **Den**: a small room that they decorate. Other members visit it.

## 1. Nathan's decisions (2026-10-02)

1. The Den is approved. Members customize it.
2. Many cosmetic rewards can decorate it.
3. Den items can give **stat boosts, for PvE only**: the Dungeon, Expeditions, and the
   Hunt. **Never the Arena.**

## 2. The room

- **The first version is a 2D room** (a grid, in a side view or an isometric view), not
  3D. 2D is cheaper to build, and it runs well on phones. A three.js version can come later.
- The member places items on the grid: furniture, a wallpaper, a floor, and decorations.
- **Place cards** that the member owns unlock their room theme as a wallpaper (for
  example, "Palworld Mountain Base").
- **Card frames on the wall:** the member hangs cards that they own. Visitors see them.

## 3. Where the items come from

| Source | Example |
|---|---|
| The Shop (Shards) | furniture, wallpapers |
| Crew season rewards | a Crew banner |
| Server milestones | a season trophy |
| Dungeon rare loot | a monster trophy ("Ancient Slime head") |
| The Fishing Derby | a mounted fish |
| Achievements | a frame or a statue |

## 4. PvE boosts

- Some items carry a small boost. Examples: "Training Dummy: +2% Dungeon damage", "Map
  Table: Expeditions take 5% less time", "4th Expedition slot".
- **A cap:** all Den boosts together add at most **+5%** to any one stat.
- The Arena never reads the Den boosts. A test proves it: the Arena fight result is the
  same with and without a full Den.
- The Hunt boost changes the credited damage, so the Hunt simulation must include it.

## 5. Visits

- A member opens another member's Den from the member profile.
- The visitor can leave a **paw print**: one of a fixed set of stamps (no free text).
- The Den shows the last 10 paw prints.

## 6. Data

- `den_items(id, name, kind, art_url, boost jsonb, source)`.
- `player_den_items(player_id, item_id, count)`.
- `dens(player_id, layout jsonb, theme_card_id, updated_at)`.
- `den_visits(den_owner, visitor_id, stamp, created_at)`.

## 7. Flags and build phases

- Flag `FEATURE_DEN` and `DEN_USERS`.

1. The room, the layout editor, and the Shop items (cosmetic only).
2. Visits and paw prints.
3. The PvE boosts, after the Dungeon and Expeditions exist.

## 8. Open questions for Nathan

1. 2D first: correct?
2. Is +5% the correct cap for the boosts?
