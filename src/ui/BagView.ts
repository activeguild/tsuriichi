import { ITEM_RARITY_INFO, Item, ItemRarity, SLOT_LABEL, STAT_INFO, StatKey } from '../data/gear';
import { salvageValue } from '../loot';
import { combatPower } from '../balance';
import {
  BACKPACK_MAX, canPlace, computeBonuses, expandCost, findSpot, Placement, shapeCells, shapeSize, SLOT_ICON, synergyOf,
} from '../backpack';
import { computeStats, GameState, INVENTORY_MAX, isPlaced, itemMap, itemStats, stashItems } from '../state';
import { esc, itemCardHTML, openModal, shapeMiniHTML, toast } from './common';

const RARITY_RANK: Record<ItemRarity, number> = { legendary: 0, rare: 1, magic: 2, normal: 3 };
const GAP = 2;

interface DragState {
  item: Item;
  rot: number;
  /** つかんだマス（形の中の位置） */
  grab: [number, number];
  ghost: HTMLElement;
  fromBag: boolean;
  target: { x: number; y: number } | null;
  overStash: boolean;
}

export class BagView {
  readonly el: HTMLElement;
  private selected: string | null = null;
  private cell = 52;
  private drag: DragState | null = null;
  private press: { uid: string; x: number; y: number; fromBag: boolean; grab: [number, number] } | null = null;

  constructor(private getState: () => GameState, private save: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'page bag-view hidden';
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', () => this.cancelDrag());
    window.addEventListener('keydown', (e) => {
      if (this.drag && (e.key === 'r' || e.key === 'R')) this.rotateDrag();
    });
    window.addEventListener('resize', () => {
      if (!this.el.classList.contains('hidden')) this.render();
    });
  }

  setVisible(v: boolean) {
    this.el.classList.toggle('hidden', !v);
    if (v) this.render();
  }

  private cp(): number {
    return combatPower(computeStats(this.getState()));
  }

  render() {
    const s = this.getState();
    const bp = s.backpack;
    const items = itemMap(s);
    const stats = computeStats(s);
    const bonus = computeBonuses(bp, items);
    const width = Math.min(this.el.clientWidth || window.innerWidth, 520) - 32;
    this.cell = Math.max(34, Math.min(60, Math.floor((width - (BACKPACK_MAX.w - 1) * GAP) / BACKPACK_MAX.w)));
    const c = this.cell;

    // 選択中のアイテムがボーナスを与えている相手・受けている相手
    const sel = this.selected;
    const boostedBySel = new Set<string>();
    if (sel) for (const [uid, b] of bonus) if (b.from.includes(sel)) boostedBySel.add(uid);
    const boostingSel = new Set(sel ? bonus.get(sel)?.from ?? [] : []);

    const cells: string[] = [];
    for (let y = 0; y < bp.h; y++) for (let x = 0; x < bp.w; x++) cells.push(`<div class="bp-cell" style="left:${x * (c + GAP)}px;top:${y * (c + GAP)}px;width:${c}px;height:${c}px"></div>`);
    const placed = bp.placed
      .map((p) => {
        const it = items.get(p.uid);
        if (!it) return '';
        const b = bonus.get(p.uid);
        const cls = [
          p.uid === sel ? 'sel' : '',
          boostedBySel.has(p.uid) ? 'boosted' : '',
          boostingSel.has(p.uid) ? 'boosting' : '',
        ].join(' ');
        return this.itemBlockHTML(it, p.rot, p.x * (c + GAP), p.y * (c + GAP), cls, b && b.pct > 0 ? `★+${Math.round(b.pct * 100)}%` : '');
      })
      .join('');

    const stash = [...stashItems(s)].sort((a, b) => RARITY_RANK[a.rarity] - RARITY_RANK[b.rarity] || b.ilvl - a.ilvl);
    const statRows = (Object.keys(STAT_INFO) as StatKey[])
      .map((k) => `<div class="stat"><span>${STAT_INFO[k].label}</span><b>${stats[k]}${STAT_INFO[k].unit}</b></div>`)
      .join('');
    const cost = expandCost(bp);

    this.el.innerHTML = `
      <h2>バックパック <span class="cp-badge">⚔ 戦闘力 ${combatPower(stats).toLocaleString()}</span></h2>
      <p class="bp-help">入れたアイテムだけが効きます。決まった組み合わせで<b>隣り合わせる</b>と ★ボーナス。ドラッグで出し入れ、タップで選択。</p>
      <div class="bp-grid" style="width:${bp.w * (c + GAP) - GAP}px;height:${bp.h * (c + GAP) - GAP}px">${cells.join('')}${placed}</div>
      <div class="bp-tools">
        ${cost !== null && bp.w < BACKPACK_MAX.w ? `<button class="btn btn-small act-expand" data-dir="w">↔ 横に広げる 🪙${cost}</button>` : ''}
        ${cost !== null && bp.h < BACKPACK_MAX.h ? `<button class="btn btn-small act-expand" data-dir="h">↕ 縦に広げる 🪙${cost}</button>` : ''}
        ${cost === null ? '<span class="bp-max">最大サイズ</span>' : ''}
      </div>
      <div class="bp-detail">${sel && items.get(sel) ? this.detailHTML(items.get(sel)!) : '<p class="empty">アイテムをタップすると詳しく見られます</p>'}</div>
      <details class="stats"><summary>ステータス</summary><div class="stat-grid">${statRows}</div></details>
      <div class="inv-head">
        <h2>倉庫 <small>${stash.length}/${INVENTORY_MAX}</small></h2>
        <button class="btn btn-small act-bulk">ノーマル・マジックを一括分解</button>
      </div>
      <div class="stash">${stash.map((it) => `<div class="stash-item rarity-${it.rarity}${it.uid === sel ? ' sel' : ''}" data-uid="${it.uid}" style="--rc:${ITEM_RARITY_INFO[it.rarity].color}">
          ${shapeMiniHTML(it)}
          <div class="stash-name">${esc(it.name)}</div>
          <div class="stash-meta">${SLOT_LABEL[it.slot]}・iLv${it.ilvl}</div>
        </div>`).join('') || '<p class="empty">倉庫は空です。魚を釣って装備を集めよう！</p>'}</div>`;

    // つかむ（ドラッグ開始 or タップ）
    this.el.querySelectorAll<HTMLElement>('.bp-grid .bp-item').forEach((n) =>
      n.addEventListener('pointerdown', (e) => {
        const p = bp.placed.find((q) => q.uid === n.dataset.uid)!;
        const r = n.getBoundingClientRect();
        const grab: [number, number] = [Math.floor((e.clientX - r.left) / (c + GAP)), Math.floor((e.clientY - r.top) / (c + GAP))];
        this.press = { uid: p.uid, x: e.clientX, y: e.clientY, fromBag: true, grab };
      }),
    );
    this.el.querySelectorAll<HTMLElement>('.stash-item').forEach((n) =>
      n.addEventListener('pointerdown', (e) => {
        this.press = { uid: n.dataset.uid!, x: e.clientX, y: e.clientY, fromBag: false, grab: [0, 0] };
      }),
    );
    this.bindDetail();
    this.el.querySelectorAll<HTMLButtonElement>('.act-expand').forEach((b) => b.addEventListener('click', () => this.expand(b.dataset.dir as 'w' | 'h')));
    this.el.querySelector('.act-bulk')!.addEventListener('click', () => this.bulkSalvage());
  }

  /** マス目に置いたアイテム（形どおりのマスで描く） */
  private itemBlockHTML(it: Item, rot: number, left: number, top: number, cls: string, badge: string): string {
    const c = this.cell;
    const cells = shapeCells(it, rot);
    const { w, h } = shapeSize(cells);
    const color = ITEM_RARITY_INFO[it.rarity].color;
    const [ix, iy] = cells[0];
    return `<div class="bp-item rarity-${it.rarity} ${cls}" data-uid="${it.uid}" style="left:${left}px;top:${top}px;width:${w * (c + GAP) - GAP}px;height:${h * (c + GAP) - GAP}px;--rc:${color}">
      ${cells.map(([x, y]) => `<div class="bp-piece" style="left:${x * (c + GAP)}px;top:${y * (c + GAP)}px;width:${c}px;height:${c}px"></div>`).join('')}
      <div class="bp-icon" style="left:${ix * (c + GAP)}px;top:${iy * (c + GAP)}px;width:${c}px;height:${c}px">${SLOT_ICON[it.slot]}</div>
      ${badge ? `<div class="bp-badge">${badge}</div>` : ''}
    </div>`;
  }

  private detailHTML(it: Item): string {
    const s = this.getState();
    const items = itemMap(s);
    const placed = isPlaced(s, it.uid);
    const syn = synergyOf(it);
    const b = computeBonuses(s.backpack, items).get(it.uid);
    const fromNames = (b?.from ?? []).map((u) => items.get(u)?.name ?? '').filter(Boolean);
    const mult = 1 + (b?.pct ?? 0);
    const eff = Object.entries(itemStats(it))
      .map(([k, v]) => `${STAT_INFO[k as StatKey].label} ${Math.round(v! * mult)}${STAT_INFO[k as StatKey].unit}`)
      .join('・');
    return `
      ${itemCardHTML(it)}
      <div class="syn">★ 隣接ボーナス: ${syn ? esc(syn.text) : 'なし'}</div>
      ${placed
        ? `<div class="syn-recv">${b && b.pct > 0 ? `受けているボーナス <b>+${Math.round(b.pct * 100)}%</b>（${fromNames.map(esc).join('・')}）` : '受けているボーナスなし'}<br>いまの効果: ${eff}</div>`
        : '<div class="syn-recv">倉庫にあるので、いまは効果なし</div>'}
      <div class="modal-actions">
        ${placed
          ? `<button class="btn act-rot">↻ 回転</button><button class="btn act-out">倉庫へ</button>`
          : `<button class="btn btn-primary act-in">バックパックへ</button>`}
        ${placed ? '' : `<button class="btn btn-danger act-salvage">分解 🪙${salvageValue(it)}</button>`}
      </div>`;
  }

  private bindDetail() {
    const uid = this.selected;
    if (!uid) return;
    const s = this.getState();
    const it = itemMap(s).get(uid);
    if (!it) return;
    this.el.querySelector('.act-rot')?.addEventListener('click', () => this.rotatePlaced(it));
    this.el.querySelector('.act-out')?.addEventListener('click', () => this.toStash(it));
    this.el.querySelector('.act-in')?.addEventListener('click', () => this.autoPlace(it));
    this.el.querySelector('.act-salvage')?.addEventListener('click', () => this.salvage(it));
  }

  // ---- 操作 ----

  /** 配置を変えて、戦闘力の変化を知らせる */
  private commit(change: () => void) {
    const before = this.cp();
    change();
    this.save();
    const after = this.cp();
    if (after !== before) toast(`⚔ 戦闘力 ${before.toLocaleString()} → ${after.toLocaleString()} ${after > before ? '▲' : '▼'}${Math.abs(after - before).toLocaleString()}`);
    this.render();
  }

  private setPlacement(p: Placement) {
    const bp = this.getState().backpack;
    bp.placed = bp.placed.filter((q) => q.uid !== p.uid);
    bp.placed.push(p);
  }

  private rotatePlaced(it: Item) {
    const s = this.getState();
    const items = itemMap(s);
    const p = s.backpack.placed.find((q) => q.uid === it.uid)!;
    for (let i = 1; i < 4; i++) {
      const rot = (p.rot + i) % 4;
      if (canPlace(s.backpack, items, it, p.x, p.y, rot)) return this.commit(() => this.setPlacement({ ...p, rot }));
    }
    toast('回転するスペースがありません');
  }

  private toStash(it: Item) {
    const s = this.getState();
    if (stashItems(s).length >= INVENTORY_MAX) return toast('倉庫がいっぱいです');
    this.commit(() => (s.backpack.placed = s.backpack.placed.filter((q) => q.uid !== it.uid)));
  }

  private autoPlace(it: Item) {
    const s = this.getState();
    const spot = findSpot(s.backpack, itemMap(s), it);
    if (!spot) return toast('バックパックに空きがありません');
    this.commit(() => s.backpack.placed.push(spot));
  }

  private salvage(it: Item) {
    const s = this.getState();
    if ((it.rarity === 'legendary' || it.rarity === 'rare') && !confirm(`${ITEM_RARITY_INFO[it.rarity].label}「${it.name}」を分解しますか？`)) return;
    s.inventory = s.inventory.filter((i) => i.uid !== it.uid);
    s.coins += salvageValue(it);
    this.selected = null;
    this.save();
    toast(`🪙 +${salvageValue(it)}`);
    this.render();
  }

  private bulkSalvage() {
    const s = this.getState();
    const targets = stashItems(s).filter((i) => i.rarity === 'normal' || i.rarity === 'magic');
    if (!targets.length) return toast('分解できるものがない');
    if (!confirm(`倉庫の${targets.length}個を分解しますか？（バックパックの中は分解しません）`)) return;
    const coins = targets.reduce((sum, i) => sum + salvageValue(i), 0);
    const set = new Set(targets.map((t) => t.uid));
    s.inventory = s.inventory.filter((i) => !set.has(i.uid));
    s.coins += coins;
    if (this.selected && set.has(this.selected)) this.selected = null;
    this.save();
    toast(`🪙 +${coins}`);
    this.render();
  }

  private expand(dir: 'w' | 'h') {
    const s = this.getState();
    const cost = expandCost(s.backpack);
    if (cost === null) return;
    if (s.coins < cost) return toast(`コインが足りません（🪙${cost}）`);
    const m = openModal(`<div class="result"><div class="sr-title">バックパックを広げる</div>
      <div class="sr-sub">🪙${cost} で${dir === 'w' ? '横' : '縦'}に1マス広げます（いま ${s.backpack.w}×${s.backpack.h}）</div>
      <div class="modal-actions"><button class="btn btn-primary act-yes">広げる</button><button class="btn act-no">やめる</button></div></div>`);
    m.el.querySelector('.act-no')!.addEventListener('click', m.close);
    m.el.querySelector('.act-yes')!.addEventListener('click', () => {
      m.close();
      s.coins -= cost;
      if (dir === 'w') s.backpack.w++;
      else s.backpack.h++;
      this.save();
      toast(`バックパックが ${s.backpack.w}×${s.backpack.h} になった！`);
      this.render();
    });
  }

  // ---- ドラッグ ----

  private onMove(e: PointerEvent) {
    if (this.press && !this.drag && Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y) > 8) this.startDrag();
    if (!this.drag) return;
    e.preventDefault();
    this.positionGhost(e.clientX, e.clientY);
  }

  private startDrag() {
    const pr = this.press!;
    const s = this.getState();
    const it = itemMap(s).get(pr.uid);
    if (!it) return;
    const p = s.backpack.placed.find((q) => q.uid === it.uid);
    const ghost = document.createElement('div');
    ghost.className = 'bp-ghost';
    document.body.appendChild(ghost);
    this.drag = { item: it, rot: p?.rot ?? 0, grab: pr.grab, ghost, fromBag: pr.fromBag, target: null, overStash: false };
    this.selected = it.uid;
    this.el.classList.add('dragging');
    // 元の場所は薄く
    this.el.querySelector(`.bp-item[data-uid="${it.uid}"]`)?.classList.add('lifted');
    this.drawGhost();
    this.positionGhost(pr.x, pr.y);
  }

  private drawGhost() {
    const d = this.drag!;
    const cells = shapeCells(d.item, d.rot);
    // つかんだマスが形の外になったら（回転したとき）、近いマスにする
    if (!cells.some(([x, y]) => x === d.grab[0] && y === d.grab[1])) d.grab = cells[0];
    d.ghost.innerHTML = this.itemBlockHTML(d.item, d.rot, 0, 0, '', '') + '<button class="bp-rot-btn" type="button">↻</button>';
    d.ghost.querySelector('.bp-rot-btn')!.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.rotateDrag();
    });
  }

  private rotateDrag() {
    if (!this.drag) return;
    this.drag.rot = (this.drag.rot + 1) % 4;
    this.drawGhost();
  }

  private lastPt = { x: 0, y: 0 };
  private positionGhost(px: number, py: number) {
    const d = this.drag!;
    this.lastPt = { x: px, y: py };
    const c = this.cell;
    const left = px - d.grab[0] * (c + GAP) - c / 2;
    const top = py - d.grab[1] * (c + GAP) - c / 2;
    d.ghost.style.transform = `translate(${left}px, ${top}px)`;
    const grid = this.el.querySelector('.bp-grid') as HTMLElement;
    const r = grid.getBoundingClientRect();
    const s = this.getState();
    const x = Math.round((left - r.left) / (c + GAP));
    const y = Math.round((top - r.top) / (c + GAP));
    const inside = px >= r.left - c && px <= r.right + c && py >= r.top - c && py <= r.bottom + c;
    const ok = inside && canPlace(s.backpack, itemMap(s), d.item, x, y, d.rot);
    d.target = ok ? { x, y } : null;
    const stashEl = this.el.querySelector('.stash') as HTMLElement;
    const sr = stashEl.getBoundingClientRect();
    d.overStash = py >= sr.top - 20;
    d.ghost.classList.toggle('ok', ok);
    d.ghost.classList.toggle('ng', inside && !ok);
    // 置いたときの戦闘力の見込み
    let hint = '';
    if (ok) {
      const before = this.cp();
      const bp = s.backpack;
      const saved = bp.placed;
      bp.placed = [...saved.filter((q) => q.uid !== d.item.uid), { uid: d.item.uid, x, y, rot: d.rot }];
      const after = this.cp();
      bp.placed = saved;
      const diff = after - before;
      hint = diff ? `⚔ ${diff > 0 ? '▲' : '▼'}${Math.abs(diff).toLocaleString()}` : '';
    } else if (d.fromBag && d.overStash) hint = '倉庫へ';
    let h = d.ghost.querySelector('.bp-hint') as HTMLElement | null;
    if (!h) {
      h = document.createElement('div');
      h.className = 'bp-hint';
      d.ghost.appendChild(h);
    }
    h.textContent = hint;
    h.classList.toggle('down', hint.includes('▼'));
  }

  private onUp(e: PointerEvent) {
    if (this.press && !this.drag) {
      // タップ：選択
      const uid = this.press.uid;
      this.press = null;
      this.selected = this.selected === uid ? null : uid;
      this.render();
      return;
    }
    this.press = null;
    if (!this.drag) return;
    if ((e.target as HTMLElement).closest?.('.bp-rot-btn')) return;
    const d = this.drag;
    this.positionGhost(this.lastPt.x, this.lastPt.y);
    this.endDragVisual();
    if (d.target) {
      this.commit(() => this.setPlacement({ uid: d.item.uid, x: d.target!.x, y: d.target!.y, rot: d.rot }));
    } else if (d.fromBag && d.overStash) {
      this.toStash(d.item);
    } else {
      if (!d.fromBag) toast('そこには置けません');
      this.render();
    }
  }

  private cancelDrag() {
    this.press = null;
    if (!this.drag) return;
    this.endDragVisual();
    this.render();
  }

  private endDragVisual() {
    this.drag?.ghost.remove();
    this.drag = null;
    this.el.classList.remove('dragging');
  }
}
