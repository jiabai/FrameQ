# FrameQ：AI 协作规则

本文件是给 AI coding agent 的工作指令：只放"下一个进来干活的 agent 需要知道的事"。历史台账（发布记录、release notes、已完成的执行计划）在 `docs/` 下维护，不在此展开。

`RULES.md` 与本文同时生效，其中每一条都是强制性的语言与行为规则，动手前必须先读。两者冲突时以 `RULES.md` 为准。

## 项目概述

FrameQ 是本地优先的桌面应用：粘贴公开或已授权的视频链接，本地完成下载、音频提取、SenseVoice Small 语音识别，导出文字稿，并在用户确认且额度充足时生成总结、脑图与灵感话题。

- 桌面端：Tauri + React + TypeScript（`app/`）
- Worker：Python + uv（`worker/`）
- 服务端：Fastify + SQLite（`server/`），负责账号、激活码月费、LLM 结账与额度

## 目录地图

| 路径 | 职责 | 纳入 git |
| --- | --- | --- |
| `app/` | Tauri + React + TypeScript 桌面客户端 | 是 |
| `worker/` | Python worker：下载、媒体校验、音频提取、ASR、InsightFlow | 是 |
| `worker/frameq_worker/insightflow/` | 内置 InsightFlow 话题生成模块 | 是 |
| `server/` | Fastify 账号/额度/LLM 结账服务 | 是 |
| `site/` | Astro 营销站。版本号唯一来源是 `site/src/consts.ts` 的 `LATEST_VERSION`，构建用 `npm --prefix site run build` | 否 |
| `video/` | Remotion 宣传视频工程（`promo-video`、`remotion-video1`） | 否 |
| `scripts/` | 文档校验、版本检查、安装包构建与开发辅助脚本 | 是 |
| `lib-external/` | 外部下载实现的阅读参考（`EasyDownload`、`videodl`），运行期不得 import | 否 |
| `design-system/` | 营销站设计参考与设计变量种子，`banners/` 为生成的图片素材 | 部分 |
| `build/` | 安装包构建的本地运行期缓存（Deno 与 npm 缓存） | 否 |
| `deploy/` | 服务端部署 runbook + Nginx/systemd 参考配置 | 是 |
| `contracts/` | desktop-worker 契约 JSON | 是 |
| `docs/` | 架构、设计、安全、产品规格、执行计划、发布记录 | 是 |
| `outputs/` | 任务产物（视频/音频/文字稿/总结/脑图/灵感 + task manifest） | 否 |
| `models/` | 本地 ASR 模型缓存 | 否 |

标注为「否」的目录由 `.gitignore` 排除，改动不会出现在 `git status`，也不进入代码审查。`design-system/` 只提交 `README.md`、`apple-DESIGN.md`、`globals.css`，`banners/` 同样被排除。`lib-external/` 内部另有 `AGENTS.md`，那是外部项目自带的文件，不构成本仓库的协作规则。

## 常用命令

安装依赖：

- `uv sync --dev`
- `npm --prefix app install`
- `npm --prefix server install`

Worker（Python）：

- `uv run ruff check worker`
- `uv run pytest worker/tests`

前端（app）：

- `npm --prefix app test`
- `npm --prefix app run lint`
- `npm --prefix app run build`
- `npm --prefix app run tauri -- build --no-bundle`

服务端（server）：

- `npm --prefix server test`
- `npm --prefix server run build`

Rust（Tauri 后端）：

- `cargo test --manifest-path app/src-tauri/Cargo.toml`

文档治理校验：

- `uv run python scripts/validate_agents_docs.py --level ERROR`
- `uv run python scripts/validate_agents_docs.py --level WARN`

## 测试

- Worker：pytest，用例在 `worker/tests/`。
- 前端：Vitest，`npm --prefix app test` 已内置 `--no-file-parallelism`。
- 服务端：Vitest。
- Rust：cargo test。
- 完成前的完整门禁见 `docs/EXECUTION_GATES.md`。

## 核心信念

1. **本地优先**：视频、音频、文字稿、模型缓存与本地历史默认留在用户本机。
2. **处理阶段可见**：UI 必须始终显示清晰处理阶段（输入 → 视频提取 → 视频转译 → 话题点生成 → 完成/失败）。
3. **安装包轻量**：安装包不得内置 ASR 权重、LLM key、云端 LLM 模型或用户私有配置；核心本地 ASR 模型仅在用户提交已验证任务且所选模型缺失时按需下载到 app-local data，启动时不得自动下载。模型版本、缓存、下载进度、取消、失败降级与离线行为必须在产品与 worker 中显式处理。
4. **代码边界**：worker 运行期不得跨目录 import 本仓库的其他模块，尤其不得 import `server/` 的代码；需要的 InsightFlow 能力必须复制、裁剪并内置到 `worker/frameq_worker/insightflow/`。
5. **安全边界**：只处理公开、自有或已授权视频，不绕过平台登录墙、访问控制、CAPTCHA、版权或隐私限制；account 服务不得接收视频/音频/文字稿/洞察/cookie/模型缓存/本地历史内容；真实 `.env`、SQLite、备份、日志、模型缓存、产物与密钥一律不进 git。

## 约束机制

- 模式：`linter+agents`
- 配置：`ruff.toml`

代码风格：

- Python：ruff（`ruff.toml`），`uv run ruff check worker` 通过。
- TypeScript：`npm --prefix app run lint` 通过。该脚本串联 `tsc --noEmit` 与 `scripts/check-i18n-literals.mjs`。`npm --prefix app run build` 的内容是 `tsc && vite build`。
- 提交信息：英文 conventional commits（如 `fix(server): ...`）。

## 开发流程

非平凡改动（改变用户可见行为或新增边界）按 `WORKFLOW.md` 推进：先读本文件与相关文档 → 更新 product spec → 更新 ExecPlan → 确认后实现。轻量改动仍需 inspect、最小验证、文档同步，并在最终说明列出验证结果与残余风险。

文件放置约定：产品规格 `docs/product-specs/`；设计决策 `docs/design-docs/`；外部参考 `docs/references/`；进行中计划 `docs/exec-plans/active/`；完成计划 `docs/exec-plans/completed/`。

Git 工作流：提交直接进入 `main`，无 feature-branch 工作流。桌面端发布走 `v*` tag → GitHub Releases，发布完成后有三件事必须做：

- 用 `gh release edit vX.Y.Z --notes-file docs/releases/vX.Y.Z.md` 写入已审阅的发布说明，并回读比对正文。`desktop-release.yml` 不设置 release 正文，草稿上显示的只是 `tauri-action` 的占位文本。
- 在 `TASKS.md` 新增版本台账条目，记录发布时间、tag、发布链接、验收要点与残余风险。
- 确认 `docs/releases/vX.Y.Z.md` 与 release notes、completed ExecPlan 的表述一致。

## 快速入口

- 产品规格索引：`docs/product-specs/index.md`
- 架构：`docs/ARCHITECTURE.md`
- 设计规范：`docs/DESIGN.md`
- 设计决策索引：`docs/design-docs/index.md`
- 外部参考索引：`docs/references/index.md`
- 安全规范：`docs/SECURITY.md`
- 完成门禁：`docs/EXECUTION_GATES.md`
- 执行计划索引：`docs/exec-plans/index.md`
- 当前执行计划：`docs/exec-plans/active/index.md`
- 技术债：`docs/exec-plans/tech-debt-tracker.md`
- 发布记录：`docs/releases/`
- 工作流：`WORKFLOW.md`
- 硬性规则：`RULES.md`
- 任务清单：`TASKS.md`
