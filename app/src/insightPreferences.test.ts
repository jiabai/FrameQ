import { describe, expect, test } from "vitest";
import {
  buildPreferenceSnapshot,
  isPreferenceOptionId,
  validateGenerationPreferences,
  validateInspirationProfile,
  type GenerationPreferences,
  type InspirationProfile,
} from "./insightPreferences";
import {
  getPreferenceFieldPresentation,
  summarizeGenerationPreferences,
  summarizeInspirationProfile,
} from "./i18n/preferencePresentation";

const VALID_PROFILE: InspirationProfile = {
  role: "marketing_sales",
  domain: "marketing_sales",
  stage: "manager",
  cityContext: "new_tier1_city",
  genderPerspective: "unspecified",
  platforms: ["douyin", "bilibili"],
  defaultStyles: ["direct_sharp"],
  defaultAvoid: [],
};

const VALID_GENERATION_PREFERENCES: GenerationPreferences = {
  goal: "content_creation",
  scenario: "short_video",
  angles: ["topic_angle", "practical_advice"],
  audience: "beginners",
  styles: ["direct_sharp"],
  avoid: [],
};

describe("insight preferences", () => {
  test("validates a complete inspiration profile with field-scoped option ids", () => {
    expect(validateInspirationProfile(VALID_PROFILE)).toEqual(VALID_PROFILE);
    expect(isPreferenceOptionId("role", "marketing_sales")).toBe(true);
    expect(getPreferenceFieldPresentation("zh-CN", "role").options).toContainEqual({
      id: "marketing_sales",
      label: "市场/销售",
    });
    expect(getPreferenceFieldPresentation("zh-CN", "domain").options).toContainEqual({
      id: "marketing_sales",
      label: "市场销售",
    });
  });

  test("rejects invalid inspiration profiles instead of silently defaulting them", () => {
    expect(validateInspirationProfile({ ...VALID_PROFILE, role: "content_creation" })).toBeNull();
    expect(
      validateInspirationProfile({
        ...VALID_PROFILE,
        platforms: ["douyin", "bilibili", "podcast", "xiaohongshu"],
      }),
    ).toBeNull();

    const missingRole = { ...VALID_PROFILE } as Partial<InspirationProfile>;
    delete missingRole.role;
    expect(validateInspirationProfile(missingRole)).toBeNull();
  });

  test("validates per-run generation preferences and count limits", () => {
    expect(validateGenerationPreferences(VALID_GENERATION_PREFERENCES)).toEqual(
      VALID_GENERATION_PREFERENCES,
    );
    expect(validateGenerationPreferences({ ...VALID_GENERATION_PREFERENCES, angles: [] })).toBeNull();
    expect(
      validateGenerationPreferences({
        ...VALID_GENERATION_PREFERENCES,
        styles: ["direct_sharp", "grounded", "storytelling"],
      }),
    ).toBeNull();
    expect(
      validateGenerationPreferences({
        ...VALID_GENERATION_PREFERENCES,
        avoid: ["academic", "vague", "clickbait", "negative"],
      }),
    ).toBeNull();
  });

  test("rejects display labels used as persisted values", () => {
    expect(
      validateGenerationPreferences({
        ...VALID_GENERATION_PREFERENCES,
        goal: "内容创作",
      }),
    ).toBeNull();
  });

  test("renders concise summaries from current option labels", () => {
    expect(summarizeInspirationProfile(VALID_PROFILE, "zh-CN")).toEqual([
      "我的角色：市场/销售",
      "职业领域：市场销售",
      "年龄/阶段：管理者",
      "城市语境：新一线城市",
      "常用平台：抖音、B站",
      "默认表达偏好：直接犀利",
    ]);

    expect(summarizeGenerationPreferences(VALID_GENERATION_PREFERENCES, "zh-CN")).toEqual([
      "本次目标：内容创作",
      "使用场景：发短视频",
      "关注角度：选题角度、实操建议",
      "目标受众：给新手看",
      "表达风格：直接犀利",
      "避免方向：不指定",
    ]);
  });

  test("builds a preference snapshot with ids and separate label snapshots", () => {
    const snapshot = buildPreferenceSnapshot({
      profile: VALID_PROFILE,
      profileSkipped: false,
      generationPreferences: VALID_GENERATION_PREFERENCES,
    });

    expect(snapshot.profile).toEqual(VALID_PROFILE);
    expect(snapshot.generationPreferences.goal).toBe("content_creation");
    expect(JSON.stringify(snapshot.generationPreferences)).not.toContain("内容创作");
    expect(snapshot.labelSnapshot.generationPreferences).toContainEqual({
      field: "goal",
      label: "本次目标",
      values: [{ id: "content_creation", label: "内容创作" }],
    });
    expect(snapshot.labelSnapshot.profile).toContainEqual({
      field: "platforms",
      label: "常用平台",
      values: [
        { id: "douyin", label: "抖音" },
        { id: "bilibili", label: "B站" },
      ],
    });
  });
});
