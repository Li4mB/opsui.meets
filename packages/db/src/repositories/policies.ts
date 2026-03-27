import type { UpdateWorkspacePolicyInput, WorkspacePolicy } from "@opsui/shared-types";
import { getMemoryStore, type MemoryStoreAccessor } from "../store";

export class PoliciesRepository {
  constructor(private readonly getStore: MemoryStoreAccessor = getMemoryStore) {}

  getWorkspacePolicy(workspaceId: string): WorkspacePolicy | null {
    const policy = this.getStore().workspacePolicy;
    return policy.workspaceId === workspaceId ? policy : null;
  }

  updateWorkspacePolicy(workspaceId: string, input: UpdateWorkspacePolicyInput): WorkspacePolicy | null {
    const store = this.getStore();
    if (store.workspacePolicy.workspaceId !== workspaceId) {
      return null;
    }

    const nextHookSecret =
      input.postMeetingHookClearSecret
        ? ""
        : input.postMeetingHookSecret ?? store.workspacePolicy.postMeetingHook.secret;

    store.workspacePolicy = {
      ...store.workspacePolicy,
      guestJoinMode: input.guestJoinMode ?? store.workspacePolicy.guestJoinMode,
      recordingAccess: input.recordingAccess ?? store.workspacePolicy.recordingAccess,
      postMeetingHook: {
        ...store.workspacePolicy.postMeetingHook,
        enabled: input.postMeetingHookEnabled ?? store.workspacePolicy.postMeetingHook.enabled,
        deliveryMode:
          input.postMeetingHookDeliveryMode ?? store.workspacePolicy.postMeetingHook.deliveryMode,
        targetUrl:
          input.postMeetingHookTargetUrl ?? store.workspacePolicy.postMeetingHook.targetUrl,
        secret: nextHookSecret,
        hasSecret: Boolean(nextHookSecret.trim()),
        includeAttendance:
          input.postMeetingHookIncludeAttendance ??
          store.workspacePolicy.postMeetingHook.includeAttendance,
        includeActionItems:
          input.postMeetingHookIncludeActionItems ??
          store.workspacePolicy.postMeetingHook.includeActionItems,
        includeRecording:
          input.postMeetingHookIncludeRecording ??
          store.workspacePolicy.postMeetingHook.includeRecording,
      },
      defaultRoomPolicy: {
        ...store.workspacePolicy.defaultRoomPolicy,
        chatMode: input.chatMode ?? store.workspacePolicy.defaultRoomPolicy.chatMode,
        screenShareMode:
          input.screenShareMode ?? store.workspacePolicy.defaultRoomPolicy.screenShareMode,
        mutedOnEntry: input.mutedOnEntry ?? store.workspacePolicy.defaultRoomPolicy.mutedOnEntry,
        lobbyEnabled: input.lobbyEnabled ?? store.workspacePolicy.defaultRoomPolicy.lobbyEnabled,
      },
    };

    return store.workspacePolicy;
  }
}
