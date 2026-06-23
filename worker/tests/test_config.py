from pathlib import Path

from frameq_worker.config import load_project_env, parse_dotenv


def test_load_project_env_ignores_project_root_dotenv(
    tmp_path: Path,
) -> None:
    (tmp_path / ".env").write_text(
        "\n".join(
            [
                "FRAMEQ_OUTPUT_DIR=D:/dotenv-results",
                "FRAMEQ_ASR_MODEL=iic/SenseVoiceSmall",
                "FRAMEQ_LLM_API_KEY=legacy-dotenv-key",
                "FRAMEQ_LLM_MODEL=legacy-dotenv-model",
            ]
        ),
        encoding="utf-8",
    )

    env = load_project_env(
        tmp_path,
        environ={"FRAMEQ_OUTPUT_DIR": "D:/shell-results"},
    )

    assert env == {"FRAMEQ_OUTPUT_DIR": "D:/shell-results"}


def test_parse_dotenv_ignores_comments_blank_lines_and_malformed_entries(
    tmp_path: Path,
) -> None:
    dotenv_path = tmp_path / ".env"
    dotenv_path.write_text(
        "\n".join(
            [
                "",
                "# comment",
                "not-an-env-line",
                'FRAMEQ_OUTPUT_DIR="D:/FrameQ/results"',
            ]
        ),
        encoding="utf-8",
    )

    env = parse_dotenv(dotenv_path)

    assert env == {"FRAMEQ_OUTPUT_DIR": "D:/FrameQ/results"}


def test_load_project_env_reads_user_data_dotenv_without_legacy_llm_keys(
    tmp_path: Path,
) -> None:
    project_root = tmp_path / "project"
    user_data_dir = tmp_path / "user-data"
    project_root.mkdir()
    user_data_dir.mkdir()
    (project_root / ".env").write_text(
        "FRAMEQ_OUTPUT_DIR=D:/project-results\nFRAMEQ_MODEL_DIR=D:/project-models",
        encoding="utf-8",
    )
    (user_data_dir / ".env").write_text(
        "\n".join(
            [
                "FRAMEQ_OUTPUT_DIR=D:/user-results",
                "FRAMEQ_ASR_MODEL=iic/SenseVoiceSmall",
                "FRAMEQ_LLM_API_KEY=legacy-user-key",
                "FRAMEQ_LLM_MODEL=legacy-user-model",
            ]
        ),
        encoding="utf-8",
    )

    env = load_project_env(
        project_root,
        environ={"FRAMEQ_USER_DATA_DIR": user_data_dir.as_posix()},
    )

    assert env["FRAMEQ_OUTPUT_DIR"] == "D:/user-results"
    assert env["FRAMEQ_ASR_MODEL"] == "iic/SenseVoiceSmall"
    assert env["FRAMEQ_USER_DATA_DIR"] == user_data_dir.as_posix()
    assert "FRAMEQ_MODEL_DIR" not in env
    assert "FRAMEQ_LLM_API_KEY" not in env
    assert "FRAMEQ_LLM_MODEL" not in env


def test_load_project_env_preserves_server_checkout_process_env(
    tmp_path: Path,
) -> None:
    (tmp_path / ".env").write_text(
        "FRAMEQ_LLM_API_KEY=legacy-dotenv-key\nFRAMEQ_LLM_MODEL=legacy-dotenv-model",
        encoding="utf-8",
    )

    env = load_project_env(
        tmp_path,
        environ={
            "FRAMEQ_LLM_SOURCE": "server",
            "FRAMEQ_LLM_CHECKOUT_URL": "https://frameq.8xf.pro/api/desktop/llm/checkouts",
            "FRAMEQ_LLM_SESSION_TOKEN": "desktop-token",
            "FRAMEQ_LLM_CHECKOUT_REQUEST_ID": "request-id",
        },
    )

    assert env["FRAMEQ_LLM_SOURCE"] == "server"
    assert env["FRAMEQ_LLM_CHECKOUT_URL"] == "https://frameq.8xf.pro/api/desktop/llm/checkouts"
    assert env["FRAMEQ_LLM_SESSION_TOKEN"] == "desktop-token"
    assert env["FRAMEQ_LLM_CHECKOUT_REQUEST_ID"] == "request-id"
    assert "FRAMEQ_LLM_API_KEY" not in env
    assert "FRAMEQ_LLM_MODEL" not in env
