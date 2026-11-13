// Fish Kit (CC0) の型定義。実装は fish-kit.js（README.md 参照）
import type * as THREE from 'three';

export type FishKitMotion =
  | 'swim' | 'power' | 'turn' | 'hover' | 'range' | 'bite' | 'hooked' | 'tired' | 'air' | 'landed';

export interface FishKitInfo {
  id: string;
  file: string;
  ja: string;
  en: string;
  lengthCm: [number, number];
  typicalCm: number;
}

export declare class FishActor {
  readonly object: THREE.Group;
  readonly info: FishKitInfo;
  /** 体長 m */
  readonly length: number;
  motion: FishKitMotion;
  drive: { speed: number; turnRate: number } | null;
  readonly currentSpeed: number;
  setMotion(m: FishKitMotion): void;
  setDetail(d: 'auto' | 'high' | 'low'): void;
  getMouth(out?: THREE.Vector3): THREE.Vector3;
  update(dt: number): void;
  dispose(): void;
}

export declare const FISH: FishKitInfo[];
export declare const MOTIONS: { id: FishKitMotion; ja: string; en: string; onLine: boolean }[];
export declare function loadFish(baseUrl: string | ((file: string) => string), ids?: string[]): Promise<void>;
export declare function createFish(id: string, lengthCm?: number): FishActor;
export declare function fishStats(id: string): { hiTris: number; loTris: number; texture: unknown } | null;
