import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const checkerPath = resolve(repositoryRoot, "scripts/check-i18n-literals.mjs");

async function createFixture(files) {
  const root = await mkdtemp(join(tmpdir(), "frameq-i18n-literals-"));

  await Promise.all(
    Object.entries(files).map(async ([relativePath, contents]) => {
      const path = join(root, relativePath);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, contents, "utf8");
    }),
  );

  return root;
}

function runChecker(root, ...flags) {
  return spawnSync(
    process.execPath,
    [checkerPath, "--root", root, ...flags],
    { encoding: "utf8" },
  );
}

test("visible-copy gate reports JSX, accessibility, presentation, and notice literals", async () => {
  const root = await createFixture({
    "Bad.tsx": `export function Bad({ ready }: { ready: boolean }) {
  const card = { title: "Card title", body: \`Card body\` };
  const detail = { description: ready ? "Ready details" : "" };
  setActionNotice(ready ? \`Done \${card.title}\` : "Try again");
  reportSyncNotice("Reported");
  return (
    <main className="shell" id="root" role="main" data-testid="shell" aria-controls="panel" aria-describedby="help">
      Hello world
      <input type="text" placeholder="Paste URL" aria-label={"Video URL"} title={ready ? "Ready" : ""} />
      <Widget emptyText="Nothing yet" readOnlyReason={ready ? "Locked" : "Unavailable"} />
      <span>{ready ? "Enabled" : \`Disabled now\`}</span>
      <span>{t("copy.ready")}</span>
      <span>{ready && "Visible when ready"}</span>
    </main>
  );
}
`,
    "Ignored.test.tsx": `export const Ignored = () => <p aria-label="Ignored">Ignored test copy</p>;
`,
    "Ignored.test.fixture.tsx": `export const IgnoredFixture = () => <p>Ignored fixture copy</p>;
`,
    "Ignored.spec.tsx": `export const IgnoredSpec = () => <p>Ignored spec copy</p>;
`,
    "__tests__/Ignored.tsx": `export const IgnoredDirectory = () => <p>Ignored directory copy</p>;
`,
  });

  try {
    const result = runChecker(root, "--check-visible");

    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stdout, /^Bad\.tsx:2:\d+ \[visible-presentation\]/m);
    assert.match(result.stdout, /^Bad\.tsx:3:\d+ \[visible-presentation\]/m);
    assert.match(result.stdout, /^Bad\.tsx:4:\d+ \[visible-notice\]/m);
    assert.match(result.stdout, /^Bad\.tsx:5:\d+ \[visible-notice\]/m);
    assert.match(result.stdout, /^Bad\.tsx:8:\d+ \[visible-jsx-text\]/m);
    assert.match(result.stdout, /^Bad\.tsx:9:\d+ \[visible-jsx-attribute\]/m);
    assert.match(result.stdout, /^Bad\.tsx:10:\d+ \[visible-jsx-attribute\]/m);
    assert.match(result.stdout, /^Bad\.tsx:11:\d+ \[visible-jsx-expression\]/m);
    assert.match(result.stdout, /^Bad\.tsx:13:\d+ \[visible-jsx-expression\]/m);
    assert.doesNotMatch(result.stdout, /Bad\.tsx:7:/);
    assert.doesNotMatch(result.stdout, /Bad\.tsx:12:/);
    assert.doesNotMatch(result.stdout, /Ignored\.test\.tsx/);
    assert.doesNotMatch(result.stdout, /Ignored\.test\.fixture\.tsx/);
    assert.doesNotMatch(result.stdout, /Ignored\.spec\.tsx/);
    assert.doesNotMatch(result.stdout, /__tests__/);
    assert.equal(result.stderr, "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("visible-copy gate catches derived copy, standard ARIA text, and custom presentation props", async () => {
  const root = await createFixture({
    "Derived.tsx": `const actionLabel = "Archive task";
const statusMessage = "Queued";
export function Derived() {
  showNotice("Shown notice");
  return <Widget aria-description="More context" aria-roledescription="result panel" heading="History" actionLabel={actionLabel} summary={["First", "Second"].join(" / ")} />;
}
`,
  });

  try {
    const result = runChecker(root, "--check-visible");

    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stdout, /^Derived\.tsx:1:\d+ \[visible-presentation\]/m);
    assert.match(result.stdout, /^Derived\.tsx:2:\d+ \[visible-presentation\]/m);
    assert.match(result.stdout, /^Derived\.tsx:4:\d+ \[visible-notice\]/m);
    assert.match(result.stdout, /^Derived\.tsx:5:\d+ \[visible-jsx-attribute\]/m);
    assert.equal(result.stderr, "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("visible-copy gate permits structural literals, translation calls, resources, and prompt semantics", async () => {
  const root = await createFixture({
    "Clean.tsx": `const structure = {
  className: "shell",
  id: "main",
  role: "dialog",
  type: "button",
  message_code: "worker.download.complete",
};

export function Clean() {
  return <section className="shell" id="main" role="region" data-testid="main" aria-controls="panel" aria-describedby="hint">{t("copy.ready")}</section>;
}
`,
    "i18n/resources.ts": `export const resources = { title: "Settings", body: "Description" };
`,
    "preferencesPromptSemantics.ts": `export const semantics = { label: "Deep analysis", description: "Prompt-only wording" };
`,
  });

  try {
    const result = runChecker(root, "--check-visible");

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stdout, "i18n literal checks passed.\n");
    assert.equal(result.stderr, "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CJK gate allows only i18n, PromptSemantics, and the urlSupport punctuation regex", async () => {
  const root = await createFixture({
    "Feature.ts": `export const untranslated = "未迁移";
export const phonetic = "ㄅ";
`,
    "i18n/resources.ts": `export const resources = { heading: "设置", traditional: "內容", japanese: "設定", korean: "설정" };
`,
    "i18n/preferenceResources.ts": `export const preferenceResources = { heading: "偏好设置" };
`,
    "i18n/helper.ts": `export const leakedCopy = "不应放在普通 i18n helper";
`,
    "preferencesPromptSemantics.ts": `export const semantics = { label: "深度分析" };
`,
    "urlSupport.ts": `const TRAILING_URL_PUNCTUATION_PATTERN = /[，。！？；：、,.;:!?）)\\]}]+$/u;
const unrelated = "额外文案";
`,
  });

  try {
    const result = runChecker(root, "--check-cjk");

    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stdout, /^Feature\.ts:1:\d+ \[cjk-outside-allowlist\]/m);
    assert.match(result.stdout, /^Feature\.ts:2:\d+ \[cjk-outside-allowlist\]/m);
    assert.match(result.stdout, /^urlSupport\.ts:2:\d+ \[cjk-outside-allowlist\]/m);
    assert.doesNotMatch(result.stdout, /i18n\/resources\.ts/);
    assert.doesNotMatch(result.stdout, /i18n\/preferenceResources\.ts/);
    assert.match(result.stdout, /^i18n\/helper\.ts:1:\d+ \[cjk-outside-allowlist\]/m);
    assert.doesNotMatch(result.stdout, /PromptSemantics\.ts/);
    assert.doesNotMatch(result.stdout, /urlSupport\.ts:1:/);
    assert.equal(result.stderr, "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("visible and CJK checks can run independently", async () => {
  const root = await createFixture({
    "Independent.tsx": `export const untranslated = "中文";
export const Independent = () => <p>English copy</p>;
`,
  });

  try {
    const visible = runChecker(root, "--check-visible");
    assert.equal(visible.status, 1, visible.stderr || visible.stdout);
    assert.match(visible.stdout, /^Independent\.tsx:2:\d+ \[visible-jsx-text\]/m);
    assert.doesNotMatch(visible.stdout, /cjk-outside-allowlist/);

    const cjk = runChecker(root, "--check-cjk");
    assert.equal(cjk.status, 1, cjk.stderr || cjk.stdout);
    assert.match(cjk.stdout, /^Independent\.tsx:1:\d+ \[cjk-outside-allowlist\]/m);
    assert.doesNotMatch(cjk.stdout, /visible-jsx-text/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("urlSupport exception permits punctuation but not CJK words in the named regex", async () => {
  const root = await createFixture({
    "urlSupport.ts": `const TRAILING_URL_PUNCTUATION_PATTERN = /[，中文。]+$/u;
`,
  });

  try {
    const result = runChecker(root, "--check-cjk");

    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stdout, /^urlSupport\.ts:1:\d+ \[cjk-outside-allowlist\]/m);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("production app contains no hard-coded visible copy or out-of-boundary CJK", () => {
  const result = runChecker(resolve(repositoryRoot, "app/src"));

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout, "i18n literal checks passed.\n");
  assert.equal(result.stderr, "");
});
