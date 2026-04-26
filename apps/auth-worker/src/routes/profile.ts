import type { RequestRepositoryContext, UserRecord } from "@opsui/db";
import {
  DEFAULT_PROFILE_VISUALS,
  PROFILE_VISUAL_COLOR_OPTIONS,
  type ProfileVisualAsset,
  type ProfileVisuals,
  type SessionActor,
} from "@opsui/shared-types";
import { normalizeEmail } from "../lib/account-identity";
import { recordAuthMetric } from "../lib/analytics";
import { getRepositories } from "../lib/data";
import { getAuthDataStatus } from "../lib/data-status";
import { json } from "../lib/http";
import { hydrateSessionActor } from "../lib/session-actors";
import { getSessionSigningSecret } from "../lib/session-config";
import { getCookieValue, SESSION_COOKIE_NAME, verifySessionClaims } from "../lib/session-cookie";
import type { Env } from "../types";

const MAX_PROFILE_IMAGE_DATA_URL_LENGTH = 7_000_000;
const PROFILE_IMAGE_DATA_URL_PATTERN = /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/;
const ALLOWED_COLORS: ReadonlySet<string> = new Set(
  PROFILE_VISUAL_COLOR_OPTIONS.map((option) => option.value),
);

interface ProfilePatchBody {
  profileVisuals?: unknown;
}

export async function getMyProfile(request: Request, env: Env): Promise<Response> {
  const authenticated = await getAuthenticatedActor(request, env, "profile-me");
  if (!authenticated.ok) {
    return authenticated.response;
  }

  const user = ensureUserRecord(authenticated.repositories, authenticated.actor);
  await authenticated.repositories.commit();

  const profileVisuals = normalizeProfileVisuals(user.profileVisuals);
  const response = json(
    {
      profileVisuals,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
  recordAuthMetric(env, {
    route: "profile-me",
    status: response.status,
    request,
    outcome: "loaded",
    sessionType: "user",
  });
  return response;
}

export async function updateMyProfile(request: Request, env: Env): Promise<Response> {
  const authenticated = await getAuthenticatedActor(request, env, "profile-update");
  if (!authenticated.ok) {
    return authenticated.response;
  }

  const body = (await request.json().catch(() => null)) as ProfilePatchBody | null;
  const parsed = parseProfileVisuals(body?.profileVisuals);
  if (!parsed.ok) {
    await authenticated.repositories.commit();
    return authError(
      request,
      env,
      "profile-update",
      400,
      parsed.error,
      parsed.message,
      "invalid_input",
    );
  }

  const timestamp = new Date().toISOString();
  const user = ensureUserRecord(authenticated.repositories, authenticated.actor);
  const updated = authenticated.repositories.users.update(user.id, {
    profileVisuals: parsed.profileVisuals,
    updatedAt: timestamp,
  });
  await authenticated.repositories.commit();

  const response = json(
    {
      ok: true,
      profileVisuals: normalizeProfileVisuals(updated?.profileVisuals ?? parsed.profileVisuals),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
  recordAuthMetric(env, {
    route: "profile-update",
    status: response.status,
    request,
    outcome: "updated",
    sessionType: "user",
  });
  return response;
}

export async function postPresenceHeartbeat(request: Request, env: Env): Promise<Response> {
  const authenticated = await getAuthenticatedActor(request, env, "presence-heartbeat");
  if (!authenticated.ok) {
    return authenticated.response;
  }

  const timestamp = new Date().toISOString();
  const user = ensureUserRecord(authenticated.repositories, authenticated.actor);
  authenticated.repositories.users.update(user.id, {
    websiteLastSeenAt: timestamp,
  });
  await authenticated.repositories.commit();

  const response = json(
    { ok: true },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
  recordAuthMetric(env, {
    route: "presence-heartbeat",
    status: response.status,
    request,
    outcome: "updated",
    sessionType: "user",
  });
  return response;
}

async function getAuthenticatedActor(
  request: Request,
  env: Env,
  route: string,
): Promise<
  | { ok: true; actor: SessionActor; repositories: RequestRepositoryContext }
  | { ok: false; response: Response }
> {
  const cookieValue = getCookieValue(request.headers.get("Cookie") ?? "", SESSION_COOKIE_NAME);
  const claims = await verifySessionClaims(cookieValue, getSessionSigningSecret(env));
  if (!claims?.actor || claims.actor.userId === "guest_anonymous") {
    return {
      ok: false,
      response: authError(
        request,
        env,
        route,
        401,
        "authentication_required",
        "Sign in to update your profile.",
        "guest",
      ),
    };
  }

  const dataStatus = getAuthDataStatus(env);
  if (!dataStatus.authStorageReady) {
    return {
      ok: false,
      response: authError(
        request,
        env,
        route,
        503,
        "auth_storage_unavailable",
        "Profile storage is temporarily unavailable.",
        "storage_unavailable",
      ),
    };
  }

  const repositories = await getRepositories(env);
  return {
    ok: true,
    actor: hydrateSessionActor(claims.actor, repositories, env),
    repositories,
  };
}

function ensureUserRecord(repositories: RequestRepositoryContext, actor: SessionActor): UserRecord {
  const existingUser = repositories.users.getById(actor.userId);
  if (existingUser) {
    if (!existingUser.profileVisuals) {
      const updated = repositories.users.update(existingUser.id, {
        profileVisuals: DEFAULT_PROFILE_VISUALS,
        updatedAt: new Date().toISOString(),
      });
      return updated ?? existingUser;
    }

    return existingUser;
  }

  const timestamp = new Date().toISOString();
  const username = buildUniqueUsername(repositories, actor);
  const email = normalizeEmail(actor.email) || `${actor.userId}@opsuimeets.local`;
  const firstName = actor.firstName?.trim() || "Member";
  const lastName = actor.lastName?.trim() || "User";
  const user: UserRecord = {
    id: actor.userId,
    email,
    username,
    usernameNormalized: username.toLowerCase(),
    displayName: `${firstName} ${lastName}`.trim(),
    firstName,
    lastName,
    profileVisuals: actor.profileVisuals ?? DEFAULT_PROFILE_VISUALS,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  repositories.users.create(user);
  return user;
}

function buildUniqueUsername(repositories: RequestRepositoryContext, actor: SessionActor): string {
  const rawUsername =
    actor.username?.trim() ||
    actor.email?.split("@")[0]?.trim() ||
    actor.userId.replace(/^user_/, "").trim() ||
    "member";
  const base = rawUsername.replace(/[^A-Za-z0-9._]+/g, "").replace(/^[._]+|[._]+$/g, "").slice(0, 24) || "member";
  let candidate = base;
  let counter = 1;

  while (true) {
    const existing = repositories.users.getByNormalizedUsername(candidate.toLowerCase());
    if (!existing || existing.id === actor.userId) {
      return candidate;
    }

    const suffix = `${counter}`;
    candidate = `${base.slice(0, Math.max(1, 24 - suffix.length))}${suffix}`;
    counter += 1;
  }
}

function parseProfileVisuals(
  value: unknown,
): { ok: true; profileVisuals: ProfileVisuals } | { ok: false; error: string; message: string } {
  if (!isObject(value)) {
    return {
      ok: false,
      error: "profile_visuals_required",
      message: "Profile visuals are required.",
    };
  }

  const avatar = parseProfileVisualAsset(value.avatar, DEFAULT_PROFILE_VISUALS.avatar);
  if (!avatar.ok) {
    return avatar;
  }

  const banner = parseProfileVisualAsset(value.banner, DEFAULT_PROFILE_VISUALS.banner);
  if (!banner.ok) {
    return banner;
  }

  return {
    ok: true,
    profileVisuals: {
      avatar: avatar.asset,
      banner: banner.asset,
    },
  };
}

function parseProfileVisualAsset(
  value: unknown,
  fallback: ProfileVisualAsset,
): { ok: true; asset: ProfileVisualAsset } | { ok: false; error: string; message: string } {
  if (!isObject(value)) {
    return {
      ok: false,
      error: "profile_visual_invalid",
      message: "Profile visual payload is invalid.",
    };
  }

  const color = typeof value.color === "string" ? value.color.trim().toUpperCase() : "";
  if (!ALLOWED_COLORS.has(color)) {
    return {
      ok: false,
      error: "profile_color_invalid",
      message: "Choose one of the available profile colours.",
    };
  }

  const zoom = typeof value.zoom === "number" && Number.isFinite(value.zoom) ? Math.round(value.zoom) : NaN;
  if (!Number.isFinite(zoom) || zoom < 0 || zoom > 100) {
    return {
      ok: false,
      error: "profile_zoom_invalid",
      message: "Profile image zoom must be between 0 and 100.",
    };
  }

  if (value.mode === "color") {
    return {
      ok: true,
      asset: {
        mode: "color",
        color,
        zoom,
      },
    };
  }

  if (value.mode !== "image") {
    return {
      ok: false,
      error: "profile_visual_mode_invalid",
      message: "Profile visual mode is invalid.",
    };
  }

  const imageDataUrl = typeof value.imageDataUrl === "string" ? value.imageDataUrl.trim() : "";
  if (
    !imageDataUrl ||
    imageDataUrl.length > MAX_PROFILE_IMAGE_DATA_URL_LENGTH ||
    !PROFILE_IMAGE_DATA_URL_PATTERN.test(imageDataUrl)
  ) {
    return {
      ok: false,
      error: "profile_image_invalid",
      message: "Choose a supported image file under 5 MB.",
    };
  }

  return {
    ok: true,
    asset: {
      mode: "image",
      color: color || fallback.color,
      imageDataUrl,
      zoom,
    },
  };
}

function normalizeProfileVisuals(value: ProfileVisuals | null | undefined): ProfileVisuals {
  return {
    avatar: normalizeProfileVisualAsset(value?.avatar, DEFAULT_PROFILE_VISUALS.avatar),
    banner: normalizeProfileVisualAsset(value?.banner, DEFAULT_PROFILE_VISUALS.banner),
  };
}

function normalizeProfileVisualAsset(
  value: ProfileVisualAsset | null | undefined,
  fallback: ProfileVisualAsset,
): ProfileVisualAsset {
  if (!value) {
    return fallback;
  }

  const color = ALLOWED_COLORS.has(value.color) ? value.color : fallback.color;
  const zoom = Number.isFinite(value.zoom) ? Math.min(100, Math.max(0, Math.round(value.zoom))) : fallback.zoom;
  if (
    value.mode === "image" &&
    value.imageDataUrl &&
    value.imageDataUrl.length <= MAX_PROFILE_IMAGE_DATA_URL_LENGTH &&
    PROFILE_IMAGE_DATA_URL_PATTERN.test(value.imageDataUrl)
  ) {
    return {
      mode: "image",
      color,
      imageDataUrl: value.imageDataUrl,
      zoom,
    };
  }

  return {
    mode: "color",
    color,
    zoom,
  };
}

function authError(
  request: Request,
  env: Env,
  route: string,
  status: number,
  error: string,
  message: string,
  outcome: string,
): Response {
  const response = json(
    {
      ok: false,
      error,
      message,
    },
    { status },
  );
  recordAuthMetric(env, {
    route,
    status: response.status,
    request,
    outcome,
    sessionType: status === 401 ? "guest" : undefined,
  });
  return response;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
