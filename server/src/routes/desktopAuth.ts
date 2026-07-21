import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuthService } from "../auth.js";
import { renderLoginPage } from "../loginPage.js";
import { sha256 } from "../security.js";
import type { Store } from "../store.js";
import { emailStartSchema, emailVerifySchema } from "./authSchemas.js";
import { bearerToken, publicError } from "./shared.js";

const ticketExchangeSchema = z.object({
  ticket: z.string(),
  state: z.string(),
});

type DesktopAuthRouteDependencies = {
  store: Store;
  auth: AuthService;
  now: () => Date;
};

export function registerDesktopAuthRoutes(
  app: FastifyInstance,
  dependencies: DesktopAuthRouteDependencies,
): void {
  app.get("/login", async (_request, reply) => {
    reply.type("text/html; charset=utf-8");
    reply.header("cache-control", "no-store");
    return renderLoginPage();
  });

  app.post("/auth/email/start", async (request, reply) => {
    const parsed = emailStartSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_REQUEST" });
    }
    try {
      await dependencies.auth.startEmailLogin({
        email: parsed.data.email,
        state: parsed.data.state,
        ip: request.ip,
      });
      return { ok: true };
    } catch (error) {
      return reply.code(400).send({ error: publicError(error) });
    }
  });

  app.post("/auth/email/verify", async (request, reply) => {
    const parsed = emailVerifySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_REQUEST" });
    }
    try {
      const result = await dependencies.auth.verifyEmailCode(parsed.data);
      return {
        ticket: result.ticket,
        redirect_url: result.redirectUrl,
      };
    } catch (error) {
      return reply.code(400).send({ error: publicError(error) });
    }
  });

  app.post("/api/desktop/sessions/exchange", async (request, reply) => {
    const parsed = ticketExchangeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_REQUEST" });
    }
    try {
      const result = await dependencies.auth.exchangeDesktopTicket(parsed.data);
      return {
        session_token: result.sessionToken,
        email: result.email,
        expires_at: result.expiresAt.toISOString(),
      };
    } catch (error) {
      return reply.code(400).send({ error: publicError(error) });
    }
  });

  app.post("/api/desktop/logout", async (request) => {
    const token = bearerToken(request.headers.authorization);
    if (token) {
      await dependencies.store.revokeSession(sha256(token), dependencies.now());
    }
    return { ok: true };
  });
}
