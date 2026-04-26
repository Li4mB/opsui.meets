import type { LiveRole } from "./permissions";

export type WorkspaceKind = "personal" | "organisation";
export type WorkspacePlanTier = "standard" | "super";

export type ProfileVisualMode = "color" | "image";

export interface ProfileVisualAsset {
  mode: ProfileVisualMode;
  color: string;
  imageDataUrl?: string;
  zoom: number;
}

export interface ProfileVisuals {
  avatar: ProfileVisualAsset;
  banner: ProfileVisualAsset;
}

export const PROFILE_VISUAL_COLOR_OPTIONS = [
  { label: "Slate", value: "#4A5568" },
  { label: "Steel blue", value: "#3D7EAA" },
  { label: "Muted teal", value: "#5A7A6E" },
  { label: "Dusty violet", value: "#7B6F8A" },
  { label: "Warm taupe", value: "#8A7060" },
  { label: "Charcoal", value: "#2C2C2C" },
] as const;

export const DEFAULT_PROFILE_VISUALS: ProfileVisuals = {
  avatar: {
    mode: "color",
    color: "#4A5568",
    zoom: 0,
  },
  banner: {
    mode: "color",
    color: "#2C2C2C",
    zoom: 0,
  },
};

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
  profileVisuals?: ProfileVisuals;
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
  dataMode?: "memory" | "postgres";
  databaseConfigured?: boolean;
  authStorageReady?: boolean;
  persistenceReason?: "memory_mode" | "postgres_ready" | "postgres_unconfigured";
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
