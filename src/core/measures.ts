/**
 * 键长/键角测量（2026-09-13）：
 * Alt+点击原子依次拾取——满 2 点生成键长标注；继续第 3 点升级为键角（替换键长）；
 * Esc 清空拾取。测量是会话态（不进场景文档/撤销栈），但随 PNG/SVG 导出叠画。
 * 原子引用 = (compId, index)：组件变换变化每帧重投影跟随；组件删除该项自动失效。
 */
export interface AtomRef {
  compId: string;
  index: number;
}

export interface Measurement {
  id: string;
  kind: 'bond' | 'angle';
  picks: AtomRef[]; // bond: 2 项；angle: 3 项（顶点 = 第 2 项）
}

export type Vec3 = [number, number, number];

const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** 键角（度）：顶点 v，两臂 a-v / c-v（0°~180°） */
export function angleDeg(a: Vec3, v: Vec3, c: Vec3): number {
  const d1 = [a[0] - v[0], a[1] - v[1], a[2] - v[2]];
  const d2 = [c[0] - v[0], c[1] - v[1], c[2] - v[2]];
  const n1 = Math.hypot(...d1);
  const n2 = Math.hypot(...d2);
  if (!n1 || !n2) return 0;
  const cos = Math.min(1, Math.max(-1, (d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2]) / (n1 * n2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** 测量标签（世界坐标 → 展示文本） */
export function measureLabel(kind: 'bond' | 'angle', pts: Vec3[]): string {
  if (kind === 'bond' && pts.length >= 2) return `d = ${dist(pts[0]!, pts[1]!).toFixed(2)} Å`;
  if (kind === 'angle' && pts.length >= 3)
    return `θ = ${angleDeg(pts[0]!, pts[1]!, pts[2]!).toFixed(1)}°`;
  return '';
}

/**
 * 拾取状态机（纯函数）：Alt+点击一个原子。
 * - 已拾取 → 取消（若取消的是 2 点拾取之一，已有键长测量保留不回收）
 * - 未拾取 → 追加
 * - 满 2 点：产出键长测量（保留拾取，可继续第 3 点）
 * - 满 3 点：升级为键角（同两点键长测量经 removeId 移除），拾取清空
 */
export function pickAtom(
  pick: AtomRef[],
  ref: AtomRef,
  measurements: Measurement[],
  nextId: () => string,
): { pick: AtomRef[]; commit: Measurement | null; removeId: string | null } {
  if (pick.some((p) => p.compId === ref.compId && p.index === ref.index)) {
    return { pick: pick.filter((p) => !(p.compId === ref.compId && p.index === ref.index)), commit: null, removeId: null };
  }
  const next = [...pick, ref];
  if (next.length === 3) {
    return { pick: [], commit: { id: nextId(), kind: 'angle', picks: next }, removeId: bondToUpgrade(measurements, next.slice(0, 2)) };
  }
  if (next.length === 2) {
    return { pick: next, commit: { id: nextId(), kind: 'bond', picks: next }, removeId: null };
  }
  return { pick: next, commit: null, removeId: null };
}

/** 键长 → 键角升级时查找待移除的键长测量 id（两点集合相同，顺序无关） */
export function bondToUpgrade(
  measurements: Measurement[],
  picks: AtomRef[],
): string | null {
  const key = (p: AtomRef) => `${p.compId}#${p.index}`;
  const want = picks.map(key).sort().join('|');
  for (const m of measurements) {
    if (m.kind === 'bond' && m.picks.map(key).sort().join('|') === want) return m.id;
  }
  return null;
}
