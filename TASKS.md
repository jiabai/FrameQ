# Tasks

## Active UI Work

- [ ] Add single-file local video/audio import (2026-07-16) — ✅ Acceptance: accept MP4/M4V/MOV/MKV/AVI/WMV/WebM
  and MP3/WAV/M4A/AAC/FLAC/OGG/Opus/WMA through a Rust-owned native picker and opaque selection
  token; preserve video containers, normalize every source to 16 kHz mono 16-bit PCM WAV, create no
  video artifact for audio tasks, keep full paths out of React/persistence/logs/cloud, and extend
  strict schema-v3 History with a closed local-source variant. ExecPlan:
  `docs/exec-plans/active/2026-07-16-local-media-file-import-plan.md`.

- [x] Add desktop i18n and confirmation-time AI output language (2026-07-15) — ✅ Acceptance: bundle `zh-CN`,
  `zh-TW`, and `en-US`; persist `system | locale` in app-local `ui-preferences.json`; localize UI,
  progress, accessibility, known errors, and History navigation/chrome; require strict contract-v2
  `output_language` for new summary/mindmap/insights requests without translating ASR, subtitles,
  historical user content, or existing AI artifacts and without extra LLM calls or AI Credits. ExecPlan:
  `docs/exec-plans/completed/2026-07-15-desktop-i18n-ai-output-language-plan.md`. ✅ App 488,
  browser 25, Rust 134, worker 363, scripts 22, build/Tauri/docs/diff gates, Windows native
  WebView language switching/restart, and 28-file packaged-worker equality passed. macOS native
  behavior and real-provider language adherence remain explicitly unverified residual risks.

- [x] Upgrade GitHub Actions from Node.js 20-era runtimes (2026-07-12) ✅ Checkout v5, setup-node
  v5, setup-uv v8.3.2, and upload-artifact v6 now use Node.js 24. ✅ Focused workflow contracts
  passed 6/6, the complete script suite passed 15/15, hosted ProcessSupervisor run `29199050303`
  and Intel acceptance run `29199051507` passed at `04b2a92` without Node.js 20 annotations, and no
  Desktop Release was triggered. ExecPlan:
  `docs/exec-plans/completed/2026-07-12-github-actions-node24-upgrade-plan.md`.

- [x] Publish FrameQ v0.2.16 open-source stable release (2026-07-12) — ✅ Version-drift TDD,
  complete local gates, Windows/Intel/Apple Silicon hosted builds, runtime/Deno/codesign evidence,
  local DMG SHA-256 matching, reviewed Gatekeeper disclosure, and explicit final publication
  confirmation all passed. Release: `https://github.com/jiabai/FrameQ/releases/tag/v0.2.16`.
  ExecPlan: `docs/exec-plans/completed/2026-07-12-v0.2.16-open-source-release-plan.md`.

- [x] Add permanent History task deletion (2026-07-12) — Delete one explicitly confirmed supported History vNext task, its video/audio/transcript/AI artifacts, and per-task playback cache to release disk space immediately. Active processing, AI generation, cancellation, transcript save, legacy tasks, and linked storage remain ineligible. Partial filesystem deletion remains an accepted and explicitly reported residual risk. ✅ Windows/local gates passed app 256, Rust 104, worker 231, server 57, scripts 11, builds, Ruff, docs and diff checks; hosted Intel macOS run `29187106602` passed Cargo 103/103 and produced checksum-verified internal DMG artifact `frameq-macos-intel-2-eb5ed4122c0c`. ExecPlans: `docs/exec-plans/completed/2026-07-12-history-task-permanent-deletion-plan.md` and `docs/exec-plans/completed/2026-07-12-macos-intel-acceptance-artifact-plan.md`.

- [x] Polish History height, typography rhythm, and toolbar grouping (2026-07-12) — Applied option A without changing short transcript height or product data flows. ✅ TDD and acceptance: History CSS RED/GREEN, short/long History geometry, toolbar 1366/720 alignment, browser 22/22, app 35 files / 244 tests, production build, docs 0/0, and diff check passed. ExecPlan: `docs/exec-plans/completed/2026-07-12-desktop-density-history-toolbar-polish-plan.md`.

- [x] Refine task-workspace visual hierarchy (2026-07-12) — Applied the approved restrained option A: grouped transcript and AI rows, scoped status ownership, Chinese-only workspace headings, quiet pre-confirmation AI actions, and distinct transcript playback/edit/focus states. ✅ TDD and acceptance: app 35 files / 240 tests, serial Chromium 20/20, refreshed 1366px/900px screenshots, production build, docs 0/0, and diff check passed. ExecPlan: `docs/exec-plans/completed/2026-07-12-task-workspace-visual-hierarchy-plan.md`.

- [x] Correct AI balance terminology to AI Credits (2026-07-11) — Replaced misleading available-generation counts with AI Credits balances and explicit variable-cost disclosure across AI target cards, confirmations, account summary, and account sheet. Internal `llmQuota*` fields and per-call accounting remain unchanged. ✅ TDD: shared copy, target-card, account-copy, and browser-smoke RED assertions preceded implementation; app 236 tests, production build, docs validation, and diff checks passed. ExecPlan: `docs/exec-plans/completed/2026-07-11-ai-credits-terminology-plan.md`.
- [x] Remove the retired process-video automatic-AI contract (2026-07-11) — Deleted `generate_insights` from frontend, strict Rust IPC/stdin DTO, Python request model/parser, service and local pipeline; explicit legacy payloads fail safely; `retry_insights` remains the only AI client, checkout, quota and artifact path. ✅ TDD: frontend contract RED, Rust strict-deserialization RED and Python parser/service RED preceded implementation; final gates passed App 230, Rust 92, worker 230, server 57, scripts 9, Ruff, builds, docs and diff checks. ExecPlan: `docs/exec-plans/completed/2026-07-11-local-transcript-ai-workspaces-plan.md`.
- [x] Reorganize one task into local transcript and AI generation workspaces (2026-07-11) — Keep one task ID while separating local media/audio review/transcript correction from independently confirmed summary and inspiration targets. Preserve worker, quota, SourceIdentity, stdin, ProcessSupervisor, and strict History vNext boundaries. ExecPlan: `docs/exec-plans/completed/2026-07-11-local-transcript-ai-workspaces-plan.md`. ✅ Acceptance: App 230, Rust 92, worker 230, server 57, scripts 9 and all build/lint/docs/diff gates pass; 19 CDP smoke tests plus native Windows/WebView2 fresh-worker acceptance cover real audio/segment review, transcript save/revert, file reveal, dual-column/narrow layout, AI confirmation-before-call, cancellation placement, same-task history, and stale-save isolation.

## Refactoring and Technical Debt

- [x] P2 worker pipeline/media 结构性重构已收口（2026-07-10）✅ `run_worker_pipeline` 已拆为高层编排，媒体下载/选择、视频校验、音频准备和字幕/ASR finalize 下沉到阶段函数；原可选 AI finalize 后续已删除，AI 仅由 `retry_insights` 进入。`media.py` 下载 fallback 由 `DownloadStrategy` + `FALLBACK_DOWNLOAD_STRATEGIES` 驱动，保持 Douyin -> Xiaohongshu -> Bilibili 顺序和 YouTube 原失败分类路径。阶段审查通过 `uv run pytest worker\tests`（154 tests）、`uv run ruff check worker` 和 `git diff --check`。真实平台 smoke、未来新增平台前是否抽 `download_strategies.py`、Python 3.13 `pydub/audioop` 风险已登记在 `docs/exec-plans/tech-debt-tracker.md`。

- [x] P2 orchestration hooks 错误分支测试已补强（2026-07-10）✅ 新增 `useInsightGenerationController` 关键错误分支和 `useSettingsController` load/save/cache/location/profile 错误分支覆盖；阶段审查通过 `npm --prefix app test`（27 files / 184 tests）、`npm --prefix app run build` 和 `git diff --check`。剩余 `useHistoryController` 并发/重复打开场景与轻量 hook harness 限制已登记在 `docs/exec-plans/tech-debt-tracker.md`。

- [x] P2 orchestration hooks 主路径测试已补强（2026-07-09）✅ 新增 `useHistoryController`、`useSettingsController`、`useInsightGenerationController` hook 级单测，覆盖主路径和关键 gate；阶段审查通过 `npm --prefix app test`（27 files / 170 tests）、`npm --prefix app run build` 和 `git diff --check`。下一轮建议优先补 `useInsightGenerationController` preference 读取/保存/retry/profile save-skip 错误分支，其次补 `useSettingsController` load/save/cache/location/profile 错误分支；剩余测试债已登记在 `docs/exec-plans/tech-debt-tracker.md`。

- [x] Close P2 God Component refactor (2026-07-09) ✅ Split `app/src/App.tsx` into focused account, workflow, transcript detail, settings, history, window chrome, and insight generation controllers. Final state: `App.tsx` is a composition root with `actionNotice`, startup/deep-link glue, `openCard` / `locateArtifact`, and Sheet/Flow composition retained. Validation passed: `npm --prefix app test`, `npm --prefix app run build`, and `git diff --check`. Remaining risks and next-stage priorities are tracked in `docs/exec-plans/tech-debt-tracker.md`.

## Account and Billing

- [x] Make payment settlement, activation-code redemption, and administrator compensation transactional (2026-07-10) ✅ Store semantic transaction boundaries now commit all related state together; administrator quota grants use the same audited additive adjustment and have no remaining-quota bypass; verified webhook replays recover only deterministic old payment states, while ambiguous old activation/admin states require audited `manual_repair`. WeChat billing remains disabled/unintegrated. Server/worker/app/Rust/docs/diff gates passed.

- [x] Add server-managed LLM config and monthly insight quota (2026-06-22) ✅ Admin Web owns encrypted dedicated FrameQ client LLM config and per-user quota editing; desktop accounts quota per cloud LLM API call attempt; settings no longer exposes LLM fields; server/app/Rust/worker/docs gates passed.

- [x] Use administrator-issued activation codes as the visible entitlement unlock path (2026-06-21) ✅ Admin OTP login, hash-only one-time 31-day activation codes, desktop redemption, entitlement reuse, Admin Web list/create flow, and client-side processing gate; server/app/Rust/docs gates passed.

- [x] Add account login and entitlement foundation (2026-06-21) ✅ TypeScript Fastify service with Prisma SQLite, email OTP login, desktop deep-link session exchange, entitlement model, and client-side processing gate; server/app/Rust/docs gates passed.

## 进行中

- [x] 实现 History vNext 严格边界（2026-07-11）— 仅接受当前安全 schema v3 manifest；列表只读 manifest，点击后按需读取单任务详情；移除 Rust/Python 后台迁移及旧 schema 兼容路径；旧目录只物理留存并与历史、缓存、详情、编辑和 retry 隔离。✅ 验收：临时探针 supported=1、ignored=1、list 1.687ms、约 1.8MB 单任务 detail 12.094ms；原生 app-local 验收 supported=5、ignored=1、list 1-7ms、detail 4-37ms 且历史打开不启动 Python；app 230、Rust 92、worker 230、server 57、scripts 9、ruff/build/docs/diff 全部通过。

- [x] 补齐 React/UI 自动化 smoke（2026-07-11）✅ 复用现有 Vite + CDP 与 mock Tauri bridge，新增设置加载/失败/缓存清理、processing/retry/cancelling 历史只读、稳定恢复、延迟文字稿保存隔离和 summary/insights target 确认；focused 16/16 连续通过，app 211、Rust 90、worker 249、server 57、scripts 9 及构建/lint 门禁通过。真实 Tauri WebView、安装包和 OS 行为仍明确保留为残余风险。

- [x] 移除原始 source URL 的 worker argv 暴露（2026-07-10，`8c968bf` 已推送）✅ process-video、source identity preflight 与 AI retry 统一使用 1 MiB 上限的一次性 stdin JSON；argv 仅保留固定模式旗标，环境变量、日志与错误不含请求载荷；PID/PGID 在写入前登记到 ProcessSupervisor，阻塞写入期间仍可取消并终止进程树。✅ Rust 90、worker 249、app 205、server 57、scripts 7、ruff/build/docs/diff 与打包 worker 26 文件 SHA-256 一致性门禁通过；仅保留进程内存/管道缓冲区和系统 crash dump 的本机残余风险，ExecPlan 已归档。
- [x] 收口要点总结与启发灵感独立生成（2026-07-11 治理归档）✅ summary/mindmap 与 insights/preference 分目标生成，manifest 合并保留另一目标产物，本地转写与 AI 额度/配置 gate 分离；实现、文档与验证均已完成，ExecPlan 已归档。
- [x] 修复历史任务恢复绕过 workflow controller 的竞争问题（2026-07-10）✅ workflow controller 成为任务身份的唯一入口；视频处理、AI retry 与 `cancelling` 时历史可只读浏览但条目禁用，绝不自动取消后切换；稳定恢复统一失效旧 operation、关闭详情/偏好 flow 并清理 notice，文字稿保存只在预期 task 仍为当前任务时更新。✅ app 205、Rust 85、worker 244、server 57、ruff、build、文档和 diff 门禁通过；历史列表并发加载的请求排序仍登记为技术债。

- [x] 修复桌面端取消任务进程树与真实终态语义（2026-07-10）✅ `ProcessSupervisor` 统一视频 worker 与 ASR 模型下载的实例化、取消占用、失败回退和终态清理；Windows 使用受控 `taskkill /T /F`，Unix 条件实现独立进程组 TERM→KILL；前端只在确认取消后重置，取消失败和自然完成仍保留真实结果。Windows 自动化覆盖已通过；Unix 父子进程实测保留为 Unix 主机发布前验证。
- [x] 取得 macOS ProcessSupervisor 原生主机 CI 证据（2026-07-11）✅ 只读 `macos-latest` workflow 在提交 `b3cc6b3` 的 run `29108659472` / job `86415372457` 完整通过 Rust 90/90，日志明确执行真实父子进程组取消夹具并返回 `ok`；Linux 明确不属于支持平台。技术债已关闭，ExecPlan 已归档。

- [x] 实现桌面端一键升级（2026-06-23）— Tauri updater + GitHub Releases updater manifest/artifacts；客户端与 worker 整体升级，保留 app-local data，不打包 ASR 权重或私有配置。✅ 代码完成，自动化门禁全部通过（server 32、app 84、Rust 31、worker 99、ruff、build、docs）。✅ 2026-06-27 项目决策：因中国境内访问 GitHub Releases 速度过慢，不再执行旧版到新版的 GitHub updater 真实下载/安装测试；该项作为 v1 测试豁免，不再阻塞发布。

## 待办

- [x] Add manual audio playback cache management in settings (2026-07-07) - Settings shows `$APPLOCALDATA/outputs/.frameq-audio-review` size as `Audio playback cache: <size>` and provides `Clear audio playback cache`; clearing deletes only that app-local playback cache, preserves `<FRAMEQ_OUTPUT_DIR>/tasks/<task_id>/` source artifacts, and allows cache regeneration when transcript detail is opened again. ✅ Acceptance: settings UI shows cache size, clear action calls a canonicalized Tauri cleanup command, source task audio remains untouched, and tests cover clear + regenerate-on-open.
- [x] 完成干净 Windows VM 与 macOS arm64/x64 真实安装包验证（2026-07-08）— 用户确认 Windows 与 macOS 安装包验证已完成且无问题；轻量 runtime 安装包在无 Python/uv/ffmpeg 的干净机器完成首启模型下载、URL → 下载 → ASR 文字稿路径。✅ 验收：干净机器安装、首启模型下载、公开视频转写、app-local 数据保留和签名/公证状态记录完成；若最终公开分发 artifact 仍未签名/公证，需在 release note 中显式披露。
- [x] 桌面端一键升级 GitHub updater 真实下载/安装测试豁免（2026-06-27）— 因中国境内访问 GitHub Releases 速度过慢，本项目 v1 不再把旧版到新版的 GitHub updater 实测作为验收或发布阻塞项。✅ 验收口径：自动化门禁、manifest/artifact 生成、Tauri 签名校验配置和直接分发新版安装包路径成立；未声明国内 GitHub 网络真实升级链路已实测通过。

## 已完成
- [x] 实现启发话题点个性化偏好流程（2026-07-06）✅ 增加本地 `我的灵感档案`、本次 6 步生成偏好、AI整理确认摘要、偏好快照和个性化话题点 prompt；偏好只进入 `retry_insights` 并只影响启发话题点生成，summary/Mermaid 保持通用；结果改为结构化话题点并展示匹配理由、启发问题和适合用途；偏好快照作为任务本地产物保存，server 无新增偏好/文字稿/话题点持久化。✅ 自动化门禁通过：app 138、worker 141、Rust 50、ruff、前端 build；真实额度消耗的桌面手工回归未在本会话执行。
- [x] 增加 YouTube/Bilibili 字幕优先 + ASR 兜底（2026-07-05）✅ 公开视频 `yt-dlp` 成功路径会优先复用 YouTube/Bilibili 平台字幕生成正式文字稿，保留视频/音频产物和音频回听；字幕缺失、解析失败或 Bilibili public fallback 路径静默降级到本地 ASR；manifest、历史记录和文字稿 metadata 记录来源，UI 只显示文字稿来源提示，不展示原始字幕文件；不引入登录、Cookie、绕过或下载中心。✅ worker/parser/manifest/Rust/frontend 自动化门禁通过；真实公网字幕样本 smoke 未在本会话执行，保留外部平台可用性残余风险。
- [x] 增加 YouTube 公开视频下载能力（2026-06-29）✅ 支持 watch、youtu.be 和 Shorts 单视频链接，复用现有 yt-dlp → ffprobe → audio → ASR → AI整理流程；新增 720p 转写优先格式策略、`YOUTUBE_*` 失败文案和签名 media URL/cookie 提示脱敏；不做登录、Cookie、playlist 批量、live、会员/年龄/私有绕过或下载中心。✅ worker/app/Rust/build/docs/diff gates 通过；真实 YouTube live smoke 未执行，保留外部平台可用性残余风险。
- [x] 完成 Bilibili 公开视频 fallback（2026-06-27）✅ 支持普通 BV/av 链接、有效 `b23.tv` 短链、`?p=N` 单分 P 选择、公开 `x/web-interface/view` 元数据、`x/player/playurl` DASH 流选择、视频/音频 `.m4s` 安全下载、备选 URL 重试、FFmpeg 合并和 `BILIBILI_*` UI 错误文案；保持转写优先，不做登录、SESSDATA、番剧/PGC、会员内容、DRM、批量下载或下载中心。✅ worker/app/Rust/build/docs/diff 门禁通过；真实公网 Bilibili BV/av/b23.tv smoke 未在本会话执行，保留平台可用性残余风险。
- [x] 补完小红书公开视频 fallback（2026-06-27）✅ 支持分享文本、完整 `xiaohongshu.com` 笔记链接、直接 note_id、`xhslink.com`/`www.xhslink.com` 短链、`xsec_token` 保留、Brotli/gzip/deflate 页面解码、确定性视频流排序、streaming `.part`/Range/超时下载可靠性、fallback 输出路径优先选择和 `XHS_*` UI 错误文案；保持视频转写优先，不做图片 ZIP、登录、Cookie、代理或下载中心。✅ worker/app/Rust/build/docs/diff 门禁通过；真实公开视频 smoke 未执行，因本会话未提供稳定公开验收链接。
- [x] 实现 Admin 手工权益补偿（2026-06-27）✅ Admin Web 支持按用户延长到期时间、增加 LLM API 调用次数，并记录 append-only 审计；桌面端继续通过现有账号状态接口看到更新后的到期时间和剩余额度。✅ server 测试覆盖延期、加次数、无权益创建、鉴权/CSRF/非法参数、审计记录和桌面账号状态刷新；`npm --prefix server test`、`npm --prefix server run build`、`npm --prefix server run prisma:generate` 通过；Admin Web 浏览器手工验收通过并已归档 ExecPlan。
- [x] 增强 EasyDownload 转写优先下载可靠性（2026-06-26）✅ 新增 worker 安全 `.part` 原子写入校验；抖音支持分享文案、短链、note/slides/modal/aweme_id 解析；小红书支持公开视频分享文案和 `xhslink.com` fallback，图片笔记/登录受限内容返回结构化错误；worker/frontend/Rust/build/docs/diff 门禁全部通过。
- [x] 实现抖音分享页 fallback 视频下载（2026-06-26）✅ yt-dlp 失败时自动降级为 iesdouyin.com/share/video 分享页解析 + play_addr ratio 探测 + 多候选流下载，支持 6 种分层错误码和流下载失败自动重试；worker/frontend/Rust 测试、构建、ruff、docs 门禁全部通过；线上烟雾测试通过（201.9 MB MP4, 2 streams, AAC 音频）。
- [x] 增加文字稿要点总结与 Mermaid 思维导图（2026-06-25）✅ 二次确认后一次 AI整理生成 `summary.md`、`mindmap.mmd` 和既有启发话题点；UI 只展示总结和话题点，不展示 Mermaid 源码；worker/Rust/frontend 测试、前端构建和文档门禁通过。
- [x] Expose four artifacts and split transcript/insight flow (2026-06-22) ✅ 主流程只下载视频、提取音频和生成文字稿；结果区提供视频/音频/文字稿/话题点入口；话题点由确认面板单独启动并消耗额度；app/Rust/worker 测试、前端构建和文档门禁通过。
- [x] 改为轻量安装包 + 首启 ASR 模型下载（2026-06-19）✅ 安装包不再打入 `resources/models`；新增 SenseVoice Small / VAD 下载助手、Tauri 下载/取消命令、首启下载引导、缺模型 `ASR_MODEL_NOT_DOWNLOADED` 降级错误和可配置下载源；focused worker/Rust/frontend 测试通过
- [x] 产出 Windows x64 full-bundle 内测安装包（2026-06-19，已被轻量方案取代）✅ 使用真实 Python standalone、ffmpeg/ffprobe 和 `D:\Github\FrameQ\models\models\iic\SenseVoiceSmall` 验证过旧 full-bundle resources；默认 release 依赖排除 `qwen-asr`、显式包含 `torch`，并裁剪 Python debug/cache/test/header 文件；`npm --prefix app run tauri -- build --target x86_64-pc-windows-msvc` 曾成功产出 `FrameQ_0.1.0_x64-setup.exe`（约 1055.5MB）
- [x] 加固安装包发布门禁（2026-06-18，部分规则已被轻量方案取代）✅ 曾加入 full-bundle 模型资源检查；后续轻量方案改为首启下载模型并检查 app-local data 中的 `MODEL_VERSION.txt`、SenseVoice `model.pt` 和 VAD `model.pt`；macOS arm64/x64 构建显式传入 Tauri target triple；Cargo 发布元数据去除脚手架值；新增 Rust/Vitest 回归测试并通过聚焦验证
- [x] 接入普通用户安装即用分发基础（2026-06-18）✅ Tauri release runtime 改为内置 Python/worker/bin resources，配置、历史、输出、cache 和模型缓存改入 app-local data；首启只检测本机 ASR/非 LLM 设置，LLM 就绪状态由 server 管理；release UI 只暴露 SenseVoice Small；补齐 installer distribution spec、active ExecPlan、Tauri resources 与 `scripts/build-installer.mjs`；自动化门禁全部通过
- [x] 接入自定义窗口拖拽和红黄绿窗口按钮（2026-06-18）✅ 红/黄/绿按钮分别调用关闭、最小化、最大化/还原；补齐 Tauri window capability 最小权限；toolbar 拖动改为 Rust 位置更新 fallback 并通过真实窗口坐标验证；新增窗口 chrome 单元测试和浏览器回归断言
- [x] 升级 macOS 桌面工具风格 UI（2026-06-18）✅ React UI 改为桌面窗口、toolbar、URL command panel、task monitor、result workspace 和 sheet 面板；新增浏览器回归测试；前端测试、web build、文档门禁和截图检查通过
- [x] 简化首页为单输入卡片（2026-06-18）✅ 等待输入态只显示 `粘贴视频链接` 卡片；提交 URL 后才显示 task monitor 和结果工作区；浏览器回归测试覆盖状态切换
- [x] 增加 LLM 话题分段规划策略（2026-06-18）✅ 话题点生成先让 LLM 输出 topic plan，再按话题段生成问题；planner 失败时 fallback 到直接生成策略；最终去重并限制总量；worker 测试覆盖 planner、fallback 和总量上限
- [x] 对齐 InsightFlow 话题点 prompt 和生成参数（2026-06-18）✅ FrameQ prompt 同步参考服务的读者视角表达约束，直接生成 fallback 按约每 1000 字 1 个问题，OpenAI-compatible LLM 默认 `temperature=0.7`；worker 测试和 ruff 通过
- [x] Route SenseVoice ModelScope cache into project models directory (2026-06-17) ✅ Worker maps `FRAMEQ_MODEL_DIR` / project `models/` to `MODELSCOPE_CACHE` before building SenseVoice models; worker tests, ruff, and docs validation passed.
- [x] Improve SenseVoice long-audio transcription parameters (2026-06-17) ✅ SenseVoice now enables `fsmn-vad`, long-audio merge parameters, and strips SenseVoice control tags before writing transcripts; worker tests and ruff passed.
- [x] Harden Tauri worker stdout parsing (2026-06-17) ✅ Tauri now extracts the final structured worker JSON result even when ASR/LLM dependencies print logs to stdout; Rust tests and frontend tests passed.
- [x] Reuse local media for repeat URL runs (2026-06-17) ✅ Kept yt-dlp invocation, selected downloaded video by URL video ID, and skipped ffmpeg when an existing WAV validates successfully; worker tests, ruff, and docs validation passed.

- [x] 将默认 ASR 模型切换为 SenseVoice Small（2026-06-17）✅ 默认请求、设置默认值、Tauri 默认配置和 worker schema 均使用 `iic/SenseVoiceSmall`；Qwen3-ASR 仍保留为可选模型

- [x] 增加可选 ASR 模型支持（2026-06-17）✅ 设置面板保存 `FRAMEQ_ASR_MODEL`，worker 支持 Qwen3-ASR 和 `iic/SenseVoiceSmall`；worker/Rust/frontend 测试、文档门禁和 Tauri no-bundle 构建通过

- [x] 增加历史任务查看和输出目录配置（2026-06-17，旧方案已被 task manifest 取代）✅ 曾采用本地 history 记录任务历史；当前任务库以 `frameq-task.json` 为准，设置面板仍保存 `FRAMEQ_OUTPUT_DIR`

- [x] 早期 UI 层 LLM 配置入口（2026-06-17，已废弃）✅ 曾支持桌面 UI 保存 OpenAI-compatible base URL、API key、model 和 timeout；当前已由 server-managed LLM 取代，桌面设置不再输入、保存或回显 LLM 信息。
- [x] MVP 最终验收和残余风险整理（2026-06-17）✅ 真实 InsightFlow LLM retry smoke 返回 `completed` 且生成 8 个话题点；自动化测试、文档门禁和 Tauri no-bundle 构建均通过；高优先级技术债已关闭
- [x] 早期取消任务语义（2026-06-17，已由 2026-07-10 ProcessSupervisor 方案取代）✅ 曾在 UI 点击后立即返回输入态；当前不再忽略可能先到的真实终态。
- [x] 早期 `.env` LLM smoke（2026-06-16，已废弃）✅ 曾用项目根 `.env` 验证 OpenAI-compatible Chat Completions；当前桌面 worker 不再读取项目根或 app-local `.env` 中的 `FRAMEQ_LLM_*`，LLM key/config 只由 FrameQ server 管理。
- [x] 完善话题点重试交互（2026-06-16）✅ `部分完成` 状态的话题点卡片可重新触发 InsightFlow，保留既有文字稿并只重跑话题点生成
- [x] 完善模型下载/加载进度展示（2026-06-16）✅ worker 进度事件经 Tauri 转发到 UI，展示下载、校验、音频提取、模型缓存、模型加载、转写和话题点生成文案
- [x] 完善详情浮窗复制/导出交互（2026-06-16）✅ 复制使用当前 tab 文本，导出在文件管理器中定位生成的 transcript/insights 文件
- [x] 运行真实 Qwen3-ASR 模型推理（2026-06-16）✅ `outputs/7524373044106677544_transcript.txt` 由真实 ASR 生成且非空，模型缓存位于 `models/`
- [x] 用户完成桌面 UI 手工验证（2026-06-16）✅ `app.exe` 显示 FrameQ、提交后进入失败态、返回 `ASR_MODEL_NOT_READY`、失败态不显示取消按钮
- [x] 完成安装器打包验证（2026-06-16）✅ 用户报告 `npm --prefix app run tauri -- build` 已成功
- [x] 将 Rust/Cargo 加入持久 PATH（2026-06-16）✅ 用户报告 `cargo -V` / `rustc -V` 在新会话可用
- [x] 连接 Tauri command、UI 进度与 worker CLI（2026-06-16）✅ `npm --prefix app run tauri -- build --no-bundle` 生成 `app.exe`，worker CLI 子进程烟测返回结构化 JSON
- [x] 内置并适配 InsightFlow 话题点生成（2026-06-16）✅ `outputs/7524373044106677544_insights.json` 包含非空 `insights`
- [x] 实现 ASR adapter 和 transcript writers（2026-06-16）✅ fake transcriber 生成非空 `outputs/7524373044106677544_transcript.txt` 与 `.md`
- [x] 实现下载与媒体校验服务（2026-06-16）✅ 示例 URL 创建 `outputs/7524373044106677544.mp4` 且 ffprobe JSON 有视频/音频流
- [x] 实现音频提取服务（2026-06-16）✅ 当前任务音频产物为 `tasks/<task_id>/media/audio.wav`，临时处理中间文件进入 `cache/`
- [x] 初始化 `app/` Tauri + React + TypeScript 骨架（2026-06-16）✅ `npm --prefix app run build` 通过
- [x] 添加前端工作流状态模型和初始 UI（2026-06-16）✅ `npm --prefix app test` 4 tests passed
- [x] 初始化 `worker/` Python 包与 worker 入口（2026-06-16）✅ `uv run pytest worker\\tests` 5 tests passed
- [x] 初始化项目本地 `.venv` 并安装开发依赖（2026-06-16）✅ `uv run pytest worker\\tests` 使用 Python 3.12.13 通过
- [x] 用户确认首个 ExecPlan 并指定使用 `uv` 管理本项目环境（2026-06-16）✅ 用户回复“开始下一步吧”
- [x] 读取根目录历史方案并建立项目治理核心集（2026-06-16；历史方案后续已迁移进 `docs/` 并删除）✅ `python scripts/validate_agents_docs.py --level ERROR` 通过
