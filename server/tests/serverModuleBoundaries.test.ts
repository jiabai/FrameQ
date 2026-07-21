import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, test } from "vitest";

const srcRoot = fileURLToPath(new URL("../src/", import.meta.url));
const testsRoot = fileURLToPath(new URL("./", import.meta.url));
const routesRoot = fileURLToPath(new URL("../src/routes/", import.meta.url));

const featureRouteFiles = [
  "admin.ts",
  "billing.ts",
  "desktopAccount.ts",
  "desktopAuth.ts",
  "desktopLlm.ts",
  "desktopUpdates.ts",
] as const;

const expectedRouteFiles = [...featureRouteFiles, "authSchemas.ts", "shared.ts"].sort();

const expectedRoutes: Record<(typeof featureRouteFiles)[number], string[]> = {
  "admin.ts": [
    "GET /admin",
    "GET /admin/login",
    "POST /admin/api/activation-codes",
    "POST /admin/api/llm-config",
    "POST /admin/api/users/:userId/entitlement-adjustments",
    "POST /admin/auth/email/start",
    "POST /admin/auth/email/verify",
    "POST /admin/auth/logout",
  ],
  "billing.ts": [
    "GET /api/desktop/billing/orders/:orderId",
    "POST /api/desktop/billing/wechat-native",
    "POST /api/wechat/notify",
  ],
  "desktopAccount.ts": [
    "GET /api/desktop/account",
    "POST /api/desktop/activation-codes/redeem",
  ],
  "desktopAuth.ts": [
    "GET /login",
    "POST /api/desktop/logout",
    "POST /api/desktop/sessions/exchange",
    "POST /auth/email/start",
    "POST /auth/email/verify",
  ],
  "desktopLlm.ts": ["POST /api/desktop/llm/checkouts"],
  "desktopUpdates.ts": ["GET /api/desktop/updates/:target/:arch/:currentVersion"],
};

function sourcePath(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, new URL("../src/", import.meta.url)));
}

function readSource(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function parseSource(path: string, source: string): ts.SourceFile {
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function directAppRoutes(path: string, source: string): string[] {
  const routes: string[] = [];
  const sourceFile = parseSource(path, source);

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const receiver = node.expression.expression;
      const method = node.expression.name.text;
      const firstArgument = node.arguments[0];
      if (
        ts.isIdentifier(receiver) &&
        receiver.text === "app" &&
        (method === "get" || method === "post") &&
        firstArgument &&
        ts.isStringLiteralLike(firstArgument)
      ) {
        routes.push(`${method.toUpperCase()} ${firstArgument.text}`);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return routes.sort();
}

function importSources(path: string, source: string): string[] {
  const sourceFile = parseSource(path, source);
  return sourceFile.statements
    .filter(ts.isImportDeclaration)
    .map((declaration) => declaration.moduleSpecifier)
    .filter(ts.isStringLiteralLike)
    .map((specifier) => specifier.text);
}

function exportedDeclarationNames(path: string, source: string): string[] {
  const sourceFile = parseSource(path, source);
  const names: string[] = [];

  for (const statement of sourceFile.statements) {
    const exported =
      ts.canHaveModifiers(statement) &&
      ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) {
      continue;
    }
    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement)) &&
      statement.name
    ) {
      names.push(statement.name.text);
    }
  }

  return names.sort();
}

describe("server route module boundaries", () => {
  test("uses the exact private route module set", () => {
    const actualFiles = existsSync(routesRoot)
      ? readdirSync(routesRoot)
          .filter((name) => name.endsWith(".ts"))
          .sort()
      : [];

    expect(actualFiles).toEqual(expectedRouteFiles);
  });

  test("keeps server.ts as the stable composition-only root", () => {
    const path = sourcePath("server.ts");
    const source = readSource(path);

    expect(exportedDeclarationNames(path, source)).toEqual(["ServerDependencies", "buildServer"]);
    expect(source.split(/\r?\n/).length).toBeLessThanOrEqual(200);
    expect(directAppRoutes(path, source)).toEqual([]);
    expect(source).not.toContain('from "zod"');
    expect(source).toContain("Fastify({ logger: false })");
    expect(source).toContain('removeContentTypeParser("application/json")');
    expect(source).toContain('addContentTypeParser("application/json"');
    for (const service of [
      "AuthService",
      "AdminAuthService",
      "ActivationCodeService",
      "LlmConfigService",
      "BillingService",
      "EntitlementAdjustmentService",
    ]) {
      expect(source).toContain(`new ${service}(`);
    }
  });

  test("assigns every route to its approved capability owner", () => {
    for (const file of featureRouteFiles) {
      const path = sourcePath(`routes/${file}`);
      const source = readSource(path);
      expect(source, file).not.toBe("");
      expect(directAppRoutes(path, source), file).toEqual(expectedRoutes[file].sort());
    }
  });

  test("keeps feature registrars independent of startup and persistence implementations", () => {
    const featureNames = new Set(featureRouteFiles.map((file) => `./${file.replace(/\.ts$/, ".js")}`));
    const forbiddenImports = new Set([
      "../database.js",
      "../index.js",
      "../prismaStore.js",
      "../server.js",
      "@prisma/client",
      "fastify-plugin",
    ]);

    for (const file of [...featureRouteFiles, "authSchemas.ts", "shared.ts"] as const) {
      const path = sourcePath(`routes/${file}`);
      const source = readSource(path);
      const imports = importSources(path, source);
      expect(imports.filter((specifier) => forbiddenImports.has(specifier)), file).toEqual([]);
      expect(imports.filter((specifier) => featureNames.has(specifier)), file).toEqual([]);
      expect(source, file).not.toMatch(/\bFastify\s*\(/);
      expect(source, file).not.toContain("app.register(");
      expect(source, file).not.toMatch(/new\s+\w+Service\s*\(/);
    }
  });

  test("keeps raw webhook and administrator cookie constants with their security owners", () => {
    const allRouteFiles = [...featureRouteFiles, "authSchemas.ts", "shared.ts"] as const;
    const sources = new Map(
      allRouteFiles.map((file) => [file, readSource(sourcePath(`routes/${file}`))] as const),
    );
    const rawBodyOwners = allRouteFiles.filter((file) => sources.get(file)?.includes("rawBody"));

    expect(rawBodyOwners).toEqual(["billing.ts"]);
    for (const token of ["frameq_admin_session", "frameq_admin_csrf", "x-frameq-csrf"]) {
      expect(allRouteFiles.filter((file) => sources.get(file)?.includes(token)), token).toEqual([
        "admin.ts",
      ]);
    }
  });

  test("keeps production startup and external tests on the stable root", () => {
    const indexPath = sourcePath("index.ts");
    const indexSource = readSource(indexPath);
    expect(indexSource).toContain('import { buildServer } from "./server.js";');
    expect(importSources(indexPath, indexSource).some((specifier) => specifier.includes("/routes/"))).toBe(
      false,
    );

    for (const name of readdirSync(testsRoot).filter(
      (file) => file.endsWith(".test.ts") && file !== "serverModuleBoundaries.test.ts",
    )) {
      const path = fileURLToPath(new URL(name, new URL("./", import.meta.url)));
      const imports = importSources(path, readSource(path));
      expect(imports.some((specifier) => specifier.includes("/routes/")), name).toBe(false);
    }
  });
});
