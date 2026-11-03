# 系统 WebView 能力核查

核查日期：2026-11-02。本文依据官方资料、官方源代码和本地依赖，只描述可确认的 API 与限制。
本文记录静态能力核查；实施和实际宿主证据见[完成记录](../exec-plans/completed/2026-11-02-system-webview-extraction-plan.md)，静态资料不作为运行验收结果。

## 本地事实

- FrameQ 使用 Tauri 2.11.2、wry 0.55.1、webview2-com 0.38.2、windows 0.61.3、objc2 系列 0.3.2。
- 本机已安装 WebView2 Evergreen Runtime 156.0.4314.58。webview2-com-sys 的 bindings 目标为 143.0.3650.58。
- wry 0.55.1 的 Windows 实现无条件安装 `window.ipc` 和 WebMessage handler；外部页面容器应直接使用原生 API，避免继承主应用的初始化及协议。
- schema 4、WebPageSource、SourceText 和 `web_page_storage.py` 的保存逻辑不依赖 Playwright，可以继续使用。

## Windows：WebView2

不同 user data folder 对应不同 browser process group；单独更换 profile 不建立相同的边界。
为任务创建独占 UDF、Environment 和 InPrivate Controller，并在任何远程导航前安装安全设置。
依据：[进程模型](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/process-model)、
[独占 UDF](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2environmentoptions2)、
[ControllerOptions](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2environment10)。

稳定 API 支持关闭 web messages、host objects、自动填充、保存密码、开发工具和原生脚本对话框；
可以拒绝网页权限、新窗口、外部协议、下载、HTTP 认证及客户端证书，并拒绝证书错误。
`AllowSingleSignOnUsingOSPrimaryAccount=false` 用于关闭相应账号单点登录。
依据：[安全建议](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/security)、
[Settings4](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2settings4)、
[认证](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2_10)、
[客户端证书](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2_5)、
[服务器证书](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2_14)、
[外部协议](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2_18)。

原生 `CallDevToolsProtocolMethod` 可以创建隔离 JavaScript world 并执行固定提取脚本，不需要开放远程调试端口。
执行要与主 frame、execution context 和 navigation generation 绑定，使用异步 completion。
依据：[CDP 接口](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2)、
[跨 session 接口](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2_11)。

`ICoreWebView2_22` 的 source-kinds 过滤覆盖 frame、service/shared worker 等 HTTP 资源来源。
URL 检查发生在实际网络处理之前；这不等于绑定浏览器后续连接的真实地址。
WebSocket 的拦截存在官方跟踪问题，不能把 HTTP 资源事件视为全部网络防火墙。
依据：[资源请求](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/webresourcerequested)、
[SourceKinds](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2_22)、
[WebSocket 跟踪](https://github.com/MicrosoftEdge/WebView2Feedback/issues/4303)。

Microsoft 明确不建议在生产应用依赖 browser flags，其行为可能改变。
环境变量和注册表还可能覆盖 UDF、Runtime 或附加参数。因此 `--proxy-server`、QUIC/WebRTC 开关不能作为
系统 WebView 方案的稳定权限保证。WebView2 的本地网络访问限制也不能直接套用 Edge 浏览器的默认行为。
依据：[browser flags](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/webview-features-flags)、
[Environment 创建与覆盖](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/webview2-idl)、
[LNA 公告](https://github.com/MicrosoftEdge/WebView2Announcements/issues/126)。

`Stop()` 不停止脚本。应关闭 Controller、保持消息循环，等待对应 Environment 的 `BrowserProcessExited`。
该事件在相关进程集合退出且 UDF 资源释放后发生。ProcessInfos 不包含 crashpad，不能用其列表代表所有系统辅助进程。
依据：[Environment5](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2environment5)、
[Environment8](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2environment8)。

系统 Runtime 可能与 Edge 合法共享硬链接；不能对其套用项目自下载组件的单链接规则，也不能删除系统 Runtime。
依据：[Runtime 分发](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)。

## macOS：WKWebView

每次调用 `nonPersistent()` 获得新的内存网站数据存储。macOS 14 起可在 load 前设置 data store 的
`proxyConfigurations`，HTTP CONNECT 的 `allowFailover` 默认关闭。独立 `WKProcessPool` 不保证独立进程，
Apple 已从 macOS 12 起声明多个 process pool 不产生效果。
依据：[DataStore 官方头文件](https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebKit/UIProcess/API/Cocoa/WKWebsiteDataStore.h)、
[ProxyConfiguration](https://developer.apple.com/documentation/network/proxyconfiguration)、
[allowFailover](https://developer.apple.com/documentation/network/proxyconfiguration/allowfailover)、
[WKProcessPool](https://developer.apple.com/documentation/webkit/wkprocesspool)。

独立 helper 使用自身 App Sandbox 身份，不授予主应用文件、应用组、共享凭据、设备或定位权限。
`network.client` 是允许外连的布尔权限，不能将其解释为仅允许连接任务代理。
依据：[App Sandbox](https://developer.apple.com/library/archive/documentation/Miscellaneous/Reference/EntitlementKeyReference/Chapters/EnablingAppSandbox.html)、
[network.client](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.network.client)。

macOS 11 起可通过 `WKContentWorld` 和 `callAsyncJavaScript` 执行隔离 world 的固定提取程序。
content world 隔离 JavaScript 全局变量，页面 DOM 仍然共享。
当前 WebKit 实现中的公开 evaluate 路径会提供用户激活语义，隐藏容器也必须依赖实际权限拒绝。
依据：[WKContentWorld](https://developer.apple.com/documentation/webkit/wkcontentworld)、
[WKWebView 公共声明](https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebKit/UIProcess/API/Cocoa/WKWebView.h)、
[当前实现](https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebKit/UIProcess/API/Cocoa/WKWebView.mm)。

可以通过公开 delegates 拒绝新窗口、上传选择、相机/麦克风、下载、认证及非 HTTP(S) 导航。
macOS 14 的公开 UIDelegate 没有覆盖所有网页权限的统一拒绝接口，设备和文件的权限边界仍需 Sandbox 配合。
依据：[UIDelegate](https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebKit/UIProcess/API/Cocoa/WKUIDelegate.h)、
[NavigationDelegate](https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebKit/UIProcess/API/Cocoa/WKNavigationDelegate.h)。

data store 代理不等于全部传输受控：当前 Cocoa WebRTC 源码自行创建 UDP/TCP 连接；公开 Preferences 没有
关闭 RTCPeerConnection 的选项。拒绝麦克风/相机不禁止 data channel、ICE/STUN/TURN。
依据：[RTC UDP 实现](https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebKit/NetworkProcess/webrtc/NetworkRTCUDPSocketCocoa.mm)、
[RTC provider](https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebKit/NetworkProcess/webrtc/NetworkRTCProvider.cpp)、
[公开 Preferences](https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebKit/UIProcess/API/Cocoa/WKPreferences.h)、
[私有 Preferences](https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebKit/UIProcess/API/Cocoa/WKPreferencesPrivate.h)。

公开 WKWebView 没有全部 renderer/network/GPU PID、立即终止全部系统进程或每任务总 RSS 上限接口。
`stopLoading()` 仅停止资源加载。helper 退出后的 WebKit XPC 回收由系统管理；当前源代码中的父 IPC 关闭退出机制
不能写成所有受支持系统版本的固定时限保证。
依据：[私有 API 边界](https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebKit/UIProcess/API/Cocoa/WKWebViewPrivate.h)、
[WebProcess](https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebKit/WebProcess/WebProcess.cpp)、
[NetworkProcess](https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebKit/NetworkProcess/NetworkProcess.cpp)。

## 本轮边界

静态资料不能代替实际 Runtime、真实网页、权限、网络和进程测试。macOS 运行环境本轮不可用。
HTTP(S) 网址检查、代理可见流量、主导航计数与系统全部网络行为分别记录。
系统 WebView 方案不应承诺完整私网隔绝、全部传输统一配额或所有系统 WebKit 进程的精确强制回收。
额外的系统网络过滤不属于用户要求的网页读取功能。
