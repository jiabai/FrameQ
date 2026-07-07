# Tasks

## Account and Billing

- [x] Add server-managed LLM config and monthly insight quota (2026-06-22) ✅ Admin Web owns encrypted dedicated FrameQ client LLM config and per-user quota editing; desktop accounts quota per cloud LLM API call attempt; settings no longer exposes LLM fields; server/app/Rust/worker/docs gates passed.

- [x] Use administrator-issued activation codes as the visible entitlement unlock path (2026-06-21) ✅ Admin OTP login, hash-only one-time 31-day activation codes, desktop redemption, entitlement reuse, Admin Web list/create flow, and client-side processing gate; server/app/Rust/docs gates passed.

- [x] Add account login and entitlement foundation (2026-06-21) ✅ TypeScript Fastify service with Prisma SQLite, email OTP login, desktop deep-link session exchange, entitlement model, and client-side processing gate; server/app/Rust/docs gates passed.

## 进行中

- [x] 实现桌面端一键升级（2026-06-23）— Tauri updater + GitHub Releases updater manifest/artifacts；客户端与 worker 整体升级，保留 app-local data，不打包 ASR 权重或私有配置。✅ 代码完成，自动化门禁全部通过（server 32、app 84、Rust 31、worker 99、ruff、build、docs）。✅ 2026-06-27 项目决策：因中国境内访问 GitHub Releases 速度过慢，不再执行旧版到新版的 GitHub updater 真实下载/安装测试；该项作为 v1 测试豁免，不再阻塞发布。

## 待办

- [ ] 完成干净 Windows VM 与 macOS arm64/x64 真实安装包验证 — 使用轻量 runtime 资源产出安装包，在无 Python/uv/ffmpeg 的干净机器完成首启模型下载、URL → 下载 → ASR 文字稿，并记录签名/公证发布门禁状态。✅ 验收：干净机器安装、首启模型下载、公开视频转写、app-local 数据保留和签名/公证状态记录完成。⚠️ 需真实 VM 环境和生产签名证书。
- [x] 桌面端一键升级 GitHub updater 真实下载/安装测试豁免（2026-06-27）— 因中国境内访问 GitHub Releases 速度过慢，本项目 v1 不再把旧版到新版的 GitHub updater 实测作为验收或发布阻塞项。✅ 验收口径：自动化门禁、manifest/artifact 生成、Tauri 签名校验配置和直接分发新版安装包路径成立；未声明国内 GitHub 网络真实升级链路已实测通过。

## 已完成
- [x] 实现启发话题点个性化偏好流程（2026-07-06）✅ 增加本地 `我的灵感档案`、本次 6 步生成偏好、AI整理确认摘要、偏好快照和个性化话题点 prompt；偏好只进入 `retry_insights` 并只影响启发话题点生成，summary/Mermaid 保持通用；结果改为结构化话题点并展示匹配理由、启发问题和适合用途；偏好快照作为任务本地产物保存，server 无新增偏好/文字稿/话题点持久化。✅ 自动化门禁通过：app 138、worker 141、Rust 50、ruff、前端 build；真实额度消耗的桌面手工回归未在本会话执行。
- [x] 增加 YouTube/Bilibili 字幕优先 + ASR 兜底（2026-07-05）✅ 公开视频 `yt-dlp` 成功路径会优先复用 YouTube/Bilibili 平台字幕生成正式文字稿，保留视频/音频产物和音频回听；字幕缺失、解析失败或 Bilibili public fallback 路径静默降级到本地 ASR；manifest、历史记录和文字稿 metadata 记录来源，UI 只显示文字稿来源提示，不展示原始字幕文件；不引入登录、Cookie、绕过或下载中心。✅ worker/parser/manifest/Rust/frontend 自动化门禁通过；真实公网字幕样本 smoke 未在本会话执行，保留外部平台可用性残余风险。
- [x] 增加 YouTube 公开视频下载能力（2026-06-29）✅ 支持 watch、youtu.be 和 Shorts 单视频链接，复用现有 yt-dlp → ffprobe → audio → ASR → AI整理流程；新增 720p 转写优先格式策略、`YOUTUBE_*` 失败文案和签名 media URL/cookie 提示脱敏；不做登录、Cookie、playlist 批量、live、会员/年龄/私有绕过或下载中心。✅ worker/app/Rust/build/docs/diff gates 通过；真实 YouTube live smoke 未执行，保留外部平台可用性残余风险。
- [x] 完成 Bilibili 公开视频 fallback（2026-06-27）✅ 支持普通 BV/av 链接、有效 `b23.tv` 短链、`?p=N` 单分 P 选择、公开 `x/web-interface/view` 元数据、`x/player/playurl` DASH 流选择、视频/音频 `.m4s` 安全下载、备选 URL 重试、FFmpeg 合并和 `BILIBILI_*` UI 错误文案；保持转写优先，不做登录、SESSDATA、番剧/PGC、会员内容、DRM、批量下载或下载中心。✅ worker/app/Rust/build/docs/diff 门禁通过；真实公网 Bilibili BV/av/b23.tv smoke 未在本会话执行，保留平台可用性残余风险。
- [x] 补完小红书公开视频 fallback（2026-06-27）✅ 支持分享文本、完整 `xiaohongshu.com` 笔记链接、直接 note_id、`xhslink.com`/`www.xhslink.com` 短链、`xsec_token` 保留、Brotli/gzip/deflate 页面解码、确定性视频流排序、streaming `.part`/Range/超时下载可靠性、fallback 输出路径优先选择和 `XHS_*` UI 错误文案；保持视频转写优先，不做图片 ZIP、登录、Cookie、代理或下载中心。✅ worker/app/Rust/build/docs/diff 门禁通过；真实公开视频 smoke 未执行，因本会话未提供稳定公开验收链接。
- [x] 实现 Admin 手工权益补偿（2026-06-27）✅ Admin Web 支持按用户延长到期时间、增加话题点次数，并记录 append-only 审计；桌面端继续通过现有账号状态接口看到更新后的到期时间和剩余额度。✅ server 测试覆盖延期、加次数、无权益创建、鉴权/CSRF/非法参数、审计记录和桌面账号状态刷新；`npm --prefix server test`、`npm --prefix server run build`、`npm --prefix server run prisma:generate` 通过；Admin Web 浏览器手工验收通过并已归档 ExecPlan。
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
- [x] 完善真正取消任务语义（2026-06-17）✅ 取消会终止运行中的 worker 进程树，UI 返回输入态并忽略晚到结果
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
