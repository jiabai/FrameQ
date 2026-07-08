# FrameQ Design Guidelines

## 2026-07-05 Diagnostics UX

- The main task workflow should not add a new diagnostic panel for normal use.
- Failure copy remains concise and actionable in the existing result workspace.
- Local desktop logs are support evidence, not a result tile, export action, or task artifact.
- When a support flow asks for diagnostics later, it should point to the app-local log path rather than asking users to inspect bundled resources.

## 2026-07-05 Task Library and Artifact UX

- Result tiles should represent artifacts within the current task, not independent loose files.
- The primary locate action should reveal the task folder or the selected manifest artifact inside that folder.
- History should read as a task library: each row represents one processed source URL, with status, preview, artifact availability, and task folder context.
- Re-submitting the exact same URL may restore the newest usable local task immediately instead of showing another full download/transcription run.
- During active processing, the toolbar new-task/reset button must be disabled. The task monitor cancel button is the only control that may terminate the running worker.
- The UI should not mention or expose legacy flat output compatibility. New tasks always use the task folder layout.
- Export/location actions should use saved manifest artifacts. Unsaved transcript edits should still prompt the user to save before locating the official transcript.

## 2026-07-05 Subtitle Source UX

- Subtitle-first transcript reuse should be invisible in the main single-link workflow: no subtitle picker, no platform-specific tab, and no raw `.vtt` / `.srt` result card.
- During `视频转译中`, worker progress copy may say `正在检测平台字幕`, `已检测到字幕，跳过 ASR`, or `未检测到字幕，开始 ASR` while staying inside the existing transcription stage.
- The `完整文字稿` detail view may show a compact source line such as `来源：平台字幕（zh-Hans）` or `来源：本地 ASR`. It should not claim whether the subtitle was manual, automatic, or translated.
- Result card order and behavior remain unchanged. Video and audio entries still locate local files; the transcript entry opens the readable transcript; AI整理 still shows summary and insights only.

## 2026-07-03 Transcript Audio Review UX

- The `完整文字稿` detail tab should remove keyword search. The primary review tools are audio playback, block selection, direct editing, save, copy, and locating the saved transcript file.
- Place the native audio player at the top of the transcript detail content when a validated audio file exists. Keep it compact and persistent above the scrolling transcript blocks.
- Segment blocks should have stable height behavior, clear hover affordance, one primary selected/highlighted state, and a distinct editing state. Highlight should never depend on speaker count or speaker label.
- Clicking a non-editing transcript block seeks to that segment and starts audio. Playback should advance the highlight to the next segment and keep the active block visible without abrupt layout shifts.
- Entering edit mode pauses playback and visually locks the edited block. Saving should show concise success feedback and resume audio only when it was playing before edit.
- Old tasks without segment timing should show a full-text editor and audio player when possible, with click-to-seek affordances hidden or disabled.
- If audio is unavailable, show a quiet local-file status while preserving text editing and save actions.
- Copy should use the current draft text. Export/location should use the saved official transcript and, when unsaved changes exist, prompt the user to save first.
- Settings should describe audio playback copies as a rebuildable app-local cache and keep them separate from user-visible task output folders.

## 2026-06-29 YouTube Download UX

- YouTube support is invisible inside the existing single-link workflow: no YouTube tab, platform picker, stream picker, playlist queue, login prompt, or cookie prompt.
- The input accepts public YouTube watch links, `youtu.be` short links, and Shorts links, while rejecting playlist-only, channel, handle, music, lookalike-host, unsupported-scheme, and empty-short-link inputs before processing.
- Failure copy for `YOUTUBE_*` errors should say the content is not publicly accessible or no playable stream is available, then ask the user to retry with another public video.
- UI copy must not direct users to import cookies, log in to YouTube, solve CAPTCHA, or bypass age/member/private restrictions.
- Mermaid mindmap behavior is unchanged: YouTube transcripts may later generate a local `.mmd` file during AI整理, but the UI still only shows summary and insight content.

## 2026-06-25 Douyin Download Fallback UX

- Douyin share page fallback is invisible by default: the user still submits one URL and sees the existing `视频提取中` stage.
- Worker progress copy may mention `正在解析公开视频分享页`, `正在探测可用视频流`, and `正在保存最高质量视频` when the fallback path is active.
- MVP should not show a stream picker or ask the user to choose a resolution during processing. The default policy is to preserve the highest-quality local video by selecting the largest validated stream.
- If the largest stream fails and the worker retries a smaller candidate, progress copy should remain low-noise and say that FrameQ is retrying another available video stream.
- If all fallback candidates fail, the failure copy should explain that the public share page or playable media stream was unavailable, and should ask the user to retry with a public, authorized link.

## Account and Entitlement UI

- The toolbar exposes account status as a compact utility control, not as a marketing banner.
- Update availability appears as a compact toolbar utility only when action is needed; it must not replace the task monitor or interrupt URL input.
- Login and activation-code monthly pass flows use sheet-style panels consistent with settings/history.
- Browser deep-link return from login must restore and focus the existing desktop window so the account sheet is visible without the user hunting for FrameQ.
- Account copy must clearly distinguish local processing from server-side account and entitlement verification.
- If the user is not entitled, submitting a URL or retrying insights opens the account sheet and does not start worker processing.
- The account sheet shows remaining LLM API-call uses when the user is signed in.
- Desktop settings must not expose insight LLM provider, base URL, API key, model, or timeout; those fields are administrator-managed.
- Desktop settings should expose the app-local `.env` path for non-LLM local settings and provide a locate-file action.
- Desktop settings should include an `应用更新` section with manual check, low-noise status copy, progress, `一键升级`, `稍后提醒`, and `重启完成更新` actions.
- Update installation must be disabled while worker processing or ASR model download is active, with copy explaining that the current task should finish first.
- The account sheet shows email login, activation-code monthly pass redemption, monthly pass expiry, and remaining LLM API-call uses in a stable layout.
- Successful activation-code redemption opens or extends the monthly pass and returns the user to the existing processing workflow without changing the local-first worker UI stages.
- WeChat purchase is paused because of WeChat approval requirements, so the desktop UI must not show a WeChat purchase entry by default.

## Admin Web Compensation UI

- Admin Web should expose manual compensation as a compact support operation, not as a public pricing or sales surface.
- User rows should make current entitlement expiry, quota limit, used quota, and remaining quota easy to scan before adjustment.
- Compensation controls must require a reason and should support a short optional note for bug ID, release version, or support context.
- Additive operations should be visually distinct: "延长天数" and "增加 LLM API 调用次数" should not look like destructive overwrite controls.
- After saving, the row should show the refreshed expiry and remaining quota, plus a short success or validation message.
- Recent adjustment history should be visible to the administrator so repeated compensation can be spotted before applying another change.

<!-- 由 vibe-coding-launcher 生成。 -->

## Product Shape

FrameQ 是安静、清晰、可扫描的工具型桌面应用。首屏直接展示 URL 输入，不做营销式首页。

## Interaction States

UI 必须围绕以下状态组织：

| 状态 | 展示原则 |
|------|----------|
| `等待输入` | 首页内容区只显示 `粘贴视频链接` 输入卡，包含 URL 输入、主按钮和简短等待文案；不显示结果工作区 |
| `视频提取中` | 隐藏输入区，展示下载、校验和音频提取进度 |
| `视频转译中` | 展示 ASR 进度、当前 ASR 模型识别文案，以及模型缓存/加载状态 |
| `AI 整理中` | 可先展示文字稿，要点总结和灵感区域显示生成中 |
| `文字稿完成` | 主界面展示结果总览卡片，不直接铺满全文 |
| `部分完成` | 保留文字稿和已成功生成的 AI 产物，要点总结/灵感卡片展示失败态和重试入口 |
| `失败` | 展示结构化错误原因、重试入口和可修改 URL 路径 |

## UI Rules

- The `要点总结` detail tab must render `summary.md` through the sanitized Markdown renderer with GitHub Flavored Markdown support; raw HTML and Mermaid source must not be rendered in the UI.
- 主按钮文案固定为 `确认`。
- 处理和完成态不再显示 URL 输入区域。
- 完成态主界面展示 `视频文件`、`音频文件`、`完整文字稿`、`要点总结` 和 `启发灵感` 5 个产物入口；视频和音频入口只定位本地文件，不打开详情浮窗。
- 点击结果卡片打开详情浮窗，浮窗内通过 tab 切换内容。
- 详情浮窗内部内容独立滚动，支持 `Esc` 关闭。
- 复制按钮复制当前详情 tab 的文本；无内容时置灰。
- 导出按钮在对应 artifact 生成前置灰；启用后定位当前任务目录中的正式 artifact。
- 进度区优先展示 worker 事件中的具体阶段文案；没有事件时回退到当前阶段默认文案。
- `要点总结` 或 `启发灵感` 待生成或失败时，点击卡片先打开确认面板；用户在确认面板点击 `确认` 后才触发 AI整理，仅重跑总结、Mermaid mindmap 和灵感生成，不重新下载视频、重新提取音频或重新转写。Mermaid 文本只写入本地文件，不在 UI 中展示或渲染。
- 取消任务只在处理中显示；点击后必须终止当前 worker 进程树，返回输入态并保留刚提交的 URL。
- 取消后的晚到进度事件或 worker 结果不得覆盖当前 UI 状态。
- 顶部工具区提供设置入口；设置面板用于管理本机 ASR、输出目录和 app-local `.env` 配置文件位置，启发灵感 LLM 由服务端管理员配置。
- 顶部工具区提供历史入口；历史面板展示最近任务列表，支持查看可用结果和定位输出文件。
- 设置面板字段包含 ASR 模型、结果输出目录和本机配置文件路径；首版 release UI 的 ASR 模型只显示 SenseVoice Small，并展示模型是否已下载、下载入口和 app-local data 缓存位置。
- 设置面板必须提示：这里只管理本机配置；AI 整理确认面板负责提示文字稿片段会发送到管理员配置的云端 LLM 服务。
- 设置面板和历史面板内容必须在弹窗内部独立滚动，不能因字段或记录过多而被裁切。
- 输出目录为空时 UI 应展示默认 `outputs/`；保存自定义目录后应显示已保存路径，并说明只影响新任务。

## Visual Direction

- 工具型桌面应用优先信息密度、清晰层级和稳定布局。
- 避免装饰性 hero、卡片堆叠、纯氛围图和大面积单色渐变。
- 固定格式控件应设置稳定尺寸，避免状态文案导致布局跳动。

## macOS Desktop UI Direction

- 应用外层采用桌面窗口框架：紧凑 toolbar、窗口内容区、任务状态区和结果工作区，而不是网页式居中卡片。
- Tauri 主窗口应使用自定义 chrome：禁用原生 decorations，由应用内 toolbar 承担窗口标题栏视觉，并设置可拖拽区域。
- 自定义 chrome 不能只是装饰：toolbar 空白区域必须能触发 Tauri 窗口拖拽，左上角红/黄/绿 controls 必须分别接入关闭、最小化和最大化/还原窗口动作。
- 自定义 chrome 所需的 Tauri v2 capability 必须显式授予最小窗口权限：`core:window:allow-start-dragging`、`core:window:allow-close`、`core:window:allow-minimize` 和 `core:window:allow-toggle-maximize`。
- Windows/WebView2 下拖动应包含手动 fallback：按下 toolbar 时记录窗口和鼠标屏幕坐标，移动时通过本项目 Rust command 设置窗口位置，避免 `start_dragging` IPC 时机不稳定导致无法拖动。
- toolbar 左侧显示 FrameQ 与当前任务语境，右侧使用图标按钮承载历史、设置和新任务；当前阶段只在 task monitor 内表达，避免 toolbar 或结果区标题重复显示状态 badge。
- 等待输入态使用 command panel：URL 输入是首要焦点，主按钮保持 `确认`，辅助文案保持安静。
- 首页 `粘贴视频链接` 卡片不展示额外状态 badge；隐私、本地处理和云端 LLM 提示应放在设置面板或任务过程文案中。
- 首页输入框不展示单独的 `视频 URL` 可见 label；使用 placeholder 和无障碍名称表达输入含义。
- 结果工作区只在用户提交 URL 后出现；等待输入态不能提前显示空结果卡或结果占位区。
- 等待输入态的单张输入卡应与桌面窗口比例协调，在默认桌面窗口宽度下使用宽松表单宽度，而不是窄小网页表单。
- 处理态和完成态采用上下排列：task monitor 在上，结果工作区在下；避免两个大卡片左右并排导致内容被横向割裂。
- 处理态使用 task monitor：阶段 timeline、百分比、worker 事件文案和取消按钮必须在同一信息层级内可扫描。
- 完成态使用紧凑 document/result tiles：展示 `视频文件`、`音频文件`、`完整文字稿`、`要点总结` 和 `启发灵感` 5 个结果入口，不直接铺满全文，也不把入口卡拉成大面积空白卡；总结和灵感未生成时显示待生成状态和确认入口。
- 设置面板使用 macOS sheet 质感：分组表单、本地隐私提示、内部滚动和底部固定操作区。
- 历史面板使用紧凑列表：状态 badge、摘要、时间、输出目录和结果数量/错误码必须可快速扫描。
- 视觉 token 优先使用浅中性背景、系统字体、1px 边框、低阴影、短反馈动画和清晰 focus ring。
- 不使用装饰性 3D、背景大渐变、漂浮色块、营销 hero 或会削弱工具可读性的强氛围图。

## Personalized Insight Preferences UX

- `启发灵感` 个性化入口遵循 `docs/product-specs/2026-07-06-personalized-insight-preferences.md`。
- `我的灵感档案` 是一次性、本地持久设置；首次使用 AI整理时可设置或跳过，之后不在每次生成中重复询问。
- `本次生成偏好` 固定为 6 步逐步选择：本次目标、使用场景、关注角度、目标受众、表达风格、避免方向。
- 6 步生成偏好全部使用选项控件，不能出现自由文本输入。
- 每一步只呈现当前选择问题、选项、返回和下一步动作，避免在一个面板里堆完整表单。
- 本次生成偏好 Step 1-5 必须选择，未选择时 `下一步` 禁用；Step 6 `避免方向` 可跳过，未选择时 `完成选择` 仍可用。
- AI整理确认页必须展示本地灵感档案摘要、本次偏好摘要、额度消耗和云端 LLM 数据提示；额度文案应说明 `1 次额度 = 1 次云端 LLM API 调用尝试`，本次 AI整理会按实际 LLM 调用次数扣除，而不是按一次确认固定扣 1 次；已发起的 LLM 调用失败、超时、不可解析或导致部分失败时，对应额度不自动返还，`换个方向` 后再次确认会按新的调用次数再次扣除。
- 生成后的灵感详情应展示 `灵感`、`匹配理由`、`启发问题` 和 `适合用途`，而不是只展示问题列表。
- `换个方向` 只重新打开本次 6 步生成偏好，不重复要求用户填写长期档案。
- 设置面板提供 `编辑灵感档案` 和 `清空灵感档案`，并说明该档案仅保存在本机。

## Error Copy

错误信息必须可行动：说明失败阶段、失败原因、用户能否重试，以及是否保留了已有产物。
