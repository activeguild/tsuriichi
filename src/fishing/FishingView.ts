import * as THREE from 'three';
import type { Spot } from '../geo';
import type { CaughtFish, Stats } from '../loot';
import { isNight } from '../loot';
import { BIOME_LABEL, FISH_BY_ID } from '../data/fish';
import { createFish, FishMotion, FishObject, worldLength } from './fishModels';

type Phase = 'idle' | 'casting' | 'waiting' | 'bite' | 'fight' | 'landing' | 'result' | 'empty';

export interface FishingCallbacks {
  rollFish(): CaughtFish;
  /** 釣り上げ成功。演出後に呼ばれる。戻り値の Promise 解決で次のキャストへ */
  onLanded(fish: CaughtFish, auto: boolean): Promise<void>;
  onEscaped(reason: string): void;
  /** 残りの魚数 */
  stock(): number;
  onExit(): void;
  /** 自動釣りの切り替え（設定の保存用） */
  onAutoChange(auto: boolean): void;
}

/** 1秒あたりの巻き取りヒット数 */
const HITS_PER_SEC = 4;

const ENV = {
  river: { water: 0x3f8f8a, sky: 0x9fd3e8, ground: 0x6b8f3a },
  lake: { water: 0x2f6f8f, sky: 0xa8d8f0, ground: 0x5f8a3a },
  pond: { water: 0x4f7f4a, sky: 0xb8e0e8, ground: 0x7a8f3a },
  sea: { water: 0x1f5f9f, sky: 0x8fd0f8, ground: 0xd8c08a },
} as const;

const ROD_TIP = new THREE.Vector3(0.45, 3.1, 2.4);

export class FishingView {
  readonly el: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
  private timer = new THREE.Timer();
  private water: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  private waterBase: Float32Array;
  private bobber = new THREE.Group();
  private line: THREE.Line;
  private rod: THREE.Mesh;
  private ripple: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private resizeObs: ResizeObserver;

  private phase: Phase = 'idle';
  private phaseT = 0;
  private time = 0;
  private reeling = false;

  private fish: CaughtFish | null = null;
  private fishObj: FishObject | null = null;
  private fishLen = 1;
  private fishPos = new THREE.Vector3(0, -0.8, -12);
  private fishHeading = 0;
  private castTarget = new THREE.Vector3(0, 0, -10);
  private biteAt = 0;
  private hookWindow = 0.9;

  // ファイト
  private tension = 0;
  private fishHp = 0;
  private fishMaxHp = 1;
  private hitAcc = 0;
  private fightT = 0;
  private dmgStack = 0;
  private lastHitT = -10;
  private spotLevel: number;

  // 自動釣り
  private auto = false;
  private autoReactAt = 0;
  private dmgLayer: HTMLElement;
  private autoBtn: HTMLButtonElement;
  private hpName: HTMLElement;
  private hpNum: HTMLElement;
  private slackT = 0;
  private burstT = 0;
  private nextBurst = 0;
  private fishStrength = 1;

  // HUD
  private msg: HTMLElement;
  private sub: HTMLElement;
  private bars: HTMLElement;
  private tensionFill: HTMLElement;
  private hpFill: HTMLElement;
  private stockEl: HTMLElement;

  constructor(spot: Spot, private stats: Stats, private cb: FishingCallbacks, opts: { auto?: boolean } = {}) {
    this.spotLevel = spot.level;
    this.el = document.createElement('div');
    this.el.className = 'fishing';
    this.el.innerHTML = `
      <div class="fishing-canvas"></div>
      <div class="fishing-hud">
        <div class="fishing-top">
          <button class="btn-back">← 地図</button>
          <div class="fishing-spot">
            <div class="fishing-spot-name">${BIOME_LABEL[spot.biome]}・${spot.name} <span class="lv">Lv${spot.level}</span></div>
            <div class="fishing-stock"></div>
          </div>
          <button class="btn-auto" aria-pressed="false">AUTO</button>
        </div>
        <div class="dmg-layer"></div>
        <div class="fishing-msg-wrap">
          <div class="fishing-msg"></div>
          <div class="fishing-sub"></div>
        </div>
        <div class="fishing-bars hidden">
          <div class="bar-label">テンション</div>
          <div class="bar tension"><div class="fill"></div><div class="danger"></div></div>
          <div class="bar-label hp-label"><span class="hp-name"></span><span class="hp-num"></span></div>
          <div class="bar hp"><div class="fill"></div></div>
        </div>
      </div>`;
    this.msg = this.el.querySelector('.fishing-msg')!;
    this.sub = this.el.querySelector('.fishing-sub')!;
    this.bars = this.el.querySelector('.fishing-bars')!;
    this.tensionFill = this.el.querySelector('.bar.tension .fill')!;
    this.hpFill = this.el.querySelector('.bar.hp .fill')!;
    this.hpName = this.el.querySelector('.hp-name')!;
    this.hpNum = this.el.querySelector('.hp-num')!;
    this.dmgLayer = this.el.querySelector('.dmg-layer')!;
    this.autoBtn = this.el.querySelector('.btn-auto')!;
    this.autoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setAuto(!this.auto);
      this.cb.onAutoChange(this.auto);
    });
    this.stockEl = this.el.querySelector('.fishing-stock')!;
    this.el.querySelector('.btn-back')!.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.phase === 'fight' && !confirm('ファイト中です。魚を逃がして戻りますか？')) return;
      this.cb.onExit();
    });

    const canvasWrap = this.el.querySelector('.fishing-canvas') as HTMLElement;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    canvasWrap.appendChild(this.renderer.domElement);

    // 入力（HUD全体で受ける）
    const hud = this.el.querySelector('.fishing-hud') as HTMLElement;
    hud.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      e.preventDefault();
      if (this.auto) return; // 自動釣り中はタップを使わない
      this.onPress();
    });
    const release = () => {
      if (!this.auto) this.reeling = false;
    };
    hud.addEventListener('pointerup', release);
    hud.addEventListener('pointercancel', release);
    hud.addEventListener('pointerleave', release);

    // 環境
    const night = isNight();
    const env = ENV[spot.biome];
    const sky = new THREE.Color(night ? 0x0b1530 : env.sky);
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, 25, 90);
    const hemi = new THREE.HemisphereLight(night ? 0x5070b0 : 0xffffff, night ? 0x203040 : 0x445533, night ? 1.0 : 1.1);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(night ? 0x9fb8ff : 0xfff2dd, night ? 0.8 : 1.6);
    sun.position.set(-5, 10, -6);
    this.scene.add(sun);
    // 正面からのフィルライト（釣り上げた魚の見栄え用）
    const fill = new THREE.DirectionalLight(0xffffff, 0.9);
    fill.position.set(1, 3, 8);
    this.scene.add(fill);

    // 水面
    const wg = new THREE.PlaneGeometry(220, 220, 70, 70);
    wg.rotateX(-Math.PI / 2);
    this.waterBase = Float32Array.from(wg.attributes.position.array as Float32Array);
    this.water = new THREE.Mesh(
      wg,
      new THREE.MeshStandardMaterial({
        color: night ? new THREE.Color(env.water).multiplyScalar(0.45) : env.water,
        roughness: 0.15,
        metalness: 0.35,
        transparent: true,
        opacity: 0.78,
        flatShading: true,
        depthWrite: false,
      }),
    );
    this.water.position.z = -90;
    this.scene.add(this.water);

    // 水底（魚の背景を暗くして見やすく）
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(220, 220),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(env.water).multiplyScalar(night ? 0.15 : 0.35) }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -4, -90);
    this.scene.add(floor);

    // 岸
    const shore = new THREE.Mesh(
      new THREE.BoxGeometry(60, 1, 12),
      new THREE.MeshStandardMaterial({ color: night ? new THREE.Color(env.ground).multiplyScalar(0.4) : env.ground, roughness: 1 }),
    );
    shore.position.set(0, -0.35, 8.5);
    this.scene.add(shore);

    // 遠景
    if (spot.biome !== 'sea') {
      const hillMat = new THREE.MeshStandardMaterial({ color: night ? 0x1a2a2a : 0x4f7a4f, flatShading: true, roughness: 1 });
      for (let i = 0; i < 14; i++) {
        const h = 6 + Math.random() * 14;
        const hill = new THREE.Mesh(new THREE.ConeGeometry(6 + Math.random() * 8, h, 6), hillMat);
        hill.position.set(-70 + i * 11 + Math.random() * 4, h / 2 - 1, -75 - Math.random() * 10);
        this.scene.add(hill);
      }
    }
    if (night) {
      const moon = new THREE.Mesh(new THREE.SphereGeometry(3, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff6d0, fog: false }));
      moon.position.set(25, 30, -85);
      this.scene.add(moon);
    }

    // ロッド
    const rodBase = new THREE.Vector3(1.1, 1.0, 5.4);
    const rodDir = ROD_TIP.clone().sub(rodBase);
    this.rod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.045, rodDir.length(), 8),
      new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.4, metalness: 0.5 }),
    );
    this.rod.position.copy(rodBase).addScaledVector(rodDir, 0.5);
    this.rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), rodDir.clone().normalize());
    this.scene.add(this.rod);

    // ウキ
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xff3b30, roughness: 0.4 }));
    const bottom = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }));
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.25), new THREE.MeshStandardMaterial({ color: 0xffd60a }));
    stick.position.y = 0.2;
    this.bobber.add(top, bottom, stick);
    this.bobber.visible = false;
    this.scene.add(this.bobber);

    // 波紋
    this.ripple = new THREE.Mesh(
      new THREE.RingGeometry(0.2, 0.28, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.ripple.rotation.x = -Math.PI / 2;
    this.scene.add(this.ripple);

    // 釣り糸
    const lg = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 16 }, () => new THREE.Vector3()));
    this.line = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }));
    this.line.frustumCulled = false;
    this.scene.add(this.line);

    this.camera.position.set(0, 3.2, 7.2);
    this.camera.lookAt(0, 0.2, -6);

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(canvasWrap);
    this.resize();

    this.hookWindow = 0.9 * (1 + stats.hookWindow / 100);
    this.setPhase(cb.stock() > 0 ? 'idle' : 'empty');
    this.setAuto(!!opts.auto);
    this.renderer.setAnimationLoop(() => this.tick());
  }

  destroy() {
    this.renderer.setAnimationLoop(null);
    this.resizeObs.disconnect();
    this.fishObj?.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh || (o as THREE.Line).isLine) {
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach((mm) => mm?.dispose());
      }
    });
    this.renderer.dispose();
    this.timer.dispose();
    this.el.remove();
  }

  private resize() {
    const wrap = this.renderer.domElement.parentElement!;
    const w = wrap.clientWidth || window.innerWidth;
    const h = wrap.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // 縦長画面では視野を広げる
    this.camera.fov = w / h < 0.8 ? 68 : 55;
    this.camera.updateProjectionMatrix();
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.phaseT = 0;
    this.bars.classList.toggle('hidden', p !== 'fight');
    this.el.dataset.phase = p;
    const stock = this.cb.stock();
    this.stockEl.textContent = `残り ${'🐟'.repeat(stock)}${'・'.repeat(Math.max(0, 5 - stock))}`;
    switch (p) {
      case 'idle':
        this.say(this.auto ? '' : 'タップでキャスト', '');
        this.bobber.visible = false;
        break;
      case 'casting':
        this.say('', '');
        break;
      case 'waiting':
        this.say('アタリを待て…', this.auto ? '' : 'ウキが沈んだらタップ！');
        break;
      case 'bite':
        this.say('HIT!!', this.auto ? '' : 'いまだ！タップ！');
        this.autoReactAt = Math.min(this.hookWindow * 0.8, 0.2 + Math.random() * 0.3);
        try { navigator.vibrate?.(120); } catch { /* noop */ }
        break;
      case 'fight':
        this.say('', this.fightHint());
        break;
      case 'landing':
        this.say('釣り上げた！', '');
        try { navigator.vibrate?.([60, 40, 60]); } catch { /* noop */ }
        break;
      case 'result':
        this.say('', '');
        break;
      case 'empty':
        this.say('魚がいないようだ…', 'しばらくすると戻ってくる。別のスポットを探そう');
        break;
    }
  }

  private fightHint(): string {
    return this.auto ? '' : '押して巻く／離して緩める';
  }

  private setAuto(v: boolean) {
    this.auto = v;
    this.autoBtn.classList.toggle('on', v);
    this.autoBtn.setAttribute('aria-pressed', String(v));
    this.autoBtn.textContent = v ? 'AUTO ON' : 'AUTO';
    this.el.classList.toggle('auto', v);
    if (!v) this.reeling = false;
    if (this.phase === 'idle' || this.phase === 'fight') this.setPhase(this.phase);
  }

  /** 自動釣り: キャスト・アワセ・テンション管理を代わりに行う */
  private updateAuto() {
    if (!this.auto) return;
    switch (this.phase) {
      case 'idle':
        if (this.phaseT > 0.8) this.cast();
        break;
      case 'bite':
        if (this.phaseT >= this.autoReactAt) this.startFight();
        break;
      case 'fight': {
        // 暴れている間は早めに緩める（ヒステリシス付き）
        const high = this.burstT > 0 ? 62 : 80;
        if (this.reeling && this.tension > high) this.reeling = false;
        else if (!this.reeling && this.tension < 42) this.reeling = true;
        break;
      }
    }
  }

  private say(main: string, sub: string) {
    this.msg.textContent = main;
    this.sub.textContent = sub;
  }

  private onPress() {
    switch (this.phase) {
      case 'idle':
        this.cast();
        break;
      case 'waiting':
        // 早アワセ: 何もかかっていない
        this.say('早すぎた！', 'ウキが沈むまで待とう');
        this.resetToIdle(0.8);
        break;
      case 'bite':
        this.startFight();
        break;
      case 'fight':
        this.reeling = true;
        break;
      case 'empty':
        if (this.cb.stock() > 0) this.setPhase('idle');
        break;
    }
  }

  private cast() {
    this.fish = this.cb.rollFish();
    const sp = FISH_BY_ID[this.fish.speciesId];
    this.fishLen = worldLength(this.fish.size);
    this.castTarget.set((Math.random() - 0.5) * 4, 0, -8 - Math.random() * 5);
    this.biteAt = (2 + Math.random() * 5) * Math.max(0.3, 1 - this.stats.biteSpeed / 100);
    // 引きの強さ: 種の強さ×サイズ
    this.fishStrength = sp.strength * (0.7 + 0.6 * this.fish.sizeRatio);

    // モデルを先読み
    this.fishObj?.dispose();
    if (this.fishObj) this.scene.remove(this.fishObj.root);
    this.fishObj = null;
    const myFish = this.fish;
    createFish(sp.id, this.fish.size).then((obj) => {
      if (this.fish !== myFish) {
        obj.dispose();
        return;
      }
      this.fishObj = obj;
      obj.root.scale.setScalar(this.fishLen);
      obj.root.visible = false;
      this.scene.add(obj.root);
    });

    this.bobber.visible = true;
    this.setPhase('casting');
  }

  private startFight() {
    this.tension = 30;
    const sizeK = 0.7 + (this.fish?.sizeRatio ?? 0.5) * 0.6;
    this.fishMaxHp = Math.round((600 + this.fishStrength * 300) * sizeK * (1 + this.spotLevel * 0.06));
    this.fishHp = this.fishMaxHp;
    this.hitAcc = 0;
    this.fightT = 0;
    this.dmgStack = 0;
    this.hpName.textContent = this.fish ? FISH_BY_ID[this.fish.speciesId].name : '';
    this.slackT = 0;
    this.burstT = 0;
    this.nextBurst = 1 + Math.random() * 2;
    this.reeling = true;
    this.fishPos.set(this.castTarget.x, -0.7, this.castTarget.z - 1);
    this.setPhase('fight');
  }

  private resetToIdle(delay: number) {
    const p = this.phase;
    setTimeout(() => {
      if (this.phase !== p) return;
      if (this.fishObj) this.fishObj.root.visible = false;
      this.setPhase(this.cb.stock() > 0 ? 'idle' : 'empty');
    }, delay * 1000);
    this.phase = 'result';
    this.bobber.visible = false;
  }

  private escape(reason: string) {
    this.say(reason === 'break' ? 'ラインが切れた！' : 'バレた…', reason === 'break' ? 'テンションに注意' : '緩めすぎると逃げられる');
    this.bars.classList.add('hidden');
    try { navigator.vibrate?.(300); } catch { /* noop */ }
    this.cb.onEscaped(reason);
    this.resetToIdle(1.6);
  }

  private tick() {
    this.timer.update();
    const dt = Math.min(0.05, this.timer.getDelta());
    this.time += dt;
    this.phaseT += dt;
    this.updateWater();
    this.updateAuto();

    const bobPos = this.bobber.position;
    let swim = 0.3;

    switch (this.phase) {
      case 'casting': {
        const k = Math.min(1, this.phaseT / 0.8);
        bobPos.lerpVectors(ROD_TIP, this.castTarget, k);
        bobPos.y = THREE.MathUtils.lerp(ROD_TIP.y, 0, k) + Math.sin(k * Math.PI) * 3;
        if (k >= 1) {
          this.splash(this.castTarget);
          this.setPhase('waiting');
        }
        break;
      }
      case 'waiting': {
        bobPos.copy(this.castTarget);
        bobPos.y = this.waveAt(bobPos.x, bobPos.z) + Math.sin(this.time * 2) * 0.02;
        // 終盤は魚影が寄ってくる
        const remain = this.biteAt - this.phaseT;
        if (this.fishObj && remain < 2.5) {
          this.fishObj.root.visible = true;
          const a = this.time * 1.2;
          const r = 0.6 + remain * 1.2;
          const target = new THREE.Vector3(this.castTarget.x + Math.cos(a) * r, -1.0, this.castTarget.z + Math.sin(a) * r);
          this.motion('turn');
          this.moveFish(target, dt, 3);
        }
        if (remain < 0.6 && Math.random() < 0.08) bobPos.y -= 0.05; // チョンチョン
        if (this.phaseT >= this.biteAt) {
          this.splash(bobPos);
          this.setPhase('bite');
        }
        break;
      }
      case 'bite': {
        bobPos.y = -0.25 + Math.sin(this.time * 30) * 0.05;
        if (this.fishObj) {
          this.fishObj.root.visible = true;
          this.motion('bite');
          this.moveFish(new THREE.Vector3(bobPos.x, -0.6, bobPos.z), dt, 6);
        }
        swim = 1;
        if (this.phaseT > this.hookWindow) {
          this.say('逃げられた…', 'HIT!の瞬間にタップ');
          this.cb.onEscaped('miss');
          this.resetToIdle(1.4);
        }
        break;
      }
      case 'fight':
        swim = this.updateFight(dt);
        this.bobber.visible = !this.fishObj; // 糸は魚の口につながるのでウキは隠す（モデル読込前は表示）
        bobPos.set(this.fishPos.x, this.waveAt(this.fishPos.x, this.fishPos.z) - 0.05, this.fishPos.z + 0.3);
        break;
      case 'landing': {
        const k = Math.min(1, this.phaseT / 0.9);
        if (this.fishObj) {
          this.motion('air');
          const target = new THREE.Vector3(0, 2.7, 4.6);
          this.fishObj.root.position.lerpVectors(this.fishPos, target, THREE.MathUtils.smootherstep(k, 0, 1));
          this.fishObj.root.position.y += Math.sin(k * Math.PI) * 1.2;
          this.fishObj.root.rotation.set(0, this.time * 1.5, 0);
          // 大物でも画面に収まるよう表示サイズを制限
          this.fishObj.root.scale.setScalar(Math.min(Math.max(this.fishLen * 1.2, 0.9), 2.0));
        }
        this.bobber.visible = false;
        swim = 1.2;
        if (k >= 1 && this.fish) {
          const f = this.fish;
          this.phase = 'result';
          this.cb.onLanded(f, this.auto).then(() => {
            if (this.fishObj) this.fishObj.root.visible = false;
            this.fish = null;
            this.setPhase(this.cb.stock() > 0 ? 'idle' : 'empty');
          });
        }
        break;
      }
      case 'result':
        if (this.fishObj && this.fishObj.root.visible && this.fish) {
          this.fishObj.root.rotation.y += dt * 0.8;
        }
        break;
    }

    this.fishObj?.update(dt, swim);
    this.updateLine();
    this.updateRipple(dt);

    // ファイト中のカメラ揺れ
    const shake = this.phase === 'fight' ? this.tension / 100 * (this.burstT > 0 ? 0.08 : 0.025) : 0;
    this.camera.position.set((Math.random() - 0.5) * shake, 3.2 + (Math.random() - 0.5) * shake, 7.2);
    this.rod.rotation.z = this.phase === 'fight' ? Math.sin(this.time * 20) * 0.01 * (this.tension / 50) : 0;

    this.renderer.render(this.scene, this.camera);
  }

  private updateFight(dt: number): number {
    const s = this.fishStrength;
    const power = this.stats.power;
    const strength = this.stats.lineStrength;

    // 暴れ（バースト）
    this.nextBurst -= dt;
    if (this.nextBurst <= 0) {
      this.burstT = 0.9;
      this.nextBurst = 1.5 + Math.random() * 2.5 - Math.min(1, s * 0.08);
      this.say('暴れている！', '');
    }
    const bursting = this.burstT > 0;
    if (bursting) {
      this.burstT -= dt;
      if (this.burstT <= 0) this.say('', this.fightHint());
    }

    this.fightT += dt;
    const lineFactor = 22 / (22 + strength);
    if (this.reeling) {
      // 巻くたびにヒット。パワーでダメージ、会心率で2倍
      this.hitAcc += dt * HITS_PER_SEC;
      while (this.hitAcc >= 1) {
        this.hitAcc -= 1;
        const crit = Math.random() * 100 < this.stats.crit;
        const dmg = Math.max(1, Math.round(power * 10 * (0.85 + Math.random() * 0.3) * (crit ? 2 : 1) * (bursting ? 0.4 : 1)));
        this.fishHp -= dmg;
        this.spawnDamage(dmg, crit);
      }
      this.tension += (7 + s * 4) * lineFactor * (bursting ? 2.4 : 1) * dt;
    } else {
      this.tension -= 34 * dt;
      // 緩めている間、魚は体力を回復する。長引くほど魚が疲れて回復しにくくなる（膠着しないように）
      const stamina = Math.max(0.15, 1 - this.fightT / 40);
      this.fishHp += this.fishMaxHp * s * 0.008 * (bursting ? 2.2 : 1) * stamina * dt;
    }
    this.tension = THREE.MathUtils.clamp(this.tension, 0, 100);
    this.fishHp = THREE.MathUtils.clamp(this.fishHp, 0, this.fishMaxHp);

    if (this.tension < 6) this.slackT += dt;
    else this.slackT = 0;

    this.tensionFill.style.width = `${this.tension}%`;
    this.tensionFill.parentElement!.classList.toggle('hot', this.tension > 80);
    this.hpFill.style.width = `${(this.fishHp / this.fishMaxHp) * 100}%`;
    this.hpNum.textContent = `${Math.ceil(this.fishHp).toLocaleString()} / ${this.fishMaxHp.toLocaleString()}`;

    if (this.slackT > 2.5) this.say('ラインが緩んでいる！', '巻かないとバレる');

    // 魚の位置: 進捗で手前へ、左右に暴れる
    const k = 1 - this.fishHp / this.fishMaxHp;
    const sway = (bursting ? 3.5 : 2) * (1 - k * 0.6);
    const target = new THREE.Vector3(
      this.castTarget.x * (1 - k) + Math.sin(this.time * (0.8 + s * 0.05)) * sway,
      -0.4,
      THREE.MathUtils.lerp(this.castTarget.z - 1, 1.5, k),
    );
    // 終盤（巻き取り75%〜）で暴れていなければ弱って横倒しになる
    this.motion(!bursting && k > 0.75 ? 'tired' : 'hooked');
    this.moveFish(target, dt, bursting ? 9 : 4);
    if (Math.random() < (bursting ? 0.25 : 0.04)) this.splash(this.fishPos, 0.5);

    if (this.tension >= 100) this.escape('break');
    else if (this.slackT > 4) this.escape('slack');
    else if (this.fishHp <= 0) {
      this.reeling = false;
      this.splash(this.fishPos, 1.5);
      this.setPhase('landing');
    }
    return bursting ? 1.5 : this.reeling ? 0.9 : 0.5;
  }

  /** ダメージ数字を魚の上に積み上げて表示する */
  private spawnDamage(value: number, crit: boolean) {
    const p = (this.fishObj?.root.position ?? this.fishPos).clone();
    p.y += 0.5;
    p.project(this.camera);
    const rect = this.dmgLayer.getBoundingClientRect();
    if (p.z > 1) return;
    if (this.time - this.lastHitT > 0.8) this.dmgStack = 0;
    this.lastHitT = this.time;
    const x = ((p.x + 1) / 2) * rect.width + (Math.random() - 0.5) * 24;
    const y = ((1 - p.y) / 2) * rect.height;
    const el = document.createElement('div');
    el.className = crit ? 'dmg crit' : 'dmg';
    el.textContent = String(value);
    // 新しいヒットほど上に積む
    el.style.left = `${x}px`;
    el.style.top = `${Math.max(60, y - this.dmgStack * (crit ? 40 : 34))}px`;
    this.dmgStack = (this.dmgStack + 1) % 10;
    this.dmgLayer.appendChild(el);
    setTimeout(() => el.remove(), 1300);
    if (crit) this.splash(this.fishPos, 0.8);
  }

  private motion(m: FishMotion) {
    this.fishObj?.setMotion(m);
  }

  private moveFish(target: THREE.Vector3, dt: number, speed: number) {
    if (!this.fishObj) return;
    const prev = this.fishPos.clone();
    this.fishPos.lerp(target, Math.min(1, dt * speed * 0.5));
    const v = this.fishPos.clone().sub(prev);
    if (v.lengthSq() > 1e-6) {
      const want = Math.atan2(-v.z, v.x);
      let d = want - this.fishHeading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.fishHeading += d * Math.min(1, dt * 6);
    }
    const r = this.fishObj.root;
    r.visible = true;
    r.position.copy(this.fishPos);
    r.rotation.set(0, this.fishHeading, 0);
    r.scale.setScalar(this.fishLen);
  }

  private waveAt(x: number, z: number): number {
    const t = this.time;
    return Math.sin(x * 0.35 + t * 1.1) * 0.08 + Math.cos(z * 0.45 + t * 1.4) * 0.06;
  }

  private updateWater() {
    const pos = this.water.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const oz = this.water.position.z;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i + 1] = this.waveAt(this.waterBase[i], this.waterBase[i + 2] + oz);
    }
    pos.needsUpdate = true;
    this.water.geometry.computeVertexNormals();
  }

  private updateLine() {
    const pts = this.line.geometry.attributes.position as THREE.BufferAttribute;
    // ファイト中と抜き上げ中は魚の口に糸をつなぐ
    const toMouth = (this.phase === 'fight' || this.phase === 'landing') && !!this.fishObj;
    const visible = toMouth || (this.bobber.visible && this.phase !== 'idle' && this.phase !== 'empty');
    this.line.visible = visible;
    if (!visible) return;
    const a = ROD_TIP;
    const b = toMouth ? this.fishObj!.mouthWorld(this.mouthTmp) : this.bobber.position;
    const taut = this.phase === 'fight' ? this.tension / 100 : this.phase === 'casting' || this.phase === 'landing' ? 1 : 0.2;
    const sag = (1 - taut) * 0.8;
    for (let i = 0; i < pts.count; i++) {
      const t = i / (pts.count - 1);
      pts.setXYZ(i, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t - Math.sin(t * Math.PI) * sag, a.z + (b.z - a.z) * t);
    }
    pts.needsUpdate = true;
  }

  private mouthTmp = new THREE.Vector3();
  private rippleLife = 0;
  private splash(p: THREE.Vector3, size = 1) {
    this.ripple.position.set(p.x, 0.05, p.z);
    this.rippleLife = 1;
    this.ripple.userData.size = size;
  }

  private updateRipple(dt: number) {
    if (this.rippleLife <= 0) {
      this.ripple.material.opacity = 0;
      return;
    }
    this.rippleLife -= dt * 1.2;
    const s = (1 + (1 - this.rippleLife) * 6) * (this.ripple.userData.size ?? 1);
    this.ripple.scale.setScalar(s);
    this.ripple.material.opacity = Math.max(0, this.rippleLife) * 0.8;
  }
}
