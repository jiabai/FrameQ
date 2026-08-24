# Design Docs Index

FrameQ 持久设计决策文档总入口。`AGENTS.md` 不再逐条列出设计文档，需要时按主题在此查找。

## 核心信念与设计规范

- `core-beliefs.md` — 核心信念
- `web-marketing-site-design.md` — Web 宣传站设计规范
- `frameq-code-audit-uml.md` — FrameQ 代码审计 UML

## 分发与平台验收

- `2026-06-17-installer-distribution-plan.md` — 安装包分发计划
- `2026-07-12-macos-intel-acceptance-artifact.md` — macOS Intel 验收产物
- `2026-08-15-vc-runtime-selfcheck-and-import-diagnostics.md` — VC++ 运行库自检与导入诊断

## 国际化

- `2026-07-15-desktop-i18n-and-ai-output-language.md` — 桌面 i18n 与 AI 输出语言

## 模块拆分

- `2026-07-21-task-manifest-module-split.md` — Task manifest 模块拆分
- `2026-07-21-worker-pipeline-module-split.md` — Worker pipeline 模块拆分
- `2026-07-20-video-processing-module-split.md` — Video processing 模块拆分
- `2026-07-20-asr-module-split.md` — ASR 模块拆分
- `2026-07-20-transcript-detail-module-split.md` — Transcript detail 模块拆分
- `2026-07-23-frontend-transcript-controller-split.md` — 前端 Transcript controller 拆分
- `2026-07-20-bilibili-fallback-module-split.md` — Bilibili fallback 模块拆分
- `2026-07-20-xiaohongshu-fallback-module-split.md` — Xiaohongshu fallback 模块拆分
- `2026-07-20-douyin-fallback-module-split.md` — Douyin fallback 模块拆分
- `2026-07-21-server-route-module-split.md` — Server route 模块拆分
- `2026-07-23-server-store-prisma-module-split.md` — Server Store/PrismaStore 模块拆分
- `2026-07-22-server-auth-quota-operations-hardening.md` — Server 认证/额度/生产运维加固

## Worker 生命周期、契约与边界

- `2026-07-18-rust-worker-runtime-lifecycle.md` — Rust worker 生命周期
- `2026-07-23-rust-worker-runner-module-split.md` — Rust worker runner 模块拆分
- `2026-07-22-rust-worker-watchdog.md` — Rust worker watchdog
- `2026-08-04-retry-insights-progress-aware-watchdog.md` — RetryInsights 进度感知 watchdog 调整
- `2026-07-19-typed-worker-job-facade.md` — Typed worker job facade
- `2026-07-19-closed-worker-terminal-results.md` — Worker 终态结果闭集
- `2026-07-19-media-preparation-facade.md` — Media preparation facade
- `2026-07-19-worker-atomic-artifact-commit.md` — Worker 原子产物提交
- `2026-07-19-video-processing-task-result-boundary.md` — Video processing task-result 边界
- `2026-07-18-task-access-facade.md` — Task access facade
- `2026-07-18-process-video-request-contract-v3.md` — process-video 请求契约 v3
- `2026-07-18-source-identity-dependency-boundary.md` — source identity 依赖边界
- `2026-07-24-python-worker-application-facade.md` — Python worker application facade / CLI 边界
- `2026-07-24-tauri-ipc-runtime-decoding-boundary.md` — Tauri IPC 运行时解码边界

## ASR 与模型

- `2026-07-24-asr-model-download-job-capability-boundary.md` — ASR 模型下载 Job 能力边界
- `2026-07-27-selectable-asr-model-on-demand-download.md` — 可选 ASR 模型按需下载
- `2026-07-28-bundled-onnx-runtime-integrity.md` — 内置 ONNX 运行时依赖完整性
- `2026-07-29-onnx-vad-result-contract-hardening.md` — ONNX VAD 结果契约加固

## 平台字幕与导入

- `2026-08-23-douyin-platform-subtitle-direct-extraction.md` — 抖音平台字幕直取
- `2026-08-23-xiaohongshu-platform-subtitle-direct-extraction.md` — 小红书平台字幕直取
- `2026-07-05-youtube-bilibili-subtitle-first-asr-fallback.md` — YouTube/Bilibili 字幕优先、ASR 兜底
- `2026-07-18-youtube-generic-chinese-subtitle.md` — YouTube 通用中文字幕
- `2026-07-16-local-media-file-import.md` — 本地媒体文件导入

## 功能与特性

- `2026-07-31-transcript-dissection-feature.md` — 文字稿解剖（Transcript Dissection）功能
- `2026-08-05-inspiration-profile-generation-preference-boundary.md` — Inspiration Profile / 本次生成偏好边界
- `2026-08-09-desktop-diagnostic-export.md` — 桌面诊断信息导出
- `2026-07-19-app-composition-integration-coverage.md` — app 组合集成覆盖
