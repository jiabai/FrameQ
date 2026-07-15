import { describe, expect, test } from "vitest";

import {
  VIDEO_DOWNLOAD_REASON_MESSAGE_CODES,
  WORKER_ERROR_MESSAGE_CODES,
} from "../workerErrorCopy";
import { errorResources } from "./errorResources";
import { SUPPORTED_LOCALES } from "./locale";

function lookup(tree: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, segment) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    return (value as Record<string, unknown>)[segment];
  }, tree);
}

describe("localized worker error resources", () => {
  test("covers every registered presentation code in every locale", () => {
    const keys = new Set([
      "generic",
      ...Object.values(WORKER_ERROR_MESSAGE_CODES),
      ...Object.values(VIDEO_DOWNLOAD_REASON_MESSAGE_CODES),
    ]);

    for (const locale of SUPPORTED_LOCALES) {
      for (const key of keys) {
        expect(lookup(errorResources[locale], key), `${locale}: errors.${key}`).toEqual(
          expect.any(String),
        );
      }
    }
  });
});
