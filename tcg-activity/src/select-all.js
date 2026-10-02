// Every row of a Supabase query. PostgREST returns at most max-rows (1,000 on this project) per call,
// whatever .limit() asks for: a whole-table read silently lost rows (2026-10-02: the leaderboard
// read 1,000 of 3,681 card rows and 1,000 of 1,766 pack opens, so cards, achievements and ranks
// were wrong). Reads page after page in a fixed order until a page is empty, so it does not
// depend on the cap value.
// build: () => a fresh query (select + filters, no range). order: unique column(s) for stable pages.
export async function selectAll(build, order, { page = 1000, max = 1000000 } = {}) {
  const out = [];
  for (let from = 0; from < max;) {
    let q = build();
    for (const c of order) q = q.order(c, { ascending: true });
    const { data, error } = await q.range(from, from + page - 1);
    if (error) return { data: null, error };
    if (!data || !data.length) break;
    out.push(...data);
    from += data.length;
  }
  return { data: out, error: null };
}
