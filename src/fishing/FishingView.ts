import * as THREE from 'three';
import type { Spot } from '../geo';
import type { CaughtFish, Stats } from '../loot';
import { isNight } from '../loot';
import { BIOME_LABEL, FISH_BY_ID } from '../data/fish';
import { createFish, FishObject, worldLength } from './fishModels';

type Phase = 'idle' | 'casting' | 'waiting' | 'bite' | 'fight' | 'landing' | 'result' | 'empty';

export interface FishingCallbacks {
  rollFish(): CaughtFish;
  /** 釣り上げ成功。演出後に呼ばれる。戻り値の Promise 解決で次のキャストへ */
  onLanded(fish: CaughtFish): Promise<void>;
  onEscaped(reason: string): void;
  /** 残りの魚数 */
  stock(): number;
  onExit(): void;
}

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
  private clock = new THREE.Clock();
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
  private progress = 0;
  private slackT = 0;
  private burstT = 0;
  private nextBurst = 0;
  private fishStrength = 1;

  // HUD
  private msg: HTMLElement;
  private sub: HTMLElement;
  private bars: HTMLElement;
  private tensionFill: HTMLElement;
  private progressFill: HTMLElement;
  private stockEl: HTMLElement;

  constructor(spot: Spot, private stats: Stats, private cb: FishingCallbacks) {
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
        </div>
        <div class="fishing-msg-wrap">
          <div class="fishing-msg"></div>
          <div class="fishing-sub"></div>
        </div>
        <div class="fishing-bars hidden">
          <div class="bar-label">テンション</div>
          <div class="bar tension"><div class="fill"></div><div class="danger"></div></div>
          <div class="bar-label">巻き取り</div>
          <div class="bar progress"><div class="fill"></div></div>
        </div>
      </div>`;
    this.msg = this.el.querySelector('.fishing-msg')!;
    this.sub = this.el.querySelector('.fishing-sub')!;
    this.bars = this.el.querySelector('.fishing-bars')!;
    this.tensionFill = this.el.querySelector('.bar.tension .fill')!;
    this.progressFill = this.el.querySelector('.bar.progress .fill')!;
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
      this.onPress();
    });
    const release = () => (this.reeling = false);
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
        this.say('タップでキャスト', '');
        this.bobber.visible = false;
        break;
      case 'casting':
        this.say('', '');
        break;
      case 'waiting':
        this.say('アタリを待て…', 'ウキが沈んだらタップ！');
        break;
      case 'bite':
        this.say('HIT!!', 'いまだ！タップ！');
        try { navigator.vibrate?.(120); } catch { /* noop */ }
        break;
      case 'fight':
        this.say('', '押して巻く／離して緩める');
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
    createFish(sp.id).then((obj) => {
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
    this.progress = 15;
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
    const dt = Math.min(0.05, this.clock.getDelta());
    this.time += dt;
    this.phaseT += dt;
    this.updateWater();

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
        bobPos.set(this.fishPos.x, this.waveAt(this.fishPos.x, this.fishPos.z) - 0.05, this.fishPos.z + 0.3);
        break;
      case 'landing': {
        const k = Math.min(1, this.phaseT / 0.9);
        if (this.fishObj) {
          const target = new THREE.Vector3(0, 2.6, 3.4);
          this.fishObj.root.position.lerpVectors(this.fishPos, target, THREE.MathUtils.smootherstep(k, 0, 1));
          this.fishObj.root.position.y += Math.sin(k * Math.PI) * 1.2;
          this.fishObj.root.rotation.set(0, this.time * 1.5, Math.sin(this.time * 6) * 0.25 * (1 - k));
          // 大物でも画面に収まるよう表示サイズを制限
          this.fishObj.root.scale.setScalar(Math.min(this.fishLen, 2.2));
        }
        this.bobber.visible = false;
        swim = 1.2;
        if (k >= 1 && this.fish) {
          const f = this.fish;
          this.phase = 'result';
          this.cb.onLanded(f).then(() => {
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
      if (this.burstT <= 0) this.say('', '押して巻く／離して緩める');
    }

    const lineFactor = 22 / (22 + strength);
    if (this.reeling) {
      const reel = Math.max(2.5, 9 + power * 0.55 - s * 1.0);
      this.progress += reel * dt * (bursting ? 0.4 : 1);
      this.tension += (7 + s * 4) * lineFactor * (bursting ? 2.4 : 1) * dt;
    } else {
      this.tension -= 34 * dt;
      this.progress -= s * 0.8 * (bursting ? 2.2 : 1) * dt;
    }
    this.tension = THREE.MathUtils.clamp(this.tension, 0, 100);
    this.progress = THREE.MathUtils.clamp(this.progress, 0, 100);

    if (this.tension < 6) this.slackT += dt;
    else this.slackT = 0;

    this.tensionFill.style.width = `${this.tension}%`;
    this.tensionFill.parentElement!.classList.toggle('hot', this.tension > 80);
    this.progressFill.style.width = `${this.progress}%`;

    if (this.slackT > 2.5) this.say('ラインが緩んでいる！', '巻かないとバレる');

    // 魚の位置: 進捗で手前へ、左右に暴れる
    const k = this.progress / 100;
    const sway = (bursting ? 3.5 : 2) * (1 - k * 0.6);
    const target = new THREE.Vector3(
      this.castTarget.x * (1 - k) + Math.sin(this.time * (0.8 + s * 0.05)) * sway,
      -0.6,
      THREE.MathUtils.lerp(this.castTarget.z - 1, 1.5, k),
    );
    this.moveFish(target, dt, bursting ? 9 : 4);
    if (Math.random() < (bursting ? 0.25 : 0.04)) this.splash(this.fishPos, 0.5);

    if (this.tension >= 100) this.escape('break');
    else if (this.slackT > 4) this.escape('slack');
    else if (this.progress >= 100) {
      this.reeling = false;
      this.splash(this.fishPos, 1.5);
      this.setPhase('landing');
    }
    return bursting ? 1.5 : this.reeling ? 0.9 : 0.5;
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
    const visible = this.bobber.visible && this.phase !== 'idle' && this.phase !== 'empty' && this.phase !== 'landing';
    this.line.visible = visible;
    if (!visible) return;
    const a = ROD_TIP;
    const b = this.bobber.position;
    const taut = this.phase === 'fight' ? this.tension / 100 : this.phase === 'casting' ? 1 : 0.2;
    const sag = (1 - taut) * 0.8;
    for (let i = 0; i < pts.count; i++) {
      const t = i / (pts.count - 1);
      pts.setXYZ(i, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t - Math.sin(t * Math.PI) * sag, a.z + (b.z - a.z) * t);
    }
    pts.needsUpdate = true;
  }

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
