import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildArticleExtractor, EXTRACTOR_DEPENDENCIES } from "../build-article-extractor.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(root, "app/package.json"));
const { JSDOM } = require("jsdom");

test("compiles a reproducible executable browser bundle with fingerprints and complete notices", async () => {
  const work = join(root, "build", "article-extractor-tests");
  await mkdir(work, { recursive: true });
  const output = await mkdtemp(join(work, "article-extractor-"));
  try {
    const first = await buildArticleExtractor(output);
    const second = await buildArticleExtractor(output);
    assert.deepEqual(first, second);
    assert.equal(first.schema_version, 1);
    assert.equal(first.global, "__frameqExtractArticle");
    assert.deepEqual(Object.fromEntries(Object.entries(first.dependencies).map(([name, data]) => [name, data.version])), EXTRACTOR_DEPENDENCIES);
    for (const file of first.files) {
      const bytes = await readFile(join(output, file.path));
      assert.equal(bytes.byteLength, file.bytes);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256);
    }
    const html = await readFile(join(root, "app/src/articleExtraction/fixtures/structured.html"), "utf8");
    const dom = new JSDOM(html, { url: "https://example.com/articles/current", runScripts: "outside-only" });
    try {
      const original = dom.window.document.documentElement.outerHTML;
      dom.window.eval(await readFile(join(output, first.bundle), "utf8"));
      const result = dom.window.__frameqExtractArticle(dom.window.document, "https://example.com/articles/current?id=1&token=secret");
      assert.deepEqual(Object.keys(result).sort(), ["markdown", "sourceUrl", "text", "title"]);
      assert.equal(result.sourceUrl, "https://example.com/articles/current?id=1");
      assert.match(result.markdown, /\| Method \| Result \|/);
      assert.match(result.markdown, /```python/);
      assert.doesNotMatch(result.markdown, /token=|<script|!\[/);
      assert.equal(dom.window.document.documentElement.outerHTML, original);
      const rules = await readFile(join(output, "source/siteRules.ts"), "utf8");
      assert.match(rules, /SPDX-License-Identifier: MPL-2.0/);
      assert.match(await readFile(join(output, "licenses/MPL-2.0.txt"), "utf8"), /Mozilla Public License/);
      assert.match(await readFile(join(output, "licenses/InsightFlow-MIT.txt"), "utf8"), /Copyright \(c\) 2025 StandlX/);
    } finally {
      dom.window.close();
    }
  } finally {
    assert.equal(dirname(output), work);
    await rm(output, { recursive: true, force: true });
  }
});
