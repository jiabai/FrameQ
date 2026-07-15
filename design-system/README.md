# FrameQ Web Marketing Design References

状态：Draft reference material。

本目录保存未来 FrameQ Web 宣传站的设计输入，与桌面 App 的生产样式和运行时代码相互独立。

## 文件职责

- [`apple-DESIGN.md`](apple-DESIGN.md)：视觉风格分析与灵感参考，不是 Apple 官方规范，也不表示 FrameQ 应逐项复制特定品牌的页面或素材。
- [`globals.css`](globals.css)：宣传站的初始设计变量种子；只有在未来宣传站实现明确采用后，才应迁移到对应 Web 工程并转化为正式 token。
- [`web-marketing-site-design.md`](../docs/design-docs/web-marketing-site-design.md)：FrameQ Web 宣传站的产品、体验、内容安全和实施门控规范，也是本目录引用内容的上位约束。

## 使用边界

- 当前桌面 App 不导入本目录中的 CSS。
- 本目录不得存放产品截图、字体文件、Apple 素材或其他来源和授权不明确的资产。
- 开始实现宣传站前，必须先建立对应 product spec 和 active ExecPlan，并重新确认品牌、可访问性、性能、隐私和发布要求。
