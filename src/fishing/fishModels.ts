import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { FISH_BY_ID, FishSpecies } from '../data/fish';

/**
 * 魚の3Dオブジェクト。
 * 規約: ローカル座標で「頭が +X 方向」「全長 = 1」。呼び出し側で scale と向きを決める。
 */
export interface FishObject {
  root: THREE.Object3D;
  update(dt: number, swimSpeed: number): void;
  dispose(): void;
}

interface ManifestEntry {
  url: string;
  /** モデルの頭が向いている軸。既定 +x */
  forward?: '+x' | '-x' | '+z' | '-z';
  /** 正規化後に掛ける倍率（見た目調整） */
  scale?: number;
  /** 再生するアニメーション名（省略時は最初のクリップ） */
  animation?: string;
}

let manifestPromise: Promise<Record<string, ManifestEntry>> | null = null;
const gltfCache = new Map<string, Promise<GLTF>>();
const loader = new GLTFLoader();

function loadManifest(): Promise<Record<string, ManifestEntry>> {
  if (!manifestPromise) {
    manifestPromise = fetch(`${import.meta.env.BASE_URL}models/fish/manifest.json`)
      .then((r) => (r.ok ? r.json() : { models: {} }))
      .then((j) => (j.models ?? {}) as Record<string, ManifestEntry>)
      .catch(() => ({}));
  }
  return manifestPromise;
}

function loadGltf(url: string): Promise<GLTF> {
  let p = gltfCache.get(url);
  if (!p) {
    const full = /^https?:/.test(url) ? url : `${import.meta.env.BASE_URL}${url.replace(/^\//, '')}`;
    p = loader.loadAsync(full);
    gltfCache.set(url, p);
  }
  return p;
}

export async function hasCustomModel(speciesId: string): Promise<boolean> {
  const m = await loadManifest();
  return !!m[speciesId];
}

/** 魚モデルを作る。manifest にあれば GLB/GLTF、なければ手続き生成 */
export async function createFish(speciesId: string): Promise<FishObject> {
  const species = FISH_BY_ID[speciesId];
  const manifest = await loadManifest();
  const entry = manifest[speciesId];
  if (entry) {
    try {
      return await createGltfFish(entry);
    } catch (e) {
      console.warn(`model load failed for ${speciesId}, fallback to procedural`, e);
    }
  }
  return createProceduralFish(species);
}

async function createGltfFish(entry: ManifestEntry): Promise<FishObject> {
  const gltf = await loadGltf(entry.url);
  const model = skeletonClone(gltf.scene);
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = false;
      m.frustumCulled = false;
    }
  });

  // 向きを +X に揃える
  const orient = new THREE.Group();
  orient.add(model);
  const rotY = { '+x': 0, '-x': Math.PI, '+z': Math.PI / 2, '-z': -Math.PI / 2 }[entry.forward ?? '+x'];
  orient.rotation.y = rotY;

  // 中心を原点、最長辺を 1 に正規化
  const wrapper = new THREE.Group();
  wrapper.add(orient);
  wrapper.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(orient);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  orient.position.sub(center);
  const s = (1 / Math.max(size.x, size.y, size.z, 1e-6)) * (entry.scale ?? 1);
  const root = new THREE.Group();
  wrapper.scale.setScalar(s);
  root.add(wrapper);

  let mixer: THREE.AnimationMixer | null = null;
  if (gltf.animations.length > 0) {
    mixer = new THREE.AnimationMixer(model);
    const clip =
      (entry.animation && gltf.animations.find((a) => a.name === entry.animation)) || gltf.animations[0];
    mixer.clipAction(clip).play();
  }
  let t = 0;
  return {
    root,
    update(dt, swimSpeed) {
      t += dt;
      if (mixer) mixer.update(dt * (0.5 + swimSpeed));
      else wrapper.rotation.y = Math.sin(t * (4 + swimSpeed * 8)) * 0.08 * (0.5 + swimSpeed);
    },
    dispose() {
      mixer?.stopAllAction();
      // ジオメトリ・マテリアルはキャッシュ元と共有なので破棄しない
    },
  };
}

function createProceduralFish(sp: FishSpecies): FishObject {
  const { body, belly, fin, length, height, width } = sp.look;
  // 長さ1に正規化した比率
  const L = 1;
  const H = height / length;
  const W = width / length;

  const root = new THREE.Group();
  const wiggle = new THREE.Group();
  root.add(wiggle);

  // 胴体: 球を引き伸ばし、尾側を細くする
  const geo = new THREE.SphereGeometry(0.5, 32, 18);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors: number[] = [];
  const cBody = new THREE.Color(body);
  const cBelly = new THREE.Color(belly);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    const taper = x < 0 ? 1 + x * 1.3 : 1 - x * x * 0.6; // 尾側を細く、頭を少し丸く
    y *= taper;
    z *= taper;
    const k = THREE.MathUtils.smoothstep(-y, -0.05, 0.25);
    tmp.copy(cBody).lerp(cBelly, k);
    colors.push(tmp.r, tmp.g, tmp.b);
    pos.setXYZ(i, x * L, y * H * 2, z * W * 2);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const legendary = sp.rarity === 'legendary';
  const bodyMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.35,
    metalness: legendary ? 0.6 : 0.25,
    emissive: legendary ? new THREE.Color(fin).multiplyScalar(0.25) : new THREE.Color(0),
  });
  const bodyMesh = new THREE.Mesh(geo, bodyMat);
  wiggle.add(bodyMesh);

  const finMat = new THREE.MeshStandardMaterial({
    color: fin,
    roughness: 0.5,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.92,
  });

  // 尾びれ
  const tailPivot = new THREE.Group();
  tailPivot.position.x = -0.46 * L;
  wiggle.add(tailPivot);
  const tl = 0.28;
  const th = Math.max(0.12, H * 0.9);
  const tailShape = new THREE.Shape();
  tailShape.moveTo(0.02, 0);
  tailShape.lineTo(-tl, th);
  tailShape.quadraticCurveTo(-tl * 0.7, 0, -tl, -th);
  tailShape.lineTo(0.02, 0);
  const tail = new THREE.Mesh(new THREE.ShapeGeometry(tailShape), finMat);
  tailPivot.add(tail);

  // 背びれ
  const dShape = new THREE.Shape();
  dShape.moveTo(0.18, 0);
  dShape.lineTo(-0.02, H * 0.75);
  dShape.lineTo(-0.2, 0);
  dShape.lineTo(0.18, 0);
  const dorsal = new THREE.Mesh(new THREE.ShapeGeometry(dShape), finMat);
  dorsal.position.set(0, H * 0.85, 0);
  wiggle.add(dorsal);

  // 胸びれ
  const pShape = new THREE.Shape();
  pShape.moveTo(0, 0);
  pShape.lineTo(-0.14, 0.05);
  pShape.lineTo(-0.12, -0.06);
  pShape.lineTo(0, 0);
  const pectorals: THREE.Mesh[] = [];
  for (const side of [1, -1]) {
    const p = new THREE.Mesh(new THREE.ShapeGeometry(pShape), finMat);
    p.position.set(0.22, -H * 0.3, side * W * 0.9);
    p.rotation.x = side * 0.6;
    wiggle.add(p);
    pectorals.push(p);
  }

  // 目
  const eyeGeo = new THREE.SphereGeometry(Math.max(0.025, H * 0.1), 10, 8);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.1, metalness: 0.3 });
  const eyeWhiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  for (const side of [1, -1]) {
    const white = new THREE.Mesh(eyeGeo, eyeWhiteMat);
    white.scale.setScalar(1.35);
    white.position.set(0.36, H * 0.25, side * W * 0.62);
    wiggle.add(white);
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(0.38, H * 0.25, side * W * 0.72);
    wiggle.add(eye);
  }

  let t = Math.random() * 10;
  return {
    root,
    update(dt, swimSpeed) {
      t += dt * (3 + swimSpeed * 10);
      tailPivot.rotation.y = Math.sin(t) * (0.35 + swimSpeed * 0.35);
      wiggle.rotation.y = Math.sin(t - 0.8) * 0.06 * (0.5 + swimSpeed);
      for (const [i, p] of pectorals.entries()) p.rotation.y = Math.sin(t * 0.7 + i) * 0.4;
    },
    dispose() {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          (Array.isArray(m.material) ? m.material : [m.material]).forEach((mm) => mm.dispose());
        }
      });
    },
  };
}

/** 体長(cm) → ワールド上の長さ */
export function worldLength(sizeCm: number): number {
  return THREE.MathUtils.clamp(0.35 + sizeCm / 70, 0.45, 3.6);
}
