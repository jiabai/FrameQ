import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function authRateLimitKey(scope: string, purpose: string, value: string): string {
  return sha256(`frameq:auth-rate-limit:v1|${scope}|${purpose}|${value}`);
}

export function secureToken(prefix = ""): string {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

export function otpCode(): string {
  return String(randomInt(0, 999999)).padStart(6, "0");
}

export function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function randomInt(min: number, max: number): number {
  const span = max - min + 1;
  const bytes = randomBytes(4).readUInt32BE(0);
  return min + (bytes % span);
}

