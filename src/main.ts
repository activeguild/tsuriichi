import './style.css';
import { FISH_BY_ID, FISH_RARITY_INFO } from './data/fish';
import { ITEM_RARITY_INFO } from './data/gear';
import { FishingView } from './fishing/FishingView';
import { GeoTracker, Spot } from './geo';
import { CaughtFish, rollFish, rollRewards, salvageValue } from './loot';
import { Rng } from './rng';
import {
  addXp, computeStats, consumeSpot, GameState, INVENTORY_MAX, loadState, saveState, spotStock, xpToNext,
} from './state';
import { BagView } from './ui/BagView';
import { esc, itemCardHTML, openModal, toast } from './ui/common';
import { MapView } from './ui/MapView';
import { ZukanView } from './ui/ZukanView';

const state: GameState = loadState();
const getState = () => state;
const save = () => {
  saveState(state);
  renderHeader();
};
const rng = new Rng();

const app = document.getElementById('app')!;
app.innerHTML = `
  <header class="hdr">
    <div class="hdr-title">釣りいち</div>
    <div class="hdr-lv"></div>
    <div class="hdr-xp"><div class="fill"></div></div>
    <div class="hdr-coins"></div>
  </header>
  <main class="main"></main>
  <nav class="tabs">
    <button data-tab="map" class="active">🗺️<span>地図</span></button>
    <button data-tab="bag">🎒<span>装備</span></button>
    <button data-tab="zukan">📖<span>図鑑</span></button>
  </nav>`;

function renderHeader() {
  app.querySelector('.hdr-lv')!.textContent = `Lv${state.level}`;
  (app.querySelector('.hdr-xp .fill') as HTMLElement).style.width = `${(state.xp / xpToNext(state.level)) * 100}%`;
  app.querySelector('.hdr-coins')!.textContent = `🪙 ${state.coins}`;
}
renderHeader();

const geo = new GeoTracker();
const main = app.querySelector('.main')!;
const mapView = new MapView(geo, getState, startFishing);
const bagView = new BagView(getState, save);
const zukanView = new ZukanView(getState);
main.append(mapView.el, bagView.el, zukanView.el);

type Tab = 'map' | 'bag' | 'zukan';
function showTab(tab: Tab) {
  app.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  mapView.setVisible(tab === 'map');
  bagView.setVisible(tab === 'bag');
  zukanView.setVisible(tab === 'zukan');
}
app.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) =>
  b.addEventListener('click', () => showTab(b.dataset.tab as Tab)),
);

const params = new URLSearchParams(location.search);
const at = params.get('at')?.split(',').map(Number);
if (at && at.length === 2 && at.every(Number.isFinite)) geo.startSim({ lat: at[0], lng: at[1] });
else geo.start(params.has('sim'));

let fishing: FishingView | null = null;

const AUTO_KEY = 'tsuriichi.auto';
function loadAuto(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) === '1';
  } catch {
    return false;
  }
}
function saveAuto(v: boolean) {
  try {
    localStorage.setItem(AUTO_KEY, v ? '1' : '0');
  } catch {
    /* noop */
  }
}

function startFishing(spot: Spot) {
  if (fishing) return;
  mapView.setVisible(false);
  app.classList.add('in-fishing');
  fishing = new FishingView(spot, computeStats(state), {
    rollFish: () => rollFish(spot, computeStats(state), rng),
    stock: () => spotStock(state, spot.id),
    onLanded: (fish, auto) => onLanded(spot, fish, auto),
    onAutoChange: saveAuto,
    onEscaped: () => {
      // 逃しても魚は減る（同じスポットで無限に粘れないように）
      consumeSpot(state, spot.id);
      save();
    },
    onExit: () => {
      fishing?.destroy();
      fishing = null;
      app.classList.remove('in-fishing');
      showTab('map');
    },
  }, { auto: loadAuto() });
  document.body.appendChild(fishing.el);
}

async function onLanded(spot: Spot, fish: CaughtFish, auto: boolean): Promise<void> {
  const sp = FISH_BY_ID[fish.speciesId];
  const stats = computeStats(state);
  consumeSpot(state, spot.id);

  const prev = state.zukan[sp.id];
  const isNew = !prev;
  const isRecord = !!prev && fish.size > prev.maxSize;
  state.zukan[sp.id] = {
    count: (prev?.count ?? 0) + 1,
    maxSize: Math.max(prev?.maxSize ?? 0, fish.size),
    firstAt: prev?.firstAt ?? Date.now(),
  };

  const reward = rollRewards(rng, fish, spot, stats, state.level);
  const levelUps = addXp(state, reward.xp);
  state.coins += reward.coins;
  const kept = [];
  let autoSalvaged = 0;
  for (const it of reward.items) {
    if (state.inventory.length < INVENTORY_MAX) {
      state.inventory.push(it);
      kept.push(it);
    } else {
      autoSalvaged += salvageValue(it);
    }
  }
  state.coins += autoSalvaged;
  save();

  const r = FISH_RARITY_INFO[sp.rarity];
  const best = reward.items.reduce<string | null>((acc, it) => (it.rarity === 'legendary' ? 'legendary' : acc ?? (it.rarity === 'rare' ? 'rare' : null)), null);
  const m = openModal(
    `<div class="result">
      <div class="result-stars" style="color:${r.color}">${'★'.repeat(r.stars)}</div>
      <div class="result-name">${esc(sp.name)}</div>
      <div class="result-size">${fish.size}cm ${isNew ? '<span class="tag new">NEW!</span>' : ''}${isRecord ? '<span class="tag rec">自己ベスト!</span>' : ''}</div>
      <div class="result-rewards">✨ +${reward.xp} XP　🪙 +${reward.coins}${autoSalvaged ? `（バッグ満杯: +${autoSalvaged}）` : ''}</div>
      ${levelUps ? `<div class="result-lvup">LEVEL UP! → Lv${state.level}</div>` : ''}
      ${kept.length ? `<div class="result-drops-title">ドロップ</div><div class="result-drops">${kept.map((i) => itemCardHTML(i)).join('')}</div>` : '<div class="result-nodrop">ドロップなし</div>'}
      <div class="modal-actions"><button class="btn btn-primary act-ok">つづける</button></div>
    </div>`,
    { dismissable: false },
  );
  if (best) m.el.classList.add(`glow-${best}`);
  m.el.querySelector('.act-ok')!.addEventListener('click', m.close);
  if (auto) {
    // 自動釣り中は結果を少し見せてから自動で閉じる（レジェンダリーは長めに）
    const btn = m.el.querySelector('.act-ok') as HTMLButtonElement;
    let left = best === 'legendary' ? 6 : 3;
    btn.textContent = `つづける（${left}）`;
    const iv = setInterval(() => {
      left--;
      if (left <= 0) {
        clearInterval(iv);
        m.close();
      } else btn.textContent = `つづける（${left}）`;
    }, 1000);
    m.closed.then(() => clearInterval(iv));
  }
  if (best === 'legendary') toast(`🔥 ${ITEM_RARITY_INFO.legendary.label}ドロップ！`);
  await m.closed;
}
