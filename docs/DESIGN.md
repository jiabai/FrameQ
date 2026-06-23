# FrameQ Design Guidelines

## Account and Payment UI

- The toolbar exposes account status as a compact utility control, not as a marketing banner.
- Login and payment flows use sheet-style panels consistent with settings/history.
- Account copy must clearly distinguish local processing from server-side account/payment verification.
- If the user is not entitled, submitting a URL or retrying insights opens the account/payment sheet and does not start worker processing.
- The account sheet shows remaining insight-generation uses when the user is signed in.
- Desktop settings must not expose insight LLM provider, base URL, API key, model, or timeout; those fields are administrator-managed.
- Desktop settings should expose the app-local `.env` path for non-LLM local settings and provide a locate-file action.
- The payment sheet shows the monthly price, WeChat scan QR code, order expiration, and refresh status action in a stable layout.
- Successful payment returns the user to the existing processing workflow without changing the local-first worker UI stages.

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
| `话题点生成中` | 可先展示文字稿，话题点区域显示生成中 |
| `文字稿完成` | 主界面展示结果总览卡片，不直接铺满全文 |
| `部分完成` | 保留文字稿，话题点卡片展示失败态和重试入口 |
| `失败` | 展示结构化错误原因、重试入口和可修改 URL 路径 |

## UI Rules

- 主按钮文案固定为 `确认`。
- 处理和完成态不再显示 URL 输入区域。
- 完成态主界面展示 `视频文件`、`音频文件`、`完整文字稿` 和 `启发话题点` 4 个产物入口；视频和音频入口只定位本地文件，不打开详情浮窗。
- 点击结果卡片打开详情浮窗，浮窗内通过 tab 切换内容。
- 详情浮窗内部内容独立滚动，支持 `Esc` 关闭。
- 复制按钮复制当前详情 tab 的文本；无内容时置灰。
- 导出按钮在对应输出文件生成前置灰；启用后定位 `outputs/` 中的已生成文件。
- 进度区优先展示 worker 事件中的具体阶段文案；没有事件时回退到当前阶段默认文案。
- `启发话题点` 待生成或失败时，点击卡片先打开确认面板；用户在确认面板点击 `确认` 后才触发 InsightFlow，仅重跑话题点生成，不重新下载视频、重新提取音频或重新转写。
- 取消任务只在处理中显示；点击后必须终止当前 worker 进程树，返回输入态并保留刚提交的 URL。
- 取消后的晚到进度事件或 worker 结果不得覆盖当前 UI 状态。
- 顶部工具区提供设置入口；设置面板用于管理本机 ASR、输出目录和 app-local `.env` 配置文件位置，启发话题点 LLM 由服务端管理员配置。
- 顶部工具区提供历史入口；历史面板展示最近任务列表，支持查看可用结果和定位输出文件。
- 设置面板字段包含 ASR 模型、结果输出目录和本机配置文件路径；首版 release UI 的 ASR 模型只显示 SenseVoice Small，并展示模型是否已下载、下载入口和 app-local data 缓存位置。
- 设置面板必须提示：这里只管理本机配置；话题点确认面板负责提示文字稿片段会发送到管理员配置的云端 LLM 服务。
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
- 完成态使用紧凑 document/result tiles：展示 `视频文件`、`音频文件`、`完整文字稿` 和 `启发话题点` 4 个结果入口，不直接铺满全文，也不把入口卡拉成大面积空白卡；话题点未生成时显示待生成状态和确认入口。
- 设置面板使用 macOS sheet 质感：分组表单、本地隐私提示、内部滚动和底部固定操作区。
- 历史面板使用紧凑列表：状态 badge、摘要、时间、输出目录和结果数量/错误码必须可快速扫描。
- 视觉 token 优先使用浅中性背景、系统字体、1px 边框、低阴影、短反馈动画和清晰 focus ring。
- 不使用装饰性 3D、背景大渐变、漂浮色块、营销 hero 或会削弱工具可读性的强氛围图。

## Error Copy

错误信息必须可行动：说明失败阶段、失败原因、用户能否重试，以及是否保留了已有产物。
