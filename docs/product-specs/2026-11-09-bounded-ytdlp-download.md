# 有界的 yt-dlp 下载子进程

## 意图

用户提交公开视频链接后，下载阶段可能停在一个已经建立、却不再传送数据的连接上。yt-dlp 的 socket 超时只约束单次网络操作，这类连接会一直占着任务；界面停留在「视频提取」，桌面端 `ProcessVideo` 的 45 分钟无进度策略是唯一的结束条件。本次改动给 yt-dlp 子进程设定 20 分钟固定预算，到期终止子进程，任务以明确的下载失败结束。

## 边界

- 预算只作用于 `build_ytdlp_command` 生成的命令形状，即 `sys.executable -m yt_dlp ...`。`ffprobe`、`ffmpeg` 与 B 站备用下载命令的执行时间维持原状。
- 超时结果沿现有 `CommandExecutionError` 到 `VIDEO_DOWNLOAD_FAILED` 的路径上报。前端原因码集合、错误文案与三语文案都不新增条目。
- YouTube 的字幕失败重跑、通用失败单次重试以及抖音、小红书、B 站三个备用下载路径都跳过超时结果。一次超时最多产生一次 20 分钟等待，保证桌面端 45 分钟无进度策略不会先于下载失败触发。
- `CommandRunner` 的函数签名保持不变，全部注入测试与既有调用点无需改动。
- `uv.lock` 里的 yt-dlp 版本、平台备用下载策略表、平台 URL 支持规则、账号服务数据边界、本地文字稿与模型缓存的处理都保持不变。
- Python 标准库终止并回收 yt-dlp 主进程。yt-dlp 在合并阶段派生的 ffmpeg 子进程可能短时残留，桌面端 `ProcessSupervisor` 在该 worker 操作结束时终止整个进程树。
- 超时不触发自动重试，不产生 AI Credits 调用，不写入任务根目录之外的文件。

## 失败与恢复

- 下载命令在预算内正常返回时，行为与改动前一致。
- 预算到期时返回带 `VIDEO_DOWNLOAD_TIMEOUT` 前缀的结果，`download_video` 立即抛出 `CommandExecutionError`，`MediaPreparationFacade` 把它包成 `VIDEO_DOWNLOAD_FAILED`。用户看到下载失败与既有处理结果入口，可以重新提交任务。
- 已经写入下载目录的残缺媒体文件由既有 `VIDEO_DOWNLOAD_OUTPUT_MISSING` 与媒体校验路径处理，本次改动不新增清理动作。

## 验收

- 用一个形状相同、真实挂起的子进程验证 `run_command` 在给定预算内结束，并返回带 `VIDEO_DOWNLOAD_TIMEOUT` 前缀的非零结果。
- `build_ffprobe_command` 与 `build_audio_extract_command` 生成的命令不套用该预算。
- `download_video` 收到超时结果时只调用一次下载命令，字幕重跑、YouTube 单次重试与三个平台备用路径都不触发。
- 真实公开 YouTube 链接经 `download_video()` 完成下载，`returncode=0`，`ffprobe` 确认产物有效。本机复验需要把 `app/src-tauri/resources/bin` 前置进 PATH，并使用Windows系统代理 `http://127.0.0.1:7890`。
- 门禁：`uv run ruff check worker`、`uv run pytest worker/tests`、`node --test scripts/tests/*.test.mjs`、`python -m pytest scripts/tests`、`uv run python scripts/validate_agents_docs.py --level WARN`、`git diff --check`。
