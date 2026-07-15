import { describe, expect, test } from "vitest";
import {
  DRAFT_PLATFORM_IDS,
  DRAFT_PLATFORMS,
  buildPreferenceSnapshot,
  deriveDefaultDraftPlatform,
  getOptionLabel,
  summarizeGenerationPreferences,
  summarizeInspirationProfile,
  validateGenerationPreferences,
  validateInspirationProfile,
  type GenerationPreferences,
  type InspirationProfile,
} from "./insightPreferences";

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
    expect(getOptionLabel("role", "marketing_sales")).toBe("市场/销售");
    expect(getOptionLabel("domain", "marketing_sales")).toBe("市场销售");
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
    expect(summarizeInspirationProfile(VALID_PROFILE)).toEqual([
      "我的角色：市场/销售",
      "职业领域：市场销售",
      "年龄/阶段：管理者",
      "城市语境：新一线城市",
      "常用平台：抖音、B站",
      "默认表达偏好：直接犀利",
    ]);

    expect(summarizeGenerationPreferences(VALID_GENERATION_PREFERENCES)).toEqual([
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

describe("draft platform selection", () => {
  test("DRAFT_PLATFORMS exposes exactly the 9 stable ids with distinct display labels", () => {
    // 9-id vocabulary shared with the worker: the selector must
    // surface every draft platform the worker accepts, no more, no less.
    expect(DRAFT_PLATFORMS.map((option) => option.id)).toEqual([
      "wechat_official_account",
      "xiaohongshu",
      "wechat_channels",
      "douyin",
      "tiktok",
      "twitter",
      "bilibili",
      "youtube",
      "other",
    ]);

    const labelsById = Object.fromEntries(
      DRAFT_PLATFORMS.map((option) => [option.id, option.label]),
    );
    expect(labelsById).toEqual({
      wechat_official_account: "公众号",
      xiaohongshu: "小红书",
      wechat_channels: "视频号",
      douyin: "抖音",
      tiktok: "Tiktok",
      twitter: "X(Twitter)",
      bilibili: "B站",
      youtube: "Youtube",
      other: "其他",
    });

    // DRAFT_PLATFORM_IDS must match the 9 selector ids (used by derivation + by
    // callers that need O(1) membership checks).
    expect(DRAFT_PLATFORM_IDS).toBeInstanceOf(Set);
    expect([...DRAFT_PLATFORM_IDS].sort()).toEqual(
      Object.keys(labelsById).sort(),
    );
  });

  test("deriveDefaultDraftPlatform preselects the single mappable profile platform (identity)", () => {
    expect(deriveDefaultDraftPlatform(["xiaohongshu"])).toBe("xiaohongshu");
    expect(deriveDefaultDraftPlatform(["douyin"])).toBe("douyin");
  });

  test("deriveDefaultDraftPlatform falls back to other when the profile has no platforms", () => {
    expect(deriveDefaultDraftPlatform([])).toBe("other");
  });

  test("deriveDefaultDraftPlatform falls back to other when the profile has two or more platforms", () => {
    expect(deriveDefaultDraftPlatform(["xiaohongshu", "douyin"])).toBe("other");
  });

  test("deriveDefaultDraftPlatform falls back to other for a single unmappable platform id", () => {
    // podcast / course_community / internal_sharing are profile-only ids not in
    // the 9-id draft vocabulary → cannot be identity-mapped.
    expect(deriveDefaultDraftPlatform(["podcast"])).toBe("other");
    expect(deriveDefaultDraftPlatform(["course_community"])).toBe("other");
    expect(deriveDefaultDraftPlatform(["internal_sharing"])).toBe("other");
  });

  test("deriveDefaultDraftPlatform falls back to other for null or undefined input", () => {
    expect(deriveDefaultDraftPlatform(null)).toBe("other");
    expect(deriveDefaultDraftPlatform(undefined)).toBe("other");
  });
});
