# FrameQ AI Collaboration Rules

## 对外分发补充规则

- 对外分发版本采用轻量安装包；安装包不得内置 ASR 权重、LLM key、云端 LLM 模型或用户私有配置。核心本地 ASR 模型由用户在提交已验证 URL 或本地媒体任务时按所选模型按需下载到 app-local data，启动时不得自动下载。模型版本、缓存、下载进度、取消、失败降级和离线行为必须在产品和 worker 中显式处理。

<!-- 由 vibe-coding-launcher 生成。详细规则请修改对应 docs/ 文件，并同步本入口地图。 -->

## 快速入口

- 项目方案：`docs/product-specs/index.md`（根目录历史方案已迁移进 `docs/` 并删除）
- 架构：`docs/ARCHITECTURE.md`
- 设计规范：`docs/DESIGN.md`
- Task manifest 模块拆分设计：`docs/design-docs/2026-07-21-task-manifest-module-split.md`
- Worker pipeline 模块拆分设计：`docs/design-docs/2026-07-21-worker-pipeline-module-split.md`
- Python worker application facade / CLI 边界设计：`docs/design-docs/2026-07-24-python-worker-application-facade.md`
- Server route 模块拆分设计：`docs/design-docs/2026-07-21-server-route-module-split.md`
- Server Store/PrismaStore 模块拆分设计：`docs/design-docs/2026-07-23-server-store-prisma-module-split.md`
- Server 认证/额度/生产运维加固设计：`docs/design-docs/2026-07-22-server-auth-quota-operations-hardening.md`
- Rust worker 生命周期设计：`docs/design-docs/2026-07-18-rust-worker-runtime-lifecycle.md`
- Rust worker runner 模块拆分设计：`docs/design-docs/2026-07-23-rust-worker-runner-module-split.md`
- ASR 模型下载语义 Job 能力边界设计：`docs/design-docs/2026-07-24-asr-model-download-job-capability-boundary.md`
- 可选 ASR 模型与按需下载设计：`docs/design-docs/2026-07-27-selectable-asr-model-on-demand-download.md`
- 内置 ONNX 运行时依赖完整性设计：`docs/design-docs/2026-07-28-bundled-onnx-runtime-integrity.md`
- ONNX VAD 结果契约与失败闭合设计：`docs/design-docs/2026-07-29-onnx-vad-result-contract-hardening.md`
- Rust worker watchdog 设计：`docs/design-docs/2026-07-22-rust-worker-watchdog.md`
- RetryInsights 进度感知 watchdog 调整设计：`docs/design-docs/2026-08-04-retry-insights-progress-aware-watchdog.md`
- Inspiration Profile / 本次生成偏好边界设计：`docs/design-docs/2026-08-05-inspiration-profile-generation-preference-boundary.md`（Profile v2 仅保留六项长期背景，表达风格与避免方向统一归本次生成偏好）
- Typed worker job facade 设计：`docs/design-docs/2026-07-19-typed-worker-job-facade.md`
- Video processing 模块拆分设计：`docs/design-docs/2026-07-20-video-processing-module-split.md`
- ASR 模块拆分设计：`docs/design-docs/2026-07-20-asr-module-split.md`
- Transcript detail 模块拆分设计：`docs/design-docs/2026-07-20-transcript-detail-module-split.md`
- 前端 Transcript controller 拆分设计：`docs/design-docs/2026-07-23-frontend-transcript-controller-split.md`
- 文字稿解剖（Transcript Dissection）功能设计：`docs/design-docs/2026-07-31-transcript-dissection-feature.md`（智能提炼工作区第四张 target 卡片，对已保存文字稿做结构化拆解）
- Tauri IPC 运行时解码边界设计：`docs/design-docs/2026-07-24-tauri-ipc-runtime-decoding-boundary.md`
- Bilibili fallback 模块拆分设计：`docs/design-docs/2026-07-20-bilibili-fallback-module-split.md`
- Xiaohongshu fallback 模块拆分设计：`docs/design-docs/2026-07-20-xiaohongshu-fallback-module-split.md`
- Douyin fallback 模块拆分设计：`docs/design-docs/2026-07-20-douyin-fallback-module-split.md`
- Video processing task-result adapter 设计：`docs/design-docs/2026-07-19-video-processing-task-result-boundary.md`
- Worker 终态结果闭集设计：`docs/design-docs/2026-07-19-closed-worker-terminal-results.md`
- Media preparation facade 设计：`docs/design-docs/2026-07-19-media-preparation-facade.md`
- Worker 原子产物提交设计：`docs/design-docs/2026-07-19-worker-atomic-artifact-commit.md`
- Task access facade 设计：`docs/design-docs/2026-07-18-task-access-facade.md`
- Web 宣传站设计规范：`docs/design-docs/web-marketing-site-design.md`
- Web 宣传站设计参考：`design-system/README.md`
- 安全规范：`docs/SECURITY.md`
- 核心信念：`docs/design-docs/core-beliefs.md`
- EasyDownload 抖音 fallback 参考：`docs/references/easydownload-douyin-fallback.md`
- EasyDownload 转写优先迁移筛选：`docs/references/easydownload-transcription-migration.md`
- EasyDownload 小红书 fallback 参考：`docs/references/easydownload-xiaohongshu-fallback.md`
- EasyDownload Bilibili fallback 参考：`docs/references/easydownload-bilibili-fallback.md`
- EasyDownload MITM/CA/管理员提权参考(未来可选项):`docs/references/easydownload-mitm-ca-design.md`
- 海外宣传与分发合规研究参考：`docs/references/overseas-marketing-compliance.md`
- 执行清单：`TASKS.md`
- 工作流：`WORKFLOW.md`
- 完成门禁：`docs/EXECUTION_GATES.md`
- 产品规格索引：`docs/product-specs/index.md`
- 发布可靠性规格：`docs/product-specs/2026-07-22-release-reliability-hardening.md`
- v0.3.1 发布规格：`docs/product-specs/2026-08-05-v0.3.1-desktop-feature-release.md`
- v0.3.1 发布计划（completed）：`docs/exec-plans/completed/2026-08-05-v0.3.1-desktop-feature-release-plan.md`（已发布 stable：https://github.com/jiabai/FrameQ/releases/tag/v0.3.1；范围：Web user dashboard、Server 页面 i18n、Inspiration Profile v2、进度感知 watchdog、contract v7 + 解剖来源状态、CRLF 出处修复；含 server 专项门禁）
- v0.3.0 发布规格：`docs/product-specs/2026-08-03-v0.3.0-desktop-feature-release.md`
- v0.3.0 发布计划（completed）：`docs/exec-plans/completed/2026-08-03-v0.3.0-desktop-feature-release-plan.md`（已发布 stable：https://github.com/jiabai/FrameQ/releases/tag/v0.3.0）
- Server 页面 i18n 规格：`docs/product-specs/2026-08-04-server-page-i18n.md`（`/login`、`/dashboard`、`/admin/login`、`/admin` 增加 zh-CN/en 切换按钮，新 `server/src/i18n.ts` 模块；不涉及 desktop/worker/ASR/store/Prisma）
- Server 页面 i18n 计划（completed）：`docs/exec-plans/completed/2026-08-04-server-page-i18n-plan.md`（29 单测 + 12 集成测试落地，server 201 通过；纳入 v0.3.1）
- Web 用户控制台计划（completed）：`docs/exec-plans/completed/2026-08-03-web-user-dashboard-plan.md`（`/dashboard` 邮箱 OTP cookie 会话、账号/额度、登录成功面板、OTP 跨路径消费一次；纳入 v0.3.1，`secureCookies` 生产部署验证已于 2026-08-06 在 `frameq.8xf.pro` 完成）
- 最近完成 Inspiration Profile / 本次生成偏好边界计划：`docs/exec-plans/completed/2026-08-05-inspiration-profile-generation-preference-boundary-plan.md`（Profile v2 六项长期背景、schema v2 本地原子迁移、一次性 edit-only seed、当前 worker 契约去重）
- Web 宣传站产品规格：`docs/product-specs/2026-08-05-web-marketing-site.md`（`site/` 顶级目录 Astro 静态站，首页/下载/隐私三页，OKLCH token 从 `design-system/globals.css` 迁移，Hallmark 反 AI-slop 视觉系统，不加载 analytics/tracking/第三方 embed）
- Web 宣传站实现计划（completed）：`docs/exec-plans/completed/2026-08-05-web-marketing-site-plan.md`（7 个 Task：工程骨架 → Hallmark 设计 → token 系统 → 三页实现 → 验证门禁 → 文档同步；首版不分配版本号）
- 最近完成 RetryInsights 进度感知 watchdog 计划：`docs/exec-plans/completed/2026-08-04-retry-insights-progress-aware-watchdog-plan.md`（30 分钟 idle、90 分钟 absolute、解剖调用边界进度）
- v0.3.0 release notes 草稿：`docs/releases/v0.3.0.md`
- v0.3.1 release notes 草稿：`docs/releases/v0.3.1.md`
- 首个产品规格：`docs/product-specs/2026-06-16-douyin-video-transcription-client.md`
- 执行计划索引：`docs/exec-plans/index.md`
- 当前执行计划索引：`docs/exec-plans/active/index.md`
- 最近完成 ONNX VAD 结果契约加固计划：`docs/exec-plans/completed/2026-07-29-onnx-vad-result-contract-hardening-plan.md`
- 最近完成 可选 ASR 模型按需下载计划：`docs/exec-plans/completed/2026-07-27-selectable-asr-model-on-demand-download-plan.md`
- 最近完成 v0.2.17 发布计划：`docs/exec-plans/completed/2026-07-17-v0.2.17-desktop-i18n-release-plan.md`
- 最近完成 本地媒体文件导入计划：`docs/exec-plans/completed/2026-07-16-local-media-file-import-plan.md`
- 最近完成 Python worker application facade / CLI 计划：`docs/exec-plans/completed/2026-07-24-python-worker-application-facade-plan.md`
- 最近完成 ASR 模型下载能力边界计划：`docs/exec-plans/completed/2026-07-24-asr-model-download-job-capability-plan.md`
- 最近完成 Tauri IPC 解码计划：`docs/exec-plans/completed/2026-07-24-tauri-ipc-runtime-decoding-plan.md`
- 最近完成 Server Store/PrismaStore 拆分计划：`docs/exec-plans/completed/2026-07-23-server-store-prisma-module-split-plan.md`
- 最近完成 Rust worker runner 拆分计划：`docs/exec-plans/completed/2026-07-23-rust-worker-runner-module-split-plan.md`
- 最近完成前端 Transcript controller 拆分计划：`docs/exec-plans/completed/2026-07-23-frontend-transcript-controller-split-plan.md`
- 最近完成 Server 并发计划：`docs/exec-plans/completed/2026-07-22-server-auth-quota-concurrency-hardening-plan.md`
- 最近完成 Server 运维计划：`docs/exec-plans/completed/2026-07-22-server-production-operations-hardening-plan.md`
- 最近完成 worker watchdog 计划：`docs/exec-plans/completed/2026-07-22-worker-watchdog-plan.md`
- 最近完成原子持久化计划：`docs/exec-plans/completed/2026-07-22-atomic-persistence-hardening-plan.md`
- 技术债：`docs/exec-plans/tech-debt-tracker.md`

## 核心信念

- 桌面客户端必须本地优先；视频、音频和文字稿默认留在本机。
- 运行期不得从 `D:\Github\InsightFlow\src\server` 跨目录 import；需要的能力必须复制、裁剪并内置到 `worker/insightflow/`。
- UI 必须始终显示清晰处理阶段：输入、视频提取、视频转译、话题点生成、完成或失败。
- 安装包只内置运行时、worker、媒体工具和必要依赖；核心本地 ASR 模型仅在用户提交已验证任务且所选模型缺失时下载到 app-local data，启动时不自动下载。LLM key、云端 LLM 模型和用户私有配置不打进安装包，模型缓存、下载进度和降级路径要在产品和 worker 中显式处理。

## 开发流程

非平凡改动先读本文件、`WORKFLOW.md`、架构/设计/安全文档和当前 active ExecPlan。改变用户可见行为或新增边界时，先更新 product spec，再更新 ExecPlan，确认后进入实现。轻量改动仍需 inspect、最小验证、同步文档，并在最终说明中列出验证结果和残余风险。

## 约束机制

- 模式：`linter+agents`
- 配置：`ruff.toml`

## 常用命令

- `python scripts/validate_agents_docs.py --level ERROR` — 检查核心治理文档
- `python scripts/validate_agents_docs.py --level WARN` — 收尾前检查文档和任务清单
- `uv run ruff check worker` — worker 初始化后检查 Python 代码
- `uv run pytest worker\tests` — 运行 worker focused tests
- `npm --prefix app test` — 运行前端状态模型测试
- `npm --prefix app run lint` — app 初始化后检查 TypeScript/Tauri 前端
- `npm --prefix app run build` — app 初始化后验证前端构建
