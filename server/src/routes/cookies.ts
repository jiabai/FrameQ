type CookieReply = {
  header(name: string, value: string | string[]): unknown;
  getHeader(name: string): unknown;
};

export function parseCookies(cookieHeader: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of cookieHeader?.split(";") ?? []) {
    const [name, ...rest] = part.trim().split("=");
    if (!name || rest.length === 0) {
      continue;
    }
    cookies.set(name, decodeURIComponent(rest.join("=")));
  }
  return cookies;
}

export function setCookie(
  reply: CookieReply,
  name: string,
  value: string,
  options: { httpOnly: boolean; maxAgeSeconds: number; secure: boolean },
): void {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${Math.floor(options.maxAgeSeconds)}`,
    "SameSite=Lax",
  ];
  if (options.httpOnly) {
    parts.push("HttpOnly");
  }
  if (options.secure) {
    parts.push("Secure");
  }
  const existing = reply.getHeader("set-cookie");
  const values = Array.isArray(existing)
    ? [...existing.map(String), parts.join("; ")]
    : existing
      ? [String(existing), parts.join("; ")]
      : [parts.join("; ")];
  reply.header("set-cookie", values);
}

export function clearCookie(
  reply: CookieReply,
  name: string,
  httpOnly: boolean,
  secure: boolean,
): void {
  setCookie(reply, name, "", { httpOnly, maxAgeSeconds: 0, secure });
}

export function firstHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}
