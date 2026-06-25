import importlib.util
import sys
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[1] / "validate_agents_docs.py"
SPEC = importlib.util.spec_from_file_location("validate_agents_docs", MODULE_PATH)
assert SPEC is not None
validate_agents_docs = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = validate_agents_docs
SPEC.loader.exec_module(validate_agents_docs)

Severity = validate_agents_docs.Severity
validate_project = validate_agents_docs.validate_project


def test_validate_project_ignores_external_vendor_agents(tmp_path: Path) -> None:
    (tmp_path / "scripts").mkdir()
    (tmp_path / "docs").mkdir()
    (tmp_path / "lib-external" / "EasyDownload").mkdir(parents=True)
    (tmp_path / "ruff.toml").write_text("", encoding="utf-8")
    (tmp_path / "scripts" / "validate_agents_docs.py").write_text("", encoding="utf-8")
    (tmp_path / "WORKFLOW.md").write_text("# Workflow\n", encoding="utf-8")
    (tmp_path / "docs" / "EXECUTION_GATES.md").write_text("# Gates\n验证\n", encoding="utf-8")
    (tmp_path / "docs" / "ARCHITECTURE.md").write_text(
        "# Architecture\n\n## 概述\n\n## 代码地图\n\n## 关键文件\n\n## 不变量\n",
        encoding="utf-8",
    )
    (tmp_path / "TASKS.md").write_text(
        "# Tasks\n\n## 进行中\n\n## 待办\n\n## 已完成\n- [x] Done ✅ verified\n",
        encoding="utf-8",
    )
    (tmp_path / "AGENTS.md").write_text(
        "\n".join(
            [
                "# AGENTS",
                "",
                "## 快速入口",
                "- docs",
                "",
                "## 核心信念",
                "- local first",
                "",
                "## 开发流程",
                "- inspect then verify",
                "",
                "## 约束机制",
                "- 模式：`linter+agents`",
                "- 配置：`ruff.toml`",
                "",
                "## 常用命令",
                "- validate docs",
                "- test",
                "- build",
                "- lint",
            ]
        ),
        encoding="utf-8",
    )
    (tmp_path / "lib-external" / "EasyDownload" / "AGENTS.md").write_text(
        "# External project instructions\n",
        encoding="utf-8",
    )

    results = validate_project(tmp_path, Severity.WARN)

    assert all("lib-external" not in result.path.parts for result in results)
