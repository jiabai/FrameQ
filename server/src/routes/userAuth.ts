import type { FastifyInstance } from "fastify";
import { userSessionMaxAgeSeconds, type UserAuthService } from "../userAuth.js";
import { sha256 } from "../security.js";
import type { Store } from "../store.js";
import { emailStartSchema, emailVerifySchema } from "./authSchemas.js";
import { clearCookie, firstHeader, parseCookies, setCookie } from "./cookies.js";
import {
  isServerTemporarilyUnavailable,
  publicAuthError,
} from "./shared.js";

type UserAuthRouteStore = Pick<Store, "revokeUserSession">;

type UserAuthRouteDependencies = {
  store: UserAuthRouteStore;
  userAuth: UserAuthService;
  secureCookies: boolean;
  now: () => Date;
};

export function registerUserAuthRoutes(
  app: FastifyInstance,
  dependencies: UserAuthRouteDependencies,
): void {
  app.post("/user/auth/email/start", async (request, reply) => {
    const parsed = emailStartSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_REQUEST" });
    }
    try {
      await dependencies.userAuth.startEmailLogin({
        email: parsed.data.email,
        state: parsed.data.state,
        ip: request.ip,
      });
      return { ok: true };
    } catch (error) {
      if (isServerTemporarilyUnavailable(error)) {
        return reply.code(503).send({ error: "SERVER_TEMPORARILY_UNAVAILABLE" });
      }
      const publicMessage = publicAuthError(error);
      return publicMessage
        ? reply.code(400).send({ error: publicMessage })
        : reply.code(500).send({ error: "INTERNAL_SERVER_ERROR" });
    }
  });

  app.post("/user/auth/email/verify", async (request, reply) => {
    const parsed = emailVerifySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_REQUEST" });
    }
    try {
      const result = await dependencies.userAuth.verifyEmailCode(parsed.data);
      setCookie(reply, "frameq_user_session", result.sessionToken, {
        httpOnly: true,
        maxAgeSeconds: userSessionMaxAgeSeconds,
        secure: dependencies.secureCookies,
      });
      setCookie(reply, "frameq_user_csrf", result.csrfToken, {
        httpOnly: false,
        maxAgeSeconds: userSessionMaxAgeSeconds,
        secure: dependencies.secureCookies,
      });
      return { ok: true, redirect_url: "/dashboard" };
    } catch (error) {
      if (isServerTemporarilyUnavailable(error)) {
        return reply.code(503).send({ error: "SERVER_TEMPORARILY_UNAVAILABLE" });
      }
      const publicMessage = publicAuthError(error);
      if (publicMessage) {
        return reply.code(400).send({ error: publicMessage });
      }
      request.log.error(
        {
          event: "user.auth.verify.unhandled_error",
          err: error,
        },
        "Unhandled error during user email verification",
      );
      return reply.code(500).send({ error: "INTERNAL_SERVER_ERROR" });
    }
  });

  app.post("/user/auth/logout", async (request, reply) => {
    const cookies = parseCookies(request.headers.cookie);
    const sessionToken = cookies.get("frameq_user_session") ?? null;
    const session = await dependencies.userAuth.authenticate(sessionToken);
    if (!session || !sessionToken) {
      return reply.code(401).send({ error: "AUTH_REQUIRED" });
    }
    const csrfToken = firstHeader(request.headers["x-frameq-csrf"]);
    if (!dependencies.userAuth.validateCsrf(session, csrfToken)) {
      return reply.code(403).send({ error: "CSRF_INVALID" });
    }
    await dependencies.store.revokeUserSession(sha256(sessionToken), dependencies.now());
    clearCookie(reply, "frameq_user_session", true, dependencies.secureCookies);
    clearCookie(reply, "frameq_user_csrf", false, dependencies.secureCookies);
    return { ok: true, redirect_url: "/login" };
  });
}
