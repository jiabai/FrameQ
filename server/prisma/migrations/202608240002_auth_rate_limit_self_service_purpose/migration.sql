PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AuthRateLimit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "keyHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "windowStartedAt" DATETIME NOT NULL,
    "count" INTEGER NOT NULL,
    "nextAllowedAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AuthRateLimit_purpose_closed" CHECK ("purpose" IN ('desktop_login', 'admin_login', 'self_service_activation')),
    CONSTRAINT "AuthRateLimit_scope_closed" CHECK ("scope" IN ('email_minute', 'email_hour', 'ip_hour')),
    CONSTRAINT "AuthRateLimit_count_nonnegative" CHECK ("count" >= 0)
);
INSERT INTO "new_AuthRateLimit" (
    "id",
    "keyHash",
    "purpose",
    "scope",
    "windowStartedAt",
    "count",
    "nextAllowedAt",
    "updatedAt"
)
SELECT
    "id",
    "keyHash",
    "purpose",
    "scope",
    "windowStartedAt",
    "count",
    "nextAllowedAt",
    "updatedAt"
FROM "AuthRateLimit";
DROP TABLE "AuthRateLimit";
ALTER TABLE "new_AuthRateLimit" RENAME TO "AuthRateLimit";
CREATE UNIQUE INDEX "AuthRateLimit_keyHash_key" ON "AuthRateLimit"("keyHash");
CREATE INDEX "AuthRateLimit_purpose_scope_nextAllowedAt_idx"
ON "AuthRateLimit"("purpose", "scope", "nextAllowedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
