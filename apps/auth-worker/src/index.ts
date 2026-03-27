import { recordAuthMetric } from "./lib/analytics";
import { getHealth } from "./routes/health";
import { issueJoinToken } from "./routes/join-token";
import { getRateLimitResponse } from "./lib/rate-limit";
import { clearSession, handleOidcCallback, startOidcLogin } from "./routes/oidc";
import { issueMockSession } from "./routes/session";
import { getSessionInfo } from "./routes/session-info";
import type { Env } from "./types";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/v1/health")) {
      return getHealth(request, env);
    }

    if (request.method === "POST" && url.pathname === "/v1/join-token") {
      const limited = getRateLimitResponse(request, {
        bucket: "join-token",
        limit: 30,
        windowMs: 60_000,
      });
      if (limited) {
        return limited;
      }
      return issueJoinToken(request, env);
    }

    if (request.method === "POST" && url.pathname === "/v1/session/mock") {
      if (env.ALLOW_MOCK_AUTH !== "true") {
        return new Response("Not found", { status: 404 });
      }
      const limited = getRateLimitResponse(request, {
        bucket: "session-mock",
        limit: 10,
        windowMs: 60_000,
      });
      if (limited) {
        return limited;
      }
      return issueMockSession(request, env);
    }

    if (request.method === "GET" && url.pathname === "/v1/login") {
      const limited = getRateLimitResponse(request, {
        bucket: "oidc-login",
        limit: 20,
        windowMs: 60_000,
      });
      if (limited) {
        return limited;
      }
      return startOidcLogin(request, env);
    }

    if (request.method === "GET" && url.pathname === "/v1/callback") {
      const limited = getRateLimitResponse(request, {
        bucket: "oidc-callback",
        limit: 30,
        windowMs: 60_000,
      });
      if (limited) {
        return limited;
      }
      return handleOidcCallback(request, env);
    }

    if (request.method === "GET" && url.pathname === "/v1/session") {
      return getSessionInfo(request, env);
    }

    if (request.method === "POST" && url.pathname === "/v1/logout") {
      return clearSession(request, env);
    }

    const notFoundResponse = new Response("Not found", { status: 404 });
    recordAuthMetric(env, {
      route: "not-found",
      status: notFoundResponse.status,
      request,
      outcome: "not_found",
    });
    return notFoundResponse;
  },
};
