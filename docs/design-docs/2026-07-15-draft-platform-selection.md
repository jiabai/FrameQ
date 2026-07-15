# 文字稿生成：目标平台可改 + suitableUse 映射重做 设计方案

## Status

2026-07-15 完成需求盘问并锁定决策，待实现。是 `2026-07-12-generate-draft-from-inspiration` 的增量优化，只动「平台来源 + 平台→文体映射」这一条链路。

相关文档：执行计划 [`2026-07-15-draft-platform-selection-plan.md`](../exec-plans/active/2026-07-15-draft-platform-selection-plan.md)、产品规格 [`2026-07-15-draft-platform-selection.md`](../product-specs/2026-07-15-draft-platform-selection.md)。

## 1. 背景

`生成文字稿`（父规格）落地后，稿子的「目标平台」由 `Insight.suitable_use`（灵感生成时 LLM 产出的中文字符串）静默决定：

- `worker/frameq_worker/insightflow/prompt.py:274` 的 `_SUITABLE_USE_PLATFORM_LABELS`：`{"公众号":"微信公众号","抖音":"抖音","小红书":"小红书","视频号":"视频号"}`，未知值原样透传。
- 两处消费：`prompt.py:306`（user prompt 的「目标平台」行）、`draft_agent.py:164`（system prompt 的「目标平台」行）。

问题：

1. 用户在确认页**看不到也改不了**平台。
2. `suitable_use` 词表（公众号/抖音/小红书/视频号）与灵感档案 `platforms` 词表（`douyin/xiaohongshu/wechat_channels/bilibili/wechat_official_account/podcast/course_community/internal_sharing`，`app/src/insightPreferences.ts:181`）是两套不对齐的词表，档案配的平台无法影响稿子平台。
3. `suitable_use` 是 LLM 自由产出的字符串，词表无强约束，映射靠精确匹配 `.get()`，易因 LLM 输出微小偏差（如「小红书（图文）」）落到兜底。

## 2. 目标

- 平台变成**用户在确认页可见、可改的单选项**，默认值由灵感档案推导。
- 平台→文体映射切换到一套与用户选项对齐的**新词表**，覆盖短视频系统一走「抖音」文体。
- 不破坏父规格的本地优先、隐私、额度、单种子、错误归属边界；平台是请求态，不落盘。

## 3. 范围

### 3.1 做

- 前端：`DraftConfirmationSheet` 加 9 选 1 平台控件 + 默认推导（读档案）。
- wire contract：`RetryInsightsRequest`（前端 TS / Rust / worker Python 三端）新增 `platform` 字段，仅 `target="draft"` 携带。
- worker：新增「平台 id → prompt 文体标签」映射函数，取代 `_platform_label_for_suitable_use`；prompt 构造与 system prompt 改以传入 `platform` 为唯一平台来源。
- 词表：draft 平台配置（id + 显示名）单独一份，不复用 `INSIGHT_PREFERENCE_FIELDS.platforms`。

### 3.2 不做

- 不持久化平台（manifest / draft artifact / 档案回写均不涉及）。
- 不改档案 `platforms` 词表；不动灵感生成 prompt（`suitable_use` 仍由灵感链路产出，只是成稿不再消费它做平台）。
- 不做多平台一次生成多篇；不改额度模型；不改确认页隐私文案。
- 不删 `Insight.suitable_use` 字段。

## 4. 平台词表

draft 平台独立词表（9 项）。前端配置一份 `DRAFT_PLATFORMS: {id, label}[]`，worker 侧配置对应 id 集合 + 映射表。id 与档案 `platforms` 在 5 项上复用（`douyin/xiaohongshu/wechat_channels/bilibili/wechat_official_account`），便于默认推导恒等映射。

| id | 显示名 | 可否由档案推导 |
|---|---|---|
| `bilibili` | B站 | 是（档案 `bilibili`） |
| `xiaohongshu` | 小红书 | 是（档案 `xiaohongshu`） |
| `wechat_official_account` | 公众号 | 是（档案 `wechat_official_account`） |
| `wechat_channels` | 视频号 | 是（档案 `wechat_channels`） |
| `douyin` | 抖音 | 是（档案 `douyin`） |
| `youtube` | Youtube | 否（档案无此项，仅手动改选） |
| `tiktok` | Tiktok | 否（档案无此项） |
| `twitter` | X(Twitter) | 否（档案无此项） |
| `other` | 其他 | 否（兜底默认） |

档案不可映射项：`podcast / course_community / internal_sharing` → 默认 `other`。

## 5. 默认推导规则

确认页打开时（前端读 `getInsightPreferences()`）：

```
platforms = profile?.platforms ?? []
if length(platforms) == 1 and platforms[0] in DRAFT_PLATFORM_IDS:
    default = platforms[0]            # 恒等映射
else:
    default = "other"                 # 0 / ≥2 / 不可映射
```

> 决策（盘问第 3 刀）：≥2 个时不替用户猜优先级，直接 `other` 让其自选；恰好 1 个可映射才预选。

## 6. 平台→文体映射（worker）

新增 `_platform_label_for_draft_platform(platform_id) -> str`（位于 `insightflow/prompt.py`），取代 `_platform_label_for_suitable_use`：

```python
_DRAFT_PLATFORM_LABELS = {
    "wechat_official_account": "微信公众号",
    "xiaohongshu": "小红书",
    "wechat_channels": "抖音",
    "douyin": "抖音",
    "tiktok": "抖音",
    "twitter": "抖音",
    # bilibili / youtube / other → 透传显示名（兜底）
}
```

兜底：未命中的 id 取其显示名（`bilibili`→「B站」、`youtube`→「Youtube」、`other`→「其他」）原样写进 prompt 的「目标平台：{label}」行，不挂 skill、走 LLM 通用文体（对齐父规格 R3 的「其余取值走通用兜底」）。

> `twitter`(X) 归抖音组：产品定位为视频文案，X 在本场景按短视频脚本处理（盘问第 4 刀，用户确认）。`wechat_channels`(视频号) 从原「视频号」改为「抖音」：合并进短视频文体，视频号不再单独成风格。

## 7. 改动点（代码级）

### 7.1 worker

- `insightflow/prompt.py`：
  - 新增 `_DRAFT_PLATFORM_LABELS` + `_platform_label_for_draft_platform(platform)`。
  - `build_draft_from_inspiration_prompt(seed, preference_snapshot, summary, platform)` 增参 `platform: str`；「目标平台」行改用 `_platform_label_for_draft_platform(platform)`，不再读 `seed.suitable_use`。
  - 保留或移除 `_platform_label_for_suitable_use`：成稿链路不再用；若别处无引用则删除，避免误导。
- `draft_agent.py`：
  - `_build_system_prompt(insight, summary, platform)` 增参 `platform`；「目标平台」行改用新映射。
  - `run_draft` / `run_draft_generation_step` 把 `request.platform` 透传到 prompt 构造。
- `models.py:134` `RetryInsightsRequest`：新增 `platform: str | None = None`（`target=="draft"` 时必填）。
- `requests.py:181` `parse_retry_insights_request`：
  - `target=="draft"` 时校验 `platform` 存在且 ∈ 9 个合法 id，否则 `ValueError`（→ `INVALID_RETRY_PAYLOAD`，checkout 前失败、不扣额度）。
  - `summary` / `insights` target 携带 `platform` 视为非法（保持非 draft 请求字节不变）。
- `worker_service.py:210` draft 分支：把 `request.platform` 传入 `run_draft_generation_step`。

### 7.2 Rust / Tauri

- `app/src-tauri/src/video_processing.rs:41` `RetryInsightsRequest`：新增
  ```rust
  #[serde(skip_serializing_if = "Option::is_none")]
  platform: Option<String>,
  ```
  仅 `target="draft"` 序列化进 wire（与 `insight_id` 同模式）。
- `worker_command.rs`：序列化透传 `platform`（raw `Value`，不做语义解析）；日志白名单不打印 prompt 全文（父规格 4.3 不变）。
- 补 `retry_insights_request_*` 系列测试：`target="draft"` 时 `platform` 出现在 wire、非 draft target 时缺省。

### 7.3 前端

- `workerClient.ts`：`RetryInsightsRequest` 类型新增 `platform?: string`；`retryInsightGeneration` 在 `target="draft"` 时带上 `platform`（与 `insightId` 并列，仍不发 `preferenceSnapshot`）。
- `DraftConfirmationSheet.tsx`：
  - 新增平台单选控件（chip 风格，复用 `InspirationProfileForm` 的选中态样式）。
  - 打开时调 `getInsightPreferences()` 按第 5 节推导默认值，置入本地 state。
  - `onConfirm` 把选中平台回传控制器。
- 控制器（`App.tsx` 中 draft 确认接线 → `retryInsightGeneration`）：透传 `platform`。
- draft 平台词表配置（id + 显示名）单独一份，供确认页与默认推导共用。

## 8. 关键约束

- **平台是请求态**：不落盘、不进 manifest、不回写档案、不上传 server。
- **额度不变**：平台非法时在 checkout 前校验失败，不扣额度（对齐父规格 invalid-seed 不扣额度的代码顺序）。
- **隐私不变**：确认页数据文案不动；平台标签会进 prompt，但日志按既有白名单处理。
- **`suitable_use` 不删**：仍由灵感链路产出与展示，成稿链路只是不再消费它做平台。

## 9. 备选方案（已否决）

- **A：用户选的平台与 `suitable_use` 并存**（suitable_use 管体裁、平台管目标平台）。否决：两套平台语义并存会冲突且难解释；盘问第 1 刀确认用户选 A——平台**取代** suitable_use。
- **B：多平台一次生成多篇**。否决：撞 quota / manifest / 重试模型，且与「1 seed → 1 篇」契约冲突；盘问第 2 刀确认单选。
- **C：`other` 兜底改中性措辞或省略「目标平台」行**。否决：盘问第 5 刀用户选 c（维持透传），接受「目标平台：其他」的轻微语义空档。
- **D：扩档案 `platforms` 词表以支持 Youtube/Tiktok/X 自动预选**。否决（本次）：档案词表改动影响面大且与本次目标正交；本次 4 个新平台仅手动改选可达，留作未来项。

## 10. 风险与权衡

- **R1（兜底粗糙边）**：`other` 透传渲染「目标平台：其他。请按该平台文体…」语义略空。用户已知悉接受；未来若要收尾，可在兜底分支换成中性措辞（设计第 9 节方案 C）。
- **R2（词表漂移）**：平台 id 是枚举，前端与 worker 各维护一份词表，需保证 id 一致（测试覆盖：worker 拒绝非 9 项之一的 id）。
- **R3（向后兼容）**：历史 draft 无 `platform` 字段，但本次不持久化、且重开 draft 走「重新推导默认 + 用户改选」，无旧数据迁移问题；老 `suitable_use` 驱动的成稿行为随本次切换一并更新（无灰度，可接受）。
- **R4（X→抖音的语义拟合度）**：X 是文字平台，归抖音短视频风格属产品取舍；若后续 X 文案质量不佳，可单独将其改归兜底（仅改一行映射）。

## 11. 验收（对齐 product-spec Acceptance Criteria）

- 确认页 9 选 1 平台控件 + 默认推导正确（档案 1 个可映射→预选，其余→`other`）。
- 改选不回写档案、不落盘；重开/重试重新推导。
- 映射符合第 6 节表；`target="draft"` 携带合法 `platform`，缺失/非法/非 draft 出现时明确报错且不扣额度。
- 父规格全部验收项继续通过；`activeAiTarget="draft"` 类型不变。
