import type { DashboardPayload } from "./api";

export function buildRoomMetrics(payload: DashboardPayload) {
  return [
    { label: "Room", value: payload.rooms[0]?.name ?? "No room" },
    { label: "Lobby", value: `${payload.summary.lobbyParticipants} waiting` },
    { label: "Hands", value: `${payload.summary.raisedHands} raised` },
    { label: "Live now", value: `${payload.summary.activeParticipants} active` },
  ];
}
