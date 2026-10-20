# 文字稿生成的目标平台选择（draft 平台可改）

> 本规格是 `2026-07-12-generate-draft-from-inspiration.md` 的增量优化。父规格定义了 `生成文字稿` 这张 target 卡片与单条 `Insight` 种子、额度、隐私边界；本规格只改动「目标平台从哪来、怎么映射、用户能否改」这一条链路，不重述父规格的其他内容。冲突时以本规格为准。

> 相关文档：执行计划 [`2026-07-15-draft-platform-selection-plan.md`](../exec-plans/active/2026-07-15-draft-platform-selection-plan.md)、设计方案 [`2026-07-15-draft-platform-selection.md`](../design-docs/2026-07-15-draft-platform-selection.md)。

## Background

父规格落地后，`生成文字稿` 的「目标平台」是由 `Insight.suitable_use`（生成灵感时 LLM 产出的中文字符串，词表约为 公众号 / 抖音 / 小红书 / 视频号）在 worker 侧静默决定的：`worker/frameq_worker/insightflow/prompt.py` 的 `_SUITABLE_USE_PLATFORM_LABELS` 把它映射成 prompt 里的「目标平台：XX」，`draft_agent.py` 的 system prompt 同样消费它。**用户在确认页看不到、也改不了平台**，且 `suitable_use` 的词表与用户在灵感档案里配置的 `platforms`（`douyin / xiaohongshu / wechat_channels / bilibili / wechat_official_account / podcast / course_community / internal_sharing`）是两套互不对齐的词表。

本次优化把「目标平台」变成**用户在 `生成文字稿` 确认页可见、可改的单选项**，并重做平台→文体映射：

- 平台来源从 `Insight.suitable_use` 切换为**用户在确认页选择的平台**；`suitable_use` 在成稿链路退役（仍留在 `Insight` 上做展示/他用，不删除字段）。
- 确认页默认值由灵感档案的 `platforms` 推导：档案**恰好 1 个且可映射**时预选它，否则默认「其他」。
- 用户改选平台**只影响本次稿子生成**，不回写灵感档案。
- 平台→prompt 文体映射重做（见 Platform→Form Mapping）。

## Goals

- 让用户在生成稿子前**看到并修改**目标平台，而不是由 `suitable_use` 在后台静默决定。
- 默认值尽量贴合用户既有偏好：灵感档案恰好配了 1 个可映射平台时，确认页直接预选它，减少手动操作。
- 把平台→文体的映射收敛到一套与用户选项对齐的新词表，覆盖短视频系（抖音 / 视频号 / Tiktok / X）统一走「抖音」文体。
- 严格保持父规格的本地优先、隐私、额度、单种子、错误归属边界：平台是一个请求态字段，不落盘、不进 manifest、不回写档案、不上传 FrameQ server。

## Non-goals

- **不持久化平台选择**：不写进 draft manifest、不写进任务 manifest、不回写灵感档案；重开历史 draft / 重试时重新走默认推导 + 用户改选。
- **不改灵感档案 `platforms` 词表**：档案仍维持现有 8 项；draft 平台是**独立的新词表**（9 项，含 Youtube / Tiktok / X(Twitter) / 其他），与档案词表部分重叠但互不等同。
- **不做多平台一次生成多篇**：draft 仍是 1 seed → 1 平台 → 1 篇 → 1 额度（父规格 Quota 不变）。
- **不改父规格的隐私/额度/种子校验/错误归属**：确认页数据提示文案保持现状（不新增平台相关的数据披露行）；额度仍为「1 次尝试 = 1 额度，不论成败」。
- **不删除 `Insight.suitable_use` 字段**：它仍在灵感生成与展示中使用，只是不再作为成稿平台来源。

## Platform Vocabulary

`生成文字稿` 确认页提供 **9 个单选项**（稳定英文 id + 中文显示名，id 风格与档案 `platforms` 对齐）：

| id | 显示名 |
|---|---|
| `bilibili` | B站 |
| `xiaohongshu` | 小红书 |
| `wechat_official_account` | 公众号 |
| `wechat_channels` | 视频号 |
| `douyin` | 抖音 |
| `youtube` | Youtube |
| `tiktok` | Tiktok |
| `twitter` | X(Twitter) |
| `other` | 其他 |

> 与档案 `platforms` 的关系：`douyin / xiaohongshu / wechat_channels / bilibili / wechat_official_account` 5 项 id 复用，便于默认推导恒等映射；`youtube / tiktok / twitter / other` 4 项是 draft 独有，**档案词表里没有**，只能由用户在确认页手动改选，无法从档案自动预选。档案里的 `podcast / course_community / internal_sharing` 在 draft 词表里**无对应项**，归为不可映射。

## Default Platform Derivation

确认页打开时，按灵感档案 `platforms` 推导默认选中项（前端读取本地偏好，复用 `getInsightPreferences`）：

1. 档案 `platforms` 为空 / 档案被跳过 / 档案不存在 → 默认 `other`。
2. 档案 `platforms` 恰好 1 个且**可映射**（id 属于上述 9 项的交集）→ 预选该 id（恒等映射：`douyin→douyin`、`xiaohongshu→xiaohongshu`、`wechat_channels→wechat_channels`、`bilibili→bilibili`、`wechat_official_account→wechat_official_account`）。
3. 档案 `platforms` 恰好 1 个但**不可映射**（`podcast / course_community / internal_sharing`）→ 默认 `other`。
4. 档案 `platforms` ≥ 2 个 → 默认 `other`（不替用户猜优先级，让其自己挑）。

默认推导**只读档案、不写档案**。

## User Modification

- 确认页的平台选择是**可修改的单选**（chip / radio 风格，与灵感档案选项控件一致）。
- 用户改选后，**本次生成请求**携带新平台；不回写灵感档案 `platforms`，也不写任何持久化存储。
- 平台始终有值（默认 `other` 兜底），不存在「未选平台」的空态，故不引入新的校验阻断。

## Platform→Form Mapping

worker 侧把用户选的平台 id 映射成 prompt 里的「目标平台」文体标签，取代原 `_platform_label_for_suitable_use`（以 `suitable_use` 为输入）：

| 选的平台 id | prompt「目标平台」 |
|---|---|
| `wechat_official_account` | 微信公众号 |
| `xiaohongshu` | 小红书 |
| `wechat_channels` / `douyin` / `tiktok` / `twitter` | 抖音 |
| `bilibili` / `youtube` / `other` | 透传显示名（兜底） |

兜底分支沿用父规格的「原样透传」语义：prompt 写成「目标平台：{显示名}」（如 `other` →「目标平台：其他」），不挂特定平台 skill，走 LLM 通用文体。> 已知粗糙边：`other` 透传会渲染「目标平台：其他。请按该平台文体…」，语义略空，但用户在盘问中明确接受（产品定位为视频文案，`other` 极少被主动选用）。

> `twitter`(X) 归入「抖音」组是产品决定：本场景稿子主要服务于视频文案，X 在此处按短视频脚本风格处理，而非文字 Thread。

## Data and Wire Boundary

- **请求态字段**：前端在 `target="draft"` 的 `RetryInsightsRequest` 上**新增 `platform: string`**（9 个 id 之一），与既有 `insight_id` 并列；`preference_snapshot` 仍**不发送**（父规格 A1 不变，由 worker 从盘读）。
- **不持久化**：`platform` 不进 draft artifact、不进任务 manifest、不进 draft manifest；与父规格「manifest 增加 `draft_path` / `has_draft` / `draft_seed_insight_id`」无关，本规格不新增任何 manifest 字段。
- **不上传 server**：FrameQ server 仍只负责账号/权益/配额/LLM+anysearch checkout，不接收、不存储平台选择，不为此新增接口或字段。
- **隐私不变**：平台 id 非用户敏感数据，但遵循父规格「日志不得输出完整 prompt」纪律——平台标签会出现在 prompt 中，日志按既有字段白名单处理，不额外打印 prompt 全文。

## Validation Rules (new)

- `target="draft"` 请求**必须**携带 `platform`，且值属于 9 个合法 id 之一；缺失或非法时 worker 返回明确错误（如 `INVALID_DRAFT_PLATFORM`），且**不消耗额度**（在 checkout 之前校验，对齐父规格「invalid seed 不扣额度」的代码顺序原则）。
- `platform` 字段**只允许出现在 `target="draft"`**；`summary` / `insights` 请求携带 `platform` 视为非法（保持非 draft 请求与历史契约字节一致）。
- 默认推导只读档案：档案缺失/被跳过时不得伪造平台偏好，统一降级为 `other`。
- worker 不再从 `Insight.suitable_use` 推导成稿平台；prompt 构造与 system prompt 均以传入的 `platform` 为唯一平台来源。

## Acceptance Criteria

- `生成文字稿` 确认页展示 **9 选 1** 的目标平台控件；默认值按 Default Platform Derivation 推导（档案恰好 1 个可映射→预选，其余→`other`）。
- 用户改选平台后，本次生成按新平台映射成稿；改选**不回写**灵感档案，重开/重试时重新推导默认。
- worker 的平台→文体映射符合 Platform→Form Mapping：公众号→微信公众号、小红书→小红书、视频号/抖音/Tiktok/X→抖音、B站/Youtube/其他→透传兜底。
- `target="draft"` 请求携带合法 `platform`；缺失/非法/在非 draft target 出现时返回明确错误且不扣额度。
- `platform` 不落盘、不进 manifest、不上传 server、不回写档案。
- 父规格的全部验收项继续成立（单种子、额度 1 次/尝试、隐私边界、`JobStage.DRAFT_GENERATING` 错误归属、`activeAiTarget="draft"` 类型）。
- 确认页数据提示文案与父规格一致，不新增平台相关披露行。
