import { BASE_STATS, Item, Slot, StatKey } from './data/gear';
import type { Stats } from './loot';

export interface ZukanEntry {
  count: number;
  maxSize: number;
  firstAt: number;
}

export interface SpotState {
  stock: number;
  updatedAt: number;
}

export interface GameState {
  version: 1;
  level: number;
  xp: number;
  coins: number;
  inventory: Item[];
  equipped: Partial<Record<Slot, Item>>;
  zukan: Record<string, ZukanEntry>;
  spots: Record<string, SpotState>;
}

const KEY = 'tsuriichi.save.v1';
export const INVENTORY_MAX = 60;
export const SPOT_MAX_STOCK = 5;
/** スポットの魚が1匹回復するまでの時間 */
export const SPOT_REGEN_MS = 3 * 60 * 1000;

export function newState(): GameState {
  return { version: 1, level: 1, xp: 0, coins: 0, inventory: [], equipped: {}, zukan: {}, spots: {} };
}

export function loadState(): GameState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as GameState;
      if (s.version === 1) return { ...newState(), ...s };
    }
  } catch (e) {
    console.warn('load failed', e);
  }
  return newState();
}

export function saveState(s: GameState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch (e) {
    console.warn('save failed', e);
  }
}

export function xpToNext(level: number): number {
  return Math.round(100 * Math.pow(level, 1.5));
}

/** 経験値加算。上がったレベル数を返す */
export function addXp(s: GameState, xp: number): number {
  s.xp += xp;
  let ups = 0;
  while (s.xp >= xpToNext(s.level)) {
    s.xp -= xpToNext(s.level);
    s.level++;
    ups++;
  }
  return ups;
}

export function itemStats(item: Item): Partial<Record<StatKey, number>> {
  const out: Partial<Record<StatKey, number>> = {};
  out[item.implicit.stat] = (out[item.implicit.stat] ?? 0) + item.implicit.value;
  for (const a of item.affixes) out[a.stat] = (out[a.stat] ?? 0) + a.value;
  return out;
}

export function computeStats(s: GameState): Stats {
  const st: Stats = { ...BASE_STATS };
  st.power += (s.level - 1) * 1;
  st.lineStrength += (s.level - 1) * 1;
  for (const it of Object.values(s.equipped)) {
    if (!it) continue;
    const is = itemStats(it);
    for (const k of Object.keys(is) as StatKey[]) st[k] += is[k]!;
  }
  return st;
}

export function spotStock(s: GameState, spotId: string, now = Date.now()): number {
  const st = s.spots[spotId];
  if (!st) return SPOT_MAX_STOCK;
  const regen = Math.floor((now - st.updatedAt) / SPOT_REGEN_MS);
  return Math.min(SPOT_MAX_STOCK, st.stock + regen);
}

export function consumeSpot(s: GameState, spotId: string, now = Date.now()) {
  const cur = spotStock(s, spotId, now);
  s.spots[spotId] = { stock: Math.max(0, cur - 1), updatedAt: now };
}
