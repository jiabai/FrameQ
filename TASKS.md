# Tasks

## 进行中

- 暂无

## 待办

- 暂无

## 已完成

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
