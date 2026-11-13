import { Rng } from './rng';
import { FISH, FISH_RARITY_INFO, FishRarity, FishSpecies } from './data/fish';
import {
  AFFIXES, GEAR_BASES, ITEM_RARITY_INFO, Item, ItemAffix, ItemRarity, LEGENDARY_NAMES, StatKey,
} from './data/gear';
import type { Spot } from './geo';

export type Stats = Record<StatKey, number>;

export interface CaughtFish {
  speciesId: string;
  size: number; // cm
  /** 0..1 サイズの大きさ（最大サイズに対する割合） */
  sizeRatio: number;
}

export function isNight(date = new Date()): boolean {
  const h = date.getHours();
  return h < 5 || h >= 18;
}

/** そのスポットで今釣れる魚の候補 */
export function fishPool(spot: Spot, date = new Date()): FishSpecies[] {
  const night = isNight(date);
  return FISH.filter(
    (f) => f.biomes.includes(spot.biome) && (f.time === 'any' || (f.time === 'night') === night),
  );
}

const RARITY_ORDER: FishRarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

export function rollFish(spot: Spot, stats: Stats, rng: Rng): CaughtFish {
  const pool = fishPool(spot);
  // レア魚率とスポットレベルで高レア魚の重みを上げる
  const boost = 1 + stats.rareFish / 100 + spot.level * 0.02;
  const species = rng.weighted(pool, (f) => {
    const idx = RARITY_ORDER.indexOf(f.rarity);
    return FISH_RARITY_INFO[f.rarity].weight * Math.pow(boost, idx);
  });
  // サイズ: 小さめに偏り、まれに特大
  const t = Math.pow(rng.next(), 1.8);
  const size = Math.round((species.minSize + (species.maxSize - species.minSize) * t) * 10) / 10;
  return { speciesId: species.id, size, sizeRatio: t };
}

let uidCounter = 0;
function newUid(): string {
  uidCounter++;
  return `${Date.now().toString(36)}${uidCounter.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function rollItemRarity(rng: Rng, fishRarity: FishRarity, luck: number): ItemRarity {
  const fr = RARITY_ORDER.indexOf(fishRarity);
  const m = 1 + luck / 100;
  const w: Record<ItemRarity, number> = {
    normal: 60,
    magic: 30 * m * (1 + fr * 0.3),
    rare: 8 * m * (1 + fr * 0.6),
    legendary: 0.6 * m * (1 + fr * 1.2),
  };
  const keys = Object.keys(w) as ItemRarity[];
  return rng.weighted(keys, (k) => w[k]);
}

export function generateItem(rng: Rng, ilvl: number, rarity: ItemRarity): Item {
  const bases = GEAR_BASES.filter((b) => b.minIlvl <= ilvl);
  const base = rng.pick(bases);
  const implicitValue = Math.round(base.implicit.base + base.implicit.perIlvl * ilvl);
  const maxTier = Math.min(5, 1 + Math.floor(ilvl / 8));
  const [minA, maxA] = ITEM_RARITY_INFO[rarity].affixes;
  const count = rng.int(minA, maxA);
  const candidates = AFFIXES.filter((a) => !a.slots || a.slots.includes(base.slot));
  const affixes: ItemAffix[] = [];
  const used = new Set<string>();
  for (let i = 0; i < count && used.size < candidates.length; i++) {
    const def = rng.pick(candidates.filter((c) => !used.has(c.id)));
    used.add(def.id);
    let tier = rng.int(1, maxTier);
    if (rarity === 'legendary') tier = Math.min(5, tier + 1);
    const value = Math.round(rng.range(def.min, def.max) + def.perTier * (tier - 1));
    affixes.push({ id: def.id, stat: def.stat, value, tier });
  }

  let name = base.name;
  if (rarity === 'legendary') {
    name = rng.pick(LEGENDARY_NAMES[base.slot]);
  } else if (affixes.length > 0) {
    const prefix = affixes.find((a) => AFFIXES.find((d) => d.id === a.id)!.kind === 'prefix');
    const suffix = affixes.find((a) => AFFIXES.find((d) => d.id === a.id)!.kind === 'suffix');
    const pName = prefix ? AFFIXES.find((d) => d.id === prefix.id)!.names[prefix.tier - 1] : '';
    const sName = suffix ? AFFIXES.find((d) => d.id === suffix.id)!.names[suffix.tier - 1] : '';
    name = `${pName}${base.name}${sName}`;
  }

  return {
    uid: newUid(),
    baseId: base.id,
    slot: base.slot,
    name,
    rarity,
    ilvl,
    implicit: { stat: base.implicit.stat, value: implicitValue },
    affixes,
  };
}

export interface CatchReward {
  xp: number;
  coins: number;
  items: Item[];
}

export function rollRewards(rng: Rng, fish: CaughtFish, spot: Spot, stats: Stats, playerLevel: number): CatchReward {
  const sp = FISH.find((f) => f.id === fish.speciesId)!;
  const ri = RARITY_ORDER.indexOf(sp.rarity);
  // 高レベルのスポットほど報酬が増える（強くなって挑む価値を出す）
  const lvK = 1 + spot.level * 0.1;
  const baseXp = 10 * (1 + ri * 1.5) * (1 + fish.sizeRatio) * lvK;
  const baseCoins = 5 * (1 + ri * 2) * (1 + fish.sizeRatio * 2) * lvK;
  const ilvl = Math.max(1, Math.round((playerLevel + spot.level) / 2 + ri * 2 + rng.int(-1, 2)));

  // ドロップ個数: 高レア魚ほど多い
  const dropChance = 0.55 + ri * 0.15;
  const items: Item[] = [];
  let n = 0;
  while (n < 1 + ri && rng.chance(n === 0 ? dropChance : 0.35)) {
    items.push(generateItem(rng, ilvl, rollItemRarity(rng, sp.rarity, stats.luck)));
    n++;
  }
  return {
    xp: Math.round(baseXp * (1 + stats.xpBonus / 100)),
    coins: Math.round(baseCoins * (1 + stats.coinBonus / 100)),
    items,
  };
}

export function salvageValue(item: Item): number {
  const m = { normal: 1, magic: 3, rare: 8, legendary: 30 }[item.rarity];
  return Math.round(m * (2 + item.ilvl));
}
