import type { LlmProviderKind } from "../../settingsClient";

export type LlmProviderPresetLabelKey =
  | "models.presets.deepseek"
  | "models.presets.siliconflow"
  | "models.presets.zhipu"
  | "models.presets.moonshot"
  | "models.presets.openai"
  | "models.presets.custom";

export type LlmProviderPreset = {
  id: string;
  labelKey: LlmProviderPresetLabelKey;
  provider: LlmProviderKind;
  baseUrl: string;
  models: readonly string[];
};

export const CUSTOM_LLM_PROVIDER_PRESET_ID = "custom";

/**
 * Presets only prefill the base URL and model candidates. Every field stays
 * freely editable; selecting a preset never locks any value.
 */
export const LLM_PROVIDER_PRESETS: readonly LlmProviderPreset[] = [
  {
    id: "deepseek",
    labelKey: "models.presets.deepseek",
    provider: "openai_compatible",
    baseUrl: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  {
    id: "siliconflow",
    labelKey: "models.presets.siliconflow",
    provider: "openai_compatible",
    baseUrl: "https://api.siliconflow.cn/v1",
    models: [
      "Qwen/Qwen2.5-7B-Instruct",
      "deepseek-ai/DeepSeek-V3",
      "Qwen/Qwen3-8B",
    ],
  },
  {
    id: "zhipu",
    labelKey: "models.presets.zhipu",
    provider: "openai_compatible",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    models: ["glm-4-flash", "glm-4-air", "glm-4-plus"],
  },
  {
    id: "moonshot",
    labelKey: "models.presets.moonshot",
    provider: "openai_compatible",
    baseUrl: "https://api.moonshot.cn/v1",
    models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
  },
  {
    id: "openai",
    labelKey: "models.presets.openai",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o-mini", "gpt-4o", "o3-mini"],
  },
  {
    id: CUSTOM_LLM_PROVIDER_PRESET_ID,
    labelKey: "models.presets.custom",
    provider: "openai_compatible",
    baseUrl: "",
    models: [],
  },
];

export function findLlmProviderPreset(id: string): LlmProviderPreset | undefined {
  return LLM_PROVIDER_PRESETS.find((preset) => preset.id === id);
}

export function presetIdForBaseUrl(baseUrl: string): string {
  const match = LLM_PROVIDER_PRESETS.find(
    (preset) =>
      preset.id !== CUSTOM_LLM_PROVIDER_PRESET_ID &&
      preset.baseUrl.length > 0 &&
      preset.baseUrl === baseUrl,
  );
  return match?.id ?? CUSTOM_LLM_PROVIDER_PRESET_ID;
}
