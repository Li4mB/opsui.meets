import { APP_HOSTS } from "@opsui/config";

export interface Env {
  AUTH_SERVICE: Fetcher;
  API_SERVICE: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health" || url.pathname === "/v1/health") {
      return Response.json(
        { ok: true, service: "opsui-meets-gateway" },
        {
          headers: {
            "access-control-allow-origin": "*",
          },
        },
      );
    }

    if (url.pathname === "/join") {
      const room = url.searchParams.get("room");
      if (room) {
        const resolved = await resolveRoomAlias(env, room);
        return Response.redirect(`https://${APP_HOSTS.public}/${resolved.slug}`, 302);
      }

      return Response.redirect(`https://${APP_HOSTS.public}/`, 302);
    }

    if (url.pathname === "/new") {
      return Response.redirect(`https://${APP_HOSTS.public}/`, 302);
    }

    if (url.pathname === "/internal/auth-health") {
      return env.AUTH_SERVICE.fetch("https://auth.opsuimeets.com/v1/health");
    }

    if (request.method === "GET" || request.method === "HEAD") {
      const proxyUrl = new URL(`https://${APP_HOSTS.app}${url.pathname}${url.search}`);
      const proxyRequest = new Request(proxyUrl.toString(), request);
      return fetch(proxyRequest);
    }

    return new Response("Not found", { status: 404 });
  },
};

async function resolveRoomAlias(
  env: Env,
  slug: string,
): Promise<{ id: string; slug: string }> {
  try {
    const response = await env.API_SERVICE.fetch(
      `https://${APP_HOSTS.api}/v1/rooms/resolve/${encodeURIComponent(slug)}`,
      {
        headers: {
          "x-workspace-id": "workspace_local",
          "x-user-id": "user_local",
        },
      },
    );

    if (response.ok) {
      const payload = (await response.json()) as { id: string; slug: string };
      return payload;
    }
  } catch {}

  return {
    id: slug,
    slug,
  };
}
