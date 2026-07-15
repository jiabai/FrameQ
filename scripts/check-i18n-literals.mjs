import { readFile, readdir } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import ts from "../app/node_modules/typescript/lib/typescript.js";

const VISIBLE_JSX_ATTRIBUTES = new Set([
  "alt",
  "aria-label",
  "aria-description",
  "aria-roledescription",
  "aria-valuetext",
  "actionLabel",
  "caption",
  "description",
  "emptyText",
  "errorMessage",
  "helperText",
  "heading",
  "hint",
  "label",
  "message",
  "notice",
  "placeholder",
  "readOnlyReason",
  "subtitle",
  "summary",
  "successMessage",
  "title",
  "tooltip",
]);

const PRESENTATION_PROPERTY_NAMES = new Set([
  "alt",
  "ariaLabel",
  "body",
  "caption",
  "description",
  "emptyText",
  "errorMessage",
  "helperText",
  "hint",
  "label",
  "message",
  "notice",
  "placeholder",
  "readOnlyReason",
  "subtitle",
  "successMessage",
  "title",
  "tooltip",
]);

const CJK_PATTERN =
  /(?:\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}|\p{Script=Bopomofo}|[\u3000-\u303f\uff00-\uffef])+/gu;
const URL_SUPPORT_CJK_PUNCTUATION_PATTERN = /^[，。！？；：、）]+$/u;
const SOURCE_FILE_PATTERN = /\.tsx?$/i;
const TEST_FILE_PATTERN = /\.(?:test|spec)\./i;
const PROMPT_SEMANTICS_PATTERN = /PromptSemantics\.ts$/;

function normalizePath(path) {
  return path.split(sep).join("/");
}

function isPromptSemanticsPath(relativePath) {
  return PROMPT_SEMANTICS_PATTERN.test(relativePath);
}

function isI18nPath(relativePath) {
  return relativePath.split("/").includes("i18n");
}

function isTranslationResourcePath(relativePath) {
  if (!isI18nPath(relativePath)) {
    return false;
  }

  const segments = relativePath.split("/");
  return (
    segments.includes("locales") ||
    /resources?(?:\.[^.]+)?$/i.test(segments.at(-1) ?? "")
  );
}

function isNonEmptyLiteral(node) {
  return typeof node.text === "string" && node.text.trim().length > 0;
}

function templateHasStaticCopy(node) {
  return (
    node.head.text.trim().length > 0 ||
    node.templateSpans.some((span) => span.literal.text.trim().length > 0)
  );
}

function unwrapExpression(node) {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function collectVisibleLiterals(expression) {
  const node = unwrapExpression(expression);

  if (
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
    isNonEmptyLiteral(node)
  ) {
    return [node];
  }

  if (ts.isTemplateExpression(node)) {
    return templateHasStaticCopy(node) ? [node] : [];
  }

  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.flatMap((element) => collectVisibleLiterals(element));
  }

  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "join"
  ) {
    return [
      ...collectVisibleLiterals(node.expression.expression),
      ...node.arguments.flatMap((argument) => collectVisibleLiterals(argument)),
    ];
  }

  if (ts.isConditionalExpression(node)) {
    return [
      ...collectVisibleLiterals(node.whenTrue),
      ...collectVisibleLiterals(node.whenFalse),
    ];
  }

  if (ts.isBinaryExpression(node)) {
    if (
      node.operatorToken.kind === ts.SyntaxKind.PlusToken ||
      node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    ) {
      return [
        ...collectVisibleLiterals(node.left),
        ...collectVisibleLiterals(node.right),
      ];
    }

    if (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      return collectVisibleLiterals(node.right);
    }
  }

  return [];
}

function propertyNameText(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
    return name.text;
  }
  return null;
}

function calledFunctionName(expression) {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }
  return null;
}

function noticeCallNameMatches(name) {
  return (
    typeof name === "string" &&
    (/(?:notice|toast|notify|alert)/i.test(name) ||
      /^(?:set|report|show).*(?:message|error)$/i.test(name))
  );
}

function presentationNameMatches(name) {
  return (
    typeof name === "string" &&
    (PRESENTATION_PROPERTY_NAMES.has(name) ||
      /(?:Label|Message|Notice|Title|Description|Heading|Caption|Hint|Tooltip)$/i.test(
        name,
      ))
  );
}

function visibleJsxAttributeMatches(name) {
  return (
    VISIBLE_JSX_ATTRIBUTES.has(name) ||
    /^aria-(?:description|label|roledescription|valuetext)$/i.test(name) ||
    presentationNameMatches(name)
  );
}

function firstNonWhitespacePosition(node, sourceFile) {
  const start = node.getStart(sourceFile);
  const text = sourceFile.text.slice(start, node.getEnd());
  const offset = text.search(/\S/u);
  return offset < 0 ? start : start + offset;
}

function pushDiagnostic(diagnostics, sourceFile, relativePath, node, code, message) {
  const position = firstNonWhitespacePosition(node, sourceFile);
  const location = sourceFile.getLineAndCharacterOfPosition(position);
  diagnostics.push({
    code,
    column: location.character + 1,
    line: location.line + 1,
    message,
    path: relativePath,
    position,
  });
}

function scanVisibleCopy(sourceFile, relativePath) {
  if (
    isTranslationResourcePath(relativePath) ||
    isPromptSemanticsPath(relativePath)
  ) {
    return [];
  }

  const diagnostics = [];

  function visit(node) {
    if (ts.isJsxText(node) && node.text.trim().length > 0) {
      pushDiagnostic(
        diagnostics,
        sourceFile,
        relativePath,
        node,
        "visible-jsx-text",
        "hard-coded JSX text",
      );
    }

    if (
      ts.isJsxExpression(node) &&
      !ts.isJsxAttribute(node.parent) &&
      node.expression !== undefined
    ) {
      for (const literal of collectVisibleLiterals(node.expression)) {
        pushDiagnostic(
          diagnostics,
          sourceFile,
          relativePath,
          literal,
          "visible-jsx-expression",
          "hard-coded JSX expression copy",
        );
      }
    }

    if (ts.isJsxAttribute(node)) {
      const attributeName = node.name.getText(sourceFile);
      if (visibleJsxAttributeMatches(attributeName)) {
        const expression = ts.isJsxExpression(node.initializer)
          ? node.initializer.expression
          : node.initializer;
        if (expression !== undefined) {
          for (const literal of collectVisibleLiterals(expression)) {
            pushDiagnostic(
              diagnostics,
              sourceFile,
              relativePath,
              literal,
              "visible-jsx-attribute",
              `hard-coded ${attributeName} copy`,
            );
          }
        }
      }
    }

    if (
      ts.isPropertyAssignment(node) &&
      presentationNameMatches(propertyNameText(node.name))
    ) {
      for (const literal of collectVisibleLiterals(node.initializer)) {
        pushDiagnostic(
          diagnostics,
          sourceFile,
          relativePath,
          literal,
          "visible-presentation",
          "hard-coded presentation copy",
        );
      }
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      presentationNameMatches(node.name.text) &&
      node.initializer !== undefined
    ) {
      for (const literal of collectVisibleLiterals(node.initializer)) {
        pushDiagnostic(
          diagnostics,
          sourceFile,
          relativePath,
          literal,
          "visible-presentation",
          "hard-coded presentation copy",
        );
      }
    }

    if (ts.isCallExpression(node)) {
      const callName = calledFunctionName(node.expression);
      if (noticeCallNameMatches(callName)) {
        for (const argument of node.arguments) {
          for (const literal of collectVisibleLiterals(argument)) {
            pushDiagnostic(
              diagnostics,
              sourceFile,
              relativePath,
              literal,
              "visible-notice",
              "hard-coded notice copy",
            );
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return diagnostics;
}

function urlPunctuationAllowlistRanges(sourceFile, relativePath) {
  if (basename(relativePath) !== "urlSupport.ts") {
    return [];
  }

  const ranges = [];
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "TRAILING_URL_PUNCTUATION_PATTERN" &&
      node.initializer !== undefined &&
      ts.isRegularExpressionLiteral(node.initializer)
    ) {
      ranges.push({
        start: node.initializer.getStart(sourceFile),
        end: node.initializer.getEnd(),
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return ranges;
}

function isInsideRange(start, end, ranges) {
  return ranges.some((range) => start >= range.start && end <= range.end);
}

function scanCjk(sourceFile, relativePath) {
  if (
    isTranslationResourcePath(relativePath) ||
    isPromptSemanticsPath(relativePath)
  ) {
    return [];
  }

  const diagnostics = [];
  const allowedRanges = urlPunctuationAllowlistRanges(sourceFile, relativePath);
  const reportedLines = new Set();

  for (const match of sourceFile.text.matchAll(CJK_PATTERN)) {
    const start = match.index;
    const end = start + match[0].length;
    if (
      isInsideRange(start, end, allowedRanges) &&
      URL_SUPPORT_CJK_PUNCTUATION_PATTERN.test(match[0])
    ) {
      continue;
    }

    const location = sourceFile.getLineAndCharacterOfPosition(start);
    if (reportedLines.has(location.line)) {
      continue;
    }
    reportedLines.add(location.line);
    diagnostics.push({
      code: "cjk-outside-allowlist",
      column: location.character + 1,
      line: location.line + 1,
      message: "CJK text outside an approved localization boundary",
      path: relativePath,
      position: start,
    });
  }

  return diagnostics;
}

async function sourceFilesUnder(root) {
  const files = [];

  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));

    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "__tests__") {
          await walk(path);
        }
      } else if (
        entry.isFile() &&
        SOURCE_FILE_PATTERN.test(entry.name) &&
        !TEST_FILE_PATTERN.test(entry.name)
      ) {
        files.push(path);
      }
    }
  }

  await walk(root);
  return files;
}

export async function checkI18nLiterals({ root, checkVisible, checkCjk }) {
  const sourceRoot = resolve(root);
  const diagnostics = [];

  for (const path of await sourceFilesUnder(sourceRoot)) {
    const relativePath = normalizePath(relative(sourceRoot, path));
    const text = await readFile(path, "utf8");
    const scriptKind = path.toLowerCase().endsWith(".tsx")
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS;
    const sourceFile = ts.createSourceFile(
      path,
      text,
      ts.ScriptTarget.Latest,
      true,
      scriptKind,
    );

    if (checkVisible) {
      diagnostics.push(...scanVisibleCopy(sourceFile, relativePath));
    }
    if (checkCjk) {
      diagnostics.push(...scanCjk(sourceFile, relativePath));
    }
  }

  diagnostics.sort(
    (left, right) =>
      left.path.localeCompare(right.path, "en") ||
      left.position - right.position ||
      left.code.localeCompare(right.code, "en"),
  );
  return diagnostics;
}

function parseArguments(argv) {
  let root = resolve(import.meta.dirname, "../app/src");
  let checkVisible = false;
  let checkCjk = false;
  let hasExplicitCheck = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--root") {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error("--root requires a source directory");
      }
      root = resolve(value);
      index += 1;
    } else if (argument === "--check-visible") {
      checkVisible = true;
      hasExplicitCheck = true;
    } else if (argument === "--check-cjk") {
      checkCjk = true;
      hasExplicitCheck = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!hasExplicitCheck) {
    checkVisible = true;
    checkCjk = true;
  }

  return { root, checkVisible, checkCjk };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const diagnostics = await checkI18nLiterals(options);

  if (diagnostics.length === 0) {
    process.stdout.write("i18n literal checks passed.\n");
    return;
  }

  for (const diagnostic of diagnostics) {
    process.stdout.write(
      `${diagnostic.path}:${diagnostic.line}:${diagnostic.column} [${diagnostic.code}] ${diagnostic.message}\n`,
    );
  }
  process.exitCode = 1;
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    process.stderr.write(`i18n literal check failed: ${message}\n`);
    process.exitCode = 2;
  });
}
