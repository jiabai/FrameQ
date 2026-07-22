# FrameQ Design Guidelines

## Reliability Failure and Recovery UX

- A worker timeout or persistence-recovery failure must leave the current busy state and present one
  concise localized explanation plus the next safe action. Do not ask ordinary users to inspect
  JSON, find a PID, kill Python manually, edit task files, or choose between rollback files.
- Distinguish explicit cancellation, idle timeout, absolute execution timeout, save failure, and
  recovery failure. Do not collapse them into “unknown error” when a stable code exists.
- Process timeout offers retry/new-task behavior after the runtime confirms process-tree cleanup.
  AI timeout keeps the local transcript and previously committed target visible and lets the user
  choose whether to retry; copy must not imply an automatic retry or Credit refund.
- Model-download timeout returns to the existing downloadable/retry state and must not display a
  false completed or permanently broken model state.
- A transcript save may show success only after the complete task transaction commits. During
  automatic recovery, keep the task unavailable rather than briefly rendering a mixed revision.
- Primary guidance remains non-technical. Sanitized technical details stay in the existing collapsed
  disclosure and may show only stable codes/bounded safe diagnostics, never paths, request payloads,
  transcript text, prompts, generated text, or raw worker/OS prose.
- Persistence-recovery and worker-timeout behavior are implemented by their completed ExecPlans.
  Timeout copy must continue to use the stable localized recovery guidance; unavailable macOS
  watchdog runtime and real-Tauri interaction acceptance stay explicit residual validation rather
  than inferred passes.

## Local Media Input and Source-Aware Workspace

- Keep one input composer. Add a keyboard-accessible `+` control at the left that opens a one-item
  local video/audio menu and then the native single-file dialog. Cancelling the dialog changes no
  state and displays no error; choosing a file does not start processing or consume AI Credits.
- A selected file appears as a removable chip with media-kind icon, safe basename, localized size,
  and accessible remove action. Its presence makes the retained URL draft inactive; removal restores
  that draft. A replacement file replaces the chip, and locale changes clear neither source.
- The existing confirmation action and account gate start the active URL or local source. Menu,
  dismissal, chip removal, busy/disabled state, focus restoration, and Escape behavior must work by
  keyboard and remain reachable at `720x640` in all three locales.
- Local progress is source-aware without inventing a second workflow. Video presents validation,
  copy, audio extraction/normalization, and transcription; audio presents validation, normalization,
  and transcription. Copy must consistently describe import/local processing, never remote media
  upload.
- Video completion names locally saved video, audio, and transcript. Audio completion names only
  audio and transcript, and an audio task does not render a disabled, placeholder, or unavailable
  Locate Video control.
- History rows identify local tasks using the safe basename and localized media kind, while URL tasks
  retain canonical URL presentation. Local source filenames remain user content: do not translate
  them, place them in locale resources, or send them to AI.
- Use the existing compact task workspace and artifact rows; the feature must not add decorative
  upload cards, drag/drop zones, batch queues, progress dashboards, gradients, or motion. Respect
  reduced motion and existing focus/color tokens.

## Desktop Language and AI Result Language

- Settings > Basic starts with `界面与 AI 结果语言` and offers Follow System, Simplified Chinese,
  Traditional Chinese, and English. Selection updates the visible UI immediately; only the latest
  failed save may roll back the optimistic choice and show a localized notice.
- A neutral startup shell contains only `FrameQ`. It must not flash one locale before the saved or
  resolved locale mounts, and preference recovery remains a non-blocking notice rather than a modal.
- The product glossary fixes `智能提炼 / AI 提煉 / AI Synthesis`, `本地文字稿 / 本機逐字稿 /
  Local Transcript`, `要点总结 / 重點摘要 / Key Summary`, and `启发灵感 / 靈感啟發 /
  Inspiration`. Traditional Chinese uses its own reviewed copy; runtime conversion is not allowed.
- Visible copy and `aria-label`/`title`/`placeholder` text resolve from feature namespaces. Progress
  and notices render from semantic codes so an on-screen message changes with the locale; raw worker
  prose is not primary UI copy.
- Summary and Inspiration confirmation surfaces show `本次输出语言` (localized) with the actual
  resolved locale name before the final action can consume AI Credits. Changing UI language after
  confirmation does not relabel the language requested by that in-flight generation.
- Known errors lead with localized actionable guidance. Allowlisted sanitized diagnostics may
  appear only inside a localized collapsed technical-details disclosure. Invalid progress events
  are dropped without changing visible state; structurally valid unknown codes use the matching
  stage/status generic fallback. Both paths record only a safe code and never render worker prose.
- At `720x640`, English expansion must wrap and scroll without horizontal overflow, clipped actions,
  or unreachable keyboard focus. Locale changes must not clear URL, output/ASR settings, transcript
  edits, preference flows, current tasks, or existing AI results.
- `FrameQ`, `AI Credits`, ASR, LLM, Mermaid, model names, platform brands, paths, emails, user content,
  subtitles, transcripts, and historical AI results are not translated.

## Local Transcript and AI Workspaces

- After submission, use one full-width task-status banner followed by two domain workspaces.
  At 1100 px and wider, local transcript review occupies about 62% and AI generation about
  38% with a 360 px minimum AI width; below 1100 px they stack local-first.
- Both regions use `--surface-raised`, `--border`, `--shadow-panel-quiet`, and
  `--radius-lg`, with equal top alignment; the saved local transcript remains the primary work
  surface and optional AI stays visually quieter. Use 16 px padding, 12 px gaps,
  20-22 px headings, 14-16 px body text, and controls at least 40 px high.
- The local workspace places a compact audio bar first, a compact video/audio file-action
  row second, a bounded scrolling transcript segment review in the body, and a stable
  edit/save/copy/export footer. Media and transcript are not three large cards.
- Transcript segments share one quiet list boundary and adjacent dividers; they are not separate
  rounded cards. Playback uses a pale row background with an inset left accent, editing uses a
  contained white editor, and the external focus halo is reserved for keyboard focus.
- The AI workspace uses a quiet availability/privacy header and one grouped list containing two
  semantic target rows: `要点总结（同时生成思维导图文件）` and `启发灵感`. Each owns its status,
  quota copy, confirm/retry/view actions, progress, and error without another independent card
  border or radius.
- Workspace headings use the current locale and remain the only visible workspace titles. The task banner owns ready
  completion, so ready local and optional AI workspace badges are omitted; processing, failure,
  waiting, generating, and every target-level lifecycle state remain visible.
- Pending and retry AI target actions use a quiet scoped secondary-blue treatment. The final
  confirmation-sheet submit remains the primary action.
- AI generation leaves the local workspace readable and playable while disabling transcript
  edit/save with `AI 正在使用已保存版本`. A target failure stays in that target card.
- The completion banner says video, audio, and transcript are saved locally. AI copy says
  confirmation sends transcript fragments only and never implies video/audio upload.
- Do not use gradient backgrounds, glass stacks, decorative motion, equal-height filler,
  or a global loading card. Colors express state only: restrained success/local file colors,
  existing primary blue for AI actions, and restrained danger for errors. Respect reduced
  motion.

## Desktop Density, History, and Toolbar

- Active-task layout follows a 24/16/12 rhythm: 24 px between major regions, 16 px between sibling
  workspaces, and 12 px inside domain modules. Tightly related status/title pairs may use 8 px.
- Shared `h1`/`h2` headings use weight 700, `h3` uses 650, and small eyebrow/section labels use no
  more than 700. `--text-soft` must remain readable at 0.72-0.78rem without competing with primary
  copy.
- History sheets use intrinsic height for short lists and the shared sheet max-height for long
  lists. Only `.history-list` scrolls when content exceeds the available height; tests must not
  assign a fixed sheet height to manufacture layout evidence.
- The labelled account chip remains a separate compact status control. Persistent History,
  Settings, and New Task icon buttons share one quiet toolbar utility group with equal control
  sizes; the temporary update action remains separate.
- Short transcript content does not change the local workspace height strategy and must not be
  padded with decorative or equal-height filler.
- A History row with deletion support is a neutral card container containing sibling restore and
  delete buttons; interactive controls must never be nested. The 32px delete icon remains visually
  quiet until hover/focus and uses a native disabled state with readable reason copy during active
  processing, AI generation, cancellation, transcript save, or deletion.
- Permanent deletion always opens a focused confirmation dialog. Cancel receives initial focus;
  the red destructive action states `永久删除`, and the copy names video, audio, transcript, AI
  results, playback cache, immediate disk release, and irreversibility. Escape closes only the
  confirmation dialog.

## 2026-07-10 History Restore While Processing

- The history panel may stay open during a running, retrying, or cancelling task, but its task rows are visibly read-only native disabled buttons with a short explanation. Disabled rows must not be reachable as selectable controls by keyboard.
- The UI must not silently cancel a current task when a user views history. A history task can be restored only after the current task reaches a stable terminal state.
- Restoring a history task closes task-specific detail and AI-preference flows and clears transient notices before presenting the selected task. The result workspace must never visually combine artifacts or text from two tasks.

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

- The inline `TranscriptReviewPanel` should omit keyword search. Its primary review tools are audio playback, block selection, direct editing, save, copy, export, and locating the saved transcript file.
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
- Submitting a URL is blocked only when the user is not signed in or does not have an active entitlement; missing LLM config or exhausted LLM quota must not block local video/audio/ASR processing.
- Retrying summary or inspiration generation opens the account sheet and does not start worker processing when the user is not entitled, LLM config is missing, or LLM quota is exhausted.
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
| `正在取消` | 保留当前任务、URL、阶段进度和结果区，取消按钮显示“正在取消”并禁用；等待 worker 或模型下载给出真实终态 |
| `视频提取中` | 隐藏输入区，展示下载、校验和音频提取进度 |
| `视频转译中` | 展示 ASR 进度、当前 ASR 模型识别文案，以及模型缓存/加载状态 |
| `AI 整理中` | 左侧继续展示可阅读、可回听但不可编辑的已保存文字稿；右侧对应 AI target 显示生成中 |
| `文字稿完成` | 展示本地保存横幅、左侧文字稿校对工作区和右侧智能提炼工作区 |
| `部分完成` | 保留文字稿和已成功生成的 AI 产物，要点总结/灵感卡片展示失败态和重试入口 |
| `失败` | 展示结构化错误原因、重试入口和可修改 URL 路径 |

## UI Rules

- `要点总结` 的独立 AI 详情 sheet 必须通过经净化的 GitHub Flavored Markdown 渲染器展示 `summary.md`；不得渲染 Markdown 中的原始 HTML 或 Mermaid 源码。
- 主按钮文案固定为 `确认`。
- 处理和完成态不再显示 URL 输入区域。
- 完成态主界面以同一 taskId 展示两个领域工作区：左侧直接承载视频/音频操作与文字稿校对，右侧承载 `要点总结` 和 `启发灵感` 两个独立 target 卡片。
- 文字稿直接在左侧工作区审阅，不进入共享 Tab；AI 结果可打开各自的轻量详情 sheet，不与文字稿共用容器。
- AI 详情 sheet 内部内容独立滚动，支持 `Esc` 关闭。
- 复制按钮只复制当前工作区或当前 AI 详情的文本；无内容时置灰。
- 导出按钮在对应 artifact 生成前置灰；启用后定位当前任务目录中的正式 artifact。
- 进度区优先展示 worker 事件中的具体阶段文案；没有事件时回退到当前阶段默认文案。
- `要点总结` 或 `启发灵感` 待生成或失败时，点击卡片先打开各自确认流程；`要点总结` 确认后只生成总结和隐藏 Mermaid mindmap，`启发灵感` 确认后只生成灵感，不重新下载视频、重新提取音频或重新转写。Mermaid 文本只写入本地文件，不在 UI 中展示或渲染。
- 取消任务只在处理中显示；点击后先显示“正在取消”并保留当前任务和 operation ID，直到 worker 或模型下载确认取消后才返回输入态并保留刚提交的 URL。
- 取消信号发送失败时必须恢复可观察的原处理态并显示简明错误；自然完成或失败与取消竞争时，真实终态优先显示，不能被“正在取消”覆盖。
- 顶部工具区提供设置入口；设置面板用于管理本机 ASR、输出目录和 app-local `.env` 配置文件位置，AI 结果 LLM 由服务端管理员配置。
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
- 完成态使用全宽状态横幅与 62/38 双工作区：左侧是紧凑媒体操作、可滚动文字稿和固定校对操作栏，右侧是两个独立 AI target 卡片；低于 1100 px 时按本地工作区、AI 工作区顺序纵向堆叠。
- 设置面板使用 macOS sheet 质感：分组表单、本地隐私提示、内部滚动和底部固定操作区。
- 历史面板使用紧凑列表：状态 badge、摘要、时间、输出目录和结果数量/错误码必须可快速扫描。
- 历史卡片主标题必须区分文字稿预览与来源 URL fallback，最多显示两行；卡片按内容自然高度排列，单行标题不得为视觉等高预留第二行空白。截断内容仍需通过原生可访问文本和 `title` 保留完整值。
- 历史卡片元信息在宽布局固定为“时间 / 可省略输出目录 / 结果数量或错误码”三列；窄布局将输出目录移到第二行，状态和结果项不得因长路径或长标题溢出、重叠或漂移。
- 视觉 token 优先使用浅中性背景、系统字体、1px 边框、低阴影、短反馈动画和清晰 focus ring。
- 不使用装饰性 3D、背景大渐变、漂浮色块、营销 hero 或会削弱工具可读性的强氛围图。

## Personalized Insight Preferences UX

- `启发灵感` 个性化入口遵循 `docs/product-specs/2026-07-06-personalized-insight-preferences.md`。
- `我的灵感档案` 是一次性、本地持久设置；首次使用启发灵感时可设置或跳过，之后不在每次生成中重复询问。
- `本次生成偏好` 固定为 6 步逐步选择：本次目标、使用场景、关注角度、目标受众、表达风格、避免方向。
- 6 步生成偏好全部使用选项控件，不能出现自由文本输入。
- 每一步只呈现当前选择问题、选项、返回和下一步动作，避免在一个面板里堆完整表单。
- 本次生成偏好 Step 1-5 必须选择，未选择时 `下一步` 禁用；Step 6 `避免方向` 可跳过，未选择时 `完成选择` 仍可用。
- 启发灵感确认页必须展示本地灵感档案摘要、本次偏好摘要、额度消耗和云端 LLM 数据提示；额度文案应说明 `1 次额度 = 1 次云端 LLM API 调用尝试`，本次生成会按实际 LLM 调用次数扣除，而不是按一次确认固定扣 1 次；已发起的 LLM 调用失败、超时、不可解析或导致部分失败时，对应额度不自动返还，`换个方向` 后再次确认会按新的调用次数再次扣除。
- 生成后的灵感详情应展示 `灵感`、`匹配理由`、`启发问题` 和 `适合用途`，而不是只展示问题列表。
- `换个方向` 只重新打开本次 6 步生成偏好，不重复要求用户填写长期档案。
- 设置面板提供 `编辑灵感档案` 和 `清空灵感档案`，并说明该档案仅保存在本机。

## Error Copy

错误信息必须可行动：说明失败阶段、失败原因、用户能否重试，以及是否保留了已有产物。
