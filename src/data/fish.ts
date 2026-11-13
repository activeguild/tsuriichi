export type Biome = 'river' | 'lake' | 'pond' | 'sea';
export type FishRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export type TimeBand = 'any' | 'day' | 'night';

export interface FishSpecies {
  id: string;
  name: string;
  biomes: Biome[];
  time: TimeBand;
  rarity: FishRarity;
  /** 体長(cm) */
  minSize: number;
  maxSize: number;
  /** 引きの強さ 1〜10 */
  strength: number;
  /** 手続き生成モデル用の見た目 */
  look: { body: number; belly: number; fin: number; length: number; height: number; width: number };
  desc: string;
}

export const BIOME_LABEL: Record<Biome, string> = {
  river: '川',
  lake: '湖',
  pond: '池',
  sea: '海',
};

export const BIOME_ICON: Record<Biome, string> = {
  river: '〰️',
  lake: '💧',
  pond: '🪷',
  sea: '🌊',
};

export const FISH_RARITY_INFO: Record<FishRarity, { label: string; stars: number; weight: number; color: string }> = {
  common: { label: 'コモン', stars: 1, weight: 100, color: '#cfd8dc' },
  uncommon: { label: 'アンコモン', stars: 2, weight: 40, color: '#81c784' },
  rare: { label: 'レア', stars: 3, weight: 12, color: '#4fc3f7' },
  epic: { label: 'エピック', stars: 4, weight: 3, color: '#ba68c8' },
  legendary: { label: 'レジェンド', stars: 5, weight: 0.6, color: '#ffb300' },
};

const L = (body: number, belly: number, fin: number, length = 1, height = 0.36, width = 0.2) => ({
  body, belly, fin, length, height, width,
});

export const FISH: FishSpecies[] = [
  // 池・湖
  { id: 'funa', name: 'フナ', biomes: ['pond', 'lake'], time: 'any', rarity: 'common', minSize: 10, maxSize: 30, strength: 2,
    look: L(0x8d8a5a, 0xd8d2a0, 0x6d6a40, 1, 0.45, 0.2), desc: 'どこにでもいる釣りの基本。' },
  { id: 'bluegill', name: 'ブルーギル', biomes: ['pond', 'lake'], time: 'day', rarity: 'common', minSize: 8, maxSize: 22, strength: 2,
    look: L(0x4e6e5d, 0xe0a050, 0x2f4a3c, 0.8, 0.55, 0.16), desc: 'エサ取り名人。' },
  { id: 'koi', name: 'コイ', biomes: ['pond', 'lake', 'river'], time: 'any', rarity: 'uncommon', minSize: 30, maxSize: 90, strength: 5,
    look: L(0x6b5b3a, 0xc9b27a, 0x55452a, 1.2, 0.38, 0.22), desc: '粘り強い引きの大物。' },
  { id: 'bass', name: 'ブラックバス', biomes: ['lake', 'pond'], time: 'day', rarity: 'uncommon', minSize: 20, maxSize: 60, strength: 5,
    look: L(0x3f5a2a, 0xdfe6c8, 0x2a3c1c, 1.1, 0.34, 0.2), desc: 'ルアーに激しく食らいつく。' },
  { id: 'namazu', name: 'ナマズ', biomes: ['lake', 'pond', 'river'], time: 'night', rarity: 'rare', minSize: 30, maxSize: 80, strength: 6,
    look: L(0x3b3530, 0x9e968a, 0x2b2622, 1.3, 0.24, 0.26), desc: '夜になると動き出す。' },
  { id: 'nushi', name: '湖のヌシ', biomes: ['lake'], time: 'any', rarity: 'legendary', minSize: 120, maxSize: 220, strength: 10,
    look: L(0x1f3b3a, 0x7fa79a, 0x10302c, 1.6, 0.36, 0.3), desc: '誰も釣り上げたことがないと噂される。' },
  { id: 'goldkoi', name: '黄金ゴイ', biomes: ['pond'], time: 'any', rarity: 'legendary', minSize: 60, maxSize: 110, strength: 8,
    look: L(0xffc107, 0xfff3c4, 0xffa000, 1.2, 0.38, 0.22), desc: '見た者に幸運をもたらす。' },
  // 川
  { id: 'ayu', name: 'アユ', biomes: ['river'], time: 'day', rarity: 'common', minSize: 12, maxSize: 28, strength: 3,
    look: L(0x7a8f7a, 0xe8ead8, 0xc8b040, 1, 0.26, 0.14), desc: '清流の女王。' },
  { id: 'yamame', name: 'ヤマメ', biomes: ['river'], time: 'any', rarity: 'uncommon', minSize: 15, maxSize: 35, strength: 4,
    look: L(0x6f7f6a, 0xf0e8e0, 0x5a6a50, 1, 0.28, 0.15), desc: '渓流に棲む美しいパーマーク。' },
  { id: 'iwana', name: 'イワナ', biomes: ['river'], time: 'any', rarity: 'rare', minSize: 20, maxSize: 50, strength: 5,
    look: L(0x5a5040, 0xe8b070, 0x4a4030, 1.1, 0.27, 0.16), desc: '源流の幻。' },
  { id: 'nijimasu', name: 'ニジマス', biomes: ['river', 'lake'], time: 'day', rarity: 'uncommon', minSize: 20, maxSize: 60, strength: 5,
    look: L(0x6a8a8a, 0xf0b0c0, 0x507070, 1.1, 0.3, 0.16), desc: '虹色の帯が輝く。' },
  { id: 'unagi', name: 'ウナギ', biomes: ['river'], time: 'night', rarity: 'epic', minSize: 40, maxSize: 100, strength: 7,
    look: L(0x2e3a2a, 0xb8b890, 0x2e3a2a, 1.8, 0.12, 0.12), desc: '夜の川をうねる高級魚。' },
  // 海
  { id: 'aji', name: 'アジ', biomes: ['sea'], time: 'any', rarity: 'common', minSize: 10, maxSize: 35, strength: 3,
    look: L(0x6f8ea0, 0xe8eef0, 0xb0b860, 1, 0.3, 0.14), desc: '堤防釣りの定番。' },
  { id: 'saba', name: 'サバ', biomes: ['sea'], time: 'day', rarity: 'common', minSize: 20, maxSize: 45, strength: 4,
    look: L(0x2e6a7a, 0xe8eef0, 0x2a4a5a, 1.1, 0.26, 0.16), desc: '群れで回遊する。' },
  { id: 'mebaru', name: 'メバル', biomes: ['sea'], time: 'night', rarity: 'uncommon', minSize: 12, maxSize: 30, strength: 4,
    look: L(0x6a5040, 0xc8a080, 0x50382a, 0.9, 0.38, 0.18), desc: '夜の港で目を光らせる。' },
  { id: 'suzuki', name: 'スズキ', biomes: ['sea', 'river'], time: 'night', rarity: 'rare', minSize: 40, maxSize: 100, strength: 7,
    look: L(0x707c84, 0xeef0f2, 0x50585e, 1.3, 0.28, 0.18), desc: '出世魚。エラ洗いに注意。' },
  { id: 'madai', name: 'マダイ', biomes: ['sea'], time: 'day', rarity: 'rare', minSize: 25, maxSize: 90, strength: 6,
    look: L(0xe0607a, 0xffd0d8, 0xc04060, 1, 0.48, 0.18), desc: 'めでたい魚の王様。' },
  { id: 'buri', name: 'ブリ', biomes: ['sea'], time: 'any', rarity: 'epic', minSize: 60, maxSize: 110, strength: 8,
    look: L(0x3a6a8a, 0xf0f2f4, 0xd0c040, 1.3, 0.3, 0.2), desc: '青物の大将。' },
  { id: 'kajiki', name: 'カジキ', biomes: ['sea'], time: 'day', rarity: 'legendary', minSize: 150, maxSize: 400, strength: 10,
    look: L(0x1a3a6a, 0xd8e0f0, 0x10284a, 1.8, 0.26, 0.18), desc: '海の剣士。' },
  { id: 'ryugu', name: 'リュウグウノツカイ', biomes: ['sea'], time: 'night', rarity: 'legendary', minSize: 200, maxSize: 500, strength: 9,
    look: L(0xd8dce8, 0xffffff, 0xe03040, 2.4, 0.16, 0.08), desc: '深海からの使者。' },
];

export const FISH_BY_ID: Record<string, FishSpecies> = Object.fromEntries(FISH.map((f) => [f.id, f]));
