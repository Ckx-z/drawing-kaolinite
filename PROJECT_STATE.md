# PROJECT_STATE — 项目当前状态

> ⭐ **这是每次会话的第一份必读文件**。会话开头读它进入状态，结尾更新它。
> 最后更新：2026-09-06（T-2.7 晶学严格模式完成；P2 已完成 12 条，剩余 T-2.5 / PDF / 对账脚本）

---

## 一、项目定位（一句话）

**面向高岭土/黏土矿物科研的模块化机理图绘制软件**：以 CIF 晶体学数据 + 参数化几何内核程序化生成"片层/纳米管/颗粒/分子/基底"素材，像搭积木一样组合成 SCI 论文与 PPT 汇报用的 2D/3D 机理图；**存参数不存网格**，模块永久可无损二次编辑。

- **任务形态**：科研绘图工具（非结构查看器、非模拟软件）
- **技术路线**：Web 端优先（TypeScript + React + Three.js/WebGL2），后期 Tauri 打包桌面端（D01）
- **核心卖点**：模块库沉淀 —— 课题组半年积累 8–10 个成品模块，新学生一键复用
- **当前形态**：技术验证 Demo 已跑通全链路；生产工程（src/）尚未启动

---

## 二、当前阶段

| 阶段 | 内容 | 状态 |
|---|---|---|
| **阶段 0** | 技术验证：方案文档 + 几何内核（CIF/切片/卷曲）+ 三维 Demo 全链路实测 | ✅ **已完成**（2026-09-04） |
| **阶段 0.5** | 工程治理：Git 仓库、TODO 清单（47 条）、Q1–Q4 决策闭环、记忆系统骨架（T-8.1） | ✅ **已完成**（2026-09-05） |
| **阶段 1** | P0 工程基座：T-1.1 ~ T-1.7（Vite+TS+React 脚手架 → Schema → 内核 TS 移植 → 渲染服务 → 状态管理 → UI 迁移 → 回归验收） | ✅ **已完成**（2026-09-05，7/7，对峙验收全过） |
| **阶段 2（当前）** | P1（T-2.1/2.2/2.3、T-3.1、T-5.1、T-9.1/9.2）+ P2 出版功能（T-3.2 检索收藏 / T-3.3 锁定分组 / T-4.1 双轨渲染 / T-4.2 色板 / T-5.3 分组 SVG / T-5.4 分层 PNG / T-7.1 拾取高亮 / T-2.8 SMILES 导入）| 🔶 **进行中**——P1 全收官 ✅、素材 9/8-10 达成 ✅、P2 已完成 8 条；**模块库现有 9 个模块** |
| 阶段 3+ | P2–P3：双轨渲染 / 矢量导出 / 桌面端 / 素材积累至 8–10 个模块 | ⬜ 未开始 |

---

## 三、下一步（按优先级）

1. **T-7.1 拾取高亮 / 悬停反馈**（依赖 T-1.6 ✅，约 1d）
2. **T-4.3 SSAO / 接触阴影 + 构图预设**（P2，依赖 T-1.4 ✅）
3. **T-3.2 收尾确认 / T-8.2 `check_library_state.py` 对账脚本**（P2，可并行）
4. P2 完成后即具备半年路线图"第 3–4 月质量与矢量"阶段主体

完整任务清单见 `TODO.md`（47 条，含依赖关系与验收标准）。

---

## 四、阻塞点

无。

## 五、待跟进事项

- [ ] T-8.2 / T-8.3（记忆系统对账脚本与双轨日报常态化，P2，可并行）
- [ ] 每次会话结束：更新本文件 + 双轨日报 + session_index（见 `.agents/AGENTS.md` 结尾清单）

---

## 六、关键资产速查

| 资产 | 位置 | 说明 |
|---|---|---|
| 技术方案 | `docs/技术方案设计.md` | 架构 / 算法推导 / 路线图（决策 D01–D04 的依据） |
| 任务清单 | `TODO.md` | 47 条任务 + 依赖 + 验收标准 + 顶部四项已决策记录 |
| 几何内核（JS 基线） | `demo/core/crystal.js` `builders.js` | T-1.3 移植源；`node demo/core/test.js` 回归 |
| 生产工程 | `src/` + `package.json` | T-1.1 脚手架：`npm run dev/build/test/lint` 全通；`src/core/elements.ts` 为类型化元素库 |
| 数据模型 | `src/core/schema.ts` + `types.ts` | T-1.2：zod 4 strictObject；demo 兼容（无 id 组件→normalizeScene 补齐）；serializeScene/deserializeScene/deserializeModule |
| 几何内核（TS） | `src/core/crystal.ts` `builders.ts` `geometry.ts` | T-1.3：逻辑=demo 基线逐位复现；`npm run test` 35 条回归（kernel.test.ts 基线断言） |
| 渲染服务 | `src/render/RendererService.ts` + materials/instanced/substrate | T-1.4：组件装载/重建/选择/取景；`?preview=1` 浏览器预览（16,097 原子与 demo 一致）；three r147 |
| 状态管理 | `src/state/sceneStore.ts` + `rendererBinding.ts` | T-1.5：zustand 5 vanilla 工厂化 store（写操作全 schema 校验）；绑定层差异同步 + rAF 重建节流（调度器可注入）；远端仓库 github.com/Ckx-z/drawing-kaolinite（SSH，master） |
| 冒烟回归 | `e2e/smoke.spec.ts` + `e2e/fixtures/demo-scene.json` | T-1.7：8 条 Playwright 冒烟（@playwright/test 未装，已用 IAB 浏览器逐条人工实测）；fixture=demo 原生保存输出 |
| TIFF 导出 | `src/export/tiff.ts` | T-5.1：内置无压缩 RGBA TIFF 编码器（dpi 物理分辨率标签 + 透明底，零依赖 Node 可测）；resolveExportSize 按 maxTextureSize 降级；浏览器实测 sips 读出 300×300dpi ✓ |
| 双轨渲染 | `src/render/toon.ts` | T-4.1：线稿档（Toon 3 阶色阶+描边外壳）/渲染档（PBR）一键热切换；实测切换 10.7ms 不重建几何；像素抽样线稿档无高光（35 阶 vs 67 阶，maxLum 0.913 vs 1.0） |
| 色板 | `src/render/palette.ts` | T-4.2：4 套学术色板（期刊柔和/暖调/冷调/高对比）+ 逐元素覆盖；palette 随场景 JSON 往返；换色即时重着色不重建几何 |
| SVG 导出 | `src/export/svg.ts` | T-5.3：分组 SVG（原子→circle/键→line，透视投影+画家排序，g id=图层名）；弃用 THREE.SVGRenderer（不支持 InstancedMesh）；浏览器实测 16,097 circle/xmllint VALID |
| 分层 PNG | `src/export/layers.ts` | T-5.4：逐层透明 PNG（exportComponentPNG 隔离渲染 + 画家序）；实测叠层合成 vs 整图像素差 0.04%（验收 <1%） |
| 拾取高亮 | `src/render/highlight.ts` | T-7.1：悬停/选中反转法线外壳（1.10/1.14 橙系）+ hoverStore 双向联动（画布 BBox 轻量拾取 80ms 节流 ↔ 面板行悬停） |
| SMILES 导入 | `src/core/molecules/smiles.ts` | T-2.8：内置解析器+规则式 3D 构象（替代 RDKit WASM 的零依赖方案，示意级精度、确定性）；molecule.smiles 参数随场景持久化；Worker+主线程双路接入；UI 在素材库面板 |
| 阴影与构图 | `src/render/postfx.ts` | T-4.3：接触阴影（shadow map + ShadowMaterial 地板，62fps@16k 原子）+ 构图预设（等距/正视/俯视/水平吸附，同视距可复现） |
| 网格缓存 | `src/core/cache.ts` | T-2.9：内容寻址缓存引擎（kind+参数指纹+CIF 指纹，LRU 40 条）+ 预烘焙 10 管组合；实测命中实例化 14ms（验收 <50ms） vs 未命中 94ms |
| PDF 导出 | `src/export/pdf.ts` | T-5.2：jsPDF 页面物理尺寸 = 设定 cm 数（MediaBox pt 精确换算），位图满幅嵌入 |
| 对账脚本 | `scripts/check_library_state.py` | T-8.2：必需文件/文档新鲜度/种子库完整性/git 状态/内核基线五组检查（--with-tests 可选）；退出码 0/1 |
| 管形貌选项 | `src/core/builders.ts` | T-2.6：curlAxis a/b 双向卷曲（半径校验一致）+ portNoise 端口确定性噪声（键数变化 <5%）；管参数随场景持久化 |
| 晶学严格模式 | `src/core/crystal.ts` | T-2.7：sheetParams.strictCell 开关——真实三斜投影（全投影+层间沿 c 轴堆叠，层片倾斜）；Si–O 键长与 CIF 距离矩阵偏差 <0.5%；默认示意正交化（D03 后路落地） |
| 模块库 | `src/state/moduleLibrary.ts` + `src/ui/ModulePanel.tsx` | T-2.3：Dexie 4 IndexedDB + 内存缓存 + localStorage 迁移 + 导入导出；T-3.2：filterModules 检索/类型筛选/收藏排序 + toggleFavorite（favorite 字段向后兼容） |
| 撤销/重做 | `src/state/history.ts` + `commands.ts` | T-2.1：attachHistory 实例包装（UI 零改动）；全量快照命令 + 800ms 合并窗口；栈深可配（默认 100）；Ctrl/Cmd+Z、+Shift/Y（App.tsx）；sceneStore 单例已挂接（sceneHistory） |
| 素材模块 | 模块库内 9 个条目 | M2 三层片层、M3 埃洛石管 7Å、M4 颗粒 S/M/L、M5 橡胶基底、M6 片层+颗粒组合、M7 多壁埃洛石 10Å、M8 埃洛石@CeO₂ 复合场景——**素材积累目标达成（9/8-10，M1 样图另计）** |
| 种子模块库 | `data/seed-modules.json` | kaolin-modules/v1 全量备份（M2~M8 共 9 条含缩略图，33KB）；模块面板「导入」即可整套恢复/分发 |
| 三维 Demo | `demo/index.html` | 双击可用；生产版功能对照基准 |
| CIF 种子库 | `data/*.cif` | 高岭石/地开石/珍珠石/蒙脱石/伊利石 |
| 决策日志 | `DECISIONS.md` | D01–D08 |
| 参数字典 | `DATA_DICT.md` | 五类组件参数 + 场景 JSON schema |

---
*本文件每次会话结束时检查更新（见 AGENTS.md 结尾清单）。*
