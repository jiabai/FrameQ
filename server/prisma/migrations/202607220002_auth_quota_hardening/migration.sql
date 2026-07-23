PRAGMA foreign_keys=OFF;
BEGIN IMMEDIATE;

-- Rebuild entitlement first so invalid historical accounting aborts the entire migration.
CREATE TABLE "new_Entitlement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "llmQuotaLimit" INTEGER NOT NULL DEFAULT 0,
    "llmQuotaUsed" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Entitlement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Entitlement_quota_limit_nonnegative" CHECK ("llmQuotaLimit" >= 0),
    CONSTRAINT "Entitlement_quota_used_nonnegative" CHECK ("llmQuotaUsed" >= 0),
    CONSTRAINT "Entitlement_quota_within_limit" CHECK ("llmQuotaUsed" <= "llmQuotaLimit")
);
INSERT INTO "new_Entitlement" ("id", "userId", "status", "expiresAt", "llmQuotaLimit", "llmQuotaUsed", "updatedAt")
SELECT "id", "userId", "status", "expiresAt", "llmQuotaLimit", "llmQuotaUsed", "updatedAt" FROM "Entitlement";
DROP TABLE "Entitlement";
ALTER TABLE "new_Entitlement" RENAME TO "Entitlement";
CREATE UNIQUE INDEX "Entitlement_userId_key" ON "Entitlement"("userId");

-- Outstanding legacy OTPs are intentionally discarded; their purpose cannot be inferred safely.
DROP TABLE "EmailOtp";
CREATE TABLE "EmailOtp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "purpose" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" DATETIME NOT NULL,
    "consumedAt" DATETIME,
    "createdAt" DATETIME NOT NULL,
    CONSTRAINT "EmailOtp_purpose_closed" CHECK ("purpose" IN ('desktop_login', 'admin_login')),
    CONSTRAINT "EmailOtp_attempts_bounded" CHECK ("attempts" >= 0 AND "attempts" <= 5)
);
CREATE INDEX "EmailOtp_purpose_email_state_createdAt_idx"
ON "EmailOtp"("purpose", "email", "state", "createdAt");

CREATE TABLE "AuthRateLimit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "keyHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "windowStartedAt" DATETIME NOT NULL,
    "count" INTEGER NOT NULL,
    "nextAllowedAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AuthRateLimit_purpose_closed" CHECK ("purpose" IN ('desktop_login', 'admin_login')),
    CONSTRAINT "AuthRateLimit_scope_closed" CHECK ("scope" IN ('email_minute', 'email_hour', 'ip_hour')),
    CONSTRAINT "AuthRateLimit_count_nonnegative" CHECK ("count" >= 0)
);
CREATE UNIQUE INDEX "AuthRateLimit_keyHash_key" ON "AuthRateLimit"("keyHash");
CREATE INDEX "AuthRateLimit_purpose_scope_nextAllowedAt_idx"
ON "AuthRateLimit"("purpose", "scope", "nextAllowedAt");

COMMIT;
PRAGMA foreign_keys=ON;
