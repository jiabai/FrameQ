from __future__ import annotations

import asyncio
import json
import os
import sys
from collections.abc import Mapping

from agent_runtime.tools.func_tool_manager import FunctionToolManager

from frameq_worker.draft_agent import build_anysearch_mcp_config, run_draft
from frameq_worker.models import Insight

# 硬编码样本（闭环步骤用）。新种子以 Insight 形态喂入 run_draft。
_TOPIC = "远程办公如何重塑团队协作"
_SUMMARY = (
    "1. 远程办公提升了员工的自主性与时间弹性，通勤成本下降；\n"
    "2. 但也带来沟通成本上升、归属感下降、跨时区协作错位等挑战；\n"
    "3. 关键在于建立异步沟通规范、以成果而非工时衡量、以及定期的线上团建。"
)
_PLATFORM = "xiaohongshu"
_SEED_INSIGHT = Insight(
    id=1,
    topic=_TOPIC,
    match_reason="远程办公协作模式变迁，与原视频主线一致",
    follow_up_questions=(
        "异步沟通规范如何建立？",
        "如何以成果而非工时衡量远程团队？",
    ),
    suitable_use=_PLATFORM,
    source_chunk_id=None,
)


async def recon(env: Mapping[str, str]) -> None:
    """连 anysearch MCP，打印合并后工具名 + 每个 tool 的 schema（不调 LLM）。"""
    manager = FunctionToolManager()
    try:
        await manager.enable_mcp_server("anysearch", build_anysearch_mcp_config(env))
        tools = manager.get_full_tool_set()
        names = sorted(tools.names())

        print("[recon] anysearch MCP 已连接。合并后 tools.names():")
        print(json.dumps(names, ensure_ascii=False, indent=2))
        print(f"\n[recon] 共 {len(names)} 个工具。逐个 schema：")

        for name in names:
            tool = tools.get_tool(name)
            schema = {
                "name": getattr(tool, "name", name),
                "description": getattr(tool, "description", "") or "",
                "parameters": getattr(tool, "parameters", None),
            }
            print(f"\n--- {name} ---")
            print(json.dumps(schema, ensure_ascii=False, indent=2))
    finally:
        # 同 draft_agent._run_async：streamable-http teardown 的跨任务 anyio 异常兜住，
        # 不让它盖住上面的侦察输出（连接仍被关闭，streamable-http 无子进程、不泄漏）。
        try:
            await manager.disable_mcp_server()
        except (Exception, asyncio.CancelledError) as exc:  # noqa: BLE001
            print(f"[recon] MCP cleanup warning (non-fatal): {type(exc).__name__}: {exc}")


def run_closed_loop(env: Mapping[str, str]) -> None:
    """硬编码 Insight（+ 可选 summary grounding），跑 :func:`run_draft` 并打印稿子文本。"""
    planning_flag = env.get("FRAMEQ_DRAFT_PLANNING", "1")
    max_turns = env.get("FRAMEQ_DRAFT_MAX_TURNS", "<缺省 40>")
    print(
        f"[run] insight.topic={_TOPIC!r}\n[run] suitable_use={_PLATFORM!r} "
        f"planning={planning_flag!r} max_turns={max_turns!r}",
    )
    draft = run_draft(_SEED_INSIGHT, None, _SUMMARY, _PLATFORM, env)
    print("\n[run] ===== 成稿结果 =====")
    print(draft)


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    mode = args[0] if args else "all"
    env: Mapping[str, str] = os.environ

    if mode == "recon":
        asyncio.run(recon(env))
    elif mode in ("run", "closed"):
        run_closed_loop(env)
    elif mode == "all":
        asyncio.run(recon(env))
        print("\n===== 侦察完成，进入闭环 =====\n")
        run_closed_loop(env)
    else:
        print(
            f"unknown mode: {mode!r} (expected one of: recon | run | all)",
            file=sys.stderr,
        )
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
