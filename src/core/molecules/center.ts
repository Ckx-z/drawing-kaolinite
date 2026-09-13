/**
 * 分子几何居中（2026-09-13）：
 * SMILES/化学式构建的分子从原点"生长"，组件原点 ≠ 可见中心（偏差可达数 Å ×
 * 缩放），用户拖拽对齐时分子"偏心"。所有分子构建出口统一减质心，让组件
 * 原点 = 可见中心（与图元对齐、取景计算一致）。键索引不受影响（纯平移）。
 */
interface XYZ {
  x: number;
  y: number;
  z: number;
}

/** 原子集合平移到质心位于原点（返回新数组，不改入参） */
export function centerAtoms<T extends XYZ>(atoms: T[]): T[] {
  if (atoms.length < 2) return atoms; // 单原子/空集已是中心
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const a of atoms) {
    cx += a.x;
    cy += a.y;
    cz += a.z;
  }
  const n = atoms.length;
  cx /= n;
  cy /= n;
  cz /= n;
  return atoms.map((a) => ({ ...a, x: a.x - cx, y: a.y - cy, z: a.z - cz }));
}
