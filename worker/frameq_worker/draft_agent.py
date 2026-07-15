from __future__ import annotations

import asyncio
import json
import os
from collections.abc import Mapping
from pathlib import Path
from uuid import uuid4

from agent_runtime.core import FunctionToolExecutor, SessionContext
from agent_runtime.core.hooks import BaseAgentRunHooks
from agent_runtime.core.run_context import ContextWrapper
from agent_runtime.core.runners.tool_loop_agent_runner import ToolLoopAgentRunner
from agent_runtime.core.tool import FunctionTool, ToolSet
from agent_runtime.extensions.planning import PlanningHook, build_write_todos_tool
from agent_runtime.extensions.plugins.store import InMemoryPluginStore
from agent_runtime.extensions.skills import SkillManager, SkillsPromptHook, build_skill_tool
from agent_runtime.provider.entities import ProviderRequest
from agent_runtime.provider.sources.openai_source import ProviderOpenAIOfficial
from agent_runtime.tools.func_tool_manager import FunctionToolManager

from frameq_worker.insightflow.prompt import (
    _platform_label_for_draft_platform,
    build_draft_from_inspiration_prompt,
)
from frameq_worker.llm import (
    Transport,
    checkout_anysearch_config_once,
    checkout_llm_config_once,
)
from frameq_worker.models import Insight, PreferenceSnapshot

# FRAMEQ_DRAFT_MAX_TURNS 缺省值；核心层不读 env，只收 max_turns 形参。
_DEFAULT_MAX_TURNS = 40

def build_llm_provider(env: Mapping[str, str]) -> ProviderOpenAIOfficial:
    api_key = env.get("FRAMEQ_LLM_API_KEY", "").strip()
    model = env.get("FRAMEQ_LLM_MODEL", "").strip()
    if not api_key or not model:
        raise RuntimeError(
            "FRAMEQ_LLM_API_KEY / FRAMEQ_LLM_MODEL 未配置：成稿 LLM 复用 FRAMEQ_LLM_* 约定，"
            "请用 `uv run --env-file .env` 注入。",
        )

    provider_config: dict = {
        "id": (env.get("FRAMEQ_LLM_PROVIDER", "openai").strip().lower() or "openai"),
        "type": "openai_chat_completion",
        "key": [api_key],
        "api_base": env.get("FRAMEQ_LLM_BASE_URL", "").strip() or "https://api.openai.com/v1",
        "model": model,
    }

    timeout_raw = env.get("FRAMEQ_LLM_TIMEOUT_SECONDS", "").strip()
    if timeout_raw:
        try:
            provider_config["timeout"] = float(timeout_raw)
        except ValueError:
            pass

    # 思考模型（deepseek-r1 / glm-z1 等）的思考链计入输出预算：ReAct runner 不透传
    # max_tokens，故经 provider 官方的 custom_extra_body 注入点下发。
    # 默认不设——由 FRAMEQ_LLM_MAX_TOKENS 显式开启，避免对非思考模型强加截断。
    max_tokens_raw = env.get("FRAMEQ_LLM_MAX_TOKENS", "").strip()
    if max_tokens_raw:
        try:
            provider_config.setdefault("custom_extra_body", {})["max_tokens"] = int(max_tokens_raw)
        except ValueError:
            pass

    return ProviderOpenAIOfficial(provider_config, {})


def build_anysearch_mcp_config(env: Mapping[str, str]) -> dict:
    url = env.get("ANYSEARCH_MCP_URL", "").strip()
    if not url:
        raise RuntimeError(
            "ANYSEARCH_MCP_URL 未配置：anysearch streamable-http MCP 端点未知，请通过 .env 提供。",
        )
    config: dict = {"type": "streamable-http", "url": url}
    api_key = env.get("ANYSEARCH_API_KEY", "").strip()
    if api_key:
        config["headers"] = {"Authorization": f"Bearer {api_key}"}
    return config


def build_planning_hooks(store: InMemoryPluginStore) -> PlanningHook:
    return PlanningHook(store, max_reminders=2)


class DraftSink:
    """成稿交付接收槽：``submit_draft`` 工具的唯一写入目标。

    编排层构造后注入核心层 ``generate_draft`` 与 ``submit_draft`` handler 共享，
    使交付物有单一真值源。``set`` 做空白校验——空 / 纯空白不写入、不覆盖既有非空提交；
    ``value`` 返回最后一次非空提交或 ``""``。
    """

    def __init__(self) -> None:
        self._value: str = ""

    def set(self, markdown: str) -> bool:
        """记录非空 markdown；返回是否写入（空 / 纯空白 → False，不覆盖既有）。"""
        if markdown and markdown.strip():
            self._value = markdown
            return True
        return False

    @property
    def value(self) -> str:
        return self._value


_SYSTEM_PROMPT_HEAD = (
    "你是一名内容成稿助手。任务：根据给定的一条灵感，先做必要的资料检索，"
    "再按目标平台文体写出一份完整、可直接发布的稿子。\n"
)

# 固定回退措辞——在 system prompt 中原样出现，并被测试断言。作为单一事实源。
_RETRIEVAL_FALLBACK_PHRASE = "直接基于灵感 + 要点总结（若有）继续成稿"


def _summary_is_present(summary: str | None) -> bool:
    """summary「在场」判定：非 None 且 strip 后非空。

    系统侧与用户侧 prompt 必须共用同一语义，避免 ``"   "`` 这类纯空白被一侧判为在场、
    另一侧判为缺失而给出互相矛盾的信号。"""
    return summary is not None and summary.strip() > ""


def _summary_grounding_clause(summary: str | None) -> str:
    """要点总结 仅作为可选 grounding 提及；summary 不在场（None / 纯空白）时整体省略。"""
    if not _summary_is_present(summary):
        return ""
    return "（必要时可参考附带的要点总结作为原视频观点 grounding）"


def _build_planning_guidance(summary: str | None) -> str:
    """文案以「灵感」为成稿依据；要点总结作为可选 grounding 出现或省略；
    检索失败回退措辞统一为「基于灵感 + 要点总结（若有）继续成稿」（「若有」在两种
    情况下都成立：在场则使用，不在场则略过）。"""
    grounding_clause = _summary_grounding_clause(summary)
    summary_clause_in_oneshot = " + 要点总结（若有）" if _summary_is_present(summary) else ""
    return (
        "\n交付方式（硬性契约，优先于任何 skill 指令）：\n"
        "- 稿子的完整正文必须且只能经一次 `submit_draft` 工具提交：把整篇可直接发布的 "
        "Markdown 正文作为 `markdown` 参数传入。\n"
        "- 禁止把稿子正文写在普通回复里。调用 `submit_draft` 后任务即结束，无需任何 "
        "recap / 总结 / 收尾。\n"
        "- 调用 `submit_draft` 前先勾完所有 todo（若提供了 `write_todos`）。\n"
        f"- 本任务为一次性成稿：灵感{summary_clause_in_oneshot}"
        "、目标平台均已给出——不向用户确认需求，"
        f"也不要自行把稿子保存为文件（系统会落盘）。{grounding_clause}\n"
        "\n工作方式：\n"
        "- 若提供了 `write_todos` 工具，先用它建立成稿计划（建议覆盖：结构构思 / 资料检索 / "
        "按平台文体写作），再逐条执行，并在推进时更新各条状态（保持恰好一条 in_progress）。\n"
        "- 检索时自主决定搜索 query 和搜索的问题数量；若某次搜索失败或无结果，"
        f"不要无限重试同一条 query，{_RETRIEVAL_FALLBACK_PHRASE}。\n"
    )


def _build_system_prompt(platform: str, summary: str | None = None) -> str:
    """目标平台来自用户在确认页选择的 platform id；映射见 prompt 模块。"""
    platform_label = _platform_label_for_draft_platform(platform)
    return (
        _SYSTEM_PROMPT_HEAD
        + f"目标平台：{platform_label}。\n"
        + _build_planning_guidance(summary)
    )


def _build_user_prompt(
    insight: Insight,
    preference_snapshot: PreferenceSnapshot | None,
    summary: str | None = None,
    *,
    platform: str,
) -> str:
    """种子 prompt 委托 ``build_draft_from_inspiration_prompt`` 构造。"""
    return build_draft_from_inspiration_prompt(
        insight, preference_snapshot, summary, platform=platform
    )


def _build_submit_draft_tool(sink: DraftSink) -> FunctionTool:
    """构造 ``submit_draft`` 工具：把稿子正文写入共享接收槽。

    handler 对空 / 纯空白 markdown 不写入、返回提示；非空写入并告知「已接收，可结束」。
    """

    async def handler(_run_context, markdown: str) -> str:
        if sink.set(markdown):
            return "已接收稿子完整正文，任务可结束（无需任何 recap 或总结）。"
        return (
            "submit_draft 收到空或纯空白内容，未写入；"
            "请把整篇可直接发布的稿子正文作为 markdown 参数提交。"
        )

    return FunctionTool(
        name="submit_draft",
        description=(
            "提交成稿的完整正文。整篇可直接发布的 Markdown 稿子必须且只能经此工具提交，"
            "禁止把正文写在普通回复里。调用一次即可，调用后任务即结束。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "markdown": {
                    "type": "string",
                    "description": "稿子的完整 Markdown 正文（含标题与正文，可直接发布）",
                },
            },
            "required": ["markdown"],
        },
        handler=handler,
    )


def _one_line(text: str) -> str:
    """Collapse whitespace for compact trace output."""
    return " ".join(text.split())


def _json_compact(value: object) -> str:
    try:
        s = json.dumps(value, ensure_ascii=False)
    except TypeError:
        s = str(value)
    return s if len(s) <= 200 else s[:200] + "…"


def _trace_step(resp) -> None:
    try:
        chain = resp.data["chain"]
    except Exception:  # noqa: BLE001 - 某些响应类型无 chain，跳过即可
        return
    if resp.type == "tool_call" and getattr(chain, "chain", None):
        data = chain.chain[0].data or {}
        print(f"[draft]     ▶ {data.get('name', '?')}({_json_compact(data.get('args', {}))})")
    elif resp.type == "tool_call_result" and getattr(chain, "chain", None):
        data = chain.chain[0].data or {}
        result = _one_line(str(data.get("result", "")))
        print(f"[draft]       ↳ result: {result[:200]}{'…' if len(result) > 200 else ''}")
    elif resp.type == "llm_result":
        text = chain.get_plain_text() or ""
        is_reasoning = getattr(chain, "type", None) == "reasoning"
        kind = "reasoning" if is_reasoning else "answer"
        snippet = _one_line(text)[:200]
        print(f"[draft]     ✎ [{kind}] {snippet}{'…' if len(_one_line(text)) > 200 else ''}")
    elif resp.type == "err":
        print(f"[draft]     ✗ err: {_one_line(chain.get_plain_text() or '')[:200]}")


async def generate_draft(
    *,
    provider: ProviderOpenAIOfficial,
    tools: ToolSet,
    manager: FunctionToolManager,
    agent_hooks: BaseAgentRunHooks,
    max_turns: int,
    insight: Insight,
    preference_snapshot: PreferenceSnapshot | None,
    summary: str | None,
    platform: str,
    draft_sink: DraftSink,
    session_id: str | None = None,
) -> str:
    if session_id is None:
        session_id = uuid4().hex

    servers = list(manager.mcp_server_runtime_view)
    print(
        f"[draft] session={session_id} mcp_servers={servers} "
        f"planning_hook={type(agent_hooks).__name__} tools={sorted(tools.names())}",
    )

    request_obj = ProviderRequest(
        prompt=_build_user_prompt(insight, preference_snapshot, summary, platform=platform),
        system_prompt=_build_system_prompt(platform, summary),
        func_tool=tools,
        session_id=session_id,
        contexts=[],
    )
    run_context: ContextWrapper[SessionContext] = ContextWrapper(
        context=SessionContext(session_id=session_id),
        messages=[],
    )

    runner = ToolLoopAgentRunner()
    await runner.reset(
        provider=provider,
        request=request_obj,
        run_context=run_context,
        tool_executor=FunctionToolExecutor(provider),
        agent_hooks=agent_hooks,
        enforce_max_turns=max_turns,
        streaming=False,
    )

    # 一次性闭环：消费每步事件打印 spike 可观测性轨迹。
    async for resp in runner.step_until_done(max_step=max_turns):
        _trace_step(resp)

    chosen = draft_sink.value
    submit_draft_hit = bool(chosen)
    print(f"[draft] done: submit_draft_hit={submit_draft_hit} chosen_len={len(chosen)}")
    if not submit_draft_hit:
        # 未命中 submit_draft 契约 → 返回空串，由编排层（retry_insights draft 分支）
        # 判 DRAFT_EMPTY_RESULT。
        print("[draft] warning: submit_draft not called → empty result → DRAFT_EMPTY_RESULT")
    return chosen


_PLANNING_OFF_VALUES = ("0", "false", "False", "")


def _planning_enabled(env: Mapping[str, str]) -> bool:
    """``FRAMEQ_DRAFT_PLANNING`` 默认 on；设为 0/false 时关（隔离验证 anysearch MCP 循环）。"""
    return env.get("FRAMEQ_DRAFT_PLANNING", "1") not in _PLANNING_OFF_VALUES


def _resolve_max_turns(env: Mapping[str, str]) -> int:
    raw = env.get("FRAMEQ_DRAFT_MAX_TURNS", "").strip()
    if not raw:
        return _DEFAULT_MAX_TURNS
    try:
        value = int(raw)
    except ValueError:
        return _DEFAULT_MAX_TURNS
    return value if value > 0 else _DEFAULT_MAX_TURNS


def resolve_draft_credentials(
    env: Mapping[str, str], transport: Transport | None = None
) -> Mapping[str, str]:
    merged: dict[str, str] = dict(env)

    if env.get("FRAMEQ_LLM_SOURCE", "").strip().lower() == "server":
        llm_config = checkout_llm_config_once(env, transport)
        merged["FRAMEQ_LLM_API_KEY"] = str(llm_config["api_key"])
        merged["FRAMEQ_LLM_MODEL"] = str(llm_config["model"])
        merged["FRAMEQ_LLM_BASE_URL"] = str(llm_config["base_url"])
        merged["FRAMEQ_LLM_PROVIDER"] = str(llm_config["provider"])
        merged["FRAMEQ_LLM_TIMEOUT_SECONDS"] = str(llm_config["timeout_seconds"])
        # FRAMEQ_LLM_MAX_TOKENS 非 server 托管 → 不在此覆盖，原样保留（若有）。

    if env.get("FRAMEQ_ANYSEARCH_SOURCE", "").strip().lower() == "server":
        anysearch_config = checkout_anysearch_config_once(env, transport)
        merged["ANYSEARCH_MCP_URL"] = str(anysearch_config["mcp_url"])
        if "api_key" in anysearch_config:
            merged["ANYSEARCH_API_KEY"] = str(anysearch_config["api_key"])
        else:
            # 匿名：server 明示无 key，移除本地残留（与 LLM checkout 覆盖语义一致）。
            merged.pop("ANYSEARCH_API_KEY", None)

    return merged


class _CompositeHooks(BaseAgentRunHooks):
    """Forward every ``BaseAgentRunHooks`` event to a skills layer + an inner layer.

    Skills 经渐进式披露交付平台文体，inner hook 是 ``PlanningHook``
    （planning 开）或 no-op ``BaseAgentRunHooks``（``FRAMEQ_DRAFT_PLANNING=0``）。

    转发**全部**六个事件（非只转 ``on_llm_request``），避免日后 inner hook 用到别的事件
    （如 ``on_tool_end``）时复合层静默漏转。每层调用都包 try/except，单层异常落 ``[draft]``
    日志、不中断主循环；``on_before_complete`` 的两层投票合并为 AND（任一否决即否决），
    抛异常的层按 ``BaseAgentRunHooks`` 默认放行，以免异常把循环卡死。
    """

    def __init__(self, skills_hook: BaseAgentRunHooks, inner_hook: BaseAgentRunHooks) -> None:
        self._skills = skills_hook
        self._inner = inner_hook

    async def _dispatch_void(self, method: str, run_context, *args) -> None:
        for label, layer in (("skills", self._skills), ("inner", self._inner)):
            try:
                await getattr(layer, method)(run_context, *args)
            except Exception as exc:  # noqa: BLE001 - 单层失败不得中断主循环
                print(
                    f"[draft] composite hook {method} ({label}) error: "
                    f"{type(exc).__name__}: {exc}"
                )

    async def on_agent_begin(self, run_context) -> None:
        await self._dispatch_void("on_agent_begin", run_context)

    async def on_llm_request(self, run_context) -> None:
        await self._dispatch_void("on_llm_request", run_context)

    async def on_tool_start(self, run_context, tool, tool_args) -> None:
        await self._dispatch_void("on_tool_start", run_context, tool, tool_args)

    async def on_tool_end(self, run_context, tool, tool_args, tool_result) -> None:
        await self._dispatch_void("on_tool_end", run_context, tool, tool_args, tool_result)

    async def on_agent_done(self, run_context, llm_response) -> None:
        await self._dispatch_void("on_agent_done", run_context, llm_response)

    async def on_before_complete(self, run_context, llm_response) -> bool:
        async def _vote(label: str, layer: BaseAgentRunHooks) -> bool:
            try:
                return bool(await layer.on_before_complete(run_context, llm_response))
            except Exception as exc:  # noqa: BLE001 - 抛异常的层按默认放行，避免卡死循环
                print(
                    f"[draft] composite hook on_before_complete ({label}) error: "
                    f"{type(exc).__name__}: {exc}"
                )
                return True

        skills_allow = await _vote("skills", self._skills)
        inner_allow = await _vote("inner", self._inner)
        return skills_allow and inner_allow


async def _run_async(
    insight: Insight,
    preference_snapshot: PreferenceSnapshot | None,
    summary: str | None,
    platform: str,
    env: Mapping[str, str],
) -> str:
    planning_on = _planning_enabled(env)
    max_turns = _resolve_max_turns(env)
    print(f"[draft] planning={planning_on} max_turns={max_turns}")

    merged_env = resolve_draft_credentials(env)
    provider = build_llm_provider(merged_env)
    manager = FunctionToolManager()
    try:
        await manager.enable_mcp_server("anysearch", build_anysearch_mcp_config(merged_env))
        tools = manager.get_full_tool_set()

        skill_manager = SkillManager(skills_root=str(Path(__file__).parent / "skills"))
        tools.add_tool(build_skill_tool(skill_manager))

        draft_sink = DraftSink()
        tools.add_tool(_build_submit_draft_tool(draft_sink))

        if planning_on:
            store = InMemoryPluginStore()
            tools.add_tool(build_write_todos_tool(store))
            inner_hook: BaseAgentRunHooks = build_planning_hooks(store)
        else:
            inner_hook = BaseAgentRunHooks()

        # 复合 hook：skills 层始终在场，与 inner（planning 或 no-op）经复合层串联。
        hooks: BaseAgentRunHooks = _CompositeHooks(SkillsPromptHook(skill_manager), inner_hook)

        return await generate_draft(
            provider=provider,
            tools=tools,
            manager=manager,
            agent_hooks=hooks,
            max_turns=max_turns,
            insight=insight,
            preference_snapshot=preference_snapshot,
            summary=summary,
            platform=platform,
            draft_sink=draft_sink,
        )
    finally:
        try:
            await manager.disable_mcp_server()
        except (Exception, asyncio.CancelledError) as exc:  # noqa: BLE001
            print(f"[draft] MCP cleanup warning (non-fatal): {type(exc).__name__}: {exc}")


def run_draft(
    insight: Insight,
    preference_snapshot: PreferenceSnapshot | None,
    summary: str | None,
    platform: str,
    env: Mapping[str, str] | None = None,
) -> str:
    resolved_env: Mapping[str, str] = os.environ if env is None else env
    return asyncio.run(_run_async(insight, preference_snapshot, summary, platform, resolved_env))
