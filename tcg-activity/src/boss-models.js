// The rigged model bosses: the file, the weekly-boss name pattern and the credit. No
// three.js here, so the start-up bundle can ask "is this a model boss?" without loading
// the 3D engine (boss-lazy.js loads it when a boss is shown).
export const MODEL_BASE = '/api/img/storage/v1/object/public/card-art/boss/models';

// key -> the model file, the name pattern of the weekly boss, and the credit.
export const MODEL_BOSSES = {
  warrok: { file: 'warrok-z2.glb', names: /rage-?quit warlord|warrok/i, credit: 'Model: Warrok W Kurniawan — Mixamo (Adobe)' },
  mutant: { file: 'mutant-z2.glb', names: /netcode mutant|\bmutant\b/i, credit: 'Model: Mutant — Mixamo (Adobe)' },
  maw:    { file: 'maw-z2.glb',    names: /maw of the meta|\bmaw\b/i, credit: 'Model: Maw J Laygo — Mixamo (Adobe)' },
  parasite:       { file: 'parasite-z2.glb',       names: /lagspike parasite|\bparasite\b/i, credit: 'Model: Parasite L Starkie — Mixamo (Adobe)' },
  pumpkinhulk:    { file: 'pumpkinhulk-z2.glb',    names: /patch-?day pumpkin|pumpkinhulk/i, credit: 'Model: Pumpkinhulk L Shaw — Mixamo (Adobe)' },
  nightshade:     { file: 'nightshade-z2.glb',     names: /ranked nightshade|\bnightshade\b/i, credit: 'Model: Nightshade J Friedrich — Mixamo (Adobe)' },
  vampire:        { file: 'vampire-z2.glb',        names: /grind vampire|\bvampire\b/i, credit: 'Model: Vampire A Lusth — Mixamo (Adobe)' },
  demon:          { file: 'demon-z2.glb',          names: /ban-?wave demon/i, credit: 'Model: Demon T Wiezzorek — Mixamo (Adobe)' },
  // Not "brute": that key is the procedural Ogre Brute in boss.js.
  smurf:          { file: 'smurf-z2.glb',          names: /smurf brute/i, credit: 'Model: Brute — Mixamo (Adobe)' },
  warzombie:      { file: 'warzombie-z2.glb',      names: /afk warzombie|warzombie/i, credit: 'Model: Warzombie F Pedroso — Mixamo (Adobe)' },
  skeletonzombie: { file: 'skeletonzombie-z2.glb', names: /hardstuck skeleton|skeletonzombie/i, credit: 'Model: Skeletonzombie T Avelange — Mixamo (Adobe)' },
  // Her own game rig + the Mixamo clips retargeted (card-studio/blender/retarget_kerrigan.py).
  kerrigan:       { file: 'kerrigan-z2.glb',       names: /zerg-?rush queen|kerrigan/i, credit: 'Model: Sarah Kerrigan Infested — Vasian-Digital3D (CC-BY 4.0); animations: Mixamo (Adobe)' },
};

/** The model key for a boss name (or an `arch:<key>` seed), or null. */
export function modelFor(seedStr) {
  const s = seedStr || '';
  const mo = s.match(/^arch:(\w+)/);
  if (mo) return MODEL_BOSSES[mo[1]] ? mo[1] : null;
  for (const [key, m] of Object.entries(MODEL_BOSSES)) if (m.names.test(s)) return key;
  return null;
}
