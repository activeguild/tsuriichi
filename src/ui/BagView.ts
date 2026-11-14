import { ITEM_RARITY_INFO, Item, ItemRarity, SLOTS, SLOT_LABEL, STAT_INFO, StatKey } from '../data/gear';
import { salvageValue } from '../loot';
import { combatPower } from '../balance';
import { computeStats, GameState, INVENTORY_MAX, itemStats } from '../state';
import { esc, itemCardHTML, openModal, toast } from './common';

const RARITY_RANK: Record<ItemRarity, number> = { legendary: 0, rare: 1, magic: 2, normal: 3 };

export class BagView {
  readonly el: HTMLElement;
  constructor(private getState: () => GameState, private save: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'page bag-view hidden';
  }

  setVisible(v: boolean) {
    this.el.classList.toggle('hidden', !v);
    if (v) this.render();
  }

  render() {
    const s = this.getState();
    const stats = computeStats(s);
    const equipped = SLOTS.map((slot) => {
      const it = s.equipped[slot];
      return `<div class="eq-slot" data-slot="${slot}">
        <div class="eq-label">${SLOT_LABEL[slot]}</div>
        ${it ? itemCardHTML(it, { compact: true }) : '<div class="eq-empty">なし</div>'}
      </div>`;
    }).join('');
    const statRows = (Object.keys(STAT_INFO) as StatKey[])
      .map((k) => `<div class="stat"><span>${STAT_INFO[k].label}</span><b>${stats[k]}${STAT_INFO[k].unit}</b></div>`)
      .join('');
    const inv = [...s.inventory].sort((a, b) => RARITY_RANK[a.rarity] - RARITY_RANK[b.rarity] || b.ilvl - a.ilvl);
    this.el.innerHTML = `
      <h2>装備 <span class="cp-badge">⚔ 戦闘力 ${combatPower(stats).toLocaleString()}</span></h2>
      <div class="eq-grid">${equipped}</div>
      <details class="stats"><summary>ステータス</summary><div class="stat-grid">${statRows}</div></details>
      <div class="inv-head">
        <h2>バッグ <small>${s.inventory.length}/${INVENTORY_MAX}</small></h2>
        <button class="btn btn-small act-bulk">ノーマル・マジックを一括分解</button>
      </div>
      <div class="inv-list">${inv.map((it) => `<div class="inv-item" data-uid="${it.uid}">${itemCardHTML(it)}</div>`).join('') || '<p class="empty">まだ何もない。魚を釣って装備を集めよう！</p>'}</div>`;

    this.el.querySelectorAll<HTMLElement>('.inv-item').forEach((n) =>
      n.addEventListener('click', () => this.openItem(s.inventory.find((i) => i.uid === n.dataset.uid)!)),
    );
    this.el.querySelectorAll<HTMLElement>('.eq-slot').forEach((n) =>
      n.addEventListener('click', () => {
        const it = s.equipped[n.dataset.slot as keyof GameState['equipped']];
        if (it) this.openItem(it, true);
      }),
    );
    this.el.querySelector('.act-bulk')!.addEventListener('click', () => {
      const targets = s.inventory.filter((i) => i.rarity === 'normal' || i.rarity === 'magic');
      if (!targets.length) return toast('分解できるものがない');
      if (!confirm(`${targets.length}個を分解しますか？`)) return;
      const coins = targets.reduce((sum, i) => sum + salvageValue(i), 0);
      s.inventory = s.inventory.filter((i) => !targets.includes(i));
      s.coins += coins;
      this.save();
      toast(`🪙 +${coins}`);
      this.render();
    });
  }

  private openItem(item: Item, isEquipped = false) {
    const s = this.getState();
    const cur = s.equipped[item.slot];
    let compare = '';
    // 装備したときの戦闘力の変化
    const cpNow = combatPower(computeStats(s));
    const cpWith = combatPower(computeStats({ ...s, equipped: { ...s.equipped, [item.slot]: item } }));
    const cpDiff = cpWith - cpNow;
    if (!isEquipped) {
      const a = itemStats(item);
      const b = cur ? itemStats(cur) : {};
      const keys = new Set([...Object.keys(a), ...Object.keys(b)] as StatKey[]);
      compare = [...keys]
        .map((k) => {
          const d = (a[k] ?? 0) - (b[k] ?? 0);
          if (!d) return '';
          return `<div class="diff ${d > 0 ? 'up' : 'down'}">${STAT_INFO[k].label} ${d > 0 ? '+' : ''}${d}${STAT_INFO[k].unit}</div>`;
        })
        .join('');
      const cpLine = `<div class="cp-diff ${cpDiff > 0 ? 'up' : cpDiff < 0 ? 'down' : ''}">⚔ 戦闘力 ${cpNow.toLocaleString()} → ${cpWith.toLocaleString()} ${cpDiff > 0 ? `▲${cpDiff.toLocaleString()}` : cpDiff < 0 ? `▼${(-cpDiff).toLocaleString()}` : ''}</div>`;
      compare = `<div class="compare">${cpLine}<div class="compare-title">装備中と比較${cur ? '' : '（なし）'}</div>${compare || '<div class="diff">変化なし</div>'}</div>`;
    }
    const m = openModal(`
      ${itemCardHTML(item)}
      ${compare}
      <div class="modal-actions">
        ${isEquipped ? '<button class="btn act-unequip">外す</button>' : '<button class="btn btn-primary act-equip">装備する</button>'}
        ${isEquipped ? '' : `<button class="btn btn-danger act-salvage">分解 🪙${salvageValue(item)}</button>`}
        <button class="btn act-close">閉じる</button>
      </div>`);
    m.el.querySelector('.act-close')!.addEventListener('click', m.close);
    m.el.querySelector('.act-equip')?.addEventListener('click', () => {
      s.inventory = s.inventory.filter((i) => i.uid !== item.uid);
      if (cur) s.inventory.push(cur);
      s.equipped[item.slot] = item;
      this.save();
      m.close();
      toast(cpDiff > 0 ? `⚔ 戦闘力 ${cpNow.toLocaleString()} → ${cpWith.toLocaleString()} ▲${cpDiff.toLocaleString()}` : `${item.name} を装備した`);
      this.render();
    });
    m.el.querySelector('.act-unequip')?.addEventListener('click', () => {
      if (s.inventory.length >= INVENTORY_MAX) return toast('バッグがいっぱい');
      delete s.equipped[item.slot];
      s.inventory.push(item);
      this.save();
      m.close();
      this.render();
    });
    m.el.querySelector('.act-salvage')?.addEventListener('click', () => {
      if (item.rarity === 'legendary' || item.rarity === 'rare') {
        if (!confirm(`${ITEM_RARITY_INFO[item.rarity].label}「${esc(item.name)}」を分解しますか？`)) return;
      }
      s.inventory = s.inventory.filter((i) => i.uid !== item.uid);
      s.coins += salvageValue(item);
      this.save();
      m.close();
      this.render();
    });
  }
}
