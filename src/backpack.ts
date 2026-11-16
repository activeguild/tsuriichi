/**
 * バックパック（マス目に形のあるアイテムを詰める）。
 * バックパックに入っているアイテムだけが効果を持ち、決まった種類のアイテムと辺で接すると「隣接ボーナス」で強くなる。
 */
import type { Item, Slot } from './data/gear';

export type Cell = [number, number];

export interface Placement {
  uid: string;
  x: number;
  y: number;
  /** 回転（0〜3、90度ずつ） */
  rot: number;
}

export interface Backpack {
  w: number;
  h: number;
  placed: Placement[];
}

export const BACKPACK_START = { w: 5, h: 4 };
export const BACKPACK_MAX = { w: 7, h: 6 };
/** 拡張の値段（n回目の拡張） */
const EXPAND_COST = [300, 800, 2000, 5000];

export function expandCost(bp: Backpack): number | null {
  const n = bp.w - BACKPACK_START.w + (bp.h - BACKPACK_START.h);
  return n < EXPAND_COST.length ? EXPAND_COST[n] : null;
}

/** 装備ベースごとの形（回転前） */
const SHAPES: Record<string, Cell[]> = {
  rod_bamboo: [[0, 0], [0, 1], [0, 2], [0, 3]],
  rod_glass: [[0, 0], [0, 1], [0, 2], [0, 3]],
  rod_carbon: [[0, 0], [0, 1], [0, 2], [0, 3], [1, 3]],
  reel_spin: [[0, 0], [1, 0], [0, 1], [1, 1]],
  reel_bait: [[0, 0], [1, 0], [0, 1]],
  reel_multi: [[0, 0], [1, 0], [2, 0], [1, 1]],
  line_nylon: [[0, 0], [1, 0]],
  line_pe: [[0, 0], [1, 0], [2, 0]],
  lure_worm: [[0, 0]],
  lure_minnow: [[0, 0], [1, 0]],
  lure_spoon: [[0, 0]],
  charm_shell: [[0, 0]],
  charm_scale: [[0, 0], [0, 1]],
};

export const SLOT_ICON: Record<Slot, string> = {
  rod: '🎣',
  reel: '⚙️',
  line: '🧵',
  lure: '🪝',
  charm: '🧿',
};

export interface Synergy {
  /** ボーナスを与える相手の種類（'any' はすべて） */
  targets: (Slot | 'any')[];
  /** 相手の能力に足す割合（0.2 = +20%） */
  pct: number;
  text: string;
}

/** ベースごとの隣接ボーナス（辺で接した相手を強くする） */
const SYNERGY: Record<string, Synergy> = {
  rod_bamboo: { targets: ['reel'], pct: 0.2, text: '隣のリール +20%' },
  rod_glass: { targets: ['reel', 'line'], pct: 0.2, text: '隣のリール・ライン +20%' },
  rod_carbon: { targets: ['reel'], pct: 0.35, text: '隣のリール +35%' },
  reel_spin: { targets: ['line'], pct: 0.25, text: '隣のライン +25%' },
  reel_bait: { targets: ['line', 'rod'], pct: 0.2, text: '隣のライン・竿 +20%' },
  reel_multi: { targets: ['lure', 'line'], pct: 0.25, text: '隣のルアー・ライン +25%' },
  line_nylon: { targets: ['lure'], pct: 0.3, text: '隣のルアー +30%' },
  line_pe: { targets: ['lure'], pct: 0.4, text: '隣のルアー +40%' },
  lure_worm: { targets: ['charm'], pct: 0.2, text: '隣のお守り +20%' },
  lure_minnow: { targets: ['charm', 'line'], pct: 0.15, text: '隣のお守り・ライン +15%' },
  lure_spoon: { targets: ['charm'], pct: 0.3, text: '隣のお守り +30%' },
  charm_shell: { targets: ['any'], pct: 0.1, text: '隣のすべて +10%' },
  charm_scale: { targets: ['any'], pct: 0.15, text: '隣のすべて +15%' },
};

export function baseShape(item: Item): Cell[] {
  return SHAPES[item.baseId] ?? [[0, 0]];
}

/** アイテムの隣接ボーナス（レジェンダリーは2倍） */
export function synergyOf(item: Item): Synergy | null {
  const s = SYNERGY[item.baseId];
  if (!s) return null;
  if (item.rarity !== 'legendary') return s;
  return { ...s, pct: s.pct * 2, text: s.text.replace(/\+(\d+)%/, (_m, n) => `+${Number(n) * 2}%`) + '（レジェンダリーで2倍）' };
}

/** 回転した形（左上が0,0になるようそろえる） */
export function shapeCells(item: Item, rot: number): Cell[] {
  let cells = baseShape(item);
  for (let r = 0; r < ((rot % 4) + 4) % 4; r++) cells = cells.map(([x, y]) => [-y, x] as Cell);
  const minX = Math.min(...cells.map((c) => c[0]));
  const minY = Math.min(...cells.map((c) => c[1]));
  return cells.map(([x, y]) => [x - minX, y - minY] as Cell);
}

export function shapeSize(cells: Cell[]): { w: number; h: number } {
  return { w: Math.max(...cells.map((c) => c[0])) + 1, h: Math.max(...cells.map((c) => c[1])) + 1 };
}

/** マスごとにどのアイテムがあるか */
export function occupancy(bp: Backpack, items: Map<string, Item>, ignoreUid?: string): (string | null)[][] {
  const grid: (string | null)[][] = Array.from({ length: bp.h }, () => Array(bp.w).fill(null));
  for (const p of bp.placed) {
    if (p.uid === ignoreUid) continue;
    const it = items.get(p.uid);
    if (!it) continue;
    for (const [cx, cy] of shapeCells(it, p.rot)) {
      const gx = p.x + cx;
      const gy = p.y + cy;
      if (gy >= 0 && gy < bp.h && gx >= 0 && gx < bp.w) grid[gy][gx] = p.uid;
    }
  }
  return grid;
}

export function canPlace(bp: Backpack, items: Map<string, Item>, item: Item, x: number, y: number, rot: number): boolean {
  const grid = occupancy(bp, items, item.uid);
  return shapeCells(item, rot).every(([cx, cy]) => {
    const gx = x + cx;
    const gy = y + cy;
    return gx >= 0 && gy >= 0 && gx < bp.w && gy < bp.h && grid[gy][gx] === null;
  });
}

/** 空いている場所を探す（回転も試す）。見つからなければ null */
export function findSpot(bp: Backpack, items: Map<string, Item>, item: Item, preferRot = 0): Placement | null {
  for (let i = 0; i < 4; i++) {
    const rot = (preferRot + i) % 4;
    for (let y = 0; y < bp.h; y++) {
      for (let x = 0; x < bp.w; x++) {
        if (canPlace(bp, items, item, x, y, rot)) return { uid: item.uid, x, y, rot };
      }
    }
  }
  return null;
}

export interface BonusInfo {
  /** 能力に掛かる上乗せ（0.3 = +30%） */
  pct: number;
  /** ボーナスをくれているアイテムの uid */
  from: string[];
}

/** 配置から隣接ボーナスを計算する（同じ相手からは1回だけ） */
export function computeBonuses(bp: Backpack, items: Map<string, Item>): Map<string, BonusInfo> {
  const grid = occupancy(bp, items);
  const out = new Map<string, BonusInfo>();
  for (const p of bp.placed) out.set(p.uid, { pct: 0, from: [] });
  for (const p of bp.placed) {
    const src = items.get(p.uid);
    if (!src) continue;
    const syn = synergyOf(src);
    if (!syn) continue;
    // 辺で接しているアイテムを集める
    const neighbors = new Set<string>();
    for (const [cx, cy] of shapeCells(src, p.rot)) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const gx = p.x + cx + dx;
        const gy = p.y + cy + dy;
        const u = grid[gy]?.[gx];
        if (u && u !== p.uid) neighbors.add(u);
      }
    }
    for (const u of neighbors) {
      const target = items.get(u);
      if (!target) continue;
      if (!syn.targets.includes('any') && !syn.targets.includes(target.slot)) continue;
      const b = out.get(u)!;
      b.pct += syn.pct;
      b.from.push(p.uid);
    }
  }
  return out;
}
