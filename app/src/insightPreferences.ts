export type ProfileField =
  | "role"
  | "domain"
  | "stage"
  | "cityContext"
  | "genderPerspective"
  | "platforms"
  | "defaultStyles"
  | "defaultAvoid";

export type GenerationPreferenceField =
  | "goal"
  | "scenario"
  | "angles"
  | "audience"
  | "styles"
  | "avoid";

export type PreferenceField = ProfileField | GenerationPreferenceField;

export type InspirationProfile = {
  role: string;
  domain: string;
  stage: string;
  cityContext: string;
  genderPerspective: string;
  platforms: string[];
  defaultStyles: string[];
  defaultAvoid: string[];
};

export type GenerationPreferences = {
  goal: string;
  scenario: string;
  angles: string[];
  audience: string;
  styles: string[];
  avoid: string[];
};

export type Insight = {
  id: number;
  topic: string;
  matchReason: string;
  followUpQuestions: string[];
  suitableUse: string;
  sourceChunkId: number | null;
};

export type PreferenceLabelValue = {
  id: string;
  label: string;
};

export type PreferenceLabelSnapshotItem = {
  field: PreferenceField;
  label: string;
  values: PreferenceLabelValue[];
};

export type PreferenceSnapshot = {
  profile: InspirationProfile | null;
  profileSkipped: boolean;
  generationPreferences: GenerationPreferences;
  labelSnapshot: {
    profile: PreferenceLabelSnapshotItem[];
    generationPreferences: PreferenceLabelSnapshotItem[];
  };
};

export type OptionDefinition = {
  id: string;
  label: string;
};

export type FieldConfig = {
  label: string;
  mode: "single" | "multi";
  min: number;
  max: number;
  options: readonly OptionDefinition[];
};

export const PROFILE_FIELD_ORDER: ProfileField[] = [
  "role",
  "domain",
  "stage",
  "cityContext",
  "genderPerspective",
  "platforms",
  "defaultStyles",
  "defaultAvoid",
];

export const GENERATION_FIELD_ORDER: GenerationPreferenceField[] = [
  "goal",
  "scenario",
  "angles",
  "audience",
  "styles",
  "avoid",
];

const PROFILE_FIELD_CONFIGS: Record<ProfileField, FieldConfig> = {
  role: {
    label: "我的角色",
    mode: "single",
    min: 1,
    max: 1,
    options: [
      { id: "content_creator", label: "内容创作者" },
      { id: "product_ops", label: "产品/运营" },
      { id: "marketing_sales", label: "市场/销售" },
      { id: "entrepreneur", label: "创业者" },
      { id: "student_researcher", label: "学生/研究者" },
      { id: "teacher_trainer", label: "教师/培训者" },
      { id: "investor_business_analyst", label: "投资/商业分析" },
      { id: "general_learner", label: "普通学习者" },
      { id: "unspecified", label: "不指定" },
    ],
  },
  domain: {
    label: "职业领域",
    mode: "single",
    min: 1,
    max: 1,
    options: [
      { id: "content_media", label: "内容媒体" },
      { id: "product_operations", label: "产品运营" },
      { id: "marketing_sales", label: "市场销售" },
      { id: "education_training", label: "教育培训" },
      { id: "technology_rd", label: "技术研发" },
      { id: "management_consulting", label: "管理咨询" },
      { id: "investment_business", label: "投资商业" },
      { id: "freelance", label: "自由职业" },
      { id: "general_perspective", label: "通用视角" },
      { id: "unspecified", label: "不指定" },
    ],
  },
  stage: {
    label: "年龄/阶段",
    mode: "single",
    min: 1,
    max: 1,
    options: [
      { id: "student", label: "学生" },
      { id: "early_career", label: "职场新人" },
      { id: "experienced_professional", label: "成熟职场" },
      { id: "manager", label: "管理者" },
      { id: "entrepreneur_operator", label: "创业经营者" },
      { id: "retired", label: "退休后" },
      { id: "unspecified", label: "不指定" },
    ],
  },
  cityContext: {
    label: "城市语境",
    mode: "single",
    min: 1,
    max: 1,
    options: [
      { id: "tier1_city", label: "一线城市" },
      { id: "new_tier1_city", label: "新一线城市" },
      { id: "lower_tier_city", label: "二三线城市" },
      { id: "county_township", label: "县城乡镇" },
      { id: "overseas", label: "海外" },
      { id: "unspecified", label: "不指定" },
    ],
  },
  genderPerspective: {
    label: "性别/视角",
    mode: "single",
    min: 1,
    max: 1,
    options: [
      { id: "unspecified", label: "不指定" },
      { id: "female_perspective", label: "女性视角" },
      { id: "male_perspective", label: "男性视角" },
      { id: "neutral_perspective", label: "中性视角" },
    ],
  },
  platforms: {
    label: "常用平台",
    mode: "multi",
    min: 0,
    max: 3,
    options: [
      { id: "douyin", label: "抖音" },
      { id: "xiaohongshu", label: "小红书" },
      { id: "wechat_channels", label: "视频号" },
      { id: "bilibili", label: "B站" },
      { id: "wechat_official_account", label: "公众号" },
      { id: "podcast", label: "播客" },
      { id: "course_community", label: "课程/社群" },
      { id: "internal_sharing", label: "内部分享" },
    ],
  },
  defaultStyles: {
    label: "默认表达偏好",
    mode: "multi",
    min: 0,
    max: 3,
    options: [
      { id: "direct_sharp", label: "直接犀利" },
      { id: "gentle_inspiring", label: "温和启发" },
      { id: "professional_analysis", label: "专业分析" },
      { id: "grounded", label: "接地气" },
      { id: "storytelling", label: "故事化" },
      { id: "short_video_friendly", label: "适合短视频" },
      { id: "long_form_friendly", label: "适合长文" },
    ],
  },
  defaultAvoid: {
    label: "默认避雷偏好",
    mode: "multi",
    min: 0,
    max: 3,
    options: [
      { id: "chicken_soup", label: "太鸡汤" },
      { id: "academic", label: "太学术" },
      { id: "vague", label: "太空泛" },
      { id: "clickbait", label: "太标题党" },
      { id: "commercialized", label: "太商业化" },
      { id: "negative", label: "太负面" },
      { id: "grand_narrative", label: "宏大叙事" },
    ],
  },
};

const GENERATION_FIELD_CONFIGS: Record<GenerationPreferenceField, FieldConfig> = {
  goal: {
    label: "本次目标",
    mode: "single",
    min: 1,
    max: 1,
    options: [
      { id: "content_creation", label: "内容创作" },
      { id: "learning_understanding", label: "学习理解" },
      { id: "review_deconstruction", label: "复盘拆解" },
      { id: "business_insight", label: "商业洞察" },
      { id: "controversy_discussion", label: "争议讨论" },
      { id: "action_advice", label: "行动建议" },
    ],
  },
  scenario: {
    label: "使用场景",
    mode: "single",
    min: 1,
    max: 1,
    options: [
      { id: "personal_notes", label: "自己记录" },
      { id: "short_video", label: "发短视频" },
      { id: "article_official_account", label: "写图文/公众号" },
      { id: "livestream_podcast", label: "做直播/播客" },
      { id: "team_sharing", label: "团队分享" },
      { id: "client_communication", label: "客户沟通" },
      { id: "course_community", label: "课程/社群" },
    ],
  },
  angles: {
    label: "关注角度",
    mode: "multi",
    min: 1,
    max: 3,
    options: [
      { id: "topic_angle", label: "选题角度" },
      { id: "contrarian_view", label: "反常识观点" },
      { id: "audience_pain_point", label: "人群痛点" },
      { id: "practical_advice", label: "实操建议" },
      { id: "case_analogy", label: "案例类比" },
      { id: "risk_controversy", label: "风险争议" },
      { id: "trend_judgment", label: "趋势判断" },
      { id: "reusable_method", label: "可复用方法" },
      { id: "memorable_phrase", label: "金句表达" },
      { id: "cognitive_refresh", label: "认知刷新" },
    ],
  },
  audience: {
    label: "目标受众",
    mode: "single",
    min: 1,
    max: 1,
    options: [
      { id: "self", label: "给自己看" },
      { id: "beginners", label: "给新手看" },
      { id: "peers", label: "给同行看" },
      { id: "clients", label: "给客户看" },
      { id: "boss_team", label: "给老板/团队看" },
      { id: "fans_readers", label: "给粉丝/读者看" },
    ],
  },
  styles: {
    label: "表达风格",
    mode: "multi",
    min: 1,
    max: 2,
    options: [
      { id: "direct_sharp", label: "直接犀利" },
      { id: "gentle_inspiring", label: "温和启发" },
      { id: "professional_analysis", label: "专业分析" },
      { id: "grounded", label: "接地气" },
      { id: "storytelling", label: "故事化" },
      { id: "short_video_friendly", label: "更适合短视频" },
      { id: "long_form_friendly", label: "更适合长文" },
    ],
  },
  avoid: {
    label: "避免方向",
    mode: "multi",
    min: 0,
    max: 3,
    options: [
      { id: "chicken_soup", label: "不要太鸡汤" },
      { id: "academic", label: "不要太学术" },
      { id: "vague", label: "不要太空泛" },
      { id: "clickbait", label: "不要标题党" },
      { id: "commercialized", label: "不要太商业化" },
      { id: "negative", label: "不要太负面" },
      { id: "grand_narrative", label: "不要宏大叙事" },
    ],
  },
};

export const INSIGHT_PREFERENCE_FIELDS: Record<PreferenceField, FieldConfig> = {
  ...PROFILE_FIELD_CONFIGS,
  ...GENERATION_FIELD_CONFIGS,
};

// --- Draft platform selection ----------------------------------------------
// 9 stable English ids shared with the worker's DRAFT_PLATFORM_IDS. The selector
// needs DISTINCT display labels per id (the worker's
// _DRAFT_PLATFORM_LABELS collapses the short-video group to a single 抖音 form
// label for the prompt; those form labels are NOT selector labels). For the 5
// ids reused from INSIGHT_PREFERENCE_FIELDS.platforms the labels intentionally
// match the profile selector.
export type DraftPlatformId =
  | "wechat_official_account"
  | "xiaohongshu"
  | "wechat_channels"
  | "douyin"
  | "tiktok"
  | "twitter"
  | "bilibili"
  | "youtube"
  | "other";

export type DraftPlatformOption = {
  id: DraftPlatformId;
  label: string;
};

export const DRAFT_PLATFORMS: readonly DraftPlatformOption[] = [
  { id: "wechat_official_account", label: "公众号" },
  { id: "xiaohongshu", label: "小红书" },
  { id: "wechat_channels", label: "视频号" },
  { id: "douyin", label: "抖音" },
  { id: "tiktok", label: "Tiktok" },
  { id: "twitter", label: "X(Twitter)" },
  { id: "bilibili", label: "B站" },
  { id: "youtube", label: "Youtube" },
  { id: "other", label: "其他" },
];

export const DRAFT_PLATFORM_IDS: ReadonlySet<DraftPlatformId> = new Set(
  DRAFT_PLATFORMS.map((option) => option.id),
);

// Preselect only when the profile has exactly one platform AND that id is
// in the 9-id draft vocabulary (identity mapping — id unchanged). 0 / ≥2 /
// single-unmappable (podcast / course_community / internal_sharing) ⇒ "other".
export function deriveDefaultDraftPlatform(
  profilePlatforms: readonly string[] | string[] | null | undefined,
): DraftPlatformId {
  if (!profilePlatforms || profilePlatforms.length !== 1) {
    return "other";
  }
  const onlyPlatform = profilePlatforms[0] as DraftPlatformId;
  return DRAFT_PLATFORM_IDS.has(onlyPlatform) ? onlyPlatform : "other";
}

export function validateInspirationProfile(value: unknown): InspirationProfile | null {
  if (!isRecord(value)) {
    return null;
  }

  const role = validateSingleField(value.role, "role");
  const domain = validateSingleField(value.domain, "domain");
  const stage = validateSingleField(value.stage, "stage");
  const cityContext = validateSingleField(value.cityContext, "cityContext");
  const genderPerspective = validateSingleField(value.genderPerspective, "genderPerspective");
  const platforms = validateMultiField(value.platforms, "platforms");
  const defaultStyles = validateMultiField(value.defaultStyles, "defaultStyles");
  const defaultAvoid = validateMultiField(value.defaultAvoid, "defaultAvoid");

  if (
    role === null ||
    domain === null ||
    stage === null ||
    cityContext === null ||
    genderPerspective === null ||
    platforms === null ||
    defaultStyles === null ||
    defaultAvoid === null
  ) {
    return null;
  }

  return {
    role,
    domain,
    stage,
    cityContext,
    genderPerspective,
    platforms,
    defaultStyles,
    defaultAvoid,
  };
}

export function validateGenerationPreferences(value: unknown): GenerationPreferences | null {
  if (!isRecord(value)) {
    return null;
  }

  const goal = validateSingleField(value.goal, "goal");
  const scenario = validateSingleField(value.scenario, "scenario");
  const angles = validateMultiField(value.angles, "angles");
  const audience = validateSingleField(value.audience, "audience");
  const styles = validateMultiField(value.styles, "styles");
  const avoid = validateMultiField(value.avoid, "avoid");

  if (
    goal === null ||
    scenario === null ||
    angles === null ||
    audience === null ||
    styles === null ||
    avoid === null
  ) {
    return null;
  }

  return {
    goal,
    scenario,
    angles,
    audience,
    styles,
    avoid,
  };
}

export function getOptionLabel(field: PreferenceField, id: string): string | null {
  return getOption(field, id)?.label ?? null;
}

export function summarizeInspirationProfile(profile: InspirationProfile | null): string[] {
  if (!profile) {
    return ["未设置灵感档案"];
  }

  return createLabelSnapshot(PROFILE_FIELD_ORDER, profile, {
    skipUnspecifiedSingles: true,
    skipEmptyMulti: true,
  }).map(formatSnapshotItem);
}

export function summarizeGenerationPreferences(preferences: GenerationPreferences): string[] {
  return createLabelSnapshot(GENERATION_FIELD_ORDER, preferences, {
    skipUnspecifiedSingles: false,
    skipEmptyMulti: false,
  }).map(formatSnapshotItem);
}

export function buildPreferenceSnapshot(input: {
  profile: InspirationProfile | null;
  profileSkipped: boolean;
  generationPreferences: GenerationPreferences;
}): PreferenceSnapshot {
  return {
    profile: input.profile,
    profileSkipped: input.profileSkipped,
    generationPreferences: input.generationPreferences,
    labelSnapshot: {
      profile: input.profile
        ? createLabelSnapshot(PROFILE_FIELD_ORDER, input.profile, {
            skipUnspecifiedSingles: true,
            skipEmptyMulti: true,
          })
        : [],
      generationPreferences: createLabelSnapshot(
        GENERATION_FIELD_ORDER,
        input.generationPreferences,
        {
          skipUnspecifiedSingles: false,
          skipEmptyMulti: false,
        },
      ),
    },
  };
}

function validateSingleField(value: unknown, field: PreferenceField): string | null {
  const config = INSIGHT_PREFERENCE_FIELDS[field];
  if (config.mode !== "single" || typeof value !== "string") {
    return null;
  }
  return getOption(field, value) ? value : null;
}

function validateMultiField(value: unknown, field: PreferenceField): string[] | null {
  const config = INSIGHT_PREFERENCE_FIELDS[field];
  if (config.mode !== "multi" || !Array.isArray(value)) {
    return null;
  }
  if (value.length < config.min || value.length > config.max) {
    return null;
  }
  if (!value.every((item): item is string => typeof item === "string")) {
    return null;
  }
  if (new Set(value).size !== value.length) {
    return null;
  }
  if (!value.every((id) => getOption(field, id))) {
    return null;
  }
  return [...value];
}

function getOption(field: PreferenceField, id: string): OptionDefinition | null {
  return INSIGHT_PREFERENCE_FIELDS[field].options.find((option) => option.id === id) ?? null;
}

function createLabelSnapshot(
  fields: readonly PreferenceField[],
  values: Record<string, string | string[]>,
  options: {
    skipUnspecifiedSingles: boolean;
    skipEmptyMulti: boolean;
  },
): PreferenceLabelSnapshotItem[] {
  const items: PreferenceLabelSnapshotItem[] = [];
  for (const field of fields) {
    const config = INSIGHT_PREFERENCE_FIELDS[field];
    const rawValue = values[field];
    if (config.mode === "single") {
      if (typeof rawValue !== "string") {
        continue;
      }
      if (options.skipUnspecifiedSingles && rawValue === "unspecified") {
        continue;
      }
      const option = getOption(field, rawValue);
      if (option) {
        items.push({
          field,
          label: config.label,
          values: [{ id: option.id, label: option.label }],
        });
      }
      continue;
    }

    if (!Array.isArray(rawValue)) {
      continue;
    }
    const selected = rawValue
      .map((id) => getOption(field, id))
      .filter((option): option is OptionDefinition => option !== null)
      .map((option) => ({ id: option.id, label: option.label }));
    if (selected.length > 0 || !options.skipEmptyMulti) {
      items.push({
        field,
        label: config.label,
        values: selected,
      });
    }
  }
  return items;
}

function formatSnapshotItem(item: PreferenceLabelSnapshotItem): string {
  const values =
    item.values.length > 0 ? item.values.map((value) => value.label).join("、") : "不指定";
  return `${item.label}：${values}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
