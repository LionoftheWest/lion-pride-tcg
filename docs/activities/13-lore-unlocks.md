# Lore Unlocks — Design

Status: DRAFT for Nathan's review (2026-10-02). Not built.

Each card has more story. A member unlocks it by ascending the card.

## 1. Nathan's decisions (2026-10-02)

1. The lore is tied to the card itself, and it unlocks as the member ascends the card.
   For example, at **Silver**.

## 2. The tiers (observed 2026-10-02)

The ascension tiers are Normal (1 star), Bronze (2), Silver (3), Gold (4), and
Prestige (5) (`ASC_TIERS` in `tcg-activity/src/main.js`, about line 3218).

"Gold" is also a rarity. Nathan (2026-10-02): keep the names.

## 3. The chapters

| Tier | What the member sees |
|---|---|
| Any copy | the card's current lore (`cards.lore`), as today |
| **Silver** (3 stars) | **Chapter 2**: more of the story |
| **Prestige** (5 stars) | **Chapter 3**: the end of the story, and a short quote from the card |

- The Card Information view shows a locked chapter as "Unlocks at Silver" with a lock.
- When a member unlocks a chapter, the ascension celebration shows "New lore unlocked".
- The first member to unlock a chapter can get a post: "📜 @A unlocked the secret story of
  **Card**!" (optional, a flag).

## 4. Who writes the lore

- **A draft:** Claude drafts each chapter from the card's name, lore, and tags (the same
  pattern as the boon and prank effects). Nathan edits them in the Card Portal.
- **The member's own card:** many cards show a real member. That member can write the
  chapters of their own card. Nathan approves the text in the portal before it goes live.

## 5. Data

- `subjects.lore_chapters jsonb`: `[{ "unlock": 3, "text": "..." }, { "unlock": 5,
  "text": "...", "quote": "..." }]`.
- The portal edits it (the portal is the only edit surface). `push.js` writes it.
- The server sends a chapter's text only if the member's copy has the required stars.
  A locked chapter never reaches the client.

## 6. Flags and build phases

- Flag `FEATURE_LORE_CHAPTERS`.

1. The field, the portal editor, and the locked view.
2. The drafts for all cards, for Nathan's edit.
3. The member-written chapters and the post.

## 7. Open questions for Nathan

1. Two chapters (Silver and Prestige), or one at Silver only?
