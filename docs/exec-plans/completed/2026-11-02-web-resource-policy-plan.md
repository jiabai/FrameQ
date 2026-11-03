# 网页资源策略修复执行计划

状态：Windows修复、真实保存/重开、回归及no-bundle构建完成。macOS源码和共享代理验证完成，原生平台验证保留发行门禁。

## Goal

正常访问允许的微信文章及大量合法资源页面，保留危险地址拒绝、取消、清理和验证页面限制。

## Approval

用户在旁支对话确认方案并要求主线程实施；2026-11-02交接消息提供具体要求与复现网址。沿用该授权实施，不重复请求确认。

## Design and tasks

- [x] Windows：移除累计100次失败；16个DNS检查并行，其余资源进入最多512个有界队列；排队10秒、检查2秒，队列容量不足报告WEB_RESOURCE_LIMIT。主文档拒绝终止，附属资源拒绝单独阻断。
- [x] Windows：提取前等待脚本、样式及文档的待检查请求结束，以及原生CDP正文相关下载完成；继续原生导航、DOM稳定、正文和访问限制校验；保留90秒任务、60秒导航、2GiB自有进程内存限额，增加64MiB已完成请求字节限额。
- [x] Rust宿主监督：允许递增请求ID超过100，校验在途上限，传播真实DNS失败原因，保留operation/session/generation及迟到结果保护。
- [x] 隐私诊断：仅持久化封闭原因/资源类型；限制日志数量与输入长度，拒绝额外字段。
- [x] macOS：取消代理累计100次失败，以有界连接排队背压控制；导航DNS拒绝仍终止主页面，附属资源独立失败；保留64MiB代理流量及生命周期约束。CONNECT连续5秒没有实际字节读写时释放名额，活动传输更新计时。
- [x] 测试：先运行真实微信页面复现，补充真实宿主资源拒绝、取消/清理回归；执行Rust、原生helper、脚本、前端和文档门禁。

## Progress

- 2026-11-02：读取规则、规格、设计和执行门禁；确认Windows同时存在资源累计与并发失败，Rust父进程也限制100个请求。已分配独立原生回归与macOS代理检查。
- 2026-11-02：修复前真实微信页面在3.3秒返回WEB_URL_BLOCKED；修复后实际236次检查、13,475字节正文及尾段通过。真实统计请求拒绝后，文章从首段到结束标记逐字符相同（仅忽略空白）。
- 2026-11-02：真实Rust操作所有者→WebView2→Python保存→历史重开通过；结果13,475字节，任务20261102-085142-web-aa03a658eed54a51，正文尾段与结束标记存在，缓存为空，worker已释放。测试资料位于被忽略的build/system-webview-acceptance下。
- 2026-11-02：完整Rust串行回归513项通过；最终代理源码重新编译后的6项真实网络测试通过。Windows no-bundle构建完成，输出app/src-tauri/target/release/app.exe。

## Decision Log

- 将资源数量限制转换为实际排队容量限制；资源请求累计数量只用于诊断。
- 公开系统接口不能提供Windows全部下载前的精确流量配额，继续明确能力边界，不宣称全网络隔绝。macOS保留代理可见字节限额。
- 验证页面不执行认证或CAPTCHA；真实环境拒绝访问时记录事实。
- 原生CDP记录的完成字节用于实际消耗保护；不能覆盖未完成、失败请求或未观察到的传输。macOS没有每个HTTPS正文请求的完成事件，保持明确的平台差异。

## Validation

- `cargo test --manifest-path app/src-tauri/Cargo.toml --lib -- --test-threads=1`：513 passed，0 failed，23 ignored；保留真实进程、原有超时及清理断言。
- Windows helper：18项单元测试、2项真实准备/取消测试、7项真实公开页面/策略测试通过；使用WebView2 156.0.4314.58。
- 微信实际保存与历史重开：1项通过，13,475字节，末段/结束标记存在，正文与Markdown重开一致，任务通道释放且缓存为空。
- 最终源码生成的app_lib测试程序直接执行`web_page::network --include-ignored --nocapture --test-threads=1`：6 passed，0 failed，包括真实公网16条隧道、第17条背压、空闲回收、停止释放及字节预算。旧实现的空闲容量用例先真实失败，再由修复通过。
- `npm --prefix app run lint`、`npm --prefix app run build`、`npm --prefix app run tauri -- build --no-bundle`通过；no-bundle输出为Windows本地程序，未发布安装包。构建仍有既有Rust弃用/未使用代码与前端chunk体积提示。
- Node脚本54项、Python脚本1项通过；Python缓存写入提示未影响测试。文档治理0错误/0警告。
- 运行环境记录：并行完整Rust运行的3项时间敏感用例在串行完整回归中全部通过；并行编译非测试目标曾出现rustc进程异常，最终代理测试程序及正式Windows构建均通过。旧FrameQ占用构建输出，正常关闭窗口后残留主进程经身份/无worker检查结束，随后构建成功。
- 未执行与残余风险：macOS Swift 编译、ad-hoc 签名与构建产物 entitlement 回读已由托管 macOS CI（run 41646010131）覆盖；最终签名 app/DMG 内回读已由 `scripts/make-macos-dmg.sh` 的 `--verify-bundle` / `--verify-dmg` 接入两个发布 job（待首次真实发版 run 执行），Sandbox 与 WKWebView 原生运行仍需 macOS 实机；共享代理真实网络测试已执行。CDP完成字节与代理均不覆盖全部系统网络路径，延迟加载/长期XHR继续受稳定性及整体期限限制。既有专项canary、其他系统环境及付费AI的发行门禁仍按系统WebView完成记录执行。
