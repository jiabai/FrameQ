# 文字稿解剖（Transcript Dissection）产品规格

**Date:** 2026-07-31
**Updated:** 2026-10-25
**Status:** Implemented
**Product area:** `智能提炼` 工作区
**Target:** `dissection`

## 用户行为

文字稿解剖分析已保存文字稿的主题组织、叙事结构、表达手法、文字信息节奏、可复用骨架、
受众适配和潜在风险，生成独立报告。它通过 `agent_runtime` 的 agent 工具循环完成，用户
确认后才会执行。视频下载、ASR 和文字稿保存继续独立运行。

卡片顺序为 `要点总结 → 文字稿解剖 → 启发灵感 → 生成文字稿`。解剖独立维护 ready、
generating、failed 状态，过时提示附属于既有成功报告。同一时刻只运行一个 AI target。

## 输入资格

- 任务通过当前 manifest 校验，状态为 `completed` 或 `partial_completed`。
- 固定正式文件 `transcript/transcript.txt` 路径合法、已保存且非空；同名替代路径、其他
  任务文字稿、符号链接和 junction 均被拒绝。
- 输入按每片段最多 2,000 个字符确定性分段，最多 16 个片段。空白和超限输入在 checkout
  前失败。
- 账户已登录，托管 LLM 配置可用，额度至少覆盖六次调用上限。
- 当前没有其他 AI target 或保存操作占用执行边界。

legacy、quarantined 或不完整任务不可使用该功能。正式文字稿不可用时卡片安静禁用；
不读取 Markdown、元数据文件或其他候选文件。请求传递任务标识，不接收文字稿正文或本地
路径。解剖请求拒绝偏好快照，也不依赖 summary、insights 或 draft。

## 确认与额度

打开确认页、取消和查看已有报告不消费额度。最终确认页展示：

- 任务标题、文字稿字数与输入片段数；
- 本次冻结输出语言：简体中文、繁體中文或 English；
- 预计 `1–6` 次 LLM 调用、最多六次、当前剩余额度；
- 一个 AI Credit 对应一次云端 LLM API 调用尝试；
- 正式文字稿内容将发送给管理员配置的 LLM 供应商，单次请求可能包含全文，后续 agent
  轮次携带本次生成上下文与验证反馈；
- 确认与取消按钮。

最终确认冻结正式文字稿快照与 `zh-CN | zh-TW | en-US` 输出语言。生成期间切换 UI 语言
不改变当前请求；重试重新确认最新文字稿与语言。生成期间文字稿可读、可回听，编辑和
保存禁用。

每次实际 LLM 调用通过独立 server-managed checkout 最终授权和扣除一个 AI Credit。
checkout 未成功不扣费；成功后供应商失败、超时、无效交付或取消，对应扣减不返还。尚未
发起的调用不扣费。确认后发生额度变化时，以每次 checkout 结果为准；中途不足时保留
旧成功版本，禁止提交半套新报告。

前端与 worker 使用共享 agent 预算规则：非空且不超过 16 个片段时允许一至六次调用。
确认前额度不足六次或文字稿超限时不启动。解剖不隐式运行其他 target。

## agent 交付规则

agent 读取全部受支持的正式文字稿片段，通过 `submit_dissection` 工具提交完整语义报告。
工具验证完整闭合 schema、片段引用、原文摘录与集合限制，并由 worker 计算溯源字段。
普通文本回复不算完成。

无效交付收到固定验证类别，agent 在当前六次调用预算内结合原文修改并重新提交。有效交付
直接完成运行。用尽调用次数仍没有有效报告时，本 target 失败，保留既有完整报告与正式
文字稿，不钳制引用、不静默丢段、不写入不完整新产物。

agent 仅开放报告交付工具。文件操作、网络检索、skills 和外部执行均不属于解剖工具集。
每次 LLM 调用前发出只包含 `attempt`、`total` 的受验证进度事件；供应商阻塞期间不发
定时心跳。桌面端保持 30 分钟 idle deadline 与 90 分钟 absolute deadline。

## 报告内容与 schema

报告 schema 固定为 1，包含闭合结构：

| 区域 | 内容与限制 |
| --- | --- |
| `overallNarrative` | 开头钩子、推进结构、转折、收尾；推进结构必填，其余可为 `null` |
| `segments` | 连续 ID、标题、非空 `sourceChunkIds`、核心论点、支撑点、表达手法、文字节奏、可复用模式、风险标记 |
| `highlights` | 最多八条逐字原文摘录，保持原文语言、标点和空白 |
| `reusableTemplate` | 名称和三至七步骨架 |
| `audienceFit` | 受众、`high | medium | low` 和依据 |
| `strengths`、`weaknesses` | 各最多六条，基于正式文字稿 |

每个主题段可引用多个片段；引用必须非空、去重、升序且全部合法。chunk ID 独立于 ASR
segment ID。原文摘录必须为正式文字稿逐字子串。所有解释、评价、模板和风险提示使用
冻结输出语言，原文亮点保留原始语言；来源语言仅取可信 metadata，未知时为 `null`。

`reusablePattern` 说明保留的结构作用、可替换槽位、可选节点、适用内容类型和不适用条件。
`reusableTemplate.skeleton` 使用 `[受众痛点]`、`[核心证据]`、`[下一步行动]` 等槽位，
每步标记必要或可选。段级限制写入风险标记，全局适用限制及身份、证据依赖写入不足。

内容判断只依据文字稿，不虚构产品、受众、数据、效果或案例；结构迁移不得逐字复制原文
或复刻受保护表达。风险标记只提示需核实或可能争议，不声称完成事实核验。功能不分析
画面、运镜、语速、音色、剪辑、音乐、字幕、设备或转化率。

## 结果查看、导出与定位

成功生成固定产物 `ai/dissection.json` 和 `ai/dissection.md`。manifest 只登记
`artifacts.dissection` 与 `artifacts.dissection_md`；不复制报告全文或维护重复存在状态。
JSON 为权威结构化报告，Markdown 完整导出全部用户可见字段。空数组小节与为 `null` 的
可选叙事字段可省略，其他内容完整保留。导出标签和适配度支持三种输出语言。

卡片已有报告时只提供查看。详情页提供复制、定位 Markdown 文件与重新解剖；重新解剖
再次进入确认。查看使用安全的结构化 UI 或净化后的 GFM，不渲染原始 HTML。复制和
Markdown 不包含内部 hash、字节范围、schema、prompt 或本地路径。

结构化产物由 worker 保存正式文字稿 SHA-256，以及全部输入片段的 ID、UTF-8 起止字节与
片段 SHA-256，不复制片段正文。当前会话和历史恢复均重新比较全文摘要；变化后显示
“文字稿已更新，解剖可能过时”，保留旧报告并禁用原文定位。

原文定位只能在同一任务内执行，须同时验证全文摘要、字节边界和片段摘要。可定位首个引用
片段并查看全部引用，不跨任务、不将 chunk ID 用作 ASR segment ID。

## 原子提交与恢复

新 JSON、Markdown 与 task manifest 通过既有任务 transaction journal 一并原子提交。
任何失败或取消均保留旧成功版本。正式文字稿保存不会删除旧报告，应用重启后从受验证
manifest 恢复并重新判断过时状态。

| 条件 | 行为 |
| --- | --- |
| 正式文字稿非法、缺失、为空或超限 | checkout 前返回安全错误 |
| 登录、配置或额度失败 | 显示既有专用错误，保留旧产物 |
| 供应商失败、超时或阻断 | 本 target 失败，保留已消费额度和旧产物 |
| 无效报告或引用 | agent 在六次预算内修改，仍无有效交付则失败 |
| 用户取消或 watchdog 超时 | 终止 worker 进程树，停止后续调用，保留完整旧版本 |
| 提交中断 | journal 恢复完整版本，禁止暴露半套新结果 |
| 其他 target 已成功 | 其产物继续可用，解剖错误只归属本 target |

## 隐私与服务边界

FrameQ server 只负责账号、权益、额度与 LLM checkout，不接收文字稿、prompt、报告或
偏好。最终确认后 LLM 供应商收到正式文字稿内容和本轮生成上下文。视频、音频、source
URL、本地绝对路径、偏好、其他任务或其他 AI 产物不进入提示词。

日志、进度、错误、诊断和 telemetry 不包含完整文字稿、prompt、报告、source URL、密钥
或本地绝对路径。解剖复用现有 server-managed checkout、取消、watchdog、manifest 和
任务存储边界；不新增上传接口或直接配置 LLM key 的入口。

## 验收

- 只有受支持、已保存且合法的正式文字稿可确认，空白和超限输入在 checkout 前失败。
- 确认显示实际数据范围、冻结语言、一至六次调用和六次额度预检。
- 真实 agent 通过交付工具完成报告，逐调用独立 checkout，六次硬上限生效。
- schema、片段引用、逐字摘录、集合限制、语言、结构复用提示与完整 Markdown 导出通过测试。
- JSON、Markdown 与 manifest 完整原子提交；取消、失败和中断保留旧版本。
- 当前会话和应用重启后正确检测过时，只有完整溯源校验通过才可定位同任务原文。
- FrameQ server 继续只处理账号和额度；其他 target 与本地文字稿不受解剖失败影响。

## References

- `docs/design-docs/2026-07-31-transcript-dissection-feature.md`
- `docs/product-specs/2026-10-25-intelligent-extraction-agent-runtime.md`
- `docs/product-specs/2026-07-11-local-transcript-ai-workspaces.md`
- `docs/product-specs/2026-07-15-desktop-i18n-ai-output-language.md`
- `docs/product-specs/2026-07-22-release-reliability-hardening.md`
