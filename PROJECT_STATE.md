# PROJECT_STATE — 项目当前状态

> ⭐ **这是每次会话的第一份必读文件**。会话开头读它进入状态，结尾更新它。
> 最后更新：2026-09-06（T-2.1 撤销/重做完成，阶段 2 已完成 4 条；下一步 T-3.1 组合模块）

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
| **阶段 2（当前）** | P1：T-2.1 撤销重做 / T-2.2 Worker 化 / T-2.3 IndexedDB 模块库 / T-3.1 组合模块 / T-9.x 素材积累 | 🔶 **进行中**（T-2.1 ✅、T-2.3 ✅、T-9.1 ✅、T-9.2 ✅；素材库已有 3 个模块） |
| 阶段 3+ | P2–P3：双轨渲染 / 矢量导出 / 桌面端 / 素材积累至 8–10 个模块 | ⬜ 未开始 |

---

## 三、下一步（按优先级）

1. **T-3.1 组合模块存取**（依赖 T-2.3 ✅，约 1d）——模块 schema 扩展 components[]，一次存选区/整场景（M6 组合模块前置）
2. **T-2.2 Web Worker 化几何生成**（依赖 T-1.3 ✅，约 1d）——大场景参数拖动不卡 UI
3. **T-9.3 / T-9.4 素材模块**（M4 CeO₂ 颗粒组 / M5 橡胶基底，各 0.5d）
4. T-8.2 `check_library_state.py` 对账脚本（P2，可并行）

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
| 模块库 | `src/state/moduleLibrary.ts` + `src/ui/ModulePanel.tsx` | T-2.3：Dexie 4 IndexedDB + 内存缓存 + localStorage 迁移（原 key 保留）+ .kaolin-modules.json 导入导出；★存为模块（snapshotComponent 快照） |
| 撤销/重做 | `src/state/history.ts` + `commands.ts` | T-2.1：attachHistory 实例包装（UI 零改动）；全量快照命令 + 800ms 合并窗口；栈深可配（默认 100）；Ctrl/Cmd+Z、+Shift/Y（App.tsx）；sceneStore 单例已挂接（sceneHistory） |
| 素材模块 | 模块库内 M2/M3 | T-9.1 M2 三层堆叠片层（六角/d001=10Å）、T-9.2 M3 埃洛石管 7Å、另有埃洛石管（双层壁）——**素材积累已启动（3/8-10）** |
| 三维 Demo | `demo/index.html` | 双击可用；生产版功能对照基准 |
| CIF 种子库 | `data/*.cif` | 高岭石/地开石/珍珠石/蒙脱石/伊利石 |
| 决策日志 | `DECISIONS.md` | D01–D08 |
| 参数字典 | `DATA_DICT.md` | 五类组件参数 + 场景 JSON schema |

---
*本文件每次会话结束时检查更新（见 AGENTS.md 结尾清单）。*
