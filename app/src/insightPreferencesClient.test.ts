import { describe, expect, test } from "vitest";
import {
  clearInspirationProfile,
  getInsightPreferences,
  saveDefaultGenerationPreferences,
  saveInspirationProfile,
  skipInspirationProfile,
  type InsightPreferenceCommandRunner,
} from "./insightPreferencesClient";
import type { GenerationPreferences, InspirationProfile } from "./insightPreferences";

const PROFILE: InspirationProfile = {
  role: "marketing_sales",
  domain: "marketing_sales",
  stage: "manager",
  cityContext: "new_tier1_city",
  genderPerspective: "unspecified",
  platforms: ["douyin"],
};

const GENERATION_PREFERENCES: GenerationPreferences = {
  goal: "content_creation",
  scenario: "short_video",
  angles: ["topic_angle"],
  audience: "beginners",
  styles: ["direct_sharp"],
  avoid: [],
};

describe("insight preferences client", () => {
  test("invokes preference commands with stable Tauri payloads", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    const runner: InsightPreferenceCommandRunner = async (command, args) => {
      calls.push({ command, args });
      return preferenceState();
    };

    await getInsightPreferences(runner);
    await saveInspirationProfile(PROFILE, runner);
    await skipInspirationProfile(runner);
    await clearInspirationProfile(runner);
    await saveDefaultGenerationPreferences(GENERATION_PREFERENCES, runner);

    expect(calls).toEqual([
      { command: "get_insight_preferences", args: {} },
      { command: "save_inspiration_profile", args: { profile: PROFILE } },
      { command: "skip_inspiration_profile", args: {} },
      { command: "clear_inspiration_profile", args: {} },
      {
        command: "save_default_generation_preferences",
        args: { preferences: GENERATION_PREFERENCES },
      },
    ]);
  });

  test("normalizes missing response fields to a safe local state", async () => {
    const runner: InsightPreferenceCommandRunner = async () => ({});

    await expect(getInsightPreferences(runner)).resolves.toEqual({
      profile: null,
      profileSkipped: false,
      profileStatus: "missing",
      profileError: null,
      defaultGenerationPreferences: null,
      preferencesPath: "",
    });
  });

});

function preferenceState() {
  return {
    profile: PROFILE,
    profileSkipped: false,
    profileStatus: "valid",
    profileError: null,
    defaultGenerationPreferences: GENERATION_PREFERENCES,
    preferencesPath: "D:/FrameQ/insight-preferences.json",
  };
}
