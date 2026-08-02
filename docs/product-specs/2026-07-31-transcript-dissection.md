# 文字稿解剖（Transcript Dissection）产品规格

**Date:** 2026-07-31
**Status:** Implemented 2026-08-01
**Product area:** `智能提炼` 工作区
**Target:** `dissection`

## Context

FrameQ 当前已实现 `要点总结`（`summary`）与 `启发灵感`（`insights`）两种 AI target；
`生成文字稿`（`draft`）已有产品规格但尚未实现。它们分别解决浓缩、发散与展开，仍缺少一种
面向内容复盘的动作：把已完成文字稿拆开，理解主题组织、叙事骨架、表达手法、节奏、可复用
模式及潜在风险。

本规格在 `智能提炼` 工作区增加独立 target `文字稿解剖`。它只以当前任务已保存的正式
文字稿为分析对象，生成可查看、可复制、可定位本地文件且可回溯原文片段的结构化解剖报告。
它不参与视频提取、ASR 或文字稿保存主流程，也不会自动运行。

## Goals

- 帮助用户回答“这篇内容如何组织、为什么有效、哪里薄弱、哪些结构可以复用”。
- 让段级判断能够定位回当前任务的正式文字稿，而不是只输出无法核对的泛化评价。
- 复用既有 AI target 的独立确认、输出语言、额度、取消、错误归属与历史恢复纪律。
- 如实告知云端数据范围和最坏额度消耗，不用模糊文案弱化用户确认。
- 让解剖结果保持本地、独立且可判断是否因文字稿修改而过时。

## Non-goals

- 不分析视频画面、景别、运镜、剪辑、音色、语速或声纹；v1 只分析文字稿文本。
- 不读取或发送 `我的灵感档案`、本次生成偏好或其他 target 的结果。
- 不把解剖结果写回正式 `transcript.txt`，也不把它作为正式文字稿编辑或导出。
- 不提供自由文本 prompt、分析维度自定义、跨任务比较或批量解剖。
- 不自动核验事实真伪，不给出法律、医疗、金融或政治结论；风险标记只是“建议核实/可能争议”。
- 不改变 `要点总结`、`启发灵感`、`生成文字稿` 或 Mermaid mindmap 的生成行为。
- 不向 FrameQ server 上传或持久化文字稿、解剖报告、偏好或 prompt。

## Product Model

`文字稿解剖` 是独立 AI target，拥有自己的 locked、ready、generating 与 failed 状态；stale
是已有成功结果上的独立提示，不替代 target 状态。卡片在尚无结果时提供确认/重试，在已有
结果时只提供查看；复制、定位文件和重新解剖动作属于结果详情页。

- 当前实现若尚无 `draft`，卡片顺序为：`要点总结` → `文字稿解剖` → `启发灵感`。
- `draft` 实现后的目标顺序为：`要点总结` → `文字稿解剖` → `启发灵感` → `生成文字稿`。
- `dissection` 不依赖其他 AI target；`summary`、`insights` 或 `draft` 的成败不影响其可用性。
- 同一时刻仍只允许运行一个 AI target。其他 target 活跃时，解剖卡片不可再次启动 worker。
- 解剖失败只归因于本 target；既有文字稿和其他成功 AI artifact 必须保持可用。

## Eligibility and Card States

只有同时满足以下条件时，解剖卡片才可进入确认：

- 当前任务通过受支持任务校验，不是 legacy、quarantined 或不完整任务；
- 正式 `transcript/transcript.txt` 已保存、路径受验证且内容非空；
- 任务状态为 `completed` 或 `partial_completed`；
- 当前没有其他 AI target 或本地保存操作占用互斥执行边界；
- 账户已登录、LLM 已配置且额度预检可用。

状态行为：

| 条件 | 卡片行为 |
|------|----------|
| 正在转录、正式文字稿缺失/非法/为空 | 安静禁用，提示先完成并保存文字稿；不展示可触发的 LLM 入口 |
| 任务不受支持 | 不展示可用卡片动作，不读取替代路径 |
| 已有有效且未过时的解剖 | 卡片只提供 `查看`；详情页提供明确的 `重新解剖`，不得自动重跑 |
| 已有解剖但文字稿已变化 | 标记 `文字稿已更新，解剖可能过时`，卡片只保留查看；详情页提供 `重新解剖`，并禁用原文定位 |
| 正在生成 | 显示本 target 进度与取消入口；本地文字稿保持可读/可回听，编辑与保存禁用 |
| 生成失败 | 显示安全错误、已消费额度说明与 `重试`；旧的成功解剖若存在则继续保留 |

## Confirmation Experience

点击未生成卡片的 `确认`，或结果详情页的 `重新解剖`，都只打开确认页，不消耗额度。确认页必须展示：

- 任务标题、正式文字稿字数与确定性输入片段数，不展示全文；
- 本次冻结的输出语言：简体中文、繁體中文或 English，不显示 `system`；
- 预计 LLM 调用区间与硬上限，例如 `预计 2–3 次，最多 6 次`；
- 当前剩余额度，以及 `1 次额度 = 1 次云端 LLM API 调用尝试`；
- 如实的数据提示：文字稿内容会分片发送给管理员配置的 LLM supplier，多轮合计可能覆盖
  全文；不会发送视频、音频、source URL、偏好或其他 AI 结果；
- `确认` 与 `取消`。

点击最终 `确认` 时冻结文字稿快照与输出语言。生成期间切换 UI 语言不改变已发起请求；重试
重新进入确认页，并使用重试确认时的语言和当时最新的正式文字稿。

## Quota and Call Boundaries

- 每次解剖最多允许 6 次 LLM 调用尝试，包含 map、reduce 与最多一次结构修复调用。
- 调用区间必须由版本化的确定性 call-plan 规则根据已保存文字稿计算；前端预览与 worker
  执行前复算必须一致。两者不一致时，以 worker 的更严格结果阻断，不开始 checkout。
- 确认前必须根据输入片段计算保守的预计调用区间；若预计上限超过 6 次，任务不启动，提示
  当前版本不支持该长度的文字稿，不消耗额度。
- 若账户剩余额度小于预计调用上限，任务不启动，提示额度不足，不允许在已知无法完成时先扣
  部分额度。
- 每次调用由 server-managed checkout 最终授权并扣除 1 次额度。checkout 未成功不扣；
  checkout 成功后，即使 supplier 失败、超时、内容被拦截、结果不可解析或最终任务失败，
  已扣额度也不返还。
- 在第一次调用前取消不扣额度；至少一次 checkout 成功后取消，已扣额度不返还，尚未发起的
  调用不扣。
- 前端预检只用于快速阻断。若确认后账户状态发生竞态变化，以每次 server checkout 为准；
  中途额度不足时任务失败闭合，不提交半套新解剖，并明确显示已完成调用可能已消费额度。
- `dissection` 不隐式运行或扣除 `summary`、`insights`、`draft` 或 Mermaid mindmap 的额度。

## Report Experience

成功报告包含以下用户可见区域：

| 区域 | 内容 |
|------|------|
| 主题分段 | 标题、核心论点、支撑点、表达手法、节奏、可复用模式、风险标记 |
| 叙事结构 | 开头钩子、整体推进结构、转折与收尾方式 |
| 可复用骨架 | 对结构的抽象步骤，不逐字复制原文 |
| 亮点 | 最多 8 条可定位的原文摘录；保持原语种，不伪造或改写成“原文” |
| 受众适配 | high / medium / low 及简短原因 |
| 亮点与短板 | 各最多 6 条，必须基于文字稿内容 |

每个主题段必须引用一个或多个合法的原文输入片段。用户点击 `定位到文字稿对应片段` 时，
应用在同一任务内定位第一个引用片段，并允许查看该主题引用的全部片段。不得跨任务跳转，
不得把无法对齐的判断伪装成已溯源结果。定位只在当前正式文字稿与生成时摘要一致、引用片段
范围及片段摘要均校验成功时可用；stale 或校验失败时按钮禁用，并提示重新解剖。

报告查看使用安全的结构化 UI 或经净化的 GFM，不渲染原始 HTML。卡片与详情页提供：

- `查看`：卡片已有结果时的唯一操作；打开独立解剖详情，不与正式文字稿编辑容器混用；
- `复制`：复制面向用户的报告文本，不包含内部摘要、路径或 prompt；
- `定位文件`：定位本地 `ai/dissection.md`；
- `重新解剖`：仅在结果详情页提供；重新确认并生成，成功后原子替换当前权威解剖版本。

### Markdown Export Completeness

- `ai/dissection.md` 是结构化报告的完整人读导出，不是摘要；它必须覆盖叙事结构、主题分段、
  可复用骨架、亮点原文、受众适配、优势和不足。
- 每个主题段必须导出核心论点、支撑点、表达手法、文字信息节奏、可复用模式、风险标记和
  `sourceChunkIds`。空数组可以省略对应小节，但不得因此丢失其他非空字段。
- `openingHook`、`turningPoint`、`closingType` 为 `null` 时省略对应行；`structureType` 始终
  导出。受众适配必须把 `high | medium | low` 渲染为导出语言对应的可读标签。
- Markdown 不包含全文摘要、chunk 哈希、字节范围、内部 schema 版本、prompt、本地路径或
  其他仅供完整性校验的内部字段。

## Local Artifacts and Staleness

- 权威结构化产物为 `ai/dissection.json`，人读导出为 `ai/dissection.md`。
- manifest 只通过受验证的 `artifacts.dissection` 与 `artifacts.dissection_md` 登记文件；
  不复制报告全文，也不维护 `has_dissection` 等平行布尔状态。
- 结构化产物记录生成时正式文字稿的 SHA-256。每次查看和历史恢复都与当前正式文字稿比较；
  不一致即显示 stale 提示，因此应用重启后仍能正确判断。
- 结构化产物同时记录每个输入片段在生成时文字稿 UTF-8 字节中的起止位置与片段 SHA-256，
  不复制片段正文。定位前必须复核全文摘要、范围边界和片段摘要。
- 文字稿保存不会删除旧解剖。重新解剖失败或取消也不得删除、覆盖旧的成功产物。
- 新 JSON、Markdown 与 manifest 必须作为同一任务 artifact 提交；任何部分失败都不得暴露
  半套新版本。

## Output Language and Content Rules

- 输出语言固定为确认时的 `zh-CN | zh-TW | en-US` 之一。
- 报告标题、解释、评价、风险标记与模板均使用冻结的输出语言；原文亮点保留原语种。
- 文字稿原语言未知时不得猜测或阻断；仅在可信 transcript metadata 存在时展示来源语言。
- 核心论点、支撑点、亮点和风险标记必须能在引用片段中找到依据。
- 对空、重复、乱序、越界的片段引用，允许最多一次受额度约束的修复调用；仍非法则整次失败，
  不钳制、不静默丢弃、不提交新报告。
- 风险标记使用克制措辞，不把模型判断呈现为事实核验结果。

### Prompt Contract Reliability

- map 阶段必须给出闭合的中间 JSON schema、字段语义和数组上限；每个候选段必须引用本批次
  合法、升序且去重的 `sourceChunkIds`，并覆盖核心论点、支撑点、表达手法、节奏、可复用
  模式与克制的风险标记。
- reduce 阶段必须给出与权威报告 parser 一致的完整嵌套 JSON schema，而不只列顶层字段；
  输出只能由 map 结果归并，不得补入原文之外的事实、偏好、路径、URL 或其他 AI 结果。
- repair 阶段可以补齐权威 schema 要求但候选结果缺失的字段，也可以删除未知字段；它不得新增
  候选结果中没有的事实、原文摘录或合法集合之外的 chunk ID。repair 必须获知合法 chunk ID
  集合和安全、非内容型的校验原因，避免盲目修复。
- 提示词必须明确要求 JSON-only、固定 enum、字段数量限制、输出语言和可迁移仿写结构；不得
  暗示已分析视频画面、语速、音色、剪辑效果或转化率。

### Actionable Reuse Guidance

- `reusablePattern` 不能只输出“问题—分析—结论”等抽象标签；它必须说明该段迁移时必须保留
  的结构作用、可替换的内容槽位、可以删减的节点，以及适用的内容类型或目标。
- `reusableTemplate.skeleton` 使用输出语言中的可替换槽位表达，例如 `[受众痛点]`、
  `[核心证据]`、`[下一步行动]`；每一步标明“必须保留”或“可选/可删减”，不得逐字复制
  原文或替用户虚构具体产品、受众和效果。
- 全局不适用条件、迁移失败风险或依赖原作者身份/独有证据的限制写入 `weaknesses`；段级限制
  写入对应 `riskFlags`。这些内容必须以文字稿为依据，不得声称验证过转化率或分析过画面、
  运镜、语速、音色、剪辑、BGM、字幕和拍摄设备。
- “仿写”只表示结构迁移，不表示复刻原文措辞、事实、品牌承诺或受版权保护的独特表达。

## Privacy and Security

- FrameQ server 仅处理账号、权益、额度与 LLM checkout，不接收 prompt、文字稿或解剖结果。
- LLM supplier 会在用户最终确认后收到实际文字稿内容；多轮合计可能覆盖全文。
- 视频、音频、source URL、本地绝对路径、用户偏好、其他 AI 结果和解剖结果不得进入 prompt。
- worker 只通过受验证任务能力读取固定正式文字稿，不接受前端传入的本地路径或文字稿正文。
- 日志、进度、错误、诊断和 telemetry 不得包含完整文字稿、完整 prompt、解剖全文、source URL
  或本地绝对路径。
- 不新增网络目的地、server 持久化字段、直接 LLM key 配置或绕过 managed checkout 的入口。

## Failure and Recovery

| 条件 | 要求行为 |
|------|----------|
| splitter 为空或失败 | 在任何 LLM checkout 前失败，保留旧产物 |
| LLM checkout 被拒绝 | 显示账号/配置/额度对应的固定安全错误，不扣该次额度 |
| supplier 失败、超时或拦截 | 本 target 失败；已 checkout 的额度不返还，保留旧产物 |
| JSON 或字段校验失败 | 最多一次有界修复；仍失败则不提交新产物 |
| 引用片段非法 | 失败闭合，不钳制或静默丢段 |
| 用户取消 | 终止后续调用；已扣额度不返还，旧产物保留 |
| 应用重启后恢复 | 从受验证 artifact 恢复报告，并重新计算 stale 状态 |
| 解剖失败但其他 target 成功 | 整体可为 `partial_completed`；其他产物不受影响 |

## Compatibility

- `process_video` 与本地媒体请求保持 transcript-only，不自动触发解剖。
- 复用现有 AI 命令入口并扩展 `dissection` target；不新增第二套 checkout 或取消路径。
- worker terminal result 和 artifact 闭集需要显式升版并由 TypeScript、Rust、Python 严格解码；
  旧版本不得把未知字段当作成功。
- task-manifest schema v3 的既有字段语义不变，只扩展受允许的通用 artifact key。
- legacy、quarantined 与不受支持任务保持物理不变，不为其生成或展示可操作的解剖状态。

## Acceptance Criteria

- `智能提炼` 显示独立的 `文字稿解剖` 卡片；未实现 `draft` 时排第三，目标四卡态排第四。
- 只有受支持任务的已保存、受验证、非空正式文字稿可进入确认；不自动运行。
- 确认页展示任务摘要、冻结的输出语言、预计调用区间、6 次硬上限、剩余额度和如实的数据范围。
- 预计上限超过 6 次或剩余额度不足预计上限时，不启动 worker、不消费额度。
- 生成最多 6 次调用；每次 managed checkout 独立扣额，失败和取消只保留已经发生的扣减。
- 报告覆盖规定的结构维度；每个主题段有合法、非空、升序且去重的原文片段引用。
- map、reduce 与 repair 提示词分别声明完整闭集 schema；提示词契约测试不得仅依赖预制模型
  响应来间接证明格式可靠性。
- 可复用模式和模板明确包含槽位、必选/可选节点、适用类型与不适用条件，并保持文字稿专属
  分析边界。
- 非法引用最多修复一次，仍非法时失败闭合，不提交新 artifact。
- 成功后可查看、复制、定位 Markdown，并从报告定位回同任务文字稿片段。
- `ai/dissection.json`、`ai/dissection.md` 与 manifest 原子提交；失败或取消保留旧成功版本。
- 文字稿变化后，当前会话及应用重启后的历史恢复都显示 stale 提示、禁用旧引用定位并允许
  重新解剖。
- 解剖失败只归因本 target，不影响正式文字稿或其他 AI artifact。
- FrameQ server 不接收或保存文字稿、prompt、解剖结果或偏好；supplier 数据范围与确认页一致。
- 简体中文、繁體中文与 English UI/输出语言路径均有覆盖；切换 UI 不改变已冻结请求。

## References

- `docs/design-docs/2026-07-31-transcript-dissection-feature.md`
- `docs/product-specs/2026-07-11-local-transcript-ai-workspaces.md`
- `docs/product-specs/2026-07-12-generate-draft-from-inspiration.md`
- `docs/product-specs/2026-07-15-desktop-i18n-ai-output-language.md`
- `docs/product-specs/2026-06-22-server-managed-llm-quota.md`
- `docs/product-specs/2026-07-10-source-url-privacy-boundary.md`
- `docs/product-specs/2026-07-11-history-vnext-strict-boundary.md`
- `docs/product-specs/2026-07-22-release-reliability-hardening.md`
