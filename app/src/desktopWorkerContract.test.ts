import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { ASR_MODEL_DOWNLOAD_PROGRESS_EVENT } from "./settingsClient";
import { processVideo, WORKER_PROGRESS_EVENT } from "./workerClient";
import type { WorkerResult } from "./workflow";

type DesktopWorkerContract = {
  contractVersion: number;
  events: {
    workerProgress: string;
    asrModelDownloadProgress: string;
  };
  asr: {
    defaultModel: string;
  };
  processVideo: {
    serverManagedLlmCheckout: boolean;
    configurationOwner: string;
    ipcRequest: {
      type: "object";
      required: string[];
      properties: {
        url: { type: "string"; minLength: number };
      };
      additionalProperties: boolean;
    };
    workerRequest: {
      type: "object";
      required: string[];
      properties: {
        contract_version: { const: number };
        url: { type: "string"; minLength: number };
        asr_model: { type: "string"; enum: string[] };
      };
      additionalProperties: boolean;
    };
  };
  localMedia: {
    workerMode: string;
    mediaKinds: string[];
    extensionsByKind: Record<"video" | "audio", string[]>;
    frontendSelection: {
      type: "object";
      required: string[];
      properties: Record<string, unknown>;
      additionalProperties: boolean;
      constraints: Record<string, boolean>;
    };
    ipcRequest: {
      type: "object";
      required: string[];
      properties: Record<string, unknown>;
      additionalProperties: boolean;
    };
    workerRequest: {
      type: "object";
      required: string[];
      properties: Record<string, unknown>;
      additionalProperties: boolean;
      constraints: Record<string, boolean>;
    };
    errorCodes: string[];
    sensitiveContent: Record<
      "full_path" | "selection_token",
      { allowedOnlyIn: string[]; forbiddenFrom: string[] }
    >;
  };
  aiGeneration: {
    command: string;
    serverManagedLlmCheckout: boolean;
    request: {
      type: "object";
      required: string[];
      properties: {
        task_id: { type: "string" };
        target: { type: "string"; enum: string[] };
        output_language: { type: "string"; enum: string[] };
        preference_snapshot: { type: "object" };
      };
      additionalProperties: boolean;
      allOf: Array<{
        if: { required: string[] };
        then: { properties: { target: { const: string } } };
      }>;
    };
  };
  progressEvents: {
    invalidEventPolicy: {
      producer: string;
      consumer: string;
    };
    fieldSchemas: {
      stage: { type: "string"; enum: string[] };
      progress: { type: "integer"; minimum: number; maximum: number };
    };
    messageArgs: {
      type: "object";
      properties: {
        model: { type: "string"; enum: string[] };
        language: { type: "string"; minLength: number; maxLength: number; pattern: string };
        attempt: { type: "integer"; minimum: number; maximum: number };
        total: { type: "integer"; minimum: number; maximum: number };
      };
      additionalProperties: boolean;
      constraints: { attemptMustNotExceedTotal: boolean };
      forbiddenContent: string[];
    };
    worker: {
      requiredFields: string[];
      optionalFields: string[];
      messageCodes: Record<string, { allowedArgs: string[] }>;
    };
    asrModelDownload: {
      requiredFields: string[];
      optionalFields: string[];
      fieldSchemas: {
        status: { type: "string"; enum: string[] };
        current_file: {
          type: "string";
          minLength: number;
          maxLength: number;
          pattern: string;
        };
      };
      messageCodes: Record<
        string,
        { status: string; current_file: "required" | "forbidden"; allowedArgs: string[] }
      >;
    };
  };
  terminalResults: {
    stdout: {
      encoding: string;
      nonEmptyLineCount: number;
      diagnosticsChannel: string;
      invalidPayloadPolicy: string;
    };
    operations: Record<string, string>;
    safeErrorCode: {
      type: string;
      minLength: number;
      maxLength: number;
      pattern: string;
    };
    schemas: Record<string, unknown>;
  };
  insightResult: {
    schemaVersion: number;
    itemKeys: string[];
    preferenceSnapshotArtifact: string;
  };
};

function loadContract(): DesktopWorkerContract {
  return JSON.parse(
    readFileSync(new URL("../../contracts/desktop-worker-contract.json", import.meta.url), "utf-8"),
  ) as DesktopWorkerContract;
}

describe("desktop/worker contract", () => {
  test("uses strict desktop contract v4 while preserving process_video v3", () => {
    const contract = loadContract();

    expect(contract.contractVersion).toBe(4);
    expect(contract.processVideo.workerRequest.properties.contract_version.const).toBe(3);
  });

  test("keeps watchdog policy out of requests while accepting the fixed timeout codes", () => {
    const contract = loadContract();
    const propertyPaths: string[] = [];
    const visit = (value: unknown, path = "contract"): void => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return;
      }
      for (const [key, child] of Object.entries(value)) {
        const childPath = `${path}.${key}`;
        if (/timeout|deadline|watchdog/i.test(key)) {
          propertyPaths.push(childPath);
        }
        visit(child, childPath);
      }
    };
    visit(contract);

    expect(contract.contractVersion).toBe(4);
    expect(contract.processVideo.workerRequest.properties.contract_version.const).toBe(3);
    expect(contract.localMedia.workerRequest.properties.contract_version).toEqual({ const: 4 });
    expect(contract.processVideo.ipcRequest.required).toEqual(["url"]);
    expect(Object.keys(contract.processVideo.ipcRequest.properties)).toEqual(["url"]);
    expect(contract.processVideo.workerRequest.required).toEqual([
      "contract_version",
      "url",
      "asr_model",
    ]);
    expect(Object.keys(contract.processVideo.workerRequest.properties)).toEqual([
      "contract_version",
      "url",
      "asr_model",
    ]);
    expect(contract.aiGeneration.request.required).toEqual([
      "task_id",
      "target",
      "output_language",
    ]);
    expect(Object.keys(contract.aiGeneration.request.properties)).toEqual([
      "task_id",
      "target",
      "output_language",
      "preference_snapshot",
    ]);
    expect(propertyPaths).toEqual([]);

    const safeCodePattern = new RegExp(contract.terminalResults.safeErrorCode.pattern);
    for (const code of [
      "WORKER_IDLE_TIMEOUT",
      "WORKER_EXECUTION_TIMEOUT",
      "ASR_MODEL_DOWNLOAD_IDLE_TIMEOUT",
      "ASR_MODEL_DOWNLOAD_EXECUTION_TIMEOUT",
    ]) {
      expect(code).toMatch(safeCodePattern);
    }
  });

  test("declares the closed local-media source and transport boundary", () => {
    const localMedia = loadContract().localMedia;
    const allExtensions = [
      "mp4",
      "m4v",
      "mov",
      "mkv",
      "avi",
      "wmv",
      "webm",
      "mp3",
      "wav",
      "m4a",
      "aac",
      "flac",
      "ogg",
      "opus",
      "wma",
    ];

    expect(localMedia.workerMode).toBe("--process-local-media-stdin");
    expect(localMedia.mediaKinds).toEqual(["video", "audio"]);
    expect(localMedia.extensionsByKind).toEqual({
      video: ["mp4", "m4v", "mov", "mkv", "avi", "wmv", "webm"],
      audio: ["mp3", "wav", "m4a", "aac", "flac", "ogg", "opus", "wma"],
    });
    expect(localMedia.frontendSelection).toEqual({
      type: "object",
      required: ["selectionToken", "displayName", "mediaKind", "extension", "sizeBytes"],
      properties: {
        selectionToken: { type: "string", format: "uuid" },
        displayName: { type: "string", minLength: 1, maxLength: 160 },
        mediaKind: { type: "string", enum: ["video", "audio"] },
        extension: { type: "string", enum: allExtensions },
        sizeBytes: { type: "integer", minimum: 1 },
      },
      additionalProperties: false,
      constraints: {
        displayNameMustBeSafeBasename: true,
        displayNameExtensionMustMatch: true,
        extensionMustMatchMediaKind: true,
      },
    });
    expect(localMedia.ipcRequest).toEqual({
      type: "object",
      required: ["selectionToken"],
      properties: {
        selectionToken: { type: "string", format: "uuid" },
      },
      additionalProperties: false,
    });
    expect(localMedia.workerRequest).toEqual({
      type: "object",
      required: [
        "contract_version",
        "source_path",
        "media_kind",
        "safe_display_name",
        "source_extension",
        "asr_model",
      ],
      properties: {
        contract_version: { const: 4 },
        source_path: { type: "string", minLength: 1 },
        media_kind: { type: "string", enum: ["video", "audio"] },
        safe_display_name: { type: "string", minLength: 1, maxLength: 160 },
        source_extension: { type: "string", enum: allExtensions },
        asr_model: { type: "string", enum: ["iic/SenseVoiceSmall"] },
      },
      additionalProperties: false,
      constraints: {
        sourcePathMustBeAbsolute: true,
        sourcePathExtensionMustMatch: true,
        safeDisplayNameMustBeSafeBasename: true,
        safeDisplayNameExtensionMustMatch: true,
        extensionMustMatchMediaKind: true,
      },
    });
  });

  test("registers local progress, fixed errors, and path/token secrecy", () => {
    const contract = loadContract();
    const localMedia = contract.localMedia;

    expect(Object.keys(contract.progressEvents.worker.messageCodes)).toEqual(
      expect.arrayContaining([
        "local.media.validating",
        "local.video.copying",
        "local.audio.normalizing",
      ]),
    );
    expect(localMedia.errorCodes).toEqual([
      "LOCAL_MEDIA_SELECTION_INVALID",
      "LOCAL_MEDIA_SELECTION_CHANGED",
      "LOCAL_MEDIA_UNSUPPORTED_FORMAT",
      "LOCAL_MEDIA_UNAVAILABLE",
      "LOCAL_MEDIA_LINKED",
      "LOCAL_MEDIA_VALIDATION_FAILED",
      "LOCAL_MEDIA_KIND_MISMATCH",
      "LOCAL_VIDEO_STREAM_MISSING",
      "LOCAL_VIDEO_AUDIO_STREAM_MISSING",
      "LOCAL_AUDIO_STREAM_MISSING",
      "LOCAL_VIDEO_COPY_FAILED",
      "AUDIO_NORMALIZATION_FAILED",
    ]);
    expect(localMedia.sensitiveContent.full_path).toEqual({
      allowedOnlyIn: ["rust_selection_memory", "worker_stdin", "worker_memory"],
      forbiddenFrom: [
        "frontend",
        "ipc_request",
        "ipc_response",
        "argv",
        "environment",
        "worker_result",
        "progress",
        "error",
        "log",
        "manifest",
        "transcript",
        "ai_prompt",
        "cloud_request",
      ],
    });
    expect(localMedia.sensitiveContent.selection_token).toEqual({
      allowedOnlyIn: [
        "rust_selection_memory",
        "frontend",
        "ipc_request",
        "ipc_response",
      ],
      forbiddenFrom: [
        "worker_stdin",
        "argv",
        "environment",
        "worker_result",
        "progress",
        "error",
        "log",
        "manifest",
        "transcript",
        "ai_prompt",
        "cloud_request",
      ],
    });
  });

  test("declares closed operation-specific terminal result families", () => {
    const contract = loadContract();
    const terminal = contract.terminalResults;

    expect(terminal.stdout).toEqual({
      encoding: "utf-8",
      nonEmptyLineCount: 1,
      diagnosticsChannel: "stderr",
      invalidPayloadPolicy: "reject_without_echo",
    });
    expect(terminal.operations).toEqual({
      process_video: "task",
      retry_insights: "task",
      resolve_source_identity: "sourceIdentity",
      download_asr_model: "modelDownload",
    });
    expect(terminal.safeErrorCode).toEqual({
      type: "string",
      minLength: 1,
      maxLength: 64,
      pattern: "^[A-Z][A-Z0-9_]{0,63}$",
    });

    const task = terminal.schemas.task as {
      required: string[];
      properties: {
        status: { enum: string[] };
        artifacts: { properties: Record<string, unknown>; additionalProperties: boolean };
        insights: { items: { properties: Record<string, unknown>; additionalProperties: boolean } };
      };
      additionalProperties: boolean;
    };
    expect(task.required).toEqual([
      "status",
      "task_id",
      "task_dir",
      "artifacts",
      "text",
      "summary",
      "insights",
      "transcript",
      "error",
    ]);
    expect(task.properties.status.enum).toEqual([
      "completed",
      "partial_completed",
      "failed",
    ]);
    expect(Object.keys(task.properties.artifacts.properties)).toEqual([
      "video",
      "audio",
      "transcript_txt",
      "transcript_md",
      "segments",
      "summary",
      "mindmap",
      "insights",
      "insights_md",
      "preference_snapshot",
    ]);
    expect(task.properties.artifacts.additionalProperties).toBe(false);
    expect(Object.keys(task.properties.insights.items.properties)).toEqual([
      "id",
      "topic",
      "matchReason",
      "followUpQuestions",
      "suitableUse",
      "sourceChunkId",
    ]);
    expect(task.properties.insights.items.additionalProperties).toBe(false);
    expect(task.additionalProperties).toBe(false);
  });

  test("matches shared event names", () => {
    const contract = loadContract();

    expect(WORKER_PROGRESS_EVENT).toBe(contract.events.workerProgress);
    expect(ASR_MODEL_DOWNLOAD_PROGRESS_EVENT).toBe(contract.events.asrModelDownloadProgress);
  });

  test("declares separate minimal IPC and resolved worker requests", async () => {
    const contract = loadContract();
    const calls: Array<{ command: string; args: unknown }> = [];

    await processVideo("https://www.douyin.com/video/7524373044106677544", async (command, args) => {
      calls.push({ command, args });
      return {
        status: "completed",
        task_id: null,
        task_dir: null,
        artifacts: {},
        text: "",
        summary: "",
        insights: [],
        transcript: null,
        error: null,
      };
    });

    expect(calls[0]?.args).toEqual({
      request: {
        url: "https://www.douyin.com/video/7524373044106677544",
      },
    });
    expect(contract.processVideo).toEqual({
      serverManagedLlmCheckout: false,
      configurationOwner: "desktop_rust",
      ipcRequest: {
        type: "object",
        required: ["url"],
        properties: {
          url: { type: "string", minLength: 1 },
        },
        additionalProperties: false,
      },
      workerRequest: {
        type: "object",
        required: ["contract_version", "url", "asr_model"],
        properties: {
          contract_version: { const: 3 },
          url: { type: "string", minLength: 1 },
          asr_model: { type: "string", enum: [contract.asr.defaultModel] },
        },
        additionalProperties: false,
      },
    });
  });

  test("documents process_video as transcript-only and retry_insights as the AI path", async () => {
    const contract = loadContract();
    const calls: Array<{ command: string; args: unknown }> = [];

    await processVideo("https://www.douyin.com/video/7524373044106677544", async (command, args) => {
      calls.push({ command, args });
      return {
        status: "completed",
        task_id: null,
        task_dir: null,
        artifacts: {},
        text: "",
        summary: "",
        insights: [],
        transcript: null,
        error: null,
      };
    });

    expect(contract.processVideo).not.toHaveProperty("defaultGenerateInsights");
    expect(contract.processVideo.serverManagedLlmCheckout).toBe(false);
    expect(contract.aiGeneration.command).toBe("retry_insights");
    expect(contract.aiGeneration.serverManagedLlmCheckout).toBe(true);
    expect(calls[0]?.args).not.toHaveProperty("request.generate_insights");
  });

  test("declares a closed retry_insights request schema", () => {
    const request = loadContract().aiGeneration.request;

    expect(request).toEqual({
      type: "object",
      required: ["task_id", "target", "output_language"],
      properties: {
        task_id: { type: "string" },
        target: { type: "string", enum: ["summary", "insights"] },
        output_language: { type: "string", enum: ["zh-CN", "zh-TW", "en-US"] },
        preference_snapshot: { type: "object" },
      },
      additionalProperties: false,
      allOf: [
        {
          if: { required: ["preference_snapshot"] },
          then: { properties: { target: { const: "insights" } } },
        },
      ],
    });

    expect(new Set(request.required).size).toBe(request.required.length);
    expect(request.required.every((field) => field in request.properties)).toBe(true);
    expect(Object.keys(request.properties)).toEqual([
      ...request.required,
      "preference_snapshot",
    ]);
  });

  test("defines structured worker and model-download progress events", () => {
    const progress = loadContract().progressEvents;

    expect(progress.invalidEventPolicy).toEqual({
      producer: "reject",
      consumer: "drop_and_record_code",
    });
    expect(progress.fieldSchemas).toEqual({
      stage: {
        type: "string",
        enum: [
          "waiting_input",
          "video_extracting",
          "video_transcribing",
          "insights_generating",
          "completed",
          "partial_completed",
          "failed",
        ],
      },
      progress: { type: "integer", minimum: 0, maximum: 100 },
    });
    expect(progress.worker.requiredFields).toEqual(["stage", "progress", "message_code"]);
    expect(progress.worker.optionalFields).toEqual(["message_args"]);
    expect(progress.asrModelDownload.requiredFields).toEqual([
      "status",
      "progress",
      "message_code",
    ]);
    expect(progress.asrModelDownload.optionalFields).toEqual(["current_file", "message_args"]);
    expect(progress.asrModelDownload.fieldSchemas).toEqual({
      status: {
        type: "string",
        enum: ["started", "downloading", "extracting", "completed", "cancelled"],
      },
      current_file: {
        type: "string",
        minLength: 1,
        maxLength: 255,
        pattern:
          "^(?!\\.{1,2}$)(?=[A-Za-z0-9._+() -]{1,255}$)(?=.*[A-Za-z0-9])[A-Za-z0-9._+()-](?:[A-Za-z0-9._+() -]{0,253}[A-Za-z0-9_+()-])?$",
      },
    });
  });

  test("declares closed safe progress argument schemas", () => {
    const progress = loadContract().progressEvents;

    expect(progress.messageArgs).toEqual({
      type: "object",
      properties: {
        model: {
          type: "string",
          enum: [
            "iic/SenseVoiceSmall",
            "iic/speech_fsmn_vad_zh-cn-16k-common-pytorch",
          ],
        },
        language: {
          type: "string",
          minLength: 2,
          maxLength: 35,
          pattern: "^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$",
        },
        attempt: { type: "integer", minimum: 1, maximum: 100 },
        total: { type: "integer", minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
      constraints: { attemptMustNotExceedTotal: true },
      forbiddenContent: [
        "url",
        "full_path",
        "selection_token",
        "cookie",
        "credential",
        "transcript_content",
        "prompt",
        "generated_content",
        "request_headers",
        "preference_prose",
      ],
    });

    const languagePattern = new RegExp(progress.messageArgs.properties.language.pattern);
    expect(languagePattern.test("zh-Hans")).toBe(true);
    expect(languagePattern.test("en-US")).toBe(true);
    expect(languagePattern.test("zh_Hans")).toBe(false);
    expect(languagePattern.test("../../secret")).toBe(false);

    const currentFile = progress.asrModelDownload.fieldSchemas.current_file;
    const currentFilePattern = new RegExp(currentFile.pattern);
    for (const valid of [
      "model.pt",
      ".gitattributes",
      "configuration.json",
      "MODEL_VERSION.txt",
      "SenseVoice Small (v2)+fp16.bin",
    ]) {
      expect(currentFilePattern.test(valid)).toBe(true);
    }
    for (const invalid of [
      "",
      ".",
      "..",
      "dir/file",
      "dir\\file",
      "C:model.pt",
      "model.pt:stream",
      "bad\u0000name",
      "model\u00a0file.pt",
      "model\u0600file.pt",
      "model\u{1d173}file.pt",
      "model\u{e0001}file.pt",
      "model.pt.",
      "model.pt ",
    ]) {
      expect(currentFilePattern.test(invalid)).toBe(false);
    }

    const progressSchema = progress.fieldSchemas.progress;
    const acceptsProgress = (value: unknown) =>
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= progressSchema.minimum &&
      value <= progressSchema.maximum;
    expect([0, 50, 100].every(acceptsProgress)).toBe(true);
    expect([-1, 100.1, 101, true, "50"].some(acceptsProgress)).toBe(false);
    expect(progress.messageArgs.constraints.attemptMustNotExceedTotal).toBe(true);
    expect(2 <= 3).toBe(true);
    expect(3 <= 2).toBe(false);
  });

  test("registers every current progress message as a stable domain action state code", () => {
    const progress = loadContract().progressEvents;

    expect(Object.keys(progress.worker.messageCodes)).toEqual([
      "video.download.preparing",
      "video.stream.validating",
      "local.media.validating",
      "local.video.copying",
      "local.audio.normalizing",
      "audio.extract.running",
      "audio.extract.reused",
      "subtitle.detect.running",
      "subtitle.detect.found",
      "asr.cache.preparing",
      "asr.transcribe.starting",
      "asr.transcribe.running",
      "douyin.page.resolving",
      "douyin.stream.probing",
      "douyin.video.saving",
      "douyin.stream.retrying",
      "xiaohongshu.page.resolving",
      "xiaohongshu.video.saving",
      "xiaohongshu.stream.retrying",
      "bilibili.metadata.resolving",
      "bilibili.stream.probing",
      "bilibili.video.downloading",
      "bilibili.audio.downloading",
      "bilibili.media.merging",
    ]);
    expect(Object.keys(progress.asrModelDownload.messageCodes)).toEqual([
      "model.download.preparing",
      "model.download.completed",
      "model.download.cancelled",
      "model.primary.downloading",
      "model.vad.downloading",
      "model.archive.extracting",
      "model.archive.reading",
      "model.archive.downloading",
      "model.file.downloading",
      "model.file.completed",
    ]);

    const definitions = [
      ...Object.entries(progress.worker.messageCodes),
      ...Object.entries(progress.asrModelDownload.messageCodes),
    ];
    const argumentKeys = Object.keys(progress.messageArgs.properties ?? {});
    for (const [code, definition] of definitions) {
      expect(code).toMatch(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);
      expect(definition.allowedArgs.every((arg) => argumentKeys.includes(arg))).toBe(true);
    }

    expect(progress.asrModelDownload.messageCodes).toEqual({
      "model.download.preparing": {
        status: "started",
        current_file: "forbidden",
        allowedArgs: ["model"],
      },
      "model.download.completed": {
        status: "completed",
        current_file: "forbidden",
        allowedArgs: ["model"],
      },
      "model.download.cancelled": {
        status: "cancelled",
        current_file: "forbidden",
        allowedArgs: [],
      },
      "model.primary.downloading": {
        status: "downloading",
        current_file: "forbidden",
        allowedArgs: ["model"],
      },
      "model.vad.downloading": {
        status: "downloading",
        current_file: "forbidden",
        allowedArgs: ["model"],
      },
      "model.archive.extracting": {
        status: "extracting",
        current_file: "forbidden",
        allowedArgs: [],
      },
      "model.archive.reading": {
        status: "downloading",
        current_file: "forbidden",
        allowedArgs: [],
      },
      "model.archive.downloading": {
        status: "downloading",
        current_file: "forbidden",
        allowedArgs: [],
      },
      "model.file.downloading": {
        status: "downloading",
        current_file: "required",
        allowedArgs: [],
      },
      "model.file.completed": {
        status: "downloading",
        current_file: "required",
        allowedArgs: [],
      },
    });
    expect(progress.worker.messageCodes["subtitle.detect.found"]?.allowedArgs).toEqual([
      "language",
    ]);
    expect(progress.worker.messageCodes["asr.cache.preparing"]?.allowedArgs).toEqual(["model"]);
    expect(progress.worker.messageCodes["douyin.stream.retrying"]?.allowedArgs).toEqual([
      "attempt",
      "total",
    ]);

    const allowedStatuses = progress.asrModelDownload.fieldSchemas.status.enum;
    for (const [code, definition] of Object.entries(progress.asrModelDownload.messageCodes)) {
      expect(allowedStatuses).toContain(definition.status);
      expect(definition.current_file).toBe(code.startsWith("model.file.") ? "required" : "forbidden");
    }
  });

  test("matches the structured insight result item contract", () => {
    const contract = loadContract();
    const insight = {
      id: 1,
      topic: "topic",
      matchReason: "matched",
      followUpQuestions: ["next"],
      suitableUse: "content planning",
      sourceChunkId: 1,
    } satisfies WorkerResult["insights"][number];

    expect(contract.insightResult.schemaVersion).toBe(1);
    expect(Object.keys(insight).sort()).toEqual([...contract.insightResult.itemKeys].sort());
    expect(contract.insightResult.preferenceSnapshotArtifact).toBe("preference_snapshot");
  });
});
