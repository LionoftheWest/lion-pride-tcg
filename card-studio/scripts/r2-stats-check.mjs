// R2-MOVE G5: 24 h with no fallback, before S6 (spec 6.2 G5). Input: the Activity container log of each serving host,
// taken with timestamps: `sudo docker logs --timestamps tcg-activity --since <S5 time> > <host>.log`.
//   node card-studio/scripts/r2-stats-check.mjs --since <S5 iso> --log <host>=<file> [--log <host>=<file> ...] [--hours 24]
// FAIL on:
//   - ANY `img-fallback <key> <status|error> mode=<m>` line after --since (one line per event, printed at once: a restart
//     cannot lose it, N4). The line names the key, so the Stager can name the missed writer.
//   - ANY `img-cache ...` stats line after --since with fallback > 0 or r2err > 0, or without the fallback fields (an old
//     build). The log is split at each process start (`TCG Activity -> `, server.js): the counters restart at 0 there.
//   - a host whose lines after --since cover less than --hours (default 24).
// Stop line: STATS PASS hosts=<k> hours=<h> (h = the shortest cover), else STATS FAIL <n> + one BAD line each. Exit 1.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const TS = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z)\s(.*)$/;
const START = /TCG Activity -> /;
const FALLBACK = /\bimg-fallback (\S+) (\S+) mode=(\S+)/;
const STATS = /\bimg-cache hits=\d+/;
const field = (line, name) => { const m = line.match(new RegExp(`\\b${name}=(\\d+)`)); return m ? Number(m[1]) : null; };

/** logs: [{ host, text }], since: Date|iso. Returns { ok, bad: [line], hours, hosts }. */
export function checkStats({ logs, since, minHours = 24 }) {
  const t0 = new Date(since).getTime();
  if (!Number.isFinite(t0)) throw new Error('refused: --since is not a time');
  if (!logs.length) throw new Error('refused: no --log');
  const bad = [];
  let shortest = Infinity;
  for (const { host, text } of logs) {
    let first = null, last = null, segment = 0;
    for (const raw of String(text).split(/\r?\n/)) {
      const m = TS.exec(raw);
      if (!m) continue;
      const t = Date.parse(m[1]);
      if (!(t >= t0)) continue;
      const line = m[2];
      if (first === null) first = t;
      last = t;
      if (START.test(line)) { segment += 1; continue; }
      const f = FALLBACK.exec(line);
      if (f) { bad.push(`BAD ${host} ${m[1]} img-fallback ${f[1]} ${f[2]} mode=${f[3]}`); continue; }
      if (STATS.test(line)) {
        const fb = field(line, 'fallback'), er = field(line, 'r2err');
        if (fb === null || er === null) bad.push(`BAD ${host} ${m[1]} img-cache line without fallback/r2err (an old build) segment=${segment}`);
        else if (fb > 0 || er > 0) bad.push(`BAD ${host} ${m[1]} img-cache fallback=${fb} r2err=${er} segment=${segment}`);
      }
    }
    const hours = first === null ? 0 : (last - first) / 3600e3;
    if (hours < minHours) bad.push(`BAD ${host} the lines cover ${hours.toFixed(1)} h (need ${minHours} h)`);
    shortest = Math.min(shortest, hours);
  }
  return { ok: bad.length === 0, bad, hours: shortest, hosts: logs.length };
}

export function report(r) {
  if (r.ok) return `STATS PASS hosts=${r.hosts} hours=${r.hours.toFixed(1)}`;
  return [...r.bad, `STATS FAIL ${r.bad.length}`].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = process.argv.slice(2);
  const val = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  const logs = [];
  a.forEach((x, i) => { if (x === '--log') { const [host, ...f] = a[i + 1].split('='); logs.push({ host, text: readFileSync(f.join('='), 'utf8') }); } });
  try {
    const r = checkStats({ logs, since: val('--since'), minHours: Number(val('--hours') || 24) });
    console.log(report(r));
    process.exit(r.ok ? 0 : 1);
  } catch (e) { console.log(e.message); process.exit(1); }
}
