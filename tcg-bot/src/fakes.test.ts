// (No tests here: the other test files import it. Its own check is in discord-effects-outside.test.ts.)
// An in-memory Supabase for the bot tests: no live project. It runs the PostgREST filters the bot
// uses (eq, neq, in, lt/lte/gt/gte, is, order, limit, maybeSingle, update, upsert, select after
// update) on plain arrays, so a test sees the real effect of each query on the rows.
type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;

export interface FakeStore {
  tables: Record<string, Row[]>;
  log: string[];
  from(table: string): unknown;
  rpc(name: string): Promise<{ data: unknown; error: null }>;
}

const cmp = (a: unknown, b: unknown): number => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);

export function fakeStore(tables: Record<string, Row[]> = {}): FakeStore {
  const log: string[] = [];
  const store: FakeStore = {
    tables,
    log,
    rpc: async (name: string) => { log.push(`rpc:${name}`); return { data: null, error: null }; },
    from(table: string) {
      const rows = (tables[table] ??= []);
      let op: 'select' | 'update' | 'upsert' = 'select';
      let patch: Row = {};
      let single = false;
      let returning = false;
      let lim = Infinity;
      let ord: { k: string; asc: boolean } | null = null;
      const f: Filter[] = [];
      const run = (): { data: unknown; error: null } => {
        log.push(`${table}:${op}`);
        if (op === 'upsert') { rows.push({ ...patch }); return { data: null, error: null }; }
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
        eq(k: string, v: unknown) { f.push((r) => r[k] === v); return q; },
        neq(k: string, v: unknown) { f.push((r) => r[k] !== v); return q; },
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
        then<T>(res: (v: { data: unknown; error: null }) => T, rej?: (e: unknown) => T) {
          try { return Promise.resolve(res(run())); } catch (e) { return rej ? Promise.resolve(rej(e)) : Promise.reject(e); }
        },
      };
      return q;
    },
  };
  return store;
}

