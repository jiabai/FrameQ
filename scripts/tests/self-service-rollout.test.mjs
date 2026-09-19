import assert from "node:assert/strict";
import test from "node:test";

import {
  ROLLOUT_STATE,
  assertUsableBaseUrl,
  classifyRequestProbe,
  isRouteNotFoundBody,
  runRolloutChecks,
} from "../check-self-service-rollout.mjs";

const BASE_URL = "https://frameq.example.test";

const AUTH_REQUIRED = { status: 401, body: { error: "AUTH_REQUIRED" } };
const FEATURE_NOT_AVAILABLE = { status: 404, body: { error: "FEATURE_NOT_AVAILABLE" } };
const ROUTE_NOT_FOUND = (method, path) => ({
  status: 404,
  body: {
    message: `Route ${method}:${path} not found`,
    error: "Not Found",
    statusCode: 404,
  },
});
const HEALTH_OK = { status: 200, body: { status: "live" } };

const REQUEST_PATH = "/api/desktop/activation-codes/request";
const REDEEM_PATH = "/api/desktop/activation-codes/redeem";
const ACCOUNT_PATH = "/api/desktop/account";
const CONTROL_PATH = "/api/desktop/__rollout-probe-not-a-route";

function createFetchStub(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    const path = new URL(url).pathname;
    const key = `${init.method} ${path}`;
    const entry = routes[key];
    if (entry === undefined) {
      throw new Error(`Unexpected probe: ${key}`);
    }
    const resolved = typeof entry === "function" ? entry(init) : entry;
    return {
      status: resolved.status,
      text: async () => (resolved.body === null ? "" : JSON.stringify(resolved.body)),
    };
  };
  return { fetchImpl, calls };
}

function deployedRoutes(requestResponse) {
  return {
    "GET /health/live": HEALTH_OK,
    "GET /health/ready": HEALTH_OK,
    [`GET ${CONTROL_PATH}`]: ROUTE_NOT_FOUND("GET", CONTROL_PATH),
    [`GET ${ACCOUNT_PATH}`]: AUTH_REQUIRED,
    [`POST ${REDEEM_PATH}`]: AUTH_REQUIRED,
    [`POST ${REQUEST_PATH}`]: requestResponse,
  };
}

test("classifies an auth-first 401 as route-registered, not as flag state", () => {
  const result = classifyRequestProbe({ status: 401, body: { error: "AUTH_REQUIRED" } });
  assert.equal(result.state, ROLLOUT_STATE.ROUTE_REGISTERED);
  // The anonymous probe must never claim to know the flag state.
  assert.match(result.detail, /not observable/);
});

test("classifies 404 FEATURE_NOT_AVAILABLE as deployed with the flag off", () => {
  const result = classifyRequestProbe(FEATURE_NOT_AVAILABLE);
  assert.equal(result.state, ROLLOUT_STATE.FEATURE_DISABLED);
});

test("classifies a bare Fastify 404 as not deployed", () => {
  const result = classifyRequestProbe(ROUTE_NOT_FOUND("POST", REQUEST_PATH));
  assert.equal(result.state, ROLLOUT_STATE.NOT_DEPLOYED);
});

test("classifies anything else as unknown", () => {
  for (const response of [
    { status: 500, body: { error: "INTERNAL_SERVER_ERROR" } },
    { status: 404, body: { error: "SOMETHING_ELSE" } },
    { status: 200, body: { status: "sent" } },
    { status: 502, body: null },
  ]) {
    assert.equal(classifyRequestProbe(response).state, ROLLOUT_STATE.UNKNOWN);
  }
});

test("route-not-found detection ignores FrameQ's own 404 bodies", () => {
  assert.equal(isRouteNotFoundBody(FEATURE_NOT_AVAILABLE.body), false);
  assert.equal(isRouteNotFoundBody({ error: "AUTH_REQUIRED" }), false);
  assert.equal(isRouteNotFoundBody(null), false);
  assert.equal(isRouteNotFoundBody("not found"), false);
  assert.equal(
    isRouteNotFoundBody({
      message: "Route POST:/x not found",
      error: "Not Found",
      statusCode: 404,
    }),
    true,
  );
});

test("only accepts https, plus http for loopback targets", () => {
  assert.equal(assertUsableBaseUrl("https://frameq.8xf.pro/"), "https://frameq.8xf.pro");
  assert.equal(assertUsableBaseUrl("http://127.0.0.1:8787"), "http://127.0.0.1:8787");
  assert.equal(assertUsableBaseUrl("http://localhost:8787/"), "http://localhost:8787");
  assert.throws(() => assertUsableBaseUrl("http://frameq.8xf.pro"), /plain HTTP/);
  assert.throws(() => assertUsableBaseUrl("frameq.8xf.pro"), /Invalid --base-url/);
  assert.throws(() => assertUsableBaseUrl("ftp://frameq.8xf.pro"), /Unsupported/);
});

test("reports a deployed route and exits zero when every check passes", async () => {
  const { fetchImpl, calls } = createFetchStub(deployedRoutes(AUTH_REQUIRED));
  const result = await runRolloutChecks({ baseUrl: BASE_URL, fetchImpl });

  assert.equal(result.state, ROLLOUT_STATE.ROUTE_REGISTERED);
  assert.equal(result.exitCode, 0);
  assert.ok(result.checks.every((check) => check.ok), JSON.stringify(result.checks));

  // No probe may carry credentials: the whole check relies on auth-first rejection.
  for (const call of calls) {
    assert.equal(call.headers.Authorization, undefined);
    assert.equal(call.headers.authorization, undefined);
  }
});

test("never claims to know the flag state from an anonymous probe", async () => {
  // Measured against the real server: a flag-off deployment and a flag-on
  // deployment both answer an unauthenticated request with 401 AUTH_REQUIRED.
  // The probe therefore must not report a state, check, or detail that asserts
  // the flag is enabled.
  const { fetchImpl } = createFetchStub(deployedRoutes(AUTH_REQUIRED));
  const result = await runRolloutChecks({ baseUrl: BASE_URL, fetchImpl });

  assert.equal(result.state, ROLLOUT_STATE.ROUTE_REGISTERED);
  const rendered = JSON.stringify(result);
  assert.doesNotMatch(rendered, /flag is (on|enabled)/i);
  assert.doesNotMatch(rendered, /"state":"live"/);

  const ordering = result.checks.find((check) =>
    check.name.includes("not observable without a session"),
  );
  assert.equal(ordering.ok, true);
});

test("reports not-deployed when only the control route 404s like Fastify", async () => {
  const routes = {
    "GET /health/live": HEALTH_OK,
    "GET /health/ready": HEALTH_OK,
    [`GET ${CONTROL_PATH}`]: ROUTE_NOT_FOUND("GET", CONTROL_PATH),
    [`GET ${ACCOUNT_PATH}`]: AUTH_REQUIRED,
    [`POST ${REDEEM_PATH}`]: AUTH_REQUIRED,
    [`POST ${REQUEST_PATH}`]: ROUTE_NOT_FOUND("POST", REQUEST_PATH),
  };
  const { fetchImpl } = createFetchStub(routes);
  const result = await runRolloutChecks({ baseUrl: BASE_URL, fetchImpl });

  assert.equal(result.state, ROLLOUT_STATE.NOT_DEPLOYED);
  assert.equal(result.exitCode, 1);
  const failed = result.checks.filter((check) => !check.ok).map((check) => check.name);
  // The classification check itself passes: "not deployed" is a known verdict.
  // Only the auth-first ordering checks fail, because there is no handler to
  // reject the call.
  assert.deepEqual(failed, [
    "request rejects unauthenticated calls before validating locale",
    "request rejects unauthenticated calls before validating extra fields",
  ]);
});

test("fails when the control route unexpectedly resolves", async () => {
  const routes = deployedRoutes(AUTH_REQUIRED);
  routes[`GET ${CONTROL_PATH}`] = { status: 200, body: { status: "ok" } };
  const { fetchImpl } = createFetchStub(routes);
  const result = await runRolloutChecks({ baseUrl: BASE_URL, fetchImpl });

  assert.equal(result.exitCode, 1);
  const control = result.checks.find((check) => check.name.includes("control route"));
  assert.equal(control.ok, false);
});

test("probes request with the closed locale set and rejects leaked fields", async () => {
  const { fetchImpl, calls } = createFetchStub(deployedRoutes(AUTH_REQUIRED));
  await runRolloutChecks({ baseUrl: BASE_URL, fetchImpl });

  const requestBodies = calls
    .filter((call) => new URL(call.url).pathname === REQUEST_PATH)
    .map((call) => JSON.parse(call.body));

  assert.equal(requestBodies.length, 3);
  assert.deepEqual(requestBodies[0], { locale: "zh-CN" });
  assert.deepEqual(requestBodies[1], { locale: "ja-JP" });
  assert.deepEqual(requestBodies[2], { locale: "zh-CN", email: "probe@example.com", quota: 999 });

  // Redeem must never carry a real-looking code that could collide with a live one.
  const redeemCall = calls.find((call) => new URL(call.url).pathname === REDEEM_PATH);
  assert.deepEqual(JSON.parse(redeemCall.body), { code: "FQ-AAAA-BBBB-CCCC-DDDD" });
});

test("fails when a health endpoint is down", async () => {
  const routes = deployedRoutes(AUTH_REQUIRED);
  routes["GET /health/ready"] = { status: 503, body: { error: "NOT_READY" } };
  const { fetchImpl } = createFetchStub(routes);
  const result = await runRolloutChecks({ baseUrl: BASE_URL, fetchImpl });

  assert.equal(result.exitCode, 1);
  const ready = result.checks.find((check) => check.name.includes("health/ready"));
  assert.equal(ready.ok, false);
});
