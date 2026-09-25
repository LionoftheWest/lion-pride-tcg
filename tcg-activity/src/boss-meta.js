// Display metadata for the Raid Boss gallery — one entry per archetype in
// src/boss.js ARCH_BUILDERS. `arch` is the archetype key (the seed uses
// `arch:<arch>`), `title` + `blurb` are shown on the tile and in the viewer,
// and `el` (elemental only) picks the element variant to show. Draft copy —
// easy to rewrite. Thumbnails live at THUMB_BASE/<arch>.png.
export const THUMB_BASE = '/api/img/storage/v1/object/public/card-art/boss/thumbs';

export const BOSS_LIST = [
  { arch: 'behemoth', title: 'Lava Behemoth', blurb: 'A rock titan with molten veins and crystal growth.' },
  { arch: 'brute', title: 'Ogre Brute', blurb: 'A hulking bruiser that leads with its fists.' },
  { arch: 'golem', title: 'Iron Golem', blurb: 'An animated guardian of living metal.' },
  { arch: 'colossus', title: 'Moss Colossus', blurb: 'A mountain of stone bound by ancient moss.' },
  { arch: 'cyclops', title: 'One-Eyed Cyclops', blurb: 'A single burning eye above a boulder fist.' },
  { arch: 'chimera', title: 'Chimera', blurb: 'Lion, dragon, and ram fused into one beast.' },
  { arch: 'hydra', title: 'Marsh Hydra', blurb: 'Cut one head and two more rise.' },
  { arch: 'wyrm', title: 'Ash Wyrm', blurb: 'A coiling serpent wreathed in embers.' },
  { arch: 'fiend', title: 'Winged Fiend', blurb: 'A horned demon on membrane wings.' },
  { arch: 'lich', title: 'Frost Lich', blurb: 'A crowned sorcerer-king long past death.' },
  { arch: 'elemental', el: 'fire', title: 'Elemental', blurb: 'Raw element given shape and fury.' },
  { arch: 'gargoyle', title: 'Stone Gargoyle', blurb: 'A perched sentinel that wakes to hunt.' },
  { arch: 'kraken', title: 'Deep Kraken', blurb: 'Tentacled dread dragged up from the trench.' },
  { arch: 'treant', title: 'Elder Treant', blurb: 'An old-growth guardian with a short temper.' },
  { arch: 'wraith', title: 'Hollow Wraith', blurb: 'A shrouded specter that drains the warm.' },
  { arch: 'brood', title: 'Brood Mother', blurb: 'A many-legged horror that never comes alone.' },
  { arch: 'scorpion', title: 'Dune Scorpion', blurb: 'Armored pincers and a venom-tipped tail.' },
  { arch: 'ooze', title: 'Caustic Ooze', blurb: 'A gelatinous mass that eats through anything.' },
  { arch: 'fortress', title: 'Walking Fortress', blurb: 'A siege-engine of spikes and plate.' },
  { arch: 'eye', title: 'The Watcher', blurb: 'A floating eye ringed with lesser stares.' },
];

// The seed string that renders a given entry's canonical model.
export function seedForBoss(b) {
  return b.arch === 'elemental' && b.el ? `arch:elemental:${b.el} ${b.title}` : `arch:${b.arch} ${b.title}`;
}
export function thumbFor(b) { return `${THUMB_BASE}/${b.arch}${b.arch === 'elemental' && b.el ? '_' + b.el : ''}.png`; }
