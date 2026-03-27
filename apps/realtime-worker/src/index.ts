import { RoomCoordinator } from "./durable/RoomCoordinator";

export { RoomCoordinator };

export interface Env {
  ROOM_COORDINATOR: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/v1/health")) {
      return Response.json(
        {
          ok: true,
          service: "opsui-meets-realtime",
          signalingReady: true,
          controlSyncReady: true,
        },
        {
          headers: {
            "access-control-allow-origin": "*",
          },
        },
      );
    }

    if (
      (request.method === "GET" || request.method === "POST") &&
      url.pathname.startsWith("/v1/rooms/")
    ) {
      const meetingInstanceId = url.pathname.split("/")[3];
      const id = env.ROOM_COORDINATOR.idFromName(meetingInstanceId);
      return env.ROOM_COORDINATOR.get(id).fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },
};
