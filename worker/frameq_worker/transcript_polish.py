from __future__ import annotations

import asyncio
import hashlib
import json
import os
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path

from agent_runtime.provider.sources.openai_source import ProviderOpenAIOfficial

from frameq_worker.atomic_files import atomic_write_text
from frameq_worker.desktop_contract import ProgressCallback
from frameq_worker.draft_agent import build_llm_provider, resolve_draft_credentials
from frameq_worker.insightflow.splitter import MarkdownSplitter
from frameq_worker.models import JobStage, ProcessResult, WorkerError
from frameq_worker.progress_events import build_worker_progress_event
from frameq_worker.task_store import TaskContext

POLISH_CHUNK_CHARS = 2000
POLISH_MAX_CHUNKS = 24
POLISH_CONTEXT_CHARS = 200
POLISH_META_SCHEMA_VERSION = 1

# 整理稿是「中度整理」：先修语音识别失真，再删不影响原意的口头语与无意义
# 重复，并按语义分段。红线是不改事实、不换实词、不润色。破折号与一字线
# 一律禁用，避免文稿被送去排版或朗读时被当成连接号。
POLISH_SYSTEM_PROMPT = (
    "你是语音识别文字稿的整理助手。你会拿到一段由语音识别生成的文字稿片段。"
    "请把它整理成忠实原意、读起来顺畅的文稿。"
    "一、先修正语音识别造成的失真：同音与近音错字、漏字、多字重复、断句错误和标点错误。"
    "二、删除不影响原意的口头语与填充词，比如「啊、呢、吧、嗯、就是说、对吧、这个、那个」，"
    "以及重复啰嗦、没有信息量的表达。"
    "三、按语义把内容划分成自然段落，每段围绕一个意思；不添加小标题、序号或任何标记。"
    "四、不得改变原意，不得增删事实内容，不得推测并补写没说过的词句。"
    "五、保留说话人的用词与专有名词、术语，不换成书面同义词，不润色，不升华。"
    "六、保持原本的语言，不要翻译。"
    "七、禁止使用破折号和一字线；并列用顿号，范围用「至」字连接。"
    "八、只输出这一片段整理后的正文，不要加引号，也不要加任何解释。"
)

PolishRunner = Callable[[str, Mapping[str, str], ProgressCallback | None], str]


def source_transcript_sha256(body: str) -> str:
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def chunk_transcript(body: str, max_chars: int = POLISH_CHUNK_CHARS) -> list[str]:
    return [chunk.content for chunk in MarkdownSplitter(max_length=max_chars).split(body)]


def build_polish_prompt(index: int, chunks: Sequence[str]) -> str:
    preceding = chunks[index - 1][-POLISH_CONTEXT_CHARS:] if index > 0 else ""
    sections: list[str] = []
    if preceding:
        sections.append(
            "以下是上一段的结尾，只用来衔接语气与专有名词，不要修正它，也不要输出它：\n"
            f"{preceding}"
        )
    sections.append(f"以下是需要修正的第 {index + 1} 段（共 {len(chunks)} 段）：\n{chunks[index]}")
    return "\n\n".join(sections)


# ai.generation.running 的 attempt / total 必须在 1 至 100，段数更多时归一化。
def _scaled_progress(chunk_count: int) -> Callable[[int], int]:
    scale = max(1, min(100, chunk_count))

    def attempt_for(index: int) -> int:
        return max(1, min(scale, index + 1))

    return attempt_for


async def _polish_chunks(
    chunks: Sequence[str],
    provider: ProviderOpenAIOfficial,
    progress_callback: ProgressCallback | None,
) -> tuple[str, int]:
    """逐段修正，返回（拼接后的整理稿，模型没有返回内容的段数）。"""
    polished: list[str] = []
    empty_chunks = 0
    attempt_for = _scaled_progress(len(chunks))
    for index in range(len(chunks)):
        if progress_callback is not None:
            progress_callback(
                build_worker_progress_event(
                    "ai.generation.running",
                    stage=JobStage.INSIGHTS_GENERATING.value,
                    progress=70 + ((index * 20) // len(chunks)),
                    message_args={
                        "attempt": attempt_for(index),
                        "total": max(1, min(100, len(chunks))),
                    },
                )
            )
        response = await provider.text_chat(
            prompt=build_polish_prompt(index, chunks),
            system_prompt=POLISH_SYSTEM_PROMPT,
        )
        text = (response.completion_text or "").strip()
        if not text:
            # 单段没有产出时退回原片段，宁可不修正也不能静默丢内容。
            empty_chunks += 1
            polished.append(chunks[index].strip())
        else:
            polished.append(text)
    return "\n".join(part for part in polished if part), empty_chunks


def polish_transcript_via_agent_runtime(
    body: str,
    env: Mapping[str, str],
    progress_callback: ProgressCallback | None = None,
) -> str:
    """按段调 LLM 修正文字稿，返回拼接后的整理稿正文。

    整次整理只 checkout 一次 LLM 凭据（与成稿 agent loop 的计费单位一致），
    所有分段共享同一份 provider。
    """
    merged_env = resolve_draft_credentials(env)
    provider = build_llm_provider(merged_env)
    chunks = chunk_transcript(body)
    polished, empty_chunks = asyncio.run(
        _polish_chunks(chunks, provider, progress_callback)
    )
    if empty_chunks and empty_chunks == len(chunks):
        return ""
    return polished


def _polish_failed(code: str, message: str, body: str) -> ProcessResult:
    return ProcessResult(
        status=JobStage.PARTIAL_COMPLETED,
        text=body,
        error=WorkerError(
            code=code,
            message=message,
            stage=JobStage.INSIGHTS_GENERATING,
        ),
    )


def _read_official_transcript(
    task_dir: Path,
    transcript_txt_path: Path,
) -> tuple[str, ProcessResult | None]:
    is_junction = getattr(os.path, "isjunction", lambda _path: False)
    expected_transcript_path = task_dir / "transcript" / "transcript.txt"
    if (
        transcript_txt_path.absolute() != expected_transcript_path.absolute()
        or transcript_txt_path.is_symlink()
        or transcript_txt_path.parent.is_symlink()
        or transcript_txt_path.parent.parent.is_symlink()
        or is_junction(transcript_txt_path)
        or is_junction(transcript_txt_path.parent)
        or is_junction(transcript_txt_path.parent.parent)
    ):
        return "", _polish_failed(
            "TRANSCRIPT_TEXT_PATH_INVALID",
            "Official transcript.txt is required for transcript polishing.",
            "",
        )

    try:
        raw = transcript_txt_path.read_bytes().decode("utf-8")
    except (OSError, UnicodeError):
        return "", _polish_failed(
            "TRANSCRIPT_TEXT_NOT_FOUND",
            "Official transcript text could not be read.",
            "",
        )

    body = raw.strip()
    if not body:
        return "", _polish_failed(
            "POLISH_EMPTY_TRANSCRIPT",
            "Official transcript text is empty.",
            "",
        )
    return body, None


def run_transcript_polish_step(
    *,
    task_context: TaskContext,
    runtime_env: Mapping[str, str],
    progress_callback: ProgressCallback | None = None,
    polish_runner: PolishRunner | None = None,
) -> ProcessResult:
    """生成一份 LLM 修正后的整理稿，原 ASR 稿保持只读。

    产物是两个独立文件：``transcript/polished.txt`` 是整理后的正文，
    ``transcript/polished.meta.json`` 记原稿摘要，桌面端据此判断整理稿是否已过期。
    """
    body, failure = _read_official_transcript(
        task_context.paths.task_dir,
        task_context.paths.transcript_txt_path,
    )
    if failure is not None:
        return failure

    chunks = chunk_transcript(body)
    if len(chunks) > POLISH_MAX_CHUNKS:
        return _polish_failed(
            "POLISH_TRANSCRIPT_TOO_LONG",
            f"Transcript needs more than {POLISH_MAX_CHUNKS} polish chunks.",
            body,
        )

    runner = polish_runner or polish_transcript_via_agent_runtime
    try:
        polished = runner(body, runtime_env, progress_callback)
    except Exception as exc:
        return _polish_failed("POLISH_FAILED", str(exc), body)

    polished_text = (polished or "").strip()
    if not polished_text:
        return _polish_failed(
            "POLISH_LLM_EMPTY_RESULT",
            "Transcript polishing returned an empty result.",
            body,
        )

    paths = task_context.paths
    try:
        atomic_write_text(paths.transcript_polished_txt_path, f"{polished_text}\n")
        atomic_write_text(
            paths.transcript_polished_meta_path,
            json.dumps(
                {
                    "schemaVersion": POLISH_META_SCHEMA_VERSION,
                    "sourceTranscriptSha256": source_transcript_sha256(body),
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
        )
    except OSError:
        return _polish_failed(
            "POLISH_ARTIFACT_WRITE_FAILED",
            "Polished transcript could not be stored safely.",
            body,
        )

    return ProcessResult(status=JobStage.COMPLETED, text=body)
