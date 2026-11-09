import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appRoot = join(repoRoot, "app");
const sourceRoot = join(appRoot, "src", "articleExtraction");
const require = createRequire(join(appRoot, "package.json"));
const { build, version: compilerVersion } = require("esbuild");

export const EXTRACTOR_DEPENDENCIES = Object.freeze({
  "@mozilla/readability": "0.6.0",
  dompurify: "3.4.17",
  turndown: "7.2.0",
  "turndown-plugin-gfm": "1.0.2",
  "ipaddr.js": "2.3.0",
});

async function fingerprint(root, path) {
  const bytes = await readFile(join(root, path));
  return { path, bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export async function buildArticleExtractor(outputRoot = join(appRoot, "src-tauri", "resources", "web")) {
  const lock = JSON.parse(await readFile(join(appRoot, "package-lock.json"), "utf8"));
  const dependencies = {};
  for (const [name, expectedVersion] of Object.entries(EXTRACTOR_DEPENDENCIES)) {
    const installed = JSON.parse(await readFile(join(appRoot, "node_modules", name, "package.json"), "utf8"));
    const locked = lock.packages[`node_modules/${name}`];
    if (installed.version !== expectedVersion || locked?.version !== expectedVersion || !locked.integrity) {
      throw new Error(`Article extractor requires locked ${name}@${expectedVersion}`);
    }
    dependencies[name] = { version: expectedVersion, integrity: locked.integrity, license: installed.license };
  }
  await mkdir(outputRoot, { recursive: true });
  await build({
    absWorkingDir: appRoot,
    entryPoints: [join(sourceRoot, "browserEntry.ts")],
    outfile: join(outputRoot, "extract-article.js"),
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "es2020",
    minify: true,
    sourcemap: false,
    charset: "utf8",
    legalComments: "external",
    banner: { js: "/*! Article extractor. See NOTICE.txt, licenses/ and source/siteRules.ts. */" },
  });
  const copies = [
    [join(sourceRoot, "NOTICE.txt"), "NOTICE.txt"],
    [join(sourceRoot, "siteRules.ts"), "source/siteRules.ts"],
    [join(sourceRoot, "licenses", "InsightFlow-MIT.txt"), "licenses/InsightFlow-MIT.txt"],
    [join(appRoot, "node_modules", "dompurify", "LICENSE-MPL"), "licenses/MPL-2.0.txt"],
    [join(appRoot, "node_modules", "dompurify", "LICENSE"), "licenses/DOMPurify-Apache-2.0.txt"],
    [join(appRoot, "node_modules", "@mozilla", "readability", "LICENSE.md"), "licenses/Readability-NOTICE.txt"],
    [join(repoRoot, "LICENSE"), "licenses/Apache-2.0.txt"],
    [join(appRoot, "node_modules", "turndown", "LICENSE"), "licenses/Turndown-MIT.txt"],
    [join(appRoot, "node_modules", "turndown-plugin-gfm", "LICENSE"), "licenses/Turndown-GFM-MIT.txt"],
    [join(appRoot, "node_modules", "ipaddr.js", "LICENSE"), "licenses/ipaddr-MIT.txt"],
  ];
  for (const [source, target] of copies) {
    await mkdir(dirname(join(outputRoot, target)), { recursive: true });
    await copyFile(source, join(outputRoot, target));
  }
  const files = await Promise.all(["extract-article.js", "extract-article.js.LEGAL.txt", ...copies.map(([, target]) => target)].sort().map((path) => fingerprint(outputRoot, path)));
  const bundle = files.find((entry) => entry.path === "extract-article.js");
  const manifest = {
    schema_version: 1,
    bundle: bundle.path,
    global: "__appExtractArticle",
    bytes: bundle.bytes,
    sha256: bundle.sha256,
    compiler: { name: "esbuild", version: compilerVersion },
    dependencies,
    files,
  };
  await writeFile(join(outputRoot, "extract-article.manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const manifest = await buildArticleExtractor();
  process.stdout.write(`Article extractor: ${manifest.bytes} bytes, SHA-256 ${manifest.sha256}\n`);
}
