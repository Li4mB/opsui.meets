import * as Sentry from "@sentry/cloudflare";
import { recordAuthMetric } from "./lib/analytics";
import { getHealth } from "./routes/health";
import { issueJoinToken } from "./routes/join-token";
import { getRateLimitResponse } from "./lib/rate-limit";
import { clearSession, completeOidcAccount, handleOidcCallback, startOidcLogin } from "./routes/oidc";
import {
  getOrganisationProfile,
  loginWithPassword,
  signUpBusiness,
  signUpIndividual,
  signUpOrganisation,
} from "./routes/password-auth";
import { issueMockSession } from "./routes/session";
import { getSessionInfo } from "./routes/session-info";
import { getSentryOptions } from "./lib/sentry";
import type { Env } from "./types";
import { handleCorsPreflight, withCors } from "./lib/cors";

export default Sentry.withSentry<Env>((env) => getSentryOptions(env), {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const preflight = handleCorsPreflight(request);
    if (preflight) {
      return preflight;
    }

    let response: Response;

    if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/v1/health")) {
      response = getHealth(request, env);
      return withCors(response, request);
    }

    if (request.method === "POST" && url.pathname === "/v1/join-token") {
      const limited = getRateLimitResponse(request, {
        bucket: "join-token",
        limit: 30,
        windowMs: 60_000,
      });
      if (limited) {
        return withCors(limited, request);
      }
      response = await issueJoinToken(request, env);
      return withCors(response, request);
    }

    if (request.method === "POST" && url.pathname === "/v1/session/mock") {
      if (env.ALLOW_MOCK_AUTH !== "true") {
        return withCors(new Response("Not found", { status: 404 }), request);
      }
      const limited = getRateLimitResponse(request, {
        bucket: "session-mock",
        limit: 10,
        windowMs: 60_000,
      });
      if (limited) {
        return withCors(limited, request);
      }
      response = await issueMockSession(request, env);
      return withCors(response, request);
    }

    if (request.method === "POST" && url.pathname === "/v1/login/password") {
      const limited = getRateLimitResponse(request, {
        bucket: "password-login",
        limit: 20,
        windowMs: 60_000,
      });
      if (limited) {
        return withCors(limited, request);
      }
      response = await loginWithPassword(request, env);
      return withCors(response, request);
    }

    if (request.method === "POST" && url.pathname === "/v1/signup/individual") {
      const limited = getRateLimitResponse(request, {
        bucket: "signup-individual",
        limit: 10,
        windowMs: 60_000,
      });
      if (limited) {
        return withCors(limited, request);
      }
      response = await signUpIndividual(request, env);
      return withCors(response, request);
    }

    if (request.method === "POST" && url.pathname === "/v1/signup/organisation") {
      const limited = getRateLimitResponse(request, {
        bucket: "signup-organisation",
        limit: 10,
        windowMs: 60_000,
      });
      if (limited) {
        return withCors(limited, request);
      }
      response = await signUpOrganisation(request, env);
      return withCors(response, request);
    }

    if (request.method === "POST" && url.pathname === "/v1/signup/business") {
      const limited = getRateLimitResponse(request, {
        bucket: "signup-business",
        limit: 10,
        windowMs: 60_000,
      });
      if (limited) {
        return withCors(limited, request);
      }
      response = await signUpBusiness(request, env);
      return withCors(response, request);
    }

    if (request.method === "GET" && url.pathname === "/v1/login") {
      const limited = getRateLimitResponse(request, {
        bucket: "oidc-login",
        limit: 20,
        windowMs: 60_000,
      });
      if (limited) {
        return withCors(limited, request);
      }
      response = await startOidcLogin(request, env);
      return withCors(response, request);
    }

    if (request.method === "GET" && url.pathname === "/v1/callback") {
      const limited = getRateLimitResponse(request, {
        bucket: "oidc-callback",
        limit: 30,
        windowMs: 60_000,
      });
      if (limited) {
        return withCors(limited, request);
      }
      response = await handleOidcCallback(request, env);
      return withCors(response, request);
    }

    if (request.method === "POST" && url.pathname === "/v1/oidc/complete-account") {
      const limited = getRateLimitResponse(request, {
        bucket: "oidc-complete-account",
        limit: 20,
        windowMs: 60_000,
      });
      if (limited) {
        return withCors(limited, request);
      }
      response = await completeOidcAccount(request, env);
      return withCors(response, request);
    }

    if (request.method === "GET" && url.pathname === "/v1/session") {
      response = await getSessionInfo(request, env);
      return withCors(response, request);
    }

    if (request.method === "GET" && url.pathname === "/v1/organisation/me") {
      response = await getOrganisationProfile(request, env);
      return withCors(response, request);
    }

    if ((request.method === "GET" || request.method === "POST") && url.pathname === "/v1/logout") {
      response = clearSession(request, env);
      return withCors(response, request);
    }

    const notFoundResponse = new Response("Not found", { status: 404 });
    recordAuthMetric(env, {
      route: "not-found",
      status: notFoundResponse.status,
      request,
      outcome: "not_found",
    });
    return withCors(notFoundResponse, request);
  },
} satisfies ExportedHandler<Env>);
