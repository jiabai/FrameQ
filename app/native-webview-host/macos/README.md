# macOS 系统网页宿主

使用 macOS 14+ 的 AppKit、WebKit、Network 和 Security 公共接口。构建器需要将 `Main.swift`、
`HostProtocol.swift`、`WebPageHost.swift`、`PolicyDelegate.swift`、`Extraction.swift` 编译为
`FrameQWebViewHost.app/Contents/MacOS/frameq-webview-host`，使用本目录 Info.plist 和 entitlements.plist
签名。Swift 编译参数包含 `-swift-version 5 -parse-as-library` 和上述四个 framework。

启动参数严格使用 `--operation-id <canonical UUID>`。helper 从私有 stdin 管道读取 init，核验 operation ID
匹配启动参数，完成身份、权限与配置检查后发送 ready，收到 start 后开始导航。
协议记录上限为40 MiB；Foundation JSON 实现解析消息，字段、版本、UUID 和平台参数执行闭集验证。
stdout 只输出协议 JSON，诊断不输出网址、页面或正文。

任务使用独立 nonPersistent data store，在创建 view 和 load 前设置 CONNECT proxy；不启用代理 failover。
主页面与子框架的地址检查分别处理：主页面拒绝会终止任务，子框架拒绝只取消该次导航。
最多16项检查同时进行，其余最多512项排队；排队期限10秒，活动检查期限2秒。
超时请求完成拒绝回调后保留检查名额直到父进程答复，防止两端在途数量不一致。
代理不按累计请求数量拒绝页面；最多16条活动连接，接受新连接前等待名额，监听队列提供背压。
代理保留64 MiB可见字节预算，停止时同时释放活动连接和等待名额。
CONNECT隧道连续5秒没有实际字节读写时关闭，释放名额供等待的其他来源使用；活动传输更新期限。
提取前等待当前主页面的地址检查完成并要求Document完成加载与稳定；子框架检查独立，拒绝的子框架不能代替有效正文。
诊断仅发送最多16条封闭原因/资源类别JSON，不记录URL、域名、Cookie或正文。
页面运行于隐藏窗口中的真实 WKWebView。固定脚本在独立 WKContentWorld 读取 Document，通过原生
callAsyncJavaScript 回调返回正文。JavaScript 消息桥、页面消息处理器、Tauri 和自定义 scheme 均未安装。
结束时使回调失效、停止加载、解除 delegates、释放 view/data store 并退出自有 helper。
系统 WebKit XPC 生命周期由系统管理；HTTP 代理以外的网络能力仍受系统 WebKit 公开接口限制。

协议校验可在 macOS 使用实际 Foundation JSON 实现执行：

```sh
mkdir -p build/native-webview-host-tests
xcrun swiftc -swift-version 5 -parse-as-library app/native-webview-host/macos/HostProtocol.swift app/native-webview-host/macos/tests/ProtocolTests.swift -o build/native-webview-host-tests/macos-protocol-tests
build/native-webview-host-tests/macos-protocol-tests
```

当前实现环境为 Windows，未提供 Swift/macOS SDK。原生编译、最终 app/dmg 代码签名和 entitlement 回读、
Sandbox canary、实际 HTTP/HTTPS CONNECT、动态网页、权限、取消与 WebKit XPC 行为尚未运行验证，
这些检查继续作为 macOS 发行门禁。ProtocolTests.swift 同样需要 macOS Swift 工具才能执行。
