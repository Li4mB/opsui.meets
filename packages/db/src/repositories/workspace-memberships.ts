import { getMemoryStore, type MemoryStoreAccessor } from "../store";
import type { WorkspaceMembershipRecord } from "../types";

export class WorkspaceMembershipsRepository {
  constructor(private readonly getStore: MemoryStoreAccessor = getMemoryStore) {}

  create(membership: WorkspaceMembershipRecord): WorkspaceMembershipRecord {
    this.getStore().workspaceMemberships.unshift(membership);
    return membership;
  }

  listByWorkspace(workspaceId: string): WorkspaceMembershipRecord[] {
    return this.getStore().workspaceMemberships.filter((membership) => membership.workspaceId === workspaceId);
  }

  listByUser(userId: string): WorkspaceMembershipRecord[] {
    return this.getStore().workspaceMemberships.filter((membership) => membership.userId === userId);
  }

  getByWorkspaceAndUser(workspaceId: string, userId: string): WorkspaceMembershipRecord | null {
    return (
      this.getStore().workspaceMemberships.find(
        (membership) => membership.workspaceId === workspaceId && membership.userId === userId,
      ) ?? null
    );
  }
}
