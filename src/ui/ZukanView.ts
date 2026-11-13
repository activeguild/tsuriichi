import { BIOME_LABEL, FISH, FISH_RARITY_INFO } from '../data/fish';
import type { GameState } from '../state';
import { esc } from './common';

const TIME_LABEL = { any: '終日', day: '昼', night: '夜' } as const;

export class ZukanView {
  readonly el: HTMLElement;
  constructor(private getState: () => GameState) {
    this.el = document.createElement('div');
    this.el.className = 'page zukan-view hidden';
  }

  setVisible(v: boolean) {
    this.el.classList.toggle('hidden', !v);
    if (v) this.render();
  }

  render() {
    const s = this.getState();
    const caught = FISH.filter((f) => s.zukan[f.id]).length;
    this.el.innerHTML = `
      <h2>図鑑 <small>${caught}/${FISH.length}</small></h2>
      <div class="zukan-grid">${FISH.map((f) => {
        const e = s.zukan[f.id];
        const r = FISH_RARITY_INFO[f.rarity];
        const where = f.biomes.map((b) => BIOME_LABEL[b]).join('・') + `／${TIME_LABEL[f.time]}`;
        return `<div class="zukan-card ${e ? '' : 'unknown'}" style="--rc:${r.color}">
          <div class="zukan-stars">${'★'.repeat(r.stars)}</div>
          <div class="zukan-name">${e ? esc(f.name) : '？？？'}</div>
          <div class="zukan-where">${where}</div>
          ${e ? `<div class="zukan-rec">${e.count}匹・最大 ${e.maxSize}cm</div><div class="zukan-desc">${esc(f.desc)}</div>` : ''}
        </div>`;
      }).join('')}</div>`;
  }
}
