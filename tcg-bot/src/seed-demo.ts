import 'dotenv/config';
import { getSupabase } from './supabase.js';
import type { Rarity } from './draw.js';

// Inserts a placeholder card set so the draw, the collection, and the hub views
// all work before real art exists. Safe to run more than once — it skips cards
// that already exist. Replace these with real cards later.
//   npm run seed:demo

const RARITY_HEX: Record<Rarity, string> = {
  normal: '9ca3af',
  illustrated_rare: '3b82f6',
  secret_rare: '8b5cf6',
  full_art: 'ec4899',
  gold: 'f59e0b',
};

const RARITY_LABEL: Record<Rarity, string> = {
  normal: 'Normal',
  illustrated_rare: 'Illustrated Rare',
  secret_rare: 'Secret Rare',
  full_art: 'Full Art',
  gold: 'Gold',
};

interface SubjectDef {
  key: string;
  name: string;
  description: string;
  lore: string;
  finishes: Rarity[];
}

const SUBJECTS: SubjectDef[] = [
  { key: 'ember-fox', name: 'Ember Fox', description: 'A fox of cinders.', lore: 'It naps in warm ash and wakes with a spark.', finishes: ['normal', 'illustrated_rare', 'gold'] },
  { key: 'tide-guardian', name: 'Tide Guardian', description: 'Keeper of the shallows.', lore: 'It walks the tideline and counts every shell.', finishes: ['normal', 'secret_rare'] },
  { key: 'stormcaller', name: 'Stormcaller', description: 'A herald of thunder.', lore: 'When it hums, the clouds gather to listen.', finishes: ['normal', 'full_art'] },
  { key: 'moss-golem', name: 'Moss Golem', description: 'Slow and patient stone.', lore: 'Older than the forest that grew upon it.', finishes: ['normal', 'illustrated_rare'] },
  { key: 'sun-hawk', name: 'Sun Hawk', description: 'It hunts at noon.', lore: 'Its shadow is a sundial for the plains.', finishes: ['normal', 'secret_rare'] },
  { key: 'frost-stag', name: 'Frost Stag', description: 'Antlers of clear ice.', lore: 'Winter follows wherever it steps.', finishes: ['normal', 'gold'] },
  { key: 'cinder-imp', name: 'Cinder Imp', description: 'A small trouble.', lore: 'It trades riddles for embers.', finishes: ['normal'] },
  { key: 'dune-serpent', name: 'Dune Serpent', description: 'It swims in sand.', lore: 'The desert whispers its coming.', finishes: ['normal', 'illustrated_rare'] },
  { key: 'gale-sprite', name: 'Gale Sprite', description: 'A gust with a grin.', lore: 'It steals hats and returns them upside down.', finishes: ['normal', 'full_art'] },
  { key: 'iron-boar', name: 'Iron Boar', description: 'Stubborn and heavy.', lore: 'It has never once turned around.', finishes: ['normal'] },
  { key: 'lumen-moth', name: 'Lumen Moth', description: 'Wings of soft light.', lore: 'It leads lost travelers to safe fires.', finishes: ['normal', 'illustrated_rare'] },
  { key: 'void-cat', name: 'Void Cat', description: 'Here, then not.', lore: 'It sleeps in the gaps between moments.', finishes: ['normal', 'secret_rare'] },
];

const supabase = getSupabase();
let created = 0;
let skipped = 0;

for (const subject of SUBJECTS) {
  const { data: subj, error: subjError } = await supabase
    .from('subjects')
    .upsert({ key: subject.key, name: subject.name, description: subject.description }, { onConflict: 'key' })
    .select('id')
    .single();
  if (subjError) throw new Error(`subject ${subject.key}: ${subjError.message}`);

  for (const rarity of subject.finishes) {
    const name = rarity === 'normal' ? subject.name : `${subject.name} (${RARITY_LABEL[rarity]})`;

    // NOTE the ".png" — without it placehold.co returns SVG, which Discord
    // embeds will not render.
    const image = `https://placehold.co/500x700/${RARITY_HEX[rarity]}/111827.png?text=${encodeURIComponent(name)}`;

    const { data: existing } = await supabase
      .from('cards')
      .select('id')
      .eq('name', name)
      .maybeSingle();
    if (existing) {
      // Refresh the image on an existing card so re-running fixes old URLs.
      await supabase.from('cards').update({ image_url: image }).eq('id', existing.id);
      skipped += 1;
      continue;
    }

    const { error: cardError } = await supabase.from('cards').insert({
      subject_id: subj.id,
      name,
      rarity,
      lore: subject.lore,
      image_url: image,
      artist_credit: 'Placeholder',
    });
    if (cardError) throw new Error(`card ${name}: ${cardError.message}`);
    created += 1;
  }
}

console.log(`Seed complete. Created ${created} card(s), skipped ${skipped} existing.`);
