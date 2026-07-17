# 桌面端多语言与 AI 输出语言

## Background

FrameQ 桌面端当前以中文硬编码文案为主，worker 进度也会把中文自然语言直接发送给 UI。
这使界面无法可靠切换语言，也让桌面端与 worker 对展示文案形成了不必要的耦合。
同时，要点总结、Mermaid 思维导图与启发灵感没有显式、类型化的输出语言契约，用户可能在
消耗 AI Credits 后才发现结果语言与当前界面不一致。

本次功能为桌面端加入离线内置的简体中文、繁体中文和美式英语资源，并让用户当前实际使用的
界面语言成为新发起 AI 结果的输出语言。视频、音频、平台字幕、ASR 文字稿、历史 AI 结果与
用户内容不被翻译。

## Goals

- 支持 `zh-CN`、`zh-TW`、`en-US` 三种界面语言，并提供 `跟随系统` 偏好。
- 语言切换无需刷新；显式偏好在重启后恢复，损坏偏好安全回退并可被用户修复。
- UI 文案、无障碍文案、进度与已知错误使用稳定语义 key/code，而不是业务状态中的中文句子。
- 用户确认要点总结或启发灵感前，明确展示本次实际 AI 输出语言。
- `retry_insights` 通过严格 contract v2 接收必填 `output_language`，三层拒绝缺失或非法值。
- 不增加翻译服务、语言检测或额外 LLM 调用，AI Credits 仍只按现有供应商调用尝试计数。
- 保持 FrameQ 本地优先、SourceIdentity、stdin、ProcessSupervisor 与 server 数据边界不变。

## Non-goals

- 不翻译用户输入、平台字幕、ASR 文字稿、旧历史结果、已有 AI artifact 或 Release Notes。
- 不增加独立的“内容语言”设置；新 AI 输出跟随确认时解析后的实际 UI locale。
- 不翻译安装器、原生 OS 对话框或第三方组件自身提供的系统文案。
- 不保证 LLM 供应商百分百遵守语言指令，不因语言检测自动重试、二次翻译或再次扣费。
- 不在本次实现 `生成文字稿` / draft target；只要求未来实现复用相同的 `output_language` 契约。
- 不迁移或重写已有任务 manifest，不因切换语言使本地缓存或历史 artifact 失效。

## Locale Model

```ts
type SupportedLocale = "zh-CN" | "zh-TW" | "en-US";
type LanguagePreference = "system" | SupportedLocale;

type UiPreferencesView = {
  schemaVersion: 1;
  language: LanguagePreference;
  recovered: boolean;
};
```

`language` 是用户保存的选择；实际 UI locale 在运行时解析。系统语言映射固定为：

- `zh-Hant`、`zh-TW`、`zh-HK`、`zh-MO` 及其区域变体映射为 `zh-TW`。
- `zh-Hans`、`zh-CN`、`zh-SG`、裸 `zh` 及其区域变体映射为 `zh-CN`。
- `en-*` 与其他未支持语言映射为 `en-US`。

语言匹配必须规范化大小写和 `_` / `-` 分隔符，并按浏览器或 OS 给出的语言优先级顺序解析。
所有三种 locale 均为 LTR；切换时同步更新 `<html lang>` 与 `dir="ltr"`。

## Local Preference and Startup

Tauri 在 app-local data 根目录管理独立的 `ui-preferences.json`：

```json
{
  "schemaVersion": 1,
  "language": "en-US"
}
```

- 新增 `get_ui_preferences()` 与 `save_ui_preferences({ preferences: { language } })`。
- 文件缺失返回 `en-US` 且 `recovered: false`；这属于正常首启，设置页初始选中 `English`。
- JSON 损坏、未知 schema 或非法语言返回 `en-US` 且 `recovered: true`，读取时不覆盖原文件。
- 下一次合法保存原子替换该文件并清除恢复状态。
- 已保存的 `system`、`zh-CN`、`zh-TW` 或 `en-US` 均按原值加载；默认值变更不得迁移或覆盖
  已有用户选择，`跟随系统` 仍是可手动选择的合法选项。
- 偏好不得写入 `.env`、FrameQ server、任务目录、任务 manifest、账号状态或灵感档案。
- Rust 只接受 `system` 与三个 `SupportedLocale`，不接受任意 BCP 47 字符串。

窗口启动时先显示仅含 `FrameQ` 的中性 bootstrap shell。偏好在 1.5 秒内返回时，使用解析后的
locale 初始化 i18next 后再挂载主 React UI；超时或失败时按 `en-US` 启动，忽略迟到响应，并显示
非阻塞恢复提示。启动不能因为偏好 I/O 出现白屏或在迟到响应后突然二次切换。

## Settings Experience

设置“基础”页顶部新增 `界面与 AI 结果语言`，选项为 `跟随系统 / 简体中文 / 繁體中文 /
English`。选择后：

1. 立即切换当前 UI 和 `<html lang>`。
2. 顺序排队保存请求；每次操作携带递增序号。
3. 前端单独保存“最近一次成功持久化值”作为回滚基准；只有成功写盘才能推进该基准，失败响应
   不得推进它。
4. 旧响应不得覆盖更新选择；非最新失败不得回滚 UI。只有最新操作保存失败时，才回滚到
   最近一次成功持久化值并显示本地化错误，确保 UI 与磁盘重新一致。
5. 并发/队列测试必须覆盖：A 已成功持久化，用户依次选择 B、C，B 的过期保存失败被忽略，
   C 的最新保存也失败，最终 UI 与磁盘都回到 A，而不是未持久化的 B。
6. 显式 locale 不受后续系统语言变化影响；`system` 偏好响应可用的 `languagechange` 事件，
   其他环境在下次启动重新解析。

切换语言不得提交、清空或重置正在编辑的 URL、ASR 模型、输出目录、文字稿草稿、偏好向导或
当前任务。日期、数字、复数、字数与字节显示使用实际 locale 格式化。

## Terminology

以下术语为产品词汇表，繁体中文使用独立人工词库，不在运行时自动简繁转换：

| zh-CN | zh-TW | en-US |
|---|---|---|
| 智能提炼 | AI 提煉 | AI Synthesis |
| 本地文字稿 | 本機逐字稿 | Local Transcript |
| 要点总结 | 重點摘要 | Key Summary |
| 启发灵感 | 靈感啟發 | Inspiration |
| 灵感档案 | 靈感檔案 | Inspiration Profile |
| 历史任务 | 歷史任務 | History |
| 换个方向 | 換個方向 | Try Another Direction |
| 生成文字稿 | 產生文稿 | Generate Draft |

`FrameQ`、`AI Credits`、ASR、LLM、Mermaid、模型名、平台品牌名、路径与邮箱不翻译。

## UI Resource and State Rules

- 使用 `i18next + react-i18next`，三套 TypeScript 资源随安装包静态打包；运行时不请求远程词库。
- 资源按 App、设置、账号、历史、模型下载、文字稿、AI 工作区、灵感偏好、更新、通知与错误等
  功能 namespace 拆分，三种语言的 key、插值参数与复数键必须一致且非空。
- 所有用户可见文本、`aria-label`、`title` 与 `placeholder` 从资源读取。
- 状态层保存 `{ messageCode, args }` 或领域状态，不保存渲染完成的中文句子；切换语言后当前
  通知和进度同步重渲染。
- 翻译资源不得包含任意 HTML。受控富文本使用 `Trans` 组件，不使用
  `dangerouslySetInnerHTML`。
- 灵感选项使用稳定 ID。UI label 可按 locale 变化，但用于 prompt 的规范化 label snapshot
  与 UI 词库分离；同一结构化偏好在三种 UI 语言下必须产生相同快照。
- 英文长文案在最小窗口 `720x640` 下应可换行、滚动、聚焦，无横向溢出或不可达操作。

## Progress and Error Contract

`contracts/desktop-worker-contract.json` 升级为 `contractVersion: 2`。worker 处理进度必须为：

```ts
type ProgressEvent = {
  stage: WorkflowStage;
  progress: number;
  message_code: string;
  message_args?: Record<string, string | number>;
};
```

共享 wire stage enum 不包含 `cancelling`；该值只属于桌面 ProcessSupervisor/UI 的本机过渡态，
不得由 Python worker 作为进度事件发出。

模型下载事件保留 `status`、`progress` 与可选 `current_file`，并同样使用必填 `message_code`
及可选 `message_args`；`status` 只接受 `started/downloading/extracting/completed/cancelled`。
共享 contract 登记全部允许的三段式 `domain.action.state` code。每个模型下载 code 同时固定唯一
`status` 和 `current_file` 策略：只有 `model.file.downloading/completed` 必须携带
`current_file`，其他 code 禁止该字段，形成按 `message_code` 判别的联合。

`message_args` 是 `additionalProperties: false` 的闭合 object，并按 key 约束：

- `model` 只允许公开安全 ID `iic/SenseVoiceSmall` 或
  `iic/speech_fsmn_vad_zh-cn-16k-common-pytorch`。
- `language` 长度为 2-35，只匹配短安全 tag
  `^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$`。
- `attempt` 与 `total` 是 1-100 的整数；未知参数一律拒绝。

顶层 `current_file` 不在 `message_args` 中重复，长度为 1-255，必须是跨平台 basename：拒绝
`/`、`\\`、控制字符、`.` 与 `..`。URL、完整路径、Cookie、凭据、prompt、文字稿或生成正文
不得进入进度参数。producer 产生的非法事件必须被拒绝；consumer 收到非法事件必须丢弃并记录
安全的 message code，不得以原始自然语言降级展示。
contract 的 `forbiddenContent` 固定包含 `url`、`full_path`、`cookie`、`credential`、
`transcript_content`、`prompt`、`generated_content`、`request_headers` 和 `preference_prose`。

前端将非法进度事件整体丢弃，只记录安全 code；结构合法但 code 未登记的事件使用其已校验的
stage/status/progress 显示对应阶段级或状态级本地化通用文案，并记录安全 code。两种情况都不得显示
worker 的原始自然语言，非法事件也不得改变最近一次合法状态或时间戳。
已知错误码显示本地化、可操作的主要说明；未知错误显示通用说明与错误码。安全清洗后的原始错误
可放在本地化的“技术详情”折叠区，不得成为主要指导，也不得未经清洗直接渲染。

## AI Output Language

`retry_insights` 的 stdin wire shape 为：

```ts
type RetryInsightsRequest = {
  task_id: string;
  target: "summary" | "insights";
  output_language: "zh-CN" | "zh-TW" | "en-US";
  preference_snapshot?: PreferenceSnapshot;
};
```

- shared contract 以闭合 object schema 描述该请求：`task_id` 为 string，`target` enum 为
  `summary | insights`，`output_language` 为三语言 enum，`preference_snapshot` 是可选 object，
  且只有 `insights` 可携带；未知顶层字段因 `additionalProperties: false` 被拒绝。
- `output_language` 在 TypeScript、Rust、Python 三层均必填；缺失或非法值固定、非回显地失败。
- contract v2 不为旧调用提供默认值；桌面端与内置 worker 必须作为同一版本发布。
- `preference_snapshot` 仍只允许 `insights` target；现有 `ProcessRequest.language` 只属于转写配置，
  不得复用为 AI 输出语言。
- summary 与 insights 确认页显示当前解析后的实际语言名称，而不是 `system` 字样。
- 用户点击最终确认时冻结当前 actual locale；生成中切换 UI 不改变已发起请求，下一次重试使用
  重试确认时的新 locale。
- worker 为三个 enum 值提供固定 prompt 语义：简体中文、台湾繁体中文、清晰的美式英语。
- 语言约束覆盖 summary、Mermaid 节点、topic planner 与结构化 Insight 的所有用户可见字段；
  JSON key 与 artifact schema 保持不变。
- 语言遵循是 best-effort prompt 约束。FrameQ 不做输出语言检测、自动重试或二次翻译；供应商
  未遵循时保留结果，由用户决定是否再次确认重试。
- 不增加 LLM 调用，因此现有 AI Credits 计数与扣费语义不变。
- `output_language` 不写入任务 manifest，不改变已有 artifact 的缓存与历史读取规则。

诊断日志最多记录 `target + output_language + structured error code`，不得记录 prompt、文字稿、
生成正文或偏好全文。

## Privacy and Data Flow

UI 资源和语言偏好完全本地。切换 UI 语言不触发网络请求。仅当用户确认现有 AI target 后，
`output_language` 与该 target 已允许的内容一起进入当前 worker 请求；FrameQ server 不新增语言偏好
或用户内容字段。LLM supplier 接收的 transcript 片段和偏好边界保持既有规格，不因多语言扩大。

## Acceptance Criteria

- 简中、繁中、英文可即时切换且无需刷新，`<html lang>`、格式化与无障碍文案同步更新。
- 首启缺失偏好、损坏偏好、未知 schema、启动超时、保存失败与连续快速切换均有确定行为；
  A 已持久化、B 过期失败、C 最新失败时 UI/磁盘最终均为 A。
- 重启恢复最新成功保存的显式语言；`system` 使用启动时或 `languagechange` 后解析的实际 locale。
- 三套词库 key、插值、复数一致；主窗口、设置、账号、历史、文字稿、AI 工作区与确认页覆盖完整。
- Python/Rust 生产者在运行时拒绝未登记或字段组合非法的进度事件；TypeScript 消费者整体丢弃
  非法事件、只记录安全 code，并保持最近一次合法 stage 的本地化 fallback。
- summary 与 insights 确认页显示本次实际输出语言，请求携带确认时冻结的 `output_language`。
- 三种合法语言通过；TypeScript、Rust、Python 的实际请求边界拒绝缺失、非法、target 不兼容或
  含额外字段的请求；旧调用无兼容默认值。
- summary、mindmap、topic planner、insights prompt 均包含对应固定语言语义，且无语言检测/翻译调用。
- ASR、字幕选择、官方文字稿、旧历史结果、Credits 调用次数与 task manifest 均不因切换语言改变。
- `720x640` 下英文 UI 无横向溢出、裁切或不可达操作；真实 Tauri 窗口完成键盘导航检查。
