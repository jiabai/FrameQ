# 网页正文与工作间 Plan

本记录对应独立网页组件实现的实际验收。用户已于2026-11-02要求复用系统 WebView；后续改造见
[系统 WebView 完成记录](2026-11-02-system-webview-extraction-plan.md)。此处的浏览器组件及进程控制证据不代表系统 WebView 验收。

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

在现有主页保存公开或已授权网页：真实加载页面、提取格式化正文、保存本地笔记，随后使用现有明确确认的工作间。
主页布局、侧边栏、笔记及合集结构保持当前设计。网页详情使用正文阅读视图，来源与媒体分开建模，保留既有笔记和数据保护。
网页内容留在本机；用户确认工作间时，只有现有供应商边界接收对应内容，账号服务保持当前结账职责。

规格：`docs/product-specs/2026-11-01-web-page-notes.md`。
执行使用 `subagent-driven-development` 或 `executing-plans` 按任务实施，保留项目的 main 工作流及逐项验证。

## Progress

- [x] 2026-11-01: 接收并核查已确认的网页保存和界面范围。Validation: 本线程支线转交记录及 FrameQ/InsightFlow 只读源码检查。
- [x] 2026-11-01: 确认网页笔记同时支持现有工作间。Validation: 用户回复「同时支持现有工作间，沿用当前付费确认」。
- [x] 2026-11-01: 定义来源、正文、加载隔离、运行组件、保存及界面执行边界。Validation: 本规格、当前源码与下述官方参考。
- [x] 2026-11-01: 完成规格/计划交叉审查及文档门禁。Validation: 来源/工作间与加载隔离两组独立只读复核均无剩余阻断项；文档治理ERROR/WARN均0错误0警告，`git diff --check`通过。
- [x] 2026-11-01: 用户确认本技术计划，包含按需网页引擎和新提取功能的系统下限。Validation: 本线程用户回复「确认，按计划实施」。
- [x] 2026-11-02: 实施来源/事务/权威正文契约与旧媒体兼容。Validation: `build/web-python-final-2.log` 1251 passed / 4 skipped，最终 `build/web-rust-final-owner-confirmed.log` 504 passed / 23 ignored；正式 Python CLI 的四种 AI 重试结果经 Rust 来源核验、历史投影与 TypeScript 解析验证。
- [x] 2026-11-02: 实施网页引擎组件、独立浏览器、公网代理及受监督处理。Validation: Windows 真实组件安装/恢复/离线 CDP、16 条 CONNECT 限额、实际公网页 canary、root 崩溃后管道后代回收、所有权恢复 9 项及 renderer RSS 实测通过；macOS 和完整限制矩阵见下文未验证项。
- [x] 2026-11-02: 实施 InsightFlow 提取模块、正文保存和现有工作间接入。Validation: 真实 Document 提取、静态 RFC 9110 / JavaScript quotes 正文保存、双来源契约和正式 CLI 读取通过；用户选择跳过真实供应商验收。
- [x] 2026-11-02: 实施三语界面、笔记/合集/历史、迁移和删除集成。Validation: 最新前端完整 1442 passed / 1 skipped、lint 通过；实际三语正文和信息面板通过1180×760/720×640数值检查，原尺寸菜单7项14px左对齐，实际复制成功反馈和Explorer打开通过；未验证范围见下表。
- [x] 2026-11-02: 实施真实准入确认、取消和关闭屏障。Validation: 两个同步 begin 命令登记 Pending 并返回 null，长请求仅认领匹配登记；production cargo check、网页/引擎准入及关闭屏障检查通过；实际 IPC 12 次网页和 6 次组件即时取消、两种 SDK listener Abort、实际加载中关闭及重开清理通过。
- [x] 2026-11-02: 核验应用所有者及受监督成员的独立执行文件规则。Validation: `build/web-owner-hardlink-after.log` 9 项真实测试通过，含 Cargo 硬链接应用在存活时保留工作目录、退出后恢复；所有者按真实 PID/出生时间/绝对路径/文件身份检查并禁止进入终止成员集，其他成员保持单链接约束。
- [x] 2026-11-02: 按用户选择跳过付费验收。Validation: 用户明确回复「本次跳过付费验收」；未调用真实 AI 供应商，未消耗账号额度。
- [x] 2026-11-02: 完成 Windows 本地实现与最终桌面验收并归档。Validation: 三语实际 DOM/AX/数值检查，最终 SDK 网页保存和重开、真实 IPC 即时取消、加载中正常关闭/重开、默认正式程序构建和启动通过；本轮未执行项及公开发行门禁见验收矩阵和技术债。

## Surprises & Discoveries

- Evidence: 现有媒体 `SourceIdentity` 与网页来源分别建模；网址分类先识别已支持视频，再进入网页来源准入。
- Evidence: `useTaskProcessingController.ts` 在来源分流后分别准备媒体模型或网页引擎；`noteTitleSubmission.ts` 仅为符合条件的新媒体文字稿触发付费标题。
- Evidence: `history.rs`、`taskWorkspaceViewModel.ts`、`collectionNoteCreation.ts` 按闭集来源选择正式正文/完成产物，分别使用 `transcript_txt` 与 `article_txt` / `article_md`。
- Evidence: Tauri 2.11.2 `manager/webview.rs` 为 Webview 注册 IPC/asset 协议，asset handler 使用相应 origin。加载远程网页使用独立 Chromium，主应用只接收已校验的内容。
- Evidence: InsightFlow 的 DOM 提取与阅读界面代码同处 `readingSession.cjs`；`sanitizeClone` 的职责不足以承担持久内容的安全清洗。提取、清洗和转换独立成模块。
- Evidence: 官方 Playwright Python 1.64.1 与匹配浏览器具有系统和版本要求；实际 wheel 内的浏览器 manifest 是组件构建的版本事实来源。
- Evidence: 现有 PyTorch 下载入口具有专用目录和参数。网页引擎使用独立组件类型、必需校验和与原子安装，不使用 PyTorch 的目录或状态。
- Evidence: Playwright 的浏览器启动器在 Unix 创建独立进程组。浏览器由 Rust 直接创建并保有句柄，Python 通过公开 CDP 接口连接，原生取消同时拥有浏览器和 worker 的生命周期。
- Evidence: Windows 进程实例使用真实 creation FILETIME；恢复同时核验可执行文件身份、参数和祖先关系。已有 root 收据不接纳同参数的新实例。实际恢复测试保留了无关 Python 和同 UUID 的新实例。
- Evidence: Cargo 可为应用执行文件创建硬链接。应用所有者读取器按真实进程实例、绝对路径、文件身份及父目录身份核验，保留 no-follow 访问；worker/browser/组件和后代读取器保持单链接约束，所有者 PID 被终止成员校验拒绝。
- Evidence: 网页 worker 在接收 stdin 前属于原生 Job / 进程组；root 终态后先清理继承管道的后代，再等待 stdout / stderr reader。真实崩溃、零退出无协议和取消测试通过。
- Evidence: 临时树删除绑定已核验目录的原生句柄；无法确认清理的资料库进入本进程持续恢复状态，普通访问、迁移及旧副本清理均被阻止。
- Evidence: Tauri 异步 handler 和 IPC 传输请求具有各自的调度时点。网页及组件使用同步 begin 登记和真实 ACK，随后长请求采用相同操作/窗口的 Pending；取消登记后到达的长请求返回 WEB_CANCELLED。

## Decision Log

- Decision: 现有安全媒体任务继续写入/读取 schema 3；网页任务使用 schema 4 和 `web_page` 来源。Rationale: 来源、正文和 ASR 语义可严格区分，原媒体无需改写。Date/Author: 2026-11-01 / User + Codex。
- Decision: 网页标题来自页面元数据，网页工作间沿用显式费用确认。Rationale: 用户已确认网页工作间，提取标题已有真实来源。Date/Author: 2026-11-01 / User + Codex。
- Decision: 所有网页使用同一个真实 Chromium 加载路径。Rationale: 普通 HTML 与 JavaScript 正文共享隔离、网络及取消边界。Date/Author: 2026-11-01 / User + Codex。
- Decision: 使用按需 `web_engine` 组件，固定 Playwright Python 1.64.1 与匹配 headless shell；新提取功能要求 Windows 11/macOS 14，其他功能系统范围保持原约定。Rationale: 保持安装包轻量且使用当前受支持的浏览器。Date/Author: 2026-11-01 / User + Codex。
- Decision: Rust 拥有临时浏览器、CDP 就绪材料、公网代理和操作身份；受监督 Python worker 使用该浏览器加载、提取并通过 TaskStore 发布笔记。Rationale: 保留完整进程清理及现有权威保存所有者，避免远程页面接触 Tauri。Date/Author: 2026-11-01 / User + Codex。
- Decision: 临时代理无认证，只有公网 HTTP/HTTPS 转发，绑定随机 loopback 端口并有操作级限额。Rationale: 页面通过受控代理无法连接 loopback；不向页面暴露真实凭据或引入源站认证挑战的凭据混用。Date/Author: 2026-11-01 / User + Codex。
- Decision: 每次网页提交创建独立快照。Rationale: 保留已有正文及用户修改，媒体缓存复用规则独立保持。Date/Author: 2026-11-01 / User + Codex。
- Decision: 网页处理和组件探针共用缓存目录所有权收据、精确进程身份及安全删除机制。Rationale: 同一恢复规则覆盖 browser、driver 和 worker，身份不明确时保留材料并暂停资料库。Date/Author: 2026-11-02 / Codex。
- Decision: 应用所有者执行文件允许指向同一文件身份的硬链接，受监督成员继续使用严格单链接规则。Rationale: 应用所有者由真实 PID、出生时间、绝对路径和原生文件身份确定，并且不属于可终止成员。Date/Author: 2026-11-02 / Codex。
- Decision: 网页及组件调用先 await 同步 begin 的 null ACK，再提交长请求；登记和认领共用关闭屏障。Rationale: 明确操作何时可取消，覆盖 listener 准备、请求调度、尚未取得数据许可及窗口关闭期间的真实操作身份。Date/Author: 2026-11-02 / Codex。
- Decision: 真实供应商验收本轮不执行，发行资产保持未发布。Rationale: 用户明确选择跳过付费验收，且本轮未提出公开发布请求。Date/Author: 2026-11-02 / User + Codex。

## Context and Orientation

- 前端：`urlSupport.ts`、`workflowState.ts`、`workerResultProtocol.ts`、`historyClient.ts`、`taskWorkspaceViewModel.ts`、`features/workflow/`、`features/collections/`、`features/shell/`、`features/transcript/`、`features/results/MarkdownContent.tsx`。
- 原生：`task_manifest/{schema,storage,access,transaction,source_identity,dissection}.rs`、`history.rs`、`note_actions.rs`、`collections.rs`、`worker_runtime/`、`runtime_component.rs`、`data_storage.rs`、`data_storage_validation.rs`。
- Worker：`models.py`、`desktop_contract.py`、`cli.py`、`worker_service.py`、`task_store.py`、`task_transaction.py`、`worker_application/insight_retry.py`、`pipeline_runtime/insights.py`、`ai_prompts.py`、各工作间 agent 与 `dissection_report.py`。
- 契约：`contracts/desktop-worker-contract.json`、`contracts/task-artifact-transaction-v1.json`，新增 `contracts/web-page-request-v1.json` 与网页组件 manifest schema。
- 构建：`scripts/build-installer.mjs`、新增网页组件构建脚本、`desktop-release.yml`、三平台组件清单及许可证材料。
- 参考：InsightFlow `siteRules.cjs`、`readingSession.cjs` 的提取部分、`useMarkdownConverter.ts`、`tagsToRemove.ts`。运行时不 import InsightFlow。

## Plan of Work

### Task 1: 来源和权威正文契约

- [x] 新增 `app/src/webPageClient.ts`、`webPageProtocol.ts`、Rust `web_page.rs` 请求边界、Python `web_page_contract.py`；保持媒体处理请求的封闭契约。
- [x] `begin_web_page` 只接受封闭的三字段 request，`begin_web_engine_install` 只接受 operationId；同步绑定 main 窗口并返回 null。长 process/prepare 仅认领匹配 Pending，取消移除登记或通知已认领操作；关闭、退出、重启屏障拒绝新的登记/认领并等待真实清理。
- [x] 客户端在真实 listener 完成和 begin ACK 后分别复核 AbortSignal/有效操作；卸载取消保持原生请求，已发送的长调用等待真实结果及取消响应，最终移除 listener。
- [x] 新增 `WebPageSource`，包含安全来源网址、标题和 UTC 提取时间。Manifest schema 4 仅接受 `source_kind="web_page"`、`source_identity=null`、`transcript=null` 与明确的网页元数据；不声明 ASR 模型或 LLM 标题。
- [x] 注册 `article_txt="article/article.txt"`、`article_md="article/article.md"`，扩展通用笔记投影。`process_video`/`process_local_media`仍只接受媒体字段，网页处理结果拥有独立校验器。共享`TaskTerminalResult`、`parseWorkerResult`及desktop-worker契约升级AI retry结果union，按操作与已验证任务来源接受对应正文/解剖格式；媒体处理不得返回article产物。
- [x] `SupportedTask` 及 Python TaskStore 严格区分 schema 3 媒体和 schema 4 网页，拒绝混合来源、未知版本、缺失必需字段及错误产物路径。
- [x] 网址分类先识别当前受支持的视频/短链接，再接受单个有效 HTTP(S) 网页网址。本地文件路径保留原生选择 token。Rust 独立重验类型，不信任前端分类。
- [x] 新增网页来源规则模块，使用标准 URL 库解析。请求拒绝 userinfo、非 HTTP(S)、本地/保留地址、非 80/443 端口和不合法主机。原始网址只在内存和 stdin 中出现。
- [x] 持久网址使用最终安全页面 URL，移除 fragment 与 userinfo；允许的通用查询字段限定为 `id`、`article_id`、`post_id`、`story_id` 的 1–20 位十进制标识及 `page`/`p` 的 1–6 位正整数，其他参数移除。站点特例必须按主机及字段明确列出并附测试，不能动态信任网页提供的参数白名单。
- [x] 每次网页提交生成安全字符 task ID 并创建新快照；标题和 URL 不构成路径，不进入媒体缓存命中逻辑。

接口边界：

```typescript
type SavedArticle = {
  taskId: string;
  taskDir: string;
  source: { kind: "web_page"; url: string; title: string; extractedAt: string };
  artifacts: { article_txt: "article/article.txt"; article_md: "article/article.md" };
  text: string;
  markdown: string;
};
```

### Task 2: 原子保存和通用笔记读取

- [x] 新增 Python `web_page_storage.py`，由 TaskStoreFacade 一次发布 `article.txt`、`article.md` 和 manifest。Markdown 头部只使用安全标题、规范来源和本机生成的时间；不保存原始 HTML、Cookie 或请求信息。
- [x] 扩展 Rust/Python 同源事务白名单，允许固定 `article/` 路径及备份/恢复材料。新任务 manifest 最后发布，未提交目录不进入历史；所有文件保持 no-follow、身份和包含关系检查。
- [x] 新增`source_text.py`与原生权威正文reader：按已验证来源选择正式TXT，返回来源kind、artifact key、固定路径、原始UTF-8 bytes、解码文本及SHA-256；不存在、链接/重解析点、硬链接、错误编码和超限直接返回封闭错误。TaskStore、SourceText和共享契约独立于Playwright与网页加载模块，组件依赖只在网页加载操作中直接import。
- [x] 扩展 `history.rs`、历史投影和 `TaskSourceSummary`，读取网页 Markdown 与纯文本，保持媒体读取行为。
- [x] 真实文件测试覆盖两个 schema、错误来源组合、缺失正文、跨路径、硬链接/重解析点、提交中断与 Rust/Python journal 互读。

### Task 3: 网页引擎组件

- [x] 新增 `web_engine.rs` 及其严格组件安装模块、`scripts/build-web-engine.mjs` 和 `scripts/build_web_engine.py`。组件种类明确为 `web_engine`，复用下载进度界面和进程监督设施。
- [x] 组件包含固定版本 Playwright Python wheel、匹配 Node driver、Chromium headless shell、实际 Python 依赖和许可证。构建器只接受 Windows x64、macOS x64、macOS arm64 对应的本机运行器；Windows x64 实包已生成，macOS 实包待对应环境验证。
- [x] 构建读取实际 wheel 的 `driver/package/browsers.json`，核对 Chromium headless shell revision 1248、版本 156.0.8078.4；Python 包固定 1.64.1，实际 wheel driver 固定 `1.64.0-beta-1791568591000`。版本差异导致构建失败。
- [x] 构建器生成固定版本、目标、解压后 inventory、归档 SHA-256、字节数、运行探针及提取 bundle 指纹。下载地址使用与客户端发行版本绑定的受控 GitHub Release 资产；Windows 实际数据见来源文档。
- [x] 下载先校验归档必需 SHA，再安全解包、逐项核对及真实离线启动探针；成功后原子安装到 `runtime/web-engine/<version>/`，最后发送完成状态。失败保留上个已验证版本与可识别的暂存材料。
- [x] 首次网页提交缺组件时，`useWebEngine.tsx` 显示组件确认/下载界面，按真实状态展示大小、进度及取消。组件准备与网页加载具有独立状态；应用启动和笔记读取不触发下载。真实线上资产下载仍按下述发行门禁验证。
- [x] 原生系统检查及三语说明限定新提取功能为 Windows 11/macOS 14 及以上；已有笔记阅读和工作间不导入引擎。当前 Windows 的实际状态接口及缺引擎阅读已验证；更早系统和 macOS 未提供运行环境。
- [x] 用同一安装器对真实 Windows 归档完成本机 hash、解包、逐文件核验、离线 CDP、失败保留和损坏实例恢复验收。
- [ ] 发行前门禁：在两个 macOS 本机运行器生成并验证组件；公开分发前验证已发布资产的实际下载、hash、安装及启动。本轮未发布资产。

### Task 4: 独立浏览器、公网出口与操作生命周期

- [x] 新增原生 `web_page.rs` 组合命令及 `web_page/{browser,network,errors,ownership}.rs`。一次网页操作持有数据许可、操作 ID、取消信号、固定 deadline、临时目录身份、浏览器 child 与 worker 所有权。
- [x] Rust 从已验证组件直接启动 headless shell，保留组件实际提供的 renderer 沙箱，使用本次独立 profile。URL、正文和凭据不放 argv/env；公开操作 UUID 可进入 worker argv 用于归属核验。浏览器以空白页及受控代理启动，browser/driver 使用显式环境白名单，不持久化 trace、HAR、截图、录像或页面控制台内容。
- [x] 原生拥有浏览器进程组/句柄并读取本次profile的有界`DevToolsActivePort`；只接受该实例精确的`ws://127.0.0.1:<port>/devtools/browser/<id>`，拒绝其他host/path、HTTP探测地址和端点重定向，将端点及请求通过stdin传给受监督worker。前端不能提交PID、CDP地址或组件路径。
- [x] Worker 用公开 `connect_over_cdp` 连接已启动的 Chromium，新建隔离 BrowserContext。Node driver 由网页 worker 的 Job / 进程组拥有；root 终态后先终止并确认后代退出，再等待管道 reader。
- [x] 原生使用 Hyper 实现一次性 loopback HTTP/CONNECT 代理，仅随机端口监听，无管理/文件 API，无账号或代理认证字段。
- [x] 代理对每个新目标解析 DNS，拒绝全部非公网/IPv4-mapped 私网/保留地址，直接连接已验证 SocketAddr。HTTP/HTTPS、跳转、子资源和新域名连接均经过相同 connector；保持端到端 TLS 证书验证。受控 DNS 变更的真实设施验收单独保留。
- [x] Rust启动Chromium时即设置统一代理与`<-loopback>`取消默认loopback bypass，新context继续使用同一代理。关闭QUIC和非代理WebRTC UDP，拒绝DIRECT备用出口；禁止继承系统代理、扩展、现有浏览器profile、账号Cookie、系统凭据和HTTPS忽略错误配置。
- [x] BrowserContext 配置 Service Worker / WebSocket / 下载 / 弹窗 / 权限限制，不提供 origin HTTP credentials；CDP 对认证挑战发送 `CancelAuth`。401、实际 Basic challenge 及本机访问 canary 已验证，其他具体场景的覆盖范围见验收矩阵。
- [x] 实现固定限额：准备就绪15秒、页面导航/稳定60秒、整个网页worker90秒；至多5次主页面跳转、100个资源请求、16个并发连接、64MiB总网络传输。8MiB为提取前DOM序列化准入上限；输出上限为4MiB Markdown、2MiB纯文本及512个Unicode字符标题。
- TLS 保持端到端传输；8MiB检查在渲染后的 DOM 序列化阶段执行，网络层另按实际传输字节限制总量。
- [x] 原生按250ms间隔读取本操作 browser/driver/worker 的精确实例 RSS，超过2GiB返回资源超限并终止资源。实际5个 owned 进程含 renderer 的 RSS 非零且与独立 Windows API 核验一致；实际2GiB越限注入未执行。
- [x] DOM最多100,000个节点，候选正文至少50个非空白Unicode字符。以500ms间隔执行有界提取，三次相同有效指纹才保存，单次提取限2秒。代数/URL/实例变化丢弃旧候选；仅明确的待正文状态继续等待，未知提取异常立即返回封闭失败。
- [x] 正常结束、取消及 worker 崩溃清理代理、浏览器和 worker 后代；清理不确定时持久保留收据并暂停该资料库的后续数据操作。Windows 真实 root 崩溃、继承管道、匹配取消、stale 实例及后续任务验证通过。
- [x] 导航前完成进程所有权和代理就绪，迁移、关闭及重启使用原生数据守卫。收据绑定精确进程出生时间、可执行身份与命令归属，已有 root 收据不接纳同参数新实例；安全删除使用身份绑定的原生句柄。
- [x] 实际 Tauri IPC 的网页12次、组件6次即时取消，Pending取消后延迟提交和未登记提交拒绝、两种真实SDK listener Abort通过；实际HTTP加载中正常关闭、资源清理和重开Ready通过。证据：`build/web-final-native-ipc-result.json`、`build/web-final-close-acceptance.md`。

### Task 5: 提取、清洗和 Markdown 转换

- [x] 新建 `app/src/articleExtraction/`，将 InsightFlow 的站点规则、DOM 提取辅助逻辑和转换配置分开迁入，函数接收目标 Document 与来源 URL。
- [x] 导出 `extractArticle(document, sourceUrl) -> { title, text, markdown, sourceUrl }`，不迁移阅读界面、翻译、Chrome消息或监听器。
- [x] 按经过审查的 host/path 规则选择正文；通用页面使用 Readability 的明确正文结果。无正文返回失败，不将全站导航文字包装成文章。
- [x] 固定 Readability 0.6.0、Turndown 7.2.0、DOMPurify 3.4.17、turndown-plugin-gfm 1.0.2，记录包锁及integrity。使用成熟DOM清洗器保留规定结构，去掉活动内容、表单、iframe、事件、style及危险URL。
- [x] 持久链接使用网页安全 URL 规则。图片保留可读替代文字/说明；本地阅读不自动访问外部图片或其他资源。
- [x] 浏览器中执行随应用构建的提取 bundle，返回严格有界 JSON。Python 对字段、编码、标题和大小重验，时间由可信本机保存流程生成。
- [x] InsightFlow MIT 自有代码、独立 MPL-2.0 站点规则及第三方依赖分别保留来源、修改及许可证。规则表按官方 Clearly Reader 3.0.4 可验证来源记录。
- [x] 使用真实 Document 解析 HTML 文件，覆盖中英文正文、标题、段落、列表、引用、表格、代码、相对链接、恶意节点及 URL，检查 Markdown 与纯文本的结构/含义；真实 Chromium 静态与 JavaScript 页面另行验证。

### Task 6: 现有工作间读取网页正文

- [x] 将 `pipeline_runtime/insights.py` 的固定转录路径读取改由已验证任务的权威正文 reader 负责；总结、脑图和灵感读取网页 `article.txt` 的完整正式文本，保留当前分段、预算和结账边界。
- [x] Python `task_store.py` 的加载、context重建、序列化、既有产物发现及AI finalize保持网页schema4、来源、标题、时间与真实article产物。四种 AI retry 结果均重新读取正式 TXT / Markdown 并经 Rust 核验，保留 CRLF 与 Unicode 原始字节。
- [x] `ai_prompts.py` 根据闭集来源类型表达「媒体文字稿」或「网页正文」，来源类型由 manifest 决定。网页内容仍作为证据，不构成工具或系统指令。
- [x] 网页解剖报告使用 schema 2、`sourceKind="article"`、`sourceTextSha256`；媒体继续使用当前 schema 1 和 `sourceTranscriptSha256`。Python/Rust/TS 使用封闭 union，按正式原始 bytes 验证整体 hash、片段范围及全文。
- [x] 网页解剖沿用现有 2000 字符分段、至多16段和1–6次调用预算；三语确认、片段引用和「定位到正文」按来源显示。
- [x] `App.tsx`、`AiResultDetailSheet.tsx` 的解剖定位交由对应来源的owner。Article owner使用正式article.txt原始UTF-8字节范围展示/高亮引用；不能将该偏移套入Markdown字符串，不能调用音频或segments。返回后保持默认格式化正文阅读。
- [x] 灵感草稿保持现有输入边界：有效seed insight、偏好snapshot和可选summary；不额外加入原始正文。草稿生成返回`artifact_payloads`，由TaskStore事务共同发布draft与manifest，并将旧`ai/original/draft.md`备份删除作为允许的非产物mutation提交；同步`_artifacts_after_payloads()`校验，不直接write/unlink最终文件。
- [x] 网页不触发自动标题 checkout，不进入 ASR 专用文字稿整理。显式总结、灵感、解剖和草稿继续使用现有费用确认、语言快照、取消与重试。
- [x] 原生及worker均拒绝网页的`title`和`transcript` retry target。总结/灵感/解剖保留ai_runtime按实际供应商调用checkout及各自上限；草稿保留独立单次checkout、当前40 turns上限和anysearch流程，不重新定义计费。
- [x] 通过真实文件和正式 CLI 证明每次重试读取权威正文，网页/媒体来源不能互换，解剖 hash/范围失效被准确识别；共享错误 stage 与历史重开契约验证通过。
- [ ] 真实供应商生成质量与计费验收：本轮按用户明确选择跳过，不调用供应商、不消耗额度。

### Task 7: 页面、笔记和合集集成

- [x] 在 ASR 准备前按来源分流提交；保留当前账号可用性、操作互斥、导航和存储守卫，网页流程没有模型检查。
- [x] 新增 `features/articles/ArticleWorkspace.tsx` 和网页控制器，复用 `MarkdownContent.tsx` 安全渲染器，不挂载播放器、时间戳、segments、转译编辑或整理文字稿控制器。
- [x] 现有工具栏在网页中使用「定位正文」「复制正文」，正文定位以 `article/article.md` 为正式格式化文件，复制使用 `article.txt`。统一使用已修复的文件定位 helper。
- [x] 主页仅变更输入提示及与当前来源匹配的现有说明文字；网页工作阶段为加载、提取、保存，等待/取消有明确状态。
- [x] 名称优先级为手动名称、相应来源的正式标题、既有媒体预览。网页原始标题和提取时间进入笔记信息，来源复制/打开使用安全来源规则。
- [x] 合集创建笔记的完成判定接受真实网页保存结果，保留 intentId/attemptId、防止串入其他合集及「已保存但加入合集失败」重试。
- [x] 扩展侧边栏、Notes、Collection、Artifacts和History的类型投影及正文产物白名单，保持现有布局。
- [x] `taskWorkspaceViewModel`、`useTaskProcessingController.retryInsightGeneration`、`useInsightGenerationController`及`useTranscriptDissectionController`改用正式来源正文的就绪判定。总结、灵感、解剖与草稿确认按来源显示正式正文路径及三语隐私说明，保留当前费用/语言/配额保护。
- [x] 实现三语文案及辅助技术标签；HTML不启用原始执行，链接经受控 opener 在用户操作后打开，组件准备沿用当前确认/进度样式。资源、组件和契约测试通过。
- [x] 完成实际桌面的三语正文/NoteInfo两尺寸 DOM / AX / 数值检查，原尺寸三语菜单及简体720×640菜单检查、复制成功反馈与Explorer打开；未读取剪贴板内容或确认文件选中，未进行本轮合集GUI成员变更，繁体/英文窄菜单未分别验收。具体记录为 `build/web-native-ui-acceptance.md` 和 `build/web-ui-acceptance-evidence.json`。

### Task 8: 迁移、删除和组件恢复

- [x] `SupportedTask::scan_read_only`、迁移核验 supported task baseline、合集有效任务及删除入口认识 schema 4，完整任务树和成员关系按现有机制保留。
- [x] 网页引擎、inventory和版本归属数据根 `runtime/`；临时 profile/材料归属 `cache/`，固定配置与账号凭据保持当前目录。
- [x] 迁移前等待完整网页操作和组件安装结束，迁移后核验网页正文/元数据及曾可用引擎的真实无网启动。
- [x] 网页删除沿用确认、目录身份、事务恢复及持久清理。临时目录恢复核验所有权和活实例，目录删除绑定物理身份；Windows 实际目录交换、junction、硬链接和文件锁测试保留外部内容。
- [x] 真实跨根笔记测试验证正文原始字节、名称、固定状态、合集及既有产物保留；真实引擎迁移验证新根完整 inventory 和离线重探。旧副本清理继续逐文件核对当前副本。

### Task 9: 文档与发行事实同步

- [x] 同步`docs/ARCHITECTURE.md`、`docs/SECURITY.md`、`docs/DESIGN.md`及来源、历史、自动标题和工作间规格，区分媒体与网页的职责及验收范围。
- [x] 补齐`docs/references/2026-11-01-web-page-extraction-sources.md`的构建锁、许可证和 Windows 实际组件体积记录；本计划持续维护 Progress、Decision Log 及实测/未验证矩阵。

## Validation and Acceptance

### 自动门禁

```powershell
npm --prefix app test
npm --prefix app run lint
npm --prefix app run build
uv run ruff check worker
uv run pytest worker/tests
cargo test --manifest-path app/src-tauri/Cargo.toml
node --test scripts/tests/*.test.mjs
uv run python -m pytest scripts/tests
uv run python scripts/validate_agents_docs.py --level ERROR
uv run python scripts/validate_agents_docs.py --level WARN
npm --prefix app run tauri -- build --no-bundle
git diff --check
```

### 真实行为门禁

- 实际 Chromium 解析静态文章和 JavaScript 延迟生成的文章，验证 Markdown/纯文本、标题、时间、来源及完整结构。
- 实际公网页面、重定向、无正文、非HTML、401/403、CAPTCHA、请求/内容超限、持续变化DOM和执行停滞各有真实失败或取消证据。
- 实际本地 canary 监听器验证网页及其重定向/子资源访问私网、loopback、IPv4-mapped IPv6、DNS地址变化时没有收到连接；使用受控DNS测试设施验证连接绑定，不能替换DNS函数的返回值冒充验证。
- 页面尝试 Tauri IPC、asset、文件访问、弹窗、下载、Service Worker、WebRTC/QUIC及HTTP认证挑战时无法取得本机资料或凭据。哨兵文件放在隔离配置目录，正文产物和诊断中不得出现哨兵内容。
- Windows与macOS真实进程证明普通结束、取消、绝对超时、worker/driver崩溃及窗口关闭后，本次浏览器/Node/worker全部退出；无关浏览器和下一次操作保持正常。
- 真实组件归档证明缺少hash、hash错误、缺文件、链接条目、探针失败、安装中断和空间不足均不发布Ready，保留已验证版本；三平台记录实际归档/展开大小。
- 网页笔记在主页和合集入口创建，刷新、重启后仍可从笔记及合集打开；实际定位正文、复制、改名、固定、来源操作和删除通过。
- 三语及当前桌面尺寸验证正文和现有操作；默认采用DOM/AX/数值与实际输入，视觉功能另遵守 `RULES.md`。
- 网页保存不运行ASR、不下载ASR模型、不产生自动标题费用。网页工作间沿用真实确认和额度，保存失败不进入生成，已有智能产物不会被失败的新尝试覆盖。
- 在完全没有web_engine的独立库中，schema4历史/正文读取、总结/灵感/解剖/草稿确认、权威正文读取和worker AI入口仍可用；共享模块不得因缺少组件而导入失败。
- 当前安全schema3媒体的URL/本地导入、播放、修改、自动标题、总结/灵感/解剖/草稿、取消和迁移回归通过。

真实供应商测试和公开发行资产发布分别在内容、额度及产物具体可审查后取得相应授权。缺少平台、额度或网络设施时明确记录未完成门禁，不能以mock结果替代。

### 本轮实际验收记录（2026-11-02）

下表区分实际执行、源码/契约检查及尚未执行的场景。上文实现项的勾选不表示未提供平台或设施的验收已通过。
日志和中间资料位于忽略的 `build/`，不进入发行包或 git。

| 范围 | 证据 | 本轮状态 |
| --- | --- | --- |
| Worker 完整回归 | `build/web-python-final-2.log`：1251 passed / 4 skipped；ruff 通过 | 通过；4项跳过保留原状态 |
| 前端完整回归 | `build/web-frontend-final-admission.log`：129 files / 1442 passed / 1 skipped；`build/web-final-lint.log`通过；前端build通过 | 通过；1项保留原有跳过，build保留既有大 chunk 提示 |
| Rust 完整回归 | `build/web-rust-final-owner-confirmed.log`：504 passed / 23 ignored，串行247.73s；`build/web-watchdog-final-serial.log`：watchdog 13 passed；以允许终止测试自有进程树的权限执行 | 通过；专门真实用例另外执行，未执行的 ignored 不自动算通过 |
| 脚本与文档 | `build/web-scripts-last.log`：Node 53 passed；`build/web-python-scripts-last.log`：Python脚本1 passed；文档 ERROR/WARN 各0错误/0警告，`git diff --check -- docs`通过 | 通过 |
| 正式 CLI 跨语言来源 | 四种网页 AI retry 的真实文件/正式CLI结果经 Rust `validate_source_task`、history投影及 TS parser；无网页引擎、无供应商配置 | 通过；不代表真实供应商生成质量 |
| 静态与 JavaScript 网页 | `build/web-native-composition.log`：真实静态页及 quotes JavaScript 正文、TXT/Markdown发布、安全来源及history重开，38.62s | Windows通过 |
| 网页保存边界 | 上述组合确认不运行ASR、不写付费标题；每次提交独立task；正式TXT/Markdown与结果逐字核验 | Windows通过 |
| 普通取消与后续任务 | `build/web-native-cancel.log`：匹配operation/window取消、整条lane释放及随后任务，14.21s | Windows通过 |
| 引擎准入早期取消 | `build/web-native-early-cancel.log`：真实claim及引擎读取阶段取消，没有启动worker，16.66s；prepare核心取消/窗口/stale ID测试通过 | Windows通过；实际IPC场景见下项 |
| Pending与真实IPC/SDK | `build/web-ipc-admission-check.log`及`build/web-final-native-ipc-result.json`：网页12次/组件6次即时取消、Pending取消后延迟提交、未登记提交、额外字段/更改URL拒绝、两种真实SDK listener Abort、引擎Ready | Windows通过；取消未新增任务，操作终态后再次取消返回not_running/false |
| 最终SDK网页保存 | `build/web-final-native-ipc-result.json`及日志：真实Example Domain正文TXT 1317 bytes、Markdown 1424 bytes，正式重开与SDK结果逐字相同，历史2→3 | Windows通过；网页来源、空transcript及article产物，不运行ASR |
| 加载中关闭与重开 | `build/web-final-close-acceptance.md`、`build/web-final-close-before.json`、`build/web-final-reopen-result.json`：实际HTTP加载中与未认领组件Pending同时正常Alt+F4退出，操作缓存和相关浏览器/Node/Python进程均为0；重开资料库/引擎Ready、历史3、原正文保持、旧操作均不存在 | Windows通过；重新打开的实际侧栏可见新网页笔记，隔离应用正常关闭 |
| Worker崩溃及继承管道 | 真实Python root崩溃、零退出无协议及匹配取消3项；终态清理真实继承stdout/stderr的后代 | Windows通过 |
| 收据和安全删除 | `build/web-owner-hardlink-after.log`：9 passed；实际owner hard-kill、应用硬链接存活保留/退出恢复、spawn未登记恢复、同UUID新实例保留、伪造成员拒绝、目录交换、junction、只读硬链接及文件锁保留/重试 | Windows通过 |
| 资源采样 | `build/web-engine-memory.log`：5个owned进程含renderer，实际RSS均非零，原生API与独立数值核验一致，总数175,677,440 bytes | Windows读取通过；实际2GiB越限注入未执行 |
| 引擎实际归档 | `build/web-engine-acceptance.log`及后续恢复记录：实际hash、解包/inventory、离线CDP、取消、链接/缺文件/篡改、探针失败保留与恢复 | Windows通过；线上发行下载未执行 |
| 笔记跨根迁移 | `build/web-note-migration.log`：原始CRLF/Unicode正文、Markdown、名称、固定、合集及既有产物重开，6.43s | Windows通过 |
| 引擎跨根迁移 | `build/web-engine-migration.log`：保留来源副本，新根inventory和离线CDP重探，127.20s | Windows通过 |
| 代理与公网页安全 | 实际16条公网CONNECT持续占用、第17条拒绝、释放恢复与stop关闭；真实公网页的loopback fetch/WS canary零连接，file/asset不可读，Tauri对象缺失，弹窗/下载/SW注册受阻 | Windows分项通过 |
| 认证与重定向 | 正式loader实际RFC9110、quotes JS、401、Basic认证挑战及7次HTTP重定向；受限/超限返回闭合错误 | Windows分项通过 |
| 三语原生正文与信息 | `build/web-native-ui-acceptance.md`、`build/web-ui-acceptance-evidence.json`：实际三语1180×760/720×640，正文14px独立滚动，无横向溢出/远程图片/媒体；NoteInfo标题16px按钮14px且面板在视口内 | Windows通过；尺寸来自实际WebView的CDP viewport，未调整原生外框 |
| 原生菜单与本地操作 | 三语原尺寸菜单7项14px左对齐；简体720×640菜单bottom631.991；实际Copy article反馈成功，定位正文打开独属Explorer；恢复zh-CN和原视口并正常关闭隔离应用 | Windows分项通过；剪贴板正文、Explorer实际选中、繁体/英文窄菜单及本轮合集GUI成员变更未验 |
| 正式构建与启动 | `build/web-production-final-owner-build.log`：默认产品标识release无安装器构建5m48s；`build/web-ui-final-owner-build.log`：隔离debug构建1m37s；`build/web-production-startup.md`：实际正式窗口显示主页和网页输入，无恢复/处理状态 | Windows通过；未构建安装器或发布资产 |
| 真实AI供应商及额度 | 用户2026-11-02明确选择「本次跳过付费验收」 | 本轮不执行；未调用、未扣费 |
| macOS运行与实包 | 两个macOS组件、CDP/代理、进程恢复、安全删除、迁移及界面 | 未提供对应本机环境，未验证 |
| 其他专项真实限制 | Negotiate具体scheme、OOPIF、公开WebSocket目标、受控DNS变更；完整非HTML/CAPTCHA/持续变化DOM/执行停滞、空间不足及全部超限注入 | 未完成完整矩阵；已有代码/契约覆盖不代替真实设施验收 |
| 公开分发 | Windows组件已本机构建；macOS实包及实际GitHub发行asset下载/安装 | 本轮未发布；公开分发前继续发行门禁 |

## Outcomes & Retrospective

用户于2026-11-02选择「本次跳过付费验收」。本轮不调用真实供应商，不消耗账号额度；
四种AI入口仍以真实文件、正式CLI、跨语言来源核验和既有确认界面测试验证。

来源契约、网页加载、引擎组件、正文视图及现有工作间接入的本地实现已完成。
本轮完整回归：Python 1251 passed / 4 skipped、前端1442 passed / 1 skipped、Rust 504 passed / 23 ignored；
所有权9项、watchdog串行13项、真实保存/取消/迁移和脚本门禁的具体范围见上表。
Windows x64 真实网页引擎已构建，归档 163,109,963 bytes，完整展开 402,464,046 bytes；
Python/Node/浏览器版本、真实安装恢复、离线启动和跨根重探通过。
实际Tauri SDK保存、18次即时取消、两种listener Abort、加载中正常关闭及重开通过；操作缓存和相关进程清理完成，已有正文和历史保持。
三语正文与笔记信息两尺寸验收、菜单左对齐、默认正式程序构建及实际启动通过；本地实现归档至 completed。
Residual risk: macOS、实际发行下载、受控DNS及完整专项限制矩阵未验证；GUI未验范围见上表；真实供应商按用户选择跳过。
公开分发门禁保留在 `docs/exec-plans/tech-debt-tracker.md`；本轮未提交、推送或发布。
