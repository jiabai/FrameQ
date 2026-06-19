# Tasks

## 进行中

## 待办

- [ ] 完成干净 Windows VM 与 macOS arm64/x64 真实安装包验证 ✅ 使用轻量 runtime 资源产出安装包，在无 Python/uv/ffmpeg 的干净机器完成首启模型下载、URL → 下载 → ASR 文字稿，并记录签名/公证发布门禁状态。

## 已完成
- [x] 改为轻量安装包 + 首启 ASR 模型下载（2026-06-19）✅ 安装包不再打入 `resources/models`；新增 SenseVoice Small / VAD 下载助手、Tauri 下载/取消命令、首启下载引导、缺模型 `ASR_MODEL_NOT_DOWNLOADED` 降级错误和可配置下载源；focused worker/Rust/frontend 测试通过
- [x] 产出 Windows x64 full-bundle 内测安装包（2026-06-19，已被轻量方案取代）✅ 使用真实 Python standalone、ffmpeg/ffprobe 和 `D:\Github\FrameQ\models\models\iic\SenseVoiceSmall` 验证过旧 full-bundle resources；默认 release 依赖排除 `qwen-asr`、显式包含 `torch`，并裁剪 Python debug/cache/test/header 文件；`npm --prefix app run tauri -- build --target x86_64-pc-windows-msvc` 曾成功产出 `FrameQ_0.1.0_x64-setup.exe`（约 1055.5MB）
- [x] 加固安装包发布门禁（2026-06-18，部分规则已被轻量方案取代）✅ 曾加入 full-bundle 模型资源检查；后续轻量方案改为首启下载模型并检查 app-local data 中的 `MODEL_VERSION.txt`、SenseVoice `model.pt` 和 VAD `model.pt`；macOS arm64/x64 构建显式传入 Tauri target triple；Cargo 发布元数据去除脚手架值；新增 Rust/Vitest 回归测试并通过聚焦验证
- [x] 接入普通用户安装即用分发基础（2026-06-18）✅ Tauri release runtime 改为内置 Python/worker/bin resources，配置、历史、输出、work 和模型缓存改入 app-local data；新增首启 LLM 配置检测，release UI 只暴露 SenseVoice Small；补齐 installer distribution spec、active ExecPlan、Tauri resources 与 `scripts/build-installer.ps1`；自动化门禁全部通过
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

- [x] 增加历史任务查看和输出目录配置（2026-06-17）✅ 采用本地 `work/history.json` 记录任务历史，设置面板保存 `FRAMEQ_OUTPUT_DIR`，历史面板可查看旧结果并恢复详情；worker/Rust/frontend 测试、文档门禁和 Tauri no-bundle 构建通过

- [x] 增加 UI 层 LLM 配置入口（2026-06-17）✅ 用户可在桌面 UI 输入并保存 OpenAI-compatible base URL、API key、model 和 timeout；保存后 worker 使用该配置生成话题点；自动化测试和 Tauri no-bundle 构建通过
- [x] MVP 最终验收和残余风险整理（2026-06-17）✅ 真实 InsightFlow LLM retry smoke 返回 `completed` 且生成 8 个话题点；自动化测试、文档门禁和 Tauri no-bundle 构建均通过；高优先级技术债已关闭
- [x] 完善真正取消任务语义（2026-06-17）✅ 取消会终止运行中的 worker 进程树，UI 返回输入态并忽略晚到结果
- [x] 支持 `.env` 配置真实 InsightFlow LLM client（2026-06-16）✅ worker 从项目根 `.env` 读取 `FRAMEQ_LLM_*`，调用 OpenAI-compatible Chat Completions 生成话题点，未配置时保持 `部分完成`
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
- [x] 实现音频提取服务（2026-06-16）✅ `work/7524373044106677544.wav` 为 16 kHz 单声道 `pcm_s16le`
- [x] 初始化 `app/` Tauri + React + TypeScript 骨架（2026-06-16）✅ `npm --prefix app run build` 通过
- [x] 添加前端工作流状态模型和初始 UI（2026-06-16）✅ `npm --prefix app test` 4 tests passed
- [x] 初始化 `worker/` Python 包与 worker 入口（2026-06-16）✅ `uv run pytest worker\\tests` 5 tests passed
- [x] 初始化项目本地 `.venv` 并安装开发依赖（2026-06-16）✅ `uv run pytest worker\\tests` 使用 Python 3.12.13 通过
- [x] 用户确认首个 ExecPlan 并指定使用 `uv` 管理本项目环境（2026-06-16）✅ 用户回复“开始下一步吧”
- [x] 读取 `douyin_video_download_solution.md` 并建立项目治理核心集（2026-06-16）✅ `python scripts/validate_agents_docs.py --level ERROR` 通过
