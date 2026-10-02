// Card art for Discord embeds through the VM's public image cache (the Activity /app/api/img route),
// not straight from Supabase: Discord's link robot fetched the full card images from Supabase
// (~60 MB of cached egress a day, 2026-10-02; the Free plan has 5 GB a month). The route serves
// the same file from the VM disk cache.
const base = (): string => (process.env.PUBLIC_IMG_BASE || 'https://lionpridetcg.duckdns.org/app/api/img').replace(/\/+$/, '');

/** A Supabase storage URL -> the same file through the VM cache. Any other URL is unchanged. */
export function publicImg(url: string | null | undefined): string | null {
  if (!url) return null;
  const supa = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  return supa && url.startsWith(`${supa}/`) ? `${base()}/${url.slice(supa.length + 1)}` : url;
}
