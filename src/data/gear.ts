export type Slot = 'rod' | 'reel' | 'line' | 'lure' | 'charm';
export type ItemRarity = 'normal' | 'magic' | 'rare' | 'legendary';
export type StatKey =
  | 'power'
  | 'crit'
  | 'lineStrength'
  | 'luck'
  | 'biteSpeed'
  | 'hookWindow'
  | 'rareFish'
  | 'xpBonus'
  | 'coinBonus';

export const SLOTS: Slot[] = ['rod', 'reel', 'line', 'lure', 'charm'];

export const SLOT_LABEL: Record<Slot, string> = {
  rod: 'ロッド',
  reel: 'リール',
  line: 'ライン',
  lure: 'ルアー',
  charm: 'お守り',
};

export const STAT_INFO: Record<StatKey, { label: string; unit: string; desc: string }> = {
  power: { label: 'パワー', unit: '', desc: '巻き取り1ヒットのダメージが上がる' },
  crit: { label: '会心率', unit: '%', desc: '会心ヒット（ダメージ2倍）が出やすい' },
  lineStrength: { label: 'ライン強度', unit: '', desc: 'テンションが上がりにくい' },
  luck: { label: '幸運', unit: '%', desc: 'ドロップ装備のレア度が上がる' },
  biteSpeed: { label: 'アタリ速度', unit: '%', desc: '魚が早く食いつく' },
  hookWindow: { label: 'アワセ猶予', unit: '%', desc: 'HIT!の受付時間が長い' },
  rareFish: { label: 'レア魚率', unit: '%', desc: 'レアな魚がかかりやすい' },
  xpBonus: { label: '経験値', unit: '%', desc: '獲得経験値アップ' },
  coinBonus: { label: 'コイン', unit: '%', desc: '獲得コインアップ' },
};

export const BASE_STATS: Record<StatKey, number> = {
  power: 10,
  crit: 5,
  lineStrength: 10,
  luck: 0,
  biteSpeed: 0,
  hookWindow: 0,
  rareFish: 0,
  xpBonus: 0,
  coinBonus: 0,
};

export interface GearBase {
  id: string;
  slot: Slot;
  name: string;
  /** このアイテムレベル以上でドロップ */
  minIlvl: number;
  implicit: { stat: StatKey; base: number; perIlvl: number };
}

export const GEAR_BASES: GearBase[] = [
  { id: 'rod_bamboo', slot: 'rod', name: '竹竿', minIlvl: 1, implicit: { stat: 'power', base: 3, perIlvl: 0.6 } },
  { id: 'rod_glass', slot: 'rod', name: 'グラスロッド', minIlvl: 8, implicit: { stat: 'power', base: 6, perIlvl: 0.8 } },
  { id: 'rod_carbon', slot: 'rod', name: 'カーボンロッド', minIlvl: 18, implicit: { stat: 'power', base: 10, perIlvl: 1.0 } },
  { id: 'reel_spin', slot: 'reel', name: 'スピニングリール', minIlvl: 1, implicit: { stat: 'power', base: 2, perIlvl: 0.4 } },
  { id: 'reel_bait', slot: 'reel', name: 'ベイトリール', minIlvl: 12, implicit: { stat: 'lineStrength', base: 5, perIlvl: 0.6 } },
  { id: 'line_nylon', slot: 'line', name: 'ナイロンライン', minIlvl: 1, implicit: { stat: 'lineStrength', base: 3, perIlvl: 0.6 } },
  { id: 'line_pe', slot: 'line', name: 'PEライン', minIlvl: 10, implicit: { stat: 'lineStrength', base: 7, perIlvl: 0.9 } },
  { id: 'lure_worm', slot: 'lure', name: 'ワーム', minIlvl: 1, implicit: { stat: 'biteSpeed', base: 5, perIlvl: 0.4 } },
  { id: 'lure_minnow', slot: 'lure', name: 'ミノー', minIlvl: 6, implicit: { stat: 'hookWindow', base: 8, perIlvl: 0.5 } },
  { id: 'lure_spoon', slot: 'lure', name: 'スプーン', minIlvl: 14, implicit: { stat: 'rareFish', base: 4, perIlvl: 0.3 } },
  { id: 'charm_shell', slot: 'charm', name: '貝殻のお守り', minIlvl: 1, implicit: { stat: 'luck', base: 5, perIlvl: 0.5 } },
  { id: 'charm_scale', slot: 'charm', name: '竜鱗のお守り', minIlvl: 16, implicit: { stat: 'rareFish', base: 5, perIlvl: 0.4 } },
];

export interface AffixDef {
  id: string;
  stat: StatKey;
  /** 接頭辞 or 接尾辞（名前生成用） */
  kind: 'prefix' | 'suffix';
  names: string[]; // tier 1..n の名前
  /** tier 1 の値域。tierごとに増加 */
  min: number;
  max: number;
  perTier: number;
  slots?: Slot[];
}

export const AFFIXES: AffixDef[] = [
  { id: 'pow', stat: 'power', kind: 'prefix', names: ['力強い', '剛力の', '豪腕の', '怪力の', '巨神の'], min: 2, max: 4, perTier: 3 },
  { id: 'crit', stat: 'crit', kind: 'prefix', names: ['鋭い', '会心の', '必殺の', '一撃の', '神撃の'], min: 2, max: 4, perTier: 2 },
  { id: 'str', stat: 'lineStrength', kind: 'prefix', names: ['丈夫な', '頑強な', '鋼の', '金剛の', '不壊の'], min: 2, max: 4, perTier: 3 },
  { id: 'bite', stat: 'biteSpeed', kind: 'prefix', names: ['誘う', '魅惑の', '妖艶な', '魔性の', '天女の'], min: 3, max: 6, perTier: 3, slots: ['lure', 'line', 'charm', 'rod'] },
  { id: 'hook', stat: 'hookWindow', kind: 'prefix', names: ['機敏な', '俊敏な', '疾風の', '迅雷の', '神速の'], min: 5, max: 10, perTier: 5 },
  { id: 'luck', stat: 'luck', kind: 'suffix', names: ['の幸運', 'の福運', 'の財宝', 'の黄金郷', 'の竜宮'], min: 4, max: 8, perTier: 5 },
  { id: 'rare', stat: 'rareFish', kind: 'suffix', names: ['の目利き', 'の慧眼', 'の千里眼', 'の天眼', 'の神眼'], min: 3, max: 6, perTier: 3 },
  { id: 'xp', stat: 'xpBonus', kind: 'suffix', names: ['の修行', 'の鍛錬', 'の熟練', 'の達人', 'の釣聖'], min: 4, max: 8, perTier: 4 },
  { id: 'coin', stat: 'coinBonus', kind: 'suffix', names: ['の小銭', 'の銀貨', 'の金貨', 'の宝船', 'の大判'], min: 5, max: 10, perTier: 5 },
];

export const ITEM_RARITY_INFO: Record<ItemRarity, { label: string; color: string; affixes: [number, number] }> = {
  normal: { label: 'ノーマル', color: '#e0e0e0', affixes: [0, 0] },
  magic: { label: 'マジック', color: '#64b5f6', affixes: [1, 2] },
  rare: { label: 'レア', color: '#ffee58', affixes: [3, 4] },
  legendary: { label: 'レジェンダリー', color: '#ff9800', affixes: [4, 5] },
};

export const LEGENDARY_NAMES: Record<Slot, string[]> = {
  rod: ['海神の三叉竿', '竜殺しの一本竿', '月読の釣竿'],
  reel: ['渦潮を呑むリール', '時を巻くリール'],
  line: ['蜘蛛女の糸', '天の羽衣ライン'],
  lure: ['人魚の涙', '雷光ミノー'],
  charm: ['乙姫の玉手箱', '恵比寿の鯛守り'],
};

export interface ItemAffix {
  id: string;
  stat: StatKey;
  value: number;
  tier: number;
}

export interface Item {
  uid: string;
  baseId: string;
  slot: Slot;
  name: string;
  rarity: ItemRarity;
  ilvl: number;
  implicit: { stat: StatKey; value: number };
  affixes: ItemAffix[];
}
