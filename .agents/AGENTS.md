# Kaolin-Assets（高岭土机理图绘制软件）— AI 协作规范

> 项目路径：本机工作副本（如 `/Users/<user>/Desktop/高岭土demo - 副本`）
> 远程仓库：`github.com/Ckx-z/drawing-kaolinite`（master 主开发线；推送需本机代理或直连可用）
> 本文件由 AI 工具自动加载，任何 AI 实例进入本项目时必读。
> 设计借鉴 `C:/Users/ckx/Desktop/全新机器学习实验` 的记忆体系（仅思想，未复制代码）。

---

## 一、项目一句话

**面向高岭土/黏土矿物科研的模块化机理图绘制软件：CIF + 参数 → 片层/纳米管/颗粒/分子/基底素材，搭积木组合出期刊级 2D/3D 机理图；存参数不存网格，模块永久可二次编辑。**

---

## 二、每次会话必读（按此顺序，不可跳过）

1. **`PROJECT_STATE.md`** — 当前阶段、下一步、阻塞点
2. **最新 `DAILY_LOG/YYYY-MM-DD.md`** — 上一次做了什么、遗留问题
3. **`DECISIONS.md`** — 关键决策和原因（D01–D08）
4. **`DATA_DICT.md`** — 素材参数字典与数据格式
5. **`TODO.md`** — 任务清单（编号/优先级/依赖/验收标准）
6. **`.agents/session_state.yaml`** — 当前会话实时状态（如果有）

> 读完以上文件后，先向用户确认"本次要推进的任务编号"，再动手。

---

## 三、每次会话必做

### 会话开头
- [ ] 阅读上述 6 份文件
- [ ] 向用户确认本次目标与验收标准
- [ ] 更新 `.agents/session_state.yaml`（status: in_progress + todos）

### 会话结尾
- [ ] 更新 `PROJECT_STATE.md`（阶段、下一步、阻塞点）
- [ ] 写/更新 `DAILY_LOG/YYYY-MM-DD.md`（AI 版：文件/算法/参数级技术细节）
- [ ] 写/更新 `DAILY_LOG/YYYY-MM-DD_human.md`（人版：素材库新增了什么、怎么用、下一步建议）
- [ ] 更新 `.agents/session_index.yaml`（追加本次会话条目）
- [ ] 更新 `.agents/session_state.yaml`（status: completed + files_modified）
- [ ] 如有新决策，记入 `DECISIONS.md`（编号递增）
- [ ] 完成的 TODO 任务在 `TODO.md` 标记 ✅
- [ ] **git 提交**（变更 + 记忆文件一起提交，提交信息注明任务编号）

---

## 四、禁止事项

- **绝不修改参考项目** `C:/Users/ckx/Desktop/全新机器学习实验` 任何文件（只读借鉴）
- **不在没更新 PROJECT_STATE 的情况下结束会话**
- **不假设自己记得之前的状态**——去读文档
- **不提交 `.agents/session_state.yaml` 到 git**（已加入 .gitignore）
- **不跳过 TODO 里的验收标准**——每条任务完成必须对照验收标准逐条核对
- **不绕过 demo 基线**——内核改动必须跑 `node demo/core/test.js` 回归（生产版就位后改为 vitest）

---

## 五、关键文件路径速查

| 文件 | 路径 | 说明 |
|---|---|---|
| 项目状态 | `PROJECT_STATE.md` | 当前阶段、下一步、阻塞点 |
| 决策日志 | `DECISIONS.md` | D01–D08 |
| 参数字典 | `DATA_DICT.md` | 五类组件参数 + JSON 格式 |
| 任务清单 | `TODO.md` | 47 条任务（含顶部已决策记录） |
| 日报（AI/人） | `DAILY_LOG/YYYY-MM-DD.md` / `_human.md` | 双轨制 |
| 会话索引 | `.agents/session_index.yaml` | 历史会话摘要 |
| 会话状态 | `.agents/session_state.yaml` | 当前会话实时状态（不入 git） |
| 技术方案 | `docs/技术方案设计.md` | 架构/算法/路线图 |
| 几何内核基线 | `demo/core/*.js` + `test.js` | T-1.3 移植源与回归基准 |
| 三维 Demo | `demo/index.html` | 功能对照基线（双击可用） |

---

## 六、工作约定

- 优先级定义与任务粒度见 `TODO.md` 头部；关键路径：T-1.1 → T-1.2 → {T-1.3, T-1.4, T-1.5} → T-1.6 → T-1.7
- 依赖未完成的任务不得开工（P2 的 T-8.2/T-8.3 除外，可与阶段 1 并行）
- 大改动（新依赖、架构调整）先向用户提案再动手

---

*最后更新：2026-09-06 ｜ 每次会话结束时检查是否需要更新*
