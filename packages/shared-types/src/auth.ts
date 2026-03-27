import type { LiveRole } from "./permissions";

export interface SessionActor {
  workspaceId: string;
  userId: string;
  email?: string;
  workspaceRole?: LiveRole;
  membershipSource?:
    | "mock"
    | "mock_directory_email"
    | "mock_directory_user"
    | "oidc_claim"
    | "oidc_domain"
    | "oidc_default"
    | "oidc_directory_email"
    | "oidc_directory_user";
}

export type SessionType = "user" | "guest";
export type AuthProvider = "anonymous" | "mock" | "oidc";

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
  sessionSigningConfigured: boolean;
  oidcConfigured: boolean;
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
