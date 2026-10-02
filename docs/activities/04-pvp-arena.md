# PvP Arena — Design

Status: DRAFT for Nathan's review (2026-10-02). Not built.

Each member sets a **defense squad**. Other members attack it with their **attack squad**.
The attacker plays live. A smart AI plays the defense. Wins and losses move a rating.

## 1. Nathan's decisions (2026-10-02)

1. The attacker plays live. The defender is an AI.
2. **The AI must be smart:** a look-ahead search (Section 4).
3. **Bots** ("Arena Guards") fill the ladder, so members can climb when few members play.
4. The points scale with the difference. A high-CP member who beats a low-CP member gets
   few points. A low-CP member who beats a high-CP member gets many points.
5. **A daily limit on fights**, so members pick their fights.
6. Matchmaking by rating, and each opponent shows its squad CP (Section 3).
7. **5 cards** in each squad, the same as the Dungeon (Nathan, 2026-10-02).
8. No boons or pranks in the Arena (the first version).
9. The stack stays free (`02-fight-engine.md`, Section 5).

## 2. The squads

- **5 cards** in each squad.
- No budget. The CP difference in the points (Section 5) balances the rarity.
- The defense squad has a **stance**, which the defender picks:
  - **Balanced** (the default),
  - **Focus**: attack the attacker's strongest card first,
  - **Protect**: keep the defender's best card alive,
  - **Aggressive**: use every support card as soon as it is ready.

  The stance changes the score that the AI gives each action. The defender makes a real
  decision while they are offline.
- A copy in the defense squad is busy. It cannot go on an Expedition. If a member trades
  or sells it, the defense squad loses that card, and the game asks the member to fill
  the gap.

## 3. Matchmaking

1. The attacker opens the Arena. The game shows **3 opponents** near the attacker's
   rating: one a little lower, one near, and one a little higher.
2. Each opponent shows the name, the rating, the league, and the squad CP. It does not
   show the cards.
3. If fewer than 3 members are near the rating, Arena Guards (bots) fill the list.
4. A **Refresh** button gives 3 new opponents, 3 times each day.

Why rating and not only squad power: squad power measures the cards, not the skill. With
power only, the best player stays in one band, a strong player can field a weak squad to
win easy fights, and a narrow band has no opponent when few members play. The CP shows in
the list, and it scales the points, so the attacker makes a strategy choice: a safe fight
for few points, or an upset for many.

## 4. The defender AI

The server runs the AI with the shared engine (`02-fight-engine.md`).

1. **The candidate actions.** At each defender turn, the AI lists every legal action:
   each support card on each target, and each attack on each target.
2. **The look-ahead.** For each action, the AI plays the fight forward a few turns, many
   times, with random dice and a simple model of the attacker. This is a Monte-Carlo
   search.
3. **The score.** Each result gets a score: the HP that each side has left, the cards
   that are down, and the stance weights.
4. **The pick.** The AI picks the action with the best average score.
5. **The budget.** Each decision stops at 50 ms and uses the best action so far.

The bots use the same AI with a shorter look-ahead, so a low bot is easier than a member.

The fight is deterministic: the seed and the actions replay it exactly. The defender can
watch the replay later.

## 5. The rating and the points

- **Elo.** Each member starts at 1000. The rating gap sets the expected result, so an upset
  gives many points and an expected win gives few.
- **The CP factor.** The points then scale with the squad CP ratio (a proposal):
  `factor = clamp(sqrt(defender_cp / attacker_cp), 0.5, 2.0)`.
- **The attacker** gets `+K x (1 - expected) x factor` for a win and
  `-K x expected / factor` for a loss, with `K = 32`.
- **The defender** gets half of those amounts in the other direction.
- **Protection for an offline defender:**
  - a defender can lose at most **60 points each day** on defense,
  - after a defense loss, the defender has a **2-hour shield**: nobody can attack them.
- A bot's rating moves too, so the bots stay at the correct level.

## 6. The daily limit

- **5 attack tickets each day**, reset at midnight MT. A fight against a bot uses a
  ticket too, or a member could farm the bots.
- **Revenge:** when a member beats your defense, a **Revenge** button attacks that member
  back. It still uses a ticket.

## 6A. A small member pool (Nathan, 2026-10-02)

Nathan's concern: members have more chances to attack than to defend. With a small
member pool, every member gets attacked, and then the Arena goes quiet.

**The math (an estimate):** with 10 active members and 5 tickets each, the server has 50
attacks each day, or about 5 for each defender. A defense squad is not used up, and the
2-hour shield removes a defender for only a short time. So the targets do not run out.
The real risk is **stale matchups**: the same few opponents every day.

The fixes:

1. **Echoes.** The game keeps a snapshot of each member's defense squad each time the
   member changes it, for the last 4 weeks. An echo is an extra target: "Echo of @B
   (last week)". A win against an echo gives the attacker points, but it does not change
   B's rating. Each member then gives several targets, not one.
2. **Bots are always in the list.** The 3 opponents always include at least one Arena
   Guard, so an attacker always has a fresh target.
3. **One attack for each pair each day.** An attacker can attack the same member (or the
   same echo) at most once each day. Revenge is the one exception.
4. **The daily Arena rule.** The seed sets a rule each day, the same as the Dungeon: "Fire
   cards +25%", "Supports cool down 1 round faster", "No healing". The same matchup plays
   differently each day.
5. **The defense report.** Each day, the defender gets a report in the bell: "You were
   attacked 4 times today and won 3. Watch the replays." The report brings the defender
   back to change the squad, so the targets change too.

Revenge, the echoes, and the daily rule all use the shared engine, so they add no new
fight code.

## 7. Leagues and seasons

The Arena season is the game season: it runs from one card set release to the next
(`09-crews-and-seasons.md`).


- Leagues by rating: Bronze, Silver, Gold, Platinum, Champion (the names are a proposal).
- At the end of each season, each rating moves halfway back to 1000.
- The season reward by league: Shards, a title, and a profile frame.

## 8. Posts

- "⚔️ **@A** broke through **@B**'s defense!" with the **Open Lion Pride TCG** button and a
  **Revenge** reminder for B. Flag `FEATURE_ARENA_POSTS`.
- A weekly post: the top 5 of the ladder.

## 9. Data

- `arena_defense(player_id primary key, cards bigint[], stance text, cp int, updated_at)`.
- `arena_ratings(player_id, season, rating, wins, losses, def_wins, def_losses,
  def_lost_today, shield_until, tickets_used, tickets_day)`.
- `arena_bots(id, name, rating, cards jsonb, depth int)`.
- `arena_echoes(id, player_id, cards jsonb, stance, cp, rating, created_at)`. Pruned after
  4 weeks.
- `arena_days(day, seed, rule jsonb)`. The daily Arena rule.
- `arena_fights(id, attacker_id, defender_id, bot_id, seed, actions jsonb, result,
  att_delta, def_delta, created_at)`. Pruned after each season.
- `arena_finish(p_fight)` writes the result, the ratings, and the Shards in one
  transaction. The server calls it only after the engine replays the fight from the
  stored actions.

## 10. The surface

- An **Arena** view: the member's rating and league, the defense squad (edit, stance),
  the 3 opponents, the tickets left, and the recent defenses with a **Watch** button.
- The fight screen: the same layout as the Dungeon fight, with the defender's cards on
  the other side.
- The replay screen: plays a stored fight at 2x speed.

## 11. Flags and build phases

- Flag `FEATURE_ARENA` and `ARENA_USERS`.

1. The benchmark: the AI inside the 50 ms budget on the VM.
2. The bots and fights against bots only.
3. The member defense squads, the ratings, and the matchmaking.
4. The replays and the posts.
5. The leagues and the season reset.

## 12. Open questions for Nathan

Approved (2026-10-02): 5 tickets, the 2-hour shield, a defense loss limit of 60 points
each day, and 4 weeks of echoes.

1. The league names: Bronze, Silver, Gold, Platinum, Champion. Keep them?
