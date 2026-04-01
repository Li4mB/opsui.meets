import { verifyMediaControlRequest } from "@opsui/media-adapter";

interface Env {
  MEDIA_DOWNLOAD_BASE_URL?: string;
  MEDIA_UPLOAD_BASE_URL?: string;
  MEDIA_BACKEND_BASE_URL?: string;
  MEDIA_CONTROL_SHARED_SECRET?: string;
  MEDIA_CONTROL_SERVICE?: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health" || url.pathname === "/v1/health") {
      return Response.json({
        ok: true,
        service: "opsui-meets-media",
        downloadBaseConfigured: Boolean(env.MEDIA_DOWNLOAD_BASE_URL),
        uploadBaseConfigured: Boolean(env.MEDIA_UPLOAD_BASE_URL),
        controlBackendConfigured: Boolean(env.MEDIA_CONTROL_SERVICE || env.MEDIA_BACKEND_BASE_URL),
        internalControlServiceBound: Boolean(env.MEDIA_CONTROL_SERVICE),
        controlPlaneAuthConfigured: Boolean(env.MEDIA_CONTROL_SHARED_SECRET),
        controlPlaneReady: Boolean((env.MEDIA_CONTROL_SERVICE || env.MEDIA_BACKEND_BASE_URL) && env.MEDIA_CONTROL_SHARED_SECRET),
      }, {
        headers: {
          "access-control-allow-origin": "*",
        },
      });
    }

    if (request.method === "POST" && url.pathname === "/v1/control/sessions") {
      return handleControlRequest(request, env, "/sessions");
    }

    if (request.method === "POST" && url.pathname === "/v1/control/recordings/start") {
      return handleControlRequest(request, env, "/recordings/start");
    }

    if (request.method === "POST" && url.pathname === "/v1/control/recordings/stop") {
      return handleControlRequest(request, env, "/recordings/stop");
    }

    if (url.pathname.startsWith("/v1/downloads/")) {
      if (!env.MEDIA_DOWNLOAD_BASE_URL) {
        return Response.json(
          {
            ok: false,
            error: "media_download_not_configured",
            message: "Set MEDIA_DOWNLOAD_BASE_URL before enabling media downloads.",
          },
          { status: 501 },
        );
      }

      const objectPath = url.pathname.replace("/v1/downloads/", "");
      const downloadUrl = new URL(objectPath, ensureTrailingSlash(env.MEDIA_DOWNLOAD_BASE_URL)).toString();
      return Response.json({
        ok: true,
        path: objectPath,
        downloadUrl,
      });
    }

    if (url.pathname === "/v1/uploads/sign") {
      if (!env.MEDIA_UPLOAD_BASE_URL) {
        return Response.json(
          {
            ok: false,
            error: "media_upload_not_configured",
            message: "Set MEDIA_UPLOAD_BASE_URL before enabling media uploads.",
          },
          { status: 501 },
        );
      }

      const uploadId = crypto.randomUUID();
      const uploadUrl = new URL(uploadId, ensureTrailingSlash(env.MEDIA_UPLOAD_BASE_URL)).toString();
      return Response.json({
        ok: true,
        uploadId,
        uploadUrl,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });
    }

    return new Response("Not found", { status: 404 });
  },
};

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

async function handleControlRequest(request: Request, env: Env, backendPath: string): Promise<Response> {
  const body = await request.text();
  const verification = await verifyMediaControlRequest(
    request,
    body,
    env.MEDIA_CONTROL_SHARED_SECRET,
  );
  if (!verification.ok) {
    const status = verification.error === "media_control_auth_not_configured" ? 501 : 401;
    return Response.json(
      {
        ok: false,
        error: verification.error,
        message:
          verification.error === "media_control_auth_not_configured"
            ? "Set MEDIA_CONTROL_SHARED_SECRET before enabling media control operations."
            : "Media control request signature verification failed.",
      },
      { status },
    );
  }

  return proxyControlRequest(body, env, backendPath);
}

async function proxyControlRequest(body: string, env: Env, backendPath: string): Promise<Response> {
  if (!env.MEDIA_CONTROL_SERVICE && !env.MEDIA_BACKEND_BASE_URL) {
    return Response.json(
      {
        ok: false,
        error: "media_control_backend_not_configured",
        message: "Bind MEDIA_CONTROL_SERVICE or set MEDIA_BACKEND_BASE_URL before enabling media control operations.",
      },
      { status: 501 },
    );
  }

  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
  });
  if (env.MEDIA_CONTROL_SHARED_SECRET) {
    headers.set("x-opsui-media-secret", env.MEDIA_CONTROL_SHARED_SECRET);
  }

  const response = env.MEDIA_CONTROL_SERVICE
    ? await env.MEDIA_CONTROL_SERVICE.fetch(`https://media-control.internal${backendPath}`, {
        method: "POST",
        headers,
        body,
      })
    : await fetch(new URL(backendPath, ensureTrailingSlash(env.MEDIA_BACKEND_BASE_URL as string)), {
        method: "POST",
        headers,
        body,
      });

  return new Response(response.body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json; charset=utf-8",
    },
  });
}
