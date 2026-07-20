# FrameQ AI Collaboration Rules

## 对外分发补充规则

- 对外分发版本采用轻量安装包 + 首启下载核心本地 ASR 模型（首版为 SenseVoice Small）；安装包不得内置 ASR 权重、LLM key、云端 LLM 模型或用户私有配置。模型版本、缓存、下载进度、取消、失败降级和离线行为必须在产品和 worker 中显式处理。

<!-- 由 vibe-coding-launcher 生成。详细规则请修改对应 docs/ 文件，并同步本入口地图。 -->

## 快速入口

- 项目方案：`docs/product-specs/index.md`（根目录历史方案已迁移进 `docs/` 并删除）
- 架构：`docs/ARCHITECTURE.md`
- 设计规范：`docs/DESIGN.md`
- Rust worker 生命周期设计：`docs/design-docs/2026-07-18-rust-worker-runtime-lifecycle.md`
- Typed worker job facade 设计：`docs/design-docs/2026-07-19-typed-worker-job-facade.md`
- Video processing 模块拆分设计：`docs/design-docs/2026-07-20-video-processing-module-split.md`
- Transcript detail 模块拆分设计：`docs/design-docs/2026-07-20-transcript-detail-module-split.md`
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
- 首个产品规格：`docs/product-specs/2026-06-16-douyin-video-transcription-client.md`
- 执行计划索引：`docs/exec-plans/index.md`
- 当前执行计划索引：`docs/exec-plans/active/index.md`
- 当前 active 发布计划：`docs/exec-plans/active/2026-07-17-v0.2.17-desktop-i18n-release-plan.md`
- 当前 active 功能计划：`docs/exec-plans/active/2026-07-16-local-media-file-import-plan.md`
- 最近完成执行计划：`docs/exec-plans/completed/2026-07-20-transcript-detail-module-split-plan.md`
- 技术债：`docs/exec-plans/tech-debt-tracker.md`

## 核心信念

- 桌面客户端必须本地优先；视频、音频和文字稿默认留在本机。
- 运行期不得从 `D:\Github\InsightFlow\src\server` 跨目录 import；需要的能力必须复制、裁剪并内置到 `worker/insightflow/`。
- UI 必须始终显示清晰处理阶段：输入、视频提取、视频转译、话题点生成、完成或失败。
- 安装包只内置运行时、worker、媒体工具和必要依赖；核心本地 ASR 模型（首版为 SenseVoice Small）由首启引导下载到 app-local data。LLM key、云端 LLM 模型和用户私有配置不打进安装包，模型缓存、下载进度和降级路径要在产品和 worker 中显式处理。

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
