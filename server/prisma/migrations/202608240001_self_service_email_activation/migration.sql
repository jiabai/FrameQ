PRAGMA foreign_keys=OFF;
BEGIN IMMEDIATE;

CREATE TABLE "new_ActivationCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "codeHash" TEXT NOT NULL,
    "codePrefix" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "issuanceSource" TEXT NOT NULL,
    "entitlementDays" INTEGER NOT NULL,
    "issuedToUserId" TEXT,
    "redeemBy" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "sentAt" DATETIME,
    "redeemedAt" DATETIME,
    "redeemedByUserId" TEXT,
    "disabledReason" TEXT,
    CONSTRAINT "ActivationCode_status_closed" CHECK ("status" IN ('pending_delivery', 'active', 'redeemed', 'expired', 'disabled')),
    CONSTRAINT "ActivationCode_issuance_source_closed" CHECK ("issuanceSource" IN ('admin', 'self_service_email')),
    CONSTRAINT "ActivationCode_disabled_reason_closed" CHECK (
        "disabledReason" IS NULL
        OR "disabledReason" IN ('delivery_failed', 'superseded', 'activation_became_active')
    ),
    CONSTRAINT "ActivationCode_issuedToUserId_fkey" FOREIGN KEY ("issuedToUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ActivationCode_redeemedByUserId_fkey" FOREIGN KEY ("redeemedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_ActivationCode" (
    "id",
    "codeHash",
    "codePrefix",
    "status",
    "issuanceSource",
    "entitlementDays",
    "issuedToUserId",
    "redeemBy",
    "createdAt",
    "sentAt",
    "redeemedAt",
    "redeemedByUserId",
    "disabledReason"
)
SELECT
    "id",
    "codeHash",
    "codePrefix",
    "status",
    'admin',
    "entitlementDays",
    NULL,
    "redeemBy",
    "createdAt",
    NULL,
    "redeemedAt",
    "redeemedByUserId",
    NULL
FROM "ActivationCode";

DROP TABLE "ActivationCode";
ALTER TABLE "new_ActivationCode" RENAME TO "ActivationCode";

CREATE UNIQUE INDEX "ActivationCode_codeHash_key" ON "ActivationCode"("codeHash");
CREATE INDEX "ActivationCode_status_idx" ON "ActivationCode"("status");
CREATE INDEX "ActivationCode_issuedToUserId_issuanceSource_status_idx"
ON "ActivationCode"("issuedToUserId", "issuanceSource", "status");
CREATE INDEX "ActivationCode_redeemedByUserId_idx" ON "ActivationCode"("redeemedByUserId");

COMMIT;
PRAGMA foreign_keys=ON;
