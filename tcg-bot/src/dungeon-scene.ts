import type { SupabaseClient } from '@supabase/supabase-js';
import { type DungeonMode, type DungeonScene, weekLabel } from './dungeon-card.js';

// What the Dungeon / Gauntlet picture shows, read from the same tables the game writes
// (dungeon_runs, dungeon_days, gauntlet_weeks; service role). Nothing is calculated here: the run
// row holds the floor and the room, the day or week row holds the name, the rule and the rooms.
// A member with no ACTIVE run today gets null (the post falls back to the normal picture).

type RunRow = { id: number; day: string; floor: number; room: number; squad: number[] };
type Rooms = unknown[][];

/** The Sunday that starts the week of a game day (SQL gauntlet_week: day minus day-of-week). */
export function gauntletWeekStart(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

export type DungeonSceneData = { scene: DungeonScene; squadIds: number[]; runId: number };

export async function loadDungeonScene(sb: SupabaseClient, playerId: string, mode: DungeonMode, today: string,
  cardNames: (ids: number[]) => Promise<{ id: number; name: string; rarity: string }[]>): Promise<DungeonSceneData | null> {
  const { data: run } = await sb.from('dungeon_runs').select('id, day, floor, room, squad')
    .eq('player_id', playerId).eq('mode', mode).eq('status', 'active').eq('day', today)
    .order('started_at', { ascending: false }).limit(1).maybeSingle();
  if (!run) return null;
  const r = run as RunRow;
  let title: string, sub: string, floors: Rooms;
  if (mode === 'gauntlet') {
    const week = gauntletWeekStart(r.day);
    const { data } = await sb.from('gauntlet_weeks').select('name, theme, floors').eq('week', week).maybeSingle();
    if (!data) return null;
    title = String(data.name);
    sub = data.theme ? `${weekLabel(week)} - ${String(data.theme)}` : weekLabel(week);
    floors = data.floors as Rooms;
  } else {
    const { data } = await sb.from('dungeon_days').select('name, rule, floors').eq('day', r.day).maybeSingle();
    if (!data) return null;
    title = String(data.name);
    sub = String((data.rule as { name?: string } | null)?.name ?? '');
    floors = data.floors as Rooms;
  }
  if (!Array.isArray(floors) || !floors.length) return null;
  const floor = Math.max(1, Math.min(r.floor, floors.length));
  const rooms = Array.isArray(floors[floor - 1]) ? floors[floor - 1]!.length : 5;
  const ids = (r.squad ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 5);
  const cards = await cardNames(ids);
  const byId = new Map(cards.map((c) => [Number(c.id), c]));
  const squad = ids.map((id) => byId.get(id)).filter((c): c is { id: number; name: string; rarity: string } => !!c).map((c) => ({ name: c.name, rarity: c.rarity }));
  return {
    runId: r.id, squadIds: ids,
    scene: { mode, title, sub, floor, floors: floors.length, room: Math.max(1, Math.min(r.room, rooms)), rooms, squad },
  };
}
