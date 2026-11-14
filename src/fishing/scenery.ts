/**
 * 釣り画面の景色（空・雲・太陽/月・星・水面のきらめき・岸と遠景・生き物）。
 * 釣り場の種類（海・湖・川・池）と昼夜・夕方で見た目を変える。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Biome } from '../data/fish';

export interface Scenery {
  /** 水面の色 */
  waterColor: THREE.Color;
  update(dt: number, time: number): void;
  dispose(): void;
}

type TimeOfDay = 'day' | 'dusk' | 'night';

function timeOfDay(d = new Date()): TimeOfDay {
  const h = d.getHours();
  if (h < 5 || h >= 18) return 'night';
  if (h < 7 || h >= 16) return 'dusk';
  return 'day';
}

const SKY: Record<TimeOfDay, { top: number; horizon: number; sun: number; light: number; hemiSky: number; hemiGround: number }> = {
  day: { top: 0x3f8fe0, horizon: 0xc8e8ff, sun: 0xfff6d8, light: 0xfff2dd, hemiSky: 0xdfefff, hemiGround: 0x4a5a3a },
  dusk: { top: 0x3a4f8f, horizon: 0xffa86b, sun: 0xffc27a, light: 0xffb37a, hemiSky: 0xffd0b0, hemiGround: 0x3a2a3a },
  night: { top: 0x050b1e, horizon: 0x1c2b52, sun: 0xfff4c8, light: 0x9fb8ff, hemiSky: 0x5070b0, hemiGround: 0x101828 },
};

const WATER: Record<Biome, number> = {
  sea: 0x1d5f9a,
  lake: 0x2a6a86,
  river: 0x3a8a84,
  pond: 0x3f6f48,
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** マテリアルを使い回す（色ごと） */
function makeMats(dark: number) {
  const cache = new Map<string, THREE.Material>();
  return (color: number, opts: { flat?: boolean; emissive?: number; rough?: number } = {}) => {
    const key = `${color}-${opts.flat}-${opts.emissive}-${opts.rough}`;
    let m = cache.get(key);
    if (!m) {
      const c = new THREE.Color(color).multiplyScalar(dark);
      m = new THREE.MeshLambertMaterial({
        color: c,
        flatShading: opts.flat ?? true,
        emissive: opts.emissive ?? 0x000000,
      });
      cache.set(key, m);
    }
    return m;
  };
}

export function buildScenery(scene: THREE.Scene, biome: Biome, night: boolean): Scenery {
  const tod: TimeOfDay = night ? 'night' : timeOfDay();
  const pal = SKY[tod];
  const dark = tod === 'night' ? 0.35 : tod === 'dusk' ? 0.75 : 1;
  const mat = makeMats(dark);
  const updaters: ((dt: number, t: number) => void)[] = [];
  const root = new THREE.Group();
  scene.add(root);

  // ---- 空（グラデーションのドーム） ----
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(pal.top) },
      horizon: { value: new THREE.Color(pal.horizon) },
    },
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; varying vec3 vP;
      void main(){ float h = clamp(vP.y, 0.0, 1.0); vec3 c = mix(horizon, top, pow(h, 0.55)); gl_FragColor = vec4(c, 1.0); }`,
  });
  const skyDome = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), skyMat);
  skyDome.renderOrder = -10;
  root.add(skyDome);
  scene.background = new THREE.Color(pal.horizon);
  const fogNear = biome === 'pond' ? 30 : biome === 'river' ? 40 : 60;
  scene.fog = new THREE.Fog(pal.horizon, fogNear, biome === 'sea' ? 260 : 180);

  // 空の映り込みは環境マップを使わず（スマホで重い）、水の色を地平線の色に寄せて表現する

  // ---- 光 ----
  // 太陽（月）は低めの左奥。水面にきらめきの道ができる
  // 縦長の画面でも見えるよう、正面やや左の低い位置に置く
  const sunDir = new THREE.Vector3(-0.16, tod === 'day' ? 0.2 : 0.12, -0.98).normalize();
  const hemi = new THREE.HemisphereLight(pal.hemiSky, pal.hemiGround, night ? 0.9 : 1.0);
  root.add(hemi);
  const sun = new THREE.DirectionalLight(pal.light, night ? 0.7 : tod === 'dusk' ? 1.4 : 1.7);
  sun.position.copy(sunDir).multiplyScalar(50);
  root.add(sun);
  const fill = new THREE.DirectionalLight(0xffffff, night ? 0.6 : 0.8); // 手前からのライト（釣り上げた魚の見栄え用）
  fill.position.set(1, 3, 8);
  root.add(fill);

  // 太陽・月の円盤と光の輪
  const discPos = sunDir.clone().multiplyScalar(280);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(night ? 7 : 10, 32),
    new THREE.MeshBasicMaterial({ color: pal.sun, fog: false }),
  );
  disc.position.copy(discPos);
  disc.lookAt(0, 0, 0);
  root.add(disc);
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(night ? 16 : 22, 32),
    new THREE.MeshBasicMaterial({ color: pal.sun, transparent: true, opacity: night ? 0.1 : 0.16, fog: false, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  glow.position.copy(discPos).multiplyScalar(0.99);
  glow.lookAt(0, 0, 0);
  root.add(glow);

  // ---- 星 ----
  if (tod !== 'day') {
    const n = tod === 'night' ? 700 : 120;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(rand(-1, 1), rand(0.08, 1), rand(-1, 1)).normalize().multiplyScalar(290);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: tod === 'night' ? 0.9 : 0.35, fog: false, depthWrite: false }));
    root.add(stars);
    updaters.push((_dt, t) => ((stars.material as THREE.PointsMaterial).opacity = (tod === 'night' ? 0.75 : 0.3) + Math.sin(t * 2) * 0.12));
  }

  // ---- 雲 ----
  const cloudColor = tod === 'night' ? 0x2a3550 : tod === 'dusk' ? 0xffd8c0 : 0xffffff;
  const cloudMat = new THREE.MeshLambertMaterial({
    color: cloudColor,
    // 逆光でも白く見えるよう自己発光を足す
    emissive: new THREE.Color(cloudColor).multiplyScalar(tod === 'night' ? 0.25 : 0.6),
    flatShading: true,
    transparent: true,
    opacity: tod === 'night' ? 0.55 : 0.92,
    fog: false,
  });
  const clouds: THREE.Group[] = [];
  for (let i = 0; i < 9; i++) {
    const c = new THREE.Group();
    const parts = 4 + Math.floor(Math.random() * 4);
    for (let j = 0; j < parts; j++) {
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(5, 9), 1), cloudMat);
      puff.position.set(j * rand(5, 7) - parts * 3, rand(-1, 2), rand(-3, 3));
      puff.scale.y = 0.55;
      c.add(puff);
    }
    c.position.set(rand(-200, 200), rand(45, 80), rand(-230, -120));
    c.userData.dynamic = true;
    root.add(c);
    clouds.push(c);
  }
  updaters.push((dt) => {
    for (const c of clouds) {
      c.position.x += dt * 2.2;
      if (c.position.x > 230) c.position.x = -230;
    }
  });

  // ---- 水面のきらめき（太陽・月の光の道） ----
  {
    const n = 800;
    const pos = new Float32Array(n * 3);
    const place = (i: number) => {
      // 手前ほどまばら、奥ほど密に
      const z = -(6 + Math.pow(Math.random(), 0.6) * 164);
      const spread = 0.6 + (-z) * 0.09;
      const x = z * (sunDir.x / sunDir.z) + rand(-spread, spread) * (Math.random() < 0.7 ? 0.5 : 1);
      pos.set([x, 0.08, z], i * 3);
    };
    for (let i = 0; i < n; i++) place(i);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const glitter = new THREE.Points(g, new THREE.PointsMaterial({
      // 1より明るい色にして、加算でしっかり光らせる
      color: new THREE.Color(tod === 'night' ? 0xcfe0ff : tod === 'dusk' ? 0xffd090 : 0xffffff).multiplyScalar(2.2),
      map: softDot(),
      size: 0.6,
      transparent: true,
      opacity: tod === 'night' ? 0.8 : 1,
      fog: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    glitter.renderOrder = 6; // 半透明の水面より後に描く
    root.add(glitter);
    updaters.push(() => {
      // 少しずつ入れ替えてチラチラさせる
      for (let k = 0; k < 60; k++) place(Math.floor(Math.random() * n));
      g.attributes.position.needsUpdate = true;
    });
  }

  // ---- 岸と遠景（釣り場ごと） ----
  switch (biome) {
    case 'sea':
      buildSea(root, mat, tod, updaters);
      break;
    case 'lake':
      buildLake(root, mat, tod, updaters);
      break;
    case 'river':
      buildRiver(root, mat, tod, updaters);
      break;
    case 'pond':
      buildPond(root, mat, tod, updaters);
      break;
  }

  // ---- ホタル（夜の川・池） ----
  if (tod === 'night' && (biome === 'river' || biome === 'pond')) {
    const n = 40;
    const base: THREE.Vector3[] = [];
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) base.push(new THREE.Vector3(rand(-14, 14), rand(0.5, 3), rand(-22, 2)));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const flies = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xd8ff6a, map: softDot(), size: 0.5, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
    root.add(flies);
    updaters.push((_dt, t) => {
      for (let i = 0; i < n; i++) {
        const b = base[i];
        const on = Math.sin(t * 1.7 + i * 2.3) > 0.2;
        pos.set([b.x + Math.sin(t * 0.4 + i) * 1.2, on ? b.y + Math.sin(t * 0.7 + i * 3) * 0.4 : -50, b.z + Math.cos(t * 0.3 + i) * 1.2], i * 3);
      }
      g.attributes.position.needsUpdate = true;
    });
  }

  mergeStatic(root);

  return {
    waterColor: new THREE.Color(WATER[biome])
      .lerp(new THREE.Color(pal.horizon), 0.1)
      .multiplyScalar(tod === 'night' ? 0.45 : tod === 'dusk' ? 0.85 : 1),
    update(dt, t) {
      for (const u of updaters) u(dt, t);
    },
    dispose() {
      cloudMat.dispose();
      skyMat.dispose();
    },
  };
}

/**
 * 動かない部品を、マテリアルごとに1つのメッシュへまとめる（描画回数を減らして軽くする）。
 * userData.dynamic の付いたもの（アニメーションするもの）と、半透明・シェーダーのものはそのまま。
 */
function mergeStatic(root: THREE.Group) {
  root.updateMatrixWorld(true);
  const groups = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; meshes: THREE.Mesh[] }>();
  const walk = (o: THREE.Object3D) => {
    if (o.userData.dynamic) return;
    const m = o as THREE.Mesh;
    if (m.isMesh && !Array.isArray(m.material) && !m.material.transparent && !(m.material instanceof THREE.ShaderMaterial)) {
      let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      const keep = new THREE.BufferGeometry();
      keep.setAttribute('position', g.getAttribute('position'));
      keep.setAttribute('normal', g.getAttribute('normal'));
      if (g.getAttribute('color')) keep.setAttribute('color', g.getAttribute('color'));
      keep.applyMatrix4(m.matrixWorld);
      g = keep;
      const e = groups.get(m.material) ?? { geos: [], meshes: [] };
      e.geos.push(g);
      e.meshes.push(m);
      groups.set(m.material, e);
    }
    for (const c of o.children) walk(c);
  };
  walk(root);
  for (const [material, { geos, meshes }] of groups) {
    if (meshes.length < 2) continue;
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    for (const m of meshes) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    const big = new THREE.Mesh(merged, material);
    root.add(big);
  }
  // 空になったグループを片付ける
  const empty: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o !== root && o.type === 'Group' && o.children.length === 0) empty.push(o);
  });
  empty.forEach((o) => o.removeFromParent());
}

/** ふんわりした丸い光の粒のテクスチャ */
let dotTex: THREE.Texture | null = null;
function softDot(): THREE.Texture {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  dotTex = new THREE.CanvasTexture(c);
  return dotTex;
}

type MatFn = ReturnType<typeof makeMats>;
type Updaters = ((dt: number, t: number) => void)[];

/** 手前の地面（草・砂）。頂点ごとに色をばらつかせる */
function ground(root: THREE.Group, colors: number[], dark: boolean, w = 70, d = 14, z = 9.5) {
  const g = new THREE.BoxGeometry(w, 1, d, 28, 1, 8);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const col: number[] = [];
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 0) pos.setY(i, 0.5 + (Math.random() - 0.5) * 0.12);
    c.setHex(colors[Math.floor(Math.random() * colors.length)]).multiplyScalar(dark ? 0.35 : 1);
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  m.position.set(0, -0.35, z);
  root.add(m);
}

function tree(root: THREE.Group, mat: MatFn, x: number, z: number, s: number, color = 0x2f6a35) {
  const t = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25 * s, 0.35 * s, 2 * s, 6), mat(0x5a4030));
  trunk.position.y = s;
  t.add(trunk);
  for (let i = 0; i < 3; i++) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry((2.2 - i * 0.5) * s, 2.6 * s, 7), mat(color));
    cone.position.y = (2.4 + i * 1.3) * s;
    t.add(cone);
  }
  t.position.set(x, 0, z);
  t.rotation.y = Math.random() * Math.PI;
  root.add(t);
}

function roundTree(root: THREE.Group, mat: MatFn, x: number, z: number, s: number, color = 0x3f7a3a) {
  const t = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25 * s, 0.35 * s, 2.2 * s, 6), mat(0x5a4030));
  trunk.position.y = 1.1 * s;
  t.add(trunk);
  for (let i = 0; i < 3; i++) {
    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(1.3, 1.8) * s, 0), mat(color));
    ball.position.set(rand(-0.8, 0.8) * s, (2.8 + rand(0, 1)) * s, rand(-0.8, 0.8) * s);
    t.add(ball);
  }
  t.position.set(x, 0, z);
  root.add(t);
}

function rock(root: THREE.Group, mat: MatFn, x: number, y: number, z: number, s: number, color = 0x7a7a74) {
  const r = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), mat(color));
  r.position.set(x, y, z);
  r.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
  r.scale.y = rand(0.5, 0.8);
  root.add(r);
  return r;
}

/** 岸辺のアシ。風でゆれる */
function reeds(root: THREE.Group, mat: MatFn, cx: number, cz: number, n: number, updaters: Updaters) {
  const group = new THREE.Group();
  const blades: THREE.Mesh[] = [];
  for (let i = 0; i < n; i++) {
    const h = rand(1.2, 2.6);
    const b = new THREE.Mesh(new THREE.ConeGeometry(0.05, h, 4), mat(Math.random() < 0.3 ? 0x8a8a3a : 0x5f8a3a));
    b.geometry.translate(0, h / 2, 0);
    b.position.set(cx + rand(-1.4, 1.4), -0.1, cz + rand(-1, 1));
    b.rotation.z = rand(-0.15, 0.15);
    group.add(b);
    blades.push(b);
    if (Math.random() < 0.3) {
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.35, 6), mat(0x6a4a2a));
      head.position.y = h;
      b.add(head);
    }
  }
  group.userData.dynamic = true;
  root.add(group);
  updaters.push((_dt, t) => blades.forEach((b, i) => (b.rotation.x = Math.sin(t * 1.3 + i * 0.7 + b.position.x) * 0.08)));
}

/** カモメ（翼をはばたかせて旋回） */
function gulls(root: THREE.Group, n: number, updaters: Updaters, dark: boolean) {
  const wingMat = new THREE.MeshBasicMaterial({ color: dark ? 0x444a55 : 0xffffff, side: THREE.DoubleSide });
  for (let i = 0; i < n; i++) {
    const bird = new THREE.Group();
    const wings: THREE.Mesh[] = [];
    for (const side of [1, -1]) {
      const g = new THREE.PlaneGeometry(1.4, 0.35);
      g.translate(0.7 * side, 0, 0);
      const w = new THREE.Mesh(g, wingMat);
      bird.add(w);
      wings.push(w);
    }
    bird.userData.dynamic = true;
    root.add(bird);
    const cx = rand(-25, 25), cz = rand(-60, -25), r = rand(6, 16), y = rand(10, 22), sp = rand(0.15, 0.3) * (Math.random() < 0.5 ? 1 : -1), ph = rand(0, 6);
    updaters.push((_dt, t) => {
      const a = t * sp + ph;
      bird.position.set(cx + Math.cos(a) * r, y + Math.sin(t * 0.5 + ph) * 1.5, cz + Math.sin(a) * r);
      bird.rotation.y = -a + (sp > 0 ? 0 : Math.PI);
      const flap = Math.sin(t * 7 + ph) * 0.5;
      wings[0].rotation.z = flap;
      wings[1].rotation.z = -flap;
    });
  }
}

function buildSea(root: THREE.Group, mat: MatFn, tod: TimeOfDay, updaters: Updaters) {
  const dark = tod === 'night';
  // 足元の桟橋（板張り）
  const deck = new THREE.Group();
  for (let i = 0; i < 16; i++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 9), mat(i % 3 === 0 ? 0x8a6a4a : i % 3 === 1 ? 0x9a7a55 : 0x7a5a3a));
    plank.position.set(-3.4 + i * 0.45, 0.12, 6.5);
    plank.rotation.z = rand(-0.01, 0.01);
    deck.add(plank);
  }
  for (const x of [-3.3, 3.3]) {
    for (const z of [2.3, 6, 9.8]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 4, 8), mat(0x5a4030));
      post.position.set(x, -1.5, z);
      deck.add(post);
    }
  }
  // 係船柱
  const bollard = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.6, 10), mat(0x3a3a3a, { rough: 0.5 }));
  bollard.position.set(-2.6, 0.45, 2.9);
  deck.add(bollard);
  const rope = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.07, 6, 14), mat(0xc8b080));
  rope.rotation.x = Math.PI / 2;
  rope.position.set(-2.6, 0.5, 2.9);
  deck.add(rope);
  root.add(deck);
  // 左右はコンクリートの護岸
  for (const x of [-22, 22]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(36, 1.2, 12), mat(0x9a9a94));
    wall.position.set(x, -0.3, 9);
    root.add(wall);
  }

  // 防波堤と灯台
  const breakwater = new THREE.Mesh(new THREE.BoxGeometry(70, 2.2, 4), mat(0xa8a8a0));
  breakwater.position.set(-4, 0.6, -70);
  root.add(breakwater);
  for (let i = 0; i < 22; i++) {
    const tp = new THREE.Mesh(new THREE.TetrahedronGeometry(1.6, 0), mat(0xb8b8b0));
    tp.position.set(-34 + i * 3 + rand(-0.5, 0.5), 0.3, -67 + rand(-0.6, 0.6));
    tp.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    root.add(tp);
  }
  const lighthouse = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(1.5 - i * 0.12, 1.62 - i * 0.12, 2.4, 12), mat(i % 2 ? 0xffffff : 0xd8343a, { flat: false, rough: 0.5 }));
    seg.position.y = 1.2 + i * 2.4;
    lighthouse.add(seg);
  }
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8), new THREE.MeshBasicMaterial({ color: dark ? 0xfff2a0 : 0xffffff }));
  lamp.position.y = 13;
  lighthouse.add(lamp);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.4, 1.4, 12), mat(0x333333));
  roof.position.y = 14.2;
  lighthouse.add(roof);
  lighthouse.position.set(15, 1.7, -70);
  root.add(lighthouse);
  if (dark) {
    // 灯台の光がぐるっと回る
    const beam = new THREE.Mesh(
      new THREE.ConeGeometry(4, 40, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff2a0, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
    );
    beam.geometry.translate(0, -20, 0);
    beam.rotation.z = Math.PI / 2;
    const pivot = new THREE.Group();
    pivot.position.set(15, 14.7, -70);
    pivot.add(beam);
    pivot.userData.dynamic = true;
    root.add(pivot);
    updaters.push((_dt, t) => (pivot.rotation.y = t * 0.8));
  }

  // 遠くの島
  for (let i = 0; i < 5; i++) {
    const isl = new THREE.Mesh(new THREE.ConeGeometry(rand(12, 26), rand(6, 14), 7), mat(dark ? 0x1a2a2a : 0x5a7a6a));
    isl.position.set(rand(-90, 90), 0, rand(-230, -180));
    isl.scale.z = 0.5;
    root.add(isl);
  }

  // 沖を通る船
  const boat = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(8, 1.6, 2.4), mat(0xffffff));
  boat.add(hull);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(8.05, 0.4, 2.45), mat(0xc83030));
  stripe.position.y = -0.5;
  boat.add(stripe);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(3, 1.6, 2), mat(0xe8e8e8));
  cabin.position.set(-1, 1.5, 0);
  boat.add(cabin);
  if (dark) {
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe08a }));
    light.position.set(-1, 2.6, 0);
    boat.add(light);
  }
  boat.userData.dynamic = true;
  root.add(boat);
  updaters.push((_dt, t) => {
    const x = ((t * 2.5) % 300) - 150;
    boat.position.set(x, 0.7 + Math.sin(t * 1.3) * 0.15, -110);
    boat.rotation.z = Math.sin(t * 1.1) * 0.03;
  });

  gulls(root, 4, updaters, dark);
}

function buildLake(root: THREE.Group, mat: MatFn, tod: TimeOfDay, updaters: Updaters) {
  const dark = tod === 'night';
  ground(root, [0x5f8a3a, 0x6f9a42, 0x7a8f3a, 0x8a7a50], dark);
  // 小さな木の桟橋
  for (let i = 0; i < 6; i++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 5), mat(0x8a6a4a));
    plank.position.set(-1.25 + i * 0.5, 0.25, 3.2);
    root.add(plank);
  }
  // 向こう岸の森と山
  const far = new THREE.Mesh(new THREE.BoxGeometry(300, 1, 30), mat(0x3f6a35));
  far.position.set(0, -0.3, -85);
  root.add(far);
  for (let i = 0; i < 46; i++) tree(root, mat, rand(-140, 140), rand(-90, -72), rand(1.6, 3), Math.random() < 0.5 ? 0x2a5a30 : 0x35683a);
  for (let i = 0; i < 9; i++) {
    const h = rand(30, 55);
    const geo = new THREE.ConeGeometry(rand(28, 40), h, 7);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const col: number[] = [];
    const c = new THREE.Color();
    for (let k = 0; k < pos.count; k++) {
      const y = pos.getY(k) / h + 0.5;
      c.setHex(y > 0.72 ? 0xf4f6fa : y > 0.45 ? 0x5a6a7a : 0x3f5a4a).multiplyScalar(dark ? 0.3 : tod === 'dusk' ? 0.8 : 1);
      col.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    m.position.set(-160 + i * 40 + rand(-10, 10), h / 2 - 2, rand(-160, -130));
    root.add(m);
  }
  reeds(root, mat, -5.5, 3, 26, updaters);
  reeds(root, mat, 6, 3.3, 20, updaters);
  for (let i = 0; i < 6; i++) rock(root, mat, (Math.random() < 0.5 ? -1 : 1) * rand(3, 12), 0, rand(2.5, 3.8), rand(0.3, 0.7));
  for (let i = 0; i < 6; i++) roundTree(root, mat, (i < 3 ? -1 : 1) * rand(9, 18), rand(6, 12), rand(1, 1.5));
  gulls(root, 2, updaters, dark);
}

function buildRiver(root: THREE.Group, mat: MatFn, tod: TimeOfDay, updaters: Updaters) {
  const dark = tod === 'night';
  ground(root, [0x5f8a3a, 0x6f9a42, 0x9a8a6a, 0x8a8a7a], dark);
  // 向こう岸（川幅は約25m）
  const bank = new THREE.Mesh(new THREE.BoxGeometry(300, 2, 40), mat(0x557a35));
  bank.position.set(0, -0.2, -48);
  root.add(bank);
  for (let i = 0; i < 40; i++) {
    if (Math.random() < 0.5) roundTree(root, mat, rand(-120, 120), rand(-60, -32), rand(1.5, 2.6), Math.random() < 0.5 ? 0x3f7a3a : 0x4a8a40);
    else tree(root, mat, rand(-120, 120), rand(-66, -36), rand(1.6, 2.8));
  }
  for (let i = 0; i < 14; i++) rock(root, mat, rand(-60, 60), 0.6, rand(-29.5, -27), rand(0.8, 1.8), 0x8a8a84);
  // 遠くの山
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(rand(30, 45), rand(30, 50), 6), mat(dark ? 0x1a2a2a : 0x4f6f55));
    m.position.set(-160 + i * 45, 10, -150);
    root.add(m);
  }
  // 川の中の岩と白波
  const foamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false });
  const foams: THREE.Mesh[] = [];
  for (const [x, z, s] of [[-9, -6, 0.9], [7, -14, 1.2], [-3, -19, 0.8], [13, -8, 0.7]] as const) {
    rock(root, mat, x, 0.1, z, s, 0x6a6a64);
    const f = new THREE.Mesh(new THREE.RingGeometry(s * 0.9, s * 1.5, 20), foamMat);
    f.rotation.x = -Math.PI / 2;
    f.position.set(x - 0.4, 0.1, z);
    f.scale.x = 1.6;
    f.userData.dynamic = true;
    root.add(f);
    foams.push(f);
  }
  // 流れていく葉っぱ
  const leaves: THREE.Mesh[] = [];
  for (let i = 0; i < 10; i++) {
    const leaf = new THREE.Mesh(new THREE.CircleGeometry(0.18, 5), mat(Math.random() < 0.5 ? 0xc89a3a : 0x6a9a3a));
    leaf.rotation.x = -Math.PI / 2;
    leaf.position.set(rand(-30, 30), 0.12, rand(-24, 0));
    leaf.userData.dynamic = true;
    root.add(leaf);
    leaves.push(leaf);
  }
  updaters.push((dt, t) => {
    foams.forEach((f, i) => ((f.material as THREE.MeshBasicMaterial).opacity = 0.35 + Math.sin(t * 3 + i) * 0.15));
    for (const l of leaves) {
      l.position.x += dt * 1.6;
      if (l.position.x > 32) l.position.x = -32;
      l.rotation.z += dt * 0.5;
    }
  });
  reeds(root, mat, -7, 3, 22, updaters);
  for (let i = 0; i < 8; i++) rock(root, mat, (Math.random() < 0.5 ? -1 : 1) * rand(3, 14), 0, rand(2.6, 4), rand(0.25, 0.6));
}

function buildPond(root: THREE.Group, mat: MatFn, tod: TimeOfDay, updaters: Updaters) {
  const dark = tod === 'night';
  ground(root, [0x6f9a42, 0x7aa84a, 0x5f8a3a], dark);
  // 池を囲む木々
  const bank = new THREE.Mesh(new THREE.BoxGeometry(300, 1.4, 40), mat(0x5f8a3a));
  bank.position.set(0, -0.3, -52);
  root.add(bank);
  for (let i = 0; i < 34; i++) roundTree(root, mat, rand(-90, 90), rand(-62, -36), rand(1.6, 2.8), Math.random() < 0.3 ? 0x4a8a3a : 0x2f6a35);
  // 遠くの山
  for (let i = 0; i < 7; i++) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(rand(30, 45), rand(25, 40), 6), mat(dark ? 0x1a2a2a : 0x5a7a60));
    m.position.set(-150 + i * 50, 8, -140);
    root.add(m);
  }
  // 蓮の葉と花
  const pads: THREE.Mesh[] = [];
  for (let i = 0; i < 26; i++) {
    const r = rand(0.5, 1.1);
    const pad = new THREE.Mesh(new THREE.CircleGeometry(r, 14, 0.25, Math.PI * 2 - 0.5), mat(Math.random() < 0.5 ? 0x3f8a3a : 0x4a9a42));
    pad.rotation.x = -Math.PI / 2;
    pad.rotation.z = Math.random() * 6;
    const x = (Math.random() < 0.5 ? -1 : 1) * rand(4, 16);
    pad.position.set(x, 0.12, rand(-24, 1));
    pad.userData.dynamic = true;
    root.add(pad);
    pads.push(pad);
    if (Math.random() < 0.35) {
      const flower = new THREE.Group();
      for (let k = 0; k < 6; k++) {
        const petal = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.4, 4), mat(0xffa8c8, { emissive: dark ? 0x301020 : 0 }));
        petal.position.set(Math.cos(k) * 0.1, 0.18, Math.sin(k) * 0.1);
        petal.rotation.set(Math.sin(k) * 0.5, 0, -Math.cos(k) * 0.5);
        flower.add(petal);
      }
      flower.position.set(x, 0.1, pad.position.z);
      root.add(flower);
    }
  }
  updaters.push((_dt, t) => pads.forEach((p, i) => (p.position.y = 0.12 + Math.sin(t * 1.2 + i) * 0.03)));
  // 石灯籠
  const lantern = new THREE.Group();
  const stone = 0x9a9a90;
  const parts: [THREE.BufferGeometry, number][] = [
    [new THREE.BoxGeometry(1.2, 0.3, 1.2), 0.15],
    [new THREE.CylinderGeometry(0.22, 0.22, 1.2, 8), 0.9],
    [new THREE.BoxGeometry(0.9, 0.2, 0.9), 1.6],
    [new THREE.BoxGeometry(0.7, 0.6, 0.7), 2.0],
    [new THREE.ConeGeometry(0.85, 0.5, 4), 2.55],
  ];
  for (const [g, y] of parts) {
    const m = new THREE.Mesh(g, mat(stone));
    m.position.y = y;
    if (g instanceof THREE.ConeGeometry) m.rotation.y = Math.PI / 4;
    lantern.add(m);
  }
  const fire = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.35, 0.72), new THREE.MeshBasicMaterial({ color: dark ? 0xffc060 : 0x3a3a34 }));
  fire.position.y = 2.0;
  lantern.add(fire);
  lantern.position.set(5.5, 0.15, 5.2);
  root.add(lantern);
  if (dark) updaters.push((_dt, t) => (fire.material as THREE.MeshBasicMaterial).color.setHSL(0.1, 1, 0.55 + Math.sin(t * 9) * 0.05));
  reeds(root, mat, -6, 3, 28, updaters);
  for (let i = 0; i < 5; i++) rock(root, mat, (Math.random() < 0.5 ? -1 : 1) * rand(3, 10), 0, rand(2.6, 3.6), rand(0.3, 0.6));
}
