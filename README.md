# FrameQ

把一条抖音视频 URL，变成本地视频、完整文字稿和可继续思考的启发话题点。

FrameQ 是一个本地优先的桌面客户端：它把视频下载、媒体校验、音频提取、SenseVoice Small 转写和 InsightFlow 话题点生成串成一条清晰的工作流。你粘贴一个已授权处理的公开视频链接，剩下的交给本机 worker 完成。

```text
Douyin URL
  -> yt-dlp 下载公开视频
  -> ffprobe 校验媒体流
  -> ffmpeg 提取 16 kHz 单声道音频
  -> SenseVoice Small 本地转写
  -> InsightFlow 生成启发话题点
  -> txt / md / json 文件导出
```

## Why FrameQ

- 本地优先：视频、音频和文字稿默认留在本机。
- 一条链路：下载、转码、ASR、话题点生成、导出都在同一个桌面工作流里。
- 可解释进度：UI 明确展示视频提取、视频转译、话题点生成、完成或失败。
- 可恢复结果：InsightFlow 配置缺失或调用失败时，仍保留文字稿，并支持只重试话题点生成。
- 真取消：处理中取消会终止当前 worker 进程树，晚到结果不会覆盖 UI。
- 可审计工程：产品规格、架构、设计、安全边界、执行计划和验证脚本都在仓库内。

## Current MVP

FrameQ 的 MVP 已经打通：

- Tauri + React + TypeScript 桌面客户端。
- Python worker 调用 `yt-dlp`、`ffprobe`、`ffmpeg` 和 SenseVoice/FunASR runtime。
- 默认 ASR 模型：`iic/SenseVoiceSmall`。
- Qwen ASR adapter 仍保留在代码里，但首版普通用户 release 不默认安装 `qwen-asr`，开发者需要时可用 `uv sync --dev --extra qwen` 安装可选依赖。
- 内置裁剪后的 InsightFlow 话题点生成模块。
- `.env` 驱动 OpenAI-compatible LLM 配置。
- 支持导出：
  - `outputs/<video_id>.mp4`
  - `outputs/<video_id>_transcript.txt`
  - `outputs/<video_id>_transcript.md`
  - `outputs/<video_id>_insights.json`
  - `outputs/<video_id>_insights.md`

## Architecture

```mermaid
flowchart LR
  User["User"] --> App["Tauri Desktop UI"]
  App --> Command["Tauri Commands"]
  Command --> Worker["Python Worker"]
  Worker --> Downloader["yt-dlp"]
  Worker --> Probe["ffprobe"]
  Worker --> Audio["ffmpeg"]
  Worker --> ASR["SenseVoice Small"]
  Worker --> Insight["Embedded InsightFlow"]
  Insight --> LLM["OpenAI-compatible LLM"]
  Worker --> Files["outputs/ and work/"]
  Files --> App
```

Runtime boundary: the app must not import from `D:\Github\InsightFlow\src\server`. Required InsightFlow behavior lives inside `worker/insightflow/`.

## Quick Start

Install dependencies:

```powershell
uv sync --dev
npm --prefix app install
```

Run focused checks:

```powershell
uv run ruff check worker
uv run pytest worker\tests
npm --prefix app test
```

Build the frontend:

```powershell
npm --prefix app run build
```

Build the desktop app without bundling an installer:

```powershell
npm --prefix app run tauri -- build --no-bundle
```

The built executable is written to:

```text
app/src-tauri/target/release/app.exe
```

Build unsigned internal installer resources and package:

```powershell
$env:FRAMEQ_PYTHON_STANDALONE_URL = "D:\archives\python-build-standalone.tar.zst"
$env:FRAMEQ_FFMPEG_ARCHIVE_URL = "D:\archives\ffmpeg-release.zip"
powershell -ExecutionPolicy Bypass -File scripts\build-installer.ps1 -Target windows-x64
```

The Python and ffmpeg values may be URLs or local archive paths. Use `-Target windows-x64`, `-Target macos-arm64`, or `-Target macos-x64` on the matching build machine. The installer build copies runtime files into `app/src-tauri/resources/`, then runs `tauri build`. Large generated resources stay out of git.
The installer does not bundle SenseVoice Small weights. It prunes non-runtime Python debug/cache/test/header artifacts, keeps `resources/models` out of the bundle, and installed builds guide the user through downloading SenseVoice Small into app-local data on first run. The default installer dependency set excludes Qwen-only packages; `qwen-asr` is an optional development extra. macOS targets map to explicit Tauri triples (`aarch64-apple-darwin` or `x86_64-apple-darwin`) instead of relying on the host default.

## LLM Configuration

For development, copy `.env.example` to `.env` and fill in local values. In installed builds, the settings sheet writes the same keys to the app-local data `.env`.

```dotenv
FRAMEQ_LLM_PROVIDER=openai_compatible
FRAMEQ_LLM_BASE_URL=https://api.example.com/v1
FRAMEQ_LLM_API_KEY=your-api-key
FRAMEQ_LLM_MODEL=your-model
FRAMEQ_LLM_TIMEOUT_SECONDS=60
```

When this is configured, transcript text is sent to the configured LLM service for InsightFlow topic generation. Without it, FrameQ still produces the transcript and enters `部分完成`, so you can retry later.

## Release Runtime

Installed builds run the bundled Python worker directly and set `FRAMEQ_ALLOW_REAL_ASR=1` automatically. SenseVoice Small is the only release-exposed ASR model in the first installer build, but the model cache is downloaded on first run into app-local data.

Development CLI runs can still override the model cache with:

```powershell
$env:FRAMEQ_MODEL_DIR = "D:\path\to\models"
```

Release operators can override the default ModelScope download source with:

```powershell
$env:FRAMEQ_ASR_MODEL_DOWNLOAD_URL = "https://cdn.example.com/frameq/sensevoice-small-cache.zip"
$env:FRAMEQ_ASR_MODEL_DOWNLOAD_SHA256 = "expected-sha256"
$env:FRAMEQ_MODELSCOPE_ENDPOINT = "https://www.modelscope.cn"
$env:FRAMEQ_SENSEVOICE_REVISION = "master"
```

The custom archive must contain `models/iic/SenseVoiceSmall/model.pt` and `models/iic/speech_fsmn_vad_zh-cn-16k-common-pytorch/model.pt`. LLM API keys and cloud model credentials are never packaged.

## Worker Smoke

Retry InsightFlow generation from an existing transcript without rerunning download or ASR:

```powershell
$env:PYTHONPATH = "$PWD\worker"
@'
import json
from pathlib import Path
from frameq_worker.cli import retry_insights_once

transcript_path = "outputs/7524373044106677544_transcript.txt"
text = Path(transcript_path).read_text(encoding="utf-8")
result = retry_insights_once(
    json.dumps({"transcript_path": transcript_path, "text": text}),
    project_root=Path.cwd(),
)
print(json.dumps({
    "status": result["status"],
    "insights_count": len(result["insights"]),
    "insights_path": result["insights_path"],
}, ensure_ascii=False, indent=2))
'@ | uv run python -
```

Tauri passes the JSON argument directly. For manual shell smoke tests, stdin scripts avoid PowerShell JSON quoting issues.

## Project Map

- `app/` - Tauri + React + TypeScript desktop client.
- `worker/` - Python worker for download, media validation, audio extraction, ASR and InsightFlow.
- `worker/insightflow/` - embedded InsightFlow topic generation code.
- `outputs/` - generated videos, transcripts and insight files.
- `work/` - intermediate audio and temporary files.
- `models/` - local ASR model cache.
- `docs/` - architecture, design, security, product specs and execution plans.
- `AGENTS.md` - AI collaboration entry map.
- `WORKFLOW.md` - project workflow rules.
- `TASKS.md` - current recovery/task checkpoint.

## Validation Gates

Before claiming a change is complete:

```powershell
python scripts/validate_agents_docs.py --level WARN
uv run ruff check worker
uv run pytest worker\tests
npm --prefix app test
npm --prefix app run build
cargo test --manifest-path app\src-tauri\Cargo.toml
```

For desktop release validation:

```powershell
npm --prefix app run tauri -- build --no-bundle
```

## Use Boundaries

FrameQ is for:

- public videos,
- your own videos,
- or videos you have permission to process.

FrameQ is not for bypassing platform access controls, bulk scraping unauthorized content, or republishing copyrighted/private material. If cloud LLM generation is enabled, treat transcript text as data sent to that configured provider.

## Source Of Truth

The original technical plan is [douyin_video_download_solution.md](douyin_video_download_solution.md). The completed MVP execution plan is [docs/exec-plans/completed/2026-06-16-mvp-desktop-client-plan.md](docs/exec-plans/completed/2026-06-16-mvp-desktop-client-plan.md).
