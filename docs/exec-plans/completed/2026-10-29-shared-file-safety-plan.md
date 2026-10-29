# Shared File Safety Plan

## Purpose / Big Picture

将桌面端相同的链接与 Windows reparse-point 判定集中维护，并共用任务产物目标检查和
`original/` 备份路径计算。选源、原子替换、任务访问、文字稿和成稿编辑继续保留现有的
文件类型、目录边界、错误消息及事务行为。

## Progress

- [x] 2026-10-29: 用户授权实施 S4，保留真实路径安全验证及 Windows/macOS 平台限制记录。
- [x] 2026-10-29: 核对四个模块的六份谓词函数体和两组重复 helper，确认现有依赖方向。
- [x] 2026-10-29: 所有权守卫取得 RED 基线；增加六个真实跨入口矩阵，普通路径与 junction 实际运行。
- [x] 2026-10-29: 元数据谓词集中到 atomic_files，任务 helper 集中到 task_manifest/storage；所有权守卫 GREEN。
- [x] 2026-10-29: Rust 全量 354 项、Node 脚本 51 项、Python 脚本 1 项、app lint 与变更 Rust 文件格式检查通过。
- [x] 2026-10-29: 同步规格、架构、安全与模块说明及审计状态；记录工具执行环境的覆盖范围与 macOS 验证范围并归档。

## Decision Log

- Decision: 按已授权的 S4 方案实施共用规则与跨入口验证。Rationale: 用户已指定修复范围、
  备份布局和安全不变量，无新增用户行为或授权边界。Date/Author: 2026-10-29, User + Codex。
- Decision: 元数据谓词留在 atomic_files，storage 引用并经 task_manifest 根模块保留原有入口。
  Rationale: 选源可直接依赖低层模块；任务模块已有相同依赖，history 与 transaction 保留调用形式。
- Decision: 两个任务 helper 由 storage 维护，经任务根模块提供给成稿和文字稿编辑。
  Rationale: 两个调用方均依赖任务访问能力，备份路径同时覆盖 transcript/original 与 ai/original。
- Decision: Windows 完整测试在允许终止自身子进程树的环境执行，临时文件位于 build。
  Rationale: 已验证受限执行环境会阻止 taskkill，原有取消与 watchdog 用例要求真实进程权限。

## Context and Orientation

- Product requirements: docs/product-specs/2026-07-22-release-reliability-hardening.md。
- Low-level owner: app/src-tauri/src/atomic_files.rs。
- Consumers: local_media.rs、draft_detail.rs、transcript_detail/edit_storage.rs、task_manifest/storage.rs。
- Stable task surface: app/src-tauri/src/task_manifest.rs；模块边界守卫位于 task_manifest/tests.rs。
- Existing evidence: build/rust-process-validation-full.log，Windows 原有 348 项 Rust 测试通过。

## Plan of Work

1. 使用真实普通文件与目录、文件与目录 symlink、断开目标的 symlink、Windows junction
   比较各入口；合法样本按入口类型接受，链接及重解析点按既有规则拒绝，外部哨兵文件保持内容。
2. 保留一个平台分支化的元数据谓词；将两个完全相同的任务 helper 移入 storage 并引用共用谓词。
3. 更新已有模块所有权守卫，验证备份位置、错误消息和正式编辑流程。
4. 执行受影响门禁及完整 Rust 测试，同步持久文档与平台覆盖范围。

## Validation and Acceptance

- 定向运行 file_safety_tests、task_manifest、local_media、draft_detail、transcript_detail。
- cargo test --manifest-path app/src-tauri/Cargo.toml；保留真实取消、超时与完整进程树清理断言。
- node --test scripts/tests/*.test.mjs；python -m pytest scripts/tests。
- npm --prefix app run lint；变更 Rust 文件的 rustfmt；文档治理与 git diff --check。
- Windows junction 必须实际运行；symlink 权限若不可用明确记录，macOS 需独立平台证据。

## Surprises & Discoveries

Evidence: original_backup_path 表达原文件所在目录下的 original 子目录布局，两个调用方完全相同。
Evidence: reject_linked_artifact_target 的目标及直接父目录检查、两条错误消息在两个调用方完全相同。
Evidence: 用户已确认 Windows symlink 权限问题解决；提交前本次工具执行上下文创建 symlink 仍返回 1314，三个矩阵主体未执行。Windows junction 创建和真实拒绝断言通过。

## Outcomes & Retrospective

共用规则已完成。原有平台谓词、目标与直接父目录检查、缺失路径处理、错误消息和备份布局保持。
所有权守卫先因 storage 尚未引用共用谓词失败，提取后通过。新增真实矩阵覆盖正式选源、原子写入/
删除、任务访问、文字稿与成稿编辑，并验证外部哨兵文件、manifest 与首次原始备份保持内容。

提交前 Windows 完整 Rust 套件 354 项通过，0 失败、0 忽略，耗时 6.12 秒；main 与 doc-tests 成功。
新矩阵共六项，普通路径、目录类型和 Windows junction 三项实际验证，文件/断开文件/目录 symlink
三项在本次工具执行上下文返回 1314，矩阵主体未执行。原有取消、watchdog 和完整进程树清理测试
在具备进程终止权限的环境继续通过，没有修改这些用例与断言。

Node 脚本 51 项、Python 脚本 1 项、app lint、变更 Rust 文件格式和文档治理检查通过。
日志位于 build/s4-owner-red.log、s4-owner-green.log、s4-file-safety-tests.log、s4-rust-full.log、
s4-node-tests.log、s4-python-script-tests.log 与 s4-app-lint.log。提交前复核日志为
build/s4-commit-link-tests.log、s4-commit-rust-full.log、s4-commit-node-tests.log 与 s4-commit-app-lint.log。
Residual risk: 本次工具运行未覆盖三个 Windows symlink 矩阵主体；macOS 原生测试、托管 CI 和生产发布待执行。
