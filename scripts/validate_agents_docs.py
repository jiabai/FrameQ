#!/usr/bin/env python3
"""Validate vibe-coding-launcher project documentation.

Checks:
- Core documents exist (AGENTS.md, WORKFLOW.md or lightweight alternative,
  validate_agents_docs.py, ARCHITECTURE.md or CLI alternative,
  EXECUTION_GATES.md or AGENTS.md gate summary; TASKS.md optional)
- AGENTS.md sections complete (simplified or full version)
- Root AGENTS.md must declare explicit constraint mechanism
- TASKS.md uses standard sections and per-task validation conditions (if exists)
- Quick-entry links in AGENTS.md are valid
- Line count within limits

Severity levels:
- ERROR: Must fix before proceeding
- WARN: Should fix, but can continue
- INFO: Status information
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from enum import Enum
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class Severity(Enum):
    ERROR = "ERROR"
    WARN = "WARN"
    INFO = "INFO"


@dataclass
class ValidationResult:
    path: Path
    severity: Severity
    message: str

    def __str__(self) -> str:
        level = self.severity.value
        rel_path = self.path.relative_to(ROOT) if self.path.is_relative_to(ROOT) else self.path
        return f"[{level}] {rel_path}: {self.message}"


# 简化版通用必需章节（根级 `约束机制` 在下方单独校验，避免误伤子级继承场景）
SIMPLE_REQUIRED = ["快速入口", "核心信念", "开发流程", "常用命令"]

# 完整版通用必需章节（根级 `约束机制` 在下方单独校验）
FULL_REQUIRED = ["Scope", "Do", "Avoid", "Commands", "Tests", "Related Skills"]

# 行数范围
MIN_LINES = 20
MAX_SIMPLE_LINES = 150
MAX_FULL_LINES = 140

# 生成注释模式
GEN_COMMENT_PATTERN = re.compile(
    r"<!-- 由 vibe-coding-launcher 生成.*-->",
    re.IGNORECASE,
)

# TASKS.md 任务模式
TASK_REQUIRED_SECTIONS = ["进行中", "待办", "已完成"]
CHECKBOX_PATTERN = re.compile(r"^- \[[ x]\]\s+")
PENDING_TASK_PATTERN = re.compile(r"^- \[ \]\s+")
COMPLETED_TASK_PATTERN = re.compile(r"^- \[x\]\s+")
TASK_VALIDATION_MARKER = "✅"

# 快速入口链接模式
QUICK_ENTRY_PATTERN = re.compile(r"`([^`]+\.md)`")

CONSTRAINT_SECTION = "约束机制"
CONSTRAINT_MODE_PATTERN = re.compile(r"模式[：:]\s*`([^`]+)`")
CONSTRAINT_CONFIG_PATTERN = re.compile(r"配置[：:]\s*`([^`]+)`")
VALID_CONSTRAINT_MODES = {"agents-only", "linter+agents"}

ARCHITECTURE_CONCEPT_GROUPS = {
    "概述": ["概述", "Overview"],
    "模块或代码地图": ["代码地图", "模块", "Module", "Modules"],
    "关键文件": ["关键文件", "Key Files"],
    "架构约束信息": ["不变量", "边界", "Invariant", "Boundary"],
}
EXTERNAL_AGENT_DIRS = {"lib-external"}


def is_cli_project(root: Path) -> bool:
    """Detect CLI/single-file project by directory structure.

    A project is considered CLI/single-file if it has no src/ directory
    and either has no docs/ directory, or docs/ only contains exec-plans/
    (which is auto-generated for ExecPlan tracking and does not indicate
    a non-CLI project structure).
    """
    if (root / "src").exists():
        return False

    docs_dir = root / "docs"
    if not docs_dir.exists():
        return True

    # docs/ exists — check if it only contains exec-plans/ (按需生成的目录)
    entries = [p for p in docs_dir.iterdir()]
    if len(entries) == 1 and entries[0].name == "exec-plans":
        return True

    return False


def detect_version(headings: list[str]) -> str:
    """Detect AGENTS.md version (simplified or full)."""
    if "Scope" in headings:
        return "full"
    return "simple"


def extract_section_lines(lines: list[str], heading: str) -> list[str]:
    """Extract lines belonging to a markdown H2 section."""
    section_lines: list[str] = []
    in_section = False

    for line in lines:
        stripped = line.strip()
        if stripped == f"## {heading}":
            in_section = True
            continue
        if in_section and stripped.startswith("## "):
            break
        if in_section:
            section_lines.append(line)

    return section_lines


def parse_constraint_mechanism(lines: list[str]) -> tuple[str | None, str | None]:
    """Parse mode/config from the fixed '约束机制' section."""
    section_lines = extract_section_lines(lines, CONSTRAINT_SECTION)
    if not section_lines:
        return None, None

    mode: str | None = None
    config: str | None = None
    for line in section_lines:
        if mode is None:
            match = CONSTRAINT_MODE_PATTERN.search(line)
            if match:
                mode = match.group(1)
        if config is None:
            match = CONSTRAINT_CONFIG_PATTERN.search(line)
            if match:
                config = match.group(1)

    return mode, config


def read_text_if_exists(path: Path) -> str:
    """Read a UTF-8 markdown file, returning empty text when absent."""
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return ""


def should_validate_child_agents_md(root: Path, path: Path) -> bool:
    """Skip AGENTS.md files that belong to vendored external references."""
    try:
        relative_parts = path.relative_to(root).parts
    except ValueError:
        return True
    return not any(part in EXTERNAL_AGENT_DIRS for part in relative_parts[:-1])


def agents_has_lightweight_workflow(agents_md: Path) -> bool:
    """Detect an AGENTS.md workflow alternative for tiny projects."""
    content = read_text_if_exists(agents_md)
    return (
        "轻量流程" in content
        or "Lightweight Path" in content
        or ("轻量" in content and "流程" in content)
    )


def agents_has_execution_gate_summary(agents_md: Path) -> bool:
    """Detect a compact completion-gate summary in AGENTS.md."""
    content = read_text_if_exists(agents_md)
    has_gate_label = (
        "完成门禁" in content
        or "收尾标准" in content
        or "Definition Of Done" in content
        or "Hard Gates" in content
    )
    has_validation_signal = (
        "验证" in content
        or "Residual risk" in content
        or "残余风险" in content
    )
    return has_gate_label and has_validation_signal


def validate_agents_md(
    path: Path,
    min_level: Severity,
    *,
    cli_project: bool = False,
    require_constraint_mechanism: bool = False,
) -> list[ValidationResult]:
    """Validate one AGENTS.md file."""
    results: list[ValidationResult] = []

    if not path.exists():
        results.append(ValidationResult(path, Severity.ERROR, "文件不存在"))
        return results

    content = path.read_text(encoding="utf-8")
    lines = content.splitlines()
    line_count = len(lines)

    # 检查行数
    if line_count < MIN_LINES:
        results.append(ValidationResult(path, Severity.ERROR, f"行数不足: {line_count} < {MIN_LINES}"))

    # 提取章节标题
    headings: list[str] = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("## ") and not stripped.startswith("## #"):
            heading = stripped[3:].strip()
            headings.append(heading)

    # 判断版本
    version = detect_version(headings)

    if version == "full":
        # 完整版检查
        if line_count > MAX_FULL_LINES:
            results.append(ValidationResult(path, Severity.WARN, f"完整版行数超限: {line_count} > {MAX_FULL_LINES}"))

        for section in FULL_REQUIRED:
            if section not in headings:
                results.append(ValidationResult(path, Severity.ERROR, f"完整版缺少章节: {section}"))

        results.append(ValidationResult(path, Severity.INFO, f"完整版, {line_count} 行"))
    else:
        # 简化版检查
        if line_count > MAX_SIMPLE_LINES:
            results.append(ValidationResult(path, Severity.WARN, f"简化版行数超限: {line_count} > {MAX_SIMPLE_LINES}"))

        for section in SIMPLE_REQUIRED:
            if section not in headings:
                results.append(ValidationResult(path, Severity.ERROR, f"简化版缺少章节: {section}"))

        results.append(ValidationResult(path, Severity.INFO, f"简化版, {line_count} 行"))

    # CLI/单文件项目：AGENTS.md 必须包含"架构"章节
    if cli_project and "架构" not in headings:
        results.append(ValidationResult(path, Severity.ERROR, "CLI/单文件项目缺少'架构'章节（替代 docs/ARCHITECTURE.md）"))

    # 检查快速入口链接有效性
    quick_entry_section = False
    for line in lines:
        if "快速入口" in line or "Quick Entry" in line:
            quick_entry_section = True
            continue
        if quick_entry_section and line.startswith("##"):
            break
        if quick_entry_section:
            for match in QUICK_ENTRY_PATTERN.finditer(line):
                linked_path = match.group(1)
                # 检查链接是否存在（相对于 AGENTS.md 所在目录）
                resolved = (path.parent / linked_path).resolve()
                if not resolved.exists():
                    results.append(ValidationResult(path, Severity.WARN, f"快速入口死链: {linked_path}"))

    if require_constraint_mechanism:
        section_lines = extract_section_lines(lines, CONSTRAINT_SECTION)
        if not section_lines:
            results.append(ValidationResult(
                path, Severity.ERROR,
                "缺少'约束机制'章节",
            ))
        else:
            mode, config = parse_constraint_mechanism(lines)
            if mode is None:
                results.append(ValidationResult(path, Severity.ERROR, "缺少'约束机制.模式'声明"))
            elif mode not in VALID_CONSTRAINT_MODES:
                results.append(ValidationResult(
                    path, Severity.ERROR,
                    f"'约束机制.模式' 非法: {mode}（必须是 agents-only 或 linter+agents）",
                ))

            if config is None:
                results.append(ValidationResult(path, Severity.ERROR, "缺少'约束机制.配置'声明"))
            elif mode == "agents-only":
                if config != "N/A":
                    results.append(ValidationResult(
                        path, Severity.ERROR,
                        "'约束机制.配置' 在 agents-only 模式下必须为 `N/A`",
                    ))
            elif mode == "linter+agents":
                if config == "N/A":
                    results.append(ValidationResult(
                        path, Severity.ERROR,
                        "'约束机制.配置' 在 linter+agents 模式下必须为真实配置文件路径",
                    ))
                else:
                    resolved = (path.parent / config).resolve()
                    if not resolved.exists():
                        results.append(ValidationResult(
                            resolved, Severity.ERROR,
                            f"约束配置文件不存在（在 '约束机制.配置' 中声明）: {config}",
                        ))

    return results


def validate_workflow_md(path: Path, agents_md: Path) -> list[ValidationResult]:
    """Validate WORKFLOW.md or its AGENTS.md lightweight replacement."""
    results: list[ValidationResult] = []

    if path.exists():
        line_count = len(path.read_text(encoding="utf-8").splitlines())
        results.append(ValidationResult(path, Severity.INFO, f"{line_count} 行"))
    elif agents_has_lightweight_workflow(agents_md):
        results.append(ValidationResult(
            path,
            Severity.INFO,
            "文件不存在（AGENTS.md 已包含轻量流程替代）",
        ))
    else:
        results.append(ValidationResult(
            path,
            Severity.ERROR,
            "文件不存在，且 AGENTS.md 未包含轻量流程替代",
        ))

    return results


def validate_tasks_md(path: Path, min_level: Severity) -> list[ValidationResult]:
    """Validate TASKS.md file (optional - may be deleted when all tasks complete)."""
    results: list[ValidationResult] = []

    if not path.exists():
        results.append(ValidationResult(path, Severity.INFO, "文件不存在（项目可能已全部完成）"))
        return results

    content = path.read_text(encoding="utf-8")
    lines = content.splitlines()

    headings = [
        line.strip()[3:].strip()
        for line in lines
        if line.strip().startswith("## ") and not line.strip().startswith("## #")
    ]
    missing_sections = [section for section in TASK_REQUIRED_SECTIONS if section not in headings]
    if missing_sections:
        results.append(ValidationResult(
            path,
            Severity.ERROR,
            f"缺少标准区段: {', '.join(missing_sections)}",
        ))

    task_lines = [
        (idx + 1, line.rstrip())
        for idx, line in enumerate(lines)
        if CHECKBOX_PATTERN.match(line)
    ]
    if not task_lines:
        results.append(ValidationResult(path, Severity.ERROR, "没有使用 checkbox 格式"))

    missing_validation = [
        f"第{line_no}行"
        for line_no, line in task_lines
        if TASK_VALIDATION_MARKER not in line
    ]
    if missing_validation:
        results.append(ValidationResult(
            path,
            Severity.ERROR,
            f"任务缺少验证条件（缺少 `✅`）: {', '.join(missing_validation)}",
        ))

    # 统计待办和已完成
    pending = sum(1 for _, line in task_lines if PENDING_TASK_PATTERN.match(line))
    completed = sum(1 for _, line in task_lines if COMPLETED_TASK_PATTERN.match(line))

    results.append(ValidationResult(path, Severity.INFO, f"{pending} 项待办, {completed} 项已完成"))

    return results


def validate_execution_gates_md(
    path: Path,
    agents_md: Path,
) -> list[ValidationResult]:
    """Validate docs/EXECUTION_GATES.md or its AGENTS.md summary."""
    results: list[ValidationResult] = []

    if path.exists():
        line_count = len(path.read_text(encoding="utf-8").splitlines())
        results.append(ValidationResult(path, Severity.INFO, f"{line_count} 行"))
    elif agents_has_execution_gate_summary(agents_md):
        results.append(ValidationResult(
            path,
            Severity.INFO,
            "文件不存在（AGENTS.md 已包含完成门禁摘要）",
        ))
    else:
        results.append(ValidationResult(
            path,
            Severity.ERROR,
            "文件不存在，且 AGENTS.md 未包含完成门禁摘要",
        ))

    return results


def validate_architecture_md(path: Path, min_level: Severity, *, cli_project: bool = False) -> list[ValidationResult]:
    """Validate docs/ARCHITECTURE.md file."""
    results: list[ValidationResult] = []

    if not path.exists():
        if cli_project:
            # CLI/单文件项目不需要 docs/ARCHITECTURE.md，架构信息在 AGENTS.md 中
            results.append(ValidationResult(path, Severity.INFO, "文件不存在（CLI/单文件项目，架构信息在 AGENTS.md 中）"))
        else:
            results.append(ValidationResult(path, Severity.ERROR, "文件不存在"))
        return results

    content = path.read_text(encoding="utf-8")

    for concept_group, keywords in ARCHITECTURE_CONCEPT_GROUPS.items():
        if not any(keyword in content for keyword in keywords):
            results.append(ValidationResult(
                path,
                Severity.WARN,
                f"架构文档缺少必含内容: {concept_group}",
            ))

    line_count = len(content.splitlines())
    results.append(ValidationResult(path, Severity.INFO, f"{line_count} 行"))

    return results


def validate_docs_structure(docs_dir: Path, min_level: Severity, *, cli_project: bool = False) -> list[ValidationResult]:
    """Validate docs/ directory structure."""
    results: list[ValidationResult] = []

    if not docs_dir.exists():
        if cli_project:
            results.append(ValidationResult(docs_dir, Severity.INFO, "docs/ 目录不存在（CLI/单文件项目，无需生成）"))
        else:
            results.append(ValidationResult(docs_dir, Severity.ERROR, "docs/ 目录不存在"))
        return results

    # 必需文件：CLI/单文件项目不要求 docs/ARCHITECTURE.md
    required = [] if cli_project else [
        docs_dir / "ARCHITECTURE.md",
    ]

    for path in required:
        if not path.exists():
            results.append(ValidationResult(path, Severity.ERROR, "必需路径不存在"))

    # 条件目录：exec-plans/ 按需生成，存在时检查子目录结构
    exec_plans_dir = docs_dir / "exec-plans"
    if exec_plans_dir.exists():
        for subdir in ["active", "completed"]:
            if not (exec_plans_dir / subdir).exists():
                results.append(ValidationResult(
                    exec_plans_dir / subdir, Severity.WARN,
                    f"exec-plans 子目录缺失: {subdir}"
                ))
    else:
        results.append(ValidationResult(
            exec_plans_dir, Severity.INFO,
            "目录不存在（按需生成，无需修复）"
        ))

    return results


def validate_project(root: Path, min_level: Severity) -> list[ValidationResult]:
    """Validate entire project documentation."""
    results: list[ValidationResult] = []

    cli = is_cli_project(root)

    # 核心文档
    agents_md = root / "AGENTS.md"
    workflow_md = root / "WORKFLOW.md"
    validator_script = root / "scripts" / "validate_agents_docs.py"
    tasks_md = root / "TASKS.md"
    # 旧命名检查必须按磁盘上的实际文件名判断：在大小写不敏感的文件系统
    # （Windows、默认 macOS）上，root / "tasks.md" 与 TASKS.md 指向同一文件，
    # 直接 .exists() 会把正确命名的 TASKS.md 误报为旧命名。改为扫描目录项。
    root_task_names = {
        p.name for p in root.iterdir()
        if p.is_file() and p.name.lower() == "tasks.md"
    }
    has_canonical_tasks = "TASKS.md" in root_task_names
    legacy_task_names = sorted(n for n in root_task_names if n != "TASKS.md")
    architecture_md = root / "docs" / "ARCHITECTURE.md"
    execution_gates_md = root / "docs" / "EXECUTION_GATES.md"
    docs_dir = root / "docs"

    if not validator_script.exists():
        results.append(ValidationResult(validator_script, Severity.ERROR, "核心验证脚本不存在"))

    results.extend(
        validate_agents_md(
            agents_md,
            min_level,
            cli_project=cli,
            require_constraint_mechanism=True,
        )
    )
    results.extend(validate_workflow_md(workflow_md, agents_md))
    if legacy_task_names and not has_canonical_tasks:
        legacy_path = root / legacy_task_names[0]
        results.append(ValidationResult(
            legacy_path,
            Severity.WARN,
            "旧命名 tasks.md 已存在；请重命名为根目录 TASKS.md",
        ))
        results.extend(validate_tasks_md(legacy_path, min_level))
    else:
        if legacy_task_names:
            results.append(ValidationResult(
                root / legacy_task_names[0],
                Severity.WARN,
                "旧命名 tasks.md 仍存在；根目录任务清单统一使用 TASKS.md",
            ))
        results.extend(validate_tasks_md(tasks_md, min_level))
    results.extend(validate_architecture_md(architecture_md, min_level, cli_project=cli))
    results.extend(validate_execution_gates_md(execution_gates_md, agents_md))
    results.extend(validate_docs_structure(docs_dir, min_level, cli_project=cli))

    # 检查所有子目录 AGENTS.md
    for agents_path in root.rglob("AGENTS.md"):
        if agents_path != agents_md and should_validate_child_agents_md(root, agents_path):
            results.extend(validate_agents_md(agents_path, min_level))

    return results


def filter_by_severity(results: list[ValidationResult], min_level: Severity) -> list[ValidationResult]:
    """Filter results by minimum severity level."""
    severity_order = [Severity.INFO, Severity.WARN, Severity.ERROR]
    min_index = severity_order.index(min_level)
    allowed = severity_order[min_index:]
    return [r for r in results if r.severity in allowed]


def main() -> int:
    # 输出含中文；管道/重定向时 Windows 默认回退到 gbk（locale 编码），
    # 会让 UTF-8 消费者（AI 代理、CI、git-bash）看到乱码。统一强制 UTF-8。
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="backslashreplace")

    parser = argparse.ArgumentParser(description="Validate vibe-coding-launcher documentation")
    parser.add_argument(
        "--level",
        choices=["ERROR", "WARN", "INFO"],
        default="INFO",
        help="Minimum severity level to show (default: INFO)",
    )
    parser.add_argument(
        "--project",
        type=Path,
        default=None,
        help="Project root directory (default: script's parent)",
    )
    args = parser.parse_args()

    min_level = Severity(args.level)
    project_root = args.project or ROOT

    if not project_root.exists():
        print(f"[ERROR] Project root not found: {project_root}")
        return 1

    results = validate_project(project_root, min_level)
    filtered = filter_by_severity(results, min_level)

    # 按严重程度排序
    severity_order = [Severity.ERROR, Severity.WARN, Severity.INFO]
    filtered.sort(key=lambda r: severity_order.index(r.severity))

    # 输出结果
    for result in filtered:
        print(result)

    # 统计
    error_count = len([r for r in results if r.severity == Severity.ERROR])
    warn_count = len([r for r in results if r.severity == Severity.WARN])

    print(f"\n验证完成: {error_count} 个错误, {warn_count} 个警告")

    return 0 if error_count == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
