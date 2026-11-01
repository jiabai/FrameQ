# Client Surface Unification Plan

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log,
and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

让客户端内的确认、结果、草稿、设置、账号、模型、历史与笔记操作使用当前主界面的平面设计。
统一外壳、字体、分区、按钮、表单、路径呈现和滚动，不改变真实数据、计费、授权或任务边界。
已按用户确认的视觉方向与执行计划完成实现、自动化门禁和实际可达入口验收。

## Progress

- [x] 2026-10-31: 重新读取规则、流程、门禁、当前样式及最新网页样例，并分模块完成只读排查。Validation: 当前源码与三份只读排查清单。
- [x] 2026-10-31: 写入产品规格、完整覆盖范围、共享尺度、例外与验收边界。Validation: `docs/product-specs/2026-10-31-client-surface-unification.md`。
- [x] 2026-10-31: 获得执行计划确认。Validation: 本线程用户回复“确认，按计划实施”。
- [x] 2026-11-01: 完成确认页独立正文/页脚、事实行和路径样式、Draft 焦点与退出期操作保护。Validation: 9 文件57项确认流程回归及4文件29项退出期回归通过。
- [x] 2026-11-01: 实现两个应用内草稿确认、身份/保存/dirty保护及共享背景归属。Validation: 7文件70项草稿/确认回归、46项样式与焦点归属检查及lint通过。
- [x] 2026-11-01: 统一共享样式与笔记弹窗独立页脚，整理结果、设置、账号、模型、历史样式。Validation: 笔记20项回归及真实renderer样式检查通过。
- [x] 2026-11-01: 实际renderer完成设置60项、只读弹窗21组×4视口、任务表面24组×4视口。Validation: 三语与四尺寸共240项真实DOM/输入记录，含87项实际滚轮检查。
- [x] 2026-11-01: 建立共用弹窗样式，统一确认与偏好流程。Validation: 相关组件、三语、流程与焦点回归已包含在1377项完整前端测试中通过。
- [x] 2026-11-01: 统一结果、草稿及两个应用内未保存确认。Validation: 全屏/编辑/身份/取消/保存守卫回归通过，独立源码审阅无剩余阻断项。
- [x] 2026-11-01: 统一设置、账号、模型、历史与笔记弹窗。Validation: 样式、组件及20项笔记回归通过；最终构建账号三语四尺寸12次独立打开、Tab循环、Escape、焦点/inert恢复通过。
- [x] 2026-11-01: 完成全量门禁、实际可达入口矩阵、恢复与文档同步。Validation: 前端124文件/1377项、lint、脚本51+1项、Windows构建、文档治理及差异检查通过；真实缺失状态单独列为未验证。
- [x] 2026-11-01: 按用户补充反馈检查全部界面分隔归属，处理正文/列表末行及末组底线、夹层留白与外层合集成员区重复边界。Validation: 18文件/224项相关回归、lint、脚本51+1项、最终Windows构建、240项原生边界检查、12项真实签出生产浏览器检查、文档治理和差异检查通过；正常信息行/控件边界保留，调试退出后恢复普通启动。

## Surprises & Discoveries

- Evidence: `AnimatedSheet.tsx` 与 `features/modal/sheets.css` 提供共同弹窗外壳；正文、标题和页脚
  分别布局，专用组件保留各自宽度和全屏规则。
- Evidence: 确认与偏好流程使用 `sheet-facts` 标签/数值行，路径保留完整原文与 title；
  告知完整换行。`DraftConfirmationSheet.tsx` 已接入共同焦点和关闭生命周期。
- Evidence: `DraftResultSheet.tsx` 和 `results/regenerateDraft.ts` 的两个应用内确认各自持有候选任务身份，
  保留 dirty、保存中、取消和过期候选保护；非顺序退出需要共享背景 inert 归属计数。
- Evidence: `taskArtifacts.ts` 与 `AiResultDetailSheet.tsx` 没有独立脑图详情 tab；现有 Mermaid
  产物/Markdown 代码展示纳入样式统一，不引入新的查看器或调用链。
- Evidence: 模型向导由真实准备/下载流程进入；结果详情、草稿及部分错误状态依赖已有真实产物和状态。
  普通浏览器的原生命令不可用表现不能证明原生成功、保存或下载行为。

## Decision Log

- Decision: 以当前正式主界面与最新本地样例为唯一视觉基准，遵守产品规格中的 14px 正文/操作、
  16px 标题、12/13px 辅助层级。Rationale: 让所有弹窗在系统缩放下保持相同密度。Date/Author: 2026-10-31 / User + Codex。
- Decision: 共用外壳和控件使用独立、限定作用范围的样式，移除旧声明中的冲突效果，组件专用布局直接修改原规则。
  Rationale: 避免在样式末尾不断叠加覆盖，同时保护已确认主界面。Date/Author: 2026-10-31 / Codex。
- Decision: 两个草稿放弃确认使用应用内共用确认层；生成文字稿确认接入共同外壳与焦点管理。
  Rationale: 让全客户端确认具有相同外观和键盘行为，保持两个独立业务守卫。Date/Author: 2026-10-31 / User + Codex，计划已确认。
- Decision: 只对已有合法路径设置专用单行省略，其他告知继续完整换行。
  Rationale: 控制路径占位并保持当前隐私与辅助技术可读性。Date/Author: 2026-10-31 / Codex。
- Decision: 真实原生验收、正式浏览器不可用状态、组件回归和尚不可达状态分别记录。
  Rationale: 不将仿真、源码或测试通过当作未执行的实际显示验收。Date/Author: 2026-10-31 / Codex。
- Decision: 多层弹窗对背景 inert 使用共享归属计数，最后一个拥有者退出时恢复原属性；焦点跳过已关闭/仍 inert 的目标。
  Rationale: 结果、放弃确认、生成确认的动画可能交叠，需要支持不同退出顺序。Date/Author: 2026-11-01 / Codex。
- Decision: 同一区域边界只由一处拥有，正文末行/末组不再重复绘制靠近页脚或外壳的底线；列表只保留行间边界。
  Rationale: 用户要求处理全部界面的同类分隔与夹层留白，同时保留真实信息分区和控件边框。Date/Author: 2026-11-01 / User + Codex。

## Context and Orientation

- Spec: `docs/product-specs/2026-10-31-client-surface-unification.md`。
- 共同外壳与焦点：`app/src/features/modal/AnimatedSheet.tsx`、`useModalFocus.ts`、对应测试；
  `app/src/App.css`、`app/src/App.tsx` 与 `app/src/features/modal/sheets.css`。
- 应用内放弃确认：`app/src/features/modal/ConfirmDialog.tsx` 与对应 `.test.tsx`；
  两个入口继续分别由草稿结果与重新生成组合位置拥有候选操作和任务身份。
- 确认：`features/results/SummaryConfirmationSheet.tsx`、`DraftConfirmationSheet.tsx`；
  `features/dissection/TranscriptDissectionConfirmationSheet.tsx`。
- 偏好：`features/insightPreferences/InsightPreferenceFlow.tsx`、`InspirationProfileForm.tsx`、`OutputLanguageField.tsx`。
- 结果：`features/results/AiResultDetailSheet.tsx`、`MarkdownContent.tsx`、`DissectionReport.tsx`、
  `DraftResultSheet.tsx`、`regenerateDraft.ts`；重新生成入口的 App/控制器组合位置。
- 设置/账号/模型：`features/settings/SettingsSheet.tsx`、`features/account/AccountSheet.tsx`、
  `features/asrModel/ModelGuideSheet.tsx`。
- 历史/笔记：`features/history/HistorySheet.tsx`、`HistoryDeleteConfirmation.tsx`；
  `features/notes/NoteActionSheet.tsx`、`NoteRenameSheet.tsx`、`NoteCollectionsSheet.tsx`、`NoteInfoSheet.tsx` 与 `notes.css`。
- 说明：上述 `features/` 均相对 `app/src/`。worker、server、Rust 和 contract 保持现有业务边界。
- 验收：`app/tests/support/productionBrowser.ts` 与现有真实 WebView2 CDP 脚本可复用；
  新中间记录仅写 ignored `build/ui-surface-acceptance/`。

## Plan of Work

1. **共同外壳与基础控件**
   - 在 `features/modal/sheets.css` 定义限定于弹层的颜色、字体、间距、表单、按钮、标题、正文和页脚；
     由 `App.tsx` 导入，清理 `App.css` 中被迁移的旧共享规则。独立删除确认同样使用共同视觉规范。
   - 使用白色面板、细边、12px 圆角、单层轻阴影和无模糊遮罩。按钮实色、正文/操作 14px，
     标题 16px，辅助 12/13px；保留可见焦点、disabled、busy、状态色与现有动效生命周期。
   - 正文内部滚动、标题与操作区可达；处理 min-height:0、窄窗口换行和短窗口，不按统一大高度填充。
   - 核查三语、字体/按钮实际计算值与共同焦点行为，再继续各业务表面。

2. **确认与偏好流程**
   - 修改上述四个确认组件及偏好表单/流程，将事实卡片改为标签/数值行，介绍与摘要用平面分区。
   - 为路径增加专用样式，不对隐私/收费/阻止原因做省略；保留完整原文的辅助技术读取。
   - 将页脚与滚动正文分开，表单提交保留现有 submit 行为；需要时使用表单 id/form 属性关联。
   - DraftConfirmation 接入 AnimatedSheet，保留只读平台预选的异步取消保护，补充焦点与关闭生命周期覆盖。
   - 验证档案六字段、偏好六步骤、九个平台、返回/取消、额度门槛、冻结语言与最终确认语义。

3. **结果详情与草稿**
   - 统一工具栏、空状态、正文、灵感列表与解剖事实/分段/来源展示；保留蓝色种子指示与 stale/disabled 语义。
   - Markdown 预览/编辑正文 14px；代码、表格和 textarea 保留边界与自身横向/纵向滚动。
   - 保留普通/全屏、预览/编辑、关闭重开、原文件读取、缓冲区与 dirty、保存中/保存失败反馈。
   - 新建 `features/modal/ConfirmDialog.tsx` 共用应用内确认组件，分别承接草稿关闭及重新生成的放弃确认。记录候选 taskId，
     明确取消零操作、保存中拦截、过期候选失效；父子确认的 Escape 和焦点逐层返回。
   - 重新生成通过放弃确认后仅打开原有生成确认；保持 seed 优先级、账号/额度和最终生成门槛。

4. **设置、账号、模型、历史、笔记**
   - 设置五类导航紧凑化，表单、模型/更新/诊断状态改为自然分区，保留各操作与进度、错误恢复。
   - 账号与额度使用标签/数值行，保留登录/激活、发送与冷却、额度重置、disabled/错误反馈。
   - 模型向导统一进度、路径、状态、诊断与操作区，保留活跃下载的关闭/取消守卫。
   - 历史条目平面化，保留元数据、busy/dirty 守卫和真实删除确认；实际验收只打开确认再取消。
   - 笔记三类弹窗采用共同尺度，直接清理 notes.css 冲突声明，保留验证、异步归属、成员选择及信息展示。

5. **回归、原生显示与交付**
   - 逐项记录十组入口的真实可达状态；先使用现有任务、资料、账号与产物，不注入业务数据。
   - 可逆验收覆盖滚轮、键盘、焦点、三语临时切换后恢复、普通/全屏、预览/编辑原文不变、长内容和路径。
   - 复核当前主界面、拖动分隔线、固定按钮、220ms/减少动态效果、音频/编辑/AI 保持挂载。
   - 运行门禁与 Windows 构建，核对嵌入资源，关闭临时调试入口并恢复普通启动。
   - 将实际证据、覆盖范围与限制写入 `design-qa.md`，同步 `docs/DESIGN.md` 与必要的架构说明，
     验证文档后再归档本计划。没有执行的原生状态不标记通过。

## Validation and Acceptance

### 自动化门禁

- `npm --prefix app test`：完整前端回归。
- `npm --prefix app run lint`：TypeScript 与生产界面文案边界。
- `npm --prefix app run tauri -- build --no-bundle`：Windows 正式可执行文件。
- `node --test scripts/tests/*.test.mjs` 与 `uv run python -m pytest scripts/tests -o cache_dir=build/pytest-surface-cache`。
- `uv run python scripts/validate_agents_docs.py --level WARN` 与 `git diff --check`。
- 重点复用 `App.css.test.ts`、AnimatedSheet/useModalFocus、各确认/偏好/语言/控制器、
  AiResultDetailSheet/DissectionReport/MarkdownContent、DraftResultSheet/lifecycle/regenerateDraft、
  SettingsSheet、AccountSheet、ModelGuideSheet、HistorySheet 和 NoteActionSheets 回归。
  新测试限定于新确认层/异步归属和必要语义，不新增假的 IPC、供应商或 ResizeObserver。

### 实际渲染矩阵

| 维度 | 验收方式与证据 |
| --- | --- |
| 十组界面 | 总结确认、解剖确认、灵感流程、AI 详情、草稿确认/结果、设置、账号、模型、历史、笔记操作分别记录入口与状态。 |
| 尺寸 | 1734×907、1180×760、720×640、1734×640；实际原生窗口与 renderer CSS 视口仿真分别记录。 |
| 字体/样式 | 读取 computed styles、字体/行高、边框、背景、阴影、间距；检查正文无横向溢出、元信息和操作不重叠。 |
| 输入/滚动 | 真实鼠标/键盘/滚轮；操作中心命中检查；可到达首尾与页脚；Tab/Shift+Tab、Escape 和关闭焦点恢复。 |
| 三语 | 从真实设置切换 zh-CN/zh-TW/en-US；记录原偏好并恢复 system 或指定语言，不保存其他设置修改。 |
| 缩放 | 重新读取当前系统 DPR（此前为175%）；额外 DPR 仿真明确标注，不更改系统设置或假称其他系统缩放通过。 |
| 内容/模式 | 使用真实已有长标题、路径、Markdown、表格、灵感、解剖；详情/草稿普通与应用内全屏，预览/编辑和关闭重开。 |
| 状态 | 实际读取、临时选择、展开、原文编辑/取消；生成、保存、下载、失败、无余额等依赖真实状态，单独列出可达与未验证项。 |

### 真实入口与恢复限制

- 账号、设置、历史、笔记操作以及已有文字稿的总结/解剖/偏好入口可通过正式 UI 检查并取消。
- 模型向导依赖真实准备/下载流程，结果/草稿依赖真实已存产物；缺少条件时记录限制，不为布局验收启动下载或付费生成。
- 不请求验证码、不兑换/退出登录、不保存资料/重命名/合集成员、不清理缓存、不真实删除历史，不保存或导出文字稿/草稿。
- 无截图默认权限；数值与输入验证不宣称完成截图视觉比较。macOS、其他显示器与缺失原生状态单独列为未验证。
- 结束必须恢复原语言、视口/媒体/DPR、弹层、音频位置/暂停、滚动和临时选择；确认无 textarea/dirty/生成中，
  保存按钮与余额保持原状态。临时调试端口关闭后正常启动应用。

## Outcomes & Retrospective

共享外壳、确认与偏好、结果与草稿、设置/账号/模型/历史/笔记样式及两个应用内草稿确认已实现。
共享界面初次完成时，完整前端124文件/1377项、lint、Node脚本51项、Python脚本1项、Windows no-bundle构建、
文档治理与差异检查通过。包含分隔线复核的最终可执行文件嵌入 `index-C7xJ9uFt.js` / `index-CzcoOzq5.css`。

实际release WebView2完成240项三语/四CSS视口样式与几何检查，含87项实际滚轮检查；
该矩阵使用 `index-BzY0Evyn.js`，共享CSS与当次收尾的 `index-Cfe5bItx.js` 构建相同。当次构建另完成账号12次独立键盘/关闭/焦点验收，
总结普通/全屏8项及总结确认、长标题重命名、历史的原生/窄视口代表检查。
原生窗口为1180×761、DPR1.75；四尺寸为renderer仿真，额外DPR1仿真单独记录。
真实数据包含3条笔记、12,532字符/533段文字稿、179/180字符长标题、1138/1215字符总结及140字符路径。
实际1秒暂停位置在弹窗、分隔线拖动、收起展开及尺寸切换期间保持，正文、额度和保存禁用状态保持。
结束恢复zh-CN、首页、侧栏展开、原视口/DPR、滚动0、零弹层/inert/编辑器及暂停0秒；
调试进程退出、9334端口关闭后普通启动成功。证据与完整限制见 `design-qa.md` 和
ignored `build/ui-surface-acceptance/scope-limit-manifest.json`。

分隔线复核使用最终 `C7xJ9uFt` / `CzcoOzq5` 构建独立完成240项（三语四CSS视口，含外层合集12项）、
75次实际滚轮及303个起始/末端读数，空白带重复边界为0；正常内部信息行、表单及工具栏边界保留。
总结末行底线及底部padding为0，页脚保留单线和正文16px底部留白。正文、额度、操作、音频与保存权限保持；
结束恢复原语言/原生视口/DPR、首页、侧栏展开及零弹层/inert/编辑器/滚动，再关闭调试入口并普通启动。
相关18文件/224项回归、lint、脚本51+1、最终构建通过；实际签出生产浏览器12项键盘/焦点/边界检查通过。
签出浏览器有真实不可用通知，信息卡片与通知间分隔继续保留，无通知的签出末卡片分支未验证。
证据为 ignored `build/ui-surface-acceptance/divider-after.json`、`divider-scope-manifest.json` 和
`divider-signed-out-browser.json`。此次CSS修正未重跑完整前端及后端套件。

Residual risk: 当前资料需要先建立档案，六步灵感偏好/最终确认缺少可逆入口；真实灵感、解剖及草稿产物不存在。
草稿确认/编辑/两个放弃确认、模型运行/失败、缺失账号/额度/保存失败等状态、Markdown表格/代码/Mermaid、
macOS、其他显示器/系统缩放和截图视觉比较未做原生验收。上述状态的组件回归与源码检查不等同原生显示验收。
worker/server/Rust业务未在本轮修改，未重跑其完整套件；Windows构建已编译现有Rust代码。
