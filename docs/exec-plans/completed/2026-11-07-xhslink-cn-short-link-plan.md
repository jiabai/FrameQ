# 2026-11-07 xhslink.cn 短链支持执行计划

## 目标

FrameQ 接受 `xhslink.cn` 与 `www.xhslink.cn` 分享短链，并解析 `https://xhslink.cn/o/5Sr07UUGn54`。解析流程沿用既有小红书短链路径，不新增下载、字幕、ASR 或 AI 行为。

## 改动范围

| 文件 | 改动 |
| --- | --- |
| `worker/frameq_worker/xiaohongshu/source.py` | `XHS_SHORT_HOSTS` 加入两个新 host。URL 提取、短链识别、host 白名单共用此集合 |
| `worker/frameq_worker/platform_source_resolvers.py` | `ShortLinkAdapter.hosts` 加入两个新 host，覆盖来源身份与 URL 缓存链路 |
| `worker/frameq_worker/media.py` | `XIAOHONGSHU_HOST_SUFFIXES` 加入 `xhslink.cn`，覆盖 yt-dlp 失败后的 fallback 分派与字幕探测 |
| `app/src/urlSupport.ts` | 新增 `XIAOHONGSHU_SHORT_HOSTS` 集合，`isXiaohongshuShortLink` 改为查表 |
| `app/src/features/results/processingWorkspaceModel.ts` | 处理页平台标识识别 `xhslink.cn` |
| `contracts/platform-url-support-contract.json` | 新增 `xiaohongshu-short-link-cn` 漂移检测用例，302 目标采用真实观测到的 `/discovery/item/{note_id}` 形态 |
| `app/src/workflow.test.ts`、`app/src/webPageProtocol.test.tsx` | 新增短链准入与仿冒域名拒绝断言，并确认 `classifyTaskUrl` 将新短链判为 `media` |
| `worker/tests/test_xiaohongshu_fallback.py` | 新增 302 `Location`、HTML 内嵌链接两条解析用例 |
| `worker/tests/test_media.py` | 新增新域名 fallback 分派与仿冒域名拒绝断言 |
| `worker/tests/test_source_resolution.py` | 新增新域名命中来源身份 adapter 的用例 |
| `README.md`、`docs/product-specs/2026-06-16-douyin-video-transcription-client.md` | 同步当前支持的短链域名与验收条件 |

`app/src-tauri/resources/worker/frameq_worker/` 下三份同名文件是 `.gitignore:10` 排除的本地打包资源，由 `scripts/build-installer.mjs` 在打包时重新生成。本机已同步改动以便 `scripts/verify-packaged-worker.mjs` 通过，仓库内无需提交。

## 决策记录

- 解析逻辑保持域名无关。`_resolve_short_link_once` 的 `3xx` `Location`、`response.url`、HTML 内嵌链接三级取值，以及 `http` 到 `https` 重试、5 层重定向上限、`xsec_token` 处理均不改动。Date/Author: 2026-11-07 / WorkBuddy + User。
- 前端与来源身份 adapter 采用精确 host 匹配，`www` 变体同时登记；worker fallback 分派采用后缀匹配，加入 `xhslink.cn` 即可覆盖其子域。Date/Author: 2026-11-07 / WorkBuddy + User。
- 契约用例保持 `drift-detection-only` 与 `fake-clients-only`，`knownAsymmetries` 无需新增条目，三层支持一致。Date/Author: 2026-11-07 / WorkBuddy + User。

## 验证记录

- `uv run ruff check worker`：All checks passed。
- `uv run pytest worker/tests -q`：1270 passed、4 skipped（契约用例调整为 `/discovery/item/` 之后重跑）。
- `node scripts/verify-packaged-worker.mjs`：Packaged worker is byte-identical to the canonical source。
- `npm --prefix app run lint`：`tsc --noEmit` 与 i18n literal checks 通过。
- `node --test scripts/tests/*.test.mjs`：57 项全部通过。
- `uv run python scripts/validate_agents_docs.py --level ERROR`：0 错误、0 警告。
- 契约前端断言：用 esbuild 直接执行 `app/src/urlSupport.ts`，逐条比对契约 29 个用例的 `canSubmitUrl` 与 `normalizeSubmitUrl`，29/29 一致。
- 任务分流：用 esbuild 打包执行 `app/src/webPageProtocol.ts` 的 `classifyTaskUrl`，`https://xhslink.cn/o/5Sr07UUGn54` 返回 `{"kind":"media",...}`，`https://xhslink.cn.evil/o/5Sr07UUGn54` 与 `https://example.com/articles/current` 返回 `web_page`。12:35 诊断记录的网页通道误分流已消除。
- 真实网络解析 `https://xhslink.cn/o/5Sr07UUGn54`：得到 `note_id` 为 `6ae608c9000000000e02f2d2`，跳转目标主机为 `www.xiaohongshu.com`，路径前缀为 `discovery/item`，携带 `xsec_token`。
- `npm --prefix app test`（PowerShell 通道）：136 个测试文件全部通过，1506 passed / 1 skipped，83.57 s。新增的短链准入、契约用例、任务分流断言全部通过。
- `npm --prefix app run build`（PowerShell 通道）：2617 个模块转换完成，`✓ built in 4.68s`，产物 `app/dist/assets/index-CGguR2XA.js` 含 `xhslink.cn`。
- `npm --prefix app run build`（用户手动复验，2026-11-07 16:09）：2617 个模块转换完成，`✓ built in 3.59s`；`dist/assets/index-CGguR2XA.js` 1,121.24 kB、`dist/assets/index-Cg0W_LuY.css` 104.00 kB，两个 helper 产物 SHA-256 与 PowerShell 通道一致。输出中的 500 kB chunk 大小提示属于既有的打包体积建议，与本次改动无关。
- `cargo test --manifest-path app/src-tauri/Cargo.toml --all-targets`（用户手动复验，2026-11-07 16:15）：`test result: ok. 557 passed; 0 failed; 29 ignored; 0 measured; 0 filtered out`，100.00 s；`src/main.rs` 0 tests。编译期三条 `error deleting lock file ... 拒绝访问 (os error 5)` 只涉及 incremental 目录清理，不影响测试结果。工具通道下的 504 passed / 53 failed 与 513 passed / 44 failed 两组结果，通过项与失败项相加都等于 557。
- 执行通道差异：WorkBuddy 的 Bash 工具通道带 `BASH_ENV`、`NODE_OPTIONS=--require=.../node-language-shim.cjs` 等注入，在该通道下 Vitest 4.1.9 会在收集阶段报 `Cannot read properties of undefined (reading 'config')`、Vite 7.3.5 报 `[vite:html-inline-proxy] No matching HTML proxy module found`；清除 `NODE_OPTIONS`、改用 `--pool=threads`、沙箱外运行都不改变该结果。两个工具通道都受沙箱文件权限限制，Rust 里需要真实 ACL、硬链接、目录替换与进程终止的用例会报 `PermissionDenied`，PowerShell 通道 44 项、Bash 通道 53 项。用户手动运行的完整环境下，前端测试、生产构建与 Rust 全目标测试全部通过，这些差异属于工具执行环境，项目代码与测试本身没有故障。

## 残余风险

- 工具通道的 Node 注入与沙箱文件权限限制会造成误报，命令验收以用户手动运行的完整环境为准。后续用 Bash 工具通道执行前端命令时改走 PowerShell 通道；Rust 全目标测试需要在非受限环境复核。
- 真实短链只验证到 URL 解析，拿到 `note_id` 与 `/discovery/item/` 路径；下载、平台字幕、ASR 的端到端流程未在本机复跑。
- 新域名的持续可用性取决于小红书自身。短链响应既无 3xx `Location`、也无最终 URL 与 HTML 内嵌笔记链接时，会沿用既有 `XHS_SHORT_LINK_RESOLUTION_FAILED`。
