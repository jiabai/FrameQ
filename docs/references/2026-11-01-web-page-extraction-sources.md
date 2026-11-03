# 网页正文提取来源与运行组件参考

来源核查日期：2026-11-01；本机验收记录更新至2026-11-02。本文记录来源、实际构建锁和运行验证材料；功能验收进度见 active ExecPlan。

## InsightFlow 本地来源

核查仓库：`D:/Github/InsightFlow`，候选文件最近相关提交为
`a641ebb61f12b29333d459021e84ec7513f596a2`。核查时四个候选文件均无未提交修改。

| 文件 | 可复用职责 | 分离要求 |
| --- | --- | --- |
| `src/extension/extractor/siteRules.cjs` | 站点正文选择器、排除元素和规则数据 | 按解析后的host/path匹配；保留独立的上游来源与许可 |
| `src/extension/immersive/readingSession.cjs` 57–400行 | 提取入口、站点规则提取、候选选择、正文构造、克隆节点清理和标题读取 | 传入目标Document/URL；不迁移阅读界面、翻译、Chrome消息与监听器 |
| `src/extension/hooks/useMarkdownConverter.ts` 129行起 | Readability识别与Turndown配置 | 保留结构后转换；加入实际表格支持和完整清洗 |
| `src/extension/lib/tagsToRemove.ts` | 转换阶段标签排除 | 与安全清洗的职责分别校验 |

InsightFlow 根 `LICENSE` 为 MIT，署名 `Copyright (c) 2025 StandlX`。
其 `ContentExtractor.cjs` 会合并全部空白，不能承担保留段落结构的保存接口。
`sanitizeClone` 只处理部分元素、事件和网址，不能作为安全HTML清洗器。
Readability操作克隆Document，原始页面Document保持不变。

## 站点规则表的独立出处

`siteRules.cjs` 注明规则来自 Clearly Reader。独立核查将其59条数据与官方
Clearly Reader 3.0.4 分发包中的 `config.websites` 通过TypeScript AST逐项比较：
58条完全一致；微信正文选择器仅去除了末尾空格。

Mozilla历史版本元数据将3.0.4标为MPL-2.0；核查的官方归档SHA-256为
`17631A64168DA73D4F4817EB1A2FFB573547BD92B0D2CC6E006FDD2A554A2F2C`。
规则文件独立保留MPL-2.0标识、LESSLAB署名、出处、版本和修改说明。
[官方历史元数据](https://addons.mozilla.org/api/v5/addons/addon/clearly-reader/versions/?page_size=50)、
[官方3.0.4归档](https://addons.mozilla.org/firefox/downloads/file/4215717/clearly_reader-3.0.4.xpi)、
[MPL-2.0许可文本](https://www.mozilla.org/en-US/MPL/2.0/)。

## 提取依赖

- InsightFlow已使用Readability 0.6.0（Apache-2.0）和Turndown 7.2.0（MIT）。
- FrameQ固定DOMPurify 3.4.17，并保留其Apache-2.0／MPL-2.0许可材料。
  [官方3.4.17发布](https://github.com/cure53/DOMPurify/releases/tag/3.4.17)、
  [官方包定义](https://raw.githubusercontent.com/cure53/DOMPurify/3.4.17/package.json)。
- GFM转换固定turndown-plugin-gfm 1.0.2（MIT），使用真实DOM和Markdown结果验证表格、嵌套列表及代码结构。
  [官方包定义](https://raw.githubusercontent.com/mixmark-io/turndown-plugin-gfm/master/package.json)。

`app/package-lock.json`记录固定版本与integrity；构建输出包含完整许可文本、NOTICE、
独立站点规则源码及bundle/文件指纹。

## 网页引擎版本与平台

构建固定Playwright Python 1.64.1。官方浏览器清单列出Chromium headless shell
revision 1248、版本156.0.8078.4；组件构建必须再次读取实际wheel内的浏览器清单核对。
Python版本号不能代替driver和browser版本证明。
[PyPI固定版本](https://pypi.org/project/playwright/1.64.1/)、
[固定浏览器清单](https://raw.githubusercontent.com/microsoft/playwright/v1.64.1/packages/playwright-core/browsers.json)、
[Python driver版本来源](https://raw.githubusercontent.com/microsoft/playwright-python/v1.64.1/DRIVER_VERSION)。

所选引擎的新网页提取系统下限为Windows11及macOS14；其他媒体功能与已有笔记读取不收紧平台要求。
完整组件大小由三平台真实构建记录，PyPI wheel大小不包含浏览器。
[官方系统要求](https://playwright.dev/docs/intro#system-requirements)、
[官方headless shell说明](https://playwright.dev/docs/browsers#chromium-headless-shell)。

### Windows x64 实际构建

- CPython ABI：`cp312`；Playwright Python：`1.64.1`；wheel 内 driver：
  `1.64.0-beta-1791568591000`；driver Node：`v24.22.1`。
- Chromium headless shell：revision `1248`，版本 `156.0.8078.4`。
- 组件归档：163,109,963 bytes；展开文件：402,464,046 bytes。
- 归档 SHA-256：`9f6fac868ea2036ad0df9993a6ce2a3a57bff9c841576f71b79cdeab4f1acb08`。
- 组件 manifest SHA-256：`6bed833f9227d391148806eae136b4b2cfd0d8012061a33c930b3fb36f32b15d`。
- 提取 bundle：102,208 bytes，SHA-256
  `6a658784aad5248f87beb05536a6f423d3d27cc5e552a04074679aeb86c8413f`。
- 构建探针实际执行 Python import、Node 版本、Chromium 版本与离线 `about:blank`。
  macOS 两种组件尚未在对应本机环境构建，不能使用 Windows 记录代替。
- Windows inventory含612项文件，许可/notice材料14项。真实安装、坏hash/链接/缺文件/篡改、
  探针失败保留及恢复测试通过；真实跨根迁移重新核验inventory并离线启动通过。
- 该Windows归档尚未公开发布，实际发行asset下载留在公开分发前验证。

## 加载隔离与生命周期依据

- Tauri 2.11.2本地`manager/webview.rs`会向Webview注册IPC/asset；
  `protocol/asset.rs`基于相应origin返回内容。仅配置无capability的远程Tauri窗口不足以建立本地资料隔离。
- Rust直接拥有Chromium进程和本次profile，Python通过公开CDP连接。CDP能力具有限制，项目所用context、proxy、页面加载及提取需真实跨平台验证。
  [公开CDP接口](https://playwright.dev/python/docs/api/class-browsertype#browser-type-connect-over-cdp)、
  [固定版本context实现](https://raw.githubusercontent.com/microsoft/playwright/v1.64.1/packages/playwright-core/src/server/chromium/crBrowser.ts)、
  [固定Python driver启动实现](https://raw.githubusercontent.com/microsoft/playwright-python/v1.64.1/playwright/_impl/_transport.py)。
- 浏览器启动与context使用同一临时代理；`<-loopback>`取消Chromium默认的本机绕过规则。
  公网DNS校验及最终SocketAddr绑定由原生代理承担。
  [Chromium代理语义](https://chromium.googlesource.com/chromium/src/+/HEAD/net/docs/proxy.md)。
- 不把proxy username/password传入context。当前Chromium实现将其复用于通用HTTP认证设置，
  本计划采用无认证且有时限、连接及流量限额的临时公网代理。
- `browser.close()`对连接实例的清理不能替代原生子进程回收；取消和超时须证明全部拥有的browser/driver/worker均退出。
  [官方连接关闭语义](https://playwright.dev/python/docs/api/class-browser#browser-close)。

本计划的传输限额、正文准入、操作身份、存储和生命周期设计属于FrameQ设计决定，
不将其描述为第三方库已经提供的完整保护。

### HTTP认证与headless组件边界

2026-11-01核查当前Chromium官方headless实现：`auth-server-allowlist`直接进入
NetworkService的HTTP认证配置；空白allowlist保留默认凭据判定规则。FrameQ显式使用
不可匹配的`frameq.invalid`，该后缀同时被原生和worker网址准入拒绝。
[headless认证配置](https://raw.githubusercontent.com/chromium/chromium/main/headless/lib/browser/headless_request_context_manager.cc)、
[默认凭据与allowlist](https://raw.githubusercontent.com/chromium/chromium/main/net/http/http_auth_preferences.cc)。

实际固定wheel中的`driver/package/lib/coreBundle.js`在未提供HTTP credentials时采用
CDP `Default`认证响应，并自动继续HTTP重定向而不再次调用用户route。FrameQ在独立
CDP session的Response阶段核对重定向预算，并对认证挑战明确发送`CancelAuth`。
这项控制不能仅由Playwright首次请求route计数承担。

官方headless实现对客户端证书请求继续使用空证书，不提供系统客户端证书；
其当前上游实现也明确关闭NetworkService的操作系统沙箱。FrameQ保持组件实际提供的
renderer沙箱和独立进程，不将全部Chromium子进程描述为均有操作系统沙箱。
[headless客户端证书及沙箱实现](https://raw.githubusercontent.com/chromium/chromium/main/headless/lib/browser/headless_content_browser_client.cc)。
