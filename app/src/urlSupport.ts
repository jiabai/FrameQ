const SUPPORTED_URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi;
const XIAOHONGSHU_NOTE_ID_PATTERN = /^[0-9a-f]{24}$/i;
const TRAILING_URL_PUNCTUATION_PATTERN = /[，。！？；：、,.;:!?）)\]}]+$/u;
const XIAOHONGSHU_SHORT_HOSTS = new Set([
  "xhslink.com",
  "www.xhslink.com",
  "xhslink.cn",
  "www.xhslink.cn",
]);

export function canSubmitUrl(rawUrl: string): boolean {
  return normalizeSubmitUrl(rawUrl) !== null;
}

export function normalizeSubmitUrl(rawUrl: string): string | null {
  const input = rawUrl.trim();
  if (XIAOHONGSHU_NOTE_ID_PATTERN.test(input)) {
    return input;
  }

  const candidates = looksLikeUrl(input) ? [input] : extractSupportedUrls(input);
  return candidates.find(canSubmitSingleUrl) ?? null;
}

function canSubmitSingleUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase();
    if (!["http:", "https:"].includes(url.protocol.toLowerCase())) {
      return false;
    }

    const normalizedPath = url.pathname.replace(/\/+$/, "");
    if (isDouyinHost(hostname)) {
      return isDouyinSupportedUrl(url, hostname, normalizedPath);
    }

    return (
      isXiaohongshuShortLink(hostname, normalizedPath) ||
      isXiaohongshuNoteUrl(hostname, normalizedPath) ||
      isBilibiliShortLink(hostname, normalizedPath) ||
      isBilibiliVideoUrl(hostname, normalizedPath) ||
      isYoutubeShortLink(hostname, normalizedPath) ||
      isYoutubeVideoUrl(url, hostname, normalizedPath)
    );
  } catch {
    return false;
  }
}

function looksLikeUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

function extractSupportedUrls(value: string): string[] {
  return Array.from(value.matchAll(SUPPORTED_URL_PATTERN), (match) =>
    trimUrlCandidate(match[0]),
  );
}

function trimUrlCandidate(value: string): string {
  return value.trim().replace(TRAILING_URL_PUNCTUATION_PATTERN, "");
}

function isDouyinHost(hostname: string): boolean {
  return hostname === "douyin.com" || hostname.endsWith(".douyin.com");
}

function isDouyinSupportedUrl(url: URL, hostname: string, normalizedPath: string): boolean {
  if (/^\/(?:video|note)\/\d+$/.test(normalizedPath)) {
    return true;
  }
  if (/^\/share\/slides\/\d+$/.test(normalizedPath)) {
    return true;
  }
  if (hasNumericSearchParam(url, ["modal_id", "aweme_id"])) {
    return true;
  }

  const shortCode = normalizedPath.split("/").filter(Boolean);
  return (
    hostname === "v.douyin.com" &&
    shortCode.length === 1 &&
    /^[A-Za-z0-9_-]+$/.test(shortCode[0])
  );
}

function hasNumericSearchParam(url: URL, names: string[]): boolean {
  return names.some((name) => /^\d+$/.test(url.searchParams.get(name) ?? ""));
}

function isXiaohongshuShortLink(hostname: string, normalizedPath: string): boolean {
  if (!XIAOHONGSHU_SHORT_HOSTS.has(hostname)) {
    return false;
  }
  const segments = normalizedPath.split("/").filter(Boolean);
  return segments.length > 0 && !(segments.length === 1 && segments[0] === "o");
}

function isXiaohongshuNoteUrl(hostname: string, normalizedPath: string): boolean {
  if (!isXiaohongshuHost(hostname)) {
    return false;
  }
  return /(?:^|\/)[0-9a-f]{24}(?:$|\/)/i.test(normalizedPath);
}

function isXiaohongshuHost(hostname: string): boolean {
  return hostname === "xiaohongshu.com" || hostname.endsWith(".xiaohongshu.com");
}

function isBilibiliShortLink(hostname: string, normalizedPath: string): boolean {
  if (hostname !== "b23.tv" && hostname !== "www.b23.tv") {
    return false;
  }
  return normalizedPath.split("/").filter(Boolean).length > 0;
}

function isBilibiliVideoUrl(hostname: string, normalizedPath: string): boolean {
  if (!isBilibiliHost(hostname)) {
    return false;
  }
  return /^\/video\/(?:BV[0-9A-Za-z]{10,}|av\d+)$/i.test(normalizedPath);
}

function isBilibiliHost(hostname: string): boolean {
  return hostname === "bilibili.com" || hostname.endsWith(".bilibili.com");
}

function isYoutubeShortLink(hostname: string, normalizedPath: string): boolean {
  if (hostname !== "youtu.be" && hostname !== "www.youtu.be") {
    return false;
  }

  const segments = normalizedPath.split("/").filter(Boolean);
  return segments.length === 1 && isYoutubeVideoId(segments[0]);
}

function isYoutubeVideoUrl(url: URL, hostname: string, normalizedPath: string): boolean {
  if (!isYoutubeHost(hostname)) {
    return false;
  }

  if (normalizedPath === "/watch") {
    return isYoutubeVideoId(url.searchParams.get("v") ?? "");
  }

  const segments = normalizedPath.split("/").filter(Boolean);
  return segments.length === 2 && segments[0] === "shorts" && isYoutubeVideoId(segments[1]);
}

function isYoutubeHost(hostname: string): boolean {
  return hostname === "youtube.com" || hostname === "www.youtube.com" || hostname === "m.youtube.com";
}

function isYoutubeVideoId(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
}
