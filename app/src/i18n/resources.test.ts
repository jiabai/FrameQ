import { describe, expect, test } from "vitest";
import { asrModelResources } from "./asrModelResources";
import { RESOURCE_NAMESPACES, resources } from "./resources";
import { SUPPORTED_LOCALES } from "./locale";

function flatten(
  value: Record<string, unknown>,
  prefix = "",
): Array<[key: string, value: string]> {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "string") {
      return [[path, child]];
    }
    if (child && typeof child === "object" && !Array.isArray(child)) {
      return flatten(child as Record<string, unknown>, path);
    }
    throw new Error(`Invalid resource value at ${path}`);
  });
}

/** Variables every locale receives from the i18n default variables, not per-key parameters. */
const GLOBAL_INTERPOLATION_VARIABLES = new Set(["product", "productMark"]);

function interpolationTokens(value: string): string[] {
  return [...value.matchAll(/{{\s*([^},\s]+).*?}}/g)]
    .map((match) => match[1])
    .filter((token) => !GLOBAL_INTERPOLATION_VARIABLES.has(token))
    .sort();
}

describe("bundled localization resources", () => {
  test("contains the foundational and semantic progress namespaces", () => {
    expect(RESOURCE_NAMESPACES).toEqual([
      "common",
      "settings",
      "diagnostics",
      "bootstrap",
      "progress",
      "preferences",
      "account",
      "history",
      "transcript",
      "asrModel",
      "workflow",
      "synthesis",
      "updates",
      "errors",
      "shell",
      "noteActions",
      "dataStorage",
      "webPage",
      "processing",
    ]);
    expect(Object.keys(resources).sort()).toEqual([...SUPPORTED_LOCALES].sort());
  });

  test("keeps key, interpolation, and plural parity across all locales", () => {
    const baselineLocale = SUPPORTED_LOCALES[0];

    for (const namespace of RESOURCE_NAMESPACES) {
      const baseline = new Map(flatten(resources[baselineLocale][namespace]));
      const baselineKeys = [...baseline.keys()].sort();

      for (const locale of SUPPORTED_LOCALES.slice(1)) {
        const candidate = new Map(flatten(resources[locale][namespace]));
        expect([...candidate.keys()].sort(), `${locale}.${namespace} key parity`).toEqual(
          baselineKeys,
        );

        for (const key of baselineKeys) {
          expect(
            interpolationTokens(candidate.get(key) ?? ""),
            `${locale}.${namespace}.${key} interpolation parity`,
          ).toEqual(interpolationTokens(baseline.get(key) ?? ""));
        }
      }

      const pluralBases = baselineKeys
        .filter((key) => key.endsWith("_one") || key.endsWith("_other"))
        .map((key) => key.replace(/_(one|other)$/, ""));
      for (const base of new Set(pluralBases)) {
        expect(baselineKeys).toContain(`${base}_one`);
        expect(baselineKeys).toContain(`${base}_other`);
      }
    }
  });

  test("contains no empty strings or inline HTML", () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const namespace of RESOURCE_NAMESPACES) {
        for (const [key, value] of flatten(resources[locale][namespace])) {
          expect(value.trim(), `${locale}.${namespace}.${key}`).not.toBe("");
          expect(value, `${locale}.${namespace}.${key}`).not.toMatch(/<\/?[a-z][^>]*>/i);
        }
      }
    }
  });

  test("provides compact transcript save-state labels in every locale", () => {
    expect(resources["zh-CN"].transcript.workspace.saveState).toEqual({
      loading: "读取中",
      saving: "保存中",
      unsaved: "有未保存修改",
    });
    expect(resources["zh-TW"].transcript.workspace.saveState).toEqual({
      loading: "讀取中",
      saving: "儲存中",
      unsaved: "有未儲存的修改",
    });
    expect(resources["en-US"].transcript.workspace.saveState).toEqual({
      loading: "Loading",
      saving: "Saving",
      unsaved: "Unsaved changes",
    });
  });

  test("provides exact localized recovery guidance for model download timeouts", () => {
    expect(asrModelResources).toMatchObject({
      "zh-CN": {
        notice: {
          idleTimeout: "模型下载长时间没有新的进展，已停止。已下载的文件会保留，请稍后重试。",
          executionTimeout: "模型下载已超过最长运行时间，已停止。已下载的文件会保留，请稍后重试。",
          runtimeMissing: "模型下载进程无法启动。安装包中的 Windows VC++ 运行组件缺失或被安全软件隔离，请重新安装 {{product}} 后重试。",
        },
      },
      "zh-TW": {
        notice: {
          idleTimeout: "模型下載長時間沒有新的進度，已停止。已下載的檔案會保留，請稍後重試。",
          executionTimeout: "模型下載已超過最長執行時間，已停止。已下載的檔案會保留，請稍後重試。",
          runtimeMissing: "模型下載程序無法啟動。安裝包中的 Windows VC++ 執行元件缺失或被安全軟體隔離，請重新安裝 {{product}} 後重試。",
        },
      },
      "en-US": {
        notice: {
          idleTimeout: "The model download stopped after making no progress for too long. Downloaded files were kept; try again later.",
          executionTimeout: "The model download reached the maximum run time and was stopped. Downloaded files were kept; try again later.",
          runtimeMissing: "The model download process could not start. Windows VC++ runtime components are missing from the installer or were quarantined by security software; reinstall {{product}} and try again.",
        },
      },
    });
  });

  test("provides generic content-free AI generation progress in every locale", () => {
    expect(resources["zh-CN"].progress.worker.ai_generation_running).toBe("正在生成 AI 结果。");
    expect(resources["zh-TW"].progress.worker.ai_generation_running).toBe("正在產生 AI 結果。");
    expect(resources["en-US"].progress.worker.ai_generation_running).toBe(
      "Generating AI results.",
    );
  });

  test("provides the BYOK model-service copy in every locale", () => {
    const expectedKeys = [
      "navigation.models.label",
      "navigation.models.description",
      "models.heading",
      "models.description",
      "models.source.label",
      "models.source.managed",
      "models.source.byok",
      "models.source.managedDescription",
      "models.source.byokDescription",
      "models.byokNotice",
      "models.draftNotice",
      "models.securityNotice",
      "models.list.heading",
      "models.list.empty",
      "models.list.columnName",
      "models.list.columnProvider",
      "models.list.columnModel",
      "models.list.columnStatus",
      "models.list.active",
      "models.list.inactive",
      "models.list.edit",
      "models.list.delete",
      "models.list.activate",
      "models.add",
      "models.dialog.titleAdd",
      "models.dialog.titleEdit",
      "models.dialog.label",
      "models.dialog.provider",
      "models.dialog.baseUrl",
      "models.dialog.apiKey",
      "models.dialog.apiKeyPlaceholderNew",
      "models.dialog.apiKeyPlaceholderEdit",
      "models.dialog.model",
      "models.dialog.timeout",
      "models.dialog.test",
      "models.dialog.testing",
      "models.dialog.cancel",
      "models.dialog.save",
      "models.dialog.probeNotice",
      "models.dialog.probeSuccess",
      "models.dialog.probeFailure",
      "models.presets.deepseek",
      "models.presets.siliconflow",
      "models.presets.zhipu",
      "models.presets.moonshot",
      "models.presets.openai",
      "models.presets.custom",
      "models.notice.loadFailed",
      "models.notice.saved",
      "models.notice.saveFailed",
      "models.notice.deleteFailed",
      "models.notice.activateFailed",
      "models.notice.sourceFailed",
      "models.notice.probeFailed",
    ];

    for (const locale of SUPPORTED_LOCALES) {
      const settings = new Map(
        flatten(resources[locale].settings as Record<string, unknown>),
      );
      for (const key of expectedKeys) {
        expect(
          settings.get(key),
          `${locale}.settings.${key}`,
        ).toEqual(expect.any(String));
      }
    }
  });
});
