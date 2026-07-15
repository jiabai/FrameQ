from __future__ import annotations

import json

from frameq_worker.models import Insight, PreferenceSnapshot


def build_topic_plan_prompt(
    text: str,
    max_topics: int = 8,
    max_questions: int = 12,
    language: str = "中文",
    preference_snapshot: PreferenceSnapshot | None = None,
) -> str:
    preference_prompt_section = ""
    if preference_snapshot is not None:
        preference_prompt_section = f"""
## 个性化偏好快照
以下 JSON 只用于启发灵感的选段、排序和 question_count 分配，不用于总结或思维导图。
优先参考 `generationPreferences` 判断哪些话题段更贴近本次目标、场景、关注角度和受众；
`labelSnapshot` 仅用于理解选项含义。
```json
{format_preference_snapshot_for_prompt(preference_snapshot)}
```
"""

    return f"""
# 角色使命
你是一位话题分段规划师。你的任务不是生成问题，而是先把一整段可能没有自然分段的 ASR 文字稿，
规划成适合后续生成启发灵感的语义话题段。

## 核心任务
根据用户提供的文字稿（长度：{len(text)} 字），提炼最多 {max_topics} 个高价值话题段。
所有输出必须使用：{language}。
{preference_prompt_section}

## 规划原则
- 忽略寒暄、重复、口头禅、无信息铺垫和单纯转场。
- 优先保留有观点、方法、冲突、经验、决策、行业判断或技术落地价值的内容。
- 个性化偏好只能调整话题段优先级、排序和 `question_count`，不得补充文字稿没有的事实或观点。
- 当偏好与文字稿事实冲突时，以文字稿事实为准。
- 每个话题段只聚焦一个主要议题，避免把多个不相关主题混在一起。
- `excerpt` 必须来自原文字稿或忠实贴近原文表达，用于给后续问题生成提供上下文。
- `question_count` 必须根据话题密度设置为 1 到 3 之间的整数。
- 所有话题段的 `question_count` 总和不得超过 {max_questions}。

## 输出格式
- 只输出 JSON 数组，不要输出解释、Markdown 或额外文字。
- JSON 数组必须严格符合以下结构：
```json
[
  {{
    "id": 1,
    "title": "话题标题",
    "summary": "这一段主要在讲什么",
    "excerpt": "从原文字稿中提取或忠实压缩的相关片段",
    "question_count": 2
  }}
]
```

## 待处理文字稿
{text}
"""


def build_question_prompt(
    text: str,
    number: int,
    language: str = "中文",
    global_prompt: str = "",
    question_prompt: str = "",
    preference_snapshot: PreferenceSnapshot | None = None,
) -> str:
    global_prompt_section = ""
    if global_prompt:
        global_prompt_section = f"""
## 全局附加约束
{global_prompt}
"""

    question_prompt_section = ""
    if question_prompt:
        question_prompt_section = f"""
## 本次问题生成附加要求
{question_prompt}
"""

    preference_prompt_section = ""
    if preference_snapshot is not None:
        preference_prompt_section = f"""
## 个性化偏好快照
以下 JSON 只用于生成启发灵感，不用于总结或思维导图。
优先参考 `generationPreferences`，`labelSnapshot` 仅用于理解选项含义。
```json
{format_preference_snapshot_for_prompt(preference_snapshot)}
```
"""

    return f"""
# 角色使命
你是一位阅读思考伙伴和议题策展者。你的任务不是把文章改写成阅读理解题，
而是从文章案例中提炼能够启发用户继续思考的开放式议题问句。
{global_prompt_section}
{preference_prompt_section}

## 核心任务
根据用户提供的文本（长度：{len(text)} 字），生成不少于 {number} 个高质量问题。
每个问题都必须是可迁移的议题问句，输出语言必须是：{language}。
{question_prompt_section}

## 生成原则
- 优先抽象为行业、方法、组织、决策、技术落地等可迁移角度。
- 避免阅读理解式问题，不要要求用户复述文章中的某家公司、某个人物、某个产品做了什么。
- 默认不要把公司名、人物名、产品名作为问题主语；可以把它们作为案例来源，
  但问题本身要指向更通用的思考角度。
- 问题应当开放、具体、有讨论价值，适合用户点击后继续追问或回答。
- 不要生成事实核对题、定义题、摘要题、考试题。

## 面向人类读者的表达优化
- 站在人类读者的视角写问题，问题本身要自然、清晰、顺口，读完就知道可以从哪个角度思考。
- 每个问题只聚焦一个核心思考点，避免把多个条件、比较对象和结论塞进同一句。
- 少用嵌套从句、抽象名词堆叠和过长限定语；必要时用短句表达因果或对比。
- 避免机器翻译腔、模板化问法和生硬术语；专业概念要放在清楚的语境里。
- 问题长度尽量控制在一行可读范围内，不为了显得专业而牺牲理解成本。

## 风格示例
- 避免：特赞科技推出的 GEA 与传统工具有何区别？
- 改为：企业级 Agent 和通用 AI 工具的价值分水岭是什么？
- 避免：范凌认为 Context 和 Orchestration 分别是什么意思？
- 改为：为什么企业 AI 落地时，上下文能力和流程编排可能比单点模型能力更关键？

## 输出格式
- JSON 数组格式必须正确
- 输出的 JSON 数组必须严格符合以下结构：
```json
[
  {{
    "topic": "为什么企业 AI 落地时，上下文能力和流程编排可能比单点模型能力更关键？",
    "matchReason": "为什么这条灵感匹配文字稿和偏好",
    "followUpQuestions": ["可以继续追问的问题"],
    "suitableUse": "适合的使用场景"
  }}
]
```

## 待处理文本
{text}
"""


def format_preference_snapshot_for_prompt(snapshot: PreferenceSnapshot) -> str:
    return json.dumps(
        {
            "profile": _profile_to_prompt_dict(snapshot),
            "profileSkipped": snapshot.profile_skipped,
            "generationPreferences": {
                "goal": snapshot.generation_preferences.goal,
                "scenario": snapshot.generation_preferences.scenario,
                "angles": list(snapshot.generation_preferences.angles),
                "audience": snapshot.generation_preferences.audience,
                "styles": list(snapshot.generation_preferences.styles),
                "avoid": list(snapshot.generation_preferences.avoid),
            },
            "labelSnapshot": {
                "profile": [
                    _label_snapshot_item_to_prompt_dict(item)
                    for item in snapshot.label_snapshot.profile
                ],
                "generationPreferences": [
                    _label_snapshot_item_to_prompt_dict(item)
                    for item in snapshot.label_snapshot.generation_preferences
                ],
            },
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )


def _profile_to_prompt_dict(snapshot: PreferenceSnapshot) -> dict[str, object] | None:
    if snapshot.profile is None:
        return None
    return {
        "role": snapshot.profile.role,
        "domain": snapshot.profile.domain,
        "stage": snapshot.profile.stage,
        "cityContext": snapshot.profile.city_context,
        "genderPerspective": snapshot.profile.gender_perspective,
        "platforms": list(snapshot.profile.platforms),
        "defaultStyles": list(snapshot.profile.default_styles),
        "defaultAvoid": list(snapshot.profile.default_avoid),
    }


def _label_snapshot_item_to_prompt_dict(item) -> dict[str, object]:
    return {
        "field": item.field,
        "label": item.label,
        "values": [
            {
                "id": value.id,
                "label": value.label,
            }
            for value in item.values
        ],
    }


def build_mindmap_prompt(
    text: str,
    language: str = "中文",
) -> str:
    return f"""
# 角色使命
你是一位逻辑思维导图整理师。你的任务是根据文字稿原文，提炼内容的主线、分支和层级关系，
输出一份可以直接保存到本地文件的 Mermaid mindmap 文本。

## 核心任务
根据用户提供的文字稿（长度：{len(text)} 字），整理为逻辑清晰的思维导图。
所有节点必须使用：{language}。

## 生成原则
- 优先呈现观点、方法、因果、步骤、冲突、结论和可迁移经验。
- 删除寒暄、重复、口头禅和无信息转场。
- 顶层节点应表达整段文字稿的核心主题，二级和三级节点表达主要分支和支撑要点。
- 节点文字要短，避免整句长段落。
- 不要补充原文没有的事实、数字、人物或结论。

## 输出格式
- 只输出 Mermaid mindmap 源码，不要输出解释、Markdown 代码围栏或额外文字。
- 第一行必须是 `mindmap`。
- 使用 Mermaid mindmap 语法，例如：
mindmap
  root((核心主题))
    分支一
      要点一
    分支二
      要点二

## 待处理文字稿
{text}
"""


def build_summary_prompt(
    transcript_markdown: str,
    mermaid_mindmap: str,
    language: str = "中文",
) -> str:
    return f"""
# 角色使命
你是一位内容总结编辑。你的任务是根据文字稿原文和 Mermaid 思维导图，对文字稿做要点总结。

## 输入材料
### 文字稿原文
{transcript_markdown}

### Mermaid 思维导图
{mermaid_mindmap}

## 输出要求
- 使用：{language}。
- 只输出 Markdown 总结正文，不要输出 Mermaid 文本、代码围栏或解释过程。
- 结构必须包含 `# 要点总结` 标题。
- 使用分层 Markdown：先写 `## 总览`，再写 2 到 6 个主题小节，每个主题小节下用短要点概括。
- 总结必须忠实于文字稿原文；Mermaid 只用于帮助组织逻辑，不得引入新事实。
- 要点要适合 UI 直接展示和复制，避免空泛套话。
"""


# draft 目标平台词表：9 个稳定英文 id。映射表 + 透传显示名 + 合法 id 集合
# 同处定义，作为单一事实源——requests.parse_retry_insights_request 也导入
# DRAFT_PLATFORM_IDS 做校验，避免前后端两份词表漂移。
_DRAFT_PLATFORM_LABELS: dict[str, str] = {
    "wechat_official_account": "微信公众号",
    "xiaohongshu": "小红书",
    # 短视频系（视频号 / 抖音 / Tiktok / X）统一走「抖音」文体。
    "wechat_channels": "抖音",
    "douyin": "抖音",
    "tiktok": "抖音",
    "twitter": "抖音",
}

# 透传分支：取显示名原样写进 prompt「目标平台：{显示名}」，不挂特定文体（兜底）。
_DRAFT_PLATFORM_PASSTHROUGH_LABELS: dict[str, str] = {
    "bilibili": "B站",
    "youtube": "Youtube",
    "other": "其他",
}

# 9-id 合法词表（映射键 ∪ 透传键）。词表外 id 视为非法，由 request 校验拦截。
DRAFT_PLATFORM_IDS: frozenset[str] = frozenset(
    _DRAFT_PLATFORM_LABELS.keys() | _DRAFT_PLATFORM_PASSTHROUGH_LABELS.keys()
)


def _platform_label_for_draft_platform(platform_id: str) -> str:
    """Map a user-selected draft platform id to the prompt「目标平台」form label.

    短视频系合并到「抖音」；公众号→微信公众号；小红书→小红书；bilibili/youtube/other
    取透传显示名。词表外的 id（校验上游已拦）原样透传，绝不臆造平台文体。
    """
    if platform_id in _DRAFT_PLATFORM_LABELS:
        return _DRAFT_PLATFORM_LABELS[platform_id]
    return _DRAFT_PLATFORM_PASSTHROUGH_LABELS.get(platform_id, platform_id)


def build_draft_from_inspiration_prompt(
    seed: Insight,
    preference_snapshot: PreferenceSnapshot | None,
    summary: str | None = None,
    *,
    platform: str,
) -> str:
    """构造「生成文字稿」种子 prompt。

    字段映射：
    - ``seed.topic`` → 中央议题 / 标题方向。
    - ``seed.follow_up_questions`` → 章节骨架 / 子论点。
    - ``platform`` → 目标平台（用户在确认页所选 id；经 ``_platform_label_for_draft_platform``
      映射成文体标签，不再读 ``seed.suitable_use``）。
    - ``seed.match_reason`` → 目标感锚点，防跑题。
    - ``preference_snapshot`` → 偏好（语气/受众/角度/回避）。缺失 → 不进行个性化，
      绝不臆造角色 / 领域 / 风格。
    - ``seed.source_chunk_id`` → 仅作溯源标注；其文字稿片段正文一律不进入 prompt。
    - ``summary`` → 可选的原视频要点总结 grounding；为 None 时整体省略。
    """
    platform_label = _platform_label_for_draft_platform(platform)

    skeleton_lines = "\n".join(
        f"- {q}" for q in seed.follow_up_questions
    ) if seed.follow_up_questions else "- （灵感未提供章节骨架，请按目标平台文体自行规划）"

    source_annotation = (
        f"## 溯源标注\n灵感来源于原视频第 {seed.source_chunk_id} 段；"
        "本段文字稿原文不进入本 prompt，请基于检索与上述灵感字段成稿。\n"
        if seed.source_chunk_id is not None
        else ""
    )

    if preference_snapshot is not None:
        preference_section = (
            "## 偏好快照（个性化：语气 / 受众 / 角度 / 回避）\n"
            "以下 JSON 仅用于调整成稿的语气、受众、角度与回避项，不得用来补充灵感之外的"
            "事实或观点；与灵感事实冲突时以灵感为准。\n"
            "```json\n"
            f"{format_preference_snapshot_for_prompt(preference_snapshot)}\n"
            "```\n"
        )
    else:
        preference_section = (
            "## 偏好快照（个性化：语气 / 受众 / 角度 / 回避）\n"
            "本次未提供偏好快照——不进行个性化，也不要臆造任何角色、领域、受众或风格；"
            "按目标平台通用文体成稿即可。\n"
        )

    summary_section = ""
    # 「在场」语义与 draft_agent._summary_is_present 保持一致：非 None 且 strip 后
    # 非空。纯空白 summary 按缺失处理，避免与系统侧 prompt 矛盾。
    if summary is not None and summary.strip():
        summary_section = (
            "## 原视频要点总结（可选 grounding）\n"
            "以下要点总结来自原视频，可作为观点来源与事实 grounding；"
            "引用其观点时按原创性规则标注来源，不要原样复制整段。\n"
            f"{summary}\n"
        )

    return f"""
# 角色使命
你是一位内容成稿编辑。你的任务是把一条「灵感」扩展成一篇完整、可直接发布的稿子。

## 灵感（中央议题 / 标题方向）
{seed.topic}

## 目标感锚点（防跑题）
{seed.match_reason}

## 章节骨架 / 子论点（来自灵感的追问方向）
{skeleton_lines}

## 目标平台与体裁
目标平台：{platform_label}。请按该平台文体的常规结构与表达密度成稿。
{source_annotation}
{preference_section}
{summary_section}
## 成稿要求
- 忠于灵感字段给出的方向与子论点；可基于检索补充论据，但不得替换灵感的核心立场。
- 不得引入灵感之外的虚构人物、公司、数据或事件。
- 输出一份完整、可直接发布的稿子正文（Markdown）。
"""
