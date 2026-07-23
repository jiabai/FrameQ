import type { LlmConfigRecord, Store } from "../contracts.js";
import type { MemoryState } from "./atomic.js";

export type MemoryLlmConfigContext = {
  state: MemoryState;
};

export async function getLlmConfig(
  context: MemoryLlmConfigContext,
): ReturnType<Store["getLlmConfig"]> {
  return context.state.llmConfig;
}

export async function upsertLlmConfig(
  context: MemoryLlmConfigContext,
  input: Omit<LlmConfigRecord, "id" | "createdAt" | "updatedAt">,
  now: Date,
): ReturnType<Store["upsertLlmConfig"]> {
  if (context.state.llmConfig) {
    context.state.llmConfig = { ...context.state.llmConfig, ...input, updatedAt: now };
    return context.state.llmConfig;
  }
  context.state.llmConfig = {
    ...input,
    id: "default",
    createdAt: now,
    updatedAt: now,
  };
  return context.state.llmConfig;
}
