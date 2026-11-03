import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { parseWorkerProgressEvent, WORKER_PROGRESS_EVENT } from "./desktopWorkerProtocol";
import { parseWorkerResult, parseCancelProcessResult } from "./workerResultProtocol";
import { normalizeWebPageInput } from "./webPageProtocol";
import type { WorkerProgressEvent, WorkerResult } from "./workflow";
import { IpcProtocolError } from "./tauriIpcProtocol";

export class WebOperationCancelledError extends Error {
  constructor() {
    super("WEB_CANCELLED");
    this.name = "WebOperationCancelledError";
  }
}

export async function processWebPage(
  url: string,
  operationId: string,
  onProgress: (event: WorkerProgressEvent) => void,
  signal?: AbortSignal,
  shouldStart?: () => boolean,
): Promise<WorkerResult> {
  if (!normalizeWebPageInput(url)) throw new IpcProtocolError("WEB_PAGE_REQUEST_INVALID");
  if (signal?.aborted || shouldStart?.() === false) throw new WebOperationCancelledError();
  let unlisten: (() => void) | null = null;
  let registered = false;
  let invoked = false;
  const cancellation: { pending: Promise<{ error?: unknown }> | null } = { pending: null };
  const cancel = () => {
    cancellation.pending ??= cancelWebPage(operationId).then(() => ({}), (error: unknown) => ({ error }));
  };
  try {
    unlisten = await listen(WORKER_PROGRESS_EVENT, (event) => {
      const progress = parseWorkerProgressEvent(event.payload);
      if (progress.kind !== "invalid") onProgress(progress.event);
    });
    if (signal?.aborted || shouldStart?.() === false) throw new WebOperationCancelledError();
    const request = { contract_version: 1, url, operation_id: operationId };
    const acknowledgement = await invoke("begin_web_page", { request });
    registered = true;
    if (acknowledgement !== null) throw new IpcProtocolError("WEB_PAGE_PROTOCOL_INVALID");
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted || shouldStart?.() === false) throw new WebOperationCancelledError();
    invoked = true;
    const result = parseWorkerResult(await invoke("process_web_page", { request }));
    if (!result || (result.status !== "failed" && result.source?.kind !== "web_page")) throw new IpcProtocolError("WEB_PAGE_PROTOCOL_INVALID");
    return result;
  } finally {
    signal?.removeEventListener("abort", cancel);
    try {
      if (registered && !invoked) cancel();
      const cancelled = await cancellation.pending;
      if (cancelled && "error" in cancelled) throw cancelled.error;
    }
    finally { unlisten?.(); }
  }
}

export async function cancelWebPage(operationId: string) {
  const result = parseCancelProcessResult(await invoke("cancel_web_page", { operationId }));
  if (!result) throw new IpcProtocolError("WEB_PAGE_PROTOCOL_INVALID");
  return result;
}
