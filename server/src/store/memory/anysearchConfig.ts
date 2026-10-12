import type { AnysearchConfigRecord, Store } from "../contracts.js";
import type { MemoryState } from "./atomic.js";

export type MemoryAnysearchConfigContext = {
  state: MemoryState;
};

export async function getAnysearchConfig(
  context: MemoryAnysearchConfigContext,
): ReturnType<Store["getAnysearchConfig"]> {
  return context.state.anysearchConfig;
}

export async function upsertAnysearchConfig(
  context: MemoryAnysearchConfigContext,
  input: Omit<AnysearchConfigRecord, "id" | "createdAt" | "updatedAt">,
  now: Date,
): ReturnType<Store["upsertAnysearchConfig"]> {
  if (context.state.anysearchConfig) {
    context.state.anysearchConfig = { ...context.state.anysearchConfig, ...input, updatedAt: now };
    return context.state.anysearchConfig;
  }
  context.state.anysearchConfig = {
    ...input,
    id: "default",
    createdAt: now,
    updatedAt: now,
  };
  return context.state.anysearchConfig;
}
