import type { UpdateWorkspacePolicyInput, WorkspacePolicy } from "@opsui/shared-types";
import { getMemoryStore, type MemoryStoreAccessor } from "../store";

export class PoliciesRepository {
  constructor(private readonly getStore: MemoryStoreAccessor = getMemoryStore) {}

  getWorkspacePolicy(workspaceId: string): WorkspacePolicy | null {
    return this.getStore().workspacePolicies.find((policy) => policy.workspaceId === workspaceId) ?? null;
  }

  updateWorkspacePolicy(workspaceId: string, input: UpdateWorkspacePolicyInput): WorkspacePolicy | null {
    const store = this.getStore();
    const existingIndex = store.workspacePolicies.findIndex((policy) => policy.workspaceId === workspaceId);
    if (existingIndex < 0) {
      return null;
    }

    const existing = store.workspacePolicies[existingIndex];
    const nextHookSecret =
      input.postMeetingHookClearSecret
        ? ""
        : input.postMeetingHookSecret ?? existing.postMeetingHook.secret;

    const nextPolicy: WorkspacePolicy = {
      ...existing,
      guestJoinMode: input.guestJoinMode ?? existing.guestJoinMode,
      recordingAccess: input.recordingAccess ?? existing.recordingAccess,
      postMeetingHook: {
        ...existing.postMeetingHook,
        enabled: input.postMeetingHookEnabled ?? existing.postMeetingHook.enabled,
        deliveryMode:
          input.postMeetingHookDeliveryMode ?? existing.postMeetingHook.deliveryMode,
        targetUrl:
          input.postMeetingHookTargetUrl ?? existing.postMeetingHook.targetUrl,
        secret: nextHookSecret,
        hasSecret: Boolean(nextHookSecret.trim()),
        includeAttendance:
          input.postMeetingHookIncludeAttendance ??
          existing.postMeetingHook.includeAttendance,
        includeActionItems:
          input.postMeetingHookIncludeActionItems ??
          existing.postMeetingHook.includeActionItems,
        includeRecording:
          input.postMeetingHookIncludeRecording ??
          existing.postMeetingHook.includeRecording,
      },
      defaultRoomPolicy: {
        ...existing.defaultRoomPolicy,
        chatMode: input.chatMode ?? existing.defaultRoomPolicy.chatMode,
        screenShareMode:
          input.screenShareMode ?? existing.defaultRoomPolicy.screenShareMode,
        mutedOnEntry: input.mutedOnEntry ?? existing.defaultRoomPolicy.mutedOnEntry,
        lobbyEnabled: input.lobbyEnabled ?? existing.defaultRoomPolicy.lobbyEnabled,
      },
    };

    store.workspacePolicies[existingIndex] = nextPolicy;
    return nextPolicy;
  }
}
