/**
 * マップ自動釣り。
 * ONの間、釣り場の範囲（60m）に入っていれば、一定間隔で自動的に釣りを行う。
 * 3Dの釣り画面は開かず、アタリ待ち → ファイト（戦闘力と魚のHPで所要時間と成功率を決める）→ 結果 をくり返す。
 */
import { FISH_BY_ID } from './data/fish';
import { combatPower, fishMaxHp } from './balance';
import type { Spot } from './geo';
import type { CaughtFish, Stats } from './loot';

export interface MapAutoStatus {
  on: boolean;
  /** 状態の短い説明 */
  text: string;
  /** 0〜1 の進み具合（アタリ待ち・ファイトの残り） */
  progress: number;
  phase: 'search' | 'wait' | 'fight' | 'cool' | 'paused' | 'off';
  spotId: string | null;
  /** 制限時間の残り（秒） */
  remaining: number;
}

export interface MapAutoDeps {
  /** いま釣れるスポット（範囲内・魚が残っている）を近い順に */
  candidates(): Spot[];
  stats(): Stats;
  rollFish(spot: Spot): CaughtFish;
  onCatch(spot: Spot, fish: CaughtFish): void;
  onEscape(spot: Spot, fish: CaughtFish, reason: 'fail' | 'left'): void;
  onStatus(st: MapAutoStatus): void;
  /** 制限時間になった（自動で止まる） */
  onTimeUp(): void;
}

/** 1サイクルのあとの休み(秒) */
const COOL_SEC = 2.5;
/** 巻いている時間の割合（緩める時間を含めたファイト時間の換算） */
const REEL_SHARE = 0.55;

export class MapAutoFisher {
  private timer = 0;
  private last = 0;
  private on = false;
  private paused = false;
  private phase: MapAutoStatus['phase'] = 'off';
  private t = 0;
  private dur = 1;
  private spot: Spot | null = null;
  private fish: CaughtFish | null = null;
  private success = false;
  /** 残り時間（秒）。一時停止中は減らない */
  private remaining = 0;

  constructor(private deps: MapAutoDeps) {}

  get running(): boolean {
    return this.on;
  }

  /** limitSec 秒たつと自動で止まる */
  start(limitSec: number) {
    if (this.on) return;
    this.on = true;
    this.remaining = limitSec;
    this.phase = 'search';
    this.last = performance.now();
    this.timer = window.setInterval(() => this.tick(), 250);
    this.tick();
  }

  stop() {
    this.on = false;
    clearInterval(this.timer);
    this.phase = 'off';
    this.spot = null;
    this.fish = null;
    this.emit('', 0);
  }

  /** 3Dの釣り画面を開いている間などは止める */
  setPaused(p: boolean) {
    this.paused = p;
  }

  private inRange(spot: Spot): boolean {
    return this.deps.candidates().some((s) => s.id === spot.id);
  }

  private emit(text: string, progress: number) {
    this.deps.onStatus({
      on: this.on,
      text,
      progress: Math.max(0, Math.min(1, progress)),
      phase: this.paused && this.on ? 'paused' : this.phase,
      spotId: this.spot?.id ?? null,
      remaining: Math.max(0, this.remaining),
    });
  }

  private tick() {
    const now = performance.now();
    const dt = (now - this.last) / 1000;
    this.last = now;
    if (!this.on) return;
    if (this.paused) {
      this.emit('一時停止中', 0);
      return;
    }
    this.t += dt;
    this.remaining -= dt;
    if (this.remaining <= 0) {
      // ファイト中なら決着を待たずに打ち切り（その魚は逃がさない扱い：魚は減らない）
      this.stop();
      this.deps.onTimeUp();
      return;
    }

    switch (this.phase) {
      case 'search': {
        const spot = this.deps.candidates()[0];
        if (!spot) {
          this.spot = null;
          this.emit('釣り場の範囲に入ると自動で釣ります', 0);
          return;
        }
        this.spot = spot;
        this.fish = this.deps.rollFish(spot);
        const st = this.deps.stats();
        this.dur = (5 + Math.random() * 7) * Math.max(0.3, 1 - st.biteSpeed / 100);
        this.t = 0;
        this.phase = 'wait';
        this.emit(`${spot.name} Lv${spot.level}：アタリ待ち…`, 0);
        return;
      }
      case 'wait': {
        const spot = this.spot!;
        if (!this.inRange(spot)) {
          // 食いつく前に離れたらやり直し（ペナルティなし）
          this.phase = 'search';
          this.emit('釣り場から離れた', 0);
          return;
        }
        if (this.t >= this.dur) this.startFight();
        else this.emit(`${spot.name} Lv${spot.level}：アタリ待ち…`, this.t / this.dur);
        return;
      }
      case 'fight': {
        const spot = this.spot!;
        const sp = FISH_BY_ID[this.fish!.speciesId];
        if (!this.inRange(spot)) {
          this.deps.onEscape(spot, this.fish!, 'left');
          this.cool();
          return;
        }
        if (this.t >= this.dur) {
          if (this.success) this.deps.onCatch(spot, this.fish!);
          else this.deps.onEscape(spot, this.fish!, 'fail');
          this.cool();
        } else this.emit(`ファイト中！ ${sp.name}`, this.t / this.dur);
        return;
      }
      case 'cool':
        if (this.t >= COOL_SEC) this.phase = 'search';
        this.emit('次の釣りの準備中…', this.t / COOL_SEC);
        return;
    }
  }

  /** 戦闘力と魚のHPから、ファイトの長さと成否を決める */
  private startFight() {
    const spot = this.spot!;
    const fish = this.fish!;
    const sp = FISH_BY_ID[fish.speciesId];
    const hp = fishMaxHp(sp.strength, fish.sizeRatio, spot.level);
    const cp = Math.max(1, combatPower(this.deps.stats()));
    const reelSec = hp / cp; // 巻き続けたときに倒すまでの秒数
    const p = Math.max(0.1, Math.min(0.97, 1.05 - reelSec / 40));
    this.success = Math.random() < p;
    const fightSec = Math.max(3, Math.min(45, reelSec / REEL_SHARE));
    // 失敗はファイトの途中でバレる
    this.dur = this.success ? fightSec : fightSec * (0.3 + Math.random() * 0.6);
    this.t = 0;
    this.phase = 'fight';
    this.emit(`ファイト中！ ${sp.name}`, 0);
  }

  private cool() {
    this.phase = 'cool';
    this.t = 0;
    this.fish = null;
  }
}
