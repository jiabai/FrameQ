# Bounded yt-dlp Download Plan

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

用户提交公开视频链接后，下载阶段不再无限期停在一个已经建立、却不再传送数据的连接上。yt-dlp 子进程运行满 20 分钟即被终止，任务以 `VIDEO_DOWNLOAD_FAILED` 结束，界面回到可重新提交的状态。正常下载、慢速网络下的大文件下载、平台备用下载路径以及本地文字稿与模型缓存的处理都维持原状。本次改动不新增界面元素，不新增前端原因码，不触碰账号服务与云端调用。

## Progress

- [x] 2026-11-09: 读取 `worker/frameq_worker/media.py`、`media_preparation.py`、`worker_application/url_processing.py`、`worker/tests/test_media.py` 与 `app/src-tauri/src/worker_runtime/runner/watchdog.rs`，确认 `run_command` 是全部外部命令共用的执行入口，`CommandRunner` 是单参数可调用对象，生产链路把 `run_command` 注入 `MediaPreparationFacade`。Validation: 源码逐行读取；`CommandRunner = Callable[[list[str]], CommandResult]` 位于 `media.py:36`；`command_runner: CommandRunner = run_command` 位于 `url_processing.py:29`。
- [x] 2026-11-09: 核实桌面端 `ProcessVideo` 的看门狗策略为 45 分钟无进度、8 小时绝对上限，确认下载阶段 `MediaPreparationFacade._prepare_url` 在下载前后才发送进度事件。Validation: `watchdog.rs:38-41`；`media_preparation.py:75,89`。
- [x] 2026-11-09: 写出产品规格 `docs/product-specs/2026-11-09-bounded-ytdlp-download.md` 并注册到产品索引。Validation: 文件已落盘；`docs/product-specs/index.md` 已追加条目。
- [x] 2026-11-09: 实现 `run_command` 的按命令形状预算、可选 `timeout_seconds`、`TimeoutExpired` 到 `VIDEO_DOWNLOAD_TIMEOUT` 的转换，以及 `download_video` 三个下载结果入口的超时早退。Validation: `uv run pytest worker/tests/test_media.py -q` 40 passed；`uv run ruff check worker` All checks passed。
- [x] 2026-11-09: 跑完整硬门禁并同步 durable docs 与技术债台账。Validation: `uv run pytest worker/tests -q` 1275 passed / 4 skipped；`node --test scripts/tests/*.test.mjs` 57 pass；`uv run python -m pytest scripts/tests -q` 1 passed；`validate_agents_docs.py --level WARN` 0 错误 0 警告；`git diff --check` 通过。
- [x] 2026-11-09: 定位代理失败根因，补跑公网 YouTube 下载回归，归档本计划。Validation: `uv run` 子进程的 `urllib.request.getproxies()` 返回 `{'https': 'http://127.0.0.1:54717'}`（WorkBuddy 会话内置代理，对 YouTube 返 502 / SSL EOF），而 `curl -x http://127.0.0.1:7890` 对 shorts 页面连续 5 次返回 200；在 Python 进程内清除大写代理变量、写小写 `https_proxy`/`http_proxy=http://127.0.0.1:7890` 后 `urllib` 取回 1,118,708 字节页面。`download_video('https://www.youtube.com/shorts/nnV9a4w2WjQ')` 返回 `returncode=0`，产物 `nnV9a4w2WjQ.mp4` 1,557,058 字节；`ffprobe` 读出 av1 360x640 视频 + aac 音频、duration 59.443084 秒。日志显示 deno 解 JS challenge、格式 `396+140` 合并 mp4、该视频无请求语言字幕。

## Surprises & Discoveries

- Evidence: `worker/frameq_worker/media.py:225-232` 的 `run_command` 被 `download_video`、`probe_media_file`、`extract_audio` 以及 B 站备用路径共用。给这个函数统一加超时会限制 `ffmpeg` 提取长视频音频的时间，因此预算必须按命令形状区分。
- Evidence: `app/src-tauri/src/worker_runtime/runner/watchdog.rs:38-41` 显示 `ProcessVideo` 的无进度策略为 45 分钟、绝对上限 8 小时；`worker/frameq_worker/media_preparation.py:75,89` 显示下载前发出 18% 事件、下载完成后才发出 34% 事件。下载阶段本身不发送进度事件，因此 yt-dlp 的预算必须短于 45 分钟，且超时结果不能触发 `media.py:265-270` 的 YouTube 单次重试，否则两次预算叠加会先被桌面端看门狗终止。
- Evidence: `worker/frameq_worker/media.py:36` 把 `CommandRunner` 定义为单参数可调用对象，`worker/tests/` 下有 30 余处注入该对象。改这个签名会扩散到全部注入点，因此预算作为 `run_command` 的可选关键字参数，由 `download_video` 保持单参数调用。
- Evidence: `worker/frameq_worker/media.py:452-532` 的 `classify_youtube_download_failure` 会把任何未匹配的原始消息归入 `YOUTUBE_DOWNLOAD_FAILED`，而 `media.py:265-270` 对通用码执行一次重试。超时结果需要在分类之前直接抛出。
- Evidence: `app/src/safeTechnicalDetails.ts:14-54` 的 `VIDEO_DOWNLOAD_REASON_CODES` 是封闭集合，`worker/frameq_worker/media_preparation.py:83-87` 把任何 `CommandExecutionError` 统一包成 `VIDEO_DOWNLOAD_FAILED`。沿用这个路径可以不改动前端。
- Evidence: 2026-11-09 首轮公网下载回归时 yt-dlp stderr 记录 `('Unable to connect to proxy', OSError('Tunnel connection failed: 502 Bad Gateway')). Retrying (1/3)` 与三次 `UNEXPECTED_EOF_WHILE_READING`；但 `curl -x http://127.0.0.1:7890` 对同一 shorts 页面连续 5 次返回 200，`curl` 对 youtubei 与 i.ytimg 端点亦可达。根因不是本机出口整体不可用，而是 `uv run` 子进程的 `urllib.request.getproxies()` 返回 WorkBuddy 会话内置代理 `127.0.0.1:54717`，命令行前缀 `HTTPS_PROXY=http://127.0.0.1:7890` 没有传导进子进程；`urllib` 与 `requests` 走该代理都在 TLS 握手阶段报 `UNEXPECTED_EOF_WHILE_READING`，强制 TLS 1.2 亦无改善。Windows 系统代理（`HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings` 的 `ProxyServer`）仍是 7890。
- Evidence: `TASKS.md:1062-1065` 已记录 2026-10-28 第三次下载冒烟时踩过同一个坑（bash 的 `HTTPS_PROXY` 被覆盖成内置代理）。本次补充可复现的正确做法：在 Python 进程内先 `pop` 大写 `HTTPS_PROXY`/`HTTP_PROXY`/`ALL_PROXY`，再写小写 `https_proxy`/`http_proxy` 指向 7890；同时把 `app/src-tauri/resources/bin` 前置进 `PATH`（与 Rust `prepend_to_path` 等价，内含 deno 2.9.1）。仅靠 shell 前缀赋值不够。成功日志里 `[jsc:deno] Solving JS challenges using deno` 且无 WARNING/ERROR，与 10-28 的结论一致。

## Decision Log

- Decision: 在 `run_command` 内部按命令形状决定预算，命令形如 `sys.executable -m yt_dlp ...` 时使用 20 分钟，其余命令不设预算。Rationale: 生产链路把 `run_command` 注入全部外部命令，按形状区分可以在不改变 `CommandRunner` 签名的前提下只约束下载，同时避免限制 `ffmpeg` 与 `ffprobe`。Date/Author: 2026-11-09 / WorkBuddy。
- Decision: 预算定为 20 分钟。Rationale: 2026-10-28 的真实下载记录显示 34 分钟视频、168,978,515 字节在 39 秒内完成；20 分钟允许约 140 KB/s 的平均速率下完同样大小的文件，同时明显短于桌面端 45 分钟无进度策略。Date/Author: 2026-11-09 / WorkBuddy。
- Decision: `run_command` 增加可选关键字参数 `timeout_seconds`，测试可以传入短预算驱动真实子进程的超时分支。Rationale: 用一个真实挂起的子进程验证终止与结果形状，避免依赖替身对象。Date/Author: 2026-11-09 / WorkBuddy。
- Decision: `download_video` 在拿到 `VIDEO_DOWNLOAD_TIMEOUT` 结果时立即抛出 `CommandExecutionError`，跳过字幕重跑、YouTube 单次重试与平台备用下载。Rationale: 超时是确定性的本地判定，重复执行只会累加等待时间并可能先触发桌面端看门狗。Date/Author: 2026-11-09 / WorkBuddy。
- Decision: 沿用现有 `VIDEO_DOWNLOAD_FAILED` 上报路径，不新增前端原因码与文案。Rationale: 用户可见结果与既有下载失败一致，改动范围限定在 worker 的执行边界。Date/Author: 2026-11-09 / WorkBuddy。
- Decision: 硬门禁通过后仍把本计划留在 `active/`，等公网代理恢复补跑真实下载回归再归档。Rationale: `docs/EXECUTION_GATES.md` 要求涉及下载的改动记录失败路径与可恢复行为，公网下载证据当前缺失，提前归档会让未跑项目失去追踪入口。Date/Author: 2026-11-09 / WorkBuddy。
- Decision: 公网回归通过后把本计划归档到 `completed/`，并把代理踩坑与正确做法写进 Surprises & Discoveries 和 `TASKS.md`。Rationale: 硬门禁与真实下载证据齐备，`active/` 里不再有未跑项；这个代理覆盖问题是第二次出现，需要留下可直接复用的操作口径。Date/Author: 2026-11-09 / WorkBuddy。

## Outcomes & Retrospective

yt-dlp 下载子进程现在有 20 分钟固定预算，到期由 Python 标准库终止并回收，任务沿既有 `VIDEO_DOWNLOAD_FAILED` 路径结束，界面回到可重新提交的状态。正常下载、`ffprobe`、`ffmpeg` 与平台备用下载的执行时间维持原状。`CommandRunner` 单参数签名、平台 URL 支持规则、下载策略表与前端错误码集合都未改动。

Passed: `uv run ruff check worker`（All checks passed）；`uv run pytest worker/tests/test_media.py -q`（40 passed，5 项新增）；`uv run pytest worker/tests -q`（1275 passed / 4 skipped）；`node --test scripts/tests/*.test.mjs`（57 pass）；`uv run python -m pytest scripts/tests -q`（1 passed）；`uv run python scripts/validate_agents_docs.py --level WARN`（0 错误 0 警告）；`git diff --check`（clean）。真实 `sys.executable -m yt_dlp --version` 子进程在 `command_timeout_seconds` 返回的 1200 秒预算下 `returncode=0`，输出 `2026.10.21`，与 `uv.lock` 一致。公网下载回归：`download_video('https://www.youtube.com/shorts/nnV9a4w2WjQ')` 返回 `returncode=0`，产物 `nnV9a4w2WjQ.mp4` 1,557,058 字节、59.443084 秒，`ffprobe` 读出 av1 360x640 视频与 aac 音频；日志显示 deno 解 JS challenge、`396+140` 合并 mp4、无 WARNING/ERROR。

Not run: 无未跑的验收命令。「代理保持连接却不传送数据」的受控复现环境仍未搭建，该分支由真实挂起子进程与五项聚焦测试覆盖，见 Residual risk。

Residual risk: Python 只终止 yt-dlp 父进程，合并阶段派生的 ffmpeg 子进程可能短时残留，由桌面端 `ProcessSupervisor` 在操作结束时终止整个进程树；固定预算在极慢网络下可能提前结束大文件下载；超时分支由真实挂起子进程与聚焦测试覆盖，尚未在公网代理挂起现场触发。

## Context and Orientation

- 产品规格：`docs/product-specs/2026-11-09-bounded-ytdlp-download.md`
- 技术债：`docs/exec-plans/tech-debt-tracker.md` 的 Medium Priority 第一条（已移入 Completed / Resolved）
- worker 执行入口：`worker/frameq_worker/media.py`（`CommandRunner`、`CommandResult`、`run_command`、`build_ytdlp_command`、`download_video`、`classify_youtube_download_failure`）
- worker 调用链：`worker/frameq_worker/media_preparation.py:68-112`、`worker/frameq_worker/worker_application/url_processing.py:29`、`worker/frameq_worker/worker_application/local_media.py:28`
- worker 测试：`worker/tests/test_media.py`
- 桌面端看门狗：`app/src-tauri/src/worker_runtime/runner/watchdog.rs:30-59`
- 前端错误码：`app/src/safeTechnicalDetails.ts:14-54`、`app/src/workerErrorCopy.ts`
- 文档治理：`docs/ARCHITECTURE.md`、`docs/SECURITY.md`、`docs/product-specs/index.md`、`docs/exec-plans/active/index.md`、`docs/exec-plans/completed/index.md`
- 历史代理踩坑与正确做法：`TASKS.md:1062-1089`

## Plan of Work

1. 在 `media.py` 增加 `YTDLP_DOWNLOAD_TIMEOUT_SECONDS` 与命令形状判定函数，判定依据为 `command[0] == sys.executable` 且 `command[1:3] == ["-m", "yt_dlp"]`。
2. 给 `run_command` 增加可选关键字参数 `timeout_seconds`。参数为 `None` 时按命令形状取默认预算。`subprocess.run` 传入 `timeout`；捕获 `subprocess.TimeoutExpired` 并返回 `CommandResult(command, 1, "", "VIDEO_DOWNLOAD_TIMEOUT: Media download command exceeded its time budget.")`。
3. 在 `download_video` 的三个下载结果入口（首次调用、字幕失败重跑、YouTube 单次重试）之后统一判定 `VIDEO_DOWNLOAD_TIMEOUT`，命中时直接抛出 `CommandExecutionError`，不进入分类与备用下载循环。
4. 在 `worker/tests/test_media.py` 增加四项聚焦测试：真实挂起子进程在短预算内返回超时结果；`ffprobe` 与 `ffmpeg` 命令不取预算；`download_video` 收到超时结果时下载命令只执行一次且不进入备用下载；超时结果的消息形状与 `CommandExecutionError` 一致。
5. 跑 `uv run ruff check worker`、`uv run pytest worker/tests/test_media.py`、`uv run pytest worker/tests`。
6. 跑 `node --test scripts/tests/*.test.mjs`、`python -m pytest scripts/tests`、`uv run python scripts/validate_agents_docs.py --level WARN`、`git diff --check`。
7. 用真实公开 YouTube 链接跑一次 `download_video()`，把 `app/src-tauri/resources/bin` 前置进 PATH，在 Python 进程内把小写 `https_proxy`/`http_proxy` 指向系统代理 7890，用 `ffprobe` 确认产物有效并记录结果。已执行，见 Progress 末条。
8. 同步 `docs/ARCHITECTURE.md` 与 `docs/SECURITY.md` 的下载执行说明，把技术债 Medium 第一条移入 Completed / Resolved，在 `TASKS.md` 增加完成条目，补齐本计划的 Progress、Decision Log、验证记录与 Outcomes & Retrospective 后归档到 `completed/`。已执行。

## Validation and Acceptance

- `uv run ruff check worker`
- `uv run pytest worker/tests/test_media.py`
- `uv run pytest worker/tests`
- `node --test scripts/tests/*.test.mjs`
- `python -m pytest scripts/tests`
- `uv run python scripts/validate_agents_docs.py --level ERROR` 与 `--level WARN`
- `git diff --check`
- 人工回归：2026-11-09 用真实公开链接 `https://www.youtube.com/shorts/nnV9a4w2WjQ` 经 `download_video()` 完成一次完整下载，`returncode=0`，`ffprobe` 读出 av1 360x640 视频与 aac 音频（1,557,058 字节 / 59.443084 秒），deno 成功解 JS challenge 并合并 `396+140`。预算到期后的失败与可重新提交行为由 `test_run_command_terminates_a_hung_ytdlp_child` 与其余聚焦用例覆盖。
