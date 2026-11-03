// SPDX-License-Identifier: MIT
import ipaddr from "ipaddr.js";

const numericIds = new Set(["id", "article_id", "post_id", "story_id"]);
const numericPages = new Set(["page", "p"]);
const reservedSuffixes = ["localhost", "local", "internal", "invalid", "test", "example", "onion", "home", "arpa"];

export function safeArticleUrl(value: string, base?: string): string {
  if (!value || value.length > 8192 || /[\u0000-\u0020\u007f]/u.test(value)) {
    throw new Error("article_extraction:invalid_url");
  }
  const url = base ? new URL(value, base) : new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || (url.port && !["80", "443"].includes(url.port))) {
    throw new Error("article_extraction:invalid_url");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (ipaddr.isValid(hostname)) {
    if (ipaddr.parse(hostname).range() !== "unicast") throw new Error("article_extraction:invalid_url");
  } else if (
    hostname.length > 253 || !hostname.includes(".") ||
    reservedSuffixes.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`)) ||
    hostname.split(".").some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
  ) {
    throw new Error("article_extraction:invalid_url");
  }
  url.hostname = hostname.includes(":") ? `[${hostname}]` : hostname;
  const allowed = new URLSearchParams();
  for (const [name, entry] of url.searchParams) {
    if (url.searchParams.getAll(name).length !== 1) continue;
    if ((numericIds.has(name) && /^[0-9]{1,20}$/.test(entry)) || (numericPages.has(name) && /^[1-9][0-9]{0,5}$/.test(entry))) {
      allowed.set(name, entry);
    }
  }
  allowed.sort();
  url.search = allowed.toString();
  url.hash = "";
  return url.href;
}

// Match parsed host/path only; a wildcard covers one nonempty path segment.
export function matchesSiteRule(source: URL, pattern: string): boolean {
  const slash = pattern.indexOf("/");
  const host = pattern.slice(0, slash).toLowerCase();
  if (source.hostname !== host && !source.hostname.endsWith(`.${host}`)) return false;
  const expected = pattern.slice(slash).split("/");
  const actual = source.pathname.split("/");
  return expected.every((segment, index) => {
    if (index >= actual.length) return false;
    if (segment === "*") return actual[index].length > 0;
    if (index === expected.length - 1 && segment === "") return true;
    return actual[index] === segment;
  });
}
