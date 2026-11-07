# 2026-11-07 网页登录页错误码判定修复执行计划

状态：Windows 实现与本地门禁完成；macOS Swift 编译与原生验收待托管 CI。

## 目标

主页面响应 HTTP 200 且经过重定向落到登录或验证类页面时，在进入提取前返回 `WEB_PAGE_ACCESS_RESTRICTED`，避免等待 60 秒加载期限后报 `WEB_NAVIGATION_TIMEOUT`。

## 改动范围

| 文件 | 改动 |
| --- | --- |
| `app/native-webview-host/windows/src/policy.rs` | 新增 `ACCESS_RESTRICTED_PATHS` 13 条封闭集合与 `access_restricted_url`，取 URL 路径末段小写比对；新增单测 |
| `app/native-webview-host/windows/src/lifecycle.rs` | `main_response_failure(status)` 改为 `navigation_failure(status, navigations, main_url)`；2xx 且 `navigations > 1` 且末段命中时返回受限码；`:218` 调用处传入 `state.navigations` 与 `state.main_url`；新增单测 |
| `app/native-webview-host/macos/HostProtocol.swift` | 新增 `HostURLPolicy.accessRestrictedURL`，放在协议文件内，使 `--test-protocol` 编译链可直接覆盖 |
| `app/native-webview-host/macos/WebPageHost.swift` | 新增 `hasFollowedRedirect`，合并 `navigationGeneration > 1` 与 `redirectCount > 0` |
| `app/native-webview-host/macos/PolicyDelegate.swift` | `decidePolicyFor navigationResponse` 的 2xx 判定链加入受限页面分支 |
| `app/native-webview-host/macos/tests/ProtocolTests.swift` | 新增末段路径闭集、大小写与普通文章反例断言 |
| `app/src/workerErrorCopy.test.ts` | 新增 `WEB_PAGE_ACCESS_RESTRICTED` → `errors.web.restricted` 回归断言 |
| `docs/product-specs/2026-11-01-web-page-notes.md` | 补受限页面判定边界 |
| `app/src-tauri/resources/webview-host/manifest.json` | 构建产物，由 `scripts/build-system-webview-host.mjs:163-165` 自动重写 |

## 决策记录

- 判定只取最终网址路径末段与封闭集合比对，`/blog/how-to-login`、`?tag=login`、`/login/article` 不会命中。Date/Author: 2026-11-07 / WorkBuddy + User。
- 前置条件取「发生过导航」：Windows 用 `navigations > 1`（`lifecycle.rs:192` 每次 `NavigationStarting` 递增）；macOS 的 `didStart`（`WebPageHost.swift:285-295`）对同一 `WKNavigation` 的 HTTP 服务器重定向不递增 `navigationGeneration`，`didRedirect` 才递增 `redirectCount`，因此 `hasFollowedRedirect` 合并两个计数，覆盖 HTTP 重定向与 JS 跳转。Date/Author: 2026-11-07 / WorkBuddy + User。
- 判定点放在 `NavigationCompleted` 与 `decidePolicyFor navigationResponse`，命中后直接置错误并返回，不进入提取阶段。Date/Author: 2026-11-07 / WorkBuddy + User。
- Swift 纯函数放在 `HostProtocol.swift`：`scripts/build-system-webview-host.mjs:122-124` 的协议测试编译命令只包含 `HostProtocol.swift` 与 `ProtocolTests.swift`。Date/Author: 2026-11-07 / WorkBuddy + User。

## 验证记录

- `cargo test --manifest-path app/native-webview-host/windows/Cargo.toml --lib`：20 passed / 0 failed，含新增的 `access_restricted_url_matches_only_final_login_paths` 与 `successful_login_redirect_fails_before_extraction`。
- 同命令全量：20 passed、9 ignored（需要真实 Stable WebView2 Runtime 与公网）、0 failed。
- `npm --prefix app run build`（PowerShell 通道）：native host 重编成功，`windows-x64, 996352 bytes, SHA-256 17f84a5f5a67615e1e6b964fda1e14c5ad658607a03ec23bf10633ae8e7b9a47`；`verifySystemWebViewResources` 校验 manifest 通过；Vite 2617 modules、`built in 4.52s`。
- `app/src-tauri/resources/webview-host/manifest.json` 回读：`bytes` 996352、`sha256` 与新二进制一致。
- `npm --prefix app test`（PowerShell 通道）：136 个测试文件全部通过，1507 passed / 1 skipped。
- `node --test scripts/tests/*.test.mjs`：57 项全部通过。
- `uv run python scripts/validate_agents_docs.py --level ERROR`：0 错误、0 警告；`node scripts/verify-packaged-worker.mjs`：打包 worker 字节一致。

## 残余风险

- 本机没有 Swift 工具链，`HostURLPolicy`、`PolicyDelegate` 与 `ProtocolTests` 的编译和 `--test-protocol` 执行需要 macOS runner。
- 真实登录页端到端验收（确认由 60 秒超时变为即时受限文案）需要真实 WebView2 Runtime 与公网，本机 9 项集成测试处于 ignored 状态。
- 封闭路径集合需要随站点维护；集合之外的登录页、未产生第二次导航的登录页沿用既有超时行为。
- 前端命令需走 PowerShell 通道，Bash 工具通道的 Node 注入与沙箱文件权限会造成误报。
