import type { LiveRole } from "./permissions";

export type WorkspaceKind = "personal" | "organisation";
export type WorkspacePlanTier = "standard" | "super";

export interface SessionActor {
  workspaceId: string;
  workspaceName: string;
  workspaceKind: WorkspaceKind;
  planTier: WorkspacePlanTier;
  userId: string;
  email?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  organizationCode?: string;
  workspaceRole?: LiveRole;
  membershipSource?:
    | "mock"
    | "mock_directory_email"
    | "mock_directory_user"
    | "password_individual"
    | "password_organisation_owner"
    | "password_organisation_member"
    | "opsui_organisation_owner"
    | "opsui_business_member"
    | "oidc_claim"
    | "oidc_domain"
    | "oidc_default"
    | "oidc_directory_email"
    | "oidc_directory_user";
}

export type SessionType = "user" | "guest";
export type AuthProvider = "anonymous" | "mock" | "oidc" | "password";

export interface SessionInfo {
  authenticated: boolean;
  sessionType: SessionType;
  actor: SessionActor;
  provider?: AuthProvider;
}

export interface AuthCapabilities {
  ok: boolean;
  service: string;
  appEnv: string;
  mockAuthEnabled: boolean;
  passwordAuthEnabled: boolean;
  signupEnabled: boolean;
  sessionSigningConfigured: boolean;
  oidcConfigured: boolean;
  opsuiValidationConfigured: boolean;
  membershipDirectoryConfigured: boolean;
  membershipEnforced: boolean;
  workspaceMappingConfigured: boolean;
  roleMappingConfigured: boolean;
  workspaceAllowlistConfigured: boolean;
  analyticsConfigured: boolean;
}

export interface JoinTokenClaims {
  sub: string;
  roomId: string;
  meetingInstanceId: string;
  displayName: string;
  exp: number;
}
