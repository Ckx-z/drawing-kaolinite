# PROJECT_STATE — 项目当前状态

> ⭐ **这是每次会话的第一份必读文件**。会话开头读它进入状态，结尾更新它。
> 最后更新：2026-09-16（状态审计与文档一致性修复；367 tests）

---

## 一、项目定位（一句话）

**面向高岭土/黏土矿物科研的模块化机理图绘制软件**：以 CIF 晶体学数据 + 参数化几何内核程序化生成"片层/纳米管/颗粒/分子/基底"素材，像搭积木一样组合成 SCI 论文与 PPT 汇报用的 2D/3D 机理图；**存参数不存网格**，模块永久可无损二次编辑。

- **任务形态**：科研绘图工具（非结构查看器、非模拟软件）
- **技术路线**：Web 前端（TypeScript + React 19 + Three.js/WebGL2）+ Tauri v2 桌面端（macOS 已交付，D01/D10）
- **核心卖点**：模块库沉淀 —— 官方种子模块 15 条 + 自存模块/模板持续积累，新学生一键复用
- **当前形态**：**生产工程（`src/`）为主体并已发布 v0.2.0**（`demo/` 仅为历史技术验证基线）

---

## 二、当前版本与完成度

**v0.2.0**（2026-09-13 发布，2026-09-16 审计）｜ 367 tests ｜ macOS（Apple Silicon）.app/.dmg ｜
安装包：`src-tauri/target/release/bundle/`

| 模块 | 状态 |
| --- | --- |
| 工程基座（Vite+TS+React+zod+zustand+Worker） | ✅ |
| 参数化几何内核（CIF 八矿物：五种层状+莫来石+Co₃O₄+CeO₂/片层/管/颗粒/密排层/基底） | ✅ |
| 分子导入（SMILES / 化学式 / MOL·SDF 文件） | ✅ |
| 模块库（Dexie + 检索收藏 + 导入导出） | ✅ |
| 出版导出（PNG/TIFF/SVG/PDF/GIF/分层 PNG） | ✅ |
| 机理图图元层（五件套 + 纯 2D 模式 + 磁吸 + 模板库） | ✅ |
| 键长/键角测量（随图导出） | ✅ |
| 快照式复现（模板/场景含视角，用户五原则） | ✅ |
| 自动保存 + 崩溃恢复 | ✅ |
| macOS 桌面端（Tauri v2 + 文件关联 + 原生保存） | ✅ |
| Windows 桌面端（待 CI，用户暂缓） | ⬜ |
| EMF 导出（Office 矢量，依赖桌面端 Inkscape 方案 Q2） | ⬜ |
| 工程文件夹/网盘同步（T-6.2） | ⬜ |

> 阶段史：阶段 0/0.5/1 全部完成（2026-09-04~05）；阶段 2（P1+P2 主体）完成；
> 原阶段 3 的桌面端 macOS、标注层、图元层均已交付——剩余为 Windows/EMF/云同步三项。

---

## 三、下一步（按优先级，2026-09-16 审计重建）

1. **实战压测与缺陷修复**（无 Task ID，持续项）：用户以真实课题（煤矸石-Pd 等）在打包版画图，发现问题随到随修——近期滑块/滚轮/模板复现等修复均源于此，价值最高。
2. **导出前出画检测**（约 0.5d）：内容超出视野时导出被静默裁切，加"仍然导出/返回调整"防呆；无依赖。
3. **图元级对齐/分布工具**（1–2d）：多选图元对齐/等距（复用组件级批量对齐的既有算法）；图元多选能力已就绪。
4. **T-6.1 Windows CI**（用户暂缓中）：GitHub Actions 双平台构建；环境依赖（Windows 签名/ runner）而非阻塞。
5. **T-5.5 EMF 导出**（P3）：Office 原生矢量（Q2：内置 Inkscape）；建议与 Windows 端一起做。
6. **T-6.2 模块库网盘同步 / T-8.3 日报模板**（P3，工程治理尾巴）。

---

## 四、阻塞点

当前无阻塞性问题。环境依赖（非阻塞）：Windows CI runner、EMF 所需 Inkscape 分发。

## 五、待跟进事项

- [ ] 每次会话结束：更新本文件 + 日报 + session_index（见 `.agents/AGENTS.md` 结尾清单）
- [ ] `python3 scripts/check_library_state.py` 已含版本/模块数/陈旧描述/下一步矛盾四组防漂移检查（2026-09-16 增强），提交前跑一遍

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
| 标注层 | `src/ui/annotations/draw.ts` + `src/export/svg.ts` | T-4.4：比例尺（自动取整刻度 nm）+ 引线标签；annotations[] 随场景持久化；PNG/TIFF/PDF 合成 + SVG 追加（同一投影，位置一致）；屏幕空间字号恒定 |
| 快捷键 | `src/ui/shortcuts.ts` | T-7.2：声明式注册表 11 项（undo/redo/复制/粘贴+12Å/原地副本/删除/显隐/Esc/? 速查）+ 速查浮层同源渲染；分发器 shift 语义严格 |
| 动画导出 | `src/export/gif.ts` + `animation.ts` | T-10.1：零依赖 GIF89a 编码器（216 色量化 + LZW early change，自写解码器对拍）+ 卷曲动画编排（progress 0.02→1 均匀帧，逐帧 Worker 重建经缓存，结束恢复参数）；浏览器实测 Image 原生解析 605×119 ✓ |
| 桌面端 | `src-tauri/` | T-6.1（macOS 完成）：Tauri v2 + release profile（lto/opt-s/strip）；.app 4.4MB / .dmg 2.1MB；文件关联 .kaolin-scene.json（Info.plist 验证）；RunEvent::Opened → scene-open-content 事件 → 前端 loadScene；Windows 构建待 CI |
| 管形貌选项 | `src/core/builders.ts` | T-2.6：curlAxis a/b 双向卷曲（半径校验一致）+ portNoise 端口确定性噪声（键数变化 <5%）；管参数随场景持久化 |
| 晶学严格模式 | `src/core/crystal.ts` | T-2.7：sheetParams.strictCell 开关——真实三斜投影（全投影+层间沿 c 轴堆叠，层片倾斜）；Si–O 键长与 CIF 距离矩阵偏差 <0.5%；默认示意正交化（D03 后路落地） |
| 模块库 | `src/state/moduleLibrary.ts` + `src/ui/ModulePanel.tsx` | T-2.3：Dexie 4 IndexedDB + 内存缓存 + localStorage 迁移 + 导入导出；T-3.2：filterModules 检索/类型筛选/收藏排序 + toggleFavorite（favorite 字段向后兼容） |
| 撤销/重做 | `src/state/history.ts` + `commands.ts` | T-2.1：attachHistory 实例包装（UI 零改动）；全量快照命令 + 800ms 合并窗口；栈深可配（默认 100）；Ctrl/Cmd+Z、+Shift/Y（App.tsx）；sceneStore 单例已挂接（sceneHistory） |
| 素材模块 | 模块库内 12 个条目 | 官方种子模块 15 条（M2 片层、M3 管、M4 颗粒 S/M/L、M5 基底、M6 组合、M7 多壁管、M8 复合场景、M9/M10 莫来石、M11 甲苯、M12 Co₃O₄、M13 CeO₂、M14 丙烷）——M1 为历史样图不计入 seed-modules 条目 |
| 种子模块库 | `data/seed-modules.json` | kaolin-modules/v1 全量备份（M2~M14 共 15 条含缩略图）；模块面板「导入」即可整套恢复/分发 |
| 三维 Demo | `demo/index.html` | 双击可用；生产版功能对照基准 |
| CIF 种子库 | `data/*.cif` | 高岭石/地开石/珍珠石/蒙脱石/伊利石/莫来石/Co₃O₄（COD 9005888）/CeO₂（COD 9009008） |
| 决策日志 | `DECISIONS.md` | D01–D10（D10：桌面端 Worker 内联 + 异步挂起必须可回退） |
| 参数字典 | `DATA_DICT.md` | 五类组件参数 + 场景 JSON schema |
| 桌面端稳定性 | `src/core/worker.ts` + `cache.ts` + `index.css` | 2026-09-08 修复：Worker `?worker&inline`（data URL，零运行时 fetch）+ 4s 握手超时回退主线程 + IndexedDB 4s 门直通 + canvas CSS 100% 钉死/body overflow:hidden/顶栏 wrap；233 tests |
| 交互与导入增强 | `App.tsx`/`RendererService.panView` + `molecules/formula.ts` + `schema.ts` + `paramDefs.ts` | 2026-09-09：方向键平移（rAF 键集合，输入框守卫）；化学式导入（大小写归一 + 紧密团簇，params.formula 持久化，SMILES 优先双路）；单原子模式（atomMode/singleEl，片层/管/颗粒，toggle+when UI）；248 tests |
| 机理图图元层 | `src/core/shapes/` + `src/ui/shapes/` + view/interaction/draw + templateLibrary + store/history/svg/RendererService | T-11 全部（2026-09-10）：一期叠加形态（五件套/锚定跟随/撤销/五格式导出）+ 二期：纯 2D 示意图模式（shapeViewStore pan/zoom 无限画布，数据不动视口变换）、磁吸对齐（六线 6px 最优吸附 + 10px 网格 + 洋红参考线）、机理图模板库（Dexie + 4 种子版式 + 自存模板 + 历史事务一条撤销）；269 tests |
| 模板快照式复现 | `src/state/templateLibrary.ts` + TopBar | 2026-09-13（用户五原则）：模板保存相机/画布形态/2D 视图，载入原样恢复（禁止 frameAll/重排）；组件 transform 与图元坐标本就逐位透传；老模板无视角字段兼容跳过；端到端实测相机与坐标逐位复现 |
| MOL/SDF 文件导入 + 层间开关 | `src/core/molecules/mol.ts` + minerals.interlayer + schema/builders | 2026-09-13（T-2.10/T-2.4）：V2000 解析（SDF 取首条）双入口导入构象精确；showInterlayer 注册表驱动（伊利石 K/蒙脱石 Ca·Na）；361 tests |
| **v0.2.0 发布** | package.json / tauri.conf / Cargo.toml + README | 2026-09-13：键长/键角测量（Alt+点击，随图导出）+ 分子质心居中 + 黑屏修复（ErrorBoundary/crashTrace）；README 徽章/更新日志/能力清单刷新（发布时 351 tests，历史值） |
| 场景文件视角快照 | `src/core/schema.ts` + sceneStore | 2026-09-13（a66f1a5）：.kaolin-scene.json 保存/恢复相机、形态与 2D 视图；旧文件无字段回退 frameAll |
| 自动保存 + 崩溃恢复 | `src/state/autosave.ts` + App | 2026-09-16（bcb0ee9→cc4d363）：编辑防抖 2s 快照 IndexedDB；异常退出后启动提示一键恢复（含视角）；正常退出 pagehide 清档；打包版实机闭环验证 |
| 测量可见性一致性 | RendererService.measureAtomWorldPos | 2026-09-16（e41f1d6）：组件隐藏/纯 2D 模式时测量在屏幕叠加与 PNG/SVG 导出两侧一致隐藏 |
| 矿物注册表 interlayer | `src/core/minerals.ts` | 2026-09-13（T-2.4 收尾）：层间元素集（伊利石 K、蒙脱石 Ca/Na）驱动 showInterlayer 开关 |
| 莫来石（第六矿物） | `minerals.ts`/`crystal.ts`/`schema.ts`/`mullite.test.ts` + `data/mullite.cif` | 2026-09-17：COD 2310785 平均结构（Pbam 骨架硅酸盐）；parseCIF 读 occupancy 剔零占位；分裂位双组分渲染 + 退化键守卫；d001 下限放宽 2.5（= 沿 c 堆叠周期）；layered=false 排除管组件；414 tests |
| 统一模板库（模块+模板合一） | `schema.ts` sceneTemplateModuleSchema + `moduleLibrary.ts` + `ModulePanel.tsx` + `TopBar.tsx` | 2026-09-17：moduleLibrary 底座吸收 templateLibrary 快照能力——type:'template' 条目 = 组件+图元+相机+形态+2D 视图+整景缩略图；左栏两 Tab（素材\|模板）；顶栏唯一保存入口「🧩 保存为模板」；旧模板库惰性无损迁移（稳定 id 幂等）；**真实缩略图体系（2026-09-17b）**：新保存 = snapshotTemplate（snapshotWithOverlay 管线：3D 当前帧+图元+标注，150×110 jpeg 0.8 与组合模块同规格，保存视角构图）；纯 2D 模板 = shapeSceneThumb 矢量渲染（shapesToSVG 复用）；占位图仅限含 3D 组件的旧模板/渲染服务不可用/img 解析失败三类 fallback + generateMissingThumbnails 幂等回填；kaolin-modules/v1 导入导出兼容四种条目；**模板独立场景打开（2026-09-17e）**：点击卡片 = moduleToSceneDocument 归一化（四类条目完整替换语义）→ sceneStore.loadScene 一次性替换（与场景文件共用链路；清 selection/测量拾取；相机/形态/2D 视图恢复；锚定按原 id 天然成立；一条完整撤销事务）；无快照 legacy 才 frameAll；**图元复制粘贴 + 模板重命名（2026-09-17f）**：Cmd+C/V/D 双槽剪贴板修复（needsSelection 认图元选择——图元复制失效根因；pasteCount 逐次错开 12×n 且重新 Copy 重置；箭头/连线副本清外部锚定转自由图元）；renameModule 纯 metadata UPDATE（id/thumb/favorite/createdAt 不变，卡片 ✎ 入口 stopPropagation）；**重命名交互修复（2026-09-18）**：window.prompt 在 Tauri/wry WKWebView 未实现（静默返回 null）→ 打包版点击 ✎ 零反馈——改内联编辑（Enter 保存/Esc 取消/blur 保存/空名红框保持编辑态）；468 tests |
| 吸附产品闭环（Metadata+UI） | `geometry.ts` ScientificGeometryMeta + `adsorptionStore.ts`（新）+ RendererService previewGroup/导出隐藏 + ParamPanel 结构信息/吸附构型两区块 + adsorb 拓扑取向轴 | 2026-09-21：meta 管线全链不再丢失（worker roundtrip 锁定）；候选预览不进 Scene/Undo/Layer/Template/Export；Apply=普通 molecule 一条 Undo；methyl-down/end-on 拓扑轴语义 + 欧拉 XYZ 复现；543 tests |
| Scientific Geometry + Surface Builder | `core/assets/registry.ts` + `core/surface/{slab,adsorb}.ts` + `crystal_surface` 组件接线 + `docs/STRUCTURE_BENCHMARK.md`/`V0.3_ROADMAP.md` | 2026-09-20（v0.3+v0.4 MVP）：Canonical 资产注册（provenance 可查询）；Miller 真实晶格切面（倒易格矢/斜坐标折叠/满层 termination）；吸附候选（top/bridge/hollow × 取向 + clash 推出，无能量声称）；CeO₂(111)+甲苯/丙烷 benchmark；534 tests |
| 丙烷真实构象 + 球棍视觉比例 | `builders.ts` MOLECULES + `render/visualScale.ts`（新）+ `propane.test.ts` 重写 + `data/propane.sdf` | 2026-09-19：preset 弃运行时 smilesTo3D 改 PubChem CID 6334 转录（下载程序化校验防网络注入损坏）；球棍 atom cov×0.95→0.42、bond r 0.16→0.12、两端入球 overlap 0.1（center-to-center 不改化学长度）；常量集中 visualScale.ts（3D+SVG 同源）；**H 球下限 0.20（2026-09-19b：0.14 时 H/bond=1.08 成白帽子 → 0.20/0.12 得 H=0.20/C=0.319/bond=0.12）**；505 tests |
| 催化氧化物 + 丙烷（Co₃O₄/CeO₂/C₃H₈） | `minerals.ts` aliases + `catalyst.test.ts` + `propane.test.ts` + `data/co3o4.cif`/`ceo2.cif` | 2026-09-18：COD 真实 CIF 直驱（尖晶石 56 原子/萤石 12 原子严格计量）；aliases 整词搜索（co3o4/ceo2/ceria/cobalt oxide，含数字串不折叠不错拆）；丙烷 = smilesTo3D('CCC') 运行时构造 MOLECULES（单一真源）；与 CeO₂ 风格化颗粒并存；495 tests |
| 日报 | `DAILY_LOG/2026-09-19.md`（+人版） | 本日四素材交付与近期主线补记（统一模板库/真实缩略图/独立场景打开/图元剪贴板/重命名）；上份日报 2026-09-10 |
| 甲苯 preset（第八种内置分子） | `builders.ts` MOLECULES / `registry.ts` 别名 / `toluene.test.ts` + `data/toluene.sdf` | 2026-09-17：PubChem CID 1140 3D 构象（MMFF94）转录；别名 甲苯/toluene/TOL/C7H8 多路直达；搜索词只解析身份几何唯一来自 preset；427 tests |
| 滚轮缩放灵敏度 | interaction.ts + RendererService | 2026-09-13（24a3d9c）：3D zoomSpeed 0.5 + 2D 灵敏度减半，方向/中心/上下限不变 |
| 防漂移对账增强 | `scripts/check_library_state.py` | 2026-09-16：新增版本一致性/种子模块数对账/陈旧描述/下一步已完成矛盾四组检查 |
| 黑屏修复与诊断 | `src/ui/ParamPanel.tsx` + `src/ui/ErrorBoundary.tsx` + `src/crashTrace.ts` | 2026-09-12：用图元工具画图后整窗黑屏——ParamPanel 条件 Hook 违规（T-7.3 引入）致 React 卸载全树；snap useState 移至所有 early return 之前（A/B 实证修复）；全局 ErrorBoundary 错误面板替代黑屏；crashTrace 面包屑（关键节点 + JS 异常 + WebGL 丢失 → /tmp/kaolin-trace.log）；338 tests |
| 导出保存对话框 | `src/ui/saveFile.ts` + `src-tauri`（save_file 命令 + tauri-plugin-dialog + capabilities） | 2026-09-09：桌面端 `<a download>` 无效的根治——原生保存对话框选路径后 Rust 写盘；分层 PNG 选目录批量写；取消静默；浏览器 showSaveFilePicker 优先 |

---
*本文件每次会话结束时检查更新（见 AGENTS.md 结尾清单）。*
