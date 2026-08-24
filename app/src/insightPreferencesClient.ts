import { invoke } from "@tauri-apps/api/core";
import type { InvokeArgs } from "@tauri-apps/api/core";
import {
  validateGenerationPreferences,
  validateInspirationProfile,
  type GenerationPreferences,
  type InspirationProfile,
} from "./insightPreferences";

export type InsightProfileStatus = "missing" | "valid" | "skipped" | "invalid";

export type InsightPreferenceState = {
  profile: InspirationProfile | null;
  profileSkipped: boolean;
  profileStatus: InsightProfileStatus;
  profileError: string | null;
  defaultGenerationPreferences: GenerationPreferences | null;
  preferencesPath: string;
};

export type InsightPreferenceCommandRunner = (
  command: string,
  args: InvokeArgs,
) => Promise<unknown>;

const defaultRunner: InsightPreferenceCommandRunner = (command, args) => invoke(command, args);

export async function getInsightPreferences(
  runner: InsightPreferenceCommandRunner = defaultRunner,
): Promise<InsightPreferenceState> {
  return normalizePreferenceState(await runner("get_insight_preferences", {}));
}

export async function saveInspirationProfile(
  profile: InspirationProfile,
  runner: InsightPreferenceCommandRunner = defaultRunner,
): Promise<InsightPreferenceState> {
  return normalizePreferenceState(await runner("save_inspiration_profile", { profile }));
}

export async function skipInspirationProfile(
  runner: InsightPreferenceCommandRunner = defaultRunner,
): Promise<InsightPreferenceState> {
  return normalizePreferenceState(await runner("skip_inspiration_profile", {}));
}

export async function clearInspirationProfile(
  runner: InsightPreferenceCommandRunner = defaultRunner,
): Promise<InsightPreferenceState> {
  return normalizePreferenceState(await runner("clear_inspiration_profile", {}));
}

export async function saveDefaultGenerationPreferences(
  preferences: GenerationPreferences,
  runner: InsightPreferenceCommandRunner = defaultRunner,
): Promise<InsightPreferenceState> {
  return normalizePreferenceState(
    await runner("save_default_generation_preferences", { preferences }),
  );
}

function normalizePreferenceState(value: unknown): InsightPreferenceState {
  const record = isRecord(value) ? value : {};
  const profile = validateInspirationProfile(record.profile);
  const defaultGenerationPreferences = validateGenerationPreferences(
    record.defaultGenerationPreferences,
  );
  const profileStatus = normalizeProfileStatus(record.profileStatus);

  return {
    profile,
    profileSkipped: record.profileSkipped === true,
    profileStatus,
    profileError: typeof record.profileError === "string" ? record.profileError : null,
    defaultGenerationPreferences,
    preferencesPath: typeof record.preferencesPath === "string" ? record.preferencesPath : "",
  };
}

function normalizeProfileStatus(value: unknown): InsightProfileStatus {
  return value === "valid" || value === "skipped" || value === "invalid" ? value : "missing";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
