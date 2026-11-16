import { ITEM_RARITY_INFO, Item, SLOT_LABEL, STAT_INFO, StatKey } from '../data/gear';
import { shapeCells, shapeSize, synergyOf } from '../backpack';

/** アイテムの形の小さなプレビュー */
export function shapeMiniHTML(item: Item): string {
  const cells = shapeCells(item, 0);
  const { w, h } = shapeSize(cells);
  const u = 9;
  return `<div class="shape-mini" style="width:${w * u}px;height:${h * u}px">${cells
    .map(([x, y]) => `<i style="left:${x * u}px;top:${y * u}px"></i>`)
    .join('')}</div>`;
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function statLine(stat: StatKey, value: number): string {
  const info = STAT_INFO[stat];
  return `+${value}${info.unit} ${info.label}`;
}

export function itemCardHTML(item: Item, opts: { compact?: boolean } = {}): string {
  const r = ITEM_RARITY_INFO[item.rarity];
  const lines = opts.compact
    ? ''
    : `<div class="item-implicit">${esc(statLine(item.implicit.stat, item.implicit.value))}</div>` +
      item.affixes.map((a) => `<div class="item-affix">${esc(statLine(a.stat, a.value))} <span class="tier">T${a.tier}</span></div>`).join('');
  return `<div class="item-card rarity-${item.rarity}" style="--rc:${r.color}">
    <div class="item-head"><span class="item-name">${esc(item.name)}</span>${shapeMiniHTML(item)}</div>
    <div class="item-meta">${SLOT_LABEL[item.slot]}・iLv${item.ilvl}・${r.label}</div>
    ${lines}
    ${opts.compact ? '' : (() => { const s = synergyOf(item); return s ? `<div class="item-syn">★ ${esc(s.text)}</div>` : ''; })()}
  </div>`;
}

/** モーダルを開き、閉じたら resolve */
export function openModal(content: HTMLElement | string, opts: { dismissable?: boolean } = {}): { el: HTMLElement; closed: Promise<void>; close: () => void } {
  const back = document.createElement('div');
  back.className = 'modal-back';
  const box = document.createElement('div');
  box.className = 'modal';
  if (typeof content === 'string') box.innerHTML = content;
  else box.appendChild(content);
  back.appendChild(box);
  document.body.appendChild(back);
  let resolve!: () => void;
  const closed = new Promise<void>((r) => (resolve = r));
  const close = () => {
    back.remove();
    resolve();
  };
  if (opts.dismissable !== false) {
    back.addEventListener('click', (e) => {
      if (e.target === back) close();
    });
  }
  return { el: box, closed, close };
}

export function toast(text: string) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('out'), 1800);
  setTimeout(() => t.remove(), 2300);
}
