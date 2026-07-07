# Personalized Insight Preferences for AI整理

## Background

用户反馈当前 `启发话题点` 的 prompt 不够针对个人目的，生成的话题点可能正确但不一定有启发。FrameQ 需要在 AI整理前收集用户本次目的和偏好，让话题点更贴近用户的角色、场景、受众和表达偏好。

这项能力仍然服务于桌面端本地优先工作流：视频、音频、文字稿、用户偏好和生成结果默认留在本机。只有当用户确认 AI整理时，worker 才会把文字稿片段发送给管理员配置的云端 LLM 服务用于三项 AI整理产物；用于生成话题点的偏好快照只随 `启发话题点` 生成请求发送，不随 `要点总结` 或 Mermaid mindmap 请求发送。

个性化偏好只影响 `启发话题点` 的生成，不影响 `要点总结` 或 Mermaid mindmap。总结和 mindmap 继续使用原有通用 AI整理策略。

## Goals

- 让 `启发话题点` 从通用问题升级为贴合用户目的和使用场景的问题。
- 明确个性化偏好只用于 `启发话题点`，不改变 `要点总结` 或 Mermaid mindmap 的生成方式。
- 区分一次性输入的长期个人信息和每次任务的生成方向。
- 所有偏好输入都采用选项，不提供自由文本输入，降低用户不知道写什么的压力。
- 用逐步选择的交互替代一次性大表单：用户每一步选择后确认，再进入下一步。
- 在 AI整理确认前展示本次将使用的偏好摘要和云端 LLM 提示。
- 生成结果需要解释为什么这个话题点匹配用户偏好，帮助用户判断是否值得继续展开。

## Non-goals

- 不做自由文本 prompt 编辑器。
- 不基于历史任务自动学习用户画像。
- 不接入社交账号、通讯录、浏览历史或外部用户画像。
- 不把用户偏好同步到 FrameQ server。
- 不让 server 接收或保存视频、音频、完整文字稿、话题点或用户画像。
- 不改变主流程：视频提取和文字稿生成仍然可以在不使用 LLM 的情况下完成。
- 不个性化 `要点总结` 或 Mermaid mindmap。

## Product Model

FrameQ 使用两层偏好模型：

1. `我的灵感档案`：长期、持久、本地保存。用于描述用户的相对稳定信息，例如角色、职业、城市语境、年龄阶段和常用平台。用户首次使用时可设置，之后默认不重复询问，可在设置中编辑或清空。
2. `本次生成偏好`：每次 AI整理前选择。用于描述这次为什么生成话题点、给谁看、想从什么角度启发。它不包含长期个人信息。

`本次生成偏好` 固定为 6 步，其中前 4 步属于 `生成偏好`，后 2 步属于 `更多偏好`。这 6 步不包含 `我的灵感档案`。应用可把用户当前有效的 6 步方向保存为 app-local `defaultGenerationPreferences`，作为之后新任务的默认生成偏好；它只代表当前全局默认方向，不承担历史任务复现职责。

## First-use Flow

当用户点击待生成或失败态的 `启发话题点` / `AI整理` 入口时：

1. 如果本机没有 `profile` 且 `profileSkipped !== true`，先展示一次性设置引导。
2. 引导文案强调它只需设置一次，之后可在设置中修改。
3. 用户可以选择 `开始设置` 或 `跳过`。
4. 跳过时本地记录 `profileSkipped: true`（或等价状态），之后不再反复弹出首次设置引导，并直接进入 `本次生成偏好` 6 步流程。
5. 完成或跳过档案后，进入本次任务的 6 步生成偏好。

首次设置不应出现在每次生成话题点的 6 步流程中。

跳过不代表系统生成一组隐式默认画像。跳过后的档案语义是 `无档案 / 不指定`：确认页可以显示 `未设置灵感档案`，worker 和 LLM prompt 不得把用户推断为某个默认角色、领域、城市、年龄阶段或平台。

## Returning-user Flow

如果本机已有 `我的灵感档案`，或本机已记录 `profileSkipped: true`：

1. 点击 `启发话题点` / `AI整理` 入口后，进入话题点生成偏好流程。
2. 如果存在 app-local `defaultGenerationPreferences`，可先展示摘要页：`直接生成`、`修改本次方向`、`编辑灵感档案`。
3. `直接生成` 使用当前档案和 `defaultGenerationPreferences`，跳过本次 6 步选择流程，并进入 AI整理确认页；它不能直接触发 worker 或云端 LLM 调用。
4. `修改本次方向` 只重新走本次 6 步流程，不重复询问长期个人信息；如果存在 `defaultGenerationPreferences`，6 步流程使用它作为初始选择。
5. `编辑灵感档案` 打开长期档案设置，完成后回到本次生成确认。
6. 如果不存在 `defaultGenerationPreferences`，不展示 `直接生成`，直接进入本次 6 步生成偏好。

`profileSkipped: true` 与已有档案一样，都表示首次引导已经完成。跳过用户在确认页中的档案摘要应显示为 `未设置灵感档案`，而不是再次触发首次设置引导。

## Default Generation Preferences

FrameQ 应在 app-local JSON 配置文件中保存 `defaultGenerationPreferences`，表示用户当前有效的默认生成方向。它不是历史记录，不表示“上一次任务”的永久快照，也不承担复现历史任务偏好的职责；历史任务使用各自任务目录中的任务局部偏好快照。`defaultGenerationPreferences` 不能从最近任务 manifest、历史列表或任务目录中推导。

`defaultGenerationPreferences` 只包含 6 步生成偏好的当前有效选择结果，不包含 `我的灵感档案` 字段，也不包含文字稿、话题点、要点总结、历史任务 ID 或任何 LLM prompt 内容。它保存稳定 option id，不保存中文展示文案。UI 展示时应使用当前最新的选项配置和 label 渲染，而不是使用持久化文件中的旧文案。

`defaultGenerationPreferences` 不需要为历史迁移单独设置 `schemaVersion`。如果未来选项配置变化导致当前保存值不再有效，应用不做跨版本猜测迁移，而是按当前选项配置校验并失效重选：

- 必填单选字段缺失、不是字符串或 option id 不存在时，视为无效。
- 必填多选字段缺失、不是数组、为空、超出最大数量或包含未知 option id 时，视为无效。
- 可跳过多选字段不是数组、超出最大数量或包含未知 option id 时，视为无效。
- 任一字段无效时，应用应自动忽略并清空 `defaultGenerationPreferences`，不展示 `直接生成`，让用户重新完成 6 步选择。
- 该失效处理应静默完成，不弹出阻塞提示；用户通过重新完成 6 步并在确认页点击 `确认` 后，生成新的 `defaultGenerationPreferences`。
- 失效或清空 `defaultGenerationPreferences` 不影响任何历史任务目录中的任务局部偏好快照；应用不得从历史任务偏好快照推导、恢复或重建 `defaultGenerationPreferences`。

更新规则：

- 只有用户在 AI整理确认页点击 `确认` 后，才用本次 6 步选择覆盖 `defaultGenerationPreferences`。
- 用户只进入 6 步向导、完成 6 步但未点击确认、点击 `返回修改` 后未再次确认、直接关闭流程，或在确认页点击 `取消` 时，均不更新 `defaultGenerationPreferences`。
- 用户在确认页点击 `取消` 时，本次临时 6 步选择全部废弃；下一次进入流程时仍使用此前已保存的 `defaultGenerationPreferences`（如果存在）。
- 用户点击 `换个方向` 并完成新的 6 步选择后，也必须在确认页再次点击 `确认`，才用新的 6 步选择覆盖 `defaultGenerationPreferences`。
- 清空 `我的灵感档案` 不清空 `defaultGenerationPreferences`，因为它表示生成方向，不是长期个人画像。
- v1 不需要提供单独的 `清空默认生成偏好` 设置入口；如果未来加入，该操作只清空 `defaultGenerationPreferences`，不影响 `我的灵感档案` 或历史任务产物。

## Option Identity

所有偏好选项都必须由稳定 option id 和当前展示 label 组成。option id 只要求在所属字段内唯一，完整 option identity 是 `(field, id)` 组合，而不是单独的 `id`。例如 `role: "marketing_sales"` 与 `domain: "marketing_sales"` 是两个不同选项；`styles: ["direct_sharp"]` 与 `defaultStyles: ["direct_sharp"]` 也属于不同字段语境。

app-local 全局偏好、worker 请求和 prompt 输入必须保留字段结构并使用 option id；UI 使用当前 option registry 将 `(field, id)` 渲染为 label。实现不得把中文 label 当作全局偏好值或 worker 契约，也不得使用扁平的全局 `{ id -> option }` registry。推荐使用 `{ field -> { id -> option } }`，或内部使用 `${field}:${id}` 作为查找 key。任务局部偏好快照可额外保存当次确认时的 `labelSnapshot` 用于历史展示，但其结构化契约仍以 `(field, id)` 为准。

`本次生成偏好` 的 v1 option id 固定如下：

| 字段 | id | label |
|------|----|-------|
| `goal` | `content_creation` | 内容创作 |
| `goal` | `learning_understanding` | 学习理解 |
| `goal` | `review_deconstruction` | 复盘拆解 |
| `goal` | `business_insight` | 商业洞察 |
| `goal` | `controversy_discussion` | 争议讨论 |
| `goal` | `action_advice` | 行动建议 |
| `scenario` | `personal_notes` | 自己记录 |
| `scenario` | `short_video` | 发短视频 |
| `scenario` | `article_official_account` | 写图文/公众号 |
| `scenario` | `livestream_podcast` | 做直播/播客 |
| `scenario` | `team_sharing` | 团队分享 |
| `scenario` | `client_communication` | 客户沟通 |
| `scenario` | `course_community` | 课程/社群 |
| `angles` | `topic_angle` | 选题角度 |
| `angles` | `contrarian_view` | 反常识观点 |
| `angles` | `audience_pain_point` | 人群痛点 |
| `angles` | `practical_advice` | 实操建议 |
| `angles` | `case_analogy` | 案例类比 |
| `angles` | `risk_controversy` | 风险争议 |
| `angles` | `trend_judgment` | 趋势判断 |
| `angles` | `reusable_method` | 可复用方法 |
| `angles` | `memorable_phrase` | 金句表达 |
| `angles` | `cognitive_refresh` | 认知刷新 |
| `audience` | `self` | 给自己看 |
| `audience` | `beginners` | 给新手看 |
| `audience` | `peers` | 给同行看 |
| `audience` | `clients` | 给客户看 |
| `audience` | `boss_team` | 给老板/团队看 |
| `audience` | `fans_readers` | 给粉丝/读者看 |
| `styles` | `direct_sharp` | 直接犀利 |
| `styles` | `gentle_inspiring` | 温和启发 |
| `styles` | `professional_analysis` | 专业分析 |
| `styles` | `grounded` | 接地气 |
| `styles` | `storytelling` | 故事化 |
| `styles` | `short_video_friendly` | 更适合短视频 |
| `styles` | `long_form_friendly` | 更适合长文 |
| `avoid` | `chicken_soup` | 不要太鸡汤 |
| `avoid` | `academic` | 不要太学术 |
| `avoid` | `vague` | 不要太空泛 |
| `avoid` | `clickbait` | 不要标题党 |
| `avoid` | `commercialized` | 不要太商业化 |
| `avoid` | `negative` | 不要太负面 |
| `avoid` | `grand_narrative` | 不要宏大叙事 |

`defaultGenerationPreferences` 的持久化形状应等价于：

```json
{
  "goal": "content_creation",
  "scenario": "short_video",
  "angles": ["topic_angle", "practical_advice"],
  "audience": "beginners",
  "styles": ["direct_sharp"],
  "avoid": []
}
```

其中 `goal`、`scenario` 和 `audience` 是单选 id；`angles`、`styles` 和 `avoid` 是 option id 数组。

`我的灵感档案` 的 v1 option id 固定如下：

| 字段 | id | label |
|------|----|-------|
| `role` | `content_creator` | 内容创作者 |
| `role` | `product_ops` | 产品/运营 |
| `role` | `marketing_sales` | 市场/销售 |
| `role` | `entrepreneur` | 创业者 |
| `role` | `student_researcher` | 学生/研究者 |
| `role` | `teacher_trainer` | 教师/培训者 |
| `role` | `investor_business_analyst` | 投资/商业分析 |
| `role` | `general_learner` | 普通学习者 |
| `role` | `unspecified` | 不指定 |
| `domain` | `content_media` | 内容媒体 |
| `domain` | `product_operations` | 产品运营 |
| `domain` | `marketing_sales` | 市场销售 |
| `domain` | `education_training` | 教育培训 |
| `domain` | `technology_rd` | 技术研发 |
| `domain` | `management_consulting` | 管理咨询 |
| `domain` | `investment_business` | 投资商业 |
| `domain` | `freelance` | 自由职业 |
| `domain` | `general_perspective` | 通用视角 |
| `domain` | `unspecified` | 不指定 |
| `stage` | `student` | 学生 |
| `stage` | `early_career` | 职场新人 |
| `stage` | `experienced_professional` | 成熟职场 |
| `stage` | `manager` | 管理者 |
| `stage` | `entrepreneur_operator` | 创业经营者 |
| `stage` | `retired` | 退休后 |
| `stage` | `unspecified` | 不指定 |
| `cityContext` | `tier1_city` | 一线城市 |
| `cityContext` | `new_tier1_city` | 新一线城市 |
| `cityContext` | `lower_tier_city` | 二三线城市 |
| `cityContext` | `county_township` | 县城乡镇 |
| `cityContext` | `overseas` | 海外 |
| `cityContext` | `unspecified` | 不指定 |
| `genderPerspective` | `unspecified` | 不指定 |
| `genderPerspective` | `female_perspective` | 女性视角 |
| `genderPerspective` | `male_perspective` | 男性视角 |
| `genderPerspective` | `neutral_perspective` | 中性视角 |
| `platforms` | `douyin` | 抖音 |
| `platforms` | `xiaohongshu` | 小红书 |
| `platforms` | `wechat_channels` | 视频号 |
| `platforms` | `bilibili` | B站 |
| `platforms` | `wechat_official_account` | 公众号 |
| `platforms` | `podcast` | 播客 |
| `platforms` | `course_community` | 课程/社群 |
| `platforms` | `internal_sharing` | 内部分享 |
| `defaultStyles` | `direct_sharp` | 直接犀利 |
| `defaultStyles` | `gentle_inspiring` | 温和启发 |
| `defaultStyles` | `professional_analysis` | 专业分析 |
| `defaultStyles` | `grounded` | 接地气 |
| `defaultStyles` | `storytelling` | 故事化 |
| `defaultStyles` | `short_video_friendly` | 适合短视频 |
| `defaultStyles` | `long_form_friendly` | 适合长文 |
| `defaultAvoid` | `chicken_soup` | 太鸡汤 |
| `defaultAvoid` | `academic` | 太学术 |
| `defaultAvoid` | `vague` | 太空泛 |
| `defaultAvoid` | `clickbait` | 太标题党 |
| `defaultAvoid` | `commercialized` | 太商业化 |
| `defaultAvoid` | `negative` | 太负面 |
| `defaultAvoid` | `grand_narrative` | 宏大叙事 |

长期档案单选字段保存对应 option id；多选字段保存 option id 数组。`unspecified` 只用于单选字段，多选字段空数组表示不指定。

## Persistent Inspiration Profile

`我的灵感档案` 全部使用选项输入，避免用户被迫提供敏感或不确定的信息。单选字段应提供 `不指定` 选项；多选字段不提供 `不指定` 选项，但允许空选，空数组表示该字段不指定。

长期档案中的多选字段包括 `常用平台`、`默认表达偏好` 和 `默认避雷偏好`。这些字段最多选择 3 个，最少可以选择 0 个。确认页摘要只展示用户已选择的长期档案字段；空数组字段默认不展示。worker 构造 prompt 时不得把空数组推断为任何默认平台、表达风格或避雷偏好。

`我的灵感档案` 的持久化形状应等价于：

```json
{
  "role": "content_creator",
  "domain": "content_media",
  "stage": "experienced_professional",
  "cityContext": "new_tier1_city",
  "genderPerspective": "unspecified",
  "platforms": ["douyin", "xiaohongshu"],
  "defaultStyles": ["direct_sharp", "storytelling"],
  "defaultAvoid": ["clickbait"]
}
```

`我的灵感档案` 必须整体验证。读取时如果 profile 文件无法解析、顶层不是 object、缺少任一必需字段、字段类型不符合预期、单选字段不是所属字段中的合法 option id、多选字段不是数组、多选字段包含未知 option id，或多选数量超过上限，则整份 profile 视为无效。

无效 profile 不得用于确认页摘要、worker 请求或 prompt 输入。应用应提示 `灵感档案需要重新设置`，并重新进入首次档案设置引导。用户可以重新设置，也可以主动选择 `跳过`；只有用户主动点击 `跳过` 时才写入 `profileSkipped: true`。profile 无效不同于用户跳过，应用不得把损坏或无效 profile 静默降级为默认画像，也不得自动将其转换为 `未设置灵感档案` 后继续生成。

下表用于产品阅读和设置页展示说明；长期档案的实现契约以 `Option Identity` 中的 `我的灵感档案` 表为准。若两处文案不一致，以 `Option Identity` 表中的 `(field, id, label)` 为准，并同步修正文案。

| 字段 | 输入方式 | 选项 |
|------|----------|------|
| 我的角色 | 单选 | 内容创作者、产品/运营、市场/销售、创业者、学生/研究者、教师/培训者、投资/商业分析、普通学习者、不指定 |
| 职业领域 | 单选 | 内容媒体、产品运营、市场销售、教育培训、技术研发、管理咨询、投资商业、自由职业、通用视角、不指定 |
| 年龄/阶段 | 单选 | 学生、职场新人、成熟职场、管理者、创业经营者、退休后、不指定 |
| 城市语境 | 单选 | 一线城市、新一线城市、二三线城市、县城乡镇、海外、不指定 |
| 性别/视角 | 单选 | 不指定、女性视角、男性视角、中性视角 |
| 常用平台 | 多选，最多 3 个，可空选 | 抖音、小红书、视频号、B站、公众号、播客、课程/社群、内部分享 |
| 默认表达偏好 | 多选，最多 3 个，可空选 | 直接犀利、温和启发、专业分析、接地气、故事化、适合短视频、适合长文 |
| 默认避雷偏好 | 多选，最多 3 个，可空选 | 太鸡汤、太学术、太空泛、太标题党、太商业化、太负面、宏大叙事 |

长期档案保存后应在设置面板中提供 `编辑灵感档案` 和 `清空灵感档案`。清空只作用于 app-local 全局档案状态，只影响之后的新生成，不删除、不修改已经写入本地任务目录的历史 AI 产物、任务 manifest 或导出文件。

`我的灵感档案` 与 `profileSkipped` 的状态更新规则如下：

| 用户操作 | `profile` | `profileSkipped` | 后续行为 |
|----------|-----------|------------------|----------|
| 首次保存档案 | 已保存用户选择 | `false` | 后续生成时不再展示首次设置引导，直接进入本次生成偏好或默认生成偏好摘要页 |
| 首次点击 `跳过` | `null` / 无档案 | `true` | 后续生成时不再展示首次设置引导，确认页档案摘要显示 `未设置灵感档案` |
| 点击 `清空灵感档案` | `null` / 无档案 | `false` | 视为回到尚未完成档案设置状态；下次生成话题点时重新展示首次设置引导 |
| 清空后再次点击 `跳过` | `null` / 无档案 | `true` | 后续生成时不再展示首次设置引导 |
| 重新编辑并保存档案 | 已保存用户选择 | `false` | 后续生成时使用新档案，不再展示首次设置引导 |

清空档案是重置，不等同于跳过。用户如果清空后不想重新设置，可以在下次首次设置引导中点击 `跳过`，此时才写入 `profileSkipped: true`。

`清空灵感档案` 不是历史任务清理或历史隐私擦除功能。它不得遍历 `outputs/tasks/<task_id>/`，不得修改历史 `frameq-task.json`、`insights.json`、复制内容、Markdown 导出或其他任务局部产物。

## Per-run Generation Preferences

`本次生成偏好` 是 AI整理前的 6 步向导。每一步都是一个独立屏幕，用户选择后点击 `下一步`，第 6 步点击 `完成选择` 进入最终确认页。最终确认页中的 `确认` 才会触发 AI整理。

如果存在 `defaultGenerationPreferences`，6 步向导应使用它作为初始选择；用户修改并完成 6 步后，修改后的选择只是本次 AI整理的临时待确认偏好，只有在最终确认页点击 `确认` 后才成为当前有效默认生成偏好。如果不存在 `defaultGenerationPreferences`，6 步向导从空选择开始。

以下 Step 1-6 的中文选项用于说明用户界面中的展示顺序和交互语境；选项契约以 `Option Identity` 中的 `本次生成偏好` 表为准。实现、持久化、worker 请求和 prompt 输入不得从以下中文列表派生 option id。若两处文案不一致，以 `Option Identity` 表中的 `(field, id, label)` 为准，并同步修正文案。

选择和按钮规则：

- Step 1-5 必须选择，不提供跳过；没有 `defaultGenerationPreferences` 时不默认预选任何选项。
- Step 1、2、4 是单选；用户未选择时 `下一步` 禁用。
- Step 3 是多选，至少选择 1 个、最多 3 个；未选择时 `下一步` 禁用，达到 3 个后其它未选项置为不可继续选择。
- Step 5 是多选，至少选择 1 个、最多 2 个；未选择时 `下一步` 禁用，达到 2 个后其它未选项置为不可继续选择。
- Step 6 是可跳过多选，最多 3 个；未选择时仍可点击 `完成选择`。Step 6 可以提供 `跳过` 辅助动作，效果等同于不选择任何避免方向后进入确认页。
- 返回上一步时保留用户已选择的选项。

### Step 1: 本次目标

单选，必选；未选择时 `下一步` 禁用。

- 内容创作
- 学习理解
- 复盘拆解
- 商业洞察
- 争议讨论
- 行动建议

### Step 2: 使用场景

单选，必选；未选择时 `下一步` 禁用。

- 自己记录
- 发短视频
- 写图文/公众号
- 做直播/播客
- 团队分享
- 客户沟通
- 课程/社群

### Step 3: 关注角度

多选，必选，至少 1 个、最多 3 个；未选择时 `下一步` 禁用。

- 选题角度
- 反常识观点
- 人群痛点
- 实操建议
- 案例类比
- 风险争议
- 趋势判断
- 可复用方法
- 金句表达
- 认知刷新

### Step 4: 目标受众

单选，必选；未选择时 `下一步` 禁用。

- 给自己看
- 给新手看
- 给同行看
- 给客户看
- 给老板/团队看
- 给粉丝/读者看

### Step 5: 表达风格

多选，必选，至少 1 个、最多 2 个；未选择时 `下一步` 禁用。

- 直接犀利
- 温和启发
- 专业分析
- 接地气
- 故事化
- 更适合短视频
- 更适合长文

### Step 6: 避免方向

多选，最多 3 个，可跳过；未选择时 `完成选择` 仍可用。

- 不要太鸡汤
- 不要太学术
- 不要太空泛
- 不要标题党
- 不要太商业化
- 不要太负面
- 不要宏大叙事

## Confirmation Panel

6 步完成后，FrameQ 展示 AI整理确认页：

- 当前视频或文字稿摘要。
- `我的灵感档案` 摘要，只展示用户已选择的选项。
- `本次生成偏好` 摘要。
- 本次会消耗的 AI整理额度口径：`1 次额度 = 1 次云端 LLM API 调用尝试`。确认页不得固定显示为 `1 次`；应说明本次 AI整理会按实际 LLM 调用次数扣除，并可展示当前实现的预计调用构成。
- 明确提示：AI整理会把文字稿片段发送给管理员配置的云端 LLM 服务，用于生成 `要点总结`、Mermaid mindmap 和 `启发话题点`；本次档案摘要和生成偏好快照仅发送给 `启发话题点` 生成请求，不随 `要点总结` 或 Mermaid mindmap 请求发送，也不影响二者的生成方式。
- 操作按钮：`确认`、`返回修改`、`取消`。

用户点击 `确认` 后才触发 worker 的 AI整理流程。

## Quota Consumption

- `1 次额度` 表示 FrameQ 向云端 LLM 发起 1 次 chat-completion/API 调用尝试，不表示 1 次 AI整理任务包。
- 用户在确认页点击 `确认` 后，AI整理会按实际 LLM API 调用次数消耗额度。当前三项产物通常至少包含 Mermaid mindmap、要点总结、话题规划和话题点生成等多次 LLM 调用；实现不得再把整次 AI整理按固定 1 次额度结算。
- 每次 LLM API 调用尝试在发起前或发起时扣除 1 次额度；该次调用失败、超时、返回不可解析、或最终导致 AI整理部分失败时，对应额度不自动返还。
- `返回修改`、`取消`、只进入向导或只进入确认页不消耗额度。
- 确认页点击 `取消` 会废弃本次临时 6 步选择，不更新 `defaultGenerationPreferences`。
- `换个方向` 会重新打开本次 6 步偏好并进入确认页；用户再次点击 `确认` 后，会按新的 AI整理过程中实际发生的 LLM API 调用次数再次扣除额度。
- 如果账户或额度预检未通过，AI整理不会开始，也不消耗额度。

## Result Experience

生成后的 `启发话题点` 详情不只显示问题本身，还应展示轻量解释，帮助用户理解推荐依据。

每个话题点建议包含：

- `话题点`：一句可直接展开的问题或选题。
- `匹配理由`：说明它如何匹配本次目标、用户角色、受众或关注角度。
- `启发问题`：1-2 个追问，帮助用户继续思考。
- `适合用途`：例如短视频选题、团队讨论、个人复盘、客户沟通。

详情页提供 `换个方向` 操作。点击后只重新打开 `本次生成偏好` 6 步流程，不要求用户重新填写 `我的灵感档案`。

## Insight Result Schema

项目当前尚未公开发布，不存在需要保留兼容的真实用户历史任务。个性化话题点启用后，`启发话题点` 的结果不再使用 `string[]`，而是统一使用结构化 Insight 对象数组；无需兼容旧任务格式，也不提供旧任务迁移流程。新的结构化格式是唯一受支持的话题点结果契约。

每个 Insight 对象包含：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `number` | 当前结果内的递增序号，从 1 开始 |
| `topic` | `string` | 一句可直接展开的问题或选题，对应详情页中的 `话题点` |
| `matchReason` | `string` | 说明该话题点如何匹配本次目标、用户角色、受众、关注角度或文字稿内容 |
| `followUpQuestions` | `string[]` | 1-2 个继续追问的问题 |
| `suitableUse` | `string` | 适合用途，例如短视频选题、团队讨论、个人复盘、客户沟通 |
| `sourceChunkId` | `number \| null` | 关联的文字稿片段或话题段 ID；无法稳定关联时为 `null` |

`insights.json` 顶层格式固定为：

```json
{
  "schemaVersion": 1,
  "insights": [
    {
      "id": 1,
      "topic": "这个观点为什么适合作为短视频选题继续展开？",
      "matchReason": "它同时匹配本次目标、关注角度和文字稿中的核心案例。",
      "followUpQuestions": [
        "如果面向新手，最容易误解的地方是什么？",
        "这个观点可以用哪个具体场景开头？"
      ],
      "suitableUse": "短视频选题",
      "sourceChunkId": 3
    }
  ]
}
```

worker `ProcessResult.insights`、任务 manifest 中的 `insights_count`、UI 详情页、复制文本和 Markdown 导出均以该结构化 schema 为准。Markdown 导出应按每个 Insight 分组展示 `话题点`、`匹配理由`、`启发问题` 和 `适合用途`。

## Prompt Strategy

worker 生成话题点时应把偏好以结构化数据传入话题点 prompt，而不是把 UI 文案拼成自然语言长段落。要点总结和 Mermaid mindmap 不读取这些个性化偏好，继续使用原有通用整理 prompt。话题点 prompt 应遵守以下规则：

- `本次目标` 决定话题点的核心类型。
- `使用场景` 决定表达颗粒度和可复用性。
- `关注角度` 决定问题视角和优先排序。
- `目标受众` 决定语言难度、例子和解释方式。
- `我的灵感档案` 用于补足用户长期语境，但不能压过本次选择。
- `表达风格` 调整措辞，不改变事实判断。
- `避免方向` 是硬约束，生成内容应主动避开。
- worker 不应把完整长文字稿和完整偏好说明直接拼入单次话题点 prompt；应优先使用分段、摘要或候选片段，并将 `我的灵感档案` 和 `本次生成偏好` 作为短结构化 JSON 传入。
- 每个话题点必须能追溯到文字稿内容，不允许只根据用户画像凭空发散。
- 当偏好与文字稿内容冲突时，以文字稿事实为准，并在 `匹配理由` 中保持克制。

## Data and Storage

- `我的灵感档案` 只保存在 app-local data 下的本地配置文件中，建议使用独立 JSON 文件，不写入 app-local `.env`。档案字段保存稳定 option id 或 option id 数组，不保存展示 label。
- `我的灵感档案` 读取时必须整体验证；任一必需字段缺失、类型错误、未知 option id 或多选超限时，整份 profile 视为无效，不能用于确认页、worker 请求或 prompt 输入。
- 用户跳过首次档案设置时，应在同一个 app-local 配置文件中保存 `profileSkipped: true`（或等价状态），用于避免后续重复打扰；跳过状态不包含任何画像字段。
- `defaultGenerationPreferences` 保存在同一个 app-local JSON 配置文件中，只记录用户当前有效的 6 步默认生成偏好 option id；它不得从任务 manifest 推导，也不得包含长期档案字段。读取时必须按当前 option registry 校验，校验失败时清空该全局默认偏好并隐藏 `直接生成`。
- `本次生成偏好` 属于当前 AI整理请求中的话题点生成上下文。生成成功后，任务 manifest 可以保存本次使用的任务局部偏好快照，便于用户理解旧话题点是按什么方向生成的。
- 任务局部偏好快照只表示该任务在 AI整理确认时实际使用的生成上下文。它不属于 app-local 全局 `我的灵感档案`，不得用于推导、恢复或更新全局档案，也不得用于推导 `defaultGenerationPreferences`。
- 任务局部偏好快照如包含长期档案摘要，只能保存当次实际使用的结构化 option id、可选 `labelSnapshot` 或 `无档案 / 不指定` 状态；该摘要随任务产物存在，不代表当前全局档案状态。历史任务展示该快照时，可优先使用任务产物中的 `labelSnapshot`，缺失时按当前 option registry 渲染已知 id；它不得反向更新全局档案或 `defaultGenerationPreferences`。
- `insights.json` 必须使用结构化 Insight schema；任务 manifest 的 `insights_count` 只记录 Insight 对象数量，不复制完整话题点内容。
- 偏好快照属于本地任务产物的一部分，不上传 FrameQ server。
- 当 `我的灵感档案` 被跳过或清空时，发送给话题点 prompt 的档案上下文只能表示 `无档案 / 不指定`，不得发送伪造的默认画像。
- 当长期档案多选字段为空数组时，发送给话题点 prompt 的该字段上下文只能表示 `不指定`，不得补任何默认平台、表达风格或避雷偏好。
- 日志、错误文案和诊断信息不得输出完整个人档案、完整生成偏好、完整文字稿或完整 prompt。
- 清空 `我的灵感档案` 后，后续新任务不再使用旧档案；已经生成的历史任务产物保持不变。应用不得因清空全局档案而遍历、修改或删除历史任务目录、`frameq-task.json`、`insights.json` 或导出文件。

## Architecture Boundary

- UI 拥有向导状态、选项展示、确认页和结果详情交互。
- Tauri 拥有 app-local 偏好文件的读取、保存、清空和路径约束；清空全局档案时只操作 app-local 偏好文件，不操作历史任务目录。
- worker 只在启发话题点生成步骤接收结构化的偏好快照和已保存的正式文字稿；要点总结和 Mermaid mindmap 生成不得读取、传递或拼接该偏好快照。
- FrameQ server 仍然只负责账号、权益、配额和 LLM checkout；server 不接收、不存储、不推断用户偏好。
- LLM supplier 会在用户确认后收到文字稿片段；偏好快照只随启发话题点生成请求发送，不随要点总结或 Mermaid mindmap 请求发送。确认页必须明确提示。

## Acceptance Criteria

- 首次生成话题点时，如果没有本地灵感档案，用户可以设置或跳过。
- 用户跳过首次灵感档案设置后，应用会本地记住跳过状态，后续生成不再重复打扰；跳过状态不会产生或发送任何默认画像。
- `hasProfile || profileSkipped` 都视为首次引导已完成；`profileSkipped: true` 的用户再次生成时直接进入本次生成偏好或默认生成偏好摘要页。
- 已设置灵感档案的用户再次生成话题点时，不会重复出现长期信息填写流程。
- 已设置灵感档案且存在 `defaultGenerationPreferences` 的用户点击 `直接生成` 时，只跳过 6 步选择流程，仍必须进入确认页。
- `defaultGenerationPreferences` 只能在用户于 AI整理确认页点击 `确认` 后更新；完成 6 步但取消 AI整理时，本次临时选择会被废弃，不得覆盖此前默认生成偏好。
- `defaultGenerationPreferences` 只保存稳定 option id，不保存展示文案；读取时如果发现未知 id、缺失必填步骤或违反数量限制，应用清空该全局默认偏好，不展示 `直接生成`，并要求用户重新完成 6 步。
- `我的灵感档案` 读取时如果整体验证失败，应用提示 `灵感档案需要重新设置`，不得使用损坏档案生成摘要或发送给 worker；用户重新设置或主动点击 `跳过` 前，不得把无效 profile 当作 `未设置灵感档案` 继续生成。
- 长期档案单选字段提供 `不指定`；多选字段允许 0 个选择，空数组表示该字段不指定，并且确认页摘要默认不展示空数组字段。
- 本次生成偏好固定为 6 步，且 6 步不包含长期个人信息。
- Step 1-5 必须选择，未选择时 `下一步` 禁用；Step 6 可跳过，未选择时 `完成选择` 仍可用。
- 所有输入都是选项，不出现自由文本输入框。
- `确认` 前展示档案摘要、本次偏好摘要、额度消耗和云端 LLM 数据提示。
- 一次确认后的 AI整理按实际云端 LLM API 调用次数扣除额度；失败或部分失败时，已经发起的 LLM 调用额度不自动返还；`换个方向` 后再次确认会按新的调用次数再次扣除。
- 个性化偏好只影响 `启发话题点`；`要点总结` 和 Mermaid mindmap 的内容不因这些偏好发生个性化调整。
- 生成结果中的每个话题点包含匹配理由、启发问题和适合用途。
- `insights.json`、worker `ProcessResult.insights`、UI 详情页、复制文本和 Markdown 导出均使用结构化 Insight schema，不再使用 `string[]` 话题点格式。
- `换个方向` 只重走本次 6 步偏好，不要求重新填写长期档案。
- `清空灵感档案` 后，应用删除 app-local 全局档案并设置 `profileSkipped: false`；下次生成话题点时重新展示首次设置引导，新生成不得使用旧档案，历史任务 manifest、`insights.json` 和导出文件保持不变。
- FrameQ server 不新增保存用户偏好、文字稿或话题点的接口或字段。
