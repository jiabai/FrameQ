// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import structured from "./fixtures/structured.html?raw";
import chinese from "./fixtures/chinese.html?raw";
import { extractArticle, EXTRACTION_LIMITS } from "./extractArticle";
import { safeArticleUrl, matchesSiteRule } from "./safeUrl";
import { SITE_RULES } from "./siteRules";

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const sourceUrl = "https://example.com/articles/current?id=5&token=secret#fragment";

describe("article extraction with real Document and production dependencies", () => {
  it("removes images without inserting labels or descriptions in generated text and markdown", () => {
    const doc = parse(chinese);
    doc.querySelector(".rich_media_content")!.insertAdjacentHTML("beforeend", '<p><img alt="图片" src="https://example.com/one.png"></p><p><img alt="数据增长趋势" src="https://example.com/two.png"></p>');
    const result = extractArticle(doc, "https://mp.weixin.qq.com/s/example");
    expect(result.text).not.toContain("图片");
    expect(result.markdown).not.toContain("图片");
    expect(result.text).not.toContain("数据增长趋势");
    expect(result.markdown).not.toContain("数据增长趋势");
  });
  it("preserves English structure, resolves links and leaves the original Document unchanged", () => {
    const doc = parse(structured);
    const original = doc.documentElement.outerHTML;
    const result = extractArticle(doc, sourceUrl);
    expect(result.title).toBe("Exploring reliable article extraction");
    expect(result.sourceUrl).toBe("https://example.com/articles/current?id=5");
    expect(result.markdown).toContain("## Evidence and practice");
    expect(result.markdown).toContain("**important findings**");
    expect(result.markdown).toContain("https://example.com/research?id=42");
    expect(result.markdown).toContain("*   Collect the public evidence.");
    expect(result.markdown).toContain("3.  Read the result.");
    expect(result.markdown).toContain("> Reliable records");
    expect(result.markdown).toContain("| Method | Result |");
    expect(result.markdown).toContain("```python\ndef save_article");
    expect(result.markdown).not.toContain("A chart comparing two methods");
    expect(result.markdown).toContain("The measurements use the same public dataset.");
    expect(result.markdown).not.toContain("![");
    expect(result.markdown).not.toContain("chart.png");
    expect(result.markdown).not.toContain("secret");
    expect(result.text).toContain("\n\nEvidence and practice\n\n");
    expect(result.text).toContain("\n    return title");
    expect(result.text).not.toContain("Subscribe");
    expect(doc.documentElement.outerHTML).toBe(original);
  });

  it("extracts real Chinese site-rule content and metadata title", () => {
    const result = extractArticle(parse(chinese), "https://mp.weixin.qq.com/s/example");
    expect(result.title).toBe("网页笔记的长期保存");
    expect(result.markdown).toContain("第二个段落解释资料来源");
    expect(result.markdown).toContain("> 引用内容需要保留上下文。");
    expect(result.text).toContain("\n\n第二个段落");
  });

  it("uses site-rule candidate selection, exclusions and multiple discussion clones", () => {
    const comment = "This discussion preserves evidence, its explanation, and the original source for careful independent reading. ";
    const doc = parse(`<title>Issue discussion</title><div class="Layout-main"><div class="comment-body"><p>${comment}</p></div><div class="comment-body"><p>A second comment. ${comment}</p></div></div>`);
    expect(extractArticle(doc, "https://github.com/owner/project/issues/10").markdown).toContain("* * *");
    const excluded = parse(`<title>Public article</title><div class="post"><p>${comment}</p><div class="photo-sidebar">Unrelated photo sidebar</div></div>`);
    expect(extractArticle(excluded, "https://officesnapshots.com/2026/article").text).not.toContain("sidebar");
  });

  it("sanitizes activity, embedded resources, unsafe links and raw HTML", () => {
    const doc = parse(structured);
    doc.querySelector("article")!.insertAdjacentHTML("beforeend", `<script>secretScript()</script><style>secretStyle</style><iframe src="https://evil.com">secretFrame</iframe><form>secretForm</form><svg><text>secretSvg</text></svg><object>secretObject</object><video src="https://evil.com">secretVideo</video><p onclick="attack()" style="background:url(https://evil.com)">Readable evidence <a href="javascript:attack()">unsafe link</a> <a href="http://127.0.0.1/private">private link</a> <a href="https://example.com/ok?token=secret">public link</a><img src="https://evil.com/pixel" alt="&lt;script&gt;caption&lt;/script&gt;"></p>`);
    const result = extractArticle(doc, sourceUrl);
    for (const forbidden of ["secretScript", "secretStyle", "secretFrame", "secretForm", "secretSvg", "secretObject", "secretVideo", "javascript:", "127.0.0.1", "https://evil.com", "onclick", "<script>", "<table>"]) {
      expect(result.markdown).not.toContain(forbidden);
    }
    expect(result.markdown).toContain("[public link](https://example.com/ok)");
    expect(result.markdown).toContain("unsafe link");
  });

  it("preserves headerless table cells, captions, pipe literals and code indentation", () => {
    const doc = parse(chinese);
    doc.querySelector(".rich_media_content")!.insertAdjacentHTML("beforeend", `<table><caption>Observation values</caption><tr><td>Left | right</td><td>Meaning</td></tr><tr><td>Original</td><td>Readable\nvalue</td></tr></table><p>&lt;img src=x onerror=attack()&gt; is a literal description.</p><pre><code>first\n\n\n    indented\nlast</code></pre>`);
    const result = extractArticle(doc, "https://mp.weixin.qq.com/s/example");
    expect(result.markdown).toContain("Observation values");
    expect(result.markdown).toContain("| Left \\| right | Meaning |");
    expect(result.markdown).not.toContain("<table");
    expect(result.markdown).toContain("\\<img");
    expect(result.text).toContain("Left | right\tMeaning");
    expect(result.text).toContain("first\n\n\n    indented\nlast");
  });

  it("resolves relative links using the supplied source and rejects a page-provided base", () => {
    const doc = parse(structured);
    doc.head.insertAdjacentHTML("beforeend", `<base href="https://evil.com/">`);
    expect(extractArticle(doc, sourceUrl).markdown).toContain("[relative reference](https://example.com/research?id=42)");
  });

  it("rejects malformed Unicode from dynamically generated DOM", () => {
    const doc = parse(chinese);
    doc.querySelector(".rich_media_content p")!.append("\ud800");
    expect(() => extractArticle(doc, "https://mp.weixin.qq.com/s/example")).toThrow(/invalid_unicode/);
  });

  it("rejects Markdown expansion beyond its byte budget", () => {
    const doc = parse(chinese);
    const paragraph = doc.createElement("p");
    paragraph.textContent = "📝".repeat(28);
    const link = doc.createElement("a");
    link.textContent = "reference";
    link.href = `https://example.com/${"a".repeat(8000)}`;
    for (let index = 0; index < 550; index += 1) paragraph.append(link.cloneNode(true));
    doc.querySelector(".rich_media_content")!.append(paragraph);
    expect(() => extractArticle(doc, "https://mp.weixin.qq.com/s/example")).toThrow(/markdown_limit/);
  });

  it("rejects navigation-only, empty, short and disabled pages", () => {
    for (const html of ["<title>Empty</title>", "<title>Short</title><article><p>Short text.</p></article>", `<title>Navigation</title><nav>${"<a href='/news'>News category</a>".repeat(30)}</nav>`]) {
      expect(() => extractArticle(parse(html), sourceUrl)).toThrow(/article_extraction:/);
    }
    expect(() => extractArticle(parse(structured), "https://accounts.google.com/signin")).toThrow(/unsupported_page/);
  });

  it("bounds Unicode title, serialized input, DOM nodes and article text", () => {
    const doc = parse(chinese);
    doc.querySelector("#activity-name")!.textContent = "📝".repeat(600);
    expect(Array.from(extractArticle(doc, "https://mp.weixin.qq.com/s/example").title)).toHaveLength(512);
    const nodes = parse(`<title>Too many</title><article>${"<span>x</span>".repeat(EXTRACTION_LIMITS.domNodes + 1)}</article>`);
    expect(() => extractArticle(nodes, sourceUrl)).toThrow(/dom_limit/);
    const tooMuchHtml = parse(`<title>Too large</title><article><p>${"a".repeat(EXTRACTION_LIMITS.serializedBytes)}</p></article>`);
    expect(() => extractArticle(tooMuchHtml, sourceUrl)).toThrow(/input_limit/);
    const text = parse(`<title>Too much text</title><div class="rich_media_content"><p>${"a".repeat(EXTRACTION_LIMITS.textBytes + 1)}</p></div>`);
    expect(() => extractArticle(text, "https://mp.weixin.qq.com/s/example")).toThrow(/text_limit/);
  });
});

describe("safe persistent URL and site rules", () => {
  it("keeps exactly the numeric query allowlist and removes repeated fields", () => {
    expect(safeArticleUrl("https://EXAMPLE.com.:443/story?id=00012&page=2&p=0&article_id=123&post_id=4&story_id=5&token=s#secret")).toBe("https://example.com/story?article_id=123&id=00012&page=2&post_id=4&story_id=5");
    expect(safeArticleUrl("https://example.com/?id=1&id=2&page=02&ID=2&post_id=123456789012345678901")).toBe("https://example.com/");
  });
  it.each(["file:///etc/passwd", "javascript:alert(1)", "https://user:pass@example.com/", "http://localhost/", "http://127.1/", "http://2130706433/", "http://10.0.0.1/", "http://[::ffff:7f00:1]/", "http://[::1]/", "http://[fc00::1]/", "https://example.local/", "https://example.com:444/", "http://999.999.999.999/"])("rejects %s", (url) => {
    expect(() => safeArticleUrl(url)).toThrow();
  });
  it("matches all 59 rules against parsed host and complete path segments", () => {
    expect(Object.keys(SITE_RULES)).toHaveLength(59);
    expect(matchesSiteRule(new URL("https://en.wikipedia.org/wiki/Article"), "wikipedia.org/wiki/")).toBe(true);
    expect(matchesSiteRule(new URL("https://github.com/owner/project/issues/42"), "github.com/*/*/issues/")).toBe(true);
    for (const url of ["https://evil.com/path/wikipedia.org/wiki/Article", "https://wikipedia.org.evil.com/wiki/Article", "https://en.wikipedia.org/wikimedia/Article", "https://evil.com/?next=wikipedia.org/wiki/"]) {
      expect(matchesSiteRule(new URL(url), "wikipedia.org/wiki/")).toBe(false);
    }
  });
});
