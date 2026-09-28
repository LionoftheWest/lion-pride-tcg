# Lion Pride TCG — UI/UX Design

Status: STARTED 2026-09-27. Owner: Nathan. Tool: pen.dev (`pen` CLI 0.3.9).

This document is the single source for the look and the flow of the Discord Activity
(`tcg-activity/`). Every screen is designed in pen.dev, approved by Nathan, and only
then built. The goal (Nathan): everything looks better, is easier to navigate, and is
animated.

## 1. The process

1. Design one screen in pen.dev. The file goes in `design/<screen>.pen`, and the image
   export in `design/<screen>.png`.
2. Show the image to Nathan. Change it with `pen --in` until he approves it.
3. Mark the screen **Approved** in Section 4, with the date.
4. Build it in the Activity. Show a live preview in Discord. Mark it **Built**.
5. Screen 0 (the design system) comes first. Every later screen uses its colors,
   type, components, and motion, so the app looks like one product.

## 2. Hard rules (from earlier decisions — every design must obey them)

- **It runs inside Discord**, in an embedded frame. The window can be small. Design for
  a desktop Discord window first (about 1280x720), and check a narrow window too.
- **No scrolling** (Nathan, 2026-09-11). Everything fits one window. Long lists page
  (the collection grid pages 2x5), and never scroll.
- **No Room or Pulls tabs.** The main page is the live feed. A voice channel is the room.
  Shared pack opens show inline.
- **Everything happens in the Activity** (Nathan, 2026-09-27). The bot only posts, and
  each post has an "Open Lion Pride TCG" button.
- **The card face does not show tags.** Tags, the ability, the effect, and the stats show
  only in the Card Information view.
- **Big, obvious damage numbers**, never drawn on the cards (Nathan, 2026-09-27).
- **The dark theme stays** (the current palette: near-black panels, gold accents, rarity
  colors). Screen 0 can refine it, but not replace it with a light theme.
- **Rarity colors are a system:** Normal, Illustrated Rare, Secret Rare, Full Art, Gold.
  The effect groups also have colors: Boon (gold), Prank (purple), Neutral (blue).

## 3. What exists today (the inventory)

The main navigation has four views: **Gallery, Trading, Collection, Battling**. A right
sidebar holds the live feed (the community pulls, or the Raid Boss feed during a fight).

| Area | Today | Where in the code |
|---|---|---|
| Shell | Top bar (brand, Open Pack button, gift, bell, trophy, mute), the nav, the right feed sidebar | `index.html`, `main()` |
| Collection | Paged 2x5 grid of owned cards, with filters | `cardTile`, `computeLayout` |
| Card Information | 3D tilt card + name, rarity, lore, Ability, Effect (boon/prank/neutral), Tags, Ascension | `openViewer` |
| Pack opening | Tear, flip, and reveal of 5 cards | `openPacks` |
| Gallery | The season catalog (owned vs missing) and the Raid Boss bestiary | `galleryCards`, `openBossGallery` |
| Trading | Offers in and out, and a trade builder | `openTradeBuilder` |
| Battling: squad | Pick up to 8 cards, Auto-pick, Lock In | `wireSelectPhase` |
| Battling: fight | The 3D boss, the squad row, support cards, the boss turn, the feed | `boss.js`, `resolveHit`, `resolveBossTurn` |
| Battling: cooldown | "Next boss in ..." between hunts | `cooldownHTML` |
| Panels | Gift a pack, Notifications, Leaderboards (collection power, hunt standings), Boss detail | `openGiftPanel`, `openNotifs`, `openBoard`, `openHuntBoard`, `openBossModal` |
| Effects | The member picker, confirm, and the "played on you" banners | `effects-ui.js` |
| Loading | The loader screen | `#loader` |

## 4. Screens and approval status

| # | Screen | Status | Files |
|---|---|---|---|
| 0 | **Design system**: colors, type, rarity + effect colors, buttons, chips, panels, card tile, motion | Not started | `design/00-design-system.pen` |
| 1 | **Shell**: top bar, navigation, feed sidebar | Concept chosen: B navigation (see Section 7) | `design/02-B-home.png` |
| 2 | **Card Information** (including the battle stats, the effect, and ascension) | Not started | |
| 3 | **Collection** grid and filters | Not started | |
| 4 | **Battling: fight** (boss, squad, turns, damage numbers, feed) | Not started | |
| 5 | **Battling: squad select** | Not started | |
| 6 | **Pack opening** and reveal | Not started | |
| 7 | **Gallery** (cards + raid boss bestiary) | Not started | |
| 8 | **Trading** (+ the trade board later) | Not started | |
| 9 | **Effects**: member picker, confirm, "played on you" banners | Not started | |
| 10 | **Panels**: gift, notifications, leaderboards, boss detail | Not started | |
| 11 | **Battling: cooldown** and **Loading** | Not started | |

## 5. Motion (Nathan: "animated as well")

To define in Screen 0, then use everywhere:
- Screen changes: a short slide or fade, never longer than 250ms.
- Panels and modals: scale-in from the button that opened them.
- Card tiles: a lift on hover, and a rarity shimmer on the rare tiers.
- Numbers (damage, power, pack count): count up or pop.
- Respect the operating system's "reduce motion" setting.

## 6. Open questions

- Screen 2 needs the battle stats. Does ascension keep a fixed upgrade, or does it give
  stat points that the player spends? (See the card-stats proposal.)

## 7. Layout decisions (Nathan, 2026-09-27)

From the three concepts (A Arena Rail, B Game Lobby, C Broadcast; `design/02-*.png`):

- **Hunt:** C's look (the cards overlay the boss scene) + A's clarity (the cards laid
  out in a clear row). **No Attack button:** the player taps a card to attack with it,
  so a separate Attack button would confuse. The design must make "tap a card to hit" obvious.
- **Collection:** C's information panel with the stats (Power, HP, Crit, the ability) +
  A's **sets sidebar**, because more card sets will come out.
- **Home:** B, with all its parts. The "Opening together" window becomes a **real-time
  Activity window**: what each player in your voice channel is doing right now (opening
  packs with the cards revealing live, browsing the collection, building a squad,
  attacking the boss, trading, playing a prank).
- **Rarity names stay:** Normal, Illustrated Rare, Secret Rare, Full Art, Gold.
- **Placeholder art** in the designs is only a placeholder.

Work in progress: `design/03-final-v1.pen` (the three combined screens).

## 8. New systems that the designs need (backlog, not built)

| System | Nathan's decision | Notes |
|---|---|---|
| **Real-time Activity window** | Yes (Home) | Needs live presence per member (the Activity already has a voice-channel WebSocket room). Each client reports its current activity; the room broadcasts it. |
| **Streaks** | Yes | Track how many days in a row a player opens packs. Streak rewards, for example extra packs. |
| **Shards (a redeem currency)** | Yes, later | Not "shards" as in the concepts. A currency to redeem the cards that a player wants, and each tier costs more. A whole new economy: design it on its own first. |
| **Showcase** | Yes, later | A player's own showcase of cards. A separate system to design. |

## 9. Decisions on the final v1 screens (Nathan, 2026-09-27)

- **Attack rule:** today's rule stays (one squad per day, each card attacks until it is
  downed). No attack charges.
- **No boss phases** for now.
- **Future seasons:** no dates in the UI. The code keeps a place for more seasons, so a
  new season is easy to add.
- **The card information panel shows everything:** tags, attributes/stats (Power, HP,
  Crit), the boon/prank/neutral effect with its cooldown, the ability, and the artist
  and the credits (the original company for famous characters).
- **Home:** needs a place for the player **Showcase** and other profile things.
- **Collection:** the sets are only the real Season Releases of card packs.
- **Hunt:** show MORE of the boss. The cards are a little smaller. Keep the stat chips
  above each card. A squad is **8 cards**.

Work in progress: `design/05-final-v2.pen`.

## 10. More new systems (backlog, not built)

| System | Nathan's decision | Notes |
|---|---|---|
| **Achievements** ("mini missions") | Yes, later | Tied to set collections: collect certain cards and get extra rewards. |
| **Profile** | Yes, later | The home of the Showcase and other profile things. |

## 11. v3 approved and built (Nathan, 2026-09-27)

Nathan approved `design/08-v3-home.png`, `08-v3-collection.png`, `08-v3-hunt.png`, and
`08-v3-achievements.png` ("I like all of those, lets implement" and "Achievment, I also
approve of this"). The build is PR #10 (`feat/ui-v2`), behind `UI_V2_USERS` /
`FEATURE_UI_V2`.

Built now:
- The shell (top bar + dock), Home, Collection with the card panel, the Achievements view
  (progress only), and the Hunt layout.
- "Live in voice" shows the current activity of each member in the room.

Not built yet (the parts of the designs that need a new system):
- The achievement **rewards** and the Claim button (needs a claim table + RPC).
- The **streak** pill, the **free daily pack**, and the **Showcase** (Section 8 / 10).
- The expected-damage number above each Hunt card (each card shows its power and a ×2 badge for a weakness now).
