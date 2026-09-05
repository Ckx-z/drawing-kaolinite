/* ============================================================
 * Kaolin-Assets · 几何内核（二）—— core/builders.js
 *
 * 参数化素材生成器：每个素材类型 = 一个纯函数 (params) → { atoms, bonds }
 *   · buildKaoliniteSheet   高岭土片层（CIF → 切片 → 堆叠 → 六方裁剪 → 边缘饱和）
 *   · buildHalloysiteTube   埃洛石管（片层 → 保弧长卷曲，进度 0~1 可动画）
 *   · buildParticle         纳米颗粒（光滑球 / 簇装球，CeO₂ 风格）
 *   · buildMolecule         小分子 / 离子（内置库）
 *   · buildSubstrate        橡胶基底（圆角软质平板，返回 BufferGeometry）
 *
 * 统一约定：素材数据层只有 atoms + bonds，渲染层负责变成 InstancedMesh。
 *   atoms: { el, x, y, z, r? }   r 可选，覆盖默认显示半径（颗粒晶粒用）
 *   bonds: [ [i, j], ... ]
 * ============================================================ */
(function (global) {
  'use strict';
  const K = {};
  const C = global.Crystal;

  /* 确定性伪随机（同一种子同一颗粒形，保证模块复现） */
  function mulberry32(seed) {
    let t = (seed >>> 0) || 1;
    return function () {
      t += 0x6D2B79F5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }
  K.mulberry32 = mulberry32;

  /* ============================================================
   * 素材 1：高岭土片层
   * ------------------------------------------------------------
   * 参数：Lx, Ly (Å 目标尺寸) / layers (堆叠层数 1~3) / d001 (层间距 Å)
   *       shape ('矩形' | '六角') / edgeH (边缘羟基饱和)
   * 管线：parseCIF → expandSymmetry → buildSlab(超胞)
   *       → [六角裁剪] → 补羟基氢 → 判键 → [边缘饱和]
   * ============================================================ */
  K.buildKaoliniteSheet = function (cifText, p) {
    const parsed = C.parseCIF(cifText);
    const na = Math.max(2, Math.round(p.Lx / parsed.cell.a));
    const nb = Math.max(2, Math.round(p.Ly / parsed.cell.b));
    const slab = C.buildSlab(parsed, { na: na, nb: nb, nc: p.layers, d001: p.d001 });
    let atoms = slab.atoms;
    if (p.shape === '六角') {
      atoms = C.clipHexagon(atoms, Math.min(p.Lx, p.Ly) * 0.52).atoms;
      C.center(atoms);
    }
    atoms = C.addHydroxylHydrogens(atoms);
    const bonds = C.computeBonds(atoms);
    if (p.edgeH) atoms = C.saturateEdges(atoms, bonds);
    return { atoms: atoms, bonds: bonds, meta: { na: na, nb: nb } };
  };

  /* ============================================================
   * 素材 2：埃洛石管 ——【核心算法 · 片层卷成管状】
   * ------------------------------------------------------------
   * 数学：保弧长等距（isometric）映射，把平面片层卷到圆柱/圆锥面上。
   *
   *   设片层长 Lx（沿卷曲方向），卷曲角 φ = progress × 2π，
   *   中面半径 Rmid = Lx / φ（progress = 1 时恰为闭合圆管）。
   *   对片层中任一原子，u 为其沿卷曲方向坐标，δz 为其相对片层中面的高度：
   *
   *     锥形时   Rm(u) = Rmid + (u − Lx/2)·tanα        局部半径（圆锥）
     *     卷曲角   θ(u)  = φ · F(u) / F(Lx)，  F(u) = ∫₀ᵘ du'/Rm(u')
     *              （t→0 退化为线性 θ = φ·u/Lx）
     *     径向     r     = Rm(u) − δz              +δz 面卷向管内
     *     坐标     X = r·sinθ,  Z = Rmid − r·cosθ,  Y = y
     *
   *   物理含义：
   *     · δz > 0 一侧（本 CIF 中为 Al-OH 面）半径更小 → 卷后朝内，
   *       与真实埃洛石"铝羟基面为内壁、硅氧面为外壁"一致；
   *     · 弧长按各自半径保持 → 内壁受压、外壁受拉，符合等距弯曲；
   *     · 键连在卷曲后"重新判定"，弯曲两端若未闭合（φ < 2π）
   *       键自然断开 —— 得到开口管，无需手工断键。
   *
   * 参数：innerR (内半径 Å) / length (Å) / walls (管壁层数 1~3)
   *       progress (卷曲进度 0~1，可做"片→管"动画) / taperDeg (锥角 0~25°)
   * ============================================================ */
  K.buildHalloysiteTube = function (cifText, p) {
    const parsed = C.parseCIF(cifText);
    // 圆周方向用 a 轴：na 个晶胞 ≈ 2π·(内半径 + 半层厚)；层厚近似 7.2 Å 的一半
    const na = Math.max(6, Math.round(2 * Math.PI * (p.innerR + 3.6) / parsed.cell.a));
    const nb = Math.max(2, Math.round(p.length / parsed.cell.b));
    const slab = C.buildSlab(parsed, { na: na, nb: nb, nc: p.walls, d001: p.d001 || 7.4 });
    let atoms = C.addHydroxylHydrogens(slab.atoms);

    // 去掉卷曲方向末端一列原子（x = xMax），避免 progress = 1 时首尾重叠
    let x0 = 1e9, x1 = -1e9;
    for (const a of atoms) { if (a.x < x0) x0 = a.x; if (a.x > x1) x1 = a.x; }
    const eps = (x1 - x0) * 1e-4;
    atoms = atoms.filter((a) => a.x < x1 - eps);

    const rolled = K.rollToTube(atoms, { progress: p.progress, taperDeg: p.taperDeg });
    const bonds = C.computeBonds(rolled);
    return { atoms: rolled, bonds: bonds, meta: { na: na, nb: nb } };
  };

  /**
   * 卷曲变换（纯几何，输入任意平面原子组，输出卷曲后原子组）。
   * 独立导出：可复用于"部分卷曲/卷纸"类创意形态，也可做逐帧动画。
   */
  K.rollToTube = function (atoms, p) {
    const progress = Math.min(1, Math.max(0.001, p.progress || 0.001));
    const phi = progress * Math.PI * 2;
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const a of atoms) {
      if (a.x < x0) x0 = a.x; if (a.x > x1) x1 = a.x;
      if (a.z < z0) z0 = a.z; if (a.z > z1) z1 = a.z;
    }
    const Lx = Math.max(1e-6, x1 - x0);
    const half = Lx / 2;
    const zMid = (z0 + z1) / 2;
    const Rmid = Lx / phi;                       // 中面半径（progress=1 → 闭合）
    const t = Math.tan(Math.min(40, Math.abs(p.taperDeg || 0)) * Math.PI / 180) *
              Math.sign(p.taperDeg || 0);
    // 防止锥角过大导致负半径
    const tMax = (Rmid * 0.9) / Math.max(half, 1e-6);
    const tc = Math.max(-tMax, Math.min(tMax, t));

    // F(u) = ∫₀ᵘ du′/Rm(u′)：圆柱时线性，圆锥时为对数
    const Fof = (u) => {
      if (Math.abs(tc) < 1e-6) return u / Rmid;            // 圆柱情形
      return Math.log((Rmid + (u - half) * tc) / (Rmid - half * tc)) / tc;
    };
    const Ftot = Fof(Lx) - Fof(0) || 1e-9;

    const out = new Array(atoms.length);
    for (let i = 0; i < atoms.length; i++) {
      const a = atoms[i];
      const u = a.x - x0;
      const theta = phi * (Fof(u) - Fof(0)) / Ftot;
      const Rm = Rmid + (u - half) * tc;                    // 该处的局部半径
      const r = Rm - (a.z - zMid);                          // 径向映射
      out[i] = {
        el: a.el, label: a.label, r: a.r,
        x: r * Math.sin(theta),
        y: a.y,
        z: Rmid - r * Math.cos(theta),
      };
    }
    return out;
  };

  /* ============================================================
   * 素材 3：纳米颗粒（CeO₂ 风格簇装球 / 光滑球）
   * ------------------------------------------------------------
   * cluster：斐波那契球面布点 + 径向抖动 → "小晶粒堆聚"外观
   *   （对齐参考样例中 HNT@CeO₂ 的颗粒质感）；Ce:O ≈ 1:2 交替上色。
   * smooth：二十面体球 + 低频噪声起伏 → 熔融/无定形颗粒。
   * ============================================================ */
  K.buildParticle = function (p) {
    const rng = mulberry32(p.seed || 7);
    const R = p.radius;
    const atoms = [];
    if (p.mode === '光滑') {
      // 低频噪声球：半径随三个互质频率正弦起伏 ±5%
      const N = 160;
      for (let i = 0; i < N; i++) {
        const y = 1 - ((i + 0.5) / N) * 2;
        const rr = Math.sqrt(1 - y * y);
        const th = i * 2.39996;
        const dir = [rr * Math.cos(th), y, rr * Math.sin(th)];
        const bump = 1 + 0.05 * (Math.sin(5 * dir[0] * R + 1) + Math.sin(4 * dir[1] * R + 2) + Math.sin(6 * dir[2] * R)) / 3;
        const rad = R * bump * (0.97 + rng() * 0.06);
        atoms.push({ el: rng() < 0.25 ? 'Ce' : 'O', x: dir[0] * rad, y: dir[1] * rad, z: dir[2] * rad });
      }
      // 中心骨架若干原子，避免侧视时"空心"
      for (let i = 0; i < 40; i++) {
        const d = [rng() - 0.5, rng() - 0.5, rng() - 0.5];
        const L = Math.hypot(d[0], d[1], d[2]) || 1;
        const rad = R * 0.5 * Math.cbrt(rng());
        atoms.push({ el: rng() < 0.4 ? 'Ce' : 'O', x: d[0] / L * rad, y: d[1] / L * rad, z: d[2] / L * rad });
      }
    } else {
      const K = Math.max(30, p.grains || 150);
      const grainBase = R * 3.4 / Math.sqrt(K);          // 晶粒半径随数量自适应
      for (let i = 0; i < K; i++) {
        const y = 1 - ((i + 0.5) / K) * 2;
        const rr = Math.sqrt(1 - y * y);
        const th = i * 2.39996;                          // 黄金角
        const shell = R * (0.6 + rng() * 0.22);          // 壳层半径抖动
        const el = i % 3 === 0 ? 'Ce' : 'O';
        atoms.push({
          el: el,
          x: rr * Math.cos(th) * shell, y: y * shell, z: rr * Math.sin(th) * shell,
          r: grainBase * (el === 'Ce' ? 1.12 : 0.92) * (0.9 + rng() * 0.2),
        });
      }
      // 内部填充 + 中心核
      for (let i = 0; i < Math.floor(K * 0.45); i++) {
        const d = [rng() - 0.5, rng() - 0.5, rng() - 0.5];
        const L = Math.hypot(d[0], d[1], d[2]) || 1;
        const rad = R * 0.62 * Math.cbrt(rng());
        const el = i % 3 === 0 ? 'Ce' : 'O';
        atoms.push({
          el: el, x: d[0] / L * rad, y: d[1] / L * rad, z: d[2] / L * rad,
          r: grainBase * (el === 'Ce' ? 1.1 : 0.9) * (0.9 + rng() * 0.2),
        });
      }
    }
    return { atoms: atoms, bonds: [], meta: { n: atoms.length } };
  };

  /* ============================================================
   * 素材 4：小分子 / 离子内置库（Å 坐标，标准键长键角）
   * ============================================================ */
  K.MOLECULES = {
    'H₂O': {
      atoms: [
        { el: 'O', x: 0, y: 0, z: 0 },
        { el: 'H', x: 0.759, y: 0.587, z: 0 },
        { el: 'H', x: -0.759, y: 0.587, z: 0 },
      ],
      bonds: [[0, 1], [0, 2]],
    },
    'O₂': {
      atoms: [{ el: 'O', x: -0.60, y: 0, z: 0 }, { el: 'O', x: 0.60, y: 0, z: 0 }],
      bonds: [[0, 1]],
    },
    'CO₂': {
      atoms: [
        { el: 'C', x: 0, y: 0, z: 0 },
        { el: 'O', x: -1.16, y: 0, z: 0 }, { el: 'O', x: 1.16, y: 0, z: 0 },
      ],
      bonds: [[0, 1], [0, 2]],
    },
    'N₂': {
      atoms: [{ el: 'N', x: -0.55, y: 0, z: 0 }, { el: 'N', x: 0.55, y: 0, z: 0 }],
      bonds: [[0, 1]],
    },
    'Ca²⁺': { atoms: [{ el: 'Ca', x: 0, y: 0, z: 0 }], bonds: [] },
    'Ce³⁺': { atoms: [{ el: 'Ce', x: 0, y: 0, z: 0 }], bonds: [] },
    '·OH (羟基自由基)': {
      atoms: [{ el: 'O', x: 0, y: 0, z: 0 }, { el: 'H', x: 0.97, y: 0, z: 0 }],
      bonds: [[0, 1]],
    },
  };
  K.buildMolecule = function (kind) {
    const m = K.MOLECULES[kind] || K.MOLECULES['H₂O'];
    return { atoms: m.atoms.map((a) => Object.assign({}, a)), bonds: m.bonds.map((b) => b.slice()) };
  };

  /* ============================================================
   * 素材 5：橡胶基底（圆角平板，返回 BufferGeometry；由渲染层上材质）
   * ============================================================ */
  K.buildSubstrate = function (p, THREE) {
    const Lx = p.Lx, Ly = p.Ly, T = p.thickness;
    const rc = Math.min(Lx, Ly) * 0.16;
    const s = new THREE.Shape();
    const x0 = -Lx / 2, y0 = -Ly / 2;
    s.moveTo(x0 + rc, y0);
    s.lineTo(x0 + Lx - rc, y0);
    s.quadraticCurveTo(x0 + Lx, y0, x0 + Lx, y0 + rc);
    s.lineTo(x0 + Lx, y0 + Ly - rc);
    s.quadraticCurveTo(x0 + Lx, y0 + Ly, x0 + Lx - rc, y0 + Ly);
    s.lineTo(x0 + rc, y0 + Ly);
    s.quadraticCurveTo(x0, y0 + Ly, x0, y0 + Ly - rc);
    s.lineTo(x0, y0 + rc);
    s.quadraticCurveTo(x0, y0, x0 + rc, y0);
    const geo = new THREE.ExtrudeGeometry(s, {
      depth: T, bevelEnabled: true, bevelThickness: 0.55, bevelSize: 0.55,
      bevelSegments: 3, curveSegments: 10,
    });
    geo.rotateX(-Math.PI / 2);          // 挤出方向 → 竖直（y 轴），顶面朝上
    geo.translate(0, T / 2, 0);
    return geo;
  };

  global.Builders = K;
  if (typeof module !== 'undefined' && module.exports) module.exports = K;
})(typeof window !== 'undefined' ? window : globalThis);
