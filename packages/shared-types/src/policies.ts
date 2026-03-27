import type { RoomPolicy } from "./rooms";

export interface PostMeetingHookConfig {
  enabled: boolean;
  deliveryMode: "manual" | "on_end";
  targetUrl: string;
  secret: string;
  hasSecret: boolean;
  includeAttendance: boolean;
  includeActionItems: boolean;
  includeRecording: boolean;
}

export interface WorkspacePolicy {
  workspaceId: string;
  defaultRoomPolicy: RoomPolicy;
  guestJoinMode: "open" | "restricted" | "disabled";
  recordingAccess: "owner_host_only" | "workspace_admins" | "disabled";
  postMeetingHook: PostMeetingHookConfig;
}

export interface UpdateWorkspacePolicyInput {
  guestJoinMode?: WorkspacePolicy["guestJoinMode"];
  recordingAccess?: WorkspacePolicy["recordingAccess"];
  chatMode?: RoomPolicy["chatMode"];
  screenShareMode?: RoomPolicy["screenShareMode"];
  mutedOnEntry?: boolean;
  lobbyEnabled?: boolean;
  postMeetingHookEnabled?: boolean;
  postMeetingHookDeliveryMode?: PostMeetingHookConfig["deliveryMode"];
  postMeetingHookTargetUrl?: string;
  postMeetingHookSecret?: string;
  postMeetingHookClearSecret?: boolean;
  postMeetingHookIncludeAttendance?: boolean;
  postMeetingHookIncludeActionItems?: boolean;
  postMeetingHookIncludeRecording?: boolean;
}
