import { describe, expect, test } from "vitest";

import { toFileManagerPath } from "./revealPath";

describe("file manager paths", () => {
  test.each([
    ["//?/D:/FrameQ/笔记/media/audio.wav", String.raw`\\?\D:\FrameQ\笔记\media\audio.wav`],
    ["//?/c:/FrameQ data/transcript/transcript.txt", String.raw`\\?\c:\FrameQ data\transcript\transcript.txt`],
    [String.raw`\\?\D:\FrameQ/media/video.mp4`, String.raw`\\?\D:\FrameQ\media\video.mp4`],
    ["//?/UNC/server/share/笔记/audio.wav", String.raw`\\?\UNC\server\share\笔记\audio.wav`],
    ["//?/unc/server/share/audio.wav", String.raw`\\?\unc\server\share\audio.wav`],
    [String.raw`\\?\UNC\server\share/notes/audio.wav`, String.raw`\\?\UNC\server\share\notes\audio.wav`],
  ])("preserves extended path semantics for %s", (path, expected) => {
    expect(toFileManagerPath(path)).toBe(expected);
  });

  test("preserves the complete extended path beyond the Windows legacy length", () => {
    const tail = `${"long folder/".repeat(30)}transcript.txt`;
    expect(toFileManagerPath(`//?/D:/${tail}`)).toBe(`\\\\?\\D:\\${tail.replace(/\//g, "\\")}`);
  });

  test.each([
    "D:/FrameQ/media/audio.wav",
    String.raw`D:\FrameQ\media\audio.wav`,
    "//server/share/media/audio.wav",
    String.raw`\\server\share\media\audio.wav`,
    String.raw`\\?\D:\FrameQ\media\audio.wav`,
    String.raw`\\?\UNC\server\share\media\audio.wav`,
    "/Users/aaron/FrameQ/audio.wav",
    "/home/aaron/FrameQ/audio.wav",
    "relative/media/audio.wav",
    "https://example.com/audio.wav",
    "//?/Volume{example}/audio.wav",
    "//./pipe/frameq",
    "",
  ])("leaves other path forms unchanged: %s", (path) => {
    expect(toFileManagerPath(path)).toBe(path);
  });
});
