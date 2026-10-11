import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { renderDungeonCard, dungeonLine, weekLabel, type DungeonScene } from './dungeon-card.js';
import { loadDungeonScene, gauntletWeekStart } from './dungeon-scene.js';
import { W, H } from './playing-card.js';
import { cleanActivity } from './playing-posts.js';

const size = (png: Buffer): [number, number] => [png.readUInt32BE(16), png.readUInt32BE(20)];
const isPng = (png: Buffer): boolean => png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const art = (c1: string, c2: string): Buffer => {
  const cv = createCanvas(200, 280); const x = cv.getContext('2d');
  const g = x.createLinearGradient(0, 0, 200, 280); g.addColorStop(0, c1); g.addColorStop(1, c2);
  x.fillStyle = g; x.fillRect(0, 0, 200, 280); return cv.toBuffer('image/png');
};
const scene = (over: Partial<DungeonScene> = {}): DungeonScene => ({
  mode: 'daily', title: 'The Sunken Vault', sub: 'Fire cards deal +25%', floor: 7, floors: 25, room: 3, rooms: 5,
  squad: [{ name: 'A', rarity: 'gold' }, { name: 'B', rarity: 'normal' }, { name: 'C', rarity: 'full_art' }, { name: 'D', rarity: 'secret_rare' }, { name: 'E', rarity: 'event' }], ...over,
});
const base = { name: 'Test Member', live: true, avatar: null as Buffer | null };

test('the dungeon picture is a 1200x630 PNG for both modes, with and without art', async () => {
  for (const mode of ['daily', 'gauntlet'] as const) {
    const s = scene({ mode });
    const a = await renderDungeonCard({ ...base, line: dungeonLine(mode, 7), scene: s, squadArt: [] });
    const b = await renderDungeonCard({ ...base, line: dungeonLine(mode, 7), scene: s, squadArt: [art('#c33', '#336'), art('#3c3', '#363'), null, art('#33c', '#633'), art('#cc3', '#363')] });
    for (const png of [a, b]) { assert.ok(isPng(png)); assert.deepEqual(size(png), [W, H]); }
    assert.notDeepEqual(a, b); // the squad art changes the picture
  }
});

test('the floor is drawn: floor 1 and floor 17 give different pictures; so does the room', async () => {
  const r = (over: Partial<DungeonScene>) => renderDungeonCard({ ...base, line: 'x', scene: scene(over), squadArt: [] });
  const [f1, f17, room4] = await Promise.all([r({ floor: 1, room: 1 }), r({ floor: 17, room: 1 }), r({ floor: 1, room: 4 })]);
  assert.notDeepEqual(f1, f17);
  assert.notDeepEqual(f1, room4);
});

test('a very long name, title, rule, broken art and an empty squad do not stop the render', async () => {
  const junk = Buffer.from('not an image');
  const png = await renderDungeonCard({ name: 'A very long member name that must shrink to fit the panel', live: false, avatar: junk,
    line: dungeonLine('gauntlet', 25), squadArt: [junk, junk],
    scene: scene({ mode: 'gauntlet', title: 'The Extremely Long Gauntlet Name Of The Week That Never Ends', sub: 'Week of Oct 4 - a very long theme name that goes on and on and on', floor: 25, squad: [] }) });
  assert.ok(isPng(png));
  assert.deepEqual(size(png), [W, H]);
});

test('the line and the week label', () => {
  assert.equal(dungeonLine('daily', 7), 'is on floor 7 of the Dungeon');
  assert.equal(dungeonLine('gauntlet', 25), 'is on floor 25 of the Gauntlet');
  assert.equal(weekLabel('2026-10-04'), 'Week of Oct 4');
  assert.equal(weekLabel('junk'), 'This week');
});

test('the Gauntlet week starts on the Sunday (the SQL gauntlet_week)', () => {
  assert.equal(gauntletWeekStart('2026-10-04'), '2026-10-04'); // a Sunday
  assert.equal(gauntletWeekStart('2026-10-11'), '2026-10-11');
  assert.equal(gauntletWeekStart('2026-10-10'), '2026-10-04'); // a Saturday
  assert.equal(gauntletWeekStart('2026-10-05'), '2026-10-04');
});

test('the activity from the Activity server allows dungeon and gauntlet', () => {
  assert.equal(cleanActivity({ kind: 'dungeon' })!.kind, 'dungeon');
  assert.equal(cleanActivity({ kind: 'gauntlet', extra: 1 })!.kind, 'gauntlet');
  assert.equal(cleanActivity({ kind: 'dungeons' }), null);
});

// A tiny fake of the query builder: it records the filters and answers by table.
function fakeSb(tables: Record<string, unknown>, log: string[] = []): never {
  return {
    from(t: string) {
      const q: Record<string, unknown> = {};
      const chain: unknown = new Proxy(q, { get: (_o, k: string) => {
        if (k === 'maybeSingle') return async () => ({ data: tables[t] ?? null });
        return (...args: unknown[]) => { log.push(`${t}.${k}(${args.join(',')})`); return chain; };
      } });
      return chain;
    },
  } as never;
}
const names = async (ids: number[]) => ids.map((id) => ({ id, name: `Card ${id}`, rarity: id % 2 ? 'gold' : 'normal' }));
const rooms5 = (n: number) => Array.from({ length: n }, () => Array.from({ length: 5 }, () => ({ type: 'fight' })));

test('the daily scene comes from the active run, the day name and the day rule', async () => {
  const log: string[] = [];
  const sb = fakeSb({ dungeon_runs: { id: 9, day: '2026-10-11', floor: 7, room: 3, squad: [1, 2, 3] },
    dungeon_days: { name: 'The Sunken Vault', rule: { name: 'No Gold today' }, floors: rooms5(25) } }, log);
  const d = (await loadDungeonScene(sb, '123', 'daily', '2026-10-11', names))!;
  assert.deepEqual([d.scene.mode, d.scene.title, d.scene.sub, d.scene.floor, d.scene.floors, d.scene.room, d.scene.rooms], ['daily', 'The Sunken Vault', 'No Gold today', 7, 25, 3, 5]);
  assert.deepEqual(d.squadIds, [1, 2, 3]);
  assert.equal(d.scene.squad.length, 3);
  assert.ok(log.includes('dungeon_runs.eq(status,active)'));
  assert.ok(log.includes('dungeon_runs.eq(mode,daily)'));
  assert.ok(log.includes('dungeon_runs.eq(day,2026-10-11)'));
});

test('the gauntlet scene reads the week row (Sunday start) with the week label and theme', async () => {
  const log: string[] = [];
  const sb = fakeSb({ dungeon_runs: { id: 4, day: '2026-10-10', floor: 3, room: 1, squad: [5] },
    gauntlet_weeks: { name: 'The Iron Trial', theme: 'Fire squad', floors: rooms5(25) } }, log);
  const d = (await loadDungeonScene(sb, '123', 'gauntlet', '2026-10-10', names))!;
  assert.equal(d.scene.title, 'The Iron Trial');
  assert.equal(d.scene.sub, 'Week of Oct 4 - Fire squad');
  assert.equal(d.scene.floor, 3);
  assert.ok(log.includes('gauntlet_weeks.eq(week,2026-10-04)'));
});

test('no active run, or no day row: null (the normal picture is used)', async () => {
  assert.equal(await loadDungeonScene(fakeSb({}), '123', 'daily', '2026-10-11', names), null);
  assert.equal(await loadDungeonScene(fakeSb({ dungeon_runs: { id: 1, day: '2026-10-11', floor: 1, room: 1, squad: [] } }), '123', 'daily', '2026-10-11', names), null);
});

test('a floor or room past the data is held inside it', async () => {
  const sb = fakeSb({ dungeon_runs: { id: 1, day: '2026-10-11', floor: 99, room: 9, squad: [] }, dungeon_days: { name: 'N', rule: null, floors: rooms5(25) } });
  const d = (await loadDungeonScene(sb, '1', 'daily', '2026-10-11', names))!;
  assert.deepEqual([d.scene.floor, d.scene.room, d.scene.sub], [25, 5, '']);
});
