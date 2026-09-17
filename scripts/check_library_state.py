#!/usr/bin/env python3
"""
check_library_state.py —— 工程记忆对账脚本（T-8.2）

校验"活文档 ↔ 代码/资产 ↔ git"三者一致性，防记忆与实际脱节
（借鉴参考项目的 check_project_state 思路；仅标准库，无第三方依赖）。

用法：python3 scripts/check_library_state.py [--with-tests]
退出码：0 = 干净；1 = 存在告警。
"""

import os
import re
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WARNINGS: list[str] = []
OKS: list[str] = []


def warn(msg: str) -> None:
    WARNINGS.append(msg)


def ok(msg: str) -> None:
    OKS.append(msg)


def mtime(p: Path) -> float:
    return p.stat().st_mtime if p.exists() else 0


def fmt_ts(ts: float) -> str:
    return datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M") if ts else "（不存在）"


def check_required_files() -> None:
    required = [
        "README.md",
        "PROJECT_STATE.md",
        "TODO.md",
        "DECISIONS.md",
        "DATA_DICT.md",
        ".agents/AGENTS.md",
        ".agents/session_index.yaml",
        "demo/core/test.js",
        "data/kaolinite.cif",
    ]
    for f in required:
        if (ROOT / f).exists():
            ok(f"必需文件存在：{f}")
        else:
            warn(f"必需文件缺失：{f}")


def check_doc_freshness() -> None:
    """最新日报不应比 PROJECT_STATE 显著更新（否则状态收尾遗漏）"""
    ps = ROOT / "PROJECT_STATE.md"
    dailies = sorted((ROOT / "DAILY_LOG").glob("*.md")) if (ROOT / "DAILY_LOG").exists() else []
    if not dailies:
        warn("DAILY_LOG/ 无任何日报")
        return
    latest = dailies[-1]
    if mtime(latest) > mtime(ps) + timedelta(minutes=5).total_seconds():
        warn(
            f"最新日报 {latest.name}（{fmt_ts(mtime(latest))}）比 PROJECT_STATE.md"
            f"（{fmt_ts(mtime(ps))}）新——会话收尾时可能漏更 PROJECT_STATE"
        )
    else:
        ok(f"PROJECT_STATE 新鲜度 ≥ 最新日报（{latest.name}）")
    # 双轨制：最新一天应有人版日报（AI 版存在时）
    latest_ai = [d for d in dailies if "_human" not in d.name]
    if latest_ai:
        latest_date = latest_ai[-1].stem
        human = ROOT / "DAILY_LOG" / f"{latest_date}_human.md"
        if not human.exists():
            warn(f"缺人版日报：{human.name}（双轨制要求）")
        else:
            ok(f"人版日报在位：{human.name}")


def check_seed_modules() -> None:
    """种子模块库格式与规模（与 PROJECT_STATE 记录对账）"""
    seed = ROOT / "data" / "seed-modules.json"
    if not seed.exists():
        warn("缺种子模块库 data/seed-modules.json")
        return
    try:
        import json

        data = json.loads(seed.read_text(encoding="utf-8"))
    except Exception as e:
        warn(f"seed-modules.json 解析失败：{e}")
        return
    if data.get("format") != "kaolin-modules/v1":
        warn("seed-modules.json 缺 kaolin-modules/v1 格式标记")
        return
    mods = data.get("modules", [])
    bad = [m.get("id", "?") for m in mods if not (m.get("id") and m.get("name") and str(m.get("thumb", "")).startswith("data:image/"))]
    if bad:
        warn(f"seed-modules.json 有 {len(bad)} 条不完整（缺 id/name/thumb）：{bad[:5]}")
    else:
        ok(f"种子模块库 {len(mods)} 条全部完整（含缩略图）")


def check_git_state() -> None:
    """未提交变更提醒（收尾提交约定）"""
    try:
        out = subprocess.run(
            ["git", "status", "--short"], cwd=ROOT, capture_output=True, text=True, timeout=10
        ).stdout.strip()
        if out:
            n = len(out.splitlines())
            warn(f"git 工作区有 {n} 项未提交变更（按 AGENTS.md 约定应提交）")
        else:
            ok("git 工作区干净")
    except Exception as e:
        warn(f"git status 不可用：{e}")


def check_kernel_baseline(with_tests: bool) -> None:
    """demo 内核基线回归（AGENTS.md：内核改动必须跑通）"""
    if not with_tests:
        ok("（跳过内核基线运行：未加 --with-tests）")
        return
    try:
        out = subprocess.run(
            ["node", "demo/core/test.js"], cwd=ROOT, capture_output=True, text=True, timeout=60
        )
        if out.returncode == 0 and "ALL OK" in out.stdout:
            ok("内核基线 node demo/core/test.js = ALL OK")
        else:
            warn(f"内核基线未通过（exit={out.returncode}），详见输出尾部")
    except Exception as e:
        warn(f"内核基线运行失败：{e}")


def main() -> int:
    with_tests = "--with-tests" in sys.argv
    print("== Kaolin-Assets 记忆对账 ==")
    check_required_files()
    check_doc_freshness()
    check_seed_modules()
    check_git_state()
    check_kernel_baseline(with_tests)
    check_version_consistency()
    check_seed_module_count()
    check_stale_descriptions()
    check_next_actions_vs_todo()

    print(f"\n✅ 通过 {len(OKS)} 项：")
    for m in OKS:
        print(f"  ✓ {m}")
    if WARNINGS:
        print(f"\n⚠️ 告警 {len(WARNINGS)} 项：")
        for m in WARNINGS:
            print(f"  ⚠ {m}")
        print("\n结论：需要收尾（见上方告警）")
        return 1
    print("\n结论：记忆系统与仓库状态一致")
    return 0



# ---------- 防漂移检查（2026-09-16 状态审计新增） ----------

def check_version_consistency() -> None:
    """版本一致性：package.json / tauri.conf.json / Cargo.toml 三处应同版"""
    import json as _json

    def read_version(path: str, keys) -> str | None:
        f = ROOT / path
        if not f.exists():
            return None
        try:
            data = _json.loads(f.read_text(encoding="utf-8"))
            for k in keys:
                data = data[k]
            return str(data)
        except Exception:
            return None

    pkg = read_version("package.json", ["version"])
    tauri = read_version("src-tauri/tauri.conf.json", ["version"])
    cargo = None
    cargo_file = ROOT / "src-tauri" / "Cargo.toml"
    if cargo_file.exists():
        m = re.search(r'^version\s*=\s*"([^"]+)"', cargo_file.read_text(encoding="utf-8"), re.M)
        cargo = m.group(1) if m else None
    versions = {"package.json": pkg, "tauri.conf.json": tauri, "Cargo.toml": cargo}
    known = {k: v for k, v in versions.items() if v}
    if len(known) < 2:
        warn(f"版本信息读取不全：{versions}")
        return
    if len(set(known.values())) == 1:
        ok(f"三处版本一致：v{pkg}")
    else:
        warn(f"版本漂移：{known}（事实源 = 三者共同修改，见 AGENTS 发布约定）")


def check_seed_module_count() -> None:
    """种子模块数对账：seed-modules.json 实际条数 vs 文档声明（M2~M8 共 N 条 / 种子模块 N 条）"""
    import json as _json

    seed = ROOT / "data" / "seed-modules.json"
    if not seed.exists():
        return
    try:
        n = len(_json.loads(seed.read_text(encoding="utf-8")).get("modules", []))
    except Exception:
        return
    for doc in ("PROJECT_STATE.md", "README.md"):
        f = ROOT / doc
        if not f.exists():
            continue
        text = f.read_text(encoding="utf-8")
        for m in re.finditer(r"(?:M2~M8\s*共|种子模块[^0-9\n]{0,12})(\d+)\s*条", text):
            claimed = int(m.group(1))
            if claimed != n:
                warn(f"{doc} 声明种子模块 {claimed} 条，实际 {n} 条（以 data/seed-modules.json 为准）")
                break
    ok(f"种子模块数对账：实际 {n} 条（文档未发现冲突声明）")


def check_stale_descriptions() -> None:
    """陈旧描述：src/ 已是生产工程时，PROJECT_STATE 不得再出现"尚未启动"等旧形态描述"""
    ps = ROOT / "PROJECT_STATE.md"
    if not ps.exists():
        return
    text = ps.read_text(encoding="utf-8")
    has_src = any((ROOT / "src").glob("*.tsx")) or any((ROOT / "src").rglob("*.tsx"))
    if has_src and "尚未启动" in text:
        warn('PROJECT_STATE 仍含"尚未启动"——src/ 生产工程早已存在，描述严重过期')
    if has_src and re.search(r"阶段\s*3\+[^|\n]*\|\s*⬜\s*未开始", text):
        warn("PROJECT_STATE 仍写'阶段 3+ 未开始'——桌面端 macOS/标注层/图元层均已交付，阶段描述过期")


def check_next_actions_vs_todo() -> None:
    """下一步矛盾：PROJECT_STATE「三、下一步」引用的 T-x.x 若在 TODO 已标 ✅，则报警"""
    ps = ROOT / "PROJECT_STATE.md"
    todo = ROOT / "TODO.md"
    if not (ps.exists() and todo.exists()):
        return
    text = ps.read_text(encoding="utf-8")
    m = re.search(r"##\s*三、下一步[\s\S]*?(?=\n##\s)", text)
    if not m:
        return
    section = m.group(0)
    todo_text = todo.read_text(encoding="utf-8")
    ids = set(re.findall(r"T-\d+\.\d+", section))
    done = set(re.findall(r"###\s+(T-\d+\.\d+)\s*✅", todo_text))
    overlap = sorted(ids & done)
    if overlap:
        warn(f"PROJECT_STATE「下一步」包含 TODO 已完成任务：{overlap}（应移除并重建下一步列表）")
    else:
        ok(f"「下一步」无已完成任务（引用 {len(ids)} 个 Task ID）")


if __name__ == "__main__":
    sys.exit(main())
