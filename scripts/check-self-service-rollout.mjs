#!/usr/bin/env node
//
// Check whether the self-service email activation code rollout has reached a
// given FrameQ server deployment.
//
// Why this exists: `FRAMEQ_SELF_SERVICE_ACTIVATION_ENABLED` and the deployment
// commit move independently, and an operator wants to confirm the route is
// deployed without holding a user session. What this script can and cannot
// prove was established by running the real server on the deployment host:
//
//   - `POST /api/desktop/activation-codes/request` authenticates BEFORE it
//     evaluates the feature flag (server/src/routes/desktopAccount.ts). An
//     unauthenticated caller therefore always gets `401 AUTH_REQUIRED` once the
//     route exists, whether the flag is on or off.
//   - `404 {"error":"FEATURE_NOT_AVAILABLE"}` is only reachable *after* a valid
//     session, so no anonymous probe can observe the flag state.
//
// The anonymous states it can distinguish are:
//
//   1. not deployed        - the route is absent; Fastify's built-in 404 answers
//                            `{"message":"Route POST:... not found", ...}`.
//   2. route registered    - the route exists and is auth-first
//                            (`401 {"error":"AUTH_REQUIRED"}`). Flag unknown.
//   3. feature disabled    - `404 {"error":"FEATURE_NOT_AVAILABLE"}`; only ever
//                            seen when the probe carries a valid session, so it
//                            is recognised but not producible by this script.
//
// Every probe is unauthenticated so this script can never request a real
// activation code, send email, or mutate server state. Unauthenticated calls
// are rejected by the auth-first guard before any handler body runs.
//
// To confirm the flag itself, run the authenticated smoke (request -> email ->
// redeem) with a test account, or read the flag on the host.
//
// Usage:
//   node scripts/check-self-service-rollout.mjs
//   node scripts/check-self-service-rollout.mjs --base-url https://frameq.8xf.pro
//
import { pathToFileURL } from "node:url";

export const DEFAULT_BASE_URL = "https://frameq.8xf.pro";

export const ROLLOUT_STATE = Object.freeze({
  NOT_DEPLOYED: "not_deployed",
  ROUTE_REGISTERED: "route_registered",
  FEATURE_DISABLED: "feature_disabled",
  UNKNOWN: "unknown",
});

const REQUEST_PATH = "/api/desktop/activation-codes/request";
const REDEEM_PATH = "/api/desktop/activation-codes/redeem";
const ACCOUNT_PATH = "/api/desktop/account";
const CONTROL_PATH = "/api/desktop/__rollout-probe-not-a-route";
const LOCALES = Object.freeze(["zh-CN", "zh-TW", "en-US"]);

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Recognize Fastify's built-in "route not found" body. FrameQ's own handlers
 * only ever return `{"error":"..."}`, so the presence of `message` plus
 * `error: "Not Found"` plus `statusCode` is a reliable signature.
 */
export function isRouteNotFoundBody(body) {
  return (
    isRecord(body) &&
    typeof body.message === "string" &&
    body.message.includes("not found") &&
    body.error === "Not Found" &&
    body.statusCode === 404
  );
}

/**
 * Map the activation-code request probe response onto a rollout state.
 */
export function classifyRequestProbe(response) {
  const { status, body } = response;

  if (status === 401 && isRecord(body) && body.error === "AUTH_REQUIRED") {
    return {
      state: ROLLOUT_STATE.ROUTE_REGISTERED,
      detail:
        "route is registered and auth-first; the feature flag is not observable without a session",
    };
  }

  if (status === 404 && isRecord(body) && body.error === "FEATURE_NOT_AVAILABLE") {
    return {
      state: ROLLOUT_STATE.FEATURE_DISABLED,
      detail:
        "route is registered, the session was accepted, and FRAMEQ_SELF_SERVICE_ACTIVATION_ENABLED is off",
    };
  }

  if (status === 404 && isRouteNotFoundBody(body)) {
    return {
      state: ROLLOUT_STATE.NOT_DEPLOYED,
      detail: "server build predates the self-service activation route",
    };
  }

  return {
    state: ROLLOUT_STATE.UNKNOWN,
    detail: `unexpected response: HTTP ${status} ${summarizeBody(body)}`,
  };
}

/**
 * Reject ambiguous targets so a typo cannot point the probes at a random host.
 */
export function assertUsableBaseUrl(rawBaseUrl) {
  const trimmed = String(rawBaseUrl ?? "").trim().replace(/\/+$/, "");
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid --base-url: ${rawBaseUrl}`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Unsupported --base-url protocol: ${parsed.protocol}`);
  }
  const isLoopback =
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "[::1]";
  if (parsed.protocol === "http:" && !isLoopback) {
    throw new Error(
      "Refusing to send probes over plain HTTP to a non-loopback host; use https.",
    );
  }
  return trimmed;
}

/**
 * Run one probe. Never attaches an Authorization header: every check relies on
 * the server's auth-first rejection, which happens before any side effect.
 */
export async function probe(fetchImpl, baseUrl, options) {
  const url = `${baseUrl}${options.path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: options.method,
      headers: options.body === undefined ? {} : { "content-type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: "manual",
      signal: controller.signal,
    });
    return { status: response.status, body: await readJsonBody(response) };
  } finally {
    clearTimeout(timer);
  }
}

export async function runRolloutChecks({ baseUrl, fetchImpl = fetch }) {
  const target = assertUsableBaseUrl(baseUrl);
  const checks = [];

  const record = (name, ok, detail) => {
    checks.push({ name, ok, detail });
    return ok;
  };

  const live = await probe(fetchImpl, target, { method: "GET", path: "/health/live" });
  record(
    "health/live returns 200",
    live.status === 200,
    `HTTP ${live.status} ${summarizeBody(live.body)}`,
  );

  const ready = await probe(fetchImpl, target, { method: "GET", path: "/health/ready" });
  record(
    "health/ready returns 200",
    ready.status === 200,
    `HTTP ${ready.status} ${summarizeBody(ready.body)}`,
  );

  // Control group: an invented route must produce Fastify's built-in 404, which
  // proves the classifier can tell "route absent" apart from a real 404 error.
  const control = await probe(fetchImpl, target, {
    method: "GET",
    path: CONTROL_PATH,
  });
  record(
    "control route is absent (classifier sanity check)",
    control.status === 404 && isRouteNotFoundBody(control.body),
    `HTTP ${control.status} ${summarizeBody(control.body)}`,
  );

  // Baseline: a route that predates self-service activation must already be
  // auth-first, so a 401 here confirms the probe path itself is sound.
  const account = await probe(fetchImpl, target, {
    method: "GET",
    path: ACCOUNT_PATH,
  });
  record(
    "GET /api/desktop/account is auth-first",
    account.status === 401 && isRecord(account.body) && account.body.error === "AUTH_REQUIRED",
    `HTTP ${account.status} ${summarizeBody(account.body)}`,
  );

  const redeem = await probe(fetchImpl, target, {
    method: "POST",
    path: REDEEM_PATH,
    body: { code: "FQ-AAAA-BBBB-CCCC-DDDD" },
  });
  record(
    "POST activation-codes/redeem is auth-first",
    redeem.status === 401 && isRecord(redeem.body) && redeem.body.error === "AUTH_REQUIRED",
    `HTTP ${redeem.status} ${summarizeBody(redeem.body)}`,
  );

  const requestProbe = await probe(fetchImpl, target, {
    method: "POST",
    path: REQUEST_PATH,
    body: { locale: LOCALES[0] },
  });
  const classification = classifyRequestProbe(requestProbe);
  record(
    "POST activation-codes/request classified",
    classification.state !== ROLLOUT_STATE.UNKNOWN,
    `HTTP ${requestProbe.status} ${summarizeBody(requestProbe.body)}`,
  );

  // Auth-first ordering: an unauthenticated call must be rejected even with a
  // malformed locale or an unknown field. Together these two probes prove the
  // response cannot leak whether the flag is on to an unauthenticated caller.
  const badLocale = await probe(fetchImpl, target, {
    method: "POST",
    path: REQUEST_PATH,
    body: { locale: "ja-JP" },
  });
  record(
    "request rejects unauthenticated calls before validating locale",
    badLocale.status === 401,
    `HTTP ${badLocale.status} ${summarizeBody(badLocale.body)}`,
  );

  const unknownField = await probe(fetchImpl, target, {
    method: "POST",
    path: REQUEST_PATH,
    body: { locale: LOCALES[0], email: "probe@example.com", quota: 999 },
  });
  record(
    "request rejects unauthenticated calls before validating extra fields",
    unknownField.status === 401,
    `HTTP ${unknownField.status} ${summarizeBody(unknownField.body)}`,
  );

  // The whole point of the two probes above is that they must be
  // indistinguishable from the well-formed one. Assert that explicitly.
  record(
    "flag state is not observable without a session",
    badLocale.status === requestProbe.status && unknownField.status === requestProbe.status,
    `well-formed/malformed/extra-field statuses: ${requestProbe.status}/${badLocale.status}/${unknownField.status}`,
  );

  const allChecksPassed = checks.every((entry) => entry.ok);
  const deployed =
    classification.state === ROLLOUT_STATE.ROUTE_REGISTERED ||
    classification.state === ROLLOUT_STATE.FEATURE_DISABLED;
  const exitCode = deployed && allChecksPassed ? 0 : 1;
  return {
    baseUrl: target,
    state: classification.state,
    detail: classification.detail,
    checks,
    exitCode,
  };
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonBody(response) {
  let text;
  try {
    text = await response.text();
  } catch {
    return null;
  }
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function summarizeBody(body) {
  if (body === null || body === undefined) {
    return "(empty body)";
  }
  const rendered = JSON.stringify(body);
  return rendered.length > 200 ? `${rendered.slice(0, 200)}...` : rendered;
}

function parseArgs(argv) {
  let baseUrl = process.env.FRAMEQ_ROLLOUT_BASE_URL ?? DEFAULT_BASE_URL;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base-url") {
      baseUrl = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg.startsWith("--base-url=")) {
      baseUrl = arg.slice("--base-url=".length);
      continue;
    }
    if (arg !== "--help") {
      throw new Error(`Unknown argument: ${arg}`);
    }
    return { help: true, baseUrl };
  }
  return { help: false, baseUrl };
}

function printHelp() {
  process.stdout.write(
    [
      "Check the self-service email activation code rollout state of a FrameQ server.",
      "",
      "Reports whether the activation-code route is deployed. The feature flag",
      "itself is NOT observable from an unauthenticated probe, because the route",
      "authenticates before it evaluates the flag.",
      "",
      "Usage:",
      "  node scripts/check-self-service-rollout.mjs [--base-url <url>]",
      "",
      "Options:",
      `  --base-url <url>   Target server (default: ${DEFAULT_BASE_URL},`,
      "                     or FRAMEQ_ROLLOUT_BASE_URL when set)",
      "",
      "Exit codes:",
      "  0  route is deployed and every check passed",
      "  1  route is not deployed yet, or a check failed",
      "",
    ].join("\n"),
  );
}

async function main() {
  const { help, baseUrl } = parseArgs(process.argv.slice(2));
  if (help) {
    printHelp();
    return 0;
  }

  const result = await runRolloutChecks({ baseUrl });

  process.stdout.write(`FrameQ self-service activation rollout check\n`);
  process.stdout.write(`  target: ${result.baseUrl}\n`);
  process.stdout.write(`  state : ${result.state} - ${result.detail}\n\n`);
  for (const check of result.checks) {
    process.stdout.write(`  [${check.ok ? "PASS" : "FAIL"}] ${check.name} (${check.detail})\n`);
  }
  process.stdout.write(`\nROLLOUT_STATE=${result.state}\n`);

  if (result.state === ROLLOUT_STATE.NOT_DEPLOYED) {
    process.stdout.write(
      "Next step: deploy the server build that contains the self-service activation route.\n",
    );
  } else if (result.state === ROLLOUT_STATE.ROUTE_REGISTERED) {
    process.stdout.write(
      "Next step: confirm the feature flag separately - the anonymous probe cannot see it.\n" +
        "  - read FRAMEQ_SELF_SERVICE_ACTIVATION_ENABLED on the host and confirm the service\n" +
        "    restarted healthy after it changed; or\n" +
        "  - run the authenticated smoke (request -> email -> redeem) with a test account.\n",
    );
  } else if (result.state === ROLLOUT_STATE.FEATURE_DISABLED) {
    process.stdout.write(
      "Next step: set FRAMEQ_SELF_SERVICE_ACTIVATION_ENABLED=true and restart frameq-server.\n",
    );
  }

  return result.exitCode;
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
