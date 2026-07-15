# FrameQ 海外宣传与分发合规研究参考

状态：Research note
资料整理日期：2026-07-15

本文用于记录海外宣传和分发前需要复核的风险，不构成法律意见，也不能替代目标市场的专业法律、隐私或平台条款审查。平台规则、监管实施时间和分发要求可能变化；开始公开 beta、付费推广或正式发布前必须重新核验官方来源。

当前建议不是直接大规模投放，而是先进行海外英文独立站和小范围 beta 验证，正式付费推广前补齐合规、分发与文案边界。

## 重点复核项

1. **YouTube 与其他平台条款**

   YouTube 官方条款限制未经授权下载、复制或使用内容，除非平台明确允许或已取得相应许可。FrameQ 海外文案不得表述为“下载任意 YouTube 视频”“绕过限制”或“无需登录提取”。更稳妥的产品边界是：仅处理用户有权使用的公开链接，并要求遵守平台条款与版权规则。

   来源：[YouTube Terms of Service](https://www.youtube.com/static?template=terms)

2. **隐私与 GDPR / UK GDPR**

   面向欧盟或英国用户前，需要提供清晰的 Privacy Policy，说明哪些数据留在本地、哪些情况下文字稿片段会发送给云端 LLM、处理目的、保留期、共享对象，以及用户如何联系、删除数据或行使其他权利。

   来源：[European Commission Data Protection](https://commission.europa.eu/law/law-topic/data-protection_en)、[ICO Right to be informed](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-be-informed/)

3. **AI 透明度**

   欧盟官方资料显示 AI Act 的透明度规则在 2026 年 8 月生效。FrameQ 是否以及如何适用仍需根据最终产品形态和目标市场单独评估；无论监管分类如何，产品和宣传均应明确 AI 输出可能不准确并需要用户复核。

   来源：[EU AI Act official overview](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai)

4. **安装包可信分发**

   Apple 官方说明 Developer ID 与 notarization 可提升用户安装自行分发 macOS App 时的安全性。Windows 发布前也应单独验证代码签名、SmartScreen 信誉和安装体验，不得在未验证时宣称“无警告安装”。

   来源：[Apple macOS distribution](https://developer.apple.com/macos/distribution/)

5. **模型下载可用性**

   FrameQ 首启下载 SenseVoice Small。海外推广前必须验证目标地区能够稳定下载模型；如果现有下载源覆盖不足，需要设计海外可用的镜像或 CDN 策略，并在页面明确说明安装包不内置模型、首启需要下载。

## 公开 beta 前检查清单

- 英文官网、Privacy Policy 与 Terms 已准备并经过适用市场复核。
- macOS notarized DMG、Windows 签名安装包及其实际安装体验已验证。
- 海外模型下载链路、失败提示、取消和离线降级已验证。
- 支持平台、公开链接边界和不支持场景已明确。
- 版权与平台条款免责声明已审查。
- 支持邮箱、诊断日志范围和删除说明已公开。
- 文案不包含“下载任意视频”“绕过限制”等超出产品边界的承诺。

FrameQ 的“本地优先”可以作为海外传播重点，但视频平台条款、隐私披露、AI 透明度、模型下载和安装包可信度必须先得到验证。
