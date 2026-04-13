import type { LiveRole } from "./permissions";
import type { WorkspacePlanTier } from "./auth";

export interface OrganisationMember {
  userId: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  displayName: string;
  workspaceRole: LiveRole;
  membershipSource: string;
  joinedAt: string;
}

export interface OrganisationProfile {
  workspaceId: string;
  workspaceName: string;
  organizationCode: string;
  planTier: WorkspacePlanTier;
  opsuiLinked: boolean;
  opsuiBusinessId: string | null;
  members: OrganisationMember[];
}
