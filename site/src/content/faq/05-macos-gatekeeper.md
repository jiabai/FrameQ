---
question: "macOS 首次打开为什么被阻止？"
order: 5
---

macOS DMG 使用 ad-hoc 签名，未经过 Apple notarization。从 GitHub 下载后，需在系统设置 → 隐私与安全性中找到拦截提示，点击"仍要打开"。也可使用终端命令 `xattr -dr com.apple.quarantine /Applications/FrameQ.app` 作为后备。
