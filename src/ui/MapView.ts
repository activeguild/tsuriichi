import { BIOME_ICON, BIOME_LABEL, FISH_RARITY_INFO } from '../data/fish';
import { distanceM, FISHING_RANGE_M, GeoTracker, LatLng, Spot, spotsAround, toLocalM } from '../geo';
import { fishPool, isNight } from '../loot';
import { computeStats, GameState, SPOT_MAX_STOCK, spotStock } from '../state';
import { combatPower, recommendedPower } from '../balance';
import { esc } from './common';

const BIOME_COLOR: Record<string, string> = {
  river: '#4fd1c5',
  lake: '#4f9dff',
  pond: '#8bd450',
  sea: '#2f6dff',
};

export class MapView {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private info: HTMLElement;
  private statusEl: HTMLElement;
  private spots: Spot[] = [];
  private spotsCenter: LatLng | null = null;
  private selected: Spot | null = null;
  private raf = 0;
  private visible = true;
  /** 1px あたりのメートル */
  private mpp = 1;

  constructor(
    private geo: GeoTracker,
    private getState: () => GameState,
    private onFish: (spot: Spot) => void,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'map-view';
    this.el.innerHTML = `
      <canvas class="map-canvas"></canvas>
      <div class="map-status"></div>
      <div class="sim-pad hidden">
        <button data-d="0,1">▲</button>
        <button data-d="-1,0">◀</button>
        <button data-d="1,0">▶</button>
        <button data-d="0,-1">▼</button>
      </div>
      <div class="spot-info hidden"></div>`;
    this.canvas = this.el.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.info = this.el.querySelector('.spot-info')!;
    this.statusEl = this.el.querySelector('.map-status')!;

    this.canvas.addEventListener('click', (e) => this.onTap(e));
    this.el.querySelectorAll<HTMLButtonElement>('.sim-pad button').forEach((b) => {
      let timer = 0;
      const [dx, dy] = b.dataset.d!.split(',').map(Number);
      const step = () => this.geo.move(dx * 15, dy * 15);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        step();
        timer = window.setInterval(step, 120);
      });
      const stop = () => clearInterval(timer);
      b.addEventListener('pointerup', stop);
      b.addEventListener('pointerleave', stop);
      b.addEventListener('pointercancel', stop);
    });
    window.addEventListener('keydown', (e) => {
      if (!this.visible) return;
      const d: Record<string, [number, number]> = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
      const v = d[e.key];
      if (v) {
        e.preventDefault();
        this.geo.move(v[0] * 15, v[1] * 15);
      }
    });

    this.geo.onUpdate(() => this.refreshSpots());
    this.loop();
  }

  setVisible(v: boolean) {
    this.visible = v;
    this.el.classList.toggle('hidden', !v);
    if (v) {
      this.loop();
      this.renderInfo();
    } else cancelAnimationFrame(this.raf);
  }

  private refreshSpots() {
    const pos = this.geo.pos;
    if (!pos) return;
    if (!this.spotsCenter || distanceM(this.spotsCenter, pos) > 120) {
      this.spots = spotsAround(pos, 3);
      this.spotsCenter = pos;
    }
    this.renderInfo();
  }

  private loop = () => {
    cancelAnimationFrame(this.raf);
    if (!this.visible) return;
    this.draw();
    this.raf = requestAnimationFrame(this.loop);
  };

  private toScreen(p: LatLng, w: number, h: number) {
    const o = this.geo.pos!;
    const m = toLocalM(o, p);
    return { x: w / 2 + m.x / this.mpp, y: h / 2 - m.y / this.mpp };
  }

  private draw() {
    const c = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const night = isNight();
    ctx.fillStyle = night ? '#0a1424' : '#14324a';
    ctx.fillRect(0, 0, w, h);

    const status = this.geo.status;
    const label = { waiting: '📡 GPS取得中…', gps: `📍 GPS ±${Math.round(this.geo.accuracy)}m`, sim: '🕹️ シミュレーション移動', denied: '🚫 位置情報オフ（シミュレーション）' }[status];
    this.statusEl.textContent = label;
    this.el.querySelector('.sim-pad')!.classList.toggle('hidden', status !== 'sim' && status !== 'denied');

    const pos = this.geo.pos;
    if (!pos) {
      ctx.fillStyle = '#fff';
      ctx.font = '16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('現在地を取得しています…', w / 2, h / 2);
      return;
    }
    // 表示範囲: 半径 ~230m
    this.mpp = 460 / Math.min(w, h);

    // グリッド（50m）
    ctx.strokeStyle = night ? 'rgba(120,160,255,0.07)' : 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    const gridPx = 50 / this.mpp;
    const origin = toLocalM({ lat: 0, lng: 0 }, pos);
    const offX = ((-origin.x / this.mpp) % gridPx + gridPx) % gridPx;
    const offY = ((origin.y / this.mpp) % gridPx + gridPx) % gridPx;
    ctx.beginPath();
    for (let x = offX; x < w; x += gridPx) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = offY; y < h; y += gridPx) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();

    // 釣り可能範囲
    ctx.fillStyle = 'rgba(255,214,10,0.08)';
    ctx.strokeStyle = 'rgba(255,214,10,0.5)';
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, FISHING_RANGE_M / this.mpp, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);

    // スポット
    const state = this.getState();
    const myCp = combatPower(computeStats(state));
    const t = performance.now() / 1000;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const s of this.spots) {
      const p = this.toScreen(s, w, h);
      if (p.x < -40 || p.y < -40 || p.x > w + 40 || p.y > h + 40) continue;
      const stock = spotStock(state, s.id);
      const inRange = distanceM(pos, s) <= FISHING_RANGE_M;
      const r = 18;
      if (stock > 0) {
        // 波紋アニメ
        const k = (t * 0.6 + (s.lat * 1e5) % 1) % 1;
        ctx.strokeStyle = BIOME_COLOR[s.biome];
        ctx.globalAlpha = 1 - k;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + k * 18, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = stock > 0 ? BIOME_COLOR[s.biome] : '#556';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      if (inRange || this.selected?.id === s.id) {
        ctx.strokeStyle = this.selected?.id === s.id ? '#fff' : '#ffd60a';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      ctx.font = '18px sans-serif';
      ctx.fillText(BIOME_ICON[s.biome], p.x, p.y + 1);
      // 推奨戦闘力に対して自分が足りているかで色分け（白=余裕 / 黄=ちょうど / 赤=格上）
      const rec = recommendedPower(s.level);
      ctx.font = 'bold 11px sans-serif';
      ctx.fillStyle = myCp >= rec ? '#fff' : myCp >= rec * 0.6 ? '#ffd60a' : '#ff6b6b';
      ctx.fillText(`Lv${s.level}`, p.x, p.y + r + 10);
    }

    // プレイヤー
    const acc = this.geo.accuracy / this.mpp;
    if (status === 'gps' && acc > 8) {
      ctx.fillStyle = 'rgba(80,160,255,0.15)';
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, acc, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2f80ff';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 7, 0, Math.PI * 2);
    ctx.fill();

    // 方位
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('N ↑', w - 24, 18);
  }

  private onTap(e: MouseEvent) {
    if (!this.geo.pos) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let best: Spot | null = null;
    let bestD = 34;
    for (const s of this.spots) {
      const p = this.toScreen(s, rect.width, rect.height);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    this.selected = best;
    this.renderInfo();
  }

  private recLine(level: number): string {
    const rec = recommendedPower(level);
    const my = combatPower(computeStats(this.getState()));
    const cls = my >= rec ? 'ok' : my >= rec * 0.6 ? 'close' : 'hard';
    const note = { ok: '余裕', close: '手ごわい', hard: '格上（装備を強化しよう）' }[cls];
    return `<div class="spot-rec ${cls}">⚔ 推奨戦闘力 ${rec.toLocaleString()}（あなた ${my.toLocaleString()}・${note}）</div>`;
  }

  renderInfo() {
    const s = this.selected;
    const pos = this.geo.pos;
    if (!s || !pos) {
      this.info.classList.add('hidden');
      return;
    }
    const state = this.getState();
    const dist = distanceM(pos, s);
    const inRange = dist <= FISHING_RANGE_M;
    const stock = spotStock(state, s.id);
    const pool = fishPool(s);
    const sim = this.geo.status === 'sim' || this.geo.status === 'denied';
    const fishList = pool
      .map((f) => {
        const known = !!state.zukan[f.id];
        return `<span class="pool-fish" style="color:${FISH_RARITY_INFO[f.rarity].color}">${known ? esc(f.name) : '？？？'}</span>`;
      })
      .join('');
    let action = '';
    if (stock <= 0) action = `<button class="btn" disabled>魚がいない（回復待ち）</button>`;
    else if (inRange) action = `<button class="btn btn-primary act-fish">🎣 釣る</button>`;
    else if (sim) action = `<button class="btn act-warp">ワープ（テスト用）</button>`;
    else action = `<button class="btn" disabled>あと ${Math.round(dist - FISHING_RANGE_M)}m 近づこう</button>`;

    this.info.classList.remove('hidden');
    this.info.innerHTML = `
      <button class="close">×</button>
      <div class="spot-title">${BIOME_ICON[s.biome]} ${BIOME_LABEL[s.biome]}・${esc(s.name)} <span class="lv">Lv${s.level}</span></div>
      <div class="spot-meta">距離 ${Math.round(dist)}m ・ 魚 ${stock}/${SPOT_MAX_STOCK} ・ ${isNight() ? '🌙 夜' : '☀️ 昼'}</div>
      ${this.recLine(s.level)}
      <div class="spot-pool">${fishList}</div>
      ${action}`;
    this.info.querySelector('.close')!.addEventListener('click', () => {
      this.selected = null;
      this.renderInfo();
    });
    this.info.querySelector('.act-fish')?.addEventListener('click', () => this.onFish(s));
    this.info.querySelector('.act-warp')?.addEventListener('click', () => this.geo.teleport({ lat: s.lat - 0.0002, lng: s.lng }));
  }
}
