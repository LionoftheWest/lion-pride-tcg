-- effects_spread.sql (2026-10-03, Nathan's decisions on the fxdraft 1-duplicates.md + 2-wording.md).
-- STACKS ON effects_outside.sql (PR #144): apply that file first.
-- The bot side is tcg-bot/src/discord-effects.ts; the Activity side is the avatar mustache (effects-ui.js).
--  a. effect_primitives: 5 new Discord pranks, all DISABLED (fail closed):
--       slowmode       the bot deletes a message the target sends less than amount s (30) after their
--                      last one, for 5 minutes (the bot role has Manage Messages; checked 2026-10-03)
--       hot_take_poll  a 1-hour Discord poll about the target (fixed question and answers from the card)
--       body_swap      the target and the sender swap Discord names for 1 hour
--       parrot         the bot repeats the target's next message once, with a parrot (waits up to 48 h)
--       spongebob      the bot repeats it once in mOcKiNg case (waits up to 48 h)
--     parrot / spongebob need the Message Content intent (on in the Developer Portal; the bot asks for it
--     from this PR). Enable each one after the bot deploy (see the PR):
--       update effect_primitives set enabled = true where primitive in ('slowmode', 'hot_take_poll', 'body_swap', 'parrot', 'spongebob');
--  b. subjects.effect of every card with an effect (96), from card-studio/cards.json (the same as
--     push-effects.mjs): the moves (no primitive on more than 5 subjects, no duplicate effect name) and
--     the new wording. Written by fxdraft/gen-spread-sql.mjs; matched by subjects.key.
-- No function changes: play_card_effect() already sends a 'discord' primitive to discord_effects with
-- revert_at = start + duration, and bot_work() already counts a pending row and an ended row.

-- a. The effect types. A row that exists keeps its "enabled"; a new one starts off.
insert into public.effect_primitives (primitive, kind, channel, max_amount, max_duration_s, stacks, enabled, note) values
  ('slowmode',      'prank', 'discord', 45,   300,    false, false, 'the bot deletes a message sent less than amount s after the last one, for 5 min (needs Manage Messages)'),
  ('hot_take_poll', 'prank', 'discord', null, 3600,   false, false, 'a 1-hour Discord poll about the target, the question and answers from the card'),
  ('body_swap',     'prank', 'discord', null, 3600,   false, false, 'the target and the sender swap Discord names for 1 h'),
  ('parrot',        'prank', 'discord', null, 172800, false, false, 'the bot repeats the next chat message once, with a parrot (waits up to 48 h; Message Content)'),
  ('spongebob',     'prank', 'discord', null, 172800, false, false, 'the bot repeats the next chat message once in mocking case (waits up to 48 h; Message Content)')
on conflict (primitive) do update set kind = excluded.kind, channel = excluded.channel, max_amount = excluded.max_amount,
  max_duration_s = excluded.max_duration_s, stacks = excluded.stacks, note = excluded.note;

-- b. Every card's effect (every rarity of a subject shares it). Each key must match exactly 1 subject and
-- each primitive must exist; afterwards no primitive may have more than 5 subjects and no two subjects
-- may share an effect name (the acceptance test checks the same: test-effects-spread.mjs).
do $b$
declare r record; n int; v text;
begin
  for r in select * from (values
    ('mr-mob-s-mr-mime', '{"primitive":"reflect","name":"Barrier","desc":"The next prank sent to the target bounces back to its sender. Works once, within 1 day.","base":{"duration_s":86400},"cooldown_h":24}'::jsonb),
    ('blastninja-s-blastoise', '{"primitive":"ward","name":"Shell Shield","desc":"Blocks the next prank sent to the target. Works once, within 1 day.","base":{"duration_s":86400},"cooldown_h":18}'::jsonb),
    ('beetle-s-cloud', '{"primitive":"mustache","name":"Grown-Up Stache","desc":"Draws a big mustache on the target''s profile picture everywhere in the game, and on their showcase cards, for 1 day.","base":{"duration_s":86400},"cooldown_h":12}'::jsonb),
    ('kaminari-s-incineroar', '{"primitive":"mend","name":"Hug It Out","desc":"Heals 20 HP on the target''s next hurt Hunt card.","base":{"amount":20},"cooldown_h":12}'::jsonb),
    ('grim-s-jigglypuff', '{"primitive":"vc_deafen","name":"Lullaby","desc":"Deafens the target in voice for 30 seconds. If they are not in voice, it waits up to 48 hours.","base":{"duration_s":30},"cooldown_h":24}'::jsonb),
    ('grim-s-pokemon-trainer', '{"primitive":"heckle","name":"Heckle","desc":"The bot replies once to the target''s next Discord message with a heckle from this card. Works within 48 hours.","base":{"duration_s":172800},"options":{"lines":["🎤 A wild heckler appeared!","🎤 That message used Splash. Nothing happened.","🎤 It''s not very effective...","🎤 Professor Oak says: there is a time and place for everything. Not now!","🎤 Your rival already said that, but better."]},"cooldown_h":12}'::jsonb),
    ('keeb-s-mii-gunner', '{"primitive":"vc_mute","name":"Out of Ammo","desc":"Mutes the target in voice for 30 seconds. If they are not in voice, it waits up to 48 hours.","base":{"duration_s":30},"cooldown_h":24}'::jsonb),
    ('notjosh-s-random-pick', '{"primitive":"lucky_pull","name":"Random Pick","desc":"The first card of the target''s next pack is twice as likely to be rare.","base":{"amount":2},"cooldown_h":24}'::jsonb),
    ('wiifu-s-wiifit-trainer', '{"primitive":"upside_down","name":"Salute the Sun","desc":"The target''s game screen flips into a yoga pose for 80 seconds, from their next visit.","base":{"duration_s":80},"cooldown_h":12}'::jsonb),
    ('bonzan-s-donkey-kong', '{"primitive":"timeout","name":"Speechless","desc":"Times the target out in Discord for 1 minute: no typing and no talking.","base":{"duration_s":60},"cooldown_h":24}'::jsonb),
    ('rad-dad-s-ness', '{"primitive":"photobomb","name":"Twinning","desc":"This card photobombs the target''s next pack opening. If that pack has a rare pull, its Discord post says \"photobombed by <you>\".","cooldown_h":12}'::jsonb),
    ('xeno-s-blueprint', '{"primitive":"decoy","name":"Scale Model","desc":"The next prank sent to the target hits a cardboard cutout instead. Works once, within 1 day.","base":{"duration_s":86400},"cooldown_h":18}'::jsonb),
    ('zeoic-s-redstone-machine', '{"primitive":"decoy","name":"Dummy Bot","desc":"The next prank sent to the target hits a robot dummy instead. Works once, within 1 day.","base":{"duration_s":86400},"cooldown_h":18}'::jsonb),
    ('alydoor-s-cafe', '{"primitive":"redirect","name":"Wrong Order","desc":"The next prank sent to the target goes to a random member instead. Works once, within 1 day.","base":{"duration_s":86400},"cooldown_h":18}'::jsonb),
    ('fluffy-s-repo', '{"primitive":"reaction_storm","name":"Last One Alive","desc":"The bot reacts 💀 to the target''s next 5 Discord messages, within 1 hour.","base":{"amount":5,"duration_s":3600},"cooldown_h":12,"options":{"emoji":"💀"}}'::jsonb),
    ('notjosh-s-waluigi', '{"primitive":"fake_gold","name":"Maybe in Smash 6","desc":"The target''s next pack flashes gold like a Gold pull, then shows the real cards.","cooldown_h":12}'::jsonb),
    ('zeoic-the-server-master', '{"primitive":"spotlight_role","name":"Server Host","desc":"Gives the target the ✨ Spotlight role in Discord for 1 day: their name shows at the top of the member list.","base":{"duration_s":86400},"cooldown_h":24}'::jsonb),
    ('baego', '{"primitive":"spotlight_role","name":"Better Side","desc":"Gives the target the ✨ Spotlight role in Discord for 1 day: their name shows at the top of the member list.","base":{"duration_s":86400},"cooldown_h":24}'::jsonb),
    ('ling-ling-s-talonflame', '{"primitive":"jinx","name":"Haunted Pack","desc":"Talonflame haunts the target''s next pack: a spooky look and sound. The cards do not change.","cooldown_h":12}'::jsonb),
    ('i-m-a-tree', '{"primitive":"reflect","name":"Tree Bark","desc":"The next prank sent to the target bounces back to its sender. Works once, within 1 day.","base":{"duration_s":86400},"cooldown_h":24}'::jsonb),
    ('mr-mobs-dirt-house', '{"primitive":"clown_role","name":"It Ain''t Much","desc":"Gives the target the 🤡 Clown role in Discord for 1 hour.","base":{"duration_s":3600},"cooldown_h":12}'::jsonb),
    ('king-of-the-swamp', '{"primitive":"nickname","name":"MY SWAMP","desc":"Renames the target in Discord (for example \"Swamp <name>\") for 1 hour.","base":{"duration_s":3600},"cooldown_h":12,"options":{"nicknames":["{name} of the Swamp","Swamp {name}","Shrek {name}"]}}'::jsonb),
    ('mr-mobs-mew', '{"primitive":"slow_motion","name":"Too Many Buttons","desc":"The target''s next pack opens in slow motion. The cards do not change.","cooldown_h":12}'::jsonb),
    ('long-live-the-king', '{"primitive":"crown","name":"Long Live the King","desc":"Puts a 👑 in front of the target''s Discord nickname for 1 hour.","base":{"duration_s":3600},"cooldown_h":24}'::jsonb),
    ('lionofthewest-s-dodrio', '{"primitive":"slow_motion","name":"Still Loading","desc":"The target''s next pack opens in slow motion. The cards do not change.","cooldown_h":12}'::jsonb),
    ('onyen-tutoring', '{"primitive":"rally","name":"Master Class","desc":"The target''s next Hunt attack deals 15% more damage.","base":{"amount":15},"cooldown_h":12}'::jsonb),
    ('up-b-oos', '{"primitive":"upside_down","name":"UP B OOS","desc":"The target''s game screen flips upside down for 80 seconds. It starts the next time they open the game.","base":{"duration_s":80},"cooldown_h":12}'::jsonb),
    ('grudge-match', '{"primitive":"title","name":"Rivalry","desc":"Adds a title to the target''s Discord nickname (for example \"<name> · Sworn Rival\") for 1 hour.","base":{"duration_s":3600},"cooldown_h":12,"options":{"titles":["the Grudge Holder","Sworn Rival","Runback Requester"]}}'::jsonb),
    ('mr-worldwide', '{"primitive":"nickname","name":"Worldwide","desc":"Renames the target in Discord (for example \"Worldwide <name>\") for 1 hour.","base":{"duration_s":3600},"options":{"nicknames":["Worldwide {name}","Mr. Worldwide {name}","{name} (Dale!)"]},"cooldown_h":12}'::jsonb),
    ('wiifu-s-bowling-ball', '{"primitive":"vc_mute","name":"Gutter Ball","desc":"Mutes the target in voice for 30 seconds. If they are not in voice, it waits up to 48 hours.","base":{"duration_s":30},"cooldown_h":24}'::jsonb),
    ('gym-rat-lion', '{"primitive":"mend","name":"Recovery Drink","desc":"Heals 20 HP on the target''s next hurt Hunt card.","base":{"amount":20},"cooldown_h":12}'::jsonb),
    ('memelord-lion', '{"primitive":"googly_eyes","name":"Meme Warfare","desc":"Googly eyes cover all the target''s card art for 80 seconds. It starts the next time they open the game.","base":{"duration_s":80},"cooldown_h":12}'::jsonb),
    ('the-dad-gaming', '{"primitive":"hype","name":"TDG Crew","desc":"The bot posts a hype message about the target in Discord, with this card''s art.","cooldown_h":24}'::jsonb),
    ('mrs-lionofthewest', '{"primitive":"color_role","name":"Her Color","desc":"The target picks a name color in the game. Their Discord name shows it for 1 day.","base":{"duration_s":86400},"cooldown_h":24}'::jsonb),
    ('modded-vs-vanilla', '{"primitive":"cleanse","name":"Back to Vanilla","desc":"Ends every prank on the target right now, in the game and in Discord.","cooldown_h":12}'::jsonb),
    ('create-a-colony', '{"primitive":"cleanse","name":"Fresh Start","desc":"Ends every prank on the target right now, in the game and in Discord.","cooldown_h":12}'::jsonb),
    ('cockroachs-never-die', '{"primitive":"mend","name":"Still Alive","desc":"Heals 20 HP on the target''s next hurt Hunt card.","base":{"amount":20},"cooldown_h":12}'::jsonb),
    ('super-battle-golf-flash-bang', '{"primitive":"confetti","name":"Flash Bang","desc":"A flash of this card''s confetti covers the target''s screen the next time they open the game.","cooldown_h":3}'::jsonb),
    ('call-of-dragons', '{"primitive":"parrot","name":"World Chat","desc":"The bot repeats the target''s next Discord message as a reply, with a 🦜. Works once, within 48 hours.","base":{"duration_s":172800},"cooldown_h":12}'::jsonb),
    ('australian-connections', '{"primitive":"slowmode","name":"Lag Spike","desc":"Puts the target in slowmode in Discord for 5 minutes: the bot deletes any message sent less than 30 seconds after their last one.","base":{"amount":30,"duration_s":300},"cooldown_h":12}'::jsonb),
    ('4-in-the-pink', '{"primitive":"lucky_pull","name":"In the Pink","desc":"The first card of the target''s next pack is twice as likely to be rare.","base":{"amount":2},"cooldown_h":24}'::jsonb),
    ('krool-name-swap', '{"primitive":"body_swap","name":"Name Swap","desc":"You and the target swap Discord names for 1 hour.","base":{"duration_s":3600},"cooldown_h":12}'::jsonb),
    ('fluffy-s-repo-clutch', '{"primitive":"cleanse","name":"Clutch Save","desc":"Ends every prank on the target right now, in the game and in Discord.","cooldown_h":12}'::jsonb),
    ('30-dantucker-pings', '{"primitive":"ping_parade","name":"30 Pings","desc":"The bot @mentions the target 3 times in Discord over 5 minutes. The post is only the mention.","base":{"amount":3,"duration_s":300},"cooldown_h":24}'::jsonb),
    ('lazy-sd', '{"primitive":"upside_down","name":"Self Destruct","desc":"The target''s game screen turns upside down for 80 seconds. It starts the next time they open the game.","base":{"duration_s":80},"cooldown_h":12}'::jsonb),
    ('the-server-crashed', '{"primitive":"fog","name":"Server Crash","desc":"The target''s cards show ??? for 80 seconds. It starts the next time they open the game.","base":{"duration_s":80},"cooldown_h":12}'::jsonb),
    ('failed-wordle', '{"primitive":"fog","name":"Stupid Word","desc":"The target''s cards show ??? for 80 seconds. It starts the next time they open the game.","base":{"duration_s":80},"cooldown_h":12}'::jsonb),
    ('gerudo-fight-club', '{"primitive":"googly_eyes","name":"Suavemente","desc":"Googly eyes cover the target''s card art for 80 seconds. It starts the next time they open the game.","base":{"duration_s":80},"cooldown_h":12}'::jsonb),
    ('whats-a-c3', '{"primitive":"redirect","name":"Pass the Blame","desc":"The next prank sent to the target goes to a random member instead. Works once, within 1 day.","base":{"duration_s":86400},"cooldown_h":18}'::jsonb),
    ('build-a-house-mime', '{"primitive":"ward","name":"Two Walls","desc":"Blocks the next prank sent to the target. Works once, within 1 day.","base":{"duration_s":86400},"cooldown_h":18}'::jsonb),
    ('b-button-spam', '{"primitive":"ping_parade","name":"B...B...B...","desc":"The bot @mentions the target 3 times in Discord over 5 minutes. The post is only the mention.","base":{"amount":3,"duration_s":300},"cooldown_h":24}'::jsonb),
    ('panda-express-run', '{"primitive":"hype","name":"Brisket Run","desc":"The bot posts a hype message about the target in Discord, with this card''s art.","cooldown_h":24}'::jsonb),
    ('better-in-cancun', '{"primitive":"delay","name":"Out of Office","desc":"The next prank sent to the target arrives 1 hour late. Works once, within 1 day.","base":{"duration_s":86400},"cooldown_h":18}'::jsonb),
    ('smash-server-hamster-wheel', '{"primitive":"fog","name":"Communication Error","desc":"The target''s cards show ??? for 80 seconds. It starts the next time they open the game.","base":{"duration_s":80},"cooldown_h":12}'::jsonb),
    ('ketchup-on-hotdogs', '{"primitive":"title","name":"Condiment Crime","desc":"Adds a title to the target''s Discord nickname (for example \"<name> · Hot Dog Heretic\") for 1 hour.","base":{"duration_s":3600},"cooldown_h":12,"options":{"titles":["the Ketchup Criminal","Hot Dog Heretic","Mustard Denier"]}}'::jsonb),
    ('pineapple-on-pizza', '{"primitive":"reaction_storm","name":"Pizza Crime","desc":"The bot reacts 🍍 to the target''s next 5 Discord messages, within 1 hour.","base":{"amount":5,"duration_s":3600},"options":{"emoji":"🍍"},"cooldown_h":12}'::jsonb),
    ('xeno-s-unfinished-project', '{"primitive":"delay","name":"Coming Soon","desc":"The next prank sent to the target arrives 1 hour late. Works once, within 1 day.","base":{"duration_s":86400},"cooldown_h":18}'::jsonb),
    ('lorcana-prices', '{"primitive":"spongebob","name":"Go Back to Pokemon","desc":"The bot repeats the target''s next Discord message in mocking SpongeBob case (lIkE tHiS). Works once, within 48 hours.","base":{"duration_s":172800},"cooldown_h":12}'::jsonb),
    ('mob-s-hiding-spot-meccha', '{"primitive":"squeaky","name":"Squeaky Entrance","desc":"The next time the target joins voice (within 48 hours), the bot posts \"<name> squeaked in\" in that voice chat.","base":{"duration_s":172800},"cooldown_h":12}'::jsonb),
    ('polar-bear-build', '{"primitive":"ward","name":"Ice Wall","desc":"Blocks the next prank sent to the target. Works once, within 1 day.","base":{"duration_s":86400},"cooldown_h":18}'::jsonb),
    ('meta-abuser', '{"primitive":"title","name":"Tier List","desc":"Adds a title to the target''s Discord nickname (for example \"<name> · Tier List Victim\") for 1 hour.","base":{"duration_s":3600},"cooldown_h":12,"options":{"titles":["the Meta Abuser","Tier List Victim","Carried"]}}'::jsonb),
    ('sunny-s-duck-feet', '{"primitive":"rubber_chicken","name":"Quack","desc":"Every sound in the target''s game is a quack for 80 seconds. It starts the next time they open it.","base":{"duration_s":80},"cooldown_h":12}'::jsonb),
    ('xeno-s-stone-shovel', '{"primitive":"butterfingers","name":"Butterfingers","desc":"The target''s next Hunt attack deals 15% less damage.","base":{"amount":15,"duration_s":172800},"cooldown_h":12}'::jsonb),
    ('geats', '{"primitive":"swap_showcase","name":"Price of Fame","desc":"The target''s showcase shows a random Normal card for 1 day.","base":{"duration_s":86400},"cooldown_h":12}'::jsonb),
    ('tuesday-shenanigans', '{"primitive":"confetti","name":"Game Night","desc":"This card''s art bursts as confetti on the target''s screen the next time they open the game.","cooldown_h":3}'::jsonb),
    ('smash-tag-check', '{"primitive":"spotlight_role","name":"Verified","desc":"Gives the target the ✨ Spotlight role in Discord for 1 day, at the top of the member list.","base":{"duration_s":86400},"cooldown_h":24}'::jsonb),
    ('the-weekly-poll', '{"primitive":"hot_take_poll","name":"Poll Results","desc":"The bot posts a 1-hour Discord poll about the target. The question and the answers come from this card.","base":{"duration_s":3600},"options":{"question":"This week''s poll: what is {name}''s vibe?","answers":["Main character","Side quest","NPC","Final boss"]},"cooldown_h":24}'::jsonb),
    ('call-hr', '{"primitive":"timeout","name":"Call HR!","desc":"Times the target out in Discord for 1 minute: no typing and no talking.","base":{"duration_s":60},"cooldown_h":24}'::jsonb),
    ('post-it-note-tournament', '{"primitive":"ping_parade","name":"Bam Bam Bam","desc":"The bot @mentions the target 3 times in Discord over 5 minutes.","base":{"amount":3,"duration_s":300},"cooldown_h":24}'::jsonb),
    ('kroc-bot', '{"primitive":"fanfare","name":"Peaches Fanfare","desc":"The next time the target joins voice (within 48 hours), the bot posts a fanfare for them in that voice chat.","base":{"duration_s":172800},"cooldown_h":24}'::jsonb),
    ('the-best-sauce-is', '{"primitive":"hot_take_poll","name":"Sauce Boss","desc":"The bot posts a 1-hour Discord poll: \"Is <name> the Sauce Boss?\" The answers are fixed.","base":{"duration_s":3600},"options":{"question":"Is {name} the Sauce Boss?","answers":["Sauce Boss 👑","Sauce Criminal","Ranch Defender"]},"cooldown_h":24}'::jsonb),
    ('frick', '{"primitive":"rubber_chicken","name":"Censored","desc":"Every sound in the target''s game is bleeped with a squeak for 80 seconds, from their next visit.","base":{"duration_s":80},"cooldown_h":12}'::jsonb),
    ('enter-foxtrot', '{"primitive":"rally","name":"Tag Him In","desc":"The target''s next Hunt attack deals 15% more damage.","base":{"amount":15},"cooldown_h":12}'::jsonb),
    ('tasty-little-morsel', '{"primitive":"reaction_storm","name":"Look Out","desc":"The bot reacts 👀 to the target''s next 5 Discord messages, within 1 hour.","base":{"amount":5,"duration_s":3600},"cooldown_h":12,"options":{"emoji":"👀"}}'::jsonb),
    ('the-timezone-chart', '{"primitive":"clown_role","name":"Taps the Sign","desc":"Gives the target the 🤡 Clown role in Discord for 1 hour.","base":{"duration_s":3600},"cooldown_h":12}'::jsonb),
    ('2-week-game-fever', '{"primitive":"confetti","name":"Fever","desc":"This card''s art bursts as confetti on the target''s screen the next time they open the game.","cooldown_h":3}'::jsonb),
    ('palworld-mountain-base', '{"primitive":"mend","name":"Base Camp","desc":"Heals 20 HP on the target''s next hurt Hunt card.","base":{"amount":20},"cooldown_h":12}'::jsonb),
    ('hole-in-one', '{"primitive":"lucky_pull","name":"Lucky Shot","desc":"The first card of the target''s next pack is twice as likely to be rare.","base":{"amount":2},"cooldown_h":24}'::jsonb),
    ('crew-battle', '{"primitive":"rally","name":"Crew Hype","desc":"The target''s next Hunt attack deals 15% more damage.","base":{"amount":15},"cooldown_h":12}'::jsonb),
    ('cocky-little-freak', '{"primitive":"title","name":"Cocky","desc":"Adds a title to the target''s Discord nickname (for example \"<name> · the Cocky One\") for 1 hour.","base":{"duration_s":3600},"cooldown_h":12,"options":{"titles":["Cocky Little Freak","the Cocky One"]}}'::jsonb),
    ('shave-your-head', '{"primitive":"streak_shield","name":"Stream Saver","desc":"If the target misses one daily check-in, their streak stays. Works once, within 14 days.","base":{"duration_s":1209600,"amount":1},"cooldown_h":72}'::jsonb),
    ('patooie', '{"primitive":"redirect","name":"Patooie!","desc":"The next prank sent to the target gets spat at a random member instead. Works once, within 1 day.","base":{"duration_s":86400},"cooldown_h":18}'::jsonb),
    ('foxtrots-one-weakness', '{"primitive":"jinx","name":"She''s Here","desc":"The target''s next pack opens haunted, with a spooky look and sound. The cards do not change.","cooldown_h":12}'::jsonb),
    ('blade-s-beans-on-toast', '{"primitive":"hype","name":"Breakfast of Champions","desc":"The bot posts a hype message about the target in Discord, with this card''s art.","cooldown_h":24}'::jsonb),
    ('well-well-well', '{"primitive":"photobomb","name":"Well Well Well","desc":"This card photobombs the target''s next pack opening. If that pack has a rare pull, its Discord post says \"photobombed by <you>\".","cooldown_h":12}'::jsonb),
    ('i-ll-get-it-back-don-t-worry', '{"primitive":"rally","name":"Comeback","desc":"The target''s next Hunt attack deals 15% more damage.","base":{"amount":15},"cooldown_h":12}'::jsonb),
    ('oh-naur', '{"primitive":"googly_eyes","name":"Oh Naur","desc":"Googly eyes cover the target''s card art for 80 seconds. It starts the next time they open the game.","base":{"duration_s":80},"cooldown_h":12}'::jsonb),
    ('soggy-bread', '{"primitive":"reaction_storm","name":"Soggy","desc":"The bot reacts 💧 to the target''s next 5 Discord messages, within 1 hour.","base":{"amount":5,"duration_s":3600},"options":{"emoji":"💧"},"cooldown_h":12}'::jsonb),
    ('otto-the-electoral-college', '{"primitive":"hot_take_poll","name":"Recount","desc":"The bot posts a 1-hour Discord poll: \"Should we recount <name>''s votes?\" The answers are fixed.","base":{"duration_s":3600},"options":{"question":"Should we recount {name}''s votes?","answers":["Recount!","Certify it","Schrödinger''s ballot"]},"cooldown_h":24}'::jsonb),
    ('discord-pizza-party', '{"primitive":"fanfare","name":"Pizza Party","desc":"The next time the target joins voice (within 48 hours), the bot throws them a pizza party in that voice chat.","base":{"duration_s":172800},"options":{"line":"🍕 {target} is here, and so is the pizza! (Pizza Party from {sender})"},"cooldown_h":24}'::jsonb),
    ('thechamp', '{"primitive":"spotlight","name":"The Champ","desc":"The target''s name glows gold in the game for 1 day.","base":{"duration_s":86400},"cooldown_h":24}'::jsonb),
    ('gordo-s-min-min', '{"primitive":"color_role","name":"ARMS Colors","desc":"The target picks a name color in the game. Their Discord name shows it for 1 day.","base":{"duration_s":86400},"cooldown_h":24}'::jsonb),
    ('pk-austin-s-ganondorf', '{"primitive":"mustache","name":"Gerudo Stache","desc":"Draws a big mustache on the target''s profile picture everywhere in the game, and on their showcase cards, for 1 day.","base":{"duration_s":86400},"cooldown_h":12}'::jsonb),
    ('tantaco-s-mythra-pyra', '{"primitive":"color_role","name":"Blade Colors","desc":"The target picks a name color in the game. Their Discord name shows it for 1 day.","base":{"duration_s":86400},"cooldown_h":24}'::jsonb),
    ('launch-day-raider', '{"primitive":"raid_crasher","name":"Raid Crasher","base":{"uses":3,"amount":25},"cooldown_h":168,"desc":"The target''s next 3 Hunt attacks hit the boss 25% harder. That extra damage counts for your score (the prankster), not for the target''s."}'::jsonb),
    ('launch-day-player', '{"primitive":"launch_party","name":"Launch Party","desc":"The target''s next 8 Hunt attacks each deal 20% more damage.","base":{"uses":8,"amount":20},"cooldown_h":168}'::jsonb)
  ) v(key, effect) loop
    select count(*) into n from subjects where key = r.key;
    if n <> 1 then raise exception 'effects_spread: subject % matches % rows (want 1)', r.key, n; end if;
    if not exists (select 1 from effect_primitives where primitive = r.effect->>'primitive') then
      raise exception 'effects_spread: % has the unknown primitive %', r.key, r.effect->>'primitive';
    end if;
    update subjects set effect = r.effect where key = r.key;
  end loop;
  select effect->>'primitive' into v from subjects where effect is not null group by 1 having count(*) > 5 limit 1;
  if v is not null then raise exception 'effects_spread: % is on more than 5 subjects', v; end if;
  select effect->>'name' into v from subjects where effect is not null group by 1 having count(*) > 1 limit 1;
  if v is not null then raise exception 'effects_spread: the effect name % is on more than 1 subject', v; end if;
end $b$;

notify pgrst, 'reload schema';
