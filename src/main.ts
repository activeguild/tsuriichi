import './style.css';
import { FISH_BY_ID, FISH_RARITY_INFO } from './data/fish';
import { ITEM_RARITY_INFO, Item, ItemRarity } from './data/gear';
import { FishingView } from './fishing/FishingView';
import { GeoTracker, Spot } from './geo';
import { CaughtFish, rollFish, rollRewards, salvageValue } from './loot';
import { Rng } from './rng';
import { combatPower } from './balance';
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
    <div class="hdr-cp" title="戦闘力（1秒あたりの期待ダメージ）"></div>
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
  app.querySelector('.hdr-cp')!.textContent = `⚔ ${combatPower(computeStats(state)).toLocaleString()}`;
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

/** 1匹釣り上げたときの結果（報酬はこの時点で付与済み） */
interface CatchRecord {
  fish: CaughtFish;
  isNew: boolean;
  isRecord: boolean;
  xp: number;
  coins: number;
  levelUps: number;
  kept: Item[];
  autoSalvaged: number;
}

/** 自動釣りセッション（AUTOをオンにしてからオフにするまで）の釣果 */
interface AutoSession {
  spot: Spot;
  startAt: number;
  startLevel: number;
  catches: CatchRecord[];
  escapes: number;
}
let autoSession: AutoSession | null = null;

function startAutoSession(spot: Spot) {
  autoSession = { spot, startAt: Date.now(), startLevel: state.level, catches: [], escapes: 0 };
}

/** セッションを終えて釣果リザルトを表示する */
async function endAutoSession(reason: 'user' | 'empty' | 'exit'): Promise<void> {
  const ses = autoSession;
  autoSession = null;
  if (!ses) return;
  if (ses.catches.length === 0 && ses.escapes === 0) return;
  await showSessionResult(ses, reason);
}

function startFishing(spot: Spot) {
  if (fishing) return;
  mapView.setVisible(false);
  app.classList.add('in-fishing');
  const auto = loadAuto();
  if (auto) startAutoSession(spot);
  fishing = new FishingView(spot, computeStats(state), {
    rollFish: () => rollFish(spot, computeStats(state), rng),
    stock: () => spotStock(state, spot.id),
    onLanded: (fish, auto) => onLanded(spot, fish, auto),
    onAutoChange: (on, reason) => {
      // スポットが空になって止まったときは設定（次回もAUTO）を残す
      if (reason === 'user') saveAuto(on);
      if (on) startAutoSession(spot);
      else void endAutoSession(reason);
    },
    onEscaped: () => {
      // 逃しても魚は減る（同じスポットで無限に粘れないように）
      consumeSpot(state, spot.id);
      if (autoSession) autoSession.escapes++;
      save();
    },
    onExit: () => {
      fishing?.destroy();
      fishing = null;
      app.classList.remove('in-fishing');
      showTab('map');
      void endAutoSession('exit');
    },
  }, { auto });
  document.body.appendChild(fishing.el);
}

/** 釣り上げた魚の報酬を付与する */
function grantCatch(spot: Spot, fish: CaughtFish): CatchRecord {
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
  const kept: Item[] = [];
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
  return { fish, isNew, isRecord, xp: reward.xp, coins: reward.coins, levelUps, kept, autoSalvaged };
}

const RARITY_RANK: Record<ItemRarity, number> = { legendary: 0, rare: 1, magic: 2, normal: 3 };

function bestRarity(items: Item[]): ItemRarity | null {
  return items.reduce<ItemRarity | null>((acc, it) => (!acc || RARITY_RANK[it.rarity] < RARITY_RANK[acc] ? it.rarity : acc), null);
}

async function onLanded(spot: Spot, fish: CaughtFish, auto: boolean): Promise<void> {
  const rec = grantCatch(spot, fish);
  const sp = FISH_BY_ID[fish.speciesId];
  const best = bestRarity(rec.kept);

  if (auto && autoSession) {
    // 自動釣り中は1匹ごとの結果画面を出さず、まとめてリザルトで見せる
    autoSession.catches.push(rec);
    const tags = `${rec.isNew ? ' NEW!' : ''}${rec.kept.length ? ` 🎁×${rec.kept.length}` : ''}`;
    toast(`🎣 ${sp.name} ${fish.size}cm${tags}`);
    if (best === 'legendary') setTimeout(() => toast(`🔥 ${ITEM_RARITY_INFO.legendary.label}ドロップ！`), 700);
    if (rec.levelUps) setTimeout(() => toast(`LEVEL UP! → Lv${state.level}`), 1400);
    await new Promise((r) => setTimeout(r, 1200));
    return;
  }

  const r = FISH_RARITY_INFO[sp.rarity];
  const m = openModal(
    `<div class="result">
      <div class="result-stars" style="color:${r.color}">${'★'.repeat(r.stars)}</div>
      <div class="result-name">${esc(sp.name)}</div>
      <div class="result-size">${fish.size}cm ${rec.isNew ? '<span class="tag new">NEW!</span>' : ''}${rec.isRecord ? '<span class="tag rec">自己ベスト!</span>' : ''}</div>
      <div class="result-rewards">✨ +${rec.xp} XP　🪙 +${rec.coins}${rec.autoSalvaged ? `（バッグ満杯: +${rec.autoSalvaged}）` : ''}</div>
      ${rec.levelUps ? `<div class="result-lvup">LEVEL UP! → Lv${state.level}</div>` : ''}
      ${rec.kept.length ? `<div class="result-drops-title">ドロップ</div><div class="result-drops">${rec.kept.map((i) => itemCardHTML(i)).join('')}</div>` : '<div class="result-nodrop">ドロップなし</div>'}
      <div class="modal-actions"><button class="btn btn-primary act-ok">つづける</button></div>
    </div>`,
    { dismissable: false },
  );
  if (best === 'legendary' || best === 'rare') m.el.classList.add(`glow-${best}`);
  m.el.querySelector('.act-ok')!.addEventListener('click', m.close);
  if (best === 'legendary') toast(`🔥 ${ITEM_RARITY_INFO.legendary.label}ドロップ！`);
  await m.closed;
}

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}分${String(s % 60).padStart(2, '0')}秒`;
}

/** 自動釣りの釣果リザルト */
async function showSessionResult(ses: AutoSession, reason: 'user' | 'empty' | 'exit'): Promise<void> {
  const cs = ses.catches;
  const xp = cs.reduce((a, c) => a + c.xp, 0);
  const coins = cs.reduce((a, c) => a + c.coins + c.autoSalvaged, 0);
  const items = cs.flatMap((c) => c.kept).sort((a, b) => RARITY_RANK[a.rarity] - RARITY_RANK[b.rarity] || b.ilvl - a.ilvl);
  const salvaged = cs.reduce((a, c) => a + c.autoSalvaged, 0);
  const newCount = cs.filter((c) => c.isNew).length;

  // 魚種ごとにまとめる（レア度の高い順）
  const rarityOrder = ['legendary', 'epic', 'rare', 'uncommon', 'common'];
  const bySpecies = new Map<string, { n: number; max: number; isNew: boolean; isRecord: boolean }>();
  for (const c of cs) {
    const e = bySpecies.get(c.fish.speciesId) ?? { n: 0, max: 0, isNew: false, isRecord: false };
    e.n++;
    e.max = Math.max(e.max, c.fish.size);
    e.isNew ||= c.isNew;
    e.isRecord ||= c.isRecord;
    bySpecies.set(c.fish.speciesId, e);
  }
  const fishRows = [...bySpecies.entries()]
    .sort(([a], [b]) => rarityOrder.indexOf(FISH_BY_ID[a].rarity) - rarityOrder.indexOf(FISH_BY_ID[b].rarity))
    .map(([id, e]) => {
      const sp = FISH_BY_ID[id];
      const r = FISH_RARITY_INFO[sp.rarity];
      return `<div class="sr-fish">
        <span class="sr-stars" style="color:${r.color}">${'★'.repeat(r.stars)}</span>
        <span class="sr-name">${esc(sp.name)}</span>
        ${e.isNew ? '<span class="tag new">NEW</span>' : e.isRecord ? '<span class="tag rec">自己ベスト</span>' : ''}
        <span class="sr-count">×${e.n}</span>
        <span class="sr-size">最大 ${e.max}cm</span>
      </div>`;
    })
    .join('');

  // 一番の大物（レア度→サイズ比）
  const top = [...cs].sort((a, b) =>
    rarityOrder.indexOf(FISH_BY_ID[a.fish.speciesId].rarity) - rarityOrder.indexOf(FISH_BY_ID[b.fish.speciesId].rarity) ||
    b.fish.sizeRatio - a.fish.sizeRatio)[0];

  const rarityCounts = (['legendary', 'rare', 'magic', 'normal'] as ItemRarity[])
    .map((r) => [r, items.filter((i) => i.rarity === r).length] as const)
    .filter(([, n]) => n > 0)
    .map(([r, n]) => `<span class="sr-rc" style="color:${ITEM_RARITY_INFO[r].color}">${ITEM_RARITY_INFO[r].label} ${n}</span>`)
    .join('');
  const levelGain = state.level - ses.startLevel;
  const endLabel = { user: 'AUTOを終了しました', empty: 'スポットの魚がいなくなりました', exit: '地図に戻りました' }[reason];
  const best = bestRarity(items);

  const m = openModal(
    `<div class="result session-result">
      <div class="sr-title">自動釣り 釣果リザルト</div>
      <div class="sr-sub">${esc(ses.spot.name)}・${fmtDuration(Date.now() - ses.startAt)}・${endLabel}</div>
      <div class="sr-stats">
        <div><b>${cs.length}</b><span>釣った数</span></div>
        <div><b>${ses.escapes}</b><span>逃した数</span></div>
        <div><b>${newCount}</b><span>新種</span></div>
      </div>
      ${top ? `<div class="sr-top">🏆 いちばんの大物: <b>${esc(FISH_BY_ID[top.fish.speciesId].name)}</b> ${top.fish.size}cm</div>` : ''}
      <div class="result-rewards">✨ +${xp.toLocaleString()} XP　🪙 +${coins.toLocaleString()}${salvaged ? `（バッグ満杯で自動分解 +${salvaged}）` : ''}</div>
      ${levelGain > 0 ? `<div class="result-lvup">LEVEL UP! Lv${ses.startLevel} → Lv${state.level}</div>` : ''}
      ${fishRows ? `<div class="result-drops-title">釣れた魚</div><div class="sr-fish-list">${fishRows}</div>` : ''}
      <div class="result-drops-title">ドロップ ${items.length}個 ${rarityCounts}</div>
      ${items.length ? `<div class="result-drops">${items.map((i) => itemCardHTML(i)).join('')}</div>` : '<div class="result-nodrop">ドロップなし</div>'}
      <div class="modal-actions"><button class="btn btn-primary act-ok">OK</button></div>
    </div>`,
    { dismissable: false },
  );
  if (best === 'legendary' || best === 'rare') m.el.classList.add(`glow-${best}`);
  m.el.querySelector('.act-ok')!.addEventListener('click', m.close);
  await m.closed;
}
