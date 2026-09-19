# DECISIONS — 关键决策日志

> 每个关键选择记下「为什么这么定 / 考虑过什么 / 何时复盘」。换任何大模型对接都能秒懂上下文。
> 最后更新：2026-09-06

---

## 决策索引

| # | 决策 | 日期 | 状态 |
|---|---|---|---|
| D01 | 产品形态：Web 端优先，后期 Tauri 打包桌面端 | 2026-09-04 | ✅ 已定 |
| D02 | 核心机制：参数化生成，**存参数不存网格** | 2026-09-04 | ✅ 已定 |
| D03 | 晶体学取舍：示意正交化（保留晶轴长度、消去 β/γ 夹角） | 2026-09-04 | ✅ 已定 |
| D04 | 渲染路线：双轨制（渲染档 PBR / 线稿档可矢量化） | 2026-09-04 | ✅ 已定 |
| D05 | 多矿物层间物质：参数化开关 `showInterlayer`，默认保留显示（Q1） | 2026-09-05 | ✅ 已定 |
| D06 | EMF 导出：桌面端内置 Inkscape，系统 PATH 优先备选，安装包 <110MB（Q2） | 2026-09-05 | ✅ 已定 |
| D07 | 工程记忆与日报系统立项，借鉴 `全新机器学习实验` 设计（Q3） | 2026-09-05 | ✅ 已定 |
| D08 | 分子导入：SMILES 先行（RDKit WASM），SDF/MOL 拆为 T-2.10（Q4） | 2026-09-05 | ✅ 已定 |
| D09 | T-2.8 实现偏差：内置 SMILES 解析器+规则式构象生成器替代 RDKit WASM（v1.0） | 2026-09-06 | ✅ 已定 |

---

## D01 — 产品形态：Web 端优先 + Tauri 桌面端
- **决策**：先做 Web 应用（浏览器即开即用、课题组零安装共享），功能稳定后用 Tauri 打包轻量桌面端（安装包目标 <15MB，不含内置 Inkscape 时）。
- **为什么**：用户是课题组（非 CS 背景），零安装降低使用门槛；Web 端开发迭代最快；桌面端只在需要本地文件/Inkscape/网盘联动时引入。
- **考虑过**：直接做 Electron 桌面端（体积大、迭代慢）；纯命令行脚本（无图形交互）。
- **何时复盘**：阶段 3（T-6.1）启动前。

## D02 — 参数化生成，存参数不存网格
- **决策**：所有素材由 `(CIF, params)` 纯函数实时生成；场景与模块 JSON 只保存参数与变换，永不烘焙网格。
- **为什么**：这是"模块永久可二次编辑"承诺的技术基础；也是软件与 Mol*/3Dmol.js 等查看器的本质差异。
- **考虑过**：保存网格快照（渲染快但不可改参数）；混合模式（当前否决，未来可作缓存优化 T-2.9）。
- **何时复盘**：性能不达标时（缓存仍是"参数指纹→网格"的映射，不违背本决策）。

## D03 — 示意正交化
- **决策**：默认保留晶轴长度（a/b/c），消去晶轴夹角（β=104.9°→90°）；提供"晶学严格模式"开关（T-2.7）切换回真实三斜投影。
- **为什么**：机理图不是衍射模拟；正交化让层片水平、z 即层法向、卷曲干净，键长畸变 <5% 视觉不可辨。Demo 实测渲染效果好。
- **考虑过**：始终严格投影（片层倾斜、卷曲轴歪，构图困难）。
- **何时复盘**：审稿人对结构严谨性提出质疑时（T-2.7 已预留后路）。

## D04 — 双轨渲染
- **决策**：渲染档（MeshPhysicalMaterial + PMREM 环境，宣讲/PPT 用）与线稿档（扁平色块+描边，出版/矢量化用）全局一键切换；矢量导出（SVG/EMF）自动使用线稿档。
- **为什么**：逼真光照与 PPT 可编辑矢量天然矛盾（技术方案 §10）；课题组已有 M1 样图确立"双档渲染"需求（`module_single_platelet.png` 图内"线稿档/淡彩档/渲染档"三档对照）。
- **考虑过**：只做逼真渲染 + 位图导出（放弃 PPT 深度二次编辑，砍掉核心卖点之一）。
- **何时复盘**：T-4.1 交付后看线稿档效果是否满足出版需求。

## D05 — 多矿物层间物质：参数化开关（Q1，2026-09-05）
- **决策**：蒙脱石/伊利石等含层间阳离子/水分子的矿物，切片时层间物质**默认保留并显示**；参数面板 `showInterlayer` 勾选控制显隐；预留 `interlayerWater` 扩展（显示/隐藏/部分脱水）。
- **为什么**：默认显示体现真实结构（可信度）；开关兼顾"突出骨架"的构图需求。
- **落地**：TODO T-2.4；schema 需在 T-1.2 预留参数字段。

## D06 — EMF 导出内置 Inkscape（Q2，2026-09-05）
- **决策**：桌面端（Tauri）将 Inkscape CLI 嵌入 `resources/`，导出 EMF 时静默调用；若系统 PATH 已有 Inkscape 则优先使用以减小安装包；安装包总体积目标 <110MB；Web 端隐藏 EMF 入口。
- **为什么**：Office 原生矢量是 PPT 二次编辑体验最好的格式；用户接受体积换体验。
- **落地**：TODO T-5.5（依赖 T-5.3 分组 SVG、T-6.1 Tauri）。

## D07 — 工程记忆与日报系统立项（Q3，2026-09-05）
- **决策**：立项 P2；建立 `.agents/`（AGENTS.md 协作规范 + session_index.yaml + session_state.yaml）与五份活文档（PROJECT_STATE/DECISIONS/DATA_DICT/SESSION_START/TODO）+ `DAILY_LOG/` 双轨日报。**仅借鉴 `C:/Users/ckx/Desktop/全新机器学习实验` 的设计思想，不复制代码、不改动参考项目。**
- **为什么**：跨会话/跨人员上下文零丢失；素材积累过程可追溯（这正是产品卖给用户的理念，自身先用起来）。
- **落地**：T-8.1（骨架，本次完成）、T-8.2（对账脚本）、T-8.3（日报模板常态化）。`session_state.yaml` 不入 git。

## D08 — 分子导入 SMILES 先行（Q4，2026-09-05）
- **决策**：v1.0 先支持 SMILES 文本输入（RDKit WASM 转 3D 构象）；SDF/MOL 文件导入拆分为 T-2.10（P2 后续迭代）。
- **为什么**：SMILES 覆盖绝大多数快速取用场景（字符串即得），实现门槛低；文件导入多为批量/精确场景，优先级靠后。
- **落地**：TODO T-2.8 / T-2.10。

## D09 — T-2.8 实现偏差：内置构象器替代 RDKit WASM（2026-09-06）
- **决策**：SMILES → 3D 采用内置 `src/core/molecules/smiles.ts`（解析器 + 环系平面/模板生长/弛豫的规则式构象生成），v1.0 不引入 RDKit WASM；接口按 `smilesTo3D` 抽象，精度不足时可无感换装 RDKit 增强。
- **为什么**：RDKit WASM 约 10MB 依赖 + 懒加载/locateFile 复杂度 + minimal-lib 3D API 可用性存疑；内置方案零依赖、离线、确定性、Node 可单测，示意级精度满足机理图场景。
- **考虑过**：坚持 RDKit WASM（真实 ETKDG 构象，但依赖与集成风险大）；仅支持内置分子库（不满足"任意分子"诉求）。
- **何时复盘**：用户反馈某类分子构象明显不合理时（尤其稠环/大环），优先评估换装 RDKit。

## D10 — 桌面端运行环境约束：Worker 内联 + 挂起必须可回退（2026-09-08）
- **决策**：几何 Worker 以 `?worker&inline`（data URL）内联进主包，不做运行时二次 fetch；所有异步依赖（Worker 消息、IndexedDB open）必须有超时回退路径（Worker 4s 握手 → 主线程 computeGeometry；IndexedDB 4s 门 → 直通构建）。
- **为什么**：Tauri 打包后 WKWebView 以 `tauri://localhost` 自定义协议运行，module Worker 独立 chunk 静默加载失败（不触发 error 事件）→ build Promise 永久 pending → 画布全空且零报错（2026-09-08 用户报障根因之一）；IndexedDB open 同类挂起风险。dev 模式（http origin）完全无法暴露此类故障。
- **考虑过**：`worker.format: 'iife'`（仍需运行时 fetch chunk，自定义协议下不保证）；仅加超时回退不内联（功能正确但打包版永远走慢路径）。
- **何时复盘**：若内联导致主包体积问题（当前 +~200KB 可忽略），或 Tauri 官方修复自定义协议 worker 加载。

## D-2026-09-12：旋转交互改"拖拽中四元数自驱动 + 松手单次提交"

**背景**：用户报告鼠标旋转到一定角度停止/跳变。根因不在 TransformControls（其 rotate 模式按 `_quaternionStart` 绝对重放，天然无限圈），而在回写链：
1. `objectChange` 每个 pointermove 触发 `getComponentTransform`（读欧拉分解）→ `setTransform`——每帧 history 双快照深拷贝 + 全组件 JSON diff + 拖拽中 applyTransform 竞态回写；
2. `setTransform` 的 T-3.3 组感知用逐分量欧拉差同步同组成员：跨 ±180° 时裸差 = ±360（成员视觉转整圈）；欧拉分解在 y≈±90° 万向锁附近翻转时差 ≈(±180,−2y,±180)（成员瞬间翻 180°）——即"跳变"；
3. 欧拉分解恒在 ±180° 内，多圈拖拽后数值回卷（3 圈显示 0°）。

**决策**：
- 回写节流：删除 objectChange 高频回写，`dragging-changed`（false）松手时提交一次——拖拽中姿态由 TransformControls 四元数独占驱动（无限圈平滑），一次拖拽 = 一条撤销记录（不再依赖 800ms 合并窗）。
- 组同步旋转增量取最短角差（wrap 到 (−180,180]），等价表示不再被当成整圈转动。
- `getComponentTransform` 回读做 unwrap 连续化（每分量加 360k 取最接近上次回读值，applyTransform 写入值同步为锚点）——store/面板呈现累积角度（1080° 而非 0°），姿态数值等价。
- 不把存储层改成四元数（保 kaolin-scene/v1 欧拉契约；欧拉 + unwrap 已满足连续性与累积显示）。

**验证**：浏览器实测 12 步 × 90° 绕 Y 三圈：90→180→…→1080 连续累积、编组成员同步至 1080、无跳变；332 tests 全绿（+3：最短角差/跨整圈/单组件无截断）。

## D-2026-09-17：莫来石（第六矿物）——非层状骨架结构的接入策略

**背景**：新增莫来石素材（用户任务书：真实 CIF 强制、不得手搓、不得套 d001 层状联动——莫来石是骨架硅酸盐 Pbam 正交）。任何真实莫来石精修结构都含分裂位与部分占位（物理本质：T 位 Al/Si 统计混合 + 氧缺位），不存在"整数原子完美计量"的莫来石 CIF。

**数据源**：COD 2310785（Birkenstock et al., Acta Cryst. B71 (2015) 358, doi:10.1107/S205252061500757X）——3:2 区固溶体平均结构，Al4.8Si1.2O9.6，Pbam No.55，a=7.5911 b=7.6924 c=2.8899 Å，显式 symop 列表 8 操作（parseCIF 天然支持，无需空间群名映射）。

**决策**：
1. **占位渲染策略**：`parseCIF` 新增读 `_atom_site_occupancy`（列缺失 = 全占位）；occ ≤ 0 的位点剔除（Si3 精修占据 = 0，不是原子，VESTA 同例）；其余部分占位按位点全显示（与蒙脱石 Ca0.5 既有先例一致）。
2. **分裂位双组分保留**：Al2/Si2 同坐标两组分都进模型（Si 真实存在于模型与统计中）；球棍模式 Al 球（cov 1.21）略大于 Si（1.11）无 z-fighting，空间填充模式反转亦稳定。`computeBonds` 加 d² < 1e-4 守卫——同点原子对不是化学键，杜绝零长键圆柱（NaN 朝向）。
3. **化学计量声明**：注册表 formula = CIF 声明值 Al4.8Si1.2O9.6（显示/搜索）；渲染位点集 Al10Si4O14 由测试锁定并注明"位点集 ≠ 声明计量"（部分占位的固有表示限制）。
4. **d001 语义**：非层状矿物 d001 = 沿 c 的堆叠周期（= 晶胞 c）。schema/滑块下限 7.2 → 2.5（其余矿物默认值与联动不变，蒙脱石 15.0 等不受影响）。
5. **管组件排除**：`MineralDef.layered`（默认 true）；莫来石 false → 管矿物下拉过滤 + 管 schema 枚举不含 mullite（双保险）。骨架结构卷管无晶体学意义。
6. **不做莫来石管/颗粒**：管仅层状矿物；颗粒构建器为 CeO₂ 专属晶格，套用即手搓违禁——种子模块只做片层类两条（M9 单层薄片/M10 三层堆叠块）。

**验证**：mullite.test.ts 16 条新测试（晶胞/显式 symop/零占位剔除/位点多重性 28/分裂位同坐标/四路搜索/schema 边界与管排除/1–3 层线性 448×nc/最短键长 >0.5Å/六角裁剪/单原子路径）；vitest 397 → 414 全绿，五矿物旧基线零改动通过。


## D-2026-09-17b：甲苯内置 preset——PubChem 构象数据驱动（与莫来石同任务书的分子侧落地）

**背景**：用户要求"同样的要求，增加甲苯素材库"。甲苯是小分子（molecules 管线非矿物 CIF 管线），此前仅能经 SMILES `Cc1ccccc1` 走内置示意级构象器（苯环规则正六边形）；demo 场景文件中的"甲苯"即此表达。

**数据源**：PubChem CID 1140 的 3D 构象 SDF（MMFF94 力场优化，OEChem 生成；PubChem 数据公共领域）。完整 15 原子笛卡尔坐标 + 15 键键表逐位转录进 `builders.MOLELECULES['C₇H₈']`，源文件存档 `data/toluene.sdf`——零手搓坐标，与水分子 preset 同为"数据库/文献几何"。

**决策**：
1. kind 命名 `C₇H₈`（下标 Unicode，与 H₂O/O₂/N₂/CO₂ 一致）。
2. 别名集：甲苯/甲基苯/toluene/TOL/methylbenzene + 化学式 C7H8/C₇H₈/c7h8（QUERY_ALIASES + FORMULA_PRESETS 双表）。tol 为溶剂瓶常用缩写（纯字母小写化后精确匹配）；含数字串不做小写折叠的 Co2 防混淆规则天然保护 C7H8。
3. 两路几何并存（水分子先例语义）：搜索词/化学式命中 → preset 真实构象；直接输 SMILES → 仍走构象器（示意级）——搜索词只解析身份，不决定几何算法。
4. 三处硬编码同步点全部更新：paramDefs molecule 下拉 options、center.test kind 列表、registry 别名表。

**验证**：toluene.test.ts 13 条（别名矩阵 10 词/化学式升级与 5 个近似式不误吞/15 原子 15 键 C7H8/分键型键长窗口/苯环共面 <0.01Å/质心 <1e-9/平移不变量 12 位/确定性/SMILES 双路差异 >0.02Å）；vitest 414 → 427 全绿。


## D-2026-09-17c：统一模板库——moduleLibrary 为底座吸收 templateLibrary 快照能力

**背景**：用户任务书（58 节）：用户界面不再区分「模块/组合模块/模板」三个概念，只看到「模板」；但成熟的 moduleLibrary（Dexie 持久化/可视化卡片/收藏/搜索/导入导出/历史数据）不得重写。

**决策**：
1. **底座选择**：moduleLibrary 继续作长期底座；templateLibrary 的快照能力（shapes/camera/mode/2D view）合并进 module entry——不建第三套 Library，不做全仓重命名（内部命名不变）。
2. **类型判别**：moduleSchema 新增成员 `type:'template'`（components 可空数组 = 支持纯 2D 模板；"至少组件或图元之一"由保存入口空场景检查保证——判别联合成员不能 refine 包装）。快照字段 schema 自 templateLibrary 平移至 core/schema.templateSnapshotFields 单一事实源，templateLibrary 反向复用。旧 combined 的 components.min(1) 原样保留（零语义回归）。
3. **保存**：顶栏唯一入口「🧩 保存为模板」= 完整可复现画面（components 全量 + shapes + annotations + 相机 + 形态 + 2D 视图 + snapshotScene 整景缩略图）一次性构造落库；渲染服务不可用时占位 SVG 缩略图兜底；不进 scene undo（Library 操作语义）。
4. **加载分流**：type:'template' → moduleToTemplate 转换后复用 applyTemplate（追加合并 + id 重映射锚定/编组 + 快照恢复 + runInBatch 单命令 + 禁 frameAll——2026-09-13 五原则管线原样）；旧单组件/combined 历史行为不变（combined 的 frameAll 是其历史行为，保留）。
5. **旧数据**：templateLibrary（独立 Dexie 库 kaolin-templates）惰性迁移进 modules 表——稳定 id（tpl-* 前缀天然与 m* 不冲突）+ localStorage 标记双保险幂等；旧模板无缩略图 → 一次性占位 SVG（不建第二套缩略图系统）；**旧表保留不删**（兼容优先于数据库洁癖）；种子模板 ensureSeededTemplates 注入统一库（稳定 id 幂等）。
6. **导入导出**：外层继续 kaolin-modules/v1（不造 kaolin-templates/v2）；importer 经扩展后 moduleSchema 天然接受旧单组件/旧组合/新模板三类；项目从未有模板导出格式，无需兼容第四类。

**验证**：unifiedTemplate.test.ts 9 条（任务书 Test 3-14 全覆盖）+ ui.dom.test 两 Tab/唯一保存入口断言 + templateLibrary.test 6 条原样通过；vitest 427 → 436 全绿；fake-indexeddb 真库 roundtrip/幂等验证。


## D-2026-09-17d：统一模板真实缩略图——占位仅 fallback

**背景**：用户任务书（18 节）：模板卡片必须显示保存时真实画布渲染缩略图（参考组合模块卡片）；⭐/🧩 仅限历史数据无 thumb 或数据损坏时 fallback。

**决策**：
1. **新保存模板**：`RendererService.snapshotTemplate(150,110,shapes,annotations)` = 复用既有 `snapshotWithOverlay` 合成管线（PNG/TIFF/PDF 共用的"3D 帧 + 图元 + 标注叠加"），输出与组合模块卡片同规格（150×110 / jpeg 质量 0.8）。直接取当前已渲染帧——缩略图视角 ≡ 保存视角 ≡ 恢复视角，无 frameAll 类取景，不污染用户相机/选中/可见性。
2. **纯 2D 模板**（种子版式/无 3D 组件）：`shapeSceneThumb` = 图元包围盒自适应缩放（复用 `viewTransformedShape`）→ `shapesToSVG` 矢量序列化（复用导出管线）→ SVG dataURL。确定性：同 shapes 恒同输出；裸 JSON 缺 anchors 的箭头补 free 端点（与 store schema 默认值同语义）。
3. **占位图收窄为纯 fallback**（三路径）：①含 3D 组件的旧模板（离屏 3D 渲染复杂，不阻塞本轮）②保存时渲染服务不可用 ③卡片 img 解析失败（onError 换占位，防死循环标记）。占位 SVG 内嵌 data-ph 标记供程序识别。
4. **历史回填**：`generateMissingThumbnails()`（ModulePanel refresh 链，幂等）——统一库中"占位 thumb 的纯 2D 模板"重生成真实矢量缩略图写回（只换 thumb，其余字段逐位保留）；含 3D 组件跳过。种子注入（ensureSeededTemplates）与旧库迁移（migrateTemplatesToModules）直接生成真实 2D 缩略图。
5. 卡片渲染规则：`entry.thumb` 存在即显示（<img src>）；不按 type 分配图标。

**验证**：unifiedTemplate.test +3（矢量缩略图内容/种子自带真实图/回填幂等与 3D 跳过）、ui.dom.test +1（TopBar 保存→thumb=渲染管线输出透传，非占位）；vitest 436 → 440 全绿。


## D-2026-09-17e：模板点击 = 独立场景打开（OPEN/REPLACE），修复叠加 Bug

**背景**：用户报告"打开模板 A 后再打开模板 B，B 叠加到 A 上"。根因：templateLibrary.applyTemplate 是追加式合并（逐 addComponent/addShape）；ModulePanel 旧三分支（template→applyTemplate、combined→addComponent 循环、单组件→addComponent）全部是 INSERT 语义。

**决策**：
1. **复用场景文件替换链路**：`sceneStore.loadScene`（deserializeScene schema 校验 → 一次性 set 替换 components/palette/annotations/shapes + 清 selection/工具 → 恢复相机/形态/2D 视图，返回是否已恢复视角）。与"打开场景文件"同一底层 API——文件打开与模板打开共用一套替换机制，零复制。
2. **归一化层**：`moduleToSceneDocument(entry)` 四类条目 → SceneDocument 形状：template 全量快照原样；combined → components + shapes=[]；单组件 → [该组件] + shapes=[]。"字段缺失 = 模板没有该内容"（完整替换语义），杜绝 undefined→保留旧状态的叠加路径。components 保留原 id → 箭头/连线锚定无需重映射（loadScene 原样入库）。
3. **不调用 UI「清空场景」handler**、无确认弹窗（点击即打开意图）；非法模板在 deserializeScene 抛错 → set 未执行 → 当前场景原子保留。
4. **会话态清理**：loadScene 补清 measurements/measurePick（旧原子引用指向已删组件）——场景文件打开同步受益。
5. **视角**：有 camera snapshot 原样恢复（禁 frameAll）；legacy 无快照返回 false → frameAll fallback。
6. **History**：attachHistory 全量快照订阅下，一次 loadScene = 一条完整事务（A→B→Ctrl+Z 整体回 A）；无逐组件碎片。
7. **Worker stale**：rendererBinding 按下一状态组件 id 集合 diff（`!next.has(id)` 即移除），A 的 stale 几何结果无 record 可挂——现有 id 校验足够，不加 generation token。
8. applyTemplate 函数保留（templateLibrary 导出 + 其测试），UI 层不再调用。

**验证**：unifiedTemplate.test 重写为 loadScene 路径并新增"不叠加"系列 9 条（A→B 组件/图元/标注全量替换、连续打开不累计、legacy 单/组独立打开、selection+测量清理、3D↔2D 互切不残留、非法原子性、一条完整事务可整体回退）；vitest 440 → 449 全绿。


## D-2026-09-17f：图元复制粘贴修复 + 模板重命名

**A. 图元 Copy/Paste**：双槽剪贴板（ComponentClip|ShapeClip）在 shortcuts.ts 已存在，但三缺陷致图元复制实际不可用：
1. **needsSelection 只认组件 selectionId** → 图元选中（shapeSelectionIds）时 Cmd+C/D 被 continue 跳过——修复为两者任一满足；
2. **连续粘贴同位置**（固定 +12）→ pasteCount 计数，第 n 次 = 12×n 逐次错开；每次 Copy / clearShortcutClipboard 重置；
3. **锚定未清** → copy 时 arrow/line 删 anchors，副本成自由图元（几何 x/y/w/h/bow 保留；旧 id 引用本就悬空且保留会吸回原位）。
组件粘贴同步享受逐次错开。Delete 图元（App 级优先 deleteSelectedShapes）与输入框守卫（input/select/textarea 聚焦不分发）为既有行为，零改动。

**B. 模板重命名**：`renameModule(id, name)` = toggleFavorite 同款 UPDATE 模式（listModules 取 entry → put({...entry, name}) → cache 失效 + 通知），绝不删除+重建；空白名拒绝（schema name min(1) 单一事实源）；种子模板已是 Dexie 普通条目（稳定 id tpl-*）直接改名，不触发重复注入/缩略图回填。UI = 卡片 hover 显 ✎（与 ✕ 同风格），stopPropagation 隔离打开；window.prompt 原生交互零新依赖。

**验证**：shapeClipboard.test 12 条（五类图元 ID/属性/独立性、连续错开、计数重置、锚定清理、逐次 Undo、多选整体粘贴）+ rename 5 条（只改 name/空白拒绝/持久化+搜索+导出/legacy 两类/种子不重复注入）；vitest 449 → 466 全绿。


## D-2026-09-18：模板重命名点击无响应修复——window.prompt 在 Tauri 打包版不可用

**根因**：2026-09-17f 的重命名用 `window.prompt`——浏览器 dev 模式正常，但 Tauri v2/wry 的 WKWebView 只实现了 alert/confirm，**prompt 未接 `runJavaScriptTextInputPanelWithPrompt` delegate，静默返回 null**。打包版点击 ✎ → `if (input === null) return` → 无弹窗无反馈（与"按钮无响应"症状完全吻合）。

**修复**：内联编辑替代原生弹窗（任务书十三/十四推荐形态）——点击 ✎ 进入 editingId/editingName 状态，卡片名称位变为输入框（autofocus 全选）；Enter/blur 保存、Esc 取消；空名红框（#e5735f）保持编辑态不关闭；输入框 click/keydown stopPropagation（不触发卡片打开，也不进全局快捷键）。数据链路复用既有 renameModule（UPDATE 模式）零改动。

**验证**：ui.dom.test +2（点击 ✎ 进入编辑态且 loadScene 零调用 spy 验证 / Enter 保存后 UI 立即刷新 + Dexie 重读新名 / 空名拒绝保持编辑 / Esc 取消恢复原名）；vitest 466 → 468 全绿。
