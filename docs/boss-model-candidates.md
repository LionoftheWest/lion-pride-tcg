# Raid boss 3D model candidates

Research date: 2026-09-27. Scope: boss-grade glTF-ready models of well-known game monsters, for the private Lion Pride TCG raid bosses (three.js in a Discord Activity).

## Summary

- 34 candidates across 13 franchises plus the Mixamo monster set.
- All Sketchfab rows came from the Sketchfab public API v3 (`api.sketchfab.com/v3/models/<uid>`). This API is the data source of each model page. WebFetch on the model page itself returns an empty page (the page is JavaScript-rendered), so the API record is the verified page data.
- "Tris" is the Sketchfab `faceCount`. Sketchfab reports triangles.
- Sketchfab converts each downloadable model to glTF/GLB. The public API does not list the archive formats without a login, so the format column is not given per row.
- The API gives the animation COUNT only. It does not give the animation NAMES. No page lists names except where the description says so. "Rigged" is marked "yes (inferred)" when the model has one or more animations, and "yes (page)" when the page says "rigged".
- "Boss-worthiness" is inferred from the title, the description, and the triangle count. Nobody examined the renders visually. Examine each model in the Sketchfab viewer before you choose it.
- Ripped status: "page says ripped" means the author states it. "Likely ripped (inferred)" means a pattern shows it (for example, one version per game release, or in-game "toy" collectibles). "Page says fan-made" means the author states that they made it.

### Blockers and cautions

1. The `discord` repository is PUBLIC. Do not commit a Mixamo FBX/GLB there. The Mixamo terms forbid redistribution of raw character files. Keep boss GLB files on the VM or in a private store. The same care applies to every ripped model.
2. A Sketchfab download needs a Sketchfab account and API token (the Blender MCP Sketchfab integration can use one).
3. A Mixamo download needs an Adobe ID login at mixamo.com.
4. Gaps: no fan-made, animated, downloadable Hydralisk at boss quality (see the StarCraft table). No usable Mass Effect Reaper or Thresher Maw creature. No Diablo (the Lord of Terror) model. No usable League of Legends monster (Baron Nashor exists only as a board-game miniature).

## StarCraft (Blizzard Entertainment)

| Character | Model + URL | Author | License | Free DL | Rigged | Animated | Tris | Ripped? | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Ultralisk | Ultralisk Animated — https://sketchfab.com/3d-models/ultralisk-animated-fb813e4e485649a7a516feaffce3b00a | empress | CC-BY | yes | yes (inferred) | yes, 1 clip (name not listed) | 72,814 | not stated (no description) | Large tusked beast. Best StarCraft option with CC-BY + animation. |
| Ultralisk | NPC: Ultralisk — https://sketchfab.com/3d-models/npc-ultralisk-138a4e21b4ea48ffa53658e3acef810d | Pete Jiadong Qiang | CC-BY | yes | yes (inferred) | yes, 1 clip | 17,495 | not stated | Lighter option. Source unknown. |
| Ultralisk | Ultralisk-Attack Full — https://sketchfab.com/3d-models/ultralisk-attack-full-c215e38dda4248708ec35a0d676afbd8 | Catholomew | CC-BY-NC | yes | yes (inferred) | yes, 21 clips | 3,764 | page says ripped ("assets from various games ... not my creations") | SC2 game asset. Many clips. NC + ripped. |
| Ultralisk | Shackled Ultralisk - Starcraft 2 — https://sketchfab.com/3d-models/shackled-ultralisk-starcraft-2-a497eb69713c43c59a7e0aa9e7dcd45b | Catholomew | CC-BY-NC | yes | yes (inferred) | yes, 5 clips | 13,539 | page says ripped | Same author statement. |
| Ultralisk | Ultralisk Zerg Starcraft Untextured — https://sketchfab.com/3d-models/ultralisk-zerg-starcraft-untextured-198885e270d34d23a1c01c3572f57cdc | woodsquid | CC-BY | yes | no | no | 365,848 | page says fan-made ("Done in Blender") | No textures. Too heavy. Needs decimation + texturing. |
| Hydralisk | Hydralisk — https://sketchfab.com/3d-models/hydralisk-03a7c54de8c14671adcdcc4edc05af24 | Catholomew | CC-BY-NC | yes | yes (inferred) | yes, 25 clips | 2,255 | page says ripped | Only animated Hydralisk. Low-poly SC2 asset. NC + ripped. |
| Hydralisk | MESH Hydralisk — https://sketchfab.com/3d-models/mesh-hydralisk-777c0c2f73524939a8fadef40307e975 | thedino1 | CC-BY | yes | no | no | 83,020 | not stated | Static. Needs a custom rig (not biped, so Mixamo auto-rig does not apply). |
| Hydralisk | Alien Hydralisk / PS1 Monster — https://sketchfab.com/3d-models/alien-hydralisk-ps1-monster-30b3cf84c10e4f9287f4915927ef6f10 | McPato | CC-BY | yes | yes (inferred) | yes, 1 clip | 1,946 | page says "inspired in Hydralisk" (fan-made) | PS1 retro style. Probably not boss-grade menace. |
| Hydralisk | Hydralisk Zerg Starcraft Uncolored — https://sketchfab.com/3d-models/hydralisk-zerg-starcraft-uncolored-547f24f6d1b64a1cb9a17ecd84115426 | woodsquid | CC-BY | yes | no | no | 528,232 | page says fan-made | No textures. Too heavy. |

## Halo (Microsoft / 343 Industries / Bungie)

| Character | Model + URL | Author | License | Free DL | Rigged | Animated | Tris | Ripped? | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Elite (Sangheili) | Halo Elite Minor - Halo — https://sketchfab.com/3d-models/halo-elite-minor-halo-b02c4923d0a54af5a8da9a7424c4c307 | martinjohnsrud | CC-BY | yes | no | no | 63,898 | page says fan-made ("For a school project") | Biped, so Mixamo auto-rig can add all animations. |
| Elite | halo wars banished elite with energy sword — https://sketchfab.com/3d-models/halo-wars-banished-elite-with-energy-sword-9000b404456c4c3faa50da34d291f68e | YeeHawRussell | CC-BY | yes | no | no | 19,198 | page says fan-made ("i treid to make one") | Energy sword adds menace. |
| Elite | Enemies>Halo 3>Covenant>Elites>Ultra — https://sketchfab.com/3d-models/enemieshalo-3covenantelitesultra-748c7e1f3a874c749ee9326dc9fae6aa | Bornstellar Makes Eternallasting | CC-BY | yes | unknown | no | 25,266 | likely ripped (inferred: author uploads one version per Halo release) | Game-accurate look. |
| Hunter (Mgalekgolo) | Halo 3 hunter Covenant — https://sketchfab.com/3d-models/halo-3-hunter-covenant-19384c74d2d644c0aea43c2e26d0b435 | Fliqpy717 | CC-BY | yes | no | no | 3,494 | not stated | Low-poly. Hunter shape is large and armored. |
| Hunter | Hunter Bomb Carrier halo — https://sketchfab.com/3d-models/hunter-bomb-carrier-halo-72826c60a9364885af0078597ab5f530 | spr855 | CC-BY | yes | no | no | 93,250 | not stated (no description) | Higher detail. Variant design. |
| Hunter | Enemies>Multi>Covenant>Hunters — https://sketchfab.com/3d-models/enemiesmulticovenanthunters-4537d92e15c94fc09e7d4d60b6fc9fec | Bornstellar Makes Eternallasting | CC-BY | yes | unknown | no | 59,901 (6 Hunters) | likely ripped (inferred: "Halo 1, Halo 2, Halo 3, Reach, Halo 4, H2A") | One scene with six versions. Split one out. |
| Grunt (Unggoy) | Enemies>H2A>Covenant>Heretic Grunt — https://sketchfab.com/3d-models/enemiesh2acovenantheretic-grunt-15bf9565fbfc415da8e863d8e326e92d | Bornstellar Makes Eternallasting | CC-BY | yes | yes (page: "Rigged with 8 animations") | yes, 8 in file (2 shown) | 6,850 | likely ripped (inferred) | Grunt is small. Use as a minion, not a boss. |
| Grunt | Halo 3 Grunt — https://sketchfab.com/3d-models/halo-3-grunt-794e5d24afb441dabd6773a6a67f26d9 | Outworld Studios | CC-BY-SA | yes | no | no | 42,666 | page says fan-made ("inspired by Halo 3 - Art/Model by Outworld Studios") | SA: derived model must keep CC-BY-SA. |
| Brute (Jiralhanae) | The Covenant brutes halo 3 — https://sketchfab.com/3d-models/the-covenant-brutes-halo-3-6dcaff02606c450299c6612bfd5db3fd | Fliqpy717 | CC-BY | yes | no | no | 54,288 | not stated | Big biped. Mixamo auto-rig possible. |
| Flood Combat Form | Halo 2 Anniversary Elite Combat Form — https://sketchfab.com/3d-models/halo-2-anniversary-elite-combat-form-e04e17d535c44e0ca7750708ff1082cb | Bylan | CC-BY | yes | yes (inferred) | yes, 1 clip | 11,195 | not stated | Creepy mutated Elite. |

## Doom (id Software / Bethesda)

| Character | Model + URL | Author | License | Free DL | Rigged | Animated | Tris | Ripped? | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Cyberdemon | Cyberdemon — https://sketchfab.com/3d-models/cyberdemon-8c03ee0614264e4096384d62684ed5f8 | Rexotec | CC-BY | yes | yes (inferred) | yes, 3 clips ("More Animations to come") | 12,010 | page says fan-made ("my own little stylised take") | Iconic boss. Light, animated, CC-BY. Top pick. |
| Cyberdemon | CYBER DEMON Doom — https://sketchfab.com/3d-models/cyber-demon-doom-d38089e8616d4025a2514d069f4e9687 | Fred Drabble | CC-BY | yes | tag "rig" (unconfirmed) | no | 162,486 | page says fan-made ("my take") | Heavy. Decimate below 150k. |
| Cyberdemon | Cyberdemon — https://sketchfab.com/3d-models/cyberdemon-d2f1b7f63f39449f8359586e7ca5fb04 | irons3th | CC-BY | yes | no | no | 66,925 | page says ripped ("Model and textures by Bethesda Softworks and Id Software") | Author has no right to grant CC-BY. |
| Cyberdemon | Cyberdemon — https://sketchfab.com/3d-models/cyberdemon-76b2100f785844b38bb37415f0de8f74 | extruder676 | CC-BY-NC-SA | yes | no | no | 23,536 | page says fan-made (Jonah Lobe redesign) | Strong redesign. NC-SA. |
| Mancubus | Mancubus Doom Fanart — https://sketchfab.com/3d-models/mancubus-doom-fanart-ba375af50d44486bbde38032a05b08c8 | jason.lp.davis | CC-BY | yes | no | no | 25,520 | page says fan-made ("Made entirely in Blender") | Huge, fat, arm cannons. |
| Mancubus | Mancubus - DOOM : The Dark Ages - Rigged — https://sketchfab.com/3d-models/mancubus-doom-the-dark-ages-rigged-20a367926cd44127963dc5f8016f9921 | wrimpr | CC-BY | yes | yes (page) | no | 57,249 | likely ripped (inferred: "model ... from the video game ... with an existing rig") | Game rig included. |
| Baron of Hell | DOOM eternal fireborne baron of hell — https://sketchfab.com/3d-models/doom-eternal-fireborne-baron-of-hell-1a26f581d5084909a6a768150d32a9e9 | DJ_Nugget | CC-BY | yes | unknown | no | 48,728 | likely ripped (inferred: author also posts in-game "toy" collectibles) | Very menacing. |
| Tyrant | Tyrant - DOOM : The Dark Ages - Rigged — https://sketchfab.com/3d-models/tyrant-doom-the-dark-ages-rigged-941b55b8312945e2b6a7cf3ec81c733b | wrimpr | CC-BY | yes | yes (page) | no | 77,160 | likely ripped (inferred) | Modern Cyberdemon. |
| Cacodemon | DOOM Cacodemon — https://sketchfab.com/3d-models/doom-cacodemon-4902b58e85ae42dea7a341148cd3831b | Renafox | CC-BY-NC | yes | no | no | 4,222 | page says fan-made | Floating eye. Easy to animate with code (bob + rotate). |

## Warcraft (Blizzard Entertainment)

| Character | Model + URL | Author | License | Free DL | Rigged | Animated | Tris | Ripped? | Notes |
|---|---|---|---|---|---|---|---|---|---|
| XT-002 Deconstructor | XT-002 (World of Warcraft) — https://sketchfab.com/3d-models/xt-002-world-of-warcraft-b2e86c1eebf546b5b6ad933f17e4682f | alexthebear | CC-BY | yes | yes (inferred) | yes, 4 clips | 8,068 | page says fan-made ("Made in Blender") | Ulduar raid boss. Light + animated. |
| Deathwing | Deathwing — https://sketchfab.com/3d-models/deathwing-be4e140645ff4cd1ba4b50443d697868 | João Lacerda | CC-BY-NC-SA | yes | no | no | 59,465 | page says fan-made artwork | Top-tier dragon. NC-SA. |
| Lord Marrowgar | Lord Marrowgar — https://sketchfab.com/3d-models/lord-marrowgar-555c32b29b8b438c8f8ad1a72a2277d4 | p0int | CC-BY | yes | yes (inferred) | yes, 1 clip | 8,580 | page says fan-made (Blockbench) | Blocky style. Less menace. |
| Lich King | Lich King - World of Warcraft — https://sketchfab.com/3d-models/lich-king-world-of-warcraft-e8b37a8f85d34efa9e01747966f12bb8 | Brian Trepanier | CC-BY | yes | no | no | 443,645 | not stated | Too heavy (3x the budget). Decimation needed. |
| Ragnaros | Ragnaros Base - HotS — https://sketchfab.com/3d-models/ragnaros-base-hots-d50653417b524c8e94ee001a24b83086 | Catholomew | CC-BY-NC | yes | yes (inferred) | yes, 40 clips | 11,074 | page says ripped (author statement on all uploads) | Heroes of the Storm asset. NC + ripped. |

## Diablo (Blizzard Entertainment)

| Character | Model + URL | Author | License | Free DL | Rigged | Animated | Tris | Ripped? | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Duriel | Duriel — https://sketchfab.com/3d-models/duriel-c799985cf00d442db24472420ddd1546 | Vasian-Digital3D | CC-BY | yes | yes (inferred) | yes, 1 clip | 62,249 | likely ripped (inferred: description is only "Diablo 2 Resurrected") | Giant maggot lord. Strong boss. |
| Mephisto | Mephisto — https://sketchfab.com/3d-models/mephisto-159e6784388e4882b4b0658ef369cce7 | Vasian-Digital3D | CC-BY | yes | yes (inferred) | yes, 1 clip | 102,474 | likely ripped (inferred: description is only "Diablo 2") | Prime Evil. Under 150k. |
| Lilith | Lilith from Diablo 4 (rebirth) — https://sketchfab.com/3d-models/lilith-from-diablo-4-rebirth-919d3374c251444aa64f30cb82b3ffb1 | lawtrigg | CC-BY | yes | yes (inferred) | yes, 1 clip | 109,444 | page says fan-made ("quick sculpt ... stylized") | Human-size. Less "big monster". |

## Dark Souls / Elden Ring (FromSoftware)

| Character | Model + URL | Author | License | Free DL | Rigged | Animated | Tris | Ripped? | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Aldrich, Devourer of Gods | Aldrich, Devourer of Gods — https://sketchfab.com/3d-models/aldrich-devourer-of-gods-f0af1612a6ad43bb9b1bd7178ea0e2e4 | 9S | CC-BY | yes | yes (tag "rigged") | no (posed) | 72,999 | page says fan-art ("made with Blender ... now in 4k") | Grotesque blob boss. Strong menace. |
| Artorias + Sif | Knight Artorias and Great Grey Wolf Sif — https://sketchfab.com/3d-models/knight-artorias-and-great-grey-wolf-sif-bdf57355f95a420fa0c5b3e924bea16d | 9S | CC-BY | yes | yes (tag "rigged") | no | 28,765 | page says fan-art | Giant wolf is boss-grade. |
| Gwyn, Lord of Cinder | Gwyn, Lord of Cinder — https://sketchfab.com/3d-models/gwyn-lord-of-cinder-1365eda65be64c3d934c9687c5b5f73e | 9S | CC-BY | yes | yes (tag "rigged") | yes, 1 clip | 18,818 | page says fan-art | Human-size final boss. |
| Executioner Smough | Executioner Smough rigged — https://sketchfab.com/3d-models/executioner-smough-rigged-386ba65f17bf4d1db94133c8c07ccba3 | zzssgnekucjj | CC-BY | yes | yes (title) | no | 17,639 | not stated | Huge armored brute with hammer. |
| Malenia | Elden Ring's Malenia — https://sketchfab.com/3d-models/elden-rings-malenia-8b58145484204c44bebddea6795dd09b | Gilgamesh.art | CC-BY | yes | no (Quill painting) | yes, 1 clip | 359,938 | page says fan art (Quill) | Quill VR paint. Heavy. Poor fit for a rig. |

## Monster Hunter (Capcom)

| Character | Model + URL | Author | License | Free DL | Rigged | Animated | Tris | Ripped? | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Velkhana | Monster Hunter World: Iceborne - Velkhana — https://sketchfab.com/3d-models/monster-hunter-world-iceborne-velkhana-b480760cfff54313b319848cdc5eccb2 | Haku Dragon | CC-BY (page also says "no commercial use") | yes | yes (inferred) | yes, 24 clips | 146,325 | page says ripped ("I just ripped the model and animation") | Best animated dragon found. Ripped. At the budget limit. |
| Rathalos | Rathalos Simple Rig — https://sketchfab.com/3d-models/rathalos-simple-rig-057bfb72918843859316c2795db76739 | Msassasa | CC-BY | yes | yes (page) | no | 7,203 | not stated | Rigged, no clips. Needs keyframed animation. |
| Fatalis | Fatalis — https://sketchfab.com/3d-models/fatalis-8ef30ab4d0e34c74ab1df461ef43eb4c | sharksly | CC-BY | yes | yes (inferred) | yes, 14 clips | 6,194 | page says ripped ("I DO NOT OWN THIS MODEL", Monster Hunter Riders) | Mobile-game asset. |
| Agnaktor | Agnaktor — https://sketchfab.com/3d-models/agnaktor-ea76eb689ca14ff49190cdc42216183d | Mr. Bird | CC-BY | yes | yes (inferred) | yes, 1 clip | 7,892 | not stated | Lava wyvern. |
| Lunagaron | Lunagaron [Monster Hunter] — https://sketchfab.com/3d-models/lunagaron-monster-hunter-1d01e3b97bdf4d62bbcf1087aaceccfd | User 37564 | CC-BY-SA | yes | yes (inferred) | yes, 1 clip | 33,020 | page says own toon model ("not made with perfect quality") | Toon style. |

## Zelda (Nintendo)

| Character | Model + URL | Author | License | Free DL | Rigged | Animated | Tris | Ripped? | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Ganon (beast) | Zelda Ocarina of time Fan Art: Ganon — https://sketchfab.com/3d-models/zelda-ocarina-of-time-fan-art-ganon-868ad08b11e245078410ae8aa70a7068 | totidoki | CC-BY | yes | no | no | 48,173 | page says fan-made (ZBrush sculpt, Blender retopo, Substance) | Game-ready retopo. Big boar beast. Biped, so Mixamo auto-rig possible. |
| Calamity Ganon | Calamity Ganon - Legend of Zelda: Age of Calamity — https://sketchfab.com/3d-models/calamity-ganon-legend-of-zelda-age-of-calamity-a2d4746ac944421da3ebc4c2b2c4fe63 | omni | CC-BY | yes | no | no | 18,218 | likely ripped (inferred: "Model from The Legend of Zelda: Age of Calamity") | Spider-like final boss. |
| Lynel | Lynel — https://sketchfab.com/3d-models/lynel-7bdec79724dd49f299fb10b02664254c | Jjkklol | CC-BY | yes | no | no | 526,522 | not stated (no description) | Too heavy. |

## Minecraft (Mojang / Microsoft)

| Character | Model + URL | Author | License | Free DL | Rigged | Animated | Tris | Ripped? | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Wither Storm | Wither storm — https://sketchfab.com/3d-models/wither-storm-7c5ce4488d1948e4a80feb1410db4681 | CsDani50 | CC-BY | yes | yes (inferred) | yes, 7 clips | 21,042 | page says made in Blockbench | Huge tentacle boss. Blocky, but big and dark. |
| Ender Dragon | Revamped Ender Dragon — https://sketchfab.com/3d-models/revamped-ender-dragon-990819619e03463c8c0dea011ea34bb0 | Master Galanodel | CC-BY | yes | yes (inferred) | yes, 6 clips | 840 | page says own redesign | Voxel style. Iconic, but not "threatening detail". |
| Wither | Minecraft Animated Wither Boss — https://sketchfab.com/3d-models/minecraft-animated-wither-boss-188f76e496cc4efab27a088ab6b8f794 | CanYuTsai | CC-BY | yes | yes (inferred) | yes, 2 clips | 120 | page says own model | Very simple. |

## Metroid (Nintendo)

| Character | Model + URL | Author | License | Free DL | Rigged | Animated | Tris | Ripped? | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Meta Ridley | Meta Ridley Animation Pack (Corruption) — https://sketchfab.com/3d-models/meta-ridley-animation-pack-corruption-8acc94fa621c472eba63a56cfbdbe888 | Bornstellar Makes Eternallasting | CC-BY | yes | yes (inferred) | yes ("Contains several animations", 1 viewable) | 9,302 | likely ripped (inferred: Prime 3 game version) | Classic winged boss with many clips. |
| Metroid Prime | Metroid Prime>Creatures>Metroid Prime (Form 2) — https://sketchfab.com/3d-models/metroid-primecreaturesmetroid-prime-form-2-b3eb2827076948fdb0001d0ee1a40196 | Bornstellar Makes Eternallasting | CC-BY | yes | yes (inferred) | yes, 1 clip | 9,550 | likely ripped (inferred: description is the in-game scan text) | Final boss. |
| Ridley | Ridley — https://sketchfab.com/3d-models/ridley-de0c4bd1e92842d99866f5d486b1b632 | XxNinjaBladexX | CC-BY | yes | no | no | 53,532 | page says re-upload ("this is not mine", Smash Ultimate) | Re-upload of another model. Avoid. |

## Resident Evil (Capcom)

| Character | Model + URL | Author | License | Free DL | Rigged | Animated | Tris | Ripped? | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Tyrant (Mr. X) | Tyrant x — https://sketchfab.com/3d-models/tyrant-x-1df4ff15a6df4b0192dfa03728145e5e | photon (that one larry) | CC-BY | yes | no | no | 104,730 | likely ripped (inferred: same 104,730 tris as another RE2 upload by a second author) | Biped. Mixamo auto-rig possible. |
| Tyrant | resident evil tyrant — https://sketchfab.com/3d-models/resident-evil-tyrant-15f12782bb0a48a091de43c1dab4b435 | halloweeks | CC-BY | yes | yes (inferred) | yes, 1 clip | 8,901 | not stated (tag "pubg") | Light, animated. Source unclear. |
| Super Tyrant | Parasite Super Tyrant — https://sketchfab.com/3d-models/parasite-super-tyrant-42a050880a274f9faa603941e9a89eb5 | Vasian-Digital3D | CC-BY | yes | yes (inferred) | yes, 1 clip | 17,679 | not stated | Mutated form. |

## Destiny (Bungie)

| Character | Model + URL | Author | License | Free DL | Rigged | Animated | Tris | Ripped? | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Hive Ogre (Phogoth) | Destiny 2 ogre — https://sketchfab.com/3d-models/destiny-2-ogre-a4c9a3fe433a4c59a8a0138b246f3fe0 | Agus | CC-BY | yes | no | no | 30,781 | page says fan-made ("made in Blender ... Used Phogoth as reference") | Huge biped. Mixamo auto-rig possible. |

## League of Legends (Riot Games) and Mass Effect (BioWare / EA)

| Character | Model + URL | Author | License | Free DL | Rigged | Animated | Tris | Ripped? | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Baron Nashor | Baron Nashor LOL Zombicide Abomination — https://sketchfab.com/3d-models/baron-nashor-lol-zombicide-abomination-c5466bac4e18494c92dc385276d76675 | Toxicsquall | CC-BY | yes | no | no | 33,792 | page says fan board-game piece | Miniature for printing. Probably no textures. Weak fit. |
| Krogan | Krogans — https://sketchfab.com/3d-models/krogans-bc84f8bfa7174547b74c192bbc081f1d | photon (that one larry) | CC-BY | yes | no | no | 31,652 | not stated ("From mass effect") | Soldier race, not a monster. Weak fit. |

## Mixamo monster characters (Adobe)

Source of terms: Adobe Mixamo FAQ (https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html, found via search, direct fetch returned HTTP 403). Terms as quoted by search results: characters and animations are "available for free, with no licensing or royalty fees, for unlimited commercial or non commercial use". Raw character and animation files may not be redistributed to non-team members or packaged as assets.

The character names and artist suffixes come from a Mixamo character list (https://wiki.socialakiba.com/index.php/Mixamo_Characters). The triangle counts come from the official Mixamo Sketchfab previews (preview only, not downloadable there). All Mixamo characters are rigged on the Mixamo skeleton, and every Mixamo animation (idle, roar, punch, death, and more) applies to them.

| Character | Preview URL | Artist credit | License | Free DL | Rigged | Animated | Tris | Ripped? | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Warrok | https://sketchfab.com/3d-models/warrok-f9d5e826fd5f46d389946aa4a0d6074e | W Kurniawan (per search result) | Mixamo terms | yes (Adobe ID) | yes | yes, full Mixamo library | 12,626 | no (original) | Huge orc brute. Top original boss. |
| Maw | https://sketchfab.com/3d-models/maw-d2fac3bf09e9462cab77b134748f8e4b | J Laygo | Mixamo terms | yes | yes | yes | 13,910 | no | Hunched beast with a big mouth. |
| Mutant | not on the Mixamo Sketchfab account | none listed | Mixamo terms | yes | yes | yes | unknown | no | Hulking mutant. Classic boss look. |
| Pumpkinhulk | not on the Mixamo Sketchfab account | L Shaw | Mixamo terms | yes | yes | yes | unknown | no | Big seasonal (Halloween) boss. |
| Parasite | not on the Mixamo Sketchfab account | L Starikie | Mixamo terms | yes | yes | yes | unknown | no | Human-size infected creature. |
| Nightshade | https://sketchfab.com/3d-models/nightshade-48ef79e9a64b48e19a8f42b3df771b1b | J Friedrich | Mixamo terms | yes | yes | yes | 12,999 | no | Human-size. Medium menace. |
| Demon | https://sketchfab.com/3d-models/demon-e360c4c8204d4e839058164a35f555d7 | T Wiezzorek | Mixamo terms | yes | yes | yes | 16,318 | no | Horned demon. |
| Vampire | https://sketchfab.com/3d-models/vampire-3c36e0e098e145c8a2b99809b2d99ebb | A Lusth | Mixamo terms | yes | yes | yes | 15,022 | no | Human-size. |
| Goblin | https://sketchfab.com/3d-models/goblin-72b62446423b42889dca603afa0f4513 | D Shareyko | Mixamo terms | yes | yes | yes | 13,280 | no | Small. Minion, not a boss. |
| Brute | not on the Mixamo Sketchfab account | none listed | Mixamo terms | yes | yes | yes | unknown | no | Name only. Examine in Mixamo. |

## Top 10 recommended first

1. **Warrok (Mixamo)** — rigged, full animation library, 12.6k tris, original, royalty-free.
2. **Mutant (Mixamo)** — rigged, full animation library, classic hulking boss shape.
3. **Maw (Mixamo)** — rigged, full animation library, 13.9k tris, strong beast menace.
4. **Cyberdemon by Rexotec (Doom)** — CC-BY, fan-made, 12k tris, 3 clips. The only famous game boss with all four qualities.
5. **Ultralisk Animated by empress (StarCraft)** — CC-BY, 72.8k tris, animated. The requested StarCraft unit. The source is not stated.
6. **XT-002 by alexthebear (Warcraft)** — CC-BY, fan-made, 8k tris, 4 clips, a real raid boss.
7. **Ganon by totidoki (Zelda OoT)** — CC-BY, fan-made, game-ready 48k tris. Add Mixamo auto-rig for animations.
8. **Halo Elite Minor by martinjohnsrud (Halo)** — CC-BY, fan-made, 63.9k tris. Add Mixamo auto-rig. The requested Elite.
9. **Destiny 2 Ogre by Agus (Destiny)** — CC-BY, fan-made, 30.8k tris, huge biped. Add Mixamo auto-rig.
10. **Mancubus Doom Fanart by jason.lp.davis (Doom)** — CC-BY, fan-made, 25.5k tris, huge silhouette. Needs a custom rig or code animation.

Next choices: Halo 3 Hunter by Fliqpy717 (the requested Hunter, CC-BY, low-poly), Wither Storm by CsDani50 (7 clips), Executioner Smough (rigged), and Aldrich by 9S. For the Hydralisk, no fan-made animated model exists. The best CC-BY fan option is MESH Hydralisk by thedino1 (static, needs a custom rig).

## Credit line format

Use this pattern:

`<Character> © <Rights holder> — model by <Author> (<License>), <URL>`

Keep the URL in the credit or in a linked credits page. CC-BY requires the title, the author, the source, and the license. CC-BY-SA also requires that a changed version keeps CC-BY-SA.

Examples:

- `Cyberdemon © id Software / Bethesda — model by Rexotec (CC-BY 4.0)`
- `Ultralisk © Blizzard Entertainment — model by empress (CC-BY 4.0)`
- `Hydralisk © Blizzard Entertainment — model by thedino1 (CC-BY 4.0)`
- `XT-002 Deconstructor © Blizzard Entertainment — model by alexthebear (CC-BY 4.0)`
- `Elite (Sangheili) © Microsoft / 343 Industries — model by martinjohnsrud (CC-BY 4.0)`
- `Hunter © Microsoft / 343 Industries — model by Fliqpy717 (CC-BY 4.0)`
- `Grunt © Microsoft / 343 Industries — model by Outworld Studios (CC-BY-SA 4.0)`
- `Ganon © Nintendo — model by totidoki (CC-BY 4.0)`
- `Hive Ogre © Bungie — model by Agus (CC-BY 4.0)`
- `Wither Storm © Mojang / Telltale — model by CsDani50 (CC-BY 4.0)`
- `Deathwing © Blizzard Entertainment — model by João Lacerda (CC-BY-NC-SA 4.0)`
- `Warrok — character by W Kurniawan, Adobe Mixamo (Mixamo license)` (a Mixamo credit is optional under the Mixamo terms, but it is good practice)
- `Maw — character by J Laygo, Adobe Mixamo (Mixamo license)`

For a ripped model, the uploader cannot grant rights to the game asset. If you use one, credit the game company first and the uploader second: `Velkhana © Capcom — game asset uploaded by Haku Dragon`.
