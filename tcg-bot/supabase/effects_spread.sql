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
--  c. the refund: card_plays outcome 'refunded' + refund_card_play(); play_card_effect() leaves a refunded
--     play out of the daily caps. No other function changes (not hunt_attack, hunt_support, lock_hunt_squad,
--     combat_* or dungeon_*). play_card_effect() already sends a 'discord' primitive to discord_effects.

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
    ('the-weekly-poll', '{"primitive":"hot_take_poll","name":"Poll Results","desc":"The bot posts a 1-hour Discord poll about the target. The question and its answers come from this card.","base":{"duration_s":3600},"options":{"polls":[{"question":"This week''s poll: what is {name}''s vibe?","answers":["Main character","Side quest","NPC","Final boss"]},{"question":"What is {name}''s game night role?","answers":["The carry","The support","The hype crew","The snack runner"]},{"question":"What will {name} pull next?","answers":["A Gold!","A Full Art","Another extra copy"]},{"question":"Which Pokemon type fits {name} best?","answers":["Fire","Water","Grass","Psychic"]}]},"cooldown_h":24}'::jsonb),
    ('call-hr', '{"primitive":"timeout","name":"Call HR!","desc":"Times the target out in Discord for 1 minute: no typing and no talking.","base":{"duration_s":60},"cooldown_h":24}'::jsonb),
    ('post-it-note-tournament', '{"primitive":"ping_parade","name":"Bam Bam Bam","desc":"The bot @mentions the target 3 times in Discord over 5 minutes.","base":{"amount":3,"duration_s":300},"cooldown_h":24}'::jsonb),
    ('kroc-bot', '{"primitive":"fanfare","name":"Peaches Fanfare","desc":"The next time the target joins voice (within 48 hours), the bot posts a fanfare for them in that voice chat.","base":{"duration_s":172800},"cooldown_h":24}'::jsonb),
    ('the-best-sauce-is', '{"primitive":"hot_take_poll","name":"Sauce Boss","desc":"The bot posts a 1-hour Discord poll about the target. The question and its answers come from this card.","base":{"duration_s":3600},"options":{"polls":[{"question":"Is {name} the Sauce Boss?","answers":["Sauce Boss 👑","Sauce Apprentice","Ranch Defender"]},{"question":"What is {name}''s signature sauce?","answers":["Ranch","BBQ","Hot sauce","Ketchup"]},{"question":"Can {name} handle the spicy sauce?","answers":["Born for it 🔥","Mild at best","Needs a glass of milk"]},{"question":"Fries or nuggets: what does {name} dip first?","answers":["Fries","Nuggets","Both at once"]}]},"cooldown_h":24}'::jsonb),
    ('frick', '{"primitive":"rubber_chicken","name":"Censored","desc":"Every sound in the target''s game is bleeped with a squeak for 80 seconds, from their next visit.","base":{"duration_s":80},"cooldown_h":12}'::jsonb),
    ('enter-foxtrot', '{"primitive":"rally","name":"Tag Him In","desc":"The target''s next Hunt attack deals 15% more damage.","base":{"amount":15},"cooldown_h":12}'::jsonb),
    ('tasty-little-morsel', '{"primitive":"reaction_storm","name":"Look Out","desc":"The bot reacts 👀 to the target''s next 5 Discord messages, within 1 hour.","base":{"amount":5,"duration_s":3600},"cooldown_h":12,"options":{"emoji":"👀"}}'::jsonb),
    ('the-timezone-chart', '{"primitive":"clown_role","name":"Taps the Sign","desc":"Gives the target the 🤡 Clown role in Discord for 1 hour.","base":{"duration_s":3600},"cooldown_h":12}'::jsonb),
    ('2-week-game-fever', '{"primitive":"confetti","name":"Fever","desc":"This card''s art bursts as confetti on the target''s screen the next time they open the game.","cooldown_h":3}'::jsonb),
    ('palworld-mountain-base', '{"primitive":"mend","name":"Base Camp","desc":"Heals 20 HP on the target''s next hurt Hunt card.","base":{"amount":20},"cooldown_h":12}'::jsonb),
    ('hole-in-one', '{"primitive":"lucky_pull","name":"Lucky Shot","desc":"The first card of the target''s next pack is twice as likely to be rare.","base":{"amount":2},"cooldown_h":24}'::jsonb),
    ('crew-battle', '{"primitive":"rally","name":"Crew Hype","desc":"The target''s next Hunt attack deals 15% more damage.","base":{"amount":15},"cooldown_h":12}'::jsonb),
    ('cocky-little-freak', '{"primitive":"title","name":"Cocky","desc":"Adds a title to the target''s Discord nickname (for example \"<name> · the Cocky One\") for 1 hour.","base":{"duration_s":3600},"cooldown_h":12,"options":{"titles":["Cocky Little Freak","the Cocky One"]}}'::jsonb),
    ('shave-your-head', '{"primitive":"streak_shield","name":"Streak Shield","desc":"If the target misses one daily check-in, their streak stays. Works once, within 14 days.","base":{"duration_s":1209600,"amount":1},"cooldown_h":72}'::jsonb),
    ('patooie', '{"primitive":"redirect","name":"Patooie!","desc":"The next prank sent to the target gets spat at a random member instead. Works once, within 1 day.","base":{"duration_s":86400},"cooldown_h":18}'::jsonb),
    ('foxtrots-one-weakness', '{"primitive":"jinx","name":"She''s Here","desc":"The target''s next pack opens haunted, with a spooky look and sound. The cards do not change.","cooldown_h":12}'::jsonb),
    ('blade-s-beans-on-toast', '{"primitive":"hype","name":"Breakfast of Champions","desc":"The bot posts a hype message about the target in Discord, with this card''s art.","cooldown_h":24}'::jsonb),
    ('well-well-well', '{"primitive":"photobomb","name":"Well Well Well","desc":"This card photobombs the target''s next pack opening. If that pack has a rare pull, its Discord post says \"photobombed by <you>\".","cooldown_h":12}'::jsonb),
    ('i-ll-get-it-back-don-t-worry', '{"primitive":"rally","name":"Comeback","desc":"The target''s next Hunt attack deals 15% more damage.","base":{"amount":15},"cooldown_h":12}'::jsonb),
    ('oh-naur', '{"primitive":"googly_eyes","name":"Oh Naur","desc":"Googly eyes cover the target''s card art for 80 seconds. It starts the next time they open the game.","base":{"duration_s":80},"cooldown_h":12}'::jsonb),
    ('soggy-bread', '{"primitive":"reaction_storm","name":"Soggy","desc":"The bot reacts 💧 to the target''s next 5 Discord messages, within 1 hour.","base":{"amount":5,"duration_s":3600},"options":{"emoji":"💧"},"cooldown_h":12}'::jsonb),
    ('otto-the-electoral-college', '{"primitive":"hot_take_poll","name":"Recount","desc":"The bot posts a 1-hour Discord poll about the target. The question and its answers come from this card.","base":{"duration_s":3600},"options":{"polls":[{"question":"Should we recount {name}''s votes?","answers":["Recount!","Certify it","Schrödinger''s ballot"]},{"question":"What is {name}''s campaign promise?","answers":["Gold pulls for all","Shorter cooldowns","More Hunts","Pizza Fridays"]},{"question":"Who should {name} campaign for next?","answers":["Lion for President","The free packs party","Snacks for all","Still undecided"]},{"question":"Is {name} the most trusted voter in the server?","answers":["Absolutely","Needs an audit","Ask the cat"]}]},"cooldown_h":24}'::jsonb),
    ('discord-pizza-party', '{"primitive":"fanfare","name":"Pizza Party","desc":"The next time the target joins voice (within 48 hours), the bot throws them a pizza party in that voice chat.","base":{"duration_s":172800},"options":{"line":"🍕 {target} is here, and so is the pizza! (Pizza Party from {sender})"},"cooldown_h":24}'::jsonb),
    ('thechamp', '{"primitive":"spotlight","name":"The Champ","desc":"The target''s name glows gold in the game for 1 day.","base":{"duration_s":86400},"cooldown_h":24}'::jsonb),
    ('gordo-s-min-min', '{"primitive":"color_role","name":"ARMS Colors","desc":"The target picks a name color in the game. Their Discord name shows it for 1 day.","base":{"duration_s":86400},"cooldown_h":24}'::jsonb),
    ('pk-austin-s-ganondorf', '{"primitive":"mustache","name":"Gerudo Stache","desc":"Draws a big mustache on the target''s profile picture everywhere in the game, and on their showcase cards, for 1 day.","base":{"duration_s":86400},"cooldown_h":12}'::jsonb),
    ('tantaco-s-mythra-pyra', '{"primitive":"color_role","name":"Blade Colors","desc":"The target picks a name color in the game. Their Discord name shows it for 1 day.","base":{"duration_s":86400},"cooldown_h":24}'::jsonb),
    ('launch-day-raider', '{"primitive":"raid_crasher","name":"Hunt Crasher","base":{"uses":3,"amount":25},"cooldown_h":168,"desc":"The target''s next 3 Hunt attacks hit the boss 25% harder. That extra damage counts for your score (the prankster), not for the target''s."}'::jsonb),
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

-- c. REFUND (Nathan, 2026-10-03). A nickname layer, a Name Swap or a timeout that Discord refuses at the bot
-- (not_manageable / not_moderatable: the owner, or a member the bot cannot change) is refunded: the play
-- gets outcome 'refunded' (with the reason), the sender's cooldown on that card is cleared, and the play
-- no longer counts in any daily cap (play_card_effect below). The Activity tells the sender once
-- (refund_seen_at). The Activity also refuses these effects on the owner BEFORE the play (nothing spent).
alter table public.card_plays drop constraint if exists card_plays_outcome_check;
alter table public.card_plays add constraint card_plays_outcome_check
  check (outcome = any (array['applied', 'blocked', 'reflected', 'decoyed', 'redirected', 'delayed', 'refunded']));
alter table public.card_plays add column if not exists refund_reason text;
alter table public.card_plays add column if not exists refund_seen_at timestamptz;

create or replace function public.refund_card_play(p_play bigint, p_reason text) returns jsonb
language plpgsql set search_path = public as $$
declare v_player text; v_subject bigint;
begin
  update card_plays set outcome = 'refunded', refund_reason = left(coalesce(p_reason, 'refused'), 60)
   where id = p_play and outcome <> 'refunded'
  returning player_id, subject_id into v_player, v_subject;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_play'); end if;
  delete from card_effect_cooldowns where player_id = v_player and subject_id = v_subject;
  return jsonb_build_object('ok', true, 'player', v_player, 'subject', v_subject);
end $$;
revoke all on function public.refund_card_play(bigint, text) from public, anon, authenticated;
grant execute on function public.refund_card_play(bigint, text) to service_role;

-- play_card_effect: the live definition (pg_dump of live, 2026-10-03 after #147) with only the 7 cap
-- counts changed (a refunded play does not count) and the poll pick (v_choice). Lines marked effects_spread.sql.
CREATE OR REPLACE FUNCTION "public"."play_card_effect"("p_player" "text", "p_card" bigint, "p_target" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_subject bigint; v_rarity text; v_qty int; v_eff jsonb; v_prim effect_primitives%rowtype;
  v_tiers jsonb; v_caps jsonb; v_power numeric; v_cd numeric;
  v_asc int; v_ascset jsonb; v_scale numeric; v_pts jsonb; v_cmb jsonb;
  v_amount numeric; v_dur int; v_cooldown_h numeric; v_ready timestamptz;
  v_day timestamptz := date_trunc('day', now() at time zone 'America/Denver') at time zone 'America/Denver';
  v_final text := p_target; v_outcome text := 'applied'; v_play bigint;
  v_reflect_id bigint; v_ward_id bigint; v_opts jsonb;
  v_counter_id bigint; v_counter text; v_start timestamptz;
  v_choice int;   -- effects_spread.sql
begin
  if p_player = p_target then return jsonb_build_object('ok', false, 'error', 'self_target'); end if;
  if not exists (select 1 from players where id = p_target) then
    return jsonb_build_object('ok', false, 'error', 'no_target');
  end if;

  -- Serialize plays that touch the same members (caps + counters), in a fixed order.
  perform 1 from players where id in (p_player, p_target) order by id for update;

  select pc.quantity, c.subject_id, c.rarity::text, s.effect, coalesce(pc.ascension, 0), pc.stat_points
    into v_qty, v_subject, v_rarity, v_eff, v_asc, v_pts
  from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
  where pc.player_id = p_player and pc.card_id = p_card;
  if not found or v_qty < 1 then return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;
  if v_eff is null or v_eff->>'primitive' is null then
    return jsonb_build_object('ok', false, 'error', 'no_effect');
  end if;

  select * into v_prim from effect_primitives where primitive = v_eff->>'primitive';
  if not found or not v_prim.enabled then
    return jsonb_build_object('ok', false, 'error', 'effect_disabled', 'primitive', v_eff->>'primitive');
  end if;
  -- effects_spread.sql: a poll card (options.polls) needs the sender's pick of one of its questions
  -- (play_card_effect_choice sets it); a missing or wrong index is refused before anything is spent.
  if jsonb_typeof(v_eff->'options'->'polls') = 'array' then
    v_choice := nullif(current_setting('tcg.effect_choice', true), '')::int;
    if v_choice is null or v_choice < 0 or v_choice >= jsonb_array_length(v_eff->'options'->'polls') then
      return jsonb_build_object('ok', false, 'error', 'bad_choice');
    end if;
  end if;

  -- Cooldown (player + subject).
  select ready_at into v_ready from card_effect_cooldowns
   where player_id = p_player and subject_id = v_subject for update;
  if found and v_ready > now() then
    return jsonb_build_object('ok', false, 'error', 'cooldown', 'ready_at', v_ready);
  end if;

  -- Caps (0 or missing = off).
  select value into v_caps from settings where key = 'card_effect_caps';
  v_caps := coalesce(v_caps, '{}'::jsonb);
  if coalesce((v_caps->>'send_per_day')::int, 0) > 0
     and (select count(*) from card_plays where player_id = p_player and created_at >= v_day and outcome <> 'refunded')   -- effects_spread.sql
         >= (v_caps->>'send_per_day')::int then
    return jsonb_build_object('ok', false, 'error', 'send_cap');
  end if;
  if coalesce((v_caps->>'pair_per_day')::int, 0) > 0
     and (select count(*) from card_plays where player_id = p_player and aimed_at = p_target and created_at >= v_day and outcome <> 'refunded')   -- effects_spread.sql
         >= (v_caps->>'pair_per_day')::int then
    return jsonb_build_object('ok', false, 'error', 'pair_cap');
  end if;
  if v_prim.kind = 'prank' then
    if coalesce((v_caps->>'prank_recv_per_day')::int, 0) > 0
       and (select count(*) from card_plays where target_id = p_target and kind = 'prank' and created_at >= v_day and outcome <> 'refunded')   -- effects_spread.sql
           >= (v_caps->>'prank_recv_per_day')::int then
      return jsonb_build_object('ok', false, 'error', 'target_prank_cap');
    end if;
    if v_prim.primitive = 'timeout' and coalesce((v_caps->>'timeout_recv_per_day')::int, 0) > 0
       and (select count(*) from card_plays where target_id = p_target and primitive = 'timeout' and created_at >= v_day and outcome <> 'refunded')   -- effects_spread.sql
           >= (v_caps->>'timeout_recv_per_day')::int then
      return jsonb_build_object('ok', false, 'error', 'target_timeout_cap');
    end if;
  end if;
  if v_prim.primitive = 'gift_pack' and coalesce((v_caps->>'gift_pack_per_week')::int, 0) > 0
     and ((select count(*) from card_plays where primitive = 'gift_pack' and outcome = 'applied'
            and target_id = p_target and created_at > now() - interval '7 days') >= (v_caps->>'gift_pack_per_week')::int
       or (select count(*) from card_plays where primitive = 'gift_pack' and outcome = 'applied'
            and player_id = p_player and created_at > now() - interval '7 days') >= (v_caps->>'gift_pack_per_week')::int) then
    return jsonb_build_object('ok', false, 'error', 'gift_pack_cap');
  end if;

  -- Counters on the target, for pranks only, in the fixed order of docs/boons-and-pranks.md
  -- 3C: decoy, ward, reflect, redirect, delay. Depth 1: ONE counter acts on a play, and a
  -- bounced or redirected prank meets no second counter. Found first, used up only after
  -- every refusal check, so a refused play never costs the target a counter.
  if v_prim.kind = 'prank' then
    select id, primitive into v_counter_id, v_counter from player_effects
     where player_id = p_target and consumed_at is null and starts_at <= now()
       and primitive in ('decoy', 'ward', 'reflect', 'redirect', 'delay')
       and (expires_at is null or expires_at > now())
     order by array_position(array['decoy', 'ward', 'reflect', 'redirect', 'delay'], primitive), id limit 1;
    if v_counter = 'decoy' then v_outcome := 'decoyed';          -- a cardboard cutout takes it
    elsif v_counter = 'ward' then v_outcome := 'blocked';
    elsif v_counter = 'reflect' then v_final := p_player; v_outcome := 'reflected';
    elsif v_counter = 'redirect' then                             -- a random other member who plays
      select pl.id into v_final from players pl
       where pl.id not in (p_player, p_target) and exists (select 1 from player_cards pc where pc.player_id = pl.id)
         and not card_effect_active(pl.id, v_prim.primitive)             -- someone it can land on
         and (coalesce((v_caps->>'prank_recv_per_day')::int, 0) = 0
              or (select count(*) from card_plays cp where cp.target_id = pl.id and cp.kind = 'prank' and cp.created_at >= v_day and cp.outcome <> 'refunded')   -- effects_spread.sql
                 < (v_caps->>'prank_recv_per_day')::int)
       order by random() limit 1;
      if v_final is null then v_final := p_target; v_counter_id := null; v_counter := null;  -- nobody else
      else v_outcome := 'redirected'; end if;
    elsif v_counter = 'delay' then v_outcome := 'delayed';        -- it lands 1 hour later
    end if;
    -- The caps count where a prank LANDS. A bounce or a redirect onto a member at their prank
    -- (or timeout) cap fizzles (found by boon-sim.mjs: a victim got 5 pranks + 1 reflected = 6).
    if v_final <> p_target and (
         (coalesce((v_caps->>'prank_recv_per_day')::int, 0) > 0
          and (select count(*) from card_plays where target_id = v_final and kind = 'prank' and created_at >= v_day and outcome <> 'refunded')   -- effects_spread.sql
              >= (v_caps->>'prank_recv_per_day')::int)
         or (v_prim.primitive = 'timeout' and coalesce((v_caps->>'timeout_recv_per_day')::int, 0) > 0
          and (select count(*) from card_plays where target_id = v_final and primitive = 'timeout' and created_at >= v_day and outcome <> 'refunded')   -- effects_spread.sql
              >= (v_caps->>'timeout_recv_per_day')::int)) then
      v_outcome := 'blocked';
    end if;
  end if;

  -- No stacking (checked on the member it would land on). Refused plays keep the cooldown.
  if v_outcome not in ('blocked', 'decoyed') and not v_prim.stacks and card_effect_active(v_final, v_prim.primitive) then
    return jsonb_build_object('ok', false, 'error', 'already_active', 'primitive', v_prim.primitive);
  end if;

  update player_effects set consumed_at = now() where id = v_counter_id;
  v_start := now() + case when v_outcome = 'delayed' then interval '1 hour' else interval '0' end;

  -- Tier scaling, then the hard ceilings.
  select value into v_tiers from settings where key = 'card_effect_tiers';
  v_power := coalesce((v_tiers->v_rarity->>'power')::numeric, 1);
  v_cd    := coalesce((v_tiers->v_rarity->>'cd')::numeric, 1);
  -- Ascension (Nathan, 2026-09-27): each star of THIS copy makes the effect stronger
  -- and the cooldown shorter, on top of the tier. The hard limits below still clamp.
  select value into v_ascset from settings where key = 'card_effect_ascension';
  v_cmb := card_combat(v_rarity, v_asc, 1, v_pts);
  if (v_cmb->>'on')::boolean then
    -- Stat points on: the Potency and Haste points of THIS copy replace the per-star bonus.
    v_power := v_power * (v_cmb->>'potency')::numeric;
    v_cd    := v_cd * (v_cmb->>'haste')::numeric;
  else
    v_power := v_power * (1 + coalesce((v_ascset->>'power_per_star')::numeric, 0) * v_asc);
    v_cd    := v_cd * greatest(0.2, 1 - coalesce((v_ascset->>'cd_per_star')::numeric, 0) * v_asc);
  end if;
  -- One global knob for how often every card can be played (1 = as written).
  select coalesce((value #>> '{}')::numeric, 1) into v_scale from settings where key = 'card_effect_cooldown_scale';
  v_cd    := v_cd * coalesce(v_scale, 1);
  v_amount := round((v_eff->'base'->>'amount')::numeric * v_power, 2);
  v_dur    := round((v_eff->'base'->>'duration_s')::numeric * v_power)::int;
  if v_prim.max_amount is not null then v_amount := least(v_amount, v_prim.max_amount); end if;
  if v_prim.max_duration_s is not null then v_dur := least(v_dur, v_prim.max_duration_s); end if;
  v_cooldown_h := coalesce((v_eff->>'cooldown_h')::numeric, 24) * v_cd;

  insert into card_plays (player_id, target_id, aimed_at, card_id, subject_id, primitive, kind,
                          rarity, amount, duration_s, outcome)
  values (p_player, v_final, p_target, p_card, v_subject, v_prim.primitive, v_prim.kind,
          v_rarity, v_amount, v_dur, v_outcome)
  returning id into v_play;

  insert into card_effect_cooldowns (player_id, subject_id, ready_at)
  values (p_player, v_subject, now() + make_interval(secs => v_cooldown_h * 3600))
  on conflict (player_id, subject_id) do update set ready_at = excluded.ready_at;

  -- What the visuals need: which card, who sent it, and ONE title from the card's list.
  v_opts := coalesce(v_eff->'options', '{}'::jsonb) || jsonb_build_object('card_id', p_card, 'sender_id', p_player);
  -- Charges (launch_event_cards.sql): base.uses = how many hits a Hunt effect lasts (1 if unset);
  -- credit_to = who gets the Raid Crasher credit (a reflected prank: the member who reflected it).
  v_opts := v_opts || jsonb_build_object('uses', greatest(1, coalesce((v_eff->'base'->>'uses')::int, 1)),
    'credit_to', case when v_outcome = 'reflected' then p_target else p_player end);
  if jsonb_typeof(v_eff->'options'->'titles') = 'array' and jsonb_array_length(v_eff->'options'->'titles') > 0 then
    v_opts := v_opts || jsonb_build_object('title',
      v_eff->'options'->'titles'->>(floor(random() * jsonb_array_length(v_eff->'options'->'titles')))::int);
  end if;
  -- effects_spread.sql: the picked poll question and its fixed answers (the bot posts these).
  if v_choice is not null then
    v_opts := (v_opts - 'polls') || jsonb_build_object('choice', v_choice,
      'question', v_eff->'options'->'polls'->v_choice->'question', 'answers', v_eff->'options'->'polls'->v_choice->'answers');
  end if;

  if v_outcome not in ('blocked', 'decoyed') then
    if v_prim.primitive = 'gift_pack' then
      perform grant_packs(v_final, greatest(1, v_amount::int), 'boon', p_player);
    elsif v_prim.primitive = 'cleanse' then
      update player_effects set consumed_at = now()
       where player_id = v_final and consumed_at is null
         and primitive in (select primitive from effect_primitives where kind = 'prank');
      -- A Discord prank that has not run yet (a voice prank waiting for voice) is skipped;
      -- an active one is undone by the bot at its next tick.
      update discord_effects set status = 'skipped', error = 'cleansed', updated_at = now()
       where target_id = v_final and status = 'pending'
         and primitive in (select primitive from effect_primitives where kind = 'prank');
      update discord_effects set revert_at = now(), updated_at = now()
       where target_id = v_final and status = 'active'
         and primitive in (select primitive from effect_primitives where kind = 'prank');
    elsif v_prim.channel = 'app' then
      insert into player_effects (player_id, primitive, amount, duration_s, options, source_play_id, starts_at, expires_at)
      values (v_final, v_prim.primitive, v_amount, v_dur, v_opts, v_play, v_start,
              case when v_dur is not null and v_dur > 0 then v_start + make_interval(secs => v_dur) end);
    else
      insert into discord_effects (play_id, target_id, primitive, amount, duration_s, options, execute_after, revert_at)
      values (v_play, v_final, v_prim.primitive, v_amount, v_dur, v_opts, v_start,
              case when v_dur is not null and v_dur > 0 then v_start + make_interval(secs => v_dur) end);
    end if;
  end if;

  return jsonb_build_object('ok', true, 'play_id', v_play, 'outcome', v_outcome, 'target', v_final,
    'primitive', v_prim.primitive, 'kind', v_prim.kind, 'rarity', v_rarity, 'ascension', v_asc,
    'amount', v_amount, 'duration_s', v_dur, 'ready_at', now() + make_interval(secs => v_cooldown_h * 3600));
end $$;

-- d. POLL PICK (Nathan, 2026-10-03): the sender picks one of the poll card's preset questions (no free
-- text). The Activity calls this with the index; play_card_effect() checks it (bad_choice).
create or replace function public.play_card_effect_choice(p_player text, p_card bigint, p_target text, p_choice int) returns jsonb
language plpgsql set search_path = public as $$
declare r jsonb;
begin
  perform set_config('tcg.effect_choice', coalesce(p_choice::text, ''), true);
  r := play_card_effect(p_player, p_card, p_target);
  perform set_config('tcg.effect_choice', '', true);
  return r;
end $$;
revoke all on function public.play_card_effect_choice(text, bigint, text, int) from public, anon, authenticated;
grant execute on function public.play_card_effect_choice(text, bigint, text, int) to service_role;

notify pgrst, 'reload schema';
