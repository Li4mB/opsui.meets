import { createDefaultWorkspacePolicy, getMemoryStore, type MemoryStoreAccessor } from "../store";
import type { WorkspaceRecord } from "../types";

export class WorkspacesRepository {
  constructor(private readonly getStore: MemoryStoreAccessor = getMemoryStore) {}

  create(workspace: WorkspaceRecord): WorkspaceRecord {
    const store = this.getStore();
    store.workspaces.unshift(workspace);
    if (!store.workspacePolicies.some((policy) => policy.workspaceId === workspace.id)) {
      store.workspacePolicies.unshift(createDefaultWorkspacePolicy(workspace.id));
    }
    return workspace;
  }

  getById(id: string): WorkspaceRecord | null {
    return this.getStore().workspaces.find((workspace) => workspace.id === id) ?? null;
  }

  getBySlug(slug: string): WorkspaceRecord | null {
    return this.getStore().workspaces.find((workspace) => workspace.slug === slug) ?? null;
  }

  getByOrganizationCode(organizationCode: string): WorkspaceRecord | null {
    const normalizedCode = organizationCode.trim().toUpperCase();
    return (
      this.getStore().workspaces.find(
        (workspace) => workspace.organizationCode?.toUpperCase() === normalizedCode,
      ) ?? null
    );
  }

  getByNormalizedOrganizationName(organizationNameNormalized: string): WorkspaceRecord | null {
    const normalizedName = organizationNameNormalized.trim();
    return (
      this.getStore().workspaces.find(
        (workspace) =>
          workspace.workspaceKind === "organisation" &&
          workspace.organizationNameNormalized === normalizedName,
      ) ?? null
    );
  }

  getByOpsuiBusinessId(opsuiBusinessId: string): WorkspaceRecord | null {
    const normalizedId = opsuiBusinessId.trim();
    return this.getStore().workspaces.find((workspace) => workspace.opsuiBusinessId === normalizedId) ?? null;
  }
}
