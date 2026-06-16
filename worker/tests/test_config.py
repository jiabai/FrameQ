from pathlib import Path

from frameq_worker.config import load_project_env


def test_load_project_env_reads_dotenv_and_keeps_existing_env_priority(
    tmp_path: Path,
) -> None:
    (tmp_path / ".env").write_text(
        "\n".join(
            [
                "# local FrameQ config",
                "FRAMEQ_LLM_API_KEY=from-dotenv",
                'FRAMEQ_LLM_MODEL="demo-model"',
                "FRAMEQ_LLM_BASE_URL=https://llm.example/v1",
                "FRAMEQ_LLM_TIMEOUT_SECONDS=12",
            ]
        ),
        encoding="utf-8",
    )

    env = load_project_env(
        tmp_path,
        environ={"FRAMEQ_LLM_API_KEY": "from-shell"},
    )

    assert env["FRAMEQ_LLM_API_KEY"] == "from-shell"
    assert env["FRAMEQ_LLM_MODEL"] == "demo-model"
    assert env["FRAMEQ_LLM_BASE_URL"] == "https://llm.example/v1"
    assert env["FRAMEQ_LLM_TIMEOUT_SECONDS"] == "12"


def test_load_project_env_ignores_comments_blank_lines_and_malformed_entries(
    tmp_path: Path,
) -> None:
    (tmp_path / ".env").write_text(
        "\n".join(
            [
                "",
                "# comment",
                "not-an-env-line",
                "FRAMEQ_LLM_MODEL=demo-model",
            ]
        ),
        encoding="utf-8",
    )

    env = load_project_env(tmp_path, environ={})

    assert env == {"FRAMEQ_LLM_MODEL": "demo-model"}
