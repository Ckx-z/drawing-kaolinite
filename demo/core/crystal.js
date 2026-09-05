/* ============================================================
 * Kaolin-Assets · 几何内核（一）—— core/crystal.js
 *
 * 职责：
 *   1. CIF（晶体学信息文件）解析
 *   2. 空间群对称操作展开（分数坐标）
 *   3. 晶格坐标变换（三斜/单斜 → 直角坐标，支持"示意正交化"）
 *   4. 【核心算法 · 切片生成】超胞堆垛 → 片层裁剪
 *   5. 键连判定（共价半径判据 + 空间哈希网格，O(N)）
 *   6. 羟基氢生成 / 边缘氢饱和
 *
 * 设计约束：纯数据模块，不依赖 THREE。
 *   ——同一份代码可在 Web Worker 中批量预生成几何，也可在 Node 端
 *     做离线素材烘焙（把常用尺寸的片层/管烘焙进模块库，见技术方案 §5.6）。
 * ============================================================ */
(function (global) {
  'use strict';
  const K = {};

  /* ------------------------------------------------------------
   * 0. 元素数据库：共价半径 / 范德华半径 / 期刊柔和配色
   *    配色原则：低饱和、明度高分离度，浅色背景下层次清晰（对齐 M1 样图审美）
   * ---------------------------------------------------------- */
  K.ELEMENTS = {
    H : { cov: 0.31, vdw: 1.20, color: '#ECECEC', name: '氢' },
    C : { cov: 0.76, vdw: 1.70, color: '#4B4B55', name: '碳' },
    N : { cov: 0.71, vdw: 1.55, color: '#3F66C4', name: '氮' },
    O : { cov: 0.66, vdw: 1.52, color: '#D64550', name: '氧' },
    Na: { cov: 1.66, vdw: 2.27, color: '#E8A33D', name: '钠' },
    Mg: { cov: 1.41, vdw: 1.73, color: '#7FA96B', name: '镁' },
    Al: { cov: 1.21, vdw: 1.84, color: '#C9A2A2', name: '铝' },
    Si: { cov: 1.11, vdw: 2.10, color: '#E2C47E', name: '硅' },
    K : { cov: 2.03, vdw: 2.75, color: '#8E6FB8', name: '钾' },
    Ca: { cov: 1.76, vdw: 2.31, color: '#93B3A5', name: '钙' },
    Ti: { cov: 1.60, vdw: 2.11, color: '#B7C0CA', name: '钛' },
    Fe: { cov: 1.32, vdw: 2.04, color: '#C4744F', name: '铁' },
    Ce: { cov: 1.86, vdw: 2.40, color: '#C77E8E', name: '铈' },
    Zn: { cov: 1.22, vdw: 1.39, color: '#9BA8B5', name: '锌' },
    S : { cov: 1.05, vdw: 1.80, color: '#D9B23A', name: '硫' },
    P : { cov: 1.07, vdw: 1.80, color: '#D97E4A', name: '磷' },
  };

  /** 位点标签 → 元素符号：'O-H1'→'O'，'Al2'→'Al'，'Si1'→'Si' */
  K.elementOf = function (label) {
    const m = /^([A-Z][a-z]?)/.exec(String(label || '').trim());
    return m ? m[1] : 'X';
  };

  /* ------------------------------------------------------------
   * 1. CIF 解析（够用即可：_cell_* / 对称操作 / _atom_site_ 三个块）
   * ---------------------------------------------------------- */
  K.parseCIF = function (text) {
    const lines = String(text).split(/\r?\n/);
    const cell = { a: 1, b: 1, c: 1, alpha: 90, beta: 90, gamma: 90 };
    const symops = [];
    const atoms = [];
    let i = 0;

    const stripQuote = (s) => {
      s = s.trim();
      if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
        s = s.slice(1, -1);
      }
      return s;
    };

    while (i < lines.length) {
      let line = lines[i].trim();
      if (!line || line.startsWith('#')) { i++; continue; }

      // 多行文本块（; ... ;）—— 跳过
      if (line === ';') {
        i++;
        while (i < lines.length && lines[i].trim() !== ';') i++;
        i++; continue;
      }

      // loop_ 块：收集 tag 行，然后按 tag 数量分批读取数据行
      if (/^loop_/i.test(line)) {
        i++;
        const tags = [];
        while (i < lines.length) {
          const t = lines[i].trim();
          if (t.startsWith('_')) { tags.push(t.split(/\s+/)[0].toLowerCase()); i++; }
          else if (!t) i++;
          else break;
        }
        const rows = [];
        while (i < lines.length) {
          const t = lines[i].trim();
          if (!t || t.startsWith('_') || /^loop_/i.test(t) || /^data_/i.test(t) || t === ';') break;
          // 按空白切分，尊重引号
          const vals = t.match(/'[^']*'|"[^"]*"|\S+/g) || [];
          rows.push(vals.map(stripQuote));
          i++;
        }
        if (tags.indexOf('_atom_site_label') >= 0) {
          const ix = tags.indexOf('_atom_site_label');
          const ix_x = tags.indexOf('_atom_site_fract_x');
          const ix_y = tags.indexOf('_atom_site_fract_y');
          const ix_z = tags.indexOf('_atom_site_fract_z');
          for (const r of rows) {
            if (r.length < tags.length) continue;
            atoms.push({
              label: r[ix],
              el: K.elementOf(r[ix]),
              fx: parseFloat(r[ix_x]), fy: parseFloat(r[ix_y]), fz: parseFloat(r[ix_z]),
            });
          }
        } else if (tags.indexOf('_space_group_symop_operation_xyz') >= 0) {
          const iop = tags.indexOf('_space_group_symop_operation_xyz');
          for (const r of rows) if (r[iop]) symops.push(stripQuote(r[iop]));
        }
        continue;
      }

      // 单标签行
      const m = /^(_[A-Za-z0-9_\-]+)\s+(.*)$/.exec(line);
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
  };

  /* ------------------------------------------------------------
   * 2. 对称操作编译与展开
   *    '1/2+x,1/2+y,z' → 三分量仿射函数 → 逐位点复制
   * ---------------------------------------------------------- */
  K.compileSymop = function (op) {
    const comps = String(op).replace(/'/g, '').split(',');
    const fns = comps.map((term) => {
      const str = term.replace(/\s/g, '');
      const re = /([+-]?)(\d+\/\d+|\d*\.?\d+)?\*?([xyz])?/g;
      const items = [];
      let m;
      while ((m = re.exec(str)) !== null) {
        if (m[0] === '') break;
        const sign = m[1] === '-' ? -1 : 1;
        let coef = 1;
        if (m[2]) {
          const p = m[2].split('/');
          coef = p.length === 2 ? Number(p[0]) / Number(p[1]) : parseFloat(p[0]);
        }
        items.push({ sign, coef, axis: m[3] || null });
      }
      return function (X, Y, Z) {
        let s = 0;
        for (const it of items) {
          const v = it.axis === 'x' ? X : it.axis === 'y' ? Y : it.axis === 'z' ? Z : 1;
          s += it.sign * it.coef * v;
        }
        return s;
      };
    });
    return (x, y, z) => [fns[0](x, y, z), fns[1](x, y, z), fns[2](x, y, z)];
  };

  const wrap01 = (v) => v - Math.floor(v);

  K.expandSymmetry = function (atoms, symops) {
    const out = [];
    for (const op of symops || ['x,y,z']) {
      const f = K.compileSymop(op);
      for (const a of atoms) {
        const p = f(a.fx, a.fy, a.fz);
        out.push({ label: a.label, el: a.el, fx: wrap01(p[0]), fy: wrap01(p[1]), fz: wrap01(p[2]) });
      }
    }
    // 去重：C 格子中心平移可能重复展开同一位置（数值容差 1e-3）
    const dedup = [];
    for (const a of out) {
      let dup = false;
      for (const b of dedup) {
        if (a.el === b.el &&
            Math.abs(a.fx - b.fx) < 1e-3 && Math.abs(a.fy - b.fy) < 1e-3 && Math.abs(a.fz - b.fz) < 1e-3) {
          dup = true; break;
        }
      }
      if (!dup) dedup.push(a);
    }
    return dedup;
  };

  /* ------------------------------------------------------------
   * 3. 晶格矢量 / 分数坐标 → 直角坐标
   *    orthogonal = true：示意正交化（保留晶轴长度，消去 β/γ 倾斜）。
   *    这是"机理图"而非衍射模拟的合理取舍：层片保持水平、z 即层法向，
   *    键长畸变 < 5%，视觉不可辨（见技术方案 §5.2）。
   * ---------------------------------------------------------- */
  K.latticeVectors = function (cell, orthogonal) {
    const d = Math.PI / 180;
    const { a, b, c } = cell;
    if (orthogonal) {
      return { ax: a, ay: 0, az: 0, bx: 0, by: b, bz: 0, cx: 0, cy: 0, cz: c };
    }
    const ca = Math.cos(cell.alpha * d), cb = Math.cos(cell.beta * d), cg = Math.cos(cell.gamma * d);
    const sg = Math.sin(cell.gamma * d);
    const v = Math.sqrt(Math.max(1e-9, 1 - ca * ca - cb * cb - cg * cg + 2 * ca * cb * cg));
    return {
      ax: a, ay: 0, az: 0,
      bx: b * cg, by: b * sg, bz: 0,
      cx: c * cb, cy: c * (ca - cb * cg) / sg, cz: c * v / sg,
    };
  };

  K.fracToCart = function (L, fx, fy, fz) {
    return {
      x: fx * L.ax + fy * L.bx + fz * L.cx,
      y: fx * L.ay + fy * L.by + fz * L.cy,
      z: fx * L.az + fy * L.bz + fz * L.cz,
    };
  };

  /* ------------------------------------------------------------
   * 4.【核心算法 · 切片生成】超胞堆垛
   *    na × nb × nc 个晶胞沿 a/b/c 铺开 → 笛卡尔坐标 → 居中
   *
   *    关键点：层间距 d001 只作用于"层与层之间的平移量"，
   *    不缩放层内厚度（否则会把 TO 单层本身拉厚/压薄）。
   *    d001 = 7.4 Å 对应高岭石脱水相；调到 10 Å 即可视作
   *    水合间层（视觉上对应 10Å 埃洛石的管壁间距）。
   * ---------------------------------------------------------- */
  K.buildSlab = function (parsed, opts) {
    const base = K.expandSymmetry(parsed.atoms, parsed.symops);
    const L = K.latticeVectors(parsed.cell, true);
    const d001 = opts.d001 || parsed.cell.c;
    const atoms = [];
    for (let k = 0; k < opts.nc; k++) {
      for (let j = 0; j < opts.nb; j++) {
        for (let i = 0; i < opts.na; i++) {
          for (const a of base) {
            const zIntra = a.fz * parsed.cell.c;          // 层内高度（不缩放）
            const p = K.fracToCart(L, a.fx + i, a.fy + j, 0);
            atoms.push({
              label: a.label, el: a.el,
              x: p.x, y: p.y, z: zIntra + k * d001,
            });
          }
        }
      }
    }
    return K.center(atoms);
  };

  /** 正六边形掩膜裁剪：高岭土片层天然呈"假六方"轮廓（对齐 M1 样图） */
  K.clipHexagon = function (atoms, R) {
    const out = [];
    for (const a of atoms) {
      if (Math.abs(a.y) <= 0.866 * R && Math.abs(a.x) <= R - Math.abs(a.y) / 1.732) {
        out.push(a);
      }
    }
    return K.center(out);
  };

  /** 包围盒居中，返回 { atoms, size:{lx,ly,lz} } */
  K.center = function (atoms) {
    if (!atoms.length) return { atoms, size: { lx: 0, ly: 0, lz: 0 } };
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const a of atoms) {
      if (a.x < x0) x0 = a.x; if (a.x > x1) x1 = a.x;
      if (a.y < y0) y0 = a.y; if (a.y > y1) y1 = a.y;
      if (a.z < z0) z0 = a.z; if (a.z > z1) z1 = a.z;
    }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
    for (const a of atoms) { a.x -= cx; a.y -= cy; a.z -= cz; }
    return { atoms, size: { lx: x1 - x0, ly: y1 - y0, lz: z1 - z0 } };
  };

  /* ------------------------------------------------------------
   * 5.【键连判定】共价半径判据 + 空间哈希网格
   *    成键判据：d(i,j) < r_cov(i) + r_cov(j) + tol（tol 默认 0.45 Å）
   *    H–H 不成键。返回索引对 [i, j]（i < j）。
   *    卷曲/切片后"重新判键"，拉伸过度的键自然断开——这是
   *    卷管开口端自动断键的机制（见 builders.rollToTube）。
   * ---------------------------------------------------------- */
  K.computeBonds = function (atoms, tol) {
    tol = tol == null ? 0.45 : tol;
    const n = atoms.length;
    const bonds = [];
    const CELL = 5.0;
    const map = new Map();
    const key = (i, j, k) => i + ':' + j + ':' + k;
    for (let i = 0; i < n; i++) {
      const a = atoms[i];
      const kk = key(Math.floor(a.x / CELL), Math.floor(a.y / CELL), Math.floor(a.z / CELL));
      let arr = map.get(kk);
      if (!arr) { arr = []; map.set(kk, arr); }
      arr.push(i);
    }
    for (let i = 0; i < n; i++) {
      const a = atoms[i];
      const ea = K.ELEMENTS[a.el];
      if (!ea) continue;
      const ix = Math.floor(a.x / CELL), iy = Math.floor(a.y / CELL), iz = Math.floor(a.z / CELL);
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
              const eb = K.ELEMENTS[b.el];
              if (!eb) continue;
              const ddx = a.x - b.x, ddy = a.y - b.y, ddz = a.z - b.z;
              const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
              const cut = ea.cov + eb.cov + tol;
              if (d2 < cut * cut) bonds.push([i, j]);
            }
          }
    }
    return bonds;
  };

  /* ------------------------------------------------------------
   * 6. 羟基氢生成 / 边缘氢饱和
   * ---------------------------------------------------------- */
  /**
   * 羟基氢：1989 年 CIF 未解析 H 位点。位点标签 "O-H*" 为羟基氧，
   * 沿「最近 Al → O」方向的延长线 0.98 Å 处放置 H（O-H 键向的合理近似，
   * 精确氢键网络对示意图不敏感；生产版可换用 Bish 1993 中子精修 H 坐标）。
   */
  K.addHydroxylHydrogens = function (atoms) {
    const als = atoms.filter((a) => a.el === 'Al');
    const added = [];
    for (const a of atoms) {
      if (!(a.label || '').startsWith('O-H')) continue;
      let best = null, bd = 1e9;
      for (const b of als) {
        const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bd) { bd = d2; best = b; }
      }
      if (!best) continue;
      const d = Math.sqrt(bd) || 1;
      added.push({
        el: 'H', label: 'H',
        x: a.x + (a.x - best.x) / d * 0.98,
        y: a.y + (a.y - best.y) / d * 0.98,
        z: a.z + (a.z - best.z) / d * 0.98,
      });
    }
    return atoms.concat(added);
  };

  /**
   * 边缘氢饱和（实验性）：配位数 < 2 的边缘 O，沿片层内径向补 H。
   * 让切片边缘不出现"悬空氧"，视觉更干净；生产版应区分
   * 桥氧/端氧位点分别补 -OH / =O / -O⁻ 并给出电荷标注。
   */
  K.saturateEdges = function (atoms, bonds) {
    const cnt = new Array(atoms.length).fill(0);
    for (const b of bonds) { cnt[b[0]]++; cnt[b[1]]++; }
    let cx = 0, cy = 0;
    for (const a of atoms) { cx += a.x; cy += a.y; }
    cx /= atoms.length; cy /= atoms.length;
    const added = [];
    atoms.forEach((a, i) => {
      if (a.el !== 'O' || cnt[i] >= 2 || (a.label || '').startsWith('O-H')) return;
      const vx = a.x - cx, vy = a.y - cy;
      const L = Math.hypot(vx, vy) || 1;
      added.push({ el: 'H', label: 'H*', x: a.x + vx / L * 0.98, y: a.y + vy / L * 0.98, z: a.z });
    });
    return atoms.concat(added);
  };

  global.Crystal = K;
  if (typeof module !== 'undefined' && module.exports) module.exports = K;
})(typeof window !== 'undefined' ? window : globalThis);
