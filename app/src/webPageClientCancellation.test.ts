import { expect, test } from "vitest";
import { processWebPage, WebOperationCancelledError } from "./webPageClient";

test("a cancelled web submission rejects before it requires a native bridge", async () => {
  const cancellation = new AbortController();
  cancellation.abort();
  await expect(processWebPage(
    "https://example.com/", crypto.randomUUID(), () => {}, cancellation.signal,
  )).rejects.toBeInstanceOf(WebOperationCancelledError);
});
