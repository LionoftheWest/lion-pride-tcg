# Raid boss 3D model candidates

Research date: 2026-09-27. Scope: boss-grade glTF-ready models of well-known game monsters, for the private Lion Pride TCG raid bosses (three.js in a Discord Activity).

## Summary

- 121 model rows: 58 across 11 non-Nintendo franchises (with 6 Kerrigan rows), 41 Nintendo villains, 22 Minecraft bosses, plus the 10 Mixamo monsters.
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
4. Nintendo and Minecraft have extra rules. See the policy notes at the start of the "Nintendo villains" and "Minecraft" sections.
5. Gaps: no fan-made, animated, downloadable Hydralisk at boss quality (see the StarCraft table). No usable Mass Effect Reaper or Thresher Maw creature. No Diablo (the Lord of Terror) model. No usable League of Legends monster (Baron Nashor exists only as a board-game miniature). No downloadable Primal Kerrigan and no fan-made Ascended Kerrigan. No Grima, Medeus, Xenoblade villain, Crazy Hand, Dark Matter, Jungle Abomination, or Devourer.

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

### Kerrigan (Queen of Blades) and her other forms

Kerrigan is humanoid. The "Mixamo auto-rig" column tells if the Mixamo auto-rigger can put a standard humanoid skeleton on the model. The wings and back-spines do not get bones from Mixamo. Add those bones by hand or leave them rigid.

| Form | Model + URL | Author | License | Free DL | Rigged | Animated | Tris | Ripped? | Mixamo auto-rig | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Infested (Queen of Blades) | Kerrigan — https://sketchfab.com/3d-models/kerrigan-4cf7a397f0314d2cbc81cc6cf76f0830 | Luzsombria | CC-BY | yes | no | no | 13,100 | not stated ("Kerrigan, the Queen of Blades from Starcraft. Be Free to Download") | yes, if it is in a T-pose or an A-pose (the pose is not stated). The wings stay rigid. | Best CC-BY option. The source is not stated, so it can be a game extract. |
| Infested (Queen of Blades) | Sarah Kerrigan Infested — https://sketchfab.com/3d-models/sarah-kerrigan-infested-5df205285735411eac9a94ec1f8ad859 | Vasian-Digital3D | CC-BY | yes | yes (inferred) | yes, 1 clip | 18,487 | not stated (no description). This author also has Diablo models that are likely extracted. | not needed (it has a rig). If you remove the rig, yes. | Has its own rig and 1 clip. |
| Infested (Queen of Blades) | Kerrigan - Infested - Starcraft 2 — https://sketchfab.com/3d-models/kerrigan-infested-starcraft-2-2806d927701143b6b3b5fc42d26fff75 | Catholomew | CC-BY-NC | yes | yes (inferred) | yes, 8 clips | 6,650 | page says ripped ("assets from various games ... not my creations") | not needed | SC2 game asset. NC + ripped. |
| Ascended / Enlightened | kerrigan_enlightened — https://sketchfab.com/3d-models/kerrigan-enlightened-f15d6804d7f549bf917f8edb88b78d6f | Catholomew | CC-BY-NC | yes | yes (inferred) | yes, 3 clips | 6,650 | page says ripped | not needed | The only Ascended-type form found. NC + ripped. |
| Infested (3D print) | StarCraft 3D Kerrigan — https://sketchfab.com/3d-models/starcraft-3d-kerrigan-c2f741c304b949f0b5f8693c3d85e285 | Kowalczyk91 | CC-BY-NC-SA | yes | no | no | 100,000 | page says "A 3D printed model ... Created with Polycam" (a photo scan of a print) | no (a scan of a posed figure) | Poor fit. |
| Queen of Blades (fan art) | Sarah Kerrigan — https://sketchfab.com/3d-models/sarah-kerrigan-1ade3d04e7244d4d809252718e737ccc | Filippo Ferrarini | page text says "CC BY-NC 4.0" and also "ALL RIGHTS RESERVED". Not downloadable. | no | unknown | no | 40,330 | page says "an original fan art" | not applicable | The only search result for "primal kerrigan", but the page says Queen of Blades. You cannot download it. |

No downloadable Primal Kerrigan exists. No fan-made Ascended Kerrigan exists. The only Ascended-type model is the ripped Catholomew "enlightened" upload.

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

The Zelda and Metroid tables are now in the "Nintendo villains" section. The Minecraft table is now in the "Minecraft" section.

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

## Nintendo villains

### Nintendo policy note

Nintendo publishes guidelines only for gameplay videos and screenshots. The Nintendo Game Content Guidelines (https://www.nintendo.co.jp/networkservice_guideline/en/index.html) say: "Any other use of Nintendo's intellectual property and creation of content outside of this scope is subject to the relevant laws of the applicable jurisdiction." No Nintendo rule permits fan 3D models in a fan game. Nintendo is known for strict takedowns of fan projects (this is general knowledge, not a statement from the page). A private Discord server that never charges money and shows credits has a low risk, but not zero risk. Do not show Nintendo bosses in a public preview, a public gallery, or the public GitHub repository.

Most Nintendo models on Sketchfab are extracted from games. These patterns show an extract:
- A title in the form "Wii - Super Smash Bros Brawl - ...", "3DS - Pokemon X Y - ...", or "Mobile - Pokemon HOME - ..." (the naming of The Models Resource rip archive).
- The same triangle count on uploads by different authors (for example, 6,978 for Rayquaza and 14,934 for Eternatus).
- "Alternate Costume for ... in Project M" (Project M is a mod built on Brawl game files).

### Mario, Donkey Kong, and Luigi's Mansion

| Character | Model + URL | Author | License | Free DL | Rigged | Animated | Tris | Ripped? | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Bowser | Bowser (Super Mario Fan Art) (My Version) — https://sketchfab.com/3d-models/bowser-super-mario-fan-art-my-version-36fe4591daab4076b5a145b671f21f3e | MlgxArt | CC-BY | yes | no | no | 148,496 | page says fan-made (tags "fanart", "gamefanart") | The only fan-made Bowser. At the budget limit. The tag "cute" can mean a soft style. Examine it first. |
| Bowser (Fury) | Fury Bowser — https://sketchfab.com/3d-models/fury-bowser-fac33fefb4cf418a83be172914455676 | irons3th | CC-BY | yes | no | no | 59,296 | likely ripped (inferred: other irons3th uploads say "Model and textures by" the game company) | Kaiju-size Bowser. Strong boss look. |
| Giga Bowser | Wii - Super Smash Bros Brawl - Giga Bowser — https://sketchfab.com/3d-models/wii-super-smash-bros-brawl-giga-bowser-38fe078349354f46a934f4db407a969f | Warrior364 | CC-BY | yes | no | no | 7,480 | likely ripped (inferred: rip-archive title) | Low detail. |
| Dry Bowser | Dry Bowser — https://sketchfab.com/3d-models/dry-bowser-3d95698d871c4f159f12b6fd053d9a73 | projectmgame | CC-BY | yes | no | no | 6,381 | likely derived from game files ("Alternate Costume for Bowser in Project M") | Skeleton Bowser. Low detail. |
| Wart | Wart (Mario 2) — https://sketchfab.com/3d-models/wart-mario-2-ae33b9cc47084c85a3ccfcc034761d02 | Nwilly_art | CC-BY | yes | no | no | 448,500 | fan-made (inferred: page links to the artist's ArtStation renders) | Too heavy (3x the budget). |
| Wart | wart — https://sketchfab.com/3d-models/wart-a5f44e5992b6453ca0f808b6f5d516f7 | alphysLAB | CC-BY | yes | no | no | 31,582 | not stated ("super mario 2") | Light option. |
| King K. Rool | His majesty, King K. Rool. — https://sketchfab.com/3d-models/his-majesty-king-k-rool-71ccd17f23db482e948758972ebd2e9c | Alvaro7N | CC-BY | yes | no | no | 4,185 (page: "7200 tris") | page says fan-made (ZBrush, Blender, "done for an upcoming game Mod") | Big crocodile king. Biped, so Mixamo auto-rig possible. Small textures (512 px). |
| King K. Rool | Mario Super Sluggers King K Rool — https://sketchfab.com/3d-models/mario-super-sluggers-king-k-rool-5f6b3888550c4cc88603b2b8848469b6 | akennedy007 | CC-BY | yes | yes (inferred) | yes, 1 clip | 5,868 | page says ripped ("this model is owned by nintendo") | Avoid. |
| King Boo | King Boo Idle animation — https://sketchfab.com/3d-models/king-boo-idle-animation-29a6c3dbbe444bf5996f8c45e7432c1c | Sofia Tadi8 | CC-BY | yes | yes (inferred) | yes, 1 clip (idle) | 7,992 | page says fan-made ("a funny and speedy model I created") | Ghost boss. Easy to float and scale up. The same author also has "King BOO Attack". |

### Zelda

| Character | Model + URL | Author | License | Free DL | Rigged | Animated | Tris | Ripped? | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Ganon (beast) | Zelda Ocarina of time Fan Art: Ganon — https://sketchfab.com/3d-models/zelda-ocarina-of-time-fan-art-ganon-868ad08b11e245078410ae8aa70a7068 | totidoki | CC-BY | yes | no | no | 48,173 | page says fan-made (ZBrush sculpt, Blender retopo, Substance) | Best Nintendo pick. Game-ready retopo. Big boar beast. Biped, so Mixamo auto-rig possible. |
| Ganondorf | Hyrule Warriors Ganondorf(Wii U) — https://sketchfab.com/3d-models/hyrule-warriors-ganondorfwii-u-7f0752a532d3469cb023ce79e76741dc | NiB | CC-BY | yes | no | no | 32,597 | page says fan-made ("Couldn't find this model ANYWHERE, so decided to [make] it myself") | Armored warlord. Mixamo auto-rig possible. |
| Ganondorf (Miasma) | Ganondorf (Miasma) — https://sketchfab.com/3d-models/ganondorf-miasma-d4f5b22ae59545b98664e6bf51828899 | Slammiio | CC-BY | yes | no | no | 61,857 | not stated (no description) | Tears of the Kingdom look. |
| Calamity Ganon | Calamity Ganon- Legend of Zelda: Age of Calamity — https://sketchfab.com/3d-models/calamity-ganon-legend-of-zelda-age-of-calamity-a2d4746ac944421da3ebc4c2b2c4fe63 | omni | CC-BY | yes | no | no | 18,218 | likely ripped (inferred: "Model from The Legend of Zelda: Age of Calamity") | Spider-like final boss. |
| Demise | The Legend Of Zelda Skyward Sword - Demise — https://sketchfab.com/3d-models/the-legend-of-zelda-skyward-sword-demise-fe1211fc451f4ebe94a5f3ac9bf622dc | Dedlele | CC-BY | yes | no | no | 10,170 | likely ripped (inferred: the author posts one Ganondorf per game release, and a second author has the same 10,170 tris) | Giant demon swordsman. |
| Majora's Mask | Majora's Mask — https://sketchfab.com/3d-models/majoras-mask-e9cfcdf9875846f6b6137f0156cd4eb2 | PigeonMage | CC-BY | yes | no | no | 13,616 | page says own model ("Remade a model I made") | Mask only. Usable as a floating first phase (spin and tentacle effects in code). |
| Lynel | Lynel — https://sketchfab.com/3d-models/lynel-7bdec79724dd49f299fb10b02664254c | Jjkklol | CC-BY | yes | no | no | 526,522 | not stated (no description) | Too heavy. |

### Metroid

| Character | Model + URL | Author | License | Free DL | Rigged | Animated | Tris | Ripped? | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Mother Brain | Super Metroid - Mother Brain — https://sketchfab.com/3d-models/super-metroid-mother-brain-f7ecbe20d006484198379d5382d33f55 | DordusRising | CC-BY | yes | no | no | 75,482 | page says fan-made ("I decided to go off of [the] Super Metroid design", tag "madeinblender") | A brain boss needs no rig: pulse, glow, and eye tracking in code. The page says that the shaders need to be done again. |
| Ridley | Ridley — https://sketchfab.com/3d-models/ridley-de0c4bd1e92842d99866f5d486b1b632 | XxNinjaBladexX | CC-BY | yes | no | no | 53,532 | page says re-upload ("this is not mine", Smash Ultimate) | Avoid. |
| Meta Ridley | Meta Ridley Animation Pack (Corruption) — https://sketchfab.com/3d-models/meta-ridley-animation-pack-corruption-8acc94fa621c472eba63a56cfbdbe888 | Bornstellar Makes Eternallasting | CC-BY | yes | yes (inferred) | yes ("Contains several animations", 1 viewable) | 9,302 | likely ripped (inferred: Prime 3 game version) | Winged boss with many clips. |
| Metroid Prime | Metroid Prime>Creatures>Metroid Prime (Form 2) — https://sketchfab.com/3d-models/metroid-primecreaturesmetroid-prime-form-2-b3eb2827076948fdb0001d0ee1a40196 | Bornstellar Makes Eternallasting | CC-BY | yes | yes (inferred) | yes, 1 clip | 9,550 | likely ripped (inferred: description is the in-game scan text) | Final boss. |
| Kraid | Kraid — https://sketchfab.com/3d-models/kraid-9c93db1ecc7448688e7ef3cb7140a496 | Bornstellar Makes Eternallasting | CC-BY | yes | unknown | no | 16,510 | likely ripped (inferred: Metroid Dread version) | Giant reptile. Very boss-grade shape. |
| Kraid | Super Smash Bros Ultimate - Kraid — https://sketchfab.com/3d-models/super-smash-bros-ultimate-kraid-dad58270d8b0461eb80dbad0cd42102e | parnlogang | CC-BY | yes | no | no | 12,572 | likely ripped (inferred: rip-archive title) | Same concern. |
| Dark Samus | Dark Samus v2 (Metroid) — https://sketchfab.com/3d-models/dark-samus-v2-metroid-1000d7e058b64670b9871d3792b2f369 | JonnyMANSON | CC-BY | yes | no | no | 61,314 | page says a retexture of a model by tntpredarno | Credit both authors. Human-size. Mixamo auto-rig possible. |
| Dark Samus | Dark Samus - Super Smash Bros Ultimate — https://sketchfab.com/3d-models/dark-samus-super-smash-bros-ultimate-cd79b2aa443a4f239837d0ff3986c417 | Kittydemon_O | CC-BY | yes | no | no | 16,614 | page says ripped ("Official model, ported using the model from models resource") | Avoid. |

### Kirby, Star Fox, and Smash Bros.

| Character | Model + URL | Author | License | Free DL | Rigged | Animated | Tris | Ripped? | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Marx | Marx (Kirby) (My 3D Model Fan Art) — https://sketchfab.com/3d-models/marx-kirby-my-3d-model-fan-art-047a8f3e3b654984b1313d236d199618 | MlgxArt | CC-BY | yes | no | no | 78,784 | page says fan-made ("When using it, please give me credit") | Cute but evil jester. Medium menace. |
| Magolor | Magolor - Kirby — https://sketchfab.com/3d-models/magolor-kirby-5c73e1e687154c00a2159debce7a44a8 | rgrbzrr | CC-BY | yes | no | no | 32,000 | not stated (tag "substancepainter", own work inferred) | Base form, not Magolor Soul. Low menace. |
| Masked / Noir Dedede | Noir Dedede — https://sketchfab.com/3d-models/noir-dedede-7488751280cb43759bb13c5696ca20ce | SAB64 | CC-BY | yes | yes (page: "This model is rigged") | no | 40,751 | derived from a game model (page: "used King Dedede's model from Kirby Star Allies as a base") | Dark Dedede. Rigged, with shape keys. |
| Andross | Andross — https://sketchfab.com/3d-models/andross-706cb25f63b84614aa5dbd8998e87eea | elarix | CC-BY | yes | no | no | 838,748 | page says own sculpt ("ZBrush and Substance Painter") | Giant floating head. Too heavy. Needs strong decimation. |
| Andross | 64>Original>Bosses>Andross — https://sketchfab.com/3d-models/64originalbossesandross-662f776e8e06412983548a4e9826ec09 | Bornstellar Makes Eternallasting | CC-BY | yes | no | no | 3,183 | likely ripped (inferred: N64 original, "All 3 forms") | Retro low-poly. |
| Master Hand | N64 Master Hand (Smooth Ver.) — https://sketchfab.com/3d-models/n64-master-hand-smooth-ver-2ca4295edabe484f88deabf12396f185 | Fausto Javier Da Rosa | CC-BY | yes | no | no | 11,376 | not stated (no description) | Giant glove. Easy to animate in code. |
| Tabuu | Super Smash Bros Brawl - Trophies - Tabuu — https://sketchfab.com/3d-models/super-smash-bros-brawl-trophies-tabuu-559bcae21bb24b9db8e052f376fc78ab | blueskystudiosfan165 | CC-BY | yes | no | no | 4,760 | likely ripped (inferred: Brawl trophy) | Low detail. |

Not found as downloadable models: Crazy Hand, Dark Matter, Magolor Soul, Grima, Medeus, and all Xenoblade villains (Zanza, Metal Face, Moebius). The Xenoblade search gave only party characters.

### Pokemon legendaries (The Pokemon Company / Nintendo / Game Freak)

| Character | Model + URL | Author | License | Free DL | Rigged | Animated | Tris | Ripped? | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Kyogre | Kyogre Model — https://sketchfab.com/3d-models/kyogre-model-704966a1e0a64dbabd49b6f87393470e | spritemare | CC-BY | yes | no | no | 128,328 | page says fan-made ("made in Gravity Sketch in Vr", for 3D printing) | Big sea whale. A print model, so the textures can be plain. |
| Groudon (Primal) | Primo Groudon — https://sketchfab.com/3d-models/primo-groudon-d7ca103646e749f3b0ed16e5309343e8 | Robduc | CC-BY | yes | no | no | 12,688 | not stated ("printable 3D Model") | Light. Print model. |
| Giratina | Giratina — https://sketchfab.com/3d-models/giratina-19d018c70d3b4a318ea8674b0b4084af | AmedeDragon | CC-BY | yes | no | no | 99,980 | not stated (no description) | Huge ghost dragon. |
| Giratina (Origin) | Pokémon Giratina (origin) — https://sketchfab.com/3d-models/pokemon-giratina-origin-240a861506294310b0e323a10a28fceb | BodeMAN | CC-BY | yes | no | no | 237,698 | not stated (description is Pokedex text) | Too heavy. |
| Rayquaza | Rayquaza — https://sketchfab.com/3d-models/rayquaza-cb233f1319874dedb7af9c02138d039e | enea | CC-BY | yes | no | no | 75,502 | not stated ("pokèmon") | Sky serpent. Needs a bone-chain rig. |
| Eternatus | Eternatus — https://sketchfab.com/3d-models/eternatus-a13a4080cf364cec872784f429886cfa | gargyion | CC-BY | yes | no | no | 181,848 | not stated (description is Pokedex text) | Over budget. |
| Eternatus | Eternatus — https://sketchfab.com/3d-models/eternatus-700d5fbbab114ada8cafe842d5ed2ad2 | LunaEagle | CC-BY | yes | yes (inferred) | yes, 5 clips | 14,934 | likely ripped (inferred: same 14,934 tris as "Mobile - Pokemon HOME - 890 Eternatus") | Animated, but ripped. |
| Mewtwo | Mewtwo — https://sketchfab.com/3d-models/mewtwo-3ce307c3bada4b088ea48107dc0e983c | Squirmy Worm | CC-BY | yes | no | no | 165,074 | not stated | Slightly over budget. Humanoid, so Mixamo auto-rig possible. |
| Mewtwo | Mewtwo (Official) — https://sketchfab.com/3d-models/mewtwo-official-d8aebb93c39243b3a62022591202a97a | Mariokart07 | CC-BY | yes | yes (inferred) | yes, 71 clips | 9,986 | page says ripped ("The model, textures ... and animations are made by Gamefreak") | Avoid. |
| Legendaries (voxel set) | Mewtwo - remastered — https://sketchfab.com/3d-models/mewtwo-remastered-941c8f5cbbe24f7aa22b782256de8717 ; Rayquaza - Remastered — https://sketchfab.com/3d-models/rayquaza-remastered-cc5f5189dcaf47e9a4c4ba4e77d183af ; Giratina (Origin Form) — https://sketchfab.com/3d-models/giratina-origin-form-14de1454d36642328b6a9a779128cae2 ; Eternatus — https://sketchfab.com/3d-models/eternatus-b113b1d1e08c462b9699601ce9b08b0a ; Ultra Necrozma — https://sketchfab.com/3d-models/ultra-necrozma-re-upload-989a089a69c445eeab4c126e21ffa56c ; Groudon — https://sketchfab.com/3d-models/groudon-07bbf5472d484b52ba6ad0efcb45b237 ; Kyogre — https://sketchfab.com/3d-models/kyogre-76a7500ce4a44af78859d0f8645d3b94 | Master Galanodel | CC-BY | yes | yes (inferred) | yes, 4 to 6 clips each | 372 to 4,956 | page says own Blockbench models ("made in a cobblemon-type model style", "bedrock entity adaptation") | Fan-made and animated, but in voxel style. Low menace. A consistent set. |

## Minecraft (Mojang Studios / Microsoft)

### Mojang usage rule

The official Minecraft Usage Guidelines (https://www.minecraft.net/en-us/usage-guidelines) say about personal creations: "We are very relaxed about things you create for yourself." They also say: "When you decide to share your content with the community (whether you plan to make money off it or not), you are doing what we consider to be a commercial thing. When you do commercial things, you must follow the Commercial Use guidelines. This applies, for example, if you want to set up and run any non-commercial blogs, servers, community forums, fan sites, fan clubs, news groups, events, and gatherings." A shared Discord Activity is in this group. The essential rules are: "Do not do anything or include anything that makes people think that what you are sharing could be interpreted as official or approved by, endorsed by, associated with, supported by, or connected to us", "Do not redistribute our games or any alterations of our games or game files", and "Prominently include the disclaimer similar to the following: 'NOT AN OFFICIAL MINECRAFT [PRODUCT/SERVICE/EVENT/etc.]. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT'". The guidelines define assets as "the code, software, graphics, textures, images, models, sounds and other audio from any of our games". Thus a model that uses the official Mojang texture redistributes a game file. A model that we build with our own texture is safer. Show the disclaimer on each Minecraft boss screen.

### Build or use

Minecraft mobs are textured cubes. Build our own model in Blockbench with our own texture (Blockbench exports glTF) when no fan-made model has its own art. The "Build or use" column gives the recommendation for each mob.

| Character | Model + URL | Author | License | Free DL | Rigged | Animated | Tris | Ripped? | Build or use | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Ender Dragon | Realistic Minecraft Ender Dragon — https://sketchfab.com/3d-models/realistic-minecraft-ender-dragon-a43e3ede784f4c52aeeec355784057c1 | Matt Alexander | CC-BY | yes | no | no | 19,542 | derived (inferred: page links to "Realistic Dragon Textures" by Jazz Vincent) | use, if the render is good (credit both authors) | Realistic dragon, not cubes. Boss-grade. |
| Ender Dragon | Ender Dragon — https://sketchfab.com/3d-models/ender-dragon-9cf16e5afd834f909a4796d1f9d4ec0c | irzafy | CC-BY | yes | yes (inferred) | yes, 1 clip (fly) | 5,392 | page says own ("free for everyone") | use, or build | Classic blocky look with a fly cycle. |
| Ender Dragon | Revamped Ender Dragon — https://sketchfab.com/3d-models/revamped-ender-dragon-990819619e03463c8c0dea011ea34bb0 | Master Galanodel | CC-BY | yes | yes (inferred) | yes, 6 clips | 840 | page says own redesign | use | Voxel redesign with 6 clips. |
| Wither | Wither — https://sketchfab.com/3d-models/wither-70ada384a73843418c8024e30b7aa286 | patrix | CC-BY-SA | yes | no | no | 92,140 | page says own sculpt (for the author's resource pack) | use | Horror-style realistic Wither. Very threatening. SA applies to changed versions. |
| Wither | Minecraft Animated Wither Boss — https://sketchfab.com/3d-models/minecraft-animated-wither-boss-188f76e496cc4efab27a088ab6b8f794 | CanYuTsai | CC-BY | yes | yes (inferred) | yes, 2 clips | 120 | page says own model | build | Too simple. Our own build is better. |
| Wither Storm | Wither storm — https://sketchfab.com/3d-models/wither-storm-7c5ce4488d1948e4a80feb1410db4681 | CsDani50 | CC-BY | yes | yes (inferred) | yes, 7 clips | 21,042 | page says made in Blockbench ("The Wither Storm from Minecraft: Story Mode") | use | Best Minecraft boss found. Huge, dark, animated. |
| Wither Storm | Wither Storm Stage 8 + Severed pose — https://sketchfab.com/3d-models/wither-storm-stage-8-severed-pose-9166b0ab038c4ecabe1ff108d74d42c3 | bppark | CC-BY | yes | yes (inferred) | yes, 3 clips | 167,492 | not stated | use (decimate) | Final-stage storm. Over budget. |
| Warden | Warden Minecraft (animation recreations) — https://sketchfab.com/3d-models/warden-minecraft-animation-recreations-25a0311564e044f898cd5f1f05e7798c | nathenmario | CC-BY | yes | yes (inferred) | yes, 6 clips | 120 | not stated (the texture can be the official one) | build | The mob is simple. Build it with our own texture. |
| Elder Guardian | Guardian — https://sketchfab.com/3d-models/guardian-1ce2d3661ea54c37a9ad4c41c8435a99 | patrix | CC-BY-SA | yes | no | no | 136,532 | page says own sculpt | build (no Elder Guardian found) | The normal Guardian in a realistic style. Recolor it for an Elder Guardian, or build one. |
| Ravager | Ravager — https://sketchfab.com/3d-models/ravager-9fe5faf9b6284b1eb986fdf9e082dbdc | patrix | CC-BY-SA | yes | no | no | 367,942 | page says own sculpt | build, or decimate this | Realistic rhino beast. Too heavy. |
| Ravager | Ravager Minecraft — https://sketchfab.com/3d-models/ravager-minecraft-4c89841f86374fb1be1f3b855074e1a5 | JDanielhes | CC-BY | yes | no | no | 9,858 | not stated | build | Blocky. No rig. |
| Evoker | Minecraft Simple Evoker (Rigged) Blender — https://sketchfab.com/3d-models/minecraft-simple-evoker-rigged-blender-6d32f26422724f15b9631e30c47a4383 | TheBrixmin | CC-BY | yes | yes (title) | yes, 1 clip | 7,413 | uses the official texture (page: "Missing Texture File, Find it at https://minecraft.fandom.com/wiki/Evoker#Textures") | build | Our own build avoids the official texture. |
| Piglin Brute | Piglin Brute Remake — https://sketchfab.com/3d-models/piglin-brute-remake-711410c5d026474392cf642f11cb04e4 | LaserFont0103 | CC-BY | yes | yes (inferred) | yes, 1 clip | 384 | not stated | build | Too small for a boss. patrix also has a realistic Piglin (356,068 tris, CC-BY-SA, https://sketchfab.com/3d-models/piglin-6c87067fbf4b47ab8e61de2ffee1b34a). |
| Ghast | HD Ghast — https://sketchfab.com/3d-models/hd-ghast-4a3c8e65815246cfa3c4de56bb0ef3b3 | ArtsByKev | CC-BY | yes | yes (inferred) | yes, 4 clips | 5,540 | page says own Blockbench model | use | Well animated. |
| Ghast | Minecraft Ghast — https://sketchfab.com/3d-models/minecraft-ghast-9421ee17a06044d390ca7355f77732f7 | xweert123 | CC-BY | yes | yes (inferred) | yes, 2 clips | 36,226 | page says own HD model | use | Creepy HD Ghast. |
| Ghast | Ghast — https://sketchfab.com/3d-models/ghast-8fdf95072a274f6b804b0df4c6c5913b | patrix | CC-BY-SA | yes | yes (inferred) | yes, 1 clip | 80,152 | page says own sculpt | use | Horror style. Very threatening. |
| Iron Golem | Iron Golem (Rigged) — https://sketchfab.com/3d-models/iron-golem-rigged-0e16a5be3cac48b2b4dd9b040ebbf38d | @German_Martian | CC-BY | yes | yes (title) | yes, 1 clip | 13,584 | likely official geometry and texture (inferred: "made with the MCprep Addon", which imports game assets) | build | Our own build is safer. |
| Mutant Iron Golem | Mutant iron golem minecraft animated — https://sketchfab.com/3d-models/mutant-iron-golem-minecraft-animated-a139255741d14274961e5b51d3c8c04f | ghostaryan83 | CC-BY | yes | yes (inferred) | yes, 18 clips | 672 | derived from a mod ("Addon by @jujustyle7") | use, with credit to both | Many clips. A mod design, not an official mob. |
| Arch-Illager | Arch-illager — https://sketchfab.com/3d-models/arch-illager-cee2dfe4351a429bafaeefa3282496a5 | Ansh Rawat | CC-BY | yes | no | no | 740 | not stated | build | Static. Our own animated build is better. |
| Heart of Ender | Heart Of The Ender — https://sketchfab.com/3d-models/heart-of-the-ender-please-follow-421b8802c6294f0f89b083b1abed6f79 | Ansh Rawat | CC-BY | yes | no | no | 416 | not stated | build | Static. |
| Redstone Monstrosity (Dungeons) | Redstone Monstrosity 2 — https://sketchfab.com/3d-models/redstone-monstrosity-2-55b0b9a2af0d403b8594cbfecc0886c9 | Vindsval | CC-BY | yes | yes (inferred) | yes, 7 clips | 1,080 | uses the official texture ("Official texture, model and animations by me") | use the rig and clips, paint a new texture | Big Dungeons boss with 7 clips. |
| Endersent (Dungeons) | Endersent — https://sketchfab.com/3d-models/endersent-610092fd8c864d178951fe49460e4644 | Vindsval | CC-BY | yes | yes (inferred) | yes, 4 clips | 144 | uses the official texture ("using the official texture") | use the rig, paint a new texture | Tall End mob. |

Not found: the Jungle Abomination (Minecraft Dungeons) and the Devourer (Minecraft Legends). Build them.

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

The Nintendo models did not change the Top 10. Ganon by totidoki (item 7) is already the best Nintendo pick. No other Nintendo model is fan-made, animated, and under 150k tris at the same time.

### Best Nintendo picks

1. **Ganon by totidoki (Zelda)** — CC-BY, fan-made, 48k tris. Mixamo auto-rig.
2. **Mother Brain by DordusRising (Metroid)** — CC-BY, fan-made, 75k tris. A brain in a tank, so code animation is enough.
3. **King K. Rool by Alvaro7N (Donkey Kong)** — CC-BY, fan-made for a mod, 7.2k tris. Mixamo auto-rig.
4. **Hyrule Warriors Ganondorf by NiB (Zelda)** — CC-BY, fan-made, 32.6k tris. Mixamo auto-rig.
5. **Kyogre by spritemare (Pokemon)** — CC-BY, fan-made, 128k tris. Code animation (swim and bob).
6. **Bowser by MlgxArt (Mario)** — CC-BY, fan-made, 148k tris. Examine the style first (tag cute).

### Best Minecraft picks

1. **Wither Storm by CsDani50** — CC-BY, Blockbench, 21k tris, 7 clips. Use it.
2. **Wither by patrix** — CC-BY-SA, horror sculpt, 92k tris. Use it (needs a rig).
3. **Ghast by ArtsByKev** or **xweert123** — CC-BY, own models, 4 or 2 clips. Use one.
4. **Realistic Ender Dragon by Matt Alexander** — CC-BY, 19.5k tris. Use it, credit both authors.
5. **Build our own** Warden, Elder Guardian, Ravager, Evoker, Piglin Brute, Iron Golem, Arch-Illager, Heart of Ender, Jungle Abomination, and Devourer in Blockbench with our own textures.

### Best Kerrigan pick

**Kerrigan by Luzsombria** — CC-BY, 13.1k tris, source not stated. Use the Mixamo auto-rig for the body, and keep the wings rigid. The Vasian-Digital3D model (CC-BY, 18.5k tris, own rig and 1 clip) is the second choice.

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
- `Wither Storm © Mojang Studios / Telltale Games — model by CsDani50 (CC-BY 4.0)`
- `Queen of Blades (Kerrigan) © Blizzard Entertainment — model by Luzsombria (CC-BY 4.0)`
- `Mother Brain © Nintendo — model by DordusRising (CC-BY 4.0)`
- `King K. Rool © Nintendo — model by Alvaro7N (CC-BY 4.0)`
- `Ganondorf © Nintendo — model by NiB (CC-BY 4.0)`
- `Kyogre © The Pokémon Company / Nintendo / Game Freak — model by spritemare (CC-BY 4.0)`
- `Dark Samus © Nintendo — model by tntpredarno, retextured by JonnyMANSON (CC-BY 4.0)`
- `Wither © Mojang Studios — model by patrix (CC-BY-SA 4.0). NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.`
- `Ghast © Mojang Studios — model by ArtsByKev (CC-BY 4.0)`
- `Deathwing © Blizzard Entertainment — model by João Lacerda (CC-BY-NC-SA 4.0)`
- `Warrok — character by W Kurniawan, Adobe Mixamo (Mixamo license)` (a Mixamo credit is optional under the Mixamo terms, but it is good practice)
- `Maw — character by J Laygo, Adobe Mixamo (Mixamo license)`

For each Minecraft boss, show the Mojang disclaimer on the boss screen or the credits page.

For a ripped model, the uploader cannot grant rights to the game asset. If you use one, credit the game company first and the uploader second: `Velkhana © Capcom — game asset uploaded by Haku Dragon`.
