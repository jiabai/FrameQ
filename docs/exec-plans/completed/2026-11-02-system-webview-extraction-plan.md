# 系统 WebView 网页正文提取 Plan

状态：实现与 Windows 本地验收完成；macOS helper 编译、ad-hoc 签名、bundle 身份与 entitlement 回读已由托管 macOS CI 覆盖，最终 Mac app/DMG 内 helper 回读已接入两个 macOS 发布 job。Sandbox 实测、实际页面/取消行为、专项 canary 与扩展交互矩阵保留为发行门禁，见「未勾选项目逐项处置」与技术债记录。

## Purpose / Big Picture

使用独立的系统 WebView 加载网页、执行必要页面脚本、提取正文并保存为已有本地笔记。
取消网页功能的 Chromium/Playwright 组件下载及准备页面，保持 Home、侧栏、正文阅读、合集和现有智能提炼范围。

规格：[网页正文](../../product-specs/2026-11-01-web-page-notes.md)。
技术设计：[系统 WebView](../../design-docs/2026-11-02-system-webview-extraction.md)。
依据：[平台能力核查](../../references/2026-11-02-system-webview-capabilities.md)。
执行使用 `subagent-driven-development` 或 `executing-plans`，按项目 main 工作流实施。

## Progress

- [x] 2026-11-02：收到用户明确约束「要复用系统 WebView，不要额外下载 Chromium」。
- [x] 2026-11-02：核查当前网页、正文保存、取消、迁移、打包和依赖实现。
- [x] 2026-11-02：分别核查 Microsoft、Apple、WebKit 的公开 API、进程模型及网络边界。
- [x] 2026-11-02：确定普通原生网页读取、独立容器与原有笔记保存的设计，不增加系统网络过滤扩展。
- [x] 2026-11-02：完成 Windows/macOS 两组只读技术复核，明确 HTTPS 系统信任处理、原生网络语义和平台清理范围。
- [x] 2026-11-02：计划准备阶段文档治理 ERROR/WARN 均0错误0警告，文档 diff 检查通过。
- [x] 2026-11-02：用户确认本执行计划。原文：「好，让主线程按照这份执行计划继续工作吧」。视频下载器讨论未增加新获取路径或下载器改造要求。
- [x] 2026-11-02：Windows隔离桌面程序实际SDK保存、12次即时取消、Pending迟到请求、listener Abort、加载中关闭、重开及旧笔记阅读验收通过；两尺寸正文14px且无横向溢出。
- [x] 2026-11-02：完成 Windows 原生 COM 宿主、macOS 原生宿主源码与打包检查、版本2正文保存及旧组件退役；旧迁移字段与所有权恢复保留。
- [x] 2026-11-02：Windows WebView2 156.0.4314.58 真实静态与 JavaScript 页面提取、正式笔记保存、历史重开、加载取消后再次保存及独占 UDF 清理通过。
- [x] 2026-11-02：最终源码完成后，真实会话恢复5项、保存及取消流程2项、原生父级1项通过；Windows helper单元9项和真实Runtime5项通过。
- [x] 2026-11-02：完成Windows真实网页、取消、关闭、恢复、默认release no-bundle构建及启动；同步最终文档。下列尚未勾选项属于保留的发行前平台及专项验收。
- [x] 2026-11-03：托管 macOS CI（Native ProcessSupervisor run 41646010131 / job 125951408012）实际编译 macos-arm64 helper .app、ad-hoc 签名并通过 verifyMacHelper 与 Swift 协议测试；逐项复核未勾选项目并更新台账。

## Decision Log

- 用户方向：复用 Windows WebView2 / macOS WKWebView；不额外下载 Chromium。
- 远程页面使用独立原生 helper，主 Tauri WebView 仅承担既有界面，不承载远程页面。
- Windows 使用原生 COM 和系统网络；macOS 使用原生 WebKit、独立 Sandbox、内存 data store 及公开代理 API。
- 保留系统浏览器的 Cookie、CORS、重定向和动态资源行为，不实现自定义 HTTP/Cookie 浏览器网络层。
- 正文由当前 Python TaskStore 原子发布；Python 仅接收版本2保存请求，不加载网页或导入 Playwright。
- 完整私网拦截、全部传输统一配额和全部系统进程精确回收不作为系统 WebView 方案保证；实际可控范围见设计表。
- 旧组件默认保留在磁盘，停止执行、探针和下载；旧迁移控制及所有权恢复仍兼容。
- 系统 Runtime 的 GPU/Utility 失败按原生恢复语义处理；浏览器、主/子 renderer 失败及 renderer 无响应使本次 Document 失效。诊断只记录原生数字枚举与退出码。
- Windows 真实证据属于本次系统宿主；macOS helper 编译与 ad-hoc 签名已由托管 CI 覆盖，最终签名 app/DMG 内回读、Sandbox、实际运行及尚未执行的系统宿主 canary 独立保留发行门禁。

## Surprises & Discoveries

- wry 0.55.1 的 Windows 实现即使未设置业务 IPC handler 也安装页面消息代码，宿主直接使用原生 API。
- 不同 WebView2 UDF 才建立独立 browser process group；系统 Runtime 可合法使用硬链接。
- macOS 的新 process pool 不能单独建立隔离边界；独立 helper 的 Sandbox 和 data store 是实际边界。
- 公开 WKWebView API 不能完整约束 WebRTC、列举所有系统进程或落实全部 WebKit 进程的总 RSS 上限。
- 现有 worker stdin 上限 1 MiB 小于正文与 Markdown 的允许总量，保存交接需要操作专属编码上限。
- 迁移 baseline schema 1 含可选 `readyWebEngine`，取消旧引擎时仍需读取已准备的迁移控制文件。

## Tasks

### Task 1：封闭宿主与保存协议

Files：新增 `contracts/system-webview-host-v1.json`、`contracts/web-page-save-request-v2.json`；
修改 `app/src-tauri/src/worker_runtime/command.rs`、`facade.rs`、
`result_protocol.rs`、Python `web_page_contract.py` / `desktop_contract.py` / `cli.py`。

- [x] 定义独立 helper 的 init、ready、start、stage、article、error、policy_check/policy_decision、cancel/closed 消息；每个消息带 operation/session，页面结果带 navigation generation；字段闭集校验。
- [x] init 仅传递当前 URL、已验证提取脚本与必要平台参数；Windows 额外获得本次 UDF 路径，Mac 额外获得本次代理地址，不传递账号配置、任务目录、输出根或主应用权限。
- [x] 父进程与 helper 使用专用 stdin/stdout 管道，原始 URL 仅在内存/管道中存在；诊断不记录原始 URL 或正文。
- [x] 私有保存请求采用版本 2：`contract_version, operation_id, task_id, article`；article 为 `title, sourceUrl, text, markdown`。
- [x] Rust 预分配合法、唯一的新网页 task ID 并写入操作收据，Python 不从网页接受路径，也不覆盖同名已有任务。
- [x] 网页相关编码消息和 stdout 各最多 40 MiB，字段保持 TXT 2 MiB / Markdown 4 MiB；其他 worker 请求保持原限额。
- [x] 新 worker CLI 为 `--save-web-page-stdin`；保留当前 webpage 终态契约、schema 4 和阶段名称，旧私有加载请求契约退役。
- [x] 用实际JSON/文件与正式CLI验证未知字段、版本、超限、转义扩张、非法task ID、错session和缺字段；完整worker/Rust及helper测试通过。

### Task 2：独立原生宿主与打包

Files：新增 `app/native-webview-host/windows/Cargo.toml` 与 `src/{main,environment,policy,extraction,lifecycle}.rs`，
`app/native-webview-host/macos/{Main,WebPageHost,PolicyDelegate,Extraction}.swift`、`Info.plist`、`entitlements.plist`；
新增 `scripts/build-system-webview-host.mjs`；修改 `scripts/build-installer.mjs`、`app/package.json`、
`app/src-tauri/tauri.conf.json`、`.gitignore`、`.github/workflows/desktop-release.yml`、
`macos-intel-acceptance.yml` 和 `unix-process-supervisor.yml`。

- [x] Windows helper 直接依赖已核查版本的 WebView2 COM bindings，使用 STA 与独立消息循环，不初始化 Tauri。
- [x] macOS helper 源码和构建脚本设置独立 `.app`、专用 bundle identifier、App Sandbox entitlement 和最小权限；不继承主应用 Sandbox。
- [x] 在 macOS 上实际编译独立 helper `.app` 并验证产物。2026-11-03 托管 macOS CI 已执行 swiftc 编译、ad-hoc codesign 与 verifyMacHelper（架构、Info.plist 的 identifier/executable/LSMinimumSystemVersion、codesign --verify --deep --strict、entitlements 白名单）；产物 356896 字节，SHA-256 a6618bd39dd53653cf8d0789046617e390d57de76b5e407309b547cd59b7a752。证据：run 41646010131 / job 125951408012。
- [x] 保留现有提取 bundle 构建和许可证；父进程读取并核验 bundle 后，通过有界管道向 helper 提供固定脚本。
- [x] Windows helper 已实际编译为随应用交付的小型程序，不附带浏览器、Node driver 或 Playwright wheel。
- [x] 构建和资源复制顺序执行；Windows/macOS helper 的真实产物缺失或平台不符时构建失败。
- [ ] 对最终 Mac app/dmg 中的 helper 回读代码签名、identifier 和 entitlement，防止后续签名覆盖隔离设置。
- [x] 原生资源定位仅接受随包的 helper；保存绝对路径、文件身份与实际版本，阻止替换及错误目标执行。

### Task 3：Windows WebView2 加载与提取

Files：Windows helper 的 environment、policy、extraction、lifecycle 模块；
`app/src-tauri/src/web_page.rs` 与新的宿主管理模块。

- [x] 检测系统 Stable Runtime 及所需接口；缺失/过旧/不安全覆盖返回明确错误，不下载或安装网页引擎。
- [x] 创建本次操作独占 UDF、Environment、InPrivate Controller 和非零 viewport，核验实际 UDF 身份。
- [x] 在导航前关闭页面消息、原生对象、SSO、autofill/password、开发工具和默认 UI，安装权限/认证/证书/下载/外部 URI/窗口拒绝。
- [x] NavigationStarting 同步检查 URI 与导航次数；`_22` HTTP 资源事件通过有界 policy_check 执行 Rust 公网 DNS 检查，最多16在途、100请求、每次2秒。取得 deferral 后立即返回 STA；拒绝/超时/取消先设置阻断 response 再 Complete，线程不阻塞等待网络或 COM 回调。
- [x] 拒绝非 HTTP(S) 导航及可观察危险资源；阻止非正文必需的媒体/图片/字体；只声明实际覆盖的请求范围。
- [x] 使用系统原生 Cookie/CORS/网络行为，不依赖 browser flags 兑现私网、代理或 WebRTC 权限保证。
- [x] 原生 CDP 创建当前主 frame 的隔离 world，固定提取代码使用 `awaitPromise/returnByValue`，不开放调试端口。
- [x] 主导航、context 销毁、renderer 失败及 extraction exception 使旧结果失效；真实动态 Document 稳定后才返回正文。
- [ ] 实测 Runtime 版本、静态页、JS 生成正文、跨源资源、临时 Cookie、重定向、frame/worker、权限与失败行为；记录未覆盖网络路径。

### Task 4：macOS WKWebView 加载与提取

Files：Mac helper 的 application、configuration、delegates、extraction 与 shutdown 模块；
现有 `app/src-tauri/src/web_page/network.rs`。

- [x] 源码检查 macOS 14+ 和公开 API；创建独立 configuration/content controller/nonPersistent data store。
- [x] load 前设置单一任务 HTTP CONNECT proxy，关闭 failover；代理保留公网实际地址验证、16 并发、100 代理请求和 64 MiB 可见流量上限。
- [x] 源码通过原生 delegates 拒绝危险导航、上传、新窗口、下载、相机/麦克风和脚本对话框；HTTP/代理登录与客户端证书取消，ServerTrust 使用系统 performDefaultHandling 并拒绝无效证书/降级TLS。
- [ ] 对最终签名 helper 实测原生拒绝行为与主应用权限隔离。
- [x] 以 WKContentWorld/callAsyncJavaScript 执行固定提取代码并绑定当前主导航 generation；不调用页面函数，不将隔离 world 视为网络防火墙。
- [x] Native 最终 URL 规范化后交给 Rust；受限页面、非 HTML、无正文、超限及超时返回闭集错误。
- [ ] 实测静态/JS正文、HTTP/HTTPS CONNECT、重定向、Cookie、权限、WebRTC/WS 行为和取消；清楚区分代理覆盖与系统原生路径。
- [ ] 实测 helper Sandbox 无法读取主应用哨兵配置、账号材料或用户文件；测试仅用隔离 canary，不读真实凭据。
- [x] 编译与 ad-hoc 签名已由托管 macOS CI 覆盖；最终签名 app/DMG 内回读、Sandbox 文件/账号隔离与真实页面/取消运行仍保留发行门禁。

### Task 5：所有权、期限、取消与关闭

Files：`app/src-tauri/src/web_page.rs`、`web_page/{host_protocol,session}.rs`、`worker_runtime/native_webview_host.rs`、`web_page/ownership.rs` 及子模块；
`worker_runtime/web_process_tree.rs`、`data_storage.rs`。

- [x] 保留 `begin_web_page` null ACK 和 Pending/Claim 语义；已取消 Pending 的延迟长请求不得启动宿主。
- [x] 启动宿主前持有数据许可与任务许可；本次操作保存 session/generation/host 身份及预分配 task ID。
- [x] 实现全操作固定90秒工作期限、准备15秒/导航60秒/提取回调2秒及共享独立15秒清理预算；截止时间不被延长的回归与真实取消、恢复通过。
- [x] 取消先使 session/generation 失效，拒绝晚到结果，再停止加载、关闭代理和容器，等待自有宿主与保存 worker 退出。
- [x] Windows 使用 Close/BrowserProcessExited、原生进程身份与 Job 核验可归属成员；系统 Runtime 允许合法硬链接但不允许任意路径替换。
- [x] Mac 终止并等待自有 helper；系统 WebKit XPC 的全部 PID、总 RSS 和即时回收不作为公开 API 保证。
- [x] 可确认归属的进程采用2 GiB RSS门限；Mac 该数值仅覆盖自有 helper/保存 worker，不包含不可枚举的系统 WebKit 服务。
- [x] 新宿主缓存使用新目录和 schema；保留旧收据恢复。未知、替换或无法清理的自有资料保持恢复状态，不按目录名称删除。
- [x] 关闭/退出/重启继续使用现有准入屏障，等待尚未取得数据许可的 Claim 及真实清理完成。
- [ ] 用真实宿主/worker验证 Pending 取消、即时取消、导航与提取中取消、无限循环 JS、崩溃、窗口关闭、重开与下一任务。

### Task 6：正文交接与原子保存

Files：`worker/frameq_worker/web_page_storage.py`、`web_page_contract.py`、`task_store.py`、`cli.py`、
`worker_service.py`；Rust `worker_runtime` 和 task manifest 校验入口。

- [x] 正式 CLI 只读取版本2正文保存请求，删除 Playwright/browser_endpoint/proxy 参数及网页组件环境变量。
- [x] Python 重新校验规范来源、字段类型、大小与预分配 task ID，继续通过 `commit_task_artifacts()` 发布 article TXT/Markdown 和 schema4 manifest。
- [x] 保持原始 UTF-8、CRLF/Unicode、标题/来源/时间、SourceText hash、现有 AI 与媒体来源分支。
- [x] 发布后 stdout 前中断时，用操作收据中的 task ID/预期正文 hash 精确恢复；合法已发布任务报告真实完成，未发布目录不进入历史。
- [x] 使用正式bundled Python CLI、真实大正文、实际stdout管道背压和终止后恢复测试；最终5项NativeSession回归通过。
- [x] 重试、读取、删除和迁移继续以正式文件为权威，不依赖当前系统 WebView 是否可用。

### Task 7：移除组件准备及兼容旧资料

Files：`web_engine.rs` / `web_engine/`、`features/articles/useWebEngine.tsx`、`App.tsx`、
`useTaskProcessingController.ts`、`webPageClient.ts`、`webPageProtocol.ts`、三语资源；
`data_storage_validation.rs`、`build-installer.mjs`、组件脚本/契约/发行 workflow。

- [x] 删除网页组件状态查询、begin/prepare/cancel 命令、确认弹窗、下载/展开空间说明、进度、busy 合并与对应前端代码。
- [x] 网页提交在现有加载阶段直接检测系统环境；只保留适用的缺失/不支持/加载/提取/保存/取消错误文案。
- [x] 删除 Chromium/Playwright 构建、版本清单、归档、上传与 `resources/web-engine` 打包配置及专用测试；保留正文提取 bundle。
- [x] 不自动删除已安装旧组件、归档或缓存；不再启动或修复它们。
- [x] 迁移仍接受旧 schema1 baseline 的可选 `readyWebEngine`，停止其启动探针，同时保留旧 runtime 库存/哈希/复制核验。
- [ ] 回归已准备、复制中、切换中和重启后的旧迁移控制；不会因删除反序列化字段而损坏恢复。
- [x] 真实默认程序和隔离资料程序启动、主页、旧笔记打开均无网页组件准备提示；生产下载入口与构建上传路径已移除。

### Task 8：回归与真实平台验收

- [x] 前端完整1441通过/1跳过，随后Unicode标题focused7通过/1跳过；lint通过，最终Tauri构建内执行完整npm build、tsc/Vite与helper构建。
- [x] `uv run ruff check worker`、`uv run pytest worker/tests`：1266通过、4跳过，1项 pydub/audioop 弃用警告；日志见验收表。
- [x] Rust库完整507通过/21忽略；最终NativeSession5项、网页流程2项、原生父级1项另行执行通过。Windows helper完整普通9项及真实Runtime5项通过。
- [x] `node --test scripts/tests/*.test.mjs`：54通过；`uv run python -m pytest scripts/tests`：1通过、0警告，使用工作区缓存。
- [x] Windows helper实际构建与运行，静态/动态正文、保存、错误、取消、关闭及重开通过；macOS实际验证保留于Task 4。
- [ ] 使用真实本地 canary 检测 IPC、文件、账号、私网、WS/RTC 与权限路径，记录系统能力；不把未拦截路径标成通过。
- [ ] 三语/两尺寸的正文及现有操作、网页/媒体笔记、合集、名称/固定、迁移与 AI 确认回归；默认 DOM/AX/数值，不主动使用视觉功能。
- [x] `npm --prefix app run tauri -- build --no-bundle`成功，4分27秒；启动默认release程序，AX确认主页及输入区域可用，无组件准备提示或对话框。
- [x] 付费 AI 本轮继续跳过，未启用真实供应商测试；需要时另行取得内容及额度授权。

### Task 9：文档与完成记录

- [x] 替换 `ARCHITECTURE.md`、`SECURITY.md`、`DESIGN.md` 当前网页实现描述，按实际平台能力填写，保留来源依据。
- [x] 更新网页/数据存储规格、设计和索引，记录最终Windows测试、桌面构建与平台发行门禁。
- [x] 最终归档后运行 `uv run python scripts/validate_agents_docs.py --level ERROR` 与 `--level WARN`，均0错误0警告；`git diff --check`通过。
- [x] Progress/Decision Log/验收表记录实际结果、Runtime及未验证范围；完成本地范围后归档，未发布旧浏览器组件。

## Validation and Acceptance

核心验收：系统 WebView 实际加载网页并保存真实正文；主界面、账号、文件权限分离；没有额外 Chromium 下载及准备 UI。
保存、阅读、历史、合集及现有智能提炼保护保持现有契约。取消和关闭拒绝晚到结果，并完成本应用拥有的资源清理。

平台网络/系统进程的限制使用设计中的真实范围；不沿用独立 Chromium 实测作为新方案通过证据。
新宿主需要自己的 Windows 与 Mac 证据。缺少平台、签名或网络设施时明确标记未验证，保留对应发行门禁。

### 已执行的本机证据

本表记录本次系统宿主的实际结果。最终协议与清理期限修改后的原生测试已执行；
忽略项使用明确的 `--ignored` 命令单独运行。默认release产物实际启动，未执行安装包发布。

| 范围 | 实际结果 | 证据 |
| --- | --- | --- |
| 系统宿主真实 Runtime/页面 | Windows x64、WebView2 156.0.4314.58；ready/cancel、静态与 JavaScript 正文、未回复资源策略超时均通过 | `.tmp/system-webview-native-acceptance.log`：6项单元、1项原生生命周期、3项公开页面/策略测试 |
| 正式网页笔记全过程 | 实际静态及 JavaScript 页面保存、正式 TXT/Markdown、schema4、历史重开和自有缓存释放通过；1项测试，34.20秒 | `build/system-webview-full-save.log`；隔离库 `build/system-webview-acceptance/ccebd55f-4fa0-4f6f-9ee7-0841ad6fb9a2/` |
| 加载中取消与下一任务 | 实际取消、lane释放、独占目录清理后，另一个 JavaScript 页面成功保存；1项测试，11.85秒 | `build/system-webview-host/windows-x64/final-cancel-save-acceptance.log` |
| Windows 失败分类 | 浏览器/renderer失败使Document失效，GPU/Utility使用系统恢复语义；实际枚举分类测试通过 | `build/system-webview-host/windows-x64/final-process-classification.log` |
| Worker 完整回归 | Ruff通过；pytest 1266通过、4跳过、1项 pydub/audioop 弃用警告；391.33秒 | `build/system-webview-final/worker-ruff.log`、`build/system-webview-final/worker-pytest.log` |
| Rust 库回归 | 串行 `--lib`：507通过、21忽略，194.54秒；原生忽略项另行验证 | `build/system-webview-rust-final.log` |
| 最终原生会话恢复 | 真实helper身份、正式worker发布后stdout中断、进程退出后收据恢复、替换拒绝、期限后清理重试：5通过，20.09秒 | `build/system-webview-final/native-session.log` |
| 最终保存与取消流程 | 静态/JavaScript正文保存、历史重开和取消后下一任务：2通过，41.82秒；最终预分配task ID及共享清理期限接线已包含 | `build/system-webview-final/native-pipeline.log` |
| 最终原生父级 | 正式父级实际提取1123字节正文并回收自有进程：1通过，6.21秒 | `build/system-webview-final/native-parent.log` |
| 最终Windows helper | 单元9通过；实际Stable Runtime准备取消、ready取消、静态/动态正文和未回复资源策略超时共5通过 | `build/system-webview-final/windows-helper-unit.log`、`build/system-webview-final/windows-helper-native.log` |
| Node 脚本 | 54通过，0失败 | `build/system-webview-scripts-final.log` |
| Python 脚本 | 1通过、0警告，使用工作区缓存 | `build/system-webview-python-scripts-final.log` |
| 前端完整回归 | 129文件，1441通过、1跳过；随后Unicode标题修改另行执行真实DOM回归 | `build/system-webview-frontend-final.log` |
| Unicode标题 | 含Cf字符的真实DOM标题回归已观察失败后通过；修改后7通过、1跳过 | `build/system-webview-unicode-red.log`、`build/system-webview-unicode-green.log` |
| 前端静态检查 | TypeScript与i18n字面量检查通过 | `build/system-webview-lint-final.log` |
| Windows调试桌面构建 | 完整Tauri debug no-bundle成功，单任务编译1分55秒；宿主965632字节，SHA-256 `22389d6607773d0d210d394ca59da20469ceb29a88b31c943408ffb3de3b673d` | `build/system-webview-debug-build-final.log` |
| 真实桌面SDK与取消 | 真实Tauri内执行正式SDK/IPC：null ACK、Pending取消、12次即时取消、listener Abort及动态网页保存/历史一致通过 | `build/system-webview-ui-ipc-final.log` |
| 关闭与重新启动 | 真实web_loading期间Alt+F4关闭，重开后资料ready、历史4项、正文1123字节/Markdown1202字节一致、原操作not_running；宿主进程和操作缓存均0 | `build/system-webview-ui-close-start.log`、`build/system-webview-ui-reopen-final.log`、`build/system-webview-ui-cleanup-final.json` |
| 旧笔记与两尺寸阅读 | 键盘打开旧版保存笔记；1180×760和720×640的实际DOM正文14px、无横向溢出/远程图片/媒体节点；主页无组件准备提示 | `build/system-webview-ui-old-note.log`、`build/system-webview-ui-acceptance-final.md` |
| 文档治理 | 最终归档后ERROR/WARN均0错误0警告，diff格式检查通过 | `build/system-webview-docs-error-final.log`、`build/system-webview-docs-warn-final.log`、`build/system-webview-diff-final.log` |
| 默认release桌面构建及启动 | 完整Tauri release no-bundle成功，4分27秒；965632字节helper随资源交付；真实默认窗口FrameQ（13305036）主页与输入存在，无准备提示及对话框 | `build/system-webview-release-build-final.log`；@oai/sky实际AX结果 |

### 未勾选项目逐项处置（2026-11-03）

计划中未勾选的 10 项按下表处理。托管 macOS CI 指 `Native ProcessSupervisor` run `41646010131`（job `125951408012`），该 run 在 push `afc9447` 后两个 job 均 success。

| 位置 | 项目 | 处置 | 证据 / 剩余条件 |
| --- | --- | --- | --- |
| Task 2 / 78 | macOS 编译独立 helper `.app` 并验证产物 | 已闭环 | macOS CI 实际 swiftc 编译、ad-hoc codesign、`verifyMacHelper` 回读架构/Info.plist/签名/entitlements；产物 356896 字节；`--test-protocol` Swift 协议测试通过 |
| Task 2 / 82 | 最终 Mac app/DMG 内 helper 回读签名、identifier、entitlement | 已接入发版流程 | `scripts/make-macos-dmg.sh` 第 35 行 `--verify-bundle`、第 63 行 `--verify-dmg` 均带 `--target "${NATIVE_TARGET}"`；`desktop-release.yml` 两个 macOS 发布 job（第 173、243 行）都调用该脚本，`scripts/tests/desktop-release-workflow.test.mjs` 锁定该调用链。剩余条件：首次真实发版 run 执行并回读结果 |
| Task 3 / 98 | Runtime 版本、静态/JS 正文、跨源资源、Cookie、重定向、frame/worker、权限与失败行为 | 部分覆盖 | Runtime 156.0.4314.58、静态/JavaScript 正文、失败分类见上表；跨源资源、临时 Cookie、重定向、frame/worker、权限专项 canary 未执行 |
| Task 4 / 108 | 最终签名 helper 原生拒绝与主应用权限隔离 | 发行门禁 | 需 macOS 实机与最终签名 helper |
| Task 4 / 111 | macOS 静态/JS 正文、HTTP/HTTPS CONNECT、重定向、Cookie、权限、WebRTC/WS、取消 | 发行门禁 | 需 macOS 实机运行；当前只有源码复核与协议测试 |
| Task 4 / 112 | helper Sandbox 无法读取主应用哨兵配置、账号、用户文件 | 发行门禁 | `verifyMacHelper` 只回读 entitlement 声明，未实测 Sandbox 行为 |
| Task 5 / 129 | Pending/即时/导航与提取中取消、无限循环 JS、崩溃、关闭/重开/下一任务 | 部分覆盖 | 12 次即时取消、Pending 迟到请求、加载中关闭、重开与下一任务见上表；无限循环 JS、renderer 崩溃、导航与提取中取消专项未执行 |
| Task 7 / 154 | 旧迁移控制各阶段与 `readyWebEngine` 退役字段 | 已由回归闭环 | `data_storage_validation.rs` 含 legacy `readyWebEngine` 读取/回写/拒绝非法值断言；Rust 全套在 run `41646010131` 通过（Windows 555、macOS 531） |
| Task 8 / 164 | 真实本地 canary：IPC、文件、账号、私网、WS/RTC、权限路径 | 未执行 | 需真实宿主与本地 canary 设施；不得把未拦截路径标成通过 |
| Task 8 / 165 | 三语/两尺寸正文与现有操作交互矩阵 | 部分覆盖 | 中文两尺寸 DOM 阅读见上表；三语完整交互矩阵与网页/媒体笔记、合集、名称/固定、迁移、AI 确认组合未重新执行 |

结论：78 与 154 已闭环；82 的验证已接入两个 macOS 发布 job，待首次真实发版 run 执行；98、129、165 为部分覆盖且缺专项；108、111、112、164 依赖 macOS 实机或最终签名产物，本机无法完成，全部保留发行门禁，未标成通过。

### 发行前未验证范围

- 扩展的三语完整交互矩阵及旧迁移各阶段与本次组件退役的逐项组合尚未重新执行。当前Rust完整回归包含迁移与旧baseline字段读取/回写验证；实际桌面覆盖中文两尺寸阅读和上述保存、取消、关闭、重开流程。
- 系统宿主的 IPC/文件/账号、认证、权限、跨源 Cookie/frame/worker、私网、WebSocket/WebRTC、DNS变化等专项canary尚未全部执行；正文成功与旧独立Chromium结果均不覆盖这些项目。
- macOS helper 编译、ad-hoc 签名与构建产物的 identifier/entitlement 回读已由托管 macOS CI 覆盖；最终 Mac app/DMG 内 helper 回读已接入 `scripts/make-macos-dmg.sh` 并经两个发布 job 调用，但尚无真实发版 run 的执行证据；Sandbox 文件/账号 canary、代理及实际页面/取消/系统服务行为未验证，保留发行门禁。
- 付费AI按用户要求跳过。本地保存和既有来源契约回归不产生供应商验收结论。

## Outcomes & Retrospective

系统 WebView 原生宿主、版本2正文保存、组件准备流程退役和旧资料兼容已实现。
Windows真实页面、保存、重开、取消后下一任务、退出恢复与默认桌面构建及启动已通过；具体结果见表。
macOS helper 编译、签名与 entitlement 回读的缺失证据已由托管 macOS CI 补齐，最终 app/DMG 内 helper 回读已接入发版流程（待首次真实发版 run 执行）；Sandbox、实机运行及专项 canary 的缺失证据明确保留，未执行付费供应商调用。
