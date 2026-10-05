// (No tests here: the other test files import it. Its own check is in discord-effects-outside.test.ts.)
// An in-memory Supabase for the bot tests: no live project. It runs the PostgREST filters the bot
// uses (eq, neq incl. a ->> JSON path, in, lt/lte/gt/gte, is, order, limit, maybeSingle, update, upsert, insert, select after
// update) on plain arrays, so a test sees the real effect of each query on the rows.
type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;

export interface FakeStore {
  tables: Record<string, Row[]>;
  log: string[];
  from(table: string): unknown;
  rpc(name: string, args?: unknown): Promise<{ data: unknown; error: null }>;
  calls: { name: string; args: unknown }[];
}

// A PostgREST JSON path ('options->>pair_id') reads the key as text.
const val = (r: Row, k: string): unknown => { const [c, j] = k.split('->>'); if (j === undefined) return r[k]; const o = r[c!] as Row | null | undefined; return o?.[j] == null ? null : String(o[j]); };
const cmp = (a: unknown, b: unknown): number => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);

export function fakeStore(tables: Record<string, Row[]> = {}): FakeStore {
  const log: string[] = [];
  const store: FakeStore = {
    tables,
    log,
    calls: [],
    rpc: async (name: string, args?: unknown) => { log.push(`rpc:${name}`); store.calls.push({ name, args }); return { data: null, error: null }; },
    from(table: string) {
      const rows = (tables[table] ??= []);
      let op: 'select' | 'update' | 'upsert' | 'insert' = 'select';
      let patch: Row = {};
      let single = false;
      let returning = false;
      let lim = Infinity;
      let ord: { k: string; asc: boolean } | null = null;
      const f: Filter[] = [];
      const run = (): { data: unknown; error: null } => {
        log.push(`${table}:${op}`);
        if (op === 'upsert') { rows.push({ ...patch }); return { data: null, error: null }; }
        if (op === 'insert') { const r = { id: rows.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1, created_at: new Date().toISOString(), ...structuredClone(patch) }; rows.push(r); return { data: returning ? [structuredClone(r)] : null, error: null }; }
        let hit = rows.filter((r) => f.every((fn) => fn(r)));
        if (op === 'update') {
          for (const r of hit) Object.assign(r, structuredClone(patch));
          return { data: returning ? structuredClone(hit) : null, error: null };
        }
        if (ord) { const o = ord; hit = [...hit].sort((a, b) => (o.asc ? 1 : -1) * cmp(a[o.k], b[o.k])); }
        hit = hit.slice(0, lim);
        return { data: single ? (hit[0] ? structuredClone(hit[0]) : null) : structuredClone(hit), error: null };
      };
      const q = {
        select() { if (op !== 'select') returning = true; return q; },
        eq(k: string, v: unknown) { f.push((r) => val(r, k) === v); return q; },
        neq(k: string, v: unknown) { f.push((r) => val(r, k) !== v); return q; },
        in(k: string, vs: unknown[]) { f.push((r) => vs.includes(r[k])); return q; },
        lt(k: string, v: unknown) { f.push((r) => r[k] != null && cmp(r[k], v) < 0); return q; },
        lte(k: string, v: unknown) { f.push((r) => r[k] != null && cmp(r[k], v) <= 0); return q; },
        gt(k: string, v: unknown) { f.push((r) => r[k] != null && cmp(r[k], v) > 0); return q; },
        gte(k: string, v: unknown) { f.push((r) => r[k] != null && cmp(r[k], v) >= 0); return q; },
        is(k: string, v: unknown) { f.push((r) => (r[k] ?? null) === v); return q; },
        order(k: string, o?: { ascending?: boolean }) { ord = { k, asc: o?.ascending !== false }; return q; },
        limit(n: number) { lim = n; return q; },
        maybeSingle() { single = true; return q; },
        update(fields: Row) { op = 'update'; patch = fields; return q; },
        upsert(v: Row) { op = 'upsert'; patch = v; return q; },
        insert(v: Row) { op = 'insert'; patch = v; return q; },
        then<T>(res: (v: { data: unknown; error: null }) => T, rej?: (e: unknown) => T) {
          try { return Promise.resolve(res(run())); } catch (e) { return rej ? Promise.resolve(rej(e)) : Promise.reject(e); }
        },
      };
      return q;
    },
  };
  return store;
}

