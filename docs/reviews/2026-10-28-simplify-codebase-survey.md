# simplify-codebase 审计（2026-10-28）

| 项目 | 值 |
| --- | --- |
| 授权模式 | Survey；S1 至 S13 已授权处理 |
| 覆盖范围 | Broad，五个审计域 |
| 审计代码基线 | `main` @ `948d7cd441a42ffbfebeee2afe82418ae8d70491` |
| 使用工具 | `simplify-codebase`（安装在 `~/.workbuddy/skills/simplify-codebase`） |
| 处理状态 | S1 至 S13 本地处理完成；5 条保留反例。用户已确认 Windows symlink 权限问题解决，本次工具执行环境的实际覆盖见验证记录，macOS 尚未复核；S2、S9、S10、S11 的生产部署与托管 CI，以及 S12 的托管 CI 待执行 |
| 验证 | 已执行定向测试、完整前端与服务端测试、构建、数据库与文档校验，结果见“验证记录”；完整实施门禁尚未执行 |

本文件记录审计候选、代码证据和验证范围。实施需获得相应授权，并按 `WORKFLOW.md` 更新相关规格与执行计划。

## 覆盖范围与盲区

| 域 | 入口点 | 追到的契约 | 盲区 |
| --- | --- | --- | --- |
| Rust 主进程 | `app/src-tauri/src/lib.rs:97-146` 的 `generate_handler!` 注册表，48 条命令 | Tauri IPC、task manifest、journal、settings 文件、诊断包 | macOS 运行时行为、真实 Tauri WebView 加载 |
| 前端 | `app/src/App.tsx` 组合根、各 `*Client.ts`、`features/*/` 控制器 | IPC 返回值形状、i18n 键、持久化偏好 | 浏览器 smoke 之外的桌面壳层交互 |
| worker | `worker/frameq_worker/cli.py` 全部分支 | stdin 请求、stdout 结果、stderr 进度与诊断、任务产物路径 | 真实平台下载行为（已在技术债台账登记） |
| server | `server/src/server.ts` 路由装配、管理页、Prisma | HTTP 响应形状、Store 契约、SQLite 迁移 | 生产 SQLite 实际数据、托管运行证据 |
| 脚本与站点 | `scripts/*`、`contracts/*.json`、`site/src` | 版本一致性、workflow 形状、营销站构建 | `site/` 被 `.gitignore` 排除，删除只影响本机 |

未纳入：`lib-external/`（外部下载实现的参考副本）、`outputs/`（任务产物）、`models/`（模型缓存）、`video/`（宣传视频工程）。

## 证据方法

- 命令可达性：从 `generate_handler!` 注册表追踪前端 client、runner 与 `invoke` 的完整调用关系。需覆盖 `runner("<name>", args)` 经 `invoke(command, args)` 转发的形式，例如 `accountClient.ts:145-152`、`workerClient.ts:50-51,155`。字面量检索用于发现候选，零命中不能单独证明不可达。
- 契约字段读者：对 `.rs`、`.py`、`.mjs`、`.ts` 检索字段名，并检查对象整体读取、派生规则和测试绑定。没有直接读取字段名，只能证明缺少对应直接消费者；相同不变量可能已由运行时代码校验。
- HTTP 使用者：分别记录路由是否注册、仓库内是否存在客户端、历史配置与外部访问证据；缺少生产访问记录时，外部使用量保持未验证。
- 计数一律按文件逐个统计，不使用截断后的前若干条当作全集。
- 跨进程与持久化边界单独核对：`contracts/*.json`、任务产物路径白名单、settings 文件与 schema 版本。
- 历史作为设计证据：`git log -S`、首个标签的 `tauri.conf.json`、已完成的 ExecPlan 与技术债台账。

## 排序候选

排序依据是证据强度与净负担，二者独立评分。行号删除量不作为依据。

| 编号 | 候选 | 主要位置 | 负担 | 置信度 |
| --- | --- | --- | --- | --- |
| S1 | 已完成：worker stdin 失败结果统一序列化 | `worker/frameq_worker/cli.py:59-73` | task 失败结果复用 `ProcessResult.to_dict()`，保留正确错误码 | 定向回归通过 |
| S2 | 本地已完成：服务端更新清单与路由移除 | `server/src/server.ts`、`index.ts`、`runtimeConfig.ts` | 桌面通过 GitHub 更新，账号服务按当前路由表提供能力 | 本地门禁通过；生产部署与托管 CI 待执行 |
| S3 | 已完成：edit-session 测试使用正式事务提交 | `task_manifest/access.rs`、`storage.rs`、`tests.rs` | manifest 编码后与关联产物统一提交 | 定向回归通过 |
| S4 | 本地已完成：共用链接判定、产物目标检查与备份路径 | `atomic_files.rs`、`task_manifest/storage.rs`、`file_safety_tests.rs` | 各入口共用规则，保留文件类型、路径边界及备份布局 | Windows 普通路径和 junction 通过；工具执行环境覆盖见记录，macOS 待验证 |
| S5 | 已完成：九项事务规则与两端行为自动核对 | `test_task_transaction_contract_rules.py`、`transaction/contract_tests.rs` | 原生校验、实际文件恢复与逐项差异检查 | 定向回归通过 |
| S6 | 已完成：任务产物键共用一份清单 | `task_manifest/schema.rs:9`、`worker_runtime/result_protocol.rs:2` | manifest 与 Worker 结果校验共用定义并核对契约 | 定向回归通过 |
| S7 | 已完成：移除前端七个闲置函数 | `workflowState.ts`、`updateState.ts`、`aiCreditsCopy.ts`、`taskArtifacts.ts` | 正式流程通过控制器、界面模型及面板执行；专用测试同步清理 | 完整前端回归通过 |
| S8 | 已完成：成稿调试输出清理与安全错误提示 | `draft_agent.py`、`worker_application/insight_retry.py` | 生成通过工具交付，异常结果与必要警告只包含安全信息 | 定向回归通过 |
| S9 | 本地已完成：限流返回全部阻塞窗口的最晚解除时间 | `prismaStore/rateLimits.ts`、`emailDispatchRateLimits.test.ts` | 数据库原子预约与失败撤销保持，重试时间与 Memory 一致 | 本地门禁通过；生产部署与托管 CI 待执行 |
| S10 | 本地已完成：管理端五个接口共用认证与 CSRF 检查 | `routes/admin.ts:76`、`adminMutationAuth.test.ts` | 认证和 CSRF 规则集中维护，保留各接口原有业务条件 | 本地门禁通过；生产部署与托管 CI 待执行 |
| S11 | 本地已完成：移除权益持久化状态，按期限判断有效性 | `schema.prisma`、`202610290001_remove_entitlement_status` | 移除列、内部字段和十二处写入，数据与约束保留 | 本地门禁通过；生产迁移与托管 CI 待执行 |
| S12 | 本地已完成：脚本测试接入自动门禁 | `scripts-ci.yml`、`scripts/tests/` | Windows/macOS 自动执行 Node、Python 测试与文档治理；独立时长验算脚本已移除 | 本地检查通过；托管 CI 待执行 |
| S13 | 已完成：移除官网四个闲置动态效果脚本 | `site/src/scripts/`、`site/README.md` | 用户确认用途终止，源码与相关说明已清理 | 官网构建、类型检查与发布文件哈希比对通过 |

## 证明记录

### S1 已完成：worker stdin 失败结果统一序列化

- Implementation：`stdin_failure_result` 通过 `ProcessResult(status=JobStage.FAILED, error=WorkerError(...)).to_dict()` 生成 task 失败结果，包含完整 11 个字段，其中 `dissection: null`、`draft: ""`。
- Locus：`worker/frameq_worker/cli.py:59-73`；统一结果定义在 `worker/frameq_worker/models.py:206-234`；Rust 读取方为 `app/src-tauri/src/worker_runtime/result_protocol.rs:209-231`。
- Behavior：`process_video`、`process_local_media` 返回 `WORKER_STDIN_INVALID`、固定安全消息及 `waiting_input` 阶段；`retry_insights` 使用 `insights_generating` 阶段。`resolve_source_identity` 保留仅包含 `status`、`error.code` 的封闭 source 失败结果。所有这些 stdin 拒绝路径退出码为 1。
- Presentation：`app/src/workerErrorCopy.ts:13` 将 `WORKER_STDIN_INVALID` 映射到 `request.invalid`，前端沿用输入无效的本地化文案。
- Regression：`worker/tests/test_cli_stdin_results.py` 使用真实 Worker 子进程，覆盖四种 stdin 入口与空输入、无效 JSON、非对象 JSON、无效 UTF-8、超限输入五类情况，共 20 项。逐项校验契约、错误码与阶段、单行 stdout、不回显私有输入以及工作目录无任务产物；CLI 模块边界测试允许依赖共享结果模型。
- Verification：新增回归与 `worker/tests/test_contract.py` 共 37 项通过；Rust `worker_runtime::result_protocol::tests` 10 项通过；前端 `workerErrorCopy.test.ts` 67 项通过；变更 Python 文件的 ruff 检查与格式检查通过。
- Scope：正常任务处理流程与结果协议保持现有契约。未执行桌面交互、完整测试套件或安装包构建。

### S2 本地已完成：服务端更新清单与路由移除

- Authorization：2026-10-28 用户明确确认没有仓库外程序使用该接口，并授权处理。
- Implementation：移除服务端更新路由、清单解析模块、对应运行时配置和专属测试；`server.ts`、`index.ts`、`runtimeConfig.ts` 与 `.env.example` 只保留当前服务能力所需配置。
- Behavior：请求 `/api/desktop/updates/windows/x86_64/0.1.0?channel=stable` 返回标准 404；桌面 Tauri updater 继续使用 `tauri.conf.json:36-37` 中的 GitHub Releases 地址。Nginx 通用 `/api/desktop/` 代理继续服务其他接口。
- Regression：`server/tests/routes.test.ts` 使用真实 Fastify 请求验证 404，并检查支持的路由；`serverModuleBoundaries.test.ts` 维护精确模块与路由集合。
- Verification：完整 server 测试 321 项通过、Windows 子进程 SIGTERM 用例既有跳过 1 项；TypeScript build 通过。独立 SQLite 执行全部 7 条迁移、migration status、preflight 与隔离副本 restore smoke 均通过；生产源码和配置未发现清单处理残留。
- Scope：本地修改完成；没有部署生产服务或运行托管 CI。发布证据由 `docs/exec-plans/active/2026-10-28-server-update-manifest-removal-plan.md` 跟踪。

### S3 已完成：edit-session 测试使用正式事务提交

- Implementation：`TaskEditSession` 通过 `encoded_manifest()` 提供序列化字节，正式写入统一由 `commit_task_artifacts()` 执行。编辑会话的单文件保存方法及 storage 写入 helper 已移除。
- Locus：`app/src-tauri/src/task_manifest/access.rs:352`、`storage.rs:92`、`tests.rs:608`；事务入口为 `transaction.rs:97`。
- Behavior：编辑会话保持安全路径校验、未知顶层字段保留与 JSON 末尾换行。事务将 manifest 与关联 Markdown 一起提交，并按既有协议清理 journal。
- Regression：`edit_session_preserves_unknown_fields_and_rejects_unsafe_paths_without_echo` 使用真实任务目录和事务写入，同时验证 manifest 内容、Markdown 文件内容与 journal 清理；任务模块的恢复与失败路径测试继续覆盖现有保护。
- Verification：`cargo test --offline --manifest-path app/src-tauri/Cargo.toml task_manifest:: -- --test-threads=1` 共 31 项通过；app lint 与原子写入边界脚本检查通过；三个变更 Rust 文件的 rustfmt 检查通过。
- Scope：生产任务编辑流程沿用现有事务入口，结果文件路径、格式与用户可见行为保持现有契约。全库检查的结果和平台限制见验证记录。

### S4 本地已完成：共用文件安全检查与原始备份路径

- Implementation：`atomic_files::is_link_or_reparse_point` 是唯一的元数据判定 owner，保留 Windows 与非 Windows 两个平台版本。`task_manifest/storage` 引用并重新导出该谓词，同时维护唯一的 `reject_linked_artifact_target` 与 `original_backup_path`。
- Callers：本地选源直接引用 atomic_files；历史删除、任务事务等入口沿用任务模块的稳定导出。文字稿与成稿编辑通过任务根模块引用两个 helper，私有模块依赖方向保持原有结构。
- Behavior：选源继续检查全部祖先、普通非空文件和支持扩展名；原子操作、任务目录与 manifest 保留各自类型和路径限制。共用目标检查继续检查目标及直接父目录，错误消息、缺失路径处理和调用顺序保持原有内容。原始备份仍位于原文件所在目录下的 `original/`，覆盖 transcript 与 ai/draft 两种布局。
- Regression：新增 `file_safety_tests.rs`，对正式选源、原子写入/删除、任务访问和两种编辑入口使用真实样本。普通路径矩阵验证合法文件接受、目录不能充当正文、首次备份在后续保存中保持原文；junction 矩阵验证链接父目录、链接任务根与链接产物目录拒绝，外部正文和 manifest 不变。另包含文件、目录和断开目标的 symlink 矩阵。
- Ownership：现有任务模块守卫先因缺少共享导出失败，提取后通过；守卫同时禁止调用模块重新定义这些规则和 helper。
- Verification：提交前 Windows 完整 Rust 套件 354 项通过，0 失败、0 忽略，耗时 6.12 秒，main 与 doc-tests 成功。Node 脚本 51 项、Python 脚本 1 项、app lint、变更 Rust 文件 rustfmt 与文档治理通过。
- Platform：用户已确认 Windows symlink 权限问题解决。提交前本次工具执行上下文仍在创建 symlink 时返回 `1314`，三项矩阵主体未执行；普通路径与 Windows junction 的三个矩阵实际通过。macOS 尚未运行。日志为 `build/s4-commit-link-tests.log` 与 `build/s4-commit-rust-full.log`。
- Plan：`docs/exec-plans/completed/2026-10-29-shared-file-safety-plan.md`。

### S5 已完成：九项事务规则与两端行为自动核对

- Implementation：Python `worker/tests/test_task_transaction_contract_rules.py` 和 Rust `app/src-tauri/src/task_manifest/transaction/contract_tests.rs` 直接读取 `contracts/task-artifact-transaction-v1.json`，核对原生事务实现。
- Rules：覆盖 `journal.transactionIdPattern`、`journal.minimumEntries`、`journal.maximumEntries`、`internalPath.fileNameTemplate`、`internalPath.sameDirectoryAsDestination`、`entry.nullableFields`、`commitOrder.manifestDestination`、`commitOrder.manifestMustBeLast`、`commitOrder.journalCommittedStateIsCommitPoint` 共九项声明。
- Behavior：核对事务标识的长度、字符和拒绝边界，条目数量上下界及越界拒绝；遍历允许目标、索引边界和 staging/rollback 两种文件，比较内部名称与父目录；分别验证 null 与缺失字段；检查 manifest 的生产排序和 journal 读取顺序；通过真实文件验证 prepared 恢复旧内容、committed 保留新内容及内部文件清理。
- Drift verification：两端分别在内存中逐项改变九项声明，确认每项差异都会触发检查失败。磁盘上的契约保持原有内容。
- Verification：Python 新增 10 项测试与既有事务测试共 28 项通过；Rust 任务模块共 33 项通过，其中包含新增的规则核对与九项差异检测；Node 契约和原子写入守卫共 3 项通过；app lint、Python ruff 和变更 Rust 文件格式检查通过。
- Scope：改动为测试覆盖、Rust 的 `#[cfg(test)]` 模块声明与常量排版，运行时事务规则和产物格式保持现有契约。Windows 全量 Rust 验证已通过，平台范围见验证记录。

### S6 已完成：任务产物键共用一份清单

- Implementation：`task_manifest/schema.rs:9` 定义唯一的 `TASK_ARTIFACT_KEYS`，经 `task_manifest.rs` 根模块导出；manifest 路径校验和 `worker_runtime/result_protocol.rs` 的结果校验都引用它。
- Boundary：沿用 `worker_runtime → task_manifest` 的依赖方向，schema 子模块保持私有；支持的 13 个键、路径限制和结果协议保持现有契约。
- Regression：`rust_registry_matches_the_canonical_terminal_contract` 核对清单与 `contracts/desktop-worker-contract.json` 的完整键集合，并检查没有重复键；`contract_artifact_fields_are_supported_by_manifest_validation` 遍历契约中的每个字段，验证安全路径被接受、未知字段被拒绝。
- Verification：Rust 任务模块 34 项与结果协议 10 项通过；Node 契约和原子写入守卫 3 项通过；app lint 与四个变更 Rust 文件的 rustfmt 检查通过。
- Scope：本次为共用定义的内部重构，产物格式、用户可见行为与跨语言契约版本保持原有内容。Windows 全量 Rust 验证已通过，平台范围见验证记录。

### S7 已完成：移除前端七个闲置函数

- Implementation：四个模块移除 `cancelProcessing`、`getVisibleWorkflowError`、`getTranscriptSourceLabel`、`shouldShowToolbarUpdateReminder`、`formatAiCreditsBalance`、`formatAiCreditsAllocation`、`hasArtifact`；`workflow.ts` 的通配导出随定义移除相应入口，额度文案模块移除闲置的 `formatNumber` 导入。
- Behavior：任务取消继续经过 `requestProcessingCancellation` 与 `confirmProcessingCancellation`；错误与来源标签由 `taskWorkspaceViewModel` 和面板生成；更新提醒由 `useAppUpdateController` 维护；额度余额使用当前 i18next 渲染流程。
- Regression：移除只覆盖闲置别名和错误显示函数的两项测试，取消后保留网址的断言合并到正式确认流程测试。文字稿元数据测试继续覆盖 `summarizeWorkerResult`；额度测试继续验证三种语言的费用提示和披露文案。
- Verification：源码、测试、脚本与契约中检索七个名称均无命中；完整前端测试 86 个文件、866 项全部通过；app lint、生产构建、文档治理和变更检查通过。
- Scope：移除 63 行生产代码，界面行为与运行时边界保持现有契约；本次未执行桌面壳层交互或安装包构建。

### S8 已完成：成稿调试输出清理与安全错误提示

- Authorization：2026-10-28 用户确认不依赖终端日志，并授权执行清理与安全错误提示方案。
- Implementation：移除逐步事件内容打印、会话与配置打印、结束状态打印和完整异常转储；同步删除格式化辅助函数、闲置导入与仅服务打印的参数。
- Safety：成稿异常继续返回 `DRAFT_GENERATION_FAILED` 与 `draft_generating`，消息固定为 `Draft generation failed.`；hook 警告仅记录内部层名与固定事件名，MCP 清理警告仅记录固定消息。
- Behavior：事件循环完整消费 `step_until_done`，正文只从 `submit_draft` 的接收槽取得；空结果仍返回 `DRAFT_EMPTY_RESULT`。失败保留已有成稿、原始备份及其他任务产物的文件内容。
- Regression：成稿分支的异常测试改为执行真实配置校验与 `Request` 地址校验，覆盖配置缺失、地址非法及有无已有成稿四种情况。校验返回结果和 manifest 的固定错误、两个输出通道为空、测试标记不泄露，以及原有产物字节保持一致；不调用外部服务。
- Verification：六个成稿测试文件共 111 项通过，其中包含四项真实失败回归；Rust 诊断分流七项通过。完整 Worker 检查为 1161 passed、3 skipped、1 failed，失败限于独立 Python 子进程未加载现有依赖目录；显式初始化同一依赖目录后，独立导入通过。完整 Worker 的 ruff 检查、四个变更 Python 文件的格式检查与文档治理通过。
- Scope：沿用现有错误分类、工具交付和隐私边界，任务请求、产物格式和额度逻辑保持现有契约。本次未执行真实 LLM/MCP 调用、桌面交互或安装包构建。

### S9 本地已完成：限流返回全部阻塞窗口的最晚解除时间

- Authorization：2026-10-29 用户确认执行全部窗口检查、最晚解除时间与原子计数保护方案。
- Implementation：`prismaStore/rateLimits.ts` 保留逐个窗口的条件 SQL 预约。每次预约返回该窗口是否阻塞，全部检查结束后取最晚解除时间抛出一次 `RateLimitExceededError`，由调用方事务撤销所有临时计数。
- Behavior：同一请求下，邮箱每分钟、邮箱每小时、可信 IP 每小时的全部已有阻塞共同决定 `retryAt`；本次成功预约的计数不会被重新识别为已有阻塞。现有限流阈值、Store 形状与 HTTP 字段保持原有契约；自助激活响应继续用同一时刻生成 `retry_at` 和向上取整的 `Retry-After`。
- Regression：`server/tests/emailDispatchRateLimits.test.ts` 新增 28 项真实数据库测试。三种邮件用途分别覆盖全部窗口组合、最后可用位置、分钟窗口跨越整点、解除前一毫秒与恰好解除时刻；核对 Prisma 与 Memory 的结果及完整计数。两个独立 Prisma client 竞争最后发送位置时，只允许创建一条验证码，另一个请求返回全部阻塞的最晚解除时间。
- Verification：新回归与既有限流/并发检查共 56 项通过；完整 server 测试 349 passed、1 skipped；TypeScript build 通过。隔离 SQLite 的七条迁移、migration status、preflight 与独立副本 restore smoke 通过，文档治理与 diff 检查通过。
- Scope：本地修复完成；其他请求产生的新消耗仍可能继续限制后续请求。没有修改数据库结构或部署生产服务；托管 CI 与生产验收由 `docs/exec-plans/active/2026-10-29-email-rate-limit-retry-time-plan.md` 跟踪。

### S10 本地已完成：管理端五个接口共用认证与 CSRF 检查

- Implementation：`server/src/routes/admin.ts` 的私有 `authenticateAdminMutation` 统一解析管理员 Cookie、认证会话、检查非空 token、验证绑定会话的 CSRF header，并返回认证结果。退出登录、生成激活码、LLM 配置、Anysearch 配置和权益补偿五个接口共用它；Cookie 与 CSRF 常量保持在原有安全模块内。
- Behavior：先返回身份失效的 401，再检查 CSRF 并返回 403；通过后才进行请求体校验和业务写入。退出登录仍用认证过的 token 撤销对应会话并按原有顺序清理 Cookie；权益补偿的管理员邮箱仍来自认证会话。
- Regression：`server/tests/adminMutationAuth.test.ts` 新增 45 项真实 SQLite/Fastify 请求测试。逐接口覆盖缺失、空值、未知、过期和已撤销会话，以及缺失、错误、属于其他会话的 CSRF header；分别使用有效及无效请求体检查拒绝顺序、数据库无写入和 Cookie 未清理。成功路径验证实际写入、补偿记录与定向退出，其他管理员会话保持有效。
- Verification：重构前新增测试与既有管理端和模块边界测试共 66 项通过；重构后完整 server 测试 394 passed、1 skipped，TypeScript build 通过。隔离 SQLite 的七条迁移、migration status、preflight 与独立副本 restore smoke 通过，文档治理与 diff 检查通过。
- Scope：本次为保持既有行为和安全边界的小范围内部重构；接口形状、会话策略及持久化语义保持现有契约。验证数据库位于 `build/side-admin-auth-3b4a8637fc9d464a839772d7e7025165/`。生产部署、托管 CI 与真实浏览器交互尚未执行。

### S11 本地已完成：移除权益持久化状态，按期限判断有效性

- Authorization：2026-10-29 用户授权删除冗余字段与写入，统一按到期时间判断。
- Implementation：Prisma 的 `Entitlement` 和内部 `EntitlementRecord` 移除持久化状态；Prisma 权益与付款流程移除十处写入，Memory 移除两处写入。相关类型化测试数据和生成的 Prisma client 已同步。
- Migration：新增第八条 `202610290001_remove_entitlement_status`，只执行目标列删除；七条历史 SQL 保持原有内容。启动检查和 current preflight 拒绝旧权益结构，current preflight 同时要求新迁移记录。
- Behavior：有效性按 `expiresAt > now` 判断，恰好到期即失效；公共 `entitlement_status` 仍由到期时间派生。权益 ID、用户关系、期限、额度、更新时间及相关约束继续保留。
- Regression：Memory/Prisma 分别验证到期前一毫秒、恰好到期和到期后一毫秒的额度使用与记录形状。从已填充的七条历史迁移升级，逐项核对保留数据、唯一索引、外键和三项额度约束；验证启动及 preflight 拒绝旧结构、迁移后隔离恢复通过，以及迁移前备份恢复后的结构和数据完整。
- Verification：定向检查 19 项通过；完整 server 测试 401 passed、1 skipped；TypeScript build 和 Prisma client 生成通过。空库完成八条迁移、migration status、schema diff（无差异）、preflight、SHA-256 副本校验和 restore smoke；文档治理与 diff 检查通过。
- Scope：仅在独立数据库执行迁移和恢复，生产及现有本地业务数据库保持原有内容。托管 CI、生产停服备份与配套部署由 `docs/exec-plans/active/2026-10-29-entitlement-expiry-only-plan.md` 跟踪。

### S12 本地已完成：脚本测试接入自动门禁

- Scope：只调整脚本测试、CI 与协作门禁，应用功能、Worker、服务端和安装包内容保持现有行为。
- Implementation：新增 `.github/workflows/scripts-ci.yml`，在 main 推送、pull request 和手动触发时于 Windows、macOS 执行全部 Node 脚本测试、Python 脚本测试和文档治理；各检查失败会使任务失败。
- Dependencies：Node 24；先在 `app/` 执行 `npm ci`，供 i18n 守卫读取 TypeScript。Python 脚本测试通过 uv 独立 Python 3.12 环境安装 pytest 9.1.0；测试工作目录与缓存位于忽略目录 `build/`。
- Runtime smoke：macOS 工作流守卫核对内置 ONNX 运行时的实际导入要求；保留版本一致性、原生测试、只读权限和产物检查。
- Cleanup：移除仅包含固定宣传台词与时间窗口、没有仓库调用引用的独立时长验算脚本；现有视频与字幕产物保持原有内容。
- Documentation：`AGENTS.md` 提供两类脚本测试命令；`docs/EXECUTION_GATES.md` 将它们列为相关变更的硬门禁。
- Verification：本机 Node v24.5.0 执行 51 项 Node 脚本测试全部通过；Python 3.13.5 / pytest 9.0.3 执行 Python 脚本测试 1 项通过。文档治理与 diff 检查通过；GitHub 托管 Windows/macOS 执行及 CI 依赖安装待提交后验证。

### S13 已完成：移除官网四个闲置动态效果脚本

- Authorization：用户于 2026-10-29 确认四个脚本已经没有用途。
- Implementation：删除 `site/src/scripts/` 下的 `tilt.ts`、`parallax.ts`、`ripple.ts`、`cursor-glow.ts`，共 167 行。共享布局采用现有 CSS 和原生控件完成交互反馈。
- Documentation：`site/README.md` 与 `2026-10-11-site-native-surface-redesign-plan.md` 的当前说明同步到现有交互方式。
- Verification：删除前后分别执行 Astro 静态构建，三条页面路由均成功；Astro 类型同步与站点 TypeScript 检查通过。页面、样式、静态资源和 sitemap 共 20 个文件逐项 SHA-256 一致，再次构建也得到相同内容。初次基线额外包含一个 `data-store.json` 内容缓存，单独记录为 Astro 构建缓存。
- Scope：构建输出位于忽略目录 `build/s13-site-cleanup-20261029/`。`site/` 仍由仓库整体忽略，本次源文件删除与 README 修改仅在本机生效；未部署生产官网。

## 反例

这些候选看起来像死代码，实际承担仍然有效的职责，不在本轮删除范围。

| 候选 | 保留理由 |
| --- | --- |
| `AuthService.verifyEmailCode`（`server/src/auth.ts:67`） | 生产无调用，但在 `auth.test.ts`、`authQuotaConcurrency.test.ts`、`prismaAuthQuotaConcurrency.test.ts` 共 13 处调用，验证验证码恰好消费一次与并发不重复。计数仅包含 `AuthService` 实例。删除会改变测试证明的内容。 |
| `TaskArtifact::DissectionMd`（`task_manifest/schema.rs:34-35`） | 没有生产构造点，仍有匹配分支和测试；`dissection_md` 键存在于 `TASK_ARTIFACT_KEYS` 与 `contracts/desktop-worker-contract.json`，对应的 `ai/dissection.md` 路径存在于 `ALLOWED_DESTINATIONS`。单侧删除提高跨语言漂移风险。 |
| `TaskManifest` 的 `#[serde(flatten)] extra`（`schema.rs:250-251`） | 没有显式访问 `extra` 的业务代码，Serde 仍通过它读入并重新写出未知顶层字段。删除后，保存文字稿编辑会丢弃这些未知字段。`task_manifest/tests.rs:608` 的编辑会话测试固定了保留性质。 |
| `MemoryStore` 与 `PrismaStore` 双实现 | Prisma 承载生产数据库事务、并发与部分真实路由测试；Memory 承载多项路由测试和失败注入。邮件限流的窗口组合、解除时间及计数已经通过真实 SQLite 对照；其他行为是否完全一致需要更全面的验证，双实现本身保留。 |
| `app/src-tauri/src/updates.rs:29-36` 的 macOS 平台门控 | 发布流水线只产出 Windows 的更新清单，门控删除后 macOS 上会静默报“已是最新”。该工作项已在技术债台账登记。 |

## 验证记录

以下结果来自 2026-10-28 至 2026-10-29 的审计核验及 S1、S2、S3、S5、S6、S7、S8、S9、S10、S11、S12、S13 验证。

| 检查 | 结果与范围 |
| --- | --- |
| S4 提交前检查（2026-10-29） | 完整 Rust 354 项通过，耗时 6.12 秒，原有取消、超时和完整进程树清理用例继续通过；新增普通路径、类型/备份、Windows junction 矩阵实际通过。用户确认 symlink 权限问题已解决；本次工具执行上下文仍返回 `1314`，三项 symlink 矩阵主体未执行。Node 脚本 51 项、Python 脚本 1 项、app lint 和变更 Rust 文件格式检查通过。日志位于 `build/s4-commit-link-tests.log`、`build/s4-commit-rust-full.log`；macOS 待验证。 |
| 提交前复核（2026-10-29） | Worker 与 Python 脚本定向检查共 133 项通过；Node 脚本 51 项通过；前端 86 个文件、866 项通过，lint 与生产构建通过；server 39 个文件、401 项通过、1 项跳过，TypeScript build 通过。隔离数据库完成八条迁移、migration status、current preflight、独立副本 restore smoke，源库与副本 SHA-256 一致。Worker ruff、脚本 CI 配置、文档治理和变更格式检查通过；托管 CI 与生产部署待执行。 |
| Windows Rust 全量验证（2026-10-29） | `cargo test --manifest-path app/src-tauri/Cargo.toml`：348 项全部通过，0 失败、0 忽略，耗时 6.30 秒；main 与 doc-tests 均成功。测试在允许终止自身子进程树的执行环境中运行，临时文件位于 `build/rust-process-validation-tmp`，完整日志为 `build/rust-process-validation-full.log`。取消、空闲与绝对超时、阻塞 stdin、完整子进程树清理和第二任务启动均通过原有真实用例；macOS 尚未重新验证。 |
| S12 脚本门禁 | `node --test scripts/tests/*.test.mjs` 51 项全部通过；`python -m pytest scripts/tests` 1 项通过，缓存与临时文件位于 `build/`。文档治理、diff 检查通过；新增 workflow 的托管运行待执行。 |
| S13 官网脚本清理 | 三条页面的 Astro 静态构建、`astro sync` 与 `tsc --noEmit` 通过；删除前后及再次构建的 20 份发布文件 SHA-256 一致，初次基线的额外内容缓存独立记录。四个脚本均已删除，当前源码无导入或初始化引用；未进行生产部署。 |
| 前端定向测试 | 审计时 `workflow.test.ts`、`updateState.test.ts`、`aiCreditsCopy.test.ts`、`taskWorkspaceViewModel.test.ts` 共 65 项通过；S1 另运行 `workerErrorCopy.test.ts` 67 项通过。完整前端回归与构建见 S7 记录。 |
| Rust 定向契约测试 | `transaction_contract_fixtures_match_rust_parser` 1 项通过；S1 运行 `worker_runtime::result_protocol::tests` 共 10 项通过，其中包含 `rust_registry_matches_the_canonical_terminal_contract`。Windows 全量验证现已通过；编译仍有两个既有测试辅助函数的 dead-code 警告。 |
| SQLite 删除列检查 | 审计阶段使用本机 Node v24.5.0、SQLite 3.50.3，在内存数据库验证原生列删除。正式 Prisma 迁移、数据保留与恢复证据见 S11。 |
| 文档治理 | `python scripts/validate_agents_docs.py --level ERROR`：0 错误、0 警告。 |
| S3 任务保存检查 | 任务模块 31 项通过；app lint、原子写入边界脚本及三个变更 Rust 文件的 rustfmt 检查通过。Windows 全量 Rust 验证现已通过；全库 rustfmt 检查仍有未修改文件中的既有格式差异。 |
| S5 契约规则检查 | Python 事务与规则测试 28 项、Rust 任务模块 33 项、Node 契约和原子写入守卫 3 项通过；两端各自验证九项声明在内存中逐项改变时均被检测。app lint、Python ruff 与变更 Rust 文件格式检查通过；未重跑全量测试。 |
| S6 产物键共用检查 | Rust 任务模块 34 项、结果协议 10 项、Node 契约和原子写入守卫 3 项通过；app lint 与四个变更 Rust 文件格式检查通过。清单仅在 schema 中定义一处，两类生产校验引用同一定义；未重跑全量测试。 |
| S7 前端闲置函数清理 | 变更前相关三个测试文件 43 项通过；清理后完整前端测试 86 个文件、866 项全部通过。app lint、生产构建、文档治理和变更检查通过；源码中七个函数名无残留。Vite 提示现有构建产物超过 500 kB，未执行桌面壳层交互或安装包构建。 |
| S8 成稿诊断检查 | 成稿相关 111 项与 Rust 诊断分流七项通过；完整 Worker 检查为 1161 passed、3 skipped、1 failed。失败位于 `test_llm.py::test_shared_runtime_imports_independently_in_fresh_python_process`，子进程报告缺少 `agent_runtime`；显式初始化现有依赖目录后，相同独立导入通过。完整 Worker 的 ruff 检查、四个变更 Python 文件格式检查、文档治理与 diff 检查通过。 |
| S9 限流重试时间检查 | 新增 28 项真实 SQLite/Memory 对照及独立连接竞争测试；与既有限流/并发检查共 56 项通过。完整 server 349 passed、1 skipped，TypeScript build 通过。独立数据库完成七条迁移、migration status、preflight 与隔离副本 restore smoke；文档治理和 diff 检查通过。生产部署与托管 CI 待执行。 |
| S10 管理端检查共用 | 新增 45 项真实 SQLite/Fastify 请求检查；重构前相关四个文件共 66 项通过，重构后完整 server 394 passed、1 skipped。TypeScript build、七条迁移、migration status、preflight、隔离副本 restore smoke、文档治理和 diff 检查通过。五处调用引用同一个私有 helper；401/403 文案、Cookie 所有权与退出行为保持现有契约。生产部署与托管 CI 待执行。 |
| S11 权益状态移除 | 期限边界、迁移和部署定向检查 19 项通过；完整 server 401 passed、1 skipped，build 与 Prisma client 生成通过。八条迁移、migration status、schema diff、preflight、备份 SHA-256 和隔离 restore smoke 通过；升级测试保留数据和全部约束，并验证新代码拒绝旧结构及迁移前备份恢复。文档治理与 diff 检查通过；生产迁移、配套部署与托管 CI 待执行。 |
| S2 服务端与运维检查 | server 321 passed、1 skipped；build 通过。`build/` 独立空 SQLite 文件完成 7 条迁移、migration status、preflight 与独立副本 restore smoke。未部署生产服务，托管 CI 待执行。 |
| Python 执行环境 | 使用本机 CPython 3.12.13，通过 `site.addsitedir` 初始化现有 `.venv` 依赖运行测试。S1 的两个文件共 37 项、S5 的事务与规则测试共 28 项通过；S8 的全量结果见对应记录。独立导入用例仅设置 Worker 的 `PYTHONPATH`，子进程未加载依赖目录。测试工作目录与缓存位于忽略目录 `build/`；未修改 Python 环境配置。 |
| Windows Rust 执行环境 | 受限执行环境中的 `taskkill` 对本次创建的子进程返回 `Access denied`。相同阻塞 stdin 取消用例在该环境运行 30.72 秒后返回 `RequestDeliveryFailed`；取得进程操作权限后，原用例 0.24 秒通过。该权限限制同时解释有限子进程自然退出后的四项断言失败和无限输出子进程造成的三项停滞。处理方式为在具备真实进程终止权限的环境运行完整套件；运行时代码、测试用例、超时值和断言均保持原有内容。 |

验证范围：本次工具运行未覆盖三项 symlink 矩阵主体；全库 rustfmt 检查仍有既有格式差异，Worker 独立导入用例的本机环境结果见 S8 检查记录。提交前 Worker 仅重跑定向检查，未重跑完整套件。未执行：macOS 原生 Rust 复核、真实下载、LLM 调用、桌面交互、生产部署及托管 CI。

## 下一步

实施候选时，需根据行为和边界变化按 `WORKFLOW.md` 更新规格与执行计划；取得相应授权后实施，并给出分层验证结果与恢复方式：

- Rust：`cargo test --manifest-path app/src-tauri/Cargo.toml`
- worker：`uv run pytest worker/tests`、`uv run ruff check worker`
- 前端：`npm --prefix app test`、`npm --prefix app run lint`、`npm --prefix app run build`
- server：`npm --prefix server test`、`npm --prefix server run build`，涉及迁移时补 preflight 与恢复冒烟
- 脚本：`node --test scripts/tests/*.test.mjs`、`python -m pytest scripts/tests`
- 文档：`uv run python scripts/validate_agents_docs.py --level ERROR`
