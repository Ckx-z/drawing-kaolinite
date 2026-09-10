/**
 * 几何内核（一）：晶体学 —— T-1.3 自 demo/core/crystal.js 移植
 *
 * 移植铁律：逻辑逐位对齐 demo 基线（T-0.1），不做任何"顺手改进"；
 * kernel.test.ts 以 demo 实测数值（2448/3372、7259/6930 等）作回归断言。
 * 与 JS 版的两处刻意差异（不改变数值）：
 *   - ELEMENTS 复用 src/core/elements.ts（数据同源，避免双份维护）；
 *   - 类型化（Atom/Bond 契约见 geometry.ts）。
 *
 * 职责：CIF 解析 / 对称展开 / 晶格数学（示意正交化 D03）/ 超胞切片 / 六方裁剪 /
 *       键连判定（共价半径 + 空间哈希 O(N)）/ 羟基氢 / 边缘饱和
 */
import { getElement } from './elements';
import type { Atom, Bond, Size3 } from './geometry';

/* ---------- CIF ---------- */

export interface CellParams {
  a: number;
  b: number;
  c: number;
  alpha: number;
  beta: number;
  gamma: number;
}

export interface CifSite {
  label: string;
  el: string;
  fx: number;
  fy: number;
  fz: number;
}

export interface ParsedCIF {
  cell: CellParams;
  symops: string[];
  atoms: CifSite[];
}

/** 位点标签 → 元素符号：'O-H1'→'O'，'Al2'→'Al'，'Si1'→'Si' */
export function elementOf(label: string): string {
  const m = /^([A-Z][a-z]?)/.exec(String(label || '').trim());
  return m ? m[1] : 'X';
}

/** CIF 解析（够用即可：_cell_* / 对称操作 / _atom_site_ 三个块） */
export function parseCIF(text: string): ParsedCIF {
  const lines = String(text).split(/\r?\n/);
  const cell: CellParams = { a: 1, b: 1, c: 1, alpha: 90, beta: 90, gamma: 90 };
  const symops: string[] = [];
  const atoms: CifSite[] = [];
  let i = 0;

  const stripQuote = (s: string): string => {
    s = s.trim();
    if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
      s = s.slice(1, -1);
    }
    return s;
  };

  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) {
      i++;
      continue;
    }

    // 多行文本块（; ... ;）—— 跳过
    if (line === ';') {
      i++;
      while (i < lines.length && lines[i].trim() !== ';') i++;
      i++;
      continue;
    }

    // loop_ 块：收集 tag 行，然后按 tag 数量分批读取数据行
    if (/^loop_/i.test(line)) {
      i++;
      const tags: string[] = [];
      while (i < lines.length) {
        const t = lines[i].trim();
        if (t.startsWith('_')) {
          tags.push(t.split(/\s+/)[0].toLowerCase());
          i++;
        } else if (!t) {
          i++;
        } else {
          break;
        }
      }
      const rows: string[][] = [];
      while (i < lines.length) {
        const t = lines[i].trim();
        if (!t || t.startsWith('_') || /^loop_/i.test(t) || /^data_/i.test(t) || t === ';') break;
        // 按空白切分，尊重引号
        const vals = t.match(/'[^']*'|"[^"]*"|\S+/g) ?? [];
        rows.push(vals.map(stripQuote));
        i++;
      }
      if (tags.includes('_atom_site_label')) {
        const ix = tags.indexOf('_atom_site_label');
        const ixX = tags.indexOf('_atom_site_fract_x');
        const ixY = tags.indexOf('_atom_site_fract_y');
        const ixZ = tags.indexOf('_atom_site_fract_z');
        for (const r of rows) {
          if (r.length < tags.length) continue;
          atoms.push({
            label: r[ix],
            el: elementOf(r[ix]),
            fx: parseFloat(r[ixX]),
            fy: parseFloat(r[ixY]),
            fz: parseFloat(r[ixZ]),
          });
        }
      } else if (tags.includes('_space_group_symop_operation_xyz')) {
        const iop = tags.indexOf('_space_group_symop_operation_xyz');
        for (const r of rows) if (r[iop]) symops.push(stripQuote(r[iop]));
      }
      continue;
    }

    // 单标签行
    const m = /^(_[A-Za-z0-9_-]+)\s+(.*)$/.exec(line);
    if (m) {
      const tag = m[1].toLowerCase();
      const val = stripQuote(m[2]);
      if (tag === '_cell_length_a') cell.a = parseFloat(val);
      else if (tag === '_cell_length_b') cell.b = parseFloat(val);
      else if (tag === '_cell_length_c') cell.c = parseFloat(val);
      else if (tag === '_cell_angle_alpha') cell.alpha = parseFloat(val);
      else if (tag === '_cell_angle_beta') cell.beta = parseFloat(val);
      else if (tag === '_cell_angle_gamma') cell.gamma = parseFloat(val);
      else if (tag === '_symmetry_equiv_pos_as_xyz' || tag === '_space_group_symop_operation_xyz') {
        symops.push(val);
      }
    }
    i++;
  }
  if (!symops.length) symops.push('x,y,z');
  return { cell, symops, atoms };
}

/* ---------- 对称操作 ---------- */

type SymopFn = (x: number, y: number, z: number) => [number, number, number];

/** '1/2+x,1/2+y,z' → 三分量仿射函数 */
export function compileSymop(op: string): SymopFn {
  const comps = String(op).replace(/'/g, '').split(',');
  const fns = comps.map((term) => {
    const str = term.replace(/\s/g, '');
    const re = /([+-]?)(\d+\/\d+|\d*\.?\d+)?\*?([xyz])?/g;
    const items: Array<{ sign: number; coef: number; axis: 'x' | 'y' | 'z' | null }> = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(str)) !== null) {
      if (m[0] === '') break;
      const sign = m[1] === '-' ? -1 : 1;
      let coef = 1;
      if (m[2]) {
        const p = m[2].split('/');
        coef = p.length === 2 ? Number(p[0]) / Number(p[1]) : parseFloat(p[0]);
      }
      items.push({ sign, coef, axis: (m[3] as 'x' | 'y' | 'z' | undefined) ?? null });
    }
    return (X: number, Y: number, Z: number): number => {
      let s = 0;
      for (const it of items) {
        const v = it.axis === 'x' ? X : it.axis === 'y' ? Y : it.axis === 'z' ? Z : 1;
        s += it.sign * it.coef * v;
      }
      return s;
    };
  });
  return (x, y, z) => [fns[0](x, y, z), fns[1](x, y, z), fns[2](x, y, z)];
}

const wrap01 = (v: number): number => v - Math.floor(v);

/** 对称展开 + 去重（C 格子中心平移可能重复展开，容差 1e-3） */
export function expandSymmetry(atoms: CifSite[], symops?: string[]): CifSite[] {
  const out: CifSite[] = [];
  for (const op of symops ?? ['x,y,z']) {
    const f = compileSymop(op);
    for (const a of atoms) {
      const p = f(a.fx, a.fy, a.fz);
      out.push({ label: a.label, el: a.el, fx: wrap01(p[0]), fy: wrap01(p[1]), fz: wrap01(p[2]) });
    }
  }
  const dedup: CifSite[] = [];
  for (const a of out) {
    let dup = false;
    for (const b of dedup) {
      if (
        a.el === b.el &&
        Math.abs(a.fx - b.fx) < 1e-3 &&
        Math.abs(a.fy - b.fy) < 1e-3 &&
        Math.abs(a.fz - b.fz) < 1e-3
      ) {
        dup = true;
        break;
      }
    }
    if (!dup) dedup.push(a);
  }
  return dedup;
}

/* ---------- 晶格数学 ---------- */

export interface Lattice {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  cx: number;
  cy: number;
  cz: number;
}

/**
 * 晶格矢量。orthogonal=true 为"示意正交化"（D03）：保留晶轴长度、消去 β/γ 夹角——
 * 机理图而非衍射模拟的取舍：层片水平、z 即层法向，键长畸变 <5%。
 */
export function latticeVectors(cell: CellParams, orthogonal: boolean): Lattice {
  const d = Math.PI / 180;
  const { a, b, c } = cell;
  if (orthogonal) {
    return { ax: a, ay: 0, az: 0, bx: 0, by: b, bz: 0, cx: 0, cy: 0, cz: c };
  }
  const ca = Math.cos(cell.alpha * d);
  const cb = Math.cos(cell.beta * d);
  const cg = Math.cos(cell.gamma * d);
  const sg = Math.sin(cell.gamma * d);
  const v = Math.sqrt(Math.max(1e-9, 1 - ca * ca - cb * cb - cg * cg + 2 * ca * cb * cg));
  return {
    ax: a,
    ay: 0,
    az: 0,
    bx: b * cg,
    by: b * sg,
    bz: 0,
    cx: c * cb,
    cy: (c * (ca - cb * cg)) / sg,
    cz: (c * v) / sg,
  };
}

export interface Cartesian {
  x: number;
  y: number;
  z: number;
}

export function fracToCart(L: Lattice, fx: number, fy: number, fz: number): Cartesian {
  return {
    x: fx * L.ax + fy * L.bx + fz * L.cx,
    y: fx * L.ay + fy * L.by + fz * L.cy,
    z: fx * L.az + fy * L.bz + fz * L.cz,
  };
}

/* ---------- 切片（超胞堆垛） ---------- */

export interface SlabOptions {
  na: number;
  nb: number;
  nc: number;
  d001: number;
  /** T-2.7 晶学严格模式：false（默认）= 示意正交化 */
  orthogonal?: boolean;
}

/**
 * 【切片生成】na×nb×nc 超胞 → 笛卡尔坐标 → 居中。
 * d001 只作用于"层间平移"，不缩放层内厚度（否则调层间距会拉厚 TO 单层）。
 */
export function buildSlab(parsed: ParsedCIF, opts: SlabOptions): { atoms: Atom[]; size: Size3 } {
  const base = expandSymmetry(parsed.atoms, parsed.symops);
  // T-2.7：orthogonal = false 时走晶学严格模式（保留 β/γ 夹角的真实三斜投影，
  // 层间沿真实 c 轴方向堆叠）；默认 true = 示意正交化（D03，路径保持逐字节不变）
  const orthogonal = opts.orthogonal ?? true;
  const L = latticeVectors(parsed.cell, orthogonal);
  const d001 = opts.d001 || parsed.cell.c;
  const atoms: Atom[] = [];
  if (orthogonal) {
    for (let k = 0; k < opts.nc; k++) {
      for (let j = 0; j < opts.nb; j++) {
        for (let i = 0; i < opts.na; i++) {
          for (const a of base) {
            const zIntra = a.fz * parsed.cell.c; // 层内高度（不缩放）
            const p = fracToCart(L, a.fx + i, a.fy + j, 0);
            atoms.push({ label: a.label, el: a.el, x: p.x, y: p.y, z: zIntra + k * d001, layer: k });
          }
        }
      }
    }
  } else {
    // 严格模式：全投影（含层内 fz 的 β 倾斜贡献）；层间沿 c 轴单位向量 × d001
    const cl = Math.hypot(L.cx, L.cy, L.cz) || 1;
    const ucx = L.cx / cl, ucy = L.cy / cl, ucz = L.cz / cl;
    for (let k = 0; k < opts.nc; k++) {
      const lift = k * d001;
      for (let j = 0; j < opts.nb; j++) {
        for (let i = 0; i < opts.na; i++) {
          for (const a of base) {
            const p = fracToCart(L, a.fx + i, a.fy + j, a.fz);
            atoms.push({
              label: a.label, el: a.el, layer: k,
              x: p.x + ucx * lift, y: p.y + ucy * lift, z: p.z + ucz * lift,
            });
          }
        }
      }
    }
  }
  return center(atoms);
}

/**
 * 按堆叠层分桶（层序号 0 基升序返回）。无 layer 标记的原子（分子/颗粒/
 * 手工构造）全部归第 0 桶——"没有层结构"与"单层"在此语义下等价。
 */
export function groupByLayer(atoms: Atom[]): Atom[][] {
  const buckets = new Map<number, Atom[]>();
  for (const a of atoms) {
    const k = a.layer ?? 0;
    const b = buckets.get(k);
    if (b) b.push(a);
    else buckets.set(k, [a]);
  }
  return [...buckets.keys()].sort((x, y) => x - y).map((k) => buckets.get(k)!);
}

/** 正六边形掩膜裁剪：高岭土片层天然呈"假六方"轮廓 */
export function clipHexagon(atoms: Atom[], R: number): Atom[] {
  const out: Atom[] = [];
  for (const a of atoms) {
    if (Math.abs(a.y) <= 0.866 * R && Math.abs(a.x) <= R - Math.abs(a.y) / 1.732) {
      out.push(a);
    }
  }
  return out;
}

/** 包围盒居中（就地修改），返回尺寸 */
export function center(atoms: Atom[]): { atoms: Atom[]; size: Size3 } {
  if (!atoms.length) return { atoms, size: { lx: 0, ly: 0, lz: 0 } };
  let x0 = 1e9;
  let x1 = -1e9;
  let y0 = 1e9;
  let y1 = -1e9;
  let z0 = 1e9;
  let z1 = -1e9;
  for (const a of atoms) {
    if (a.x < x0) x0 = a.x;
    if (a.x > x1) x1 = a.x;
    if (a.y < y0) y0 = a.y;
    if (a.y > y1) y1 = a.y;
    if (a.z < z0) z0 = a.z;
    if (a.z > z1) z1 = a.z;
  }
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const cz = (z0 + z1) / 2;
  for (const a of atoms) {
    a.x -= cx;
    a.y -= cy;
    a.z -= cz;
  }
  return { atoms, size: { lx: x1 - x0, ly: y1 - y0, lz: z1 - z0 } };
}

/* ---------- 键连判定 ---------- */

/**
 * 共价半径判据 + 空间哈希网格 O(N)：
 * d(i,j) < r_cov(i) + r_cov(j) + tol（默认 0.45Å）；H–H 不成键。
 * 卷曲/切片后"重新判键"，拉伸过度的键自然断开（卷管开口端的断键机制）。
 */
export function computeBonds(atoms: Atom[], tol?: number): Bond[] {
  const TOL = tol ?? 0.45;
  const n = atoms.length;
  const bonds: Bond[] = [];
  const CELL = 5.0;
  const map = new Map<string, number[]>();
  const key = (i: number, j: number, k: number): string => `${i}:${j}:${k}`;
  for (let i = 0; i < n; i++) {
    const a = atoms[i];
    const kk = key(Math.floor(a.x / CELL), Math.floor(a.y / CELL), Math.floor(a.z / CELL));
    const arr = map.get(kk);
    if (arr) arr.push(i);
    else map.set(kk, [i]);
  }
  for (let i = 0; i < n; i++) {
    const a = atoms[i];
    const ea = getElement(a.el);
    if (!ea) continue;
    const ix = Math.floor(a.x / CELL);
    const iy = Math.floor(a.y / CELL);
    const iz = Math.floor(a.z / CELL);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const arr = map.get(key(ix + dx, iy + dy, iz + dz));
          if (!arr) continue;
          for (let q = 0; q < arr.length; q++) {
            const j = arr[q];
            if (j <= i) continue;
            const b = atoms[j];
            if (a.el === 'H' && b.el === 'H') continue;
            const eb = getElement(b.el);
            if (!eb) continue;
            const ddx = a.x - b.x;
            const ddy = a.y - b.y;
            const ddz = a.z - b.z;
            const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
            const cut = ea.cov + eb.cov + TOL;
            if (d2 < cut * cut) bonds.push([i, j]);
          }
        }
  }
  return bonds;
}

/* ---------- 羟基氢 / 边缘饱和 ---------- */

/**
 * 羟基氢：1989 年 CIF 未解析 H 位点。位点标签 "O-H*" 为羟基氧，
 * 沿「最近 Al → O」方向延长线 0.98Å 处放置 H（生产版可换 Bish 1993 中子精修 H 坐标）。
 */
export function addHydroxylHydrogens(atoms: Atom[]): Atom[] {
  const als = atoms.filter((a) => a.el === 'Al');
  const added: Atom[] = [];
  for (const a of atoms) {
    if (!(a.label ?? '').startsWith('O-H')) continue;
    let best: Atom | null = null;
    let bd = 1e9;
    for (const b of als) {
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dz = a.z - b.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bd) {
        bd = d2;
        best = b;
      }
    }
    if (!best) continue;
    const d = Math.sqrt(bd) || 1;
    added.push({
      el: 'H',
      label: 'H',
      x: a.x + ((a.x - best.x) / d) * 0.98,
      y: a.y + ((a.y - best.y) / d) * 0.98,
      z: a.z + ((a.z - best.z) / d) * 0.98,
      layer: a.layer, // H 随所属羟基氧的层（层标记语义完整）
    });
  }
  return atoms.concat(added);
}

/**
 * 边缘氢饱和（实验性，T-2.5 升级位点感知）：配位数 <2 的边缘 O 沿片层内径向补 H，
 * 让切片边缘无"悬空氧"。
 */
export function saturateEdges(atoms: Atom[], bonds: Bond[]): Atom[] {
  // T-2.5 升级：区分边缘氧位点并按化学方向补 H——
  //   1 配位（桥氧末端）→ 逆键方向补 1 个 H 成 -OH（消除旧版"径向向心"方向畸变）；
  //   0 配位（孤立悬空 O）→ 沿片层法向/径向补 2 个 H（确定性正交对）；
  //   ≥2 配位或羟基氧（O-H* 位点）→ 不处理。
  const cnt = new Array<number>(atoms.length).fill(0);
  const neighbor = new Array<number>(atoms.length).fill(-1);
  for (const b of bonds) {
    cnt[b[0]]++;
    cnt[b[1]]++;
    if (neighbor[b[0]] < 0) neighbor[b[0]] = b[1];
    if (neighbor[b[1]] < 0) neighbor[b[1]] = b[0];
  }
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const a of atoms) {
    cx += a.x;
    cy += a.y;
    cz += a.z;
  }
  cx /= atoms.length;
  cy /= atoms.length;
  cz /= atoms.length;

  const addH = (o: Atom, dx: number, dy: number, dz: number): Atom => {
    const L = Math.hypot(dx, dy, dz) || 1;
    return {
      el: 'H', label: 'H*', layer: o.layer,
      x: o.x + (dx / L) * 0.98, y: o.y + (dy / L) * 0.98, z: o.z + (dz / L) * 0.98,
    };
  };

  const added: Atom[] = [];
  atoms.forEach((a, i) => {
    if (a.el !== 'O' || cnt[i] >= 2 || (a.label ?? '').startsWith('O-H')) return;
    if (cnt[i] === 1 && neighbor[i] >= 0) {
      // 逆键方向（O 减去邻居方向）——与既有 O-X 键成 ≈180° 反位，sp3 观感自然
      const nb = atoms[neighbor[i]];
      added.push(addH(a, a.x - nb.x, a.y - nb.y, a.z - nb.z));
    } else {
      // 孤立悬空 O：补 2 个 H（径向 + 法向正交对，确定性）
      const vx = a.x - cx, vy = a.y - cy, vz = a.z - cz;
      const L = Math.hypot(vx, vy, vz) || 1;
      added.push(addH(a, vx, vy, vz));
      added.push(addH(a, -vy, vx, (L * 0.6)));
    }
  });
  return atoms.concat(added);
}
