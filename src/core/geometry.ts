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

export interface GeometryData {
  atoms: Atom[];
  bonds: Bond[];
  meta?: Record<string, number>;
}

/** 包围盒尺寸（Å） */
export interface Size3 {
  lx: number;
  ly: number;
  lz: number;
}
