/* 几何内核 Node 自测：node test.js
 * 验证 CIF 解析 → 切片 → 卷管 → 颗粒 全链路（无需浏览器） */
require('./crystal');
const K = require('./builders');
const C = require('./crystal');
const fs = require('fs');
const path = require('path');

const cif = fs.readFileSync(path.join(__dirname, '../../data/kaolinite.cif'), 'utf8');
const parsed = C.parseCIF(cif);
console.log('[cif  ] cell =', JSON.stringify(parsed.cell));
console.log('[cif  ] symops =', parsed.symops, ' sites =', parsed.atoms.length);

const expanded = C.expandSymmetry(parsed.atoms, parsed.symops);
console.log('[sym  ] expanded atoms/cell =', expanded.length, '(期望 26：Al4 Si4 O18)');

const sheet = K.buildKaoliniteSheet(cif, { Lx: 60, Ly: 50, layers: 1, d001: 7.4, shape: '矩形', edgeH: false });
const size = C.center(sheet.atoms.map((a) => Object.assign({}, a)));
console.log('[sheet] atoms =', sheet.atoms.length, ' bonds =', sheet.bonds.length, ' size ≈', JSON.stringify(size.size));

const hex = K.buildKaoliniteSheet(cif, { Lx: 70, Ly: 70, layers: 1, d001: 7.4, shape: '六角', edgeH: true });
console.log('[hex  ] atoms =', hex.atoms.length, ' bonds =', hex.bonds.length);

const tube = K.buildHalloysiteTube(cif, { innerR: 14, length: 60, walls: 1, d001: 7.4, progress: 1, taperDeg: 0 });
console.log('[tube ] atoms =', tube.atoms.length, ' bonds =', tube.bonds.length, '(闭合管，期望 bonds 明显大于开卷状态)');

const open = K.buildHalloysiteTube(cif, { innerR: 14, length: 60, walls: 1, d001: 7.4, progress: 0.6, taperDeg: 0 });
console.log('[arc  ] atoms =', open.atoms.length, ' bonds =', open.bonds.length, '(部分卷曲 60%，键数应少于闭合管)');

// 半径校验：闭合管的外接尺寸 ≈ 2×(innerR + 层厚)
let rmin = 1e9, rmax = -1e9;
for (const a of tube.atoms) {
  const r = Math.hypot(a.x, a.z - 14);   // 管轴在 y，圆心 z≈Rmid
  if (r < rmin) rmin = r; if (r > rmax) rmax = r;
}
console.log('[tube ] 内壁半径 ≈', rmin.toFixed(1), 'Å（设定 14）；外壁半径 ≈', rmax.toFixed(1), 'Å（≈14+7.2）');

const part = K.buildParticle({ radius: 9, grains: 150, seed: 7, mode: '簇装' });
console.log('[part ] atoms =', part.atoms.length);
const mol = K.buildMolecule('H₂O');
console.log('[mol  ] H₂O atoms =', mol.atoms.length, ' bonds =', mol.bonds.length);
console.log('ALL OK');
