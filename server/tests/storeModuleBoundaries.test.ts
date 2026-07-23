import {
  existsSync,
  readFileSync,
  readdirSync,
  type Dirent,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, test } from "vitest";

const srcRoot = fileURLToPath(new URL("../src/", import.meta.url));

const expectedStoreOwners = [
  "contracts.ts",
  "memory.ts",
  "memory/atomic.ts",
  "memory/auth.ts",
  "memory/billing.ts",
  "memory/entitlements.ts",
  "memory/llmConfig.ts",
] as const;

const expectedPrismaOwners = [
  "auth.ts",
  "billing.ts",
  "concurrency.ts",
  "entitlements.ts",
  "llmConfig.ts",
] as const;

const expectedContractTypes = [
  "ActivationCodeRecord",
  "ActivationRedemption",
  "AdminEntitlementAdjustmentRecord",
  "AdminSessionRecord",
  "AuthRateLimitRecord",
  "AuthRateLimitScope",
  "DesktopLoginTicketRecord",
  "EmailOtpRecord",
  "EntitlementAdjustmentApplication",
  "EntitlementRecord",
  "ExchangeDesktopTicketResult",
  "IssueEmailOtpResult",
  "LlmConfigRecord",
  "LlmQuotaCheckoutResult",
  "LlmUsageEventRecord",
  "OrderRecord",
  "OtpPurpose",
  "PaidOrderSettlement",
  "SessionRecord",
  "Store",
  "UserRecord",
  "VerifyAdminOtpResult",
  "VerifyDesktopOtpResult",
  "WebhookEventRecord",
] as const;

const semanticOwners = {
  issueEmailOtp: {
    memory: "store/memory/auth.ts",
    prisma: "prismaStore/auth.ts",
  },
  verifyDesktopOtpAndCreateTicket: {
    memory: "store/memory/auth.ts",
    prisma: "prismaStore/auth.ts",
  },
  verifyAdminOtpAndCreateSession: {
    memory: "store/memory/auth.ts",
    prisma: "prismaStore/auth.ts",
  },
  exchangeDesktopTicketAndCreateSession: {
    memory: "store/memory/auth.ts",
    prisma: "prismaStore/auth.ts",
  },
  settlePaidOrder: {
    memory: "store/memory/billing.ts",
    prisma: "prismaStore/billing.ts",
  },
  consumeLlmQuota: {
    memory: "store/memory/entitlements.ts",
    prisma: "prismaStore/entitlements.ts",
  },
  redeemActivationCodeAndGrantEntitlement: {
    memory: "store/memory/entitlements.ts",
    prisma: "prismaStore/entitlements.ts",
  },
  applyEntitlementAdjustmentWithAudit: {
    memory: "store/memory/entitlements.ts",
    prisma: "prismaStore/entitlements.ts",
  },
} as const;

const expectedCapabilities = {
  "auth.ts": {
    alias: "AuthStore",
    keys: [
      "exchangeDesktopTicketAndCreateSession",
      "invalidateIssuedOtpAfterDeliveryFailure",
      "issueEmailOtp",
      "verifyDesktopOtpAndCreateTicket",
    ],
  },
  "adminAuth.ts": {
    alias: "AdminAuthStore",
    keys: [
      "findAdminSessionByTokenHash",
      "invalidateIssuedOtpAfterDeliveryFailure",
      "issueEmailOtp",
      "verifyAdminOtpAndCreateSession",
    ],
  },
  "billing.ts": {
    alias: "BillingStore",
    keys: [
      "createOrder",
      "findOrderByOutTradeNo",
      "findSessionByTokenHash",
      "settlePaidOrder",
    ],
  },
  "activation.ts": {
    alias: "ActivationStore",
    keys: [
      "createActivationCode",
      "redeemActivationCodeAndGrantEntitlement",
    ],
  },
  "llmConfig.ts": {
    alias: "LlmConfigStore",
    keys: ["getLlmConfig", "upsertLlmConfig"],
  },
  "entitlementAdjustment.ts": {
    alias: "EntitlementAdjustmentStore",
    keys: ["applyEntitlementAdjustmentWithAudit"],
  },
  "routes/shared.ts": {
    alias: "DesktopSessionStore",
    keys: ["findSessionByTokenHash"],
  },
  "routes/desktopAuth.ts": {
    alias: "DesktopAuthRouteStore",
    keys: ["revokeSession"],
  },
  "routes/desktopAccount.ts": {
    alias: "DesktopAccountStore",
    keys: ["findSessionByTokenHash", "getEntitlement", "getUserById"],
  },
  "routes/desktopLlm.ts": {
    alias: "DesktopLlmStore",
    keys: ["consumeLlmQuota", "findSessionByTokenHash"],
  },
  "routes/billing.ts": {
    alias: "BillingRouteStore",
    keys: ["findSessionByTokenHash", "getEntitlement"],
  },
  "routes/admin.ts": {
    alias: "AdminRouteStore",
    keys: [
      "getEntitlement",
      "listActivationCodes",
      "listAdminEntitlementAdjustments",
      "listUsers",
      "revokeAdminSession",
    ],
  },
} as const;

type SourceEntry = {
  relativePath: string;
  path: string;
  source: string;
  sourceFile: ts.SourceFile;
};

function sourcePath(relativePath: string): string {
  return resolve(srcRoot, relativePath);
}

function normalizeRelativePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function collectRelativeTypeScriptFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  function visit(currentDirectory: string, prefix: string): string[] {
    return readdirSync(currentDirectory, { withFileTypes: true }).flatMap(
      (entry: Dirent): string[] => {
        const relativePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
        const absolutePath = resolve(currentDirectory, entry.name);
        if (entry.isDirectory()) {
          return visit(absolutePath, relativePath);
        }
        return entry.isFile() && entry.name.endsWith(".ts") ? [relativePath] : [];
      },
    );
  }

  return visit(directory, "").sort();
}

function readSource(path: string): string {
  return readFileSync(path, "utf8");
}

function parseSource(path: string, source: string): ts.SourceFile {
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function sourceEntry(relativePath: string): SourceEntry {
  const path = sourcePath(relativePath);
  const source = readSource(path);
  return {
    relativePath,
    path,
    source,
    sourceFile: parseSource(path, source),
  };
}

function productionSourceEntries(): SourceEntry[] {
  return collectRelativeTypeScriptFiles(srcRoot).map(sourceEntry);
}

function physicalLineCount(source: string): number {
  return source.split(/\r?\n/).length;
}

function hasExportModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true
  );
}

function importSources(sourceFile: ts.SourceFile): string[] {
  return sourceFile.statements
    .filter(ts.isImportDeclaration)
    .map((declaration) => declaration.moduleSpecifier)
    .filter(ts.isStringLiteralLike)
    .map((specifier) => specifier.text);
}

function resolveSourceImport(fromRelativePath: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) {
    return null;
  }
  const importedPath = resolve(dirname(sourcePath(fromRelativePath)), specifier);
  const typescriptPath = importedPath.endsWith(".js")
    ? `${importedPath.slice(0, -3)}.ts`
    : importedPath;
  return normalizeRelativePath(relative(srcRoot, typescriptPath));
}

function exportedTypeAliasNames(sourceFile: ts.SourceFile): string[] {
  return sourceFile.statements
    .filter(ts.isTypeAliasDeclaration)
    .filter(hasExportModifier)
    .map((declaration) => declaration.name.text)
    .sort();
}

function exportedClassNames(sourceFile: ts.SourceFile): string[] {
  return sourceFile.statements
    .filter(ts.isClassDeclaration)
    .filter(hasExportModifier)
    .flatMap((declaration) => (declaration.name ? [declaration.name.text] : []))
    .sort();
}

function topLevelFunctionNames(sourceFile: ts.SourceFile): string[] {
  return sourceFile.statements
    .filter(ts.isFunctionDeclaration)
    .flatMap((declaration) => (declaration.name ? [declaration.name.text] : []));
}

function directExports(sourceFile: ts.SourceFile): Array<{
  module: string;
  names: string[];
  typeOnly: boolean;
}> {
  return sourceFile.statements.flatMap((statement) => {
    if (
      !ts.isExportDeclaration(statement) ||
      !statement.moduleSpecifier ||
      !ts.isStringLiteralLike(statement.moduleSpecifier)
    ) {
      return [];
    }
    const names =
      statement.exportClause && ts.isNamedExports(statement.exportClause)
        ? statement.exportClause.elements.map((element) => element.name.text)
        : ["*"];
    return [{
      module: statement.moduleSpecifier.text,
      names,
      typeOnly: statement.isTypeOnly,
    }];
  });
}

function literalTypeKeys(node: ts.TypeNode): string[] {
  if (ts.isUnionTypeNode(node)) {
    return node.types.flatMap(literalTypeKeys);
  }
  if (
    ts.isLiteralTypeNode(node) &&
    (ts.isStringLiteral(node.literal) || ts.isNoSubstitutionTemplateLiteral(node.literal))
  ) {
    return [node.literal.text];
  }
  return [];
}

function storePickKeys(declaration: ts.TypeAliasDeclaration): string[] | null {
  const initializer = declaration.type;
  if (
    !ts.isTypeReferenceNode(initializer) ||
    !ts.isIdentifier(initializer.typeName) ||
    initializer.typeName.text !== "Pick" ||
    initializer.typeArguments?.length !== 2
  ) {
    return null;
  }
  const storeType = initializer.typeArguments[0];
  const keysType = initializer.typeArguments[1];
  if (
    !storeType ||
    !keysType ||
    !ts.isTypeReferenceNode(storeType) ||
    !ts.isIdentifier(storeType.typeName) ||
    storeType.typeName.text !== "Store"
  ) {
    return null;
  }
  return literalTypeKeys(keysType).sort();
}

function capabilityAliases(sourceFile: ts.SourceFile): Array<{
  alias: string;
  keys: string[];
}> {
  return sourceFile.statements.flatMap((statement) => {
    if (!ts.isTypeAliasDeclaration(statement)) {
      return [];
    }
    const keys = storePickKeys(statement);
    return keys === null ? [] : [{ alias: statement.name.text, keys }];
  });
}

function typeReferenceCount(sourceFile: ts.SourceFile, name: string): number {
  let count = 0;
  function visit(node: ts.Node): void {
    if (
      ts.isTypeReferenceNode(node) &&
      ts.isIdentifier(node.typeName) &&
      node.typeName.text === name
    ) {
      count += 1;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return count;
}

function fullStoreTypeReferences(sourceFile: ts.SourceFile): number {
  let count = 0;
  function visit(node: ts.Node): void {
    if (
      ts.isTypeReferenceNode(node) &&
      ts.isIdentifier(node.typeName) &&
      node.typeName.text === "Store"
    ) {
      const pick = node.parent;
      const alias = pick.parent;
      const approvedPick =
        ts.isTypeReferenceNode(pick) &&
        ts.isIdentifier(pick.typeName) &&
        pick.typeName.text === "Pick" &&
        pick.typeArguments?.[0] === node &&
        ts.isTypeAliasDeclaration(alias);
      if (!approvedPick) {
        count += 1;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return count;
}

describe("Store adapter module ownership", () => {
  test("keeps the exact private owner tree and dependency boundaries", () => {
    expect(collectRelativeTypeScriptFiles(sourcePath("store"))).toEqual(
      expectedStoreOwners,
    );
    expect(collectRelativeTypeScriptFiles(sourcePath("prismaStore"))).toEqual(
      expectedPrismaOwners,
    );

    const entries = productionSourceEntries();
    const entriesByPath = new Map(entries.map((entry) => [entry.relativePath, entry]));
    const storeRoot = entriesByPath.get("store.ts");
    const contracts = entriesByPath.get("store/contracts.ts");
    const memoryRoot = entriesByPath.get("store/memory.ts");
    const prismaRoot = entriesByPath.get("prismaStore.ts");
    expect(storeRoot).toBeDefined();
    expect(contracts).toBeDefined();
    expect(memoryRoot).toBeDefined();
    expect(prismaRoot).toBeDefined();
    if (!storeRoot || !contracts || !memoryRoot || !prismaRoot) {
      return;
    }

    expect(storeRoot.sourceFile.statements.every(ts.isExportDeclaration)).toBe(true);
    expect(directExports(storeRoot.sourceFile)).toEqual([
      {
        module: "./store/contracts.js",
        names: ["*"],
        typeOnly: false,
      },
      {
        module: "./store/memory.js",
        names: ["MemoryStore"],
        typeOnly: false,
      },
    ]);
    expect(physicalLineCount(storeRoot.source)).toBeLessThanOrEqual(60);
    expect(physicalLineCount(contracts.source)).toBeLessThanOrEqual(350);
    expect(physicalLineCount(memoryRoot.source)).toBeLessThanOrEqual(350);
    expect(physicalLineCount(prismaRoot.source)).toBeLessThanOrEqual(350);

    for (const relativePath of [
      ...expectedStoreOwners.map((path) => `store/${path}`),
      ...expectedPrismaOwners.map((path) => `prismaStore/${path}`),
    ]) {
      if (
        relativePath === "store/contracts.ts" ||
        relativePath === "store/memory.ts"
      ) {
        continue;
      }
      const entry = entriesByPath.get(relativePath);
      expect(entry, relativePath).toBeDefined();
      if (entry) {
        expect(physicalLineCount(entry.source), relativePath).toBeLessThanOrEqual(400);
      }
    }

    expect(exportedTypeAliasNames(contracts.sourceFile)).toEqual(
      [...expectedContractTypes].sort(),
    );
    expect(exportedClassNames(memoryRoot.sourceFile)).toContain("MemoryStore");
    expect(
      exportedClassNames(
        entriesByPath.get("store/memory/atomic.ts")?.sourceFile ??
          parseSource("missing-memory-atomic.ts", ""),
      ),
    ).toEqual(["MemoryAtomicCoordinator"]);

    const prismaStoreExportOwners = entries
      .filter(
        (entry) =>
          exportedClassNames(entry.sourceFile).includes("PrismaStore") ||
          directExports(entry.sourceFile).some((declaration) =>
            declaration.names.includes("PrismaStore"),
          ),
      )
      .map((entry) => entry.relativePath);
    expect(prismaStoreExportOwners).toEqual(["prismaStore.ts"]);

    const stableRoots = new Set(["store.ts", "prismaStore.ts"]);
    for (const entry of entries) {
      const isPrivateOwner =
        entry.relativePath.startsWith("store/") ||
        entry.relativePath.startsWith("prismaStore/");
      if (isPrivateOwner || stableRoots.has(entry.relativePath)) {
        continue;
      }
      const privateImports = importSources(entry.sourceFile)
        .map((specifier) => resolveSourceImport(entry.relativePath, specifier))
        .filter((path): path is string => path !== null)
        .filter(
          (path) => path.startsWith("store/") || path.startsWith("prismaStore/"),
        );
      expect(privateImports, entry.relativePath).toEqual([]);
    }

    const allowedPrismaImportOwners = new Set([
      "database.ts",
      "prismaStore.ts",
      ...expectedPrismaOwners.map((path) => `prismaStore/${path}`),
    ]);
    for (const entry of entries) {
      if (importSources(entry.sourceFile).includes("@prisma/client")) {
        expect(allowedPrismaImportOwners.has(entry.relativePath), entry.relativePath).toBe(true);
      }
    }

    const concurrencyMarkers = [
      /\btype\s+PrismaRateLimitReservation\b/,
      /\bclass\s+RateLimitExceededError\b/,
      /\bclass\s+StoreTemporarilyUnavailableError\b/,
      /\bfunction\s+prismaRateLimitReservations\b/,
      /\bfunction\s+reserveAuthRateLimit\b/,
      /\btype\s+ConflictRetryResult\b/,
      /\bfunction\s+withConflictRetry\b/,
      /\bfunction\s+isRetryablePrismaConflict\b/,
      /\bfunction\s+hasSqliteBusyMarker\b/,
      /\bfunction\s+isLlmUsageEventIdempotencyConflict\b/,
      /\bfunction\s+isPrismaKnownError\b/,
      /maximumAttempts\s*=\s*3/,
      /setTimeout\s*\(\s*resolve\s*,\s*attempt\s*\*\s*5\s*\)/,
      /INSERT INTO "AuthRateLimit"/,
    ];
    for (const marker of concurrencyMarkers) {
      const owners = entries
        .filter((entry) => marker.test(entry.source))
        .map((entry) => entry.relativePath);
      expect(owners, marker.source).toEqual(["prismaStore/concurrency.ts"]);
    }

    const memoryEntries = entries.filter((entry) => entry.relativePath.startsWith("store/memory/"));
    const prismaEntries = entries.filter((entry) => entry.relativePath.startsWith("prismaStore/"));
    for (const [operation, owners] of Object.entries(semanticOwners)) {
      const memoryImplementationOwners = memoryEntries
        .filter((entry) => topLevelFunctionNames(entry.sourceFile).includes(operation))
        .map((entry) => entry.relativePath);
      const prismaImplementationOwners = prismaEntries
        .filter((entry) => topLevelFunctionNames(entry.sourceFile).includes(operation))
        .map((entry) => entry.relativePath);
      expect(memoryImplementationOwners, `Memory ${operation}`).toEqual([owners.memory]);
      expect(prismaImplementationOwners, `Prisma ${operation}`).toEqual([owners.prisma]);
    }

    const transactionClientOwners = entries
      .filter((entry) => entry.source.includes("Prisma.TransactionClient"))
      .map((entry) => entry.relativePath);
    expect(
      transactionClientOwners.every((owner) => owner.startsWith("prismaStore/")),
      transactionClientOwners.join(", "),
    ).toBe(true);

    const forbiddenPrivateTargets = new Set([
      "activation.ts",
      "adminAuth.ts",
      "auth.ts",
      "billing.ts",
      "database.ts",
      "email.ts",
      "entitlementAdjustment.ts",
      "index.ts",
      "llmConfig.ts",
      "observability.ts",
      "prismaStore.ts",
      "runtimeConfig.ts",
      "server.ts",
      "store.ts",
      "wechat.ts",
    ]);
    const privateEntries = entries.filter(
      (entry) =>
        entry.relativePath.startsWith("store/") ||
        entry.relativePath.startsWith("prismaStore/"),
    );
    for (const entry of privateEntries) {
      const forbiddenImports = importSources(entry.sourceFile)
        .map((specifier) => resolveSourceImport(entry.relativePath, specifier))
        .filter((path): path is string => path !== null)
        .filter((path) => {
          if (forbiddenPrivateTargets.has(path) || path.startsWith("routes/")) {
            return true;
          }
          if (entry.relativePath.startsWith("store/")) {
            return path.startsWith("prismaStore/");
          }
          return path.startsWith("store/") && path !== "store/contracts.ts";
        });
      expect(forbiddenImports, entry.relativePath).toEqual([]);
    }

    const allowedPrivateClasses = new Map<string, Set<string>>([
      ["store/memory.ts", new Set(["MemoryStore"])],
      ["store/memory/atomic.ts", new Set(["MemoryAtomicCoordinator"])],
      [
        "prismaStore/concurrency.ts",
        new Set(["RateLimitExceededError", "StoreTemporarilyUnavailableError"]),
      ],
    ]);
    for (const entry of privateEntries) {
      for (const className of exportedClassNames(entry.sourceFile)) {
        expect(
          allowedPrivateClasses.get(entry.relativePath)?.has(className) === true,
          `${entry.relativePath}: ${className}`,
        ).toBe(true);
      }
      const forbiddenFacadeName = [
        ...exportedClassNames(entry.sourceFile),
        ...topLevelFunctionNames(entry.sourceFile),
      ].find((name) => /(?:Repository|UnitOfWork|PrismaClient|TransactionCallback)$/.test(name));
      expect(forbiddenFacadeName, entry.relativePath).toBeUndefined();
    }

    const adapterFiles = new Set([
      "store.ts",
      "prismaStore.ts",
      ...expectedStoreOwners.map((path) => `store/${path}`),
      ...expectedPrismaOwners.map((path) => `prismaStore/${path}`),
    ]);
    for (const entry of entries) {
      if (entry.relativePath === "server.ts" || adapterFiles.has(entry.relativePath)) {
        continue;
      }
      const expected = expectedCapabilities[
        entry.relativePath as keyof typeof expectedCapabilities
      ];
      if (!expected) {
        expect(fullStoreTypeReferences(entry.sourceFile), entry.relativePath).toBe(0);
        continue;
      }
      expect(capabilityAliases(entry.sourceFile), entry.relativePath).toEqual([
        {
          alias: expected.alias,
          keys: [...expected.keys].sort(),
        },
      ]);
      expect(fullStoreTypeReferences(entry.sourceFile), entry.relativePath).toBe(0);
      expect(typeReferenceCount(entry.sourceFile, expected.alias), entry.relativePath).toBeGreaterThan(
        0,
      );
    }

    const desktopLlmSource = entriesByPath.get("routes/desktopLlm.ts")?.source.replaceAll(
      /\s/g,
      "",
    );
    expect(desktopLlmSource).toContain(
      'ReturnType<DesktopLlmStore["consumeLlmQuota"]>',
    );
  });
});
