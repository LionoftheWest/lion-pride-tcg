# Effects + abilities cleanup — batch 1 (2026-09-29)

Review list for Nathan. Nothing here is live until he says OK (then `push-abilities.mjs` + `push-effects.mjs`).

- Cards with an ability: 32 → **127** of 127
- Cards with a boon / prank / neutral effect: 10 → **61**
  (boons 19, pranks 32, neutral 10)
- Cards with no type: 9 → 0

The boon effects (all switched on by `effects_cleanup.sql`):
Gift Pack (+1 pack, weekly cap 2) · Lucky Pull (first card of the next pack at 2x the rare rates, gold copy 3x) ·
Rally (next Hunt hit +15%, gold +22%) · Mend (next hurt Hunt card +20 HP, gold +30) · Spotlight (gold name for a day).
A card's rarity scales its effect (normal 1x … gold 1.5x) and shortens its cooldown.

## New effects (51)
| Card | Kind | Effect | What it does | Cooldown |
|---|---|---|---|---|
| Kaminari's Incineroar | boon | **Hug It Out** | The target's next hurt Hunt card heals 20 HP. | 12 h |
| NotJosh's Random Pick | boon | **Random Pick** | The first card of the target's next pack rolls at 2x the rare rates. | 24 h |
| Zeoic, the Server Master | boon | **Server Gift** | Gives the target a free pack. | 48 h |
| "Long live the King" | boon | **Long Live the King** | The target's name glows gold for a day. | 24 h |
| Onyen Tutoring | boon | **Master Class** | The target's next Hunt hit deals +15% damage. | 12 h |
| Gym Rat Lion | boon | **Recovery Drink** | The target's next hurt Hunt card heals 20 HP. | 12 h |
| Cockroachs Never Die | boon | **Still Alive** | The target's next hurt Hunt card heals 20 HP. | 12 h |
| 4 In the Pink | boon | **In the Pink** | The first card of the target's next pack rolls at 2x the rare rates. | 24 h |
| Better in Cancun | boon | **Souvenir** | Brings the target back a free pack. | 48 h |
| Smash Tag Check! | boon | **Verified** | The target's name glows gold for a day. | 24 h |
| Enter Foxtrot | boon | **Tag Him In** | The target's next Hunt hit deals +15% damage. | 12 h |
| Palworld Mountain Base | boon | **Base Camp** | The target's next hurt Hunt card heals 20 HP. | 12 h |
| Hole in One! | boon | **Lucky Shot** | The first card of the target's next pack rolls at 2x the rare rates. | 24 h |
| Crew Battle! | boon | **Crew Hype** | The target's next Hunt hit deals +15% damage. | 12 h |
| Shave your Head | boon | **24 Hour Legend** | The target's name glows gold for a day. | 24 h |
| I'll get it back, don't worry | boon | **Comeback** | The target's next Hunt hit deals +15% damage. | 12 h |
| Otto & The Electoral College | boon | **Campaign Promise** | Gives the target a free pack. A promise kept! | 48 h |
| Discord Pizza Party | boon | **Pizza's Here** | Gives the target a free pack. | 48 h |
| TheChamp | boon | **The Champ** | The target's name glows gold for a day. | 24 h |
| UP B OOS | prank | **UP B OOS** | Turns the target's collection upside down for 10 minutes. | 12 h |
| Grudge Match | prank | **Rivalry** | Gives the target a rival title. (the Grudge Holder / Sworn Rival / Runback Requester) | 12 h |
| Mr. Worldwide | prank | **Worldwide** | Pins this card to the target's name for all to see. | 6 h |
| Super Battle Golf Flash Bang | prank | **Flash Bang** | Confetti bursts over the target the next time they open the app. | 3 h |
| Call of Dragons | prank | **World Chat** | Pins this card to the target's name for all to see. | 6 h |
| 30 DanTucker Pings | prank | **Pinged** | Gives the target a ping title. (the Pinged / Notification Magnet / @TheDanTucker's Echo) | 12 h |
| Lazy SD | prank | **Self Destruct** | Turns the target's collection upside down for 10 minutes. | 12 h |
| The Server Crashed! | prank | **Server Crash** | The target's cards show ??? for 10 minutes. | 12 h |
| Failed Wordle | prank | **Stupid Word** | The target's cards show ??? for 10 minutes. | 12 h |
| Gerudo Fight Club | prank | **Suavemente** | Puts googly eyes on all the target's card art for a day. | 12 h |
| B Button Spam | prank | **B...B...B...** | Every sound in the target's Activity is a squeak. | 12 h |
| Smash Server Hamster Wheel | prank | **Communication Error** | The target's cards show ??? for 10 minutes. | 12 h |
| Pineapple on Pizza | prank | **Pizza Crime** | Gives the target a pizza title. (the Pineapple Pizza Enjoyer / Fruit Topping Fan / Pizza Criminal) | 12 h |
| Lorcana Prices | prank | **Go Back to Pokemon** | Pins this card to the target's name for all to see. | 6 h |
| Meta-Abuser | prank | **Tier List** | Gives the target a meta title. (the Meta Abuser / Tier List Victim / Carried) | 12 h |
| Sunny's Duck Feet | prank | **Quack** | Every sound in the target's Activity is a squeak. | 12 h |
| The Weekly Poll | prank | **Poll Results** | Pins this card to the target's name for all to see. | 6 h |
| The Best Sauce is…? | prank | **Sauce Boss** | Gives the target a sauce title. (the Sauce Boss / Sauce Critic / Ranch Defender) | 12 h |
| 2 - Week Game Fever | prank | **Fever** | Confetti bursts over the target the next time they open the app. | 3 h |
| Cocky little Freak! | prank | **Cocky** | Gives the target a cocky title. (Cocky Little Freak / the Cocky One) | 12 h |
| Foxtrots One Weakness | prank | **She's Here** | Puts googly eyes on all the target's card art for a day. | 12 h |
| Blade's Beans on Toast | prank | **Why** | Gives the target a breakfast title. (Beans on Toast Enjoyer / Breakfast Criminal) | 12 h |
| Well, well, well... | prank | **Well Well Well** | Puts googly eyes on all the target's card art for a day. | 12 h |
| Oh Naur | prank | **Oh Naur** | Puts googly eyes on all the target's card art for a day. | 12 h |
| Soggy Bread | prank | **Soggy** | Every sound in the target's Activity is a squeak. | 12 h |
| I'm a Tree! | neutral | **Tree Bark** | The next prank on the target bounces back to its sender. | 24 h |
| Modded vs Vanilla | neutral | **Back to Vanilla** | Removes every prank from the target. | 12 h |
| Create-a-Colony | neutral | **Fresh Start** | Removes every prank from the target. | 12 h |
| Krool Name Swap | neutral | **Wait a Minute** | The next prank on the target bounces back to its sender. | 24 h |
| Fluffy's REPO Clutch | neutral | **Last One Alive** | Blocks the next prank on the target. | 18 h |
| Building a House | neutral | **Two Walls** | Blocks the next prank on the target. | 18 h |
| Polar Bear Build | neutral | **Ice Wall** | Blocks the next prank on the target. | 18 h |

## New attack abilities (49)
| Card | Type | Ability | What it does |
|---|---|---|---|
| MzTaken's Kirby | Character | **Inhale** | Heal for 20% of the damage dealt. |
| Jelly's Urshifu | Creature | **Button Mash** | 25% chance to strike twice. |
| LionoftheWest's Tsareena | Creature | **Stack Up** | +35% damage when the boss is below 30% HP. |
| GSnipes Cinderrace | Creature | **Pyro Ball** | +12% critical chance on this attack. |
| R2VQ's Talonflame | Creature | **Original Flame** | The boss cannot block this attack. |
| Brego's Link | Character | **Spin Attack** | 20% chance to strike twice. |
| Beetle's Cloud | Character | **Limit Break** | +40% damage when the boss is below 30% HP. |
| Wiifu's Sora | Character | **Kingdom Key** | The boss cannot block this attack. |
| LionoftheWest's Pichu | Creature | **Glass Cannon** | +15% critical chance on this attack. |
| Kaminari's Incineroar | Creature | **Free Hugs** | Heal for 20% of the damage dealt. |
| Geno's Megaman | Character | **Doubles Clutch** | +40% damage when the boss is below 25% HP. |
| Grim's Jigglypuff | Creature | **Rest Confirm** | +50% damage when the boss is below 25% HP. |
| Grim's Pokemon Trainer | Character | **Swap Out** | Heal for 15% of the damage dealt. |
| Piotr's Little Mac | Character | **KO Punch** | +50% damage when the boss is below 20% HP. |
| Texafornia's Richter | Character | **Taek Dis!** | +15% critical chance on this attack. |
| Maddawg's Wolf | Character | **Blaster Ledge** | +15% critical chance on this attack. |
| Keeb's Mii Gunner | Character | **B...B...B...** | 25% chance to strike twice. |
| Kaminari's King K. Rool | Character | **MY SWAMP** | The boss cannot block this attack. |
| Wiifu's Wiifit Trainer | Character | **Sun Salutation** | Heal for 20% of the damage dealt. |
| ChevyNova's Bowser | Character | **Tried and True** | +14% critical chance on this attack. |
| E-Mandarkstar's Ganondorf | Character | **Warlock Punch** | The boss cannot block this attack. |
| Bonzan's Donkey Kong | Character | **Giant Punch** | The boss cannot block this attack. |
| Vioarr's Link | Character | **50/50** | +15% critical chance on this attack. |
| Foxtrot's King K. Rool | Character | **Crownerang** | 20% chance to strike twice. |
| Rad Dad's Ness | Character | **PSI Magnet** | Heal for 20% of the damage dealt. |
| Pringle's Banjo & Kazooie | Character | **Wonderwing** | 20% chance to strike twice. |
| KobeDunk's Hole-in-One | Character | **Timber!** | The boss cannot block this attack. |
| NotJosh's Waluigi | Character | **Waited Long Enough** | +35% damage when the boss is below 25% HP. |
| Zeoic, the Server Master | Character | **Host Migration** | Heal for 20% of the damage dealt. |
| Baego | Character | **Better Side** | +12% critical chance on this attack. |
| Ling Ling's Talonflame | Creature | **Haunting Dive** | The boss cannot block this attack. |
| Mr. Mobs Mew | Creature | **Too Many Buttons** | +12% critical chance on this attack. |
| LionoftheWest's Dodrio | Creature | **Triple Peck** | 20% chance to strike twice. |
| Mr. Worldwide | Character | **Exclusive** | +30% damage when the boss is below 30% HP. |
| Gym Rat Lion | Character | **Chocolate Milk** | Heal for 20% of the damage dealt. |
| Memelord Lion | Character | **Meme Warfare** | +12% critical chance on this attack. |
| The Dad Gaming | Character | **TDG Crew** | 15% chance to strike twice. |
| Rotom Washed | Creature | **Spin Cycle** | Heal for 15% of the damage dealt. |
| Mrs. LionoftheWest | Character | **Blind Spot** | +10% critical chance on this attack. |
| Kroc Bot | Character | **Peaches Beam** | +12% critical chance on this attack. |
| TheChamp | Character | **Next Year** | +40% damage when the boss is below 25% HP. |
| HighFlyingPenguin's King Dedede | Character | **Jet Hammer** | +45% damage when the boss is below 25% HP. |
| Gordo's Min Min | Character | **ARMS Reach** | +12% critical chance on this attack. |
| MadBombChu's Pikachu | Creature | **Thunder Jolt** | 20% chance to strike twice. |
| MadBombChu's Piranha Plant | Creature | **Poison Breath** | The boss cannot block this attack. |
| El Rey's Pirahna Plant | Creature | **Chomp** | Heal for 20% of the damage dealt. |
| Ooblah's Bowser | Character | **Fire Breath** | +12% critical chance on this attack. |
| PK Austin's Ganondorf | Character | **Flame Choke** | The boss cannot block this attack. |
| TanTaco's Mythra/Pyra | Character | **Blade Swap** | 20% chance to strike twice. |

## New support abilities (46)
| Card | Type | Ability | What it does |
|---|---|---|---|
| NotJosh's Random Pick | Moment | **King of Randoms** | Direct boss damage — scales with your Psychic cards |
| I'm a Tree! | Moment | **Throw Everything** | Boss takes more — scales with your Nature cards |
| "Long live the King" | Moment | **Royal Decree** | Boost the next hit — extra strong on Royal cards |
| Onyen Tutoring | Moment | **$150 an Hour** | Boost the next hit — extra strong on Caster cards |
| UP B OOS | Moment | **UP B OOS** | Direct boss damage — scales with your Hero cards |
| Grudge Match | Moment | **Settle This** | Direct boss damage — scales with your Melee cards |
| Wiifu's Bowling Ball | Item | **Strike** | Direct boss damage — scales with your Armored cards |
| Modded vs Vanilla | Moment | **Mod Pack** | Boss takes more — scales with your Minecraft cards |
| Create-a-Colony | Place | **Potato Cannon** | Boss takes more — scales with your Armored cards |
| Cockroachs Never Die | Moment | **Never Die** | Heal an ally — extra strong on Beast cards |
| Super Battle Golf Flash Bang | Moment | **Flash Bang** | Skip the boss turn — themed around Light cards |
| Call of Dragons | Moment | **World Chat War** | Boss takes more — scales with your Monster cards |
| Australian Connections | Moment | **Lag Spike** | Boss hits softer — scales with your Agile cards |
| 4 In the Pink | Moment | **Pink Power** | Boost the next hit — extra strong on Cute cards |
| Fluffy's REPO Clutch | Moment | **Last One Alive** | Shield an ally — extra strong on Stealth cards |
| 30 DanTucker Pings | Moment | **Ping Storm** | Skip the boss turn — themed around Ranged cards |
| Lazy SD | Moment | **Inevitable** | Boss hits softer — scales with your Light cards |
| The Server Crashed! | Moment | **Crash** | Skip the boss turn — themed around Metal cards |
| Failed Wordle | Moment | **Stupid Word** | Skip the boss turn — themed around Caster cards |
| Gerudo Fight Club | Moment | **Suavemente** | Boost the next hit — extra strong on Shadow cards |
| Building a House | Moment | **Two Walls** | Shield an ally — extra strong on Earth cards |
| B Button Spam | Moment | **Projectile Wall** | Shield an ally — extra strong on Ranged cards |
| Better in Cancun | Moment | **Vacation Mode** | Heal an ally — extra strong on Water cards |
| Smash Server Hamster Wheel | Moment | **Communication Error** | Skip the boss turn — themed around Robot cards |
| Pineapple on Pizza | Moment | **Wrong Way** | Boss hits softer — scales with your Fire cards |
| Lorcana Prices | Moment | **Go Back** | Clear curses — themed around Arcane cards |
| Polar Bear Build | Place | **Ice Fortress** | Shield an ally — extra strong on Ice cards |
| Meta-Abuser | Moment | **Carried** | Boost the next hit — extra strong on Metal cards |
| Sunny's Duck Feet | Moment | **Quack** | Clear curses — themed around Bird cards |
| Smash Tag Check! | Moment | **Tag Check** | Boss takes more — scales with your Hero cards |
| The Weekly Poll | Moment | **Feud** | Boss hits softer — scales with your Community cards |
| The Best Sauce is…? | Moment | **Secret Sauce** | Boost the next hit — extra strong on Fire cards |
| Tasty Little Morsel | Moment | **Look Out** | Boss takes more — scales with your Beast cards |
| 2 - Week Game Fever | Moment | **Fever Pitch** | Boost the next hit — extra strong on Party cards |
| Hole in One! | Moment | **Skill Shot** | Direct boss damage — scales with your Strong cards |
| Crew Battle! | Moment | **Team Name** | Boost the next hit — extra strong on Smash cards |
| Cocky little Freak! | Moment | **Taunt** | Boss hits softer — scales with your Strong cards |
| Shave your Head | Moment | **24 Hour Stream** | Heal an ally — extra strong on Humanoid cards |
| Foxtrots One Weakness | Moment | **She's Here** | Skip the boss turn — themed around Royal cards |
| Blade's Beans on Toast | Item | **Why** | Clear curses — themed around Humanoid cards |
| Well, well, well... | Moment | **VC Greeting** | Shield an ally — extra strong on Psychic cards |
| I'll get it back, don't worry | Moment | **Comeback** | Heal an ally — extra strong on Pokemon cards |
| Oh Naur | Moment | **Oh Naur** | Clear curses — themed around Water cards |
| Soggy Bread | Item | **Soup or Water** | Boss hits softer — scales with your Water cards |
| Discord Pizza Party | Moment | **Pizza Party** | Heal an ally — extra strong on Community cards |
| AGrumpyTeddyBear's Last Stand | Moment | **Last Stand** | Shield an ally — extra strong on Beast cards |

## Cards that got a type (9) — their lore is still empty (Nathan's text)
| Card | Type | Traits |
|---|---|---|
| HighFlyingPenguin's King Dedede | Character | royal, armored, strong |
| Gordo's Min Min | Character | humanoid, agile, ranged |
| MadBombChu's Pikachu | Creature | lightning, cute |
| MadBombChu's Piranha Plant | Creature | nature, toxic, monster |
| El Rey's Pirahna Plant | Creature | nature, toxic, monster |
| AGrumpyTeddyBear's Last Stand | Moment |  |
| Ooblah's Bowser | Character | monster, royal, fire |
| PK Austin's Ganondorf | Character | shadow, royal, melee |
| TanTaco's Mythra/Pyra | Character | fire, light, hero, melee |
