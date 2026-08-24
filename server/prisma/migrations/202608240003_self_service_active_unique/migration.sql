-- Fail closed if historical data already violates the invariant.
-- SQLite will abort the migration if more than one active self-service code exists per user.
CREATE UNIQUE INDEX "ActivationCode_self_service_active_unique"
ON "ActivationCode"("issuedToUserId", "issuanceSource")
WHERE "issuanceSource" = 'self_service_email'
  AND "status" = 'active';
