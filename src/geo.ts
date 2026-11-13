import { hash32, Rng } from './rng';
import type { Biome } from './data/fish';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Spot extends LatLng {
  id: string;
  biome: Biome;
  level: number;
  name: string;
}

/** 釣りができる距離(m)。GPS誤差を考慮して広め */
export const FISHING_RANGE_M = 60;

/** スポット生成グリッドの1セル（約170m四方） */
const CELL_LAT = 0.0015;
const CELL_LNG = 0.0019;
/** 世界共通のシード。変えると全スポットが入れ替わる */
const WORLD_SEED = 20261113;

const BIOMES: Biome[] = ['river', 'lake', 'pond', 'sea'];
const SPOT_NAMES: Record<Biome, string[]> = {
  river: ['せせらぎ', '早瀬', '淵', '渓流', '堰'],
  lake: ['湖畔', '入り江', '浮島', 'ワンド'],
  pond: ['ため池', '古池', '蓮池', '溜まり'],
  sea: ['堤防', '磯', '波止場', '岩礁', 'テトラ帯'],
};

export function distanceM(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** 基準点からの東西(x)・南北(y)メートル */
export function toLocalM(origin: LatLng, p: LatLng): { x: number; y: number } {
  const x = ((p.lng - origin.lng) * Math.PI) / 180 * 6371000 * Math.cos((origin.lat * Math.PI) / 180);
  const y = ((p.lat - origin.lat) * Math.PI) / 180 * 6371000;
  return { x, y };
}

export function offsetM(p: LatLng, dx: number, dy: number): LatLng {
  return {
    lat: p.lat + (dy / 6371000) * (180 / Math.PI),
    lng: p.lng + (dx / (6371000 * Math.cos((p.lat * Math.PI) / 180))) * (180 / Math.PI),
  };
}

/** 1セル分のスポットを決定的に生成（同じ場所なら誰が見ても同じスポット） */
function spotsInCell(cx: number, cy: number): Spot[] {
  const rng = new Rng(hash32(WORLD_SEED, cx, cy));
  // 近くのセルで似たバイオームになるよう、粗いグリッドで地域性を出す
  const region = new Rng(hash32(WORLD_SEED, Math.floor(cx / 6), Math.floor(cy / 6), 7));
  const regionBiome = region.pick(BIOMES);
  const count = rng.weighted([0, 1, 2], (n) => [0.35, 0.45, 0.2][n]);
  const spots: Spot[] = [];
  for (let i = 0; i < count; i++) {
    const biome = rng.chance(0.65) ? regionBiome : rng.pick(BIOMES);
    const lat = (cy + rng.range(0.1, 0.9)) * CELL_LAT;
    const lng = (cx + rng.range(0.1, 0.9)) * CELL_LNG;
    const level = 1 + Math.floor(Math.pow(rng.next(), 2) * 30);
    spots.push({
      id: `${cx}_${cy}_${i}`,
      lat,
      lng,
      biome,
      level,
      name: rng.pick(SPOT_NAMES[biome]),
    });
  }
  return spots;
}

export function spotsAround(p: LatLng, radiusCells = 3): Spot[] {
  const cx = Math.floor(p.lng / CELL_LNG);
  const cy = Math.floor(p.lat / CELL_LAT);
  const out: Spot[] = [];
  for (let dy = -radiusCells; dy <= radiusCells; dy++) {
    for (let dx = -radiusCells; dx <= radiusCells; dx++) {
      out.push(...spotsInCell(cx + dx, cy + dy));
    }
  }
  return out;
}

export type GeoStatus = 'waiting' | 'gps' | 'sim' | 'denied';

export interface GeoUpdate {
  pos: LatLng;
  accuracy: number;
  status: GeoStatus;
}

/** GPS監視。使えない場合や ?sim のときはシミュレーション移動にフォールバック */
export class GeoTracker {
  status: GeoStatus = 'waiting';
  pos: LatLng | null = null;
  accuracy = 0;
  private watchId: number | null = null;
  private listeners: ((u: GeoUpdate) => void)[] = [];

  onUpdate(fn: (u: GeoUpdate) => void) {
    this.listeners.push(fn);
  }

  private emit() {
    if (!this.pos) return;
    for (const l of this.listeners) l({ pos: this.pos, accuracy: this.accuracy, status: this.status });
  }

  start(forceSim: boolean) {
    if (forceSim || !('geolocation' in navigator)) {
      this.startSim();
      return;
    }
    this.watchId = navigator.geolocation.watchPosition(
      (p) => {
        this.status = 'gps';
        this.pos = { lat: p.coords.latitude, lng: p.coords.longitude };
        this.accuracy = p.coords.accuracy;
        this.emit();
      },
      (err) => {
        console.warn('GPS error', err);
        if (this.status !== 'gps') {
          this.status = err.code === err.PERMISSION_DENIED ? 'denied' : 'waiting';
          this.startSim();
        }
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
  }

  startSim(at: LatLng = { lat: 35.6812, lng: 139.7671 }) {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    this.status = 'sim';
    this.pos = this.pos ?? at;
    this.accuracy = 5;
    this.emit();
  }

  /** シミュレーション時の移動（メートル） */
  move(dx: number, dy: number) {
    if (this.status !== 'sim' || !this.pos) return;
    this.pos = offsetM(this.pos, dx, dy);
    this.emit();
  }

  /** シミュレーション時にスポットへワープ（デバッグ用） */
  teleport(p: LatLng) {
    if (this.status !== 'sim') return;
    this.pos = { ...p };
    this.emit();
  }
}
