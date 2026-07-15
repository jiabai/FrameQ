import { describe, expect, test } from "vitest";
import { extractSafeTechnicalDetails } from "./safeTechnicalDetails";

describe("safe technical details", () => {
  test("keeps only positively allowlisted diagnostic fields", () => {
    const details = extractSafeTechnicalDetails({
      errorCode: "VIDEO_DOWNLOAD_FAILED",
      stageCode: "video_extracting",
      message: [
        "BILIBILI_FFMPEG_MERGE_FAILED: FFmpeg and yt-dlp failed via ModelScope.",
        "HTTP status code: 502; exited with code 1; errno ETIMEDOUT.",
      ].join(" "),
    });

    expect(details).toEqual({
      errorCode: "VIDEO_DOWNLOAD_FAILED",
      stageCode: "video_extracting",
      reasonCode: "BILIBILI_FFMPEG_MERGE_FAILED",
      httpStatus: 502,
      exitCode: 1,
      errno: "ETIMEDOUT",
      tools: ["FFmpeg", "yt-dlp", "ModelScope"],
    });
  });

  test("never copies URLs, paths, credentials, prompts, transcripts, or arbitrary prose", () => {
    const secretValues = [
      "https://evil.example/private?api_key=sk-live-secret",
      "C:\\Users\\Alice\\private\\config.json",
      "/home/alice/private/transcript.txt",
      "session-cookie-secret",
      "credential-secret",
      "prompt-secret",
      "transcript-secret",
    ];
    const details = extractSafeTechnicalDetails({
      errorCode: "FUTURE_WORKER_FAILURE",
      stageCode: "insights_generating",
      message: [
        "YOUTUBE_LOGIN_REQUIRED: request failed.",
        secretValues[0],
        secretValues[1],
        secretValues[2],
        `Cookie: ${secretValues[3]}`,
        `credential=${secretValues[4]}`,
        `API key=${secretValues[4]}`,
        `prompt=${secretValues[5]}`,
        `transcript=${secretValues[6]}`,
      ].join(" "),
    });
    const serialized = JSON.stringify(details);

    expect(details).toEqual({
      errorCode: "FUTURE_WORKER_FAILURE",
      stageCode: "insights_generating",
      reasonCode: "YOUTUBE_LOGIN_REQUIRED",
    });
    for (const secret of secretValues) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).not.toContain("request failed");
  });

  test("rejects malformed diagnostic codes and unknown stages", () => {
    expect(
      extractSafeTechnicalDetails({
        errorCode: "error: /private/path",
        stageCode: "../../secrets",
        message: "nothing registered here",
      }),
    ).toEqual({});

    expect(
      extractSafeTechnicalDetails({
        errorCode: `A${"B".repeat(96)}`,
        stageCode: "FAILED",
      }),
    ).toEqual({});
  });

  test.each([
    ["LLM request failed with HTTP 400.", 400],
    ["upstream HTTP status code: 503", 503],
    ["response status code=429", 429],
    ["HTTP error 599", 599],
  ])("extracts an explicitly contextual HTTP status from %s", (message, status) => {
    expect(extractSafeTechnicalDetails({ message })).toEqual({ httpStatus: status });
  });

  test.each([
    "https://example.test/not-found/404",
    "request attempt 500 failed",
    "provider code 401",
    "HTTP 399",
    "HTTP 600",
    "exit status 500",
  ])("does not infer an HTTP status from %s", (message) => {
    expect(extractSafeTechnicalDetails({ message }).httpStatus).toBeUndefined();
  });

  test("extracts only bounded, explicitly contextual exit codes", () => {
    expect(extractSafeTechnicalDetails({ message: "FFmpeg exited with code 1." })).toMatchObject({
      exitCode: 1,
    });
    expect(extractSafeTechnicalDetails({ message: "worker exit status -9" })).toMatchObject({
      exitCode: -9,
    });
    expect(extractSafeTechnicalDetails({ message: "provider code 1" }).exitCode).toBeUndefined();
    expect(extractSafeTechnicalDetails({ message: "exit code 256" }).exitCode).toBeUndefined();
    expect(extractSafeTechnicalDetails({ message: "exit code -256" }).exitCode).toBeUndefined();
  });

  test("extracts only the fixed errno and tool allowlists", () => {
    for (const errno of ["ETIMEDOUT", "ECONNRESET", "ENOENT", "EACCES", "EPERM", "ENOSPC"]) {
      expect(extractSafeTechnicalDetails({ message: `errno ${errno}` }).errno).toBe(errno);
    }
    expect(extractSafeTechnicalDetails({ message: "errno EAUTH" }).errno).toBeUndefined();
    expect(extractSafeTechnicalDetails({ message: "prefixENOENTsuffix" }).errno).toBeUndefined();
    expect(extractSafeTechnicalDetails({ message: "ffmpegg yt-dlpx ModelScopeX" }).tools).toBeUndefined();
  });

  test("accepts registered reason codes only as a structured leading token", () => {
    expect(
      extractSafeTechnicalDetails({
        message: "DOUYIN_NO_PLAYABLE_STREAM: no stream was returned",
      }).reasonCode,
    ).toBe("DOUYIN_NO_PLAYABLE_STREAM");
    expect(
      extractSafeTechnicalDetails({
        message: "prompt says YOUTUBE_LOGIN_REQUIRED: but this is not a worker cause",
      }).reasonCode,
    ).toBeUndefined();
    expect(
      extractSafeTechnicalDetails({ message: "UNREGISTERED_PLATFORM_FAILURE: failed" }).reasonCode,
    ).toBeUndefined();
  });
});
