-- CreateTable
CREATE TABLE "AnysearchConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mcpUrl" TEXT NOT NULL,
    "encryptedApiKey" TEXT NOT NULL,
    "apiKeyLast4" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL
);
