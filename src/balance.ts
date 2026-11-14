/**
 * 戦闘バランスの式をまとめたもの。
 * 「装備・レベルで強くなる」→「高レベルのスポットに挑める」の流れを数字で作る。
 */
import type { Stats } from './loot';

/** 1秒あたりの巻き取りヒット数 */
export const HITS_PER_SEC = 4;
/** パワー1あたりの1ヒットのダメージ */
export const DMG_PER_POWER = 25;
/** スポットLvが1上がるごとの魚の強さの倍率 */
const LEVEL_GROWTH = 1.12;
/** 推奨戦闘力の目安にする「巻いている時間」(秒) */
const TARGET_REEL_SEC = 8;

export function spotScale(spotLevel: number): number {
  return Math.pow(LEVEL_GROWTH, spotLevel - 1);
}

/** 1ヒットの基本ダメージ（ばらつき・会心の前） */
export function baseHitDamage(stats: Stats): number {
  return stats.power * DMG_PER_POWER;
}

/** 戦闘力 = 巻き続けたときの1秒あたりの期待ダメージ */
export function combatPower(stats: Stats): number {
  return Math.round(
    HITS_PER_SEC * baseHitDamage(stats) * (1 + Math.min(100, stats.crit) / 100) * (1 + stats.multiHit / 100),
  );
}

/** 魚の引き（テンションの上がりやすさ）。スポットLvで強くなる */
export function pullStrength(speciesStrength: number, sizeRatio: number, spotLevel: number): number {
  return speciesStrength * (0.7 + 0.6 * sizeRatio) * (1 + spotLevel * 0.03);
}

/** ファイトの制限時間（秒）。引きの強い魚ほど少し長い */
export function fightTimeLimit(pull: number): number {
  return Math.min(55, 35 + pull * 1.5);
}

/** 魚のHP。スポットLvで指数的に増える */
export function fishMaxHp(speciesStrength: number, sizeRatio: number, spotLevel: number): number {
  const s = speciesStrength * (0.7 + 0.6 * sizeRatio) * (1 + spotLevel * 0.03);
  const sizeK = 0.7 + sizeRatio * 0.6;
  return Math.round((1500 + s * 750) * sizeK * spotScale(spotLevel));
}

/** スポットの推奨戦闘力（ふつうの強さの魚を約8秒巻いて釣れる目安） */
export function recommendedPower(spotLevel: number): number {
  return Math.round(fishMaxHp(5, 0.5, spotLevel) / TARGET_REEL_SEC / 10) * 10;
}
