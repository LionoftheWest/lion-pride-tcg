// R2-MOVE: the bot's card-art store mode (the same rule as tcg-activity/img-route.js parseImgMode).
// IMG_UPSTREAM is REQUIRED: supabase | r2-first | r2. Unset or unknown = the bot does not start (index.ts), so a host with
// no value cannot post broken images after the Supabase delete (spec H4). With a mode other than supabase, the fallback of
// art() (playing-posts.ts) after the Activity proxy is the R2 public domain, never the Supabase host (G3b).
export const IMG_MODES = ['supabase', 'r2-first', 'r2'] as const;
export type ImgMode = (typeof IMG_MODES)[number];
export const DEFAULT_R2_PUBLIC_BASE = 'https://img.lionpridetcg.com';

export function parseImgMode(env: NodeJS.ProcessEnv = process.env): { mode: ImgMode; r2Base: string } {
  const mode = env.IMG_UPSTREAM;
  if (!mode) throw new Error('refused: IMG_UPSTREAM unset (supabase | r2-first | r2)');
  if (!(IMG_MODES as readonly string[]).includes(mode)) throw new Error(`refused: IMG_UPSTREAM=${mode} unknown`);
  const r2Base = (env.R2_PUBLIC_BASE || '').replace(/\/+$/, '');
  if (mode !== 'supabase' && !/^https?:\/\/[^/]+$/.test(r2Base)) throw new Error(`refused: IMG_UPSTREAM=${mode} needs R2_PUBLIC_BASE`);
  return { mode: mode as ImgMode, r2Base };
}

/** The R2 public base at call time (after the env loads). */
export const r2PublicBase = (): string => (process.env.R2_PUBLIC_BASE || DEFAULT_R2_PUBLIC_BASE).replace(/\/+$/, '');
