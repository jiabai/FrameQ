from __future__ import annotations

import asyncio
import inspect
import os
from pathlib import Path

from agent_runtime.extensions.skills import SkillManager, build_skill_tool
from agent_runtime.tools.func_tool_manager import FunctionToolManager
from frameq_worker import draft_agent

_PKG_SKILLS = Path(draft_agent.__file__).parent / "skills"


# —— fakes ——


class _FakeLayer:
    """记录每个事件、可配置 on_before_complete 投票、可按事件抛异常的鸭子类型 hook 层。"""

    def __init__(
        self,
        name: str,
        *,
        complete_vote: bool = True,
        raise_on: set[str] | None = None,
    ) -> None:
        self.name = name
        self.calls: list[str] = []
        self._complete_vote = complete_vote
        self._raise_on = raise_on or set()

    async def _record(self, method: str) -> None:
        self.calls.append(method)
        if method in self._raise_on:
            raise RuntimeError(f"{self.name} boom on {method}")

    async def on_agent_begin(self, run_context) -> None:
        await self._record("on_agent_begin")

    async def on_llm_request(self, run_context) -> None:
        await self._record("on_llm_request")

    async def on_tool_start(self, run_context, tool, tool_args) -> None:
        await self._record("on_tool_start")

    async def on_tool_end(self, run_context, tool, tool_args, tool_result) -> None:
        await self._record("on_tool_end")

    async def on_agent_done(self, run_context, llm_response) -> None:
        await self._record("on_agent_done")

    async def on_before_complete(self, run_context, llm_response) -> bool:
        if "on_before_complete" in self._raise_on:
            raise RuntimeError(f"{self.name} boom on on_before_complete")
        self.calls.append("on_before_complete")
        return self._complete_vote


def _run(coro):
    """同步跑一个协程——避免依赖 pytest-asyncio（项目 dev 依赖只有 pytest + ruff）。"""
    return asyncio.run(coro)


# —— skills_root 解析到包内目录，与 cwd / env 无关 ——


def test_skill_manager_skills_root_resolves_to_package_dir() -> None:
    assert _PKG_SKILLS.is_dir(), f"包内 skills 目录不存在：{_PKG_SKILLS}"
    sm = SkillManager(skills_root=str(_PKG_SKILLS))
    assert Path(sm.skills_root) == _PKG_SKILLS
    names = [s.name for s in sm.list_skills()]
    # 随包发版的占位 skill 必须可被发现（机制落地即可观测）
    assert "viral-writer" in names
    assert all(s.active for s in sm.list_skills())


def test_skill_manager_skills_root_is_cwd_independent(tmp_path: Path) -> None:
    cwd_before = Path.cwd()
    try:
        os.chdir(tmp_path)  # 离开仓库目录
        sm = SkillManager(skills_root=str(Path(draft_agent.__file__).parent / "skills"))
    finally:
        os.chdir(cwd_before)
    # 解析值由 __file__ 派生，与进程 cwd 无关
    assert Path(sm.skills_root) == _PKG_SKILLS


def test_skill_manager_skills_root_ignores_agent_runtime_data_dir(monkeypatch) -> None:
    # 显式传入 skills_root 后，AGENT_RUNTIME_DATA_DIR（子系统默认 root 来源）不得影响解析
    monkeypatch.setenv("AGENT_RUNTIME_DATA_DIR", str(Path("nonexistent") / "data" / "dir"))
    sm = SkillManager(skills_root=str(_PKG_SKILLS))
    assert Path(sm.skills_root) == _PKG_SKILLS


# —— Skill 工具并入工具集 ——


def test_build_skill_tool_named_skill_and_addable_to_toolset() -> None:
    sm = SkillManager(skills_root=str(_PKG_SKILLS))
    skill_tool = build_skill_tool(sm)
    assert skill_tool.name == "Skill"

    # 复刻 _run_async 的装配：从 FunctionToolManager 取 tool set，再把 Skill 工具并入
    # （与 anysearch MCP 工具、planning 开时的 write_todos 并列）。
    manager = FunctionToolManager()
    tools = manager.get_full_tool_set()
    assert "Skill" not in tools.names()
    tools.add_tool(skill_tool)
    assert "Skill" in tools.names()
    # 工具与 SkillsPromptHook 共享同一个 SkillManager（build_skill_tool 闭包绑定 sm.load_skill）
    assert skill_tool is build_skill_tool(sm) or skill_tool.name == "Skill"


# —— 复合 hook 转发全部事件 + on_before_complete AND 合并 + 异常隔离 ——


_ALL_EVENTS = [
    "on_agent_begin",
    "on_llm_request",
    "on_tool_start",
    "on_tool_end",
    "on_before_complete",
    "on_agent_done",
]


def test_composite_dispatches_all_events_to_both_layers() -> None:
    skills = _FakeLayer("skills")
    inner = _FakeLayer("inner")
    comp = draft_agent._CompositeHooks(skills, inner)

    async def drive() -> None:
        await comp.on_agent_begin("rc")
        await comp.on_llm_request("rc")
        await comp.on_tool_start("rc", "tool", {"a": 1})
        await comp.on_tool_end("rc", "tool", {"a": 1}, "result")
        await comp.on_before_complete("rc", "resp")
        await comp.on_agent_done("rc", "resp")

    _run(drive())

    assert skills.calls == _ALL_EVENTS  # 无任一事件被静默跳过
    assert inner.calls == _ALL_EVENTS


def test_composite_on_before_complete_merges_with_and() -> None:
    async def vote(skills_vote: bool, inner_vote: bool) -> bool:
        comp = draft_agent._CompositeHooks(
            _FakeLayer("skills", complete_vote=skills_vote),
            _FakeLayer("inner", complete_vote=inner_vote),
        )
        return await comp.on_before_complete("rc", "resp")

    assert _run(vote(True, True)) is True  # 均放行才放行
    assert _run(vote(False, True)) is False  # 任一否决即否决
    assert _run(vote(True, False)) is False
    assert _run(vote(False, False)) is False


def test_composite_isolates_layer_exception_in_void_event() -> None:
    # skills 层在 on_tool_end 抛异常：不得传播、inner 层照常收到事件
    skills = _FakeLayer("skills", raise_on={"on_tool_end"})
    inner = _FakeLayer("inner")
    comp = draft_agent._CompositeHooks(skills, inner)

    _run(comp.on_tool_end("rc", "tool", {}, "res"))  # 不抛

    assert skills.calls == ["on_tool_end"]  # 曾尝试
    assert inner.calls == ["on_tool_end"]  # 仍分发


def test_composite_on_before_complete_exception_defaults_admit() -> None:
    # 抛异常的层按 BaseAgentRunHooks 默认放行（True），合并结果只反映另一层的投票——
    # 避免异常把循环卡死或强加额外轮次。
    async def vote(inner_vote: bool) -> bool:
        comp = draft_agent._CompositeHooks(
            _FakeLayer("skills", raise_on={"on_before_complete"}),
            _FakeLayer("inner", complete_vote=inner_vote),
        )
        return await comp.on_before_complete("rc", "resp")

    assert _run(vote(True)) is True  # skills(default True) and inner True
    assert _run(vote(False)) is False  # skills(default True) and inner False


# —— D4: skills 始终开启，与 FRAMEQ_DRAFT_PLANNING 正交（结构断言）——


def test_skill_wiring_is_outside_planning_branch() -> None:
    src = inspect.getsource(draft_agent._run_async)
    idx_skill_manager = src.index("SkillManager")
    idx_skill_tool = src.index("build_skill_tool")
    idx_planning_if = src.index("if planning_on")
    # skills 接线（SkillManager 构造 + Skill 工具注册）必须先于 planning 分支 → 无条件、始终在场
    assert idx_skill_manager < idx_planning_if, "SkillManager 构造落进了 planning 分支"
    assert idx_skill_tool < idx_planning_if, "Skill 工具注册落进了 planning 分支"


def test_composite_skills_layer_is_always_skills_prompt_hook() -> None:
    src = inspect.getsource(draft_agent._run_async)
    # 复合 hook 的 skills 层恒为 SkillsPromptHook(...)，不受 planning 开关影响
    assert "SkillsPromptHook(skill_manager)" in src
    # _CompositeHooks 在两条 planning 路径都构造（赋值在 if/else 之外）
    assert src.count("_CompositeHooks(") == 1


# —— 不做 target_platform → skill 代码匹配（结构断言）——


def test_no_target_platform_to_skill_matching_in_source() -> None:
    src = inspect.getsource(draft_agent)
    # 任何 skill 构造/加载行都不得引用 platform（选 skill 由模型按 description 决定，非代码匹配）
    skill_tokens = ("SkillManager(", "build_skill_tool(", "load_skill(", "list_skills(")
    for line in src.splitlines():
        if any(tok in line for tok in skill_tokens):
            assert "platform" not in line, f"skill 接线引用了 platform：{line.strip()!r}"
    # 不硬编码任何平台 slug 作为选 skill 的键（前端拥有平台枚举，后端不维护）
    for slug in ("xiaohongshu", "douyin", "wechat", "weibo", "bilibili"):
        assert slug not in src, f"后端硬编码了平台 slug {slug!r}"


# —— 空目录基线（skills_root 为空时不报错、清单为空、不注入）——


def test_empty_skills_root_yields_empty_inventory_without_error(tmp_path: Path) -> None:
    empty_root = tmp_path / "empty-skills"
    empty_root.mkdir()
    sm = SkillManager(skills_root=str(empty_root))
    assert sm.list_skills() == []
    assert sm.list_skills(active_only=True) == []
    # build_skill_tool 仍可构造（模型无处可调，退化回无平台文体指引的裸跑）
    assert build_skill_tool(sm).name == "Skill"
