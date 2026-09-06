# Kaolin-Assets · 高岭土机理图绘制软件

> 模块化科研绘图工具：像搭积木一样组合"片层 / 纳米管 / 颗粒 / 分子 / 基底"，
> 生成 SCI 论文与 PPT 汇报用的 2D/3D 机理图。所有素材由 **CIF 晶体学数据 + 参数** 程序化生成，
> **存参数不存网格**——模块永久可无损二次编辑，无任何现成模型库依赖。

## 📦 当前交付（生产工程 · 阶段 1-2 完成）

| 交付物 | 位置 | 说明 |
|---|---|---|
| **生产工程（主力）** | `src/` + `npm run dev` | React 19 + TypeScript + Vite 6；P0/P1 全部完成，P2 进行中 |
| 三维 Demo（历史基线） | [demo/index.html](demo/index.html) | 技术验证基线，双击即用；`node demo/core/test.js` 回归 |
| 种子模块库 | `data/seed-modules.json` | M2~M8 共 9 个成品模块（含缩略图），模块面板「导入」一键恢复 |
| CIF 种子库 | `data/*.cif` | 高岭石 / 地开石 / 珍珠石 / 蒙脱石 / 伊利石（AMCSD/COD 开放数据） |
| 技术方案设计文档 | [docs/技术方案设计.md](docs/技术方案设计.md) | 架构 / 模块划分 / 核心算法推导 / 半年路线图 |
| 记忆系统 | `PROJECT_STATE.md` · `TODO.md` · `DECISIONS.md` · `DATA_DICT.md` · `DAILY_LOG/` · `.agents/` | 跨会话/跨人员上下文零丢失 |

## 🚀 快速开始

```bash
npm install
npm run dev        # 浏览器打开 http://localhost:5173/
npm run test       # vitest 168 条（内核基线 / schema / 状态 / 导出 / SMILES）
npm run build      # tsc + vite 产物
node demo/core/test.js   # 几何内核历史基线回归（ALL OK）
```

操作：左侧素材库点选添加（或 SMILES 输入框导入任意分子）→ 画布点选组件 → 右侧面板调参数
→ 顶栏 `★存为模块 / ★存组合` 积累素材库 → `导出 PNG / TIFF / SVG / 分层 PNG`。

## ✅ 已实现能力（全部实测验收）

**素材生成**
- CIF → 对称展开（26 原子/晶胞，Al₄Si₄O₁₈ 化学计量吻合）→ 超胞切片（1–3 层、矩形/六角）
- 保弧长卷曲成管：进度 0→100% 动画；Al-OH 内壁 / Si-O 外壁；开口端自动断键；锥形管；多壁（层间距可调）
- CeO₂ 风格簇装颗粒（确定性种子）/ 光滑颗粒；H₂O/O₂/CO₂/N₂/阳离子内置库
- **SMILES 分子导入**：粘贴字符串 → 3D 构象（内置解析器 + 规则式构象生成，零依赖离线）

**编辑与组合**
- 组件独立变换（gizmo）、图层面板、显隐/锁定、成组（组内整体变换）
- 悬停/选中高亮（BBox 轻量拾取，60fps 无感）+ 画布↔图层面板双向联动
- 撤销/重做（全部写操作可逆，滑块拖动合并为一步）
- 组合模块：整景一键存/取，实例化后各组件仍独立可调

**模块库**：IndexedDB 持久化（200 条 <100ms）、关键词/类型检索、收藏置顶、`.kaolin-modules.json` 导入导出

**导出**（期刊 + PPT 双场景）
- PNG：300/600 dpi、透明底（`px = cm×dpi/2.54`）
- TIFF：300dpi+ 物理分辨率元数据（PS/GIMP 打开即 16cm），超 GPU 上限自动降级
- **分组 SVG**：每组件一个 `<g>`，PPT「转换为形状」后逐组件编辑（线稿档画风）
- **分层透明 PNG**：按图层远→近逐张导出，PPT 叠放还原（像素差 0.04%）

**渲染**：双轨制（🎨 渲染档 PBR / ✏️ 线稿档 Toon+描边，一键热切换 10ms）；4 套学术色板 + 逐元素取色器，随场景持久化

## 🛠 技术栈

React 19 · TypeScript 5.8（严格模式）· Vite 6 · Three.js r147（InstancedMesh + PMREM）· Zustand 5 ·
zod 4（schema 单一事实源）· Dexie 4（IndexedDB）· Vitest（168 条）· Web Worker（几何生成）。
桌面端规划：Tauri v2（P3）。架构与算法详见 [docs/技术方案设计.md](docs/技术方案设计.md)。

## 📈 路线图进度

| 阶段 | 内容 | 状态 |
|---|---|---|
| 0 | 技术验证（Demo 全链路） | ✅ 2026-09-04 |
| 0.5 | 工程治理（TODO 47 条 / 决策闭环 / 记忆系统） | ✅ 2026-09-05 |
| 1 | P0 工程基座 T-1.1~1.7 | ✅ 2026-09-05 |
| 2 | P1 日常可用 + 素材 9 个 + P2 出版功能 | 🔶 P1✅ 素材✅，P2 进行中 |
| 3+ | 桌面端（Tauri/EMF）/ 标注层 / 多语言 | ⬜ |

任务级进度见 [TODO.md](TODO.md)，当前状态见 [PROJECT_STATE.md](PROJECT_STATE.md)。
