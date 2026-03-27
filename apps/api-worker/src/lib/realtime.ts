import type { RealtimeRoomStatePatch } from "@opsui/shared-types";
import type { Env } from "../types";

export async function syncRealtimeRoomState(
  env: Env,
  meetingInstanceId: string,
  patch: Omit<RealtimeRoomStatePatch, "meetingInstanceId">,
): Promise<void> {
  try {
    await env.REALTIME_SERVICE.fetch(`https://realtime.internal/v1/rooms/${meetingInstanceId}/state`, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        meetingInstanceId,
        ...patch,
      } satisfies RealtimeRoomStatePatch),
    });
  } catch {
    // Realtime state sync is best-effort; API writes remain authoritative.
  }
}
