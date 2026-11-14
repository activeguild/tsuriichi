/**
 * 釣り竿（グリップ・リールシート・ブランク・ガイド・スピニングリール）。
 * 竿は細い円柱を何本もつないで作り、毎フレーム曲線に沿って並べ直すことで「しなり」を出す。
 */
import * as THREE from 'three';

export type RodMode = 'idle' | 'cast' | 'wait' | 'bite' | 'fight' | 'landing';

export interface RodInput {
  mode: RodMode;
  /** キャストの進み具合 0〜1 */
  castT: number;
  /** 0〜100 */
  tension: number;
  /** 糸の先（ウキ・魚の口）のワールド座標 */
  target: THREE.Vector3;
  /** リールを巻いているか */
  reeling: boolean;
  time: number;
}

const UP = new THREE.Vector3(0, 1, 0);
/** グリップの端（手で持つ位置の後ろ） */
const BUTT = new THREE.Vector3(0.62, 1.5, 4.75);
/** 力がかかっていないときの竿先 */
const TIP_REST = new THREE.Vector3(0.42, 3.25, 1.55);
/** グリップ＋リールシートの長さ */
const HANDLE_LEN = 0.75;
const SEGMENTS = 18;
/** ガイドの位置（ブランクの根元0〜竿先1） */
const GUIDE_T = [0.1, 0.27, 0.43, 0.57, 0.7, 0.81, 0.9, 0.97];

export class FishingRod {
  readonly group = new THREE.Group();
  /** いまの竿先（ワールド座標）。糸はここから出る */
  readonly tip = TIP_REST.clone();
  private segs: THREE.Mesh[] = [];
  private guides: THREE.Mesh[] = [];
  private innerLine: THREE.Line;
  private reel = new THREE.Group();
  private handle = new THREE.Group();
  private bail = new THREE.Mesh();
  private handleAngle = 0;
  private bend = new THREE.Vector3();
  private bendVel = new THREE.Vector3();
  private dir: THREE.Vector3;
  private blankStart: THREE.Vector3;
  private blankLen: number;
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();

  constructor(scene: THREE.Scene) {
    this.dir = TIP_REST.clone().sub(BUTT).normalize();
    this.blankStart = BUTT.clone().addScaledVector(this.dir, HANDLE_LEN);
    this.blankLen = TIP_REST.distanceTo(this.blankStart);

    const blankMat = new THREE.MeshStandardMaterial({ color: 0x1a2440, roughness: 0.25, metalness: 0.5 });
    const wrapMat = new THREE.MeshStandardMaterial({ color: 0xb8902a, roughness: 0.35, metalness: 0.6 });
    const corkMat = new THREE.MeshStandardMaterial({ color: 0xc8a070, roughness: 0.9 });
    const evaMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.85 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.25, metalness: 0.9 });
    const reelMat = new THREE.MeshStandardMaterial({ color: 0x2a2e36, roughness: 0.35, metalness: 0.7 });
    const accentMat = new THREE.MeshStandardMaterial({ color: 0xd04a2a, roughness: 0.4, metalness: 0.5 });

    // ---- グリップとリールシート（曲がらない部分） ----
    const handleGroup = new THREE.Group();
    const along = (len: number, r0: number, r1: number, at: number, m: THREE.Material) => {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, 14), m);
      c.position.y = at + len / 2;
      handleGroup.add(c);
      return c;
    };
    along(0.04, 0.05, 0.05, 0, evaMat); // 尻栓
    along(0.24, 0.048, 0.044, 0.04, evaMat); // 後ろのグリップ
    along(0.16, 0.032, 0.032, 0.28, metalMat); // リールシート
    along(0.05, 0.04, 0.036, 0.44, metalMat); // ナット
    along(0.22, 0.045, 0.034, 0.49, corkMat); // 前のコルクグリップ
    along(0.04, 0.036, 0.03, 0.71, wrapMat); // ワインディングチェック
    handleGroup.quaternion.setFromUnitVectors(UP, this.dir);
    handleGroup.position.copy(BUTT);
    this.group.add(handleGroup);

    // ---- ブランク（しなる部分）：根元から竿先へ細くなる円柱をつなぐ ----
    for (let i = 0; i < SEGMENTS; i++) {
      const t0 = i / SEGMENTS;
      const t1 = (i + 1) / SEGMENTS;
      const r0 = THREE.MathUtils.lerp(0.03, 0.006, Math.pow(t0, 0.8));
      const r1 = THREE.MathUtils.lerp(0.03, 0.006, Math.pow(t1, 0.8));
      const g = new THREE.CylinderGeometry(r1, r0, 1, 10);
      g.translate(0, 0.5, 0);
      const m = new THREE.Mesh(g, i === SEGMENTS - 1 ? accentMat : blankMat);
      this.group.add(m);
      this.segs.push(m);
    }

    // ---- ガイド（下側にぶら下がる輪） ----
    for (let i = 0; i < GUIDE_T.length; i++) {
      const size = THREE.MathUtils.lerp(0.05, 0.016, i / (GUIDE_T.length - 1));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(size, size * 0.18, 6, 18), metalMat);
      this.group.add(ring);
      this.guides.push(ring);
    }

    // ---- スピニングリール ----
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.1, 8), reelMat);
    stem.position.z = -0.05;
    stem.rotation.x = Math.PI / 2;
    this.reel.add(stem);
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), reelMat);
    body.scale.set(0.8, 1.15, 0.9);
    body.position.z = -0.13;
    this.reel.add(body);
    const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.07, 18), reelMat);
    rotor.position.set(0, 0.08, -0.13);
    this.reel.add(rotor);
    const spool = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.06, 20), metalMat);
    spool.position.set(0, 0.145, -0.13);
    this.reel.add(spool);
    const lineOnSpool = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.044, 0.045, 20), new THREE.MeshStandardMaterial({ color: 0xe8f070, roughness: 0.6 }));
    lineOnSpool.position.set(0, 0.145, -0.13);
    this.reel.add(lineOnSpool);
    const spoolCap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.015, 18), accentMat);
    spoolCap.position.set(0, 0.182, -0.13);
    this.reel.add(spoolCap);
    // ベール（糸を巻き取るワイヤー）
    this.bail = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.004, 6, 24, Math.PI), metalMat);
    this.bail.position.set(0, 0.12, -0.13);
    this.bail.rotation.y = Math.PI / 2;
    this.reel.add(this.bail);
    // ハンドル（右側）
    this.handle.position.set(0.055, 0, -0.13);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.09), reelMat);
    arm.position.z = 0.045;
    const knobStem = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.03, 6), metalMat);
    knobStem.rotation.z = Math.PI / 2;
    knobStem.position.set(0.015, 0, 0.09);
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.035, 12), accentMat);
    knob.rotation.z = Math.PI / 2;
    knob.position.set(0.04, 0, 0.09);
    this.handle.add(arm, knobStem, knob);
    this.reel.add(this.handle);
    // リールは竿の下側（リールシートの位置）に付く。ローカル: +Y=竿の向き, -Z=下
    const basis = this.frame(this.dir);
    this.reel.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(basis.x, this.dir, basis.z));
    // 真下だと上からのカメラに隠れるので、竿の軸まわりに少しカメラ側（左）へ傾ける
    this.reel.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(this.dir, 0.75));
    this.reel.scale.setScalar(1.35);
    this.reel.position.copy(BUTT).addScaledVector(this.dir, 0.36);
    this.group.add(this.reel);

    // リールから竿先までガイドを通る糸
    const lg = new THREE.BufferGeometry().setFromPoints(Array.from({ length: GUIDE_T.length + 2 }, () => new THREE.Vector3()));
    this.innerLine = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xf0f4c8, transparent: true, opacity: 0.85 }));
    this.innerLine.frustumCulled = false;
    this.group.add(this.innerLine);

    scene.add(this.group);
  }

  /** 竿の向き d に対して、横(x)と「上」(z) の向きを返す */
  private frame(d: THREE.Vector3) {
    const z = UP.clone().addScaledVector(d, -UP.dot(d)).normalize();
    const x = new THREE.Vector3().crossVectors(d, z).normalize();
    return { x, z };
  }

  /** ブランクの曲線（2次ベジェ）。根元は硬く、先ほど曲がる */
  private curve(t: number, tipPos: THREE.Vector3, out: THREE.Vector3) {
    const p0 = this.blankStart;
    const p1 = this.tmpA.copy(this.blankStart).addScaledVector(this.dir, this.blankLen * 0.62);
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    return out.set(
      a * p0.x + b * p1.x + c * tipPos.x,
      a * p0.y + b * p1.y + c * tipPos.y,
      a * p0.z + b * p1.z + c * tipPos.z,
    );
  }

  update(dt: number, inp: RodInput) {
    const { x: side } = this.frame(this.dir);
    // ---- 竿先の目標位置（しなり）を決める ----
    const want = new THREE.Vector3(0, -0.06, 0); // 自重で少し垂れる
    switch (inp.mode) {
      case 'cast': {
        // 振りかぶって（後ろ・上へ）から前へ振り出す
        const k = inp.castT;
        const back = k < 0.35 ? Math.sin((k / 0.35) * Math.PI * 0.5) : Math.max(0, 1 - (k - 0.35) / 0.2);
        const fwd = k < 0.35 ? 0 : Math.sin(Math.min(1, (k - 0.35) / 0.45) * Math.PI);
        want.addScaledVector(this.dir, -back * 0.6).add(new THREE.Vector3(0, back * 0.5 - fwd * 0.9, -fwd * 0.6));
        break;
      }
      case 'bite':
        // 竿先がピクピク引き込まれる
        want.y -= 0.12 + Math.max(0, Math.sin(inp.time * 22)) * 0.12;
        break;
      case 'wait':
        want.y += Math.sin(inp.time * 1.3) * 0.02;
        break;
      case 'fight':
      case 'landing': {
        // 糸の方向へ、テンションに応じて大きく曲がる
        const pull = this.tmpB.copy(inp.target).sub(TIP_REST).normalize();
        const amount = inp.mode === 'landing' ? 0.6 : 0.25 + (inp.tension / 100) * 1.25;
        want.addScaledVector(pull, amount);
        want.y -= amount * 0.25;
        // 細かい震え
        want.addScaledVector(side, Math.sin(inp.time * 31) * 0.012 * (inp.tension / 50));
        break;
      }
    }
    // バネで追従させて自然な揺れにする
    const k = inp.mode === 'cast' ? 120 : 60;
    const damp = inp.mode === 'cast' ? 14 : 9;
    this.bendVel.addScaledVector(this.tmpA.copy(want).sub(this.bend), k * dt).multiplyScalar(Math.max(0, 1 - damp * dt));
    this.bend.addScaledVector(this.bendVel, dt);
    const tipPos = this.tmpB.copy(TIP_REST).add(this.bend);
    // 竿の長さがおかしくならないよう、根元からの距離をそろえる
    tipPos.sub(this.blankStart).setLength(this.blankLen * 0.985).add(this.blankStart);
    this.tip.copy(tipPos);

    // ---- ブランクを曲線に沿って並べる ----
    const p = new THREE.Vector3();
    const q = new THREE.Vector3();
    const tipFixed = tipPos.clone();
    for (let i = 0; i < SEGMENTS; i++) {
      this.curve(i / SEGMENTS, tipFixed, p);
      this.curve((i + 1) / SEGMENTS, tipFixed, q);
      const seg = this.segs[i];
      seg.position.copy(p);
      const d = q.sub(p);
      const len = d.length();
      seg.quaternion.setFromUnitVectors(UP, d.normalize());
      seg.scale.set(1, len, 1);
    }

    // ---- ガイドと、ガイドを通る糸 ----
    const pts = this.innerLine.geometry.attributes.position as THREE.BufferAttribute;
    // リールのスプールの上から
    const spoolTop = new THREE.Vector3(0, 0.15, -0.13).applyQuaternion(this.reel.quaternion).add(this.reel.position);
    pts.setXYZ(0, spoolTop.x, spoolTop.y, spoolTop.z);
    for (let i = 0; i < GUIDE_T.length; i++) {
      const t = GUIDE_T[i];
      this.curve(t, tipFixed, p);
      this.curve(Math.min(1, t + 0.01), tipFixed, q);
      const tangent = q.sub(p).normalize();
      const { z: upv } = this.frame(tangent);
      const size = THREE.MathUtils.lerp(0.05, 0.016, i / (GUIDE_T.length - 1));
      const ringPos = p.clone().addScaledVector(upv, -(size + 0.012)); // 竿の下側
      const g = this.guides[i];
      g.position.copy(ringPos);
      // 輪の穴が竿の向きを向く
      this.tmpQ.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
      g.quaternion.copy(this.tmpQ);
      pts.setXYZ(i + 1, ringPos.x, ringPos.y, ringPos.z);
    }
    pts.setXYZ(GUIDE_T.length + 1, tipPos.x, tipPos.y, tipPos.z);
    pts.needsUpdate = true;

    // ---- リール：巻いている間はハンドルとベールが回る ----
    const spin = inp.mode === 'fight' && inp.reeling ? 16 : inp.mode === 'landing' ? 22 : 0;
    this.handleAngle += dt * spin;
    this.handle.rotation.x = this.handleAngle;
    this.bail.rotation.z = this.handleAngle * 1.5;
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh || (o as THREE.Line).isLine) {
        m.geometry.dispose();
        (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose());
      }
    });
  }
}
