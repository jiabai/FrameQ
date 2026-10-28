import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import ts from "typescript";

import { SUPPORTED_LOCALES, type SupportedLocale } from "./locale";
import { RESOURCE_NAMESPACES, resources } from "./resources";

type UiMessageSite = {
  code: string;
  file: string;
  line: number;
};

const SOURCE_FILE_PATTERN = /\.tsx?$/i;
const TEST_FILE_PATTERN = /\.(?:test|spec)\./i;

function flattenResourceKeys(
  value: Record<string, unknown>,
  prefix = "",
): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "string") {
      return [path];
    }
    if (child && typeof child === "object" && !Array.isArray(child)) {
      return flattenResourceKeys(child as Record<string, unknown>, path);
    }
    return [];
  });
}

function collectUiMessageLiterals(
  sourceFile: ts.SourceFile,
): Array<{ code: string; line: number }> {
  const literals: Array<{ code: string; line: number }> = [];

  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "uiMessage" &&
      node.arguments.length > 0
    ) {
      const argument = node.arguments[0];
      if (
        (ts.isStringLiteral(argument) ||
          ts.isNoSubstitutionTemplateLiteral(argument)) &&
        argument.text.trim().length > 0
      ) {
        const position = sourceFile.getLineAndCharacterOfPosition(
          argument.getStart(sourceFile),
        );
        literals.push({ code: argument.text, line: position.line + 1 });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return literals;
}

async function collectUiMessageSites(sourceRoot: string): Promise<UiMessageSite[]> {
  const sites: UiMessageSite[] = [];

  async function walk(directory: string) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));

    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (
        entry.isFile() &&
        SOURCE_FILE_PATTERN.test(entry.name) &&
        !TEST_FILE_PATTERN.test(entry.name)
      ) {
        const scriptKind = path.toLowerCase().endsWith(".tsx")
          ? ts.ScriptKind.TSX
          : ts.ScriptKind.TS;
        const sourceFile = ts.createSourceFile(
          path,
          await readFile(path, "utf8"),
          ts.ScriptTarget.Latest,
          true,
          scriptKind,
        );
        for (const literal of collectUiMessageLiterals(sourceFile)) {
          sites.push({
            ...literal,
            file: relative(sourceRoot, path).split(sep).join("/"),
          });
        }
      }
    }
  }

  await walk(sourceRoot);
  return sites;
}

describe("semantic UI message codes", () => {
  test("every uiMessage literal resolves to a bundled key in every locale", async () => {
    const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const keyIndex = new Map<SupportedLocale, Set<string>>();
    for (const locale of SUPPORTED_LOCALES) {
      const keys = new Set<string>();
      for (const namespace of RESOURCE_NAMESPACES) {
        for (const key of flattenResourceKeys(
          resources[locale][namespace] as Record<string, unknown>,
        )) {
          keys.add(`${namespace}.${key}`);
        }
      }
      keyIndex.set(locale, keys);
    }

    const sites = await collectUiMessageSites(sourceRoot);
    expect(sites.length).toBeGreaterThan(100);

    for (const site of sites) {
      for (const locale of SUPPORTED_LOCALES) {
        expect(
          keyIndex.get(locale)?.has(site.code),
          `${site.file}:${site.line} uiMessage("${site.code}") has no ${locale} resource key`,
        ).toBe(true);
      }
    }
  });
});
