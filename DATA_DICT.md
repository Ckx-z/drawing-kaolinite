# DATA_DICT — 素材参数字典与数据格式

> 五类组件的可调参数、范围与默认值（当前基线：`demo/index.html` 的 PARAM_DEFS）；场景 JSON 与模块库格式。
> 生产版迁移 T-1.2 时，本字典是 zod Schema 的直接依据。最后更新：2026-09-06（+色板/SMILES/双轨渲染）

---

## 一、通用结构

每个组件（Component）= `identity + params + transform + style`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 组件唯一标识（`c1`, `c2`, …） |
| `name` | string | 显示名（图层名，导出 SVG 时作为 `<g id>` 分组名） |
| `type` | enum | `kaolinite_sheet` / `halloysite_tube` / `nanoparticle` / `molecule` / `rubber_substrate` |
| `params` | object | 按类型见下表；**改参数即全量重建几何** |
| `transform` | object | `{ position:[x,y,z], rotation:[degX,degY,degZ], scale:number }` |
| `visible` | bool | 图层显隐 |
| `locked` | bool | 锁定（T-3.3：点击不选中、gizmo 不吸附） |
| `group` | string? | 分组 id（T-3.3：同组成员整体变换；缺省 = 独立） |

## 二、kaolinite_sheet 高岭土片层

| 参数 | 类型 | 范围 | 默认 | 单位 | 说明 |
|---|---|---|---|---|---|
| `Lx` | number | 20–150 (step 2) | 70 | Å | 横向目标尺寸（实际 = round(Lx/a)×a，a≈5.155） |
| `Ly` | number | 20–150 (step 2) | 60 | Å | 纵向目标尺寸（b≈8.945） |
| `layers` | int | 1–3 | 1 | 层 | 沿 c 堆叠层数 |
| `d001` | number | 7.2–12 (step 0.1) | 7.4 | Å | 层间距；**只作用于层间平移，不缩放层内厚度**；10 ≈ 水合间层 |
| `shape` | enum | 矩形 / 六角 | 矩形 | — | 六角为"假六方"轮廓掩膜（半径 = min(Lx,Ly)×0.52） |
| `style` | enum | 空间填充 / 球棍 | 空间填充 | — | 空间填充 = vdw×0.92 无键；球棍 = cov×0.95 + 键半径 0.16Å |
| `edgeH` | bool | — | false | — | 边缘羟基饱和（当前为径向补 H 实验实现，T-2.5 升级） |

## 三、halloysite_tube 埃洛石管

| 参数 | 类型 | 范围 | 默认 | 单位 | 说明 |
|---|---|---|---|---|---|
| `innerR` | number | 8–40 (step 1) | 14 | Å | 目标内半径；周向晶胞数 na = round(2π(innerR+3.6)/a) |
| `length` | number | 30–200 (step 5) | 90 | Å | 管长（b 方向，nb = round(length/b)） |
| `walls` | int | 1–3 | 1 | 层 | 管壁层数（多层 = 堆垛后整体卷曲，同心壁） |
| `d001` | number | 7.4–11 (step 0.1) | 7.4 | Å | 壁间距；10 = 水合多层（10Å 埃洛石） |
| `progress` | number | 0.02–1 (step 0.01) | 1 | — | **卷曲进度**：0=平片，1=闭合管（φ = progress×2π，Rmid = Lx/φ） |
| `taperDeg` | number | −20–20 (step 1) | 0 | ° | 锥角（圆锥面卷曲，负号反转方向） |
| `style` | enum | 空间填充 / 球棍 | 空间填充 | — | 同片层 |
| `curlAxis` | enum | a / b | a | — | 卷曲方向（T-2.6）：b 轴向近真实埃洛石 [110]，作图取美观 |
| `portNoise` | number | 0–2 | 0 | Å | 端口噪声幅度：管两端 3Å 内确定性扰动，模拟天然不规则端口（0 = 关） |

几何常量（内核内定，非用户参数）：卷曲方向沿 a 轴（轴向 ∥ b）；卷曲后**重新判键**（开口端自动断键）；卷曲前去除 x=xMax 末端一列原子防止闭合重叠。

## 四、nanoparticle 纳米颗粒（CeO₂ 风格）

| 参数 | 类型 | 范围 | 默认 | 单位 | 说明 |
|---|---|---|---|---|---|
| `radius` | number | 4–20 (step 0.5) | 9 | Å | 颗粒名义半径 |
| `grains` | int | 40–400 (step 10) | 160 | 个 | 表面晶粒数（另有 ~45% 内部填充）；晶粒半径自适应 r_g ≈ R×3.4/√K |
| `seed` | int | 1–99 | 7 | — | mulberry32 伪随机种子；**同种子同颗粒形**（模块复现保证） |
| `mode` | enum | 簇装 / 光滑 | 簇装 | — | 簇装 = 斐波那契球面布点（Ce:O≈1:2）；光滑 = 噪声球 |

## 五、molecule 小分子/离子

| `smiles` | string? | — | — | — | **T-2.8**：SMILES 导入（设置后几何 = smilesTo3D(smiles) 确定性重建；kind 保留回退）。解析支持有机子集/方括号/芳香/环闭合/分支/断键 |

| 参数 | 取值 | 说明 |
|---|---|---|
| `kind` | `H₂O` / `O₂` / `CO₂` / `N₂` / `Ca²⁺` / `Ce³⁺` / `·OH (羟基自由基)` | 内置库（标准键长键角）；默认渲染恒为球棍（cov×0.95 + 键） |
| （默认 scale） | 4 | 分子默认整体缩放 4 倍（DEFAULT_SCALE.molecule），否则相对片层太小 |

扩展（已实现 T-2.8，见 §五 smiles）：`sdf`（文件导入，T-2.10 待做）。

## 六、rubber_substrate 橡胶基底

| 参数 | 类型 | 范围 | 默认 | 单位 | 说明 |
|---|---|---|---|---|---|
| `Lx` | number | 40–240 (step 10) | 140 | Å | 长 |
| `Ly` | number | 30–200 (step 10) | 90 | Å | 宽 |
| `thickness` | number | 2–20 (step 1) | 5 | Å | 厚度（圆角挤出体，圆角 r = min(Lx,Ly)×0.16，倒角 0.55Å） |

## 七、场景 JSON（`kaolin-scene/v1`）

```jsonc
{
  "format": "kaolin-scene/v1",
  "saved": "ISO-8601 时间戳",
  "components": [ { /* 上文通用结构，含各类型 params */ } ]
}
```
- 演示样例：`demo` 页面"保存场景"按钮导出；导入导出必须与 demo 互兼容（T-1.7 验收项）。

## 八、模块库条目

**单组件模块**：

```jsonc
{
  "id": "m<timestamp>",
  "name": "模块显示名",
  "type": "kaolinite_sheet",            // 五类组件类型之一
  "params": { /* 同上 */ },
  "transform": { /* 同上 */ },
  "thumb": "data:image/jpeg;base64,…"   // 150×110 JPEG，入库时快照
}
```

**组合模块**（T-3.1，`type: "combined"`）：

```jsonc
{
  "id": "m<timestamp>",
  "name": "组合模块（N 组件）",
  "type": "combined",
  "components": [                        // 各组件完整条目（identity+params+transform+visible）
    { "id": "c1", "type": "halloysite_tube", "params": {…}, "transform": {…}, "visible": true }
  ],
  "thumb": "data:image/jpeg;base64,…"    // 整景快照（RendererService.snapshotScene）
}
```
- 实例化：逐组件 `addComponent`（变换原样还原 → **相对位置一致**），实例化后各组件仍独立可选中/调参/删除。
- 校验：`combinedModuleSchema`（`components` ≥ 1；strictObject）；与五类单组件变体共存于 `moduleSchema` 判别联合。
**场景文档全局字段**（T-4.2）：

```jsonc
"palette": { "id": "default|warm|cool|contrast", "overrides": { "O": "#RRGGBB" } }  // 可选；随场景保存/恢复
```

- 浏览器期存储：localStorage `kaolin_modules_v1`（基线）→ IndexedDB/Dexie（T-2.3）。
- 已实现字段：`tags[]`、`createdAt`、`moduleVersion`（T-3.2 检索/版本规划使用）。

## 九、元素显示数据（Crystal.ELEMENTS）

共价半径/范德华半径（Å）与色板：H(0.31/1.20/#ECECEC)、C(0.76/1.70/#4B4B55)、N(0.71/1.55/#3F66C4)、O(0.66/1.52/#D64550)、Na(1.66/2.27/#E8A33D)、Mg(1.41/1.73/#7FA96B)、Al(1.21/1.84/#C9A2A2)、Si(1.11/2.10/#E2C47E)、K(2.03/2.75/#8E6FB8)、Ca(1.76/2.31/#93B3A5)、Ti(1.60/2.11/#B7C0CA)、Fe(1.32/2.04/#C4744F)、Ce(1.86/2.40/#C77E8E)、Zn(1.22/1.39/#9BA8B5)、S(1.05/1.80/#D9B23A)、P(1.07/1.80/#D97E4A)。
键连判据：`d < r_cov(i)+r_cov(j)+0.45Å`，H–H 不成键。空间填充半径 = vdw×0.92；球棍 = cov×0.95。完整定义见 `demo/core/crystal.js`。

## 十、双轨渲染与色板（T-4.1/T-4.2）

| 档位 | 材质 | 用途 |
|---|---|---|
| 🎨 渲染档 | MeshPhysicalMaterial（roughness 0.42 + clearcoat 0.4）+ PMREM | 宣讲/PPT |
| ✏️ 线稿档 | MeshToonMaterial + 3 阶 gradientMap（110/190/255）+ 原子描边外壳（1.07） | 期刊示意/矢量导出 |

- 切换 = 材质引用热替换（不重建几何，实测 10.7ms）；`mesh.userData.matKind` ∈ atom/bond/substrate。
- 色板：`palette.ts` 4 套（期刊柔和/暖调/冷调/高对比），暖调/冷调/高对比由默认色板确定性 HSL 变换生成；
  场景文档 `palette.overrides` 逐元素覆盖（#RRGGBB），优先级 overrides > 色板 > 默认。
- 元素色 sRGB → 线性（convertSRGBToLinear）全链路统一，导出与画布一致。
