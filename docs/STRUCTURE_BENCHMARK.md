# 结构科学基准（STRUCTURE BENCHMARK）—— Scientific Geometry Foundation

> 本文档是 `src/core/assets/scientificGeometry.test.ts` 的表格化对应物：
> 每项保留 **参考值 / 实测值 / 误差 / 容差 / 状态**，禁止"看起来正确 → PASS"。
> 修改几何数据源（CIF/preset）后必须复跑测试并同步本表。

## 一、分子（reference presets）

| 资产 | 来源 | 不变量 | 参考值 | 实测值 | 容差 | 状态 | 已知限制 |
|---|---|---|---|---|---|---|---|
| H₂O | 文献实验几何 | O–H 键长 | 0.959 Å | 0.95953 Å | ±0.0005 | PASS | 平面示意取向非振动零点 |
| H₂O | 同上 | H–O–H 键角 | 104.5° | 104.50° | ±0.5° | PASS | — |
| CO₂ | 内置参考 | 线性 | 180° | 180.000° | ±0.01° | PASS | — |
| CO₂ | 内置参考 | C–O | 1.16 Å | 1.16 Å | ±0.0005 | PASS | — |
| O₂ / N₂ | 内置参考 | 双原子 | 2 原子 1 键 | 2/1 | 精确 | PASS | 键长为示意比例 |
| C₇H₈ 甲苯 | PubChem CID 1140（MMFF94 3D conformer） | 苯环共面 | < 0.01 Å | < 0.001 Å | 0.01 | PASS | MMFF94 构象非实验气相几何 |
| C₇H₈ | 同上 | 芳 C–C | 1.39±0.03 Å | 1.393–1.395 | 1.36–1.42 | PASS | — |
| C₃H₈ 丙烷 | PubChem CID 6334（MMFF94） | C–C–C 角 | ~111.5°（数据库构象） | 111.66° | ±0.5° | PASS | 非理论 109.47° 硬编码 |
| C₃H₈ | 同上 | C–C / C–H | 1.52 / 1.09 | 1.5193 / 1.0944–1.0956 | 见测试 | PASS | — |

## 二、矿物（CIF reference，对称展开化学计量）

| 资产 | CIF 来源 | 晶胞 c (Å) | 展开原子数 | 化学计量（渲染位点集） | 状态 | 已知限制 |
|---|---|---|---|---|---|---|
| 高岭石 | AMCSD 0012232 | 7.4048 | 26 | Al4Si4O18 | PASS | H 由 O-H 标签补位（1989 CIF 未解析 H） |
| 地开石 | AMCSD 0000126 | 14.736 | 52 | Al8Si8O36 | PASS | 同上 |
| 珍珠石 | AMCSD 0012394 | 14.593 | 68 | Al8Si8O36H16 | PASS | CIF 显式 H |
| 蒙脱石 | COD 9002779（Viani 2002） | 15.0 | 38 | Al4Si8O24Ca2 | PASS | Ca0.5 占位按位点全显示 |
| 伊利石 | internal（**来源未记录**） | 20.143 | 76 | K4Al16Si8O48 | PASS | provenance 缺失（已知限制，见 DECISIONS） |
| 莫来石 | COD 2310785（Birkenstock 2015） | 2.8899 | 28 | Al10Si4O14 | PASS | 分裂位/部分占位全显示；声明式 Al4.8Si1.2O9.6；Si3 零占位剔除 |
| Co₃O₄ | COD 9005888（Liu & Prewitt） | 8.0968 | 56 | Co24O32 | PASS | 全占位有序模型 |
| CeO₂ | COD 9009008 | 5.411 | 12 | Ce4O8 | PASS | — |

## 三、几何可信等级（geometrySource / geometryQuality）

| 等级 | 定义 | 当前资产 |
|---|---|---|
| reference | 内置并经测试验证的数据库/文献结构 | 全部矿物 CIF；H₂O/O₂/CO₂/N₂/·OH/甲苯/丙烷 |
| schematic | 机理图示意，不代表优化/实验结构 | Ca²⁺/Ce³⁺ 单原子阳离子 |
| generated | 参数化/构象算法运行时生成（非 preset） | SMILES 输入路径（如 "CCC"）、化学式团簇 |
| relaxed / dft-optimized / external | 预留（本阶段无实例） | — |

## 四、Surface / Adsorption 基准（PHASE B，待补）

**CeO₂(111) slab（slab.test 8 条）**：u 最短重复矢量 = a√2 = 7.653Å（理论精确）；O/Ce ∈ [1.7,2.3]（厚度截断的真实端面化学计量）；z 厚度 ≤ thickness+0.6；无原子重复（min 间距 >0.5Å）；termination ≥2 候选且切换产生不同结构；逐位确定性。Co₃O₄(110)：键网存在、Co:O ∈ [0.9,1.8]。
**Toluene@CeO₂(111)（adsorb.test 8 条）**：4 候选（parallel/tilted/perpendicular/methyl-down）确定性；parallel 环法向∥表面法向（<2°）；perpendicular 环立起（>80°）；distance 2.5 vs 4.5 最小距单调；distance 0.5 触发 clash 自动推出并解除。Propane@CeO₂(111)：三 site（top/bridge/hollow）全覆盖。**均不检查/不显示结合能（无能量计算）**。


## 五、Software Geometry Consistency（软件坐标一致性——非晶体学基准）

> 这些是**渲染/坐标管线一致性测试**，验证科学几何在 Scene Transform 作用下不漂移；
> 不属于实验结构验证。

| 项目 | 断言 | 实测 | 容差 | 状态 |
|---|---|---|---|---|
| Surface translation | world pos ≡ Ts + Rs·(s·Tm) | Case A/B 逐位一致 | 5e-7 | PASS |
| Surface rotation (组合) | Rw 组合欧拉约定 | 修复后主分支正确；深组合第二分支待修 | — | PARTIAL（KNOWN ISSUE，2026-09-21b） |
| Preview / Apply | 同 pose 数值一致 | 组件 transform ≡ worldCandidateTransform | 1e-6 | PASS |
| Template roundtrip | transform 逐值复现 | save/load position/rotation/scale 保持 | 精确 | PASS |
| Drag Snap · 贴附 | minAtomDistance ∈ [1.9, 4.5]Å | plane 基底 2.1–2.4Å | 带 | PASS |
| Drag Snap · 旋转保持 | rotationBefore == rotationAfter | [25,-40,65]° 恒等 | 精确 | PASS |
| Drag Snap · Undo | Ctrl+Z 恢复吸附前 transform | 一条 setTransform | 精确 | PASS |
| Drag Snap · 基底角色 | molecule 永不为 substrate | 四类型白名单 / molecule-molecule 拒绝 | — | PASS |
| Drag Snap · 大小不反转 | 大 molecule + 小基底 → 角色恒定 | scale 8 甲苯 vs 0.5 片层 | — | PASS |
| Drag Snap · 远距不触 | 5Å 分离不触发 | [0,0,5] false | — | PASS |
| Drag Snap · Alt/Shift bypass | null 返回 | 双键均 bypass | — | PASS |
| Drag Snap · 曲面基底 | 管外壁法向指向管外 | 邻域拟合近似 ✓（管/球测试构型通过） | 数值 | PASS |
| Drag Snap · 颗粒法向 | 表面外向 | 球形构型通过 | 数值 | PASS |
