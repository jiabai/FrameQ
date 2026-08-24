import { randomBytes } from "node:crypto";
import { sha256 } from "./security.js";

const ACTIVATION_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ACTIVATION_CODE_SEGMENT_LENGTH = 4;
const ACTIVATION_CODE_SEGMENT_COUNT = 4;
const ACTIVATION_CODE_PREFIX_LENGTH = 7;

export const DEFAULT_ENTITLEMENT_DAYS = 31;
export const DEFAULT_REDEEM_WINDOW_DAYS = 30;
export const SELF_SERVICE_LLM_QUOTA = 20;

export function normalizeActivationCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

export function activationCodeHash(code: string): string {
  return sha256(normalizeActivationCode(code));
}

export function activationCodePrefix(code: string): string {
  return normalizeActivationCode(code).slice(0, ACTIVATION_CODE_PREFIX_LENGTH);
}

export function generateActivationCode(random: (size: number) => Uint8Array = randomBytes): string {
  let raw = "";
  const bytes = random(ACTIVATION_CODE_SEGMENT_LENGTH * ACTIVATION_CODE_SEGMENT_COUNT);
  for (const byte of bytes) {
    raw += ACTIVATION_CODE_ALPHABET[byte % ACTIVATION_CODE_ALPHABET.length];
  }

  const segments: string[] = [];
  for (let index = 0; index < ACTIVATION_CODE_SEGMENT_COUNT; index += 1) {
    const start = index * ACTIVATION_CODE_SEGMENT_LENGTH;
    segments.push(raw.slice(start, start + ACTIVATION_CODE_SEGMENT_LENGTH));
  }
  return `FQ-${segments.join("-")}`;
}

