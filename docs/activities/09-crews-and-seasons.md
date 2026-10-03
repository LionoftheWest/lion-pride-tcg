# Crews and Seasons — Design

Status: DRAFT for Nathan's review (2026-10-02). Not built.

The members split into **Crews**. Each mode adds points to the member's Crew. At the end
of a season, the best Crew wins.

## 1. Nathan's decisions (2026-10-02)

1. The teams are called **Crews**.
2. Crews run in **seasons**.
3. Some seasons let the members **pick** a Crew. Other seasons **assign** the members, so
   the Crews are even.
4. **The Crews name themselves.**

## 2. One season for everything (Nathan, 2026-10-02)

The game already uses "season" for the card sets (the Season Releases in the Collection).
**A season covers everything.** A season runs from one card set release to the next. The
Crews, the Arena, the Dungeon season-best, the server season milestones, and the Shop's
Full Art event all use the same season, and they all reset at the next card set release.

The `seasons` table (Section 7) is the one source for the season dates. Every mode reads
it.

## 3. Crews

- **3 or 4 Crews** each season (by the number of active members).
- **Pick seasons:** each member picks a Crew. A Crew that is 30% larger than the smallest
  Crew closes until the others catch up.
- **Assign seasons:** the game spreads the members by their activity and their CP, so
  each Crew gets a similar mix.
- **A Discord role for each Crew**, with a color. The bot needs the Manage Roles
  permission and a role position above the Crew roles (`boons-and-pranks.md` 3B).
- **The Crew name:** the members of a new Crew vote for a name in the first 3 days.
  Each member can suggest one name. The bot filters the suggestions with a word list,
  and Nathan has an admin **Rename** button.

## 4. Crew points

Each mode adds points. The numbers are a proposal.

| Source | Points |
|---|---|
| Dungeon Run | 1 for each room cleared |
| PvP Arena | 3 for each win against a member of another Crew |
| Hunt | 1 for each 1% of the boss HP that the member dealt |
| Wandering Monsters | 2 for each hit on a monster that falls |
| Mini games | 1 to 5, by the score |
| Weekly events | 5 to 20, by the place |

**Fairness by size:** a Crew's score is the average of its **top 8 members** each week,
not the total. A larger Crew does not win only because it is larger, and a few members
who do not play do not hurt their Crew.

## 5. Rewards

- Each week: the leading Crew gets a small Shard bonus for each member who played.
- The end of the season: the winning Crew gets a Den decoration, a title, and a profile
  frame. Every member who played gets Shards by the Crew's place.

## 6. The surface

- A **Crews** view in Community: the standings, this week's points, each Crew's top
  members, and the Crew's name and color.
- The member's Crew color shows on their name in the feed and on the profile.

## 7. Data

- `seasons(id, name, starts_at, ends_at, crew_mode pick|assign)`.
- `crews(id, season_id, name, color, role_id)`.
- `crew_members(season_id, player_id, crew_id, joined_at)`.
- `crew_points(season_id, crew_id, player_id, week, source, points)`.
- `crew_name_votes(crew_id, player_id, name, votes)`.

## 8. Flags and build phases

- Flag `FEATURE_CREWS` and `CREW_USERS`.

1. Seasons and Crews (assign mode), with points from the Hunt and the Dungeon.
2. The pick mode and the name vote.
3. The Discord roles.
4. Points from every other mode as each mode ships.

## 9. Open questions for Nathan

1. 3 or 4 Crews?
2. Can a member change Crews in the middle of a season?
