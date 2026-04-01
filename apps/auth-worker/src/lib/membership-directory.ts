import type { AuthProvider, LiveRole } from "@opsui/shared-types";
import { LIVE_ROLES } from "@opsui/shared-types";
import type { Env } from "../types";

interface MembershipDirectoryRecord {
  userId?: string;
  email?: string;
  workspaceId: string;
  workspaceRole?: LiveRole;
  providers?: AuthProvider[];
}

interface MembershipDirectory {
  users: MembershipDirectoryRecord[];
}

export interface DirectoryMembershipResolution {
  workspaceId: string;
  workspaceRole: LiveRole;
  membershipSource:
    | "mock_directory_email"
    | "mock_directory_user"
    | "oidc_directory_email"
    | "oidc_directory_user";
  email?: string;
  userId?: string;
}

export function isMembershipDirectoryConfigured(env: Env): boolean {
  return getMembershipDirectory(env).users.length > 0;
}

export function isMembershipDirectoryEnforced(env: Env): boolean {
  if (env.AUTH_ENFORCE_MEMBERSHIP_DIRECTORY === "true") {
    return true;
  }

  if (env.AUTH_ENFORCE_MEMBERSHIP_DIRECTORY === "false") {
    return false;
  }

  return (env.APP_ENV ?? "production") === "production";
}

export function resolveMembershipDirectoryEntry(
  input: {
    provider: Extract<AuthProvider, "mock" | "oidc">;
    userId?: string;
    email?: string;
  },
  env: Env,
): DirectoryMembershipResolution | null {
  const directory = getMembershipDirectory(env);
  if (!directory.users.length) {
    return null;
  }

  const normalizedUserId = input.userId?.trim();
  const normalizedEmail = input.email?.trim().toLowerCase();

  if (normalizedUserId) {
    const byUserId = directory.users.find(
      (entry) => entry.userId === normalizedUserId && providerAllowed(entry, input.provider),
    );
    if (byUserId) {
      return {
        workspaceId: byUserId.workspaceId,
        workspaceRole: byUserId.workspaceRole ?? "participant",
        membershipSource: input.provider === "mock" ? "mock_directory_user" : "oidc_directory_user",
        email: byUserId.email,
        userId: byUserId.userId,
      };
    }
  }

  if (normalizedEmail) {
    const byEmail = directory.users.find(
      (entry) => entry.email === normalizedEmail && providerAllowed(entry, input.provider),
    );
    if (byEmail) {
      return {
        workspaceId: byEmail.workspaceId,
        workspaceRole: byEmail.workspaceRole ?? "participant",
        membershipSource: input.provider === "mock" ? "mock_directory_email" : "oidc_directory_email",
        email: byEmail.email,
        userId: byEmail.userId,
      };
    }
  }

  return null;
}

function getMembershipDirectory(env: Env): MembershipDirectory {
  const raw = normalizeJsonInput(env.AUTH_MEMBERSHIP_DIRECTORY_JSON);
  if (!raw) {
    return { users: [] };
  }

  try {
    const parsed = typeof raw === "string" ? (JSON.parse(raw) as { users?: unknown }) : (raw as { users?: unknown });
    const users = Array.isArray(parsed.users)
      ? parsed.users.flatMap((value) => normalizeRecord(value))
      : [];
    return { users };
  } catch {
    return { users: [] };
  }
}

function normalizeJsonInput(value: unknown): string | Record<string, unknown> | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }

  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }

  return null;
}

function normalizeRecord(value: unknown): MembershipDirectoryRecord[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const workspaceId = typeof record.workspaceId === "string" ? record.workspaceId.trim() : "";
  if (!workspaceId) {
    return [];
  }

  const normalizedProviders = normalizeProviders(record.providers);
  const workspaceRole = normalizeLiveRole(record.workspaceRole);
  const userId = typeof record.userId === "string" && record.userId.trim() ? record.userId.trim() : undefined;
  const email =
    typeof record.email === "string" && record.email.trim()
      ? record.email.trim().toLowerCase()
      : undefined;

  if (!userId && !email) {
    return [];
  }

  return [
    {
      workspaceId,
      workspaceRole,
      providers: normalizedProviders,
      userId,
      email,
    },
  ];
}

function normalizeProviders(value: unknown): AuthProvider[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const providers = value.flatMap((item) => {
    if (item === "mock" || item === "oidc") {
      return [item];
    }

    return [];
  });

  return providers.length ? providers : undefined;
}

function providerAllowed(entry: MembershipDirectoryRecord, provider: Extract<AuthProvider, "mock" | "oidc">): boolean {
  return !entry.providers?.length || entry.providers.includes(provider);
}

function normalizeLiveRole(value: unknown): LiveRole | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return LIVE_ROLES.includes(normalized as LiveRole) ? (normalized as LiveRole) : undefined;
}
