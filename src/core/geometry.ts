/**
 * 几何数据结构 —— 内核与渲染层的唯一契约
 * atoms: 渲染层负责实例化；bonds: [i,j] 索引对（i<j）
 */
export interface Atom {
  /** 元素符号 */
  el: string;
  /** CIF 位点标签（如 'O-H1'），可选 */
  label?: string;
  x: number;
  y: number;
  z: number;
  /** 覆盖默认显示半径（颗粒晶粒用，Å），可选 */
  r?: number;
  /** 堆叠层序号（0 基，buildSlab 生成；分子/颗粒等无层结构的不带），可选 */
  layer?: number;
}

export type Bond = [number, number];

/**
 * 科学几何元数据（2026-09-21 产品闭环）：JSON-safe 纯数据（无 THREE/类实例/函数）
 * ——Worker postMessage structured-clone 与 cache 序列化天然安全；可由 params+CIF
 * 确定性重建的 runtime metadata，不写入 scene schema。
 */
export interface ScientificGeometryMeta {
  /** canonical 资产 id（如 mineral:ceo2，assets/registry.ts 规范） */
  sourceAssetId?: string;
  millerIndex?: [number, number, number];
  /** 表面系法向（表面坐标系恒 [0,0,1]，记录语义） */
  surfaceNormal?: [number, number, number];
  surfaceVectorU?: [number, number, number];
  surfaceVectorV?: [number, number, number];
  termination?: number;
  terminationCount?: number;
  composition?: Record<string, number>;
  geometrySource?: 'reference' | 'generated' | 'relaxed' | 'dft-optimized';
  relaxed?: boolean;
  optimized?: boolean;
  optimizationMethod?: string | null;
}

export interface GeometryData {
  atoms: Atom[];
  bonds: Bond[];
  meta?: Record<string, number> | ScientificGeometryMeta;
}

/** 包围盒尺寸（Å） */
export interface Size3 {
  lx: number;
  ly: number;
  lz: number;
}
