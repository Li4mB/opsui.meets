export interface RoomPolicy {
  lobbyEnabled: boolean;
  allowGuestJoin: boolean;
  joinBeforeHost: boolean;
  mutedOnEntry: boolean;
  cameraOffOnEntry: boolean;
  lockAfterStart: boolean;
  chatMode: "open" | "host_only" | "moderated" | "disabled";
  screenShareMode: "hosts_only" | "presenters" | "everyone";
  recordingMode: "manual" | "auto_on_start" | "disabled";
}

export interface RoomSummary {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  roomType: "instant" | "scheduled" | "recurring" | "persistent";
  policy: RoomPolicy;
}
