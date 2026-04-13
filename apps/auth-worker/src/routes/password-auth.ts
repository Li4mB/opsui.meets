import type { OrganisationMember, OrganisationProfile, SessionActor, WorkspacePlanTier } from "@opsui/shared-types";
import {
  normalizeEmail,
  normalizeOrganizationCode,
  normalizeOrganizationName,
  validateUsername,
} from "../lib/account-identity";
import { buildSessionActorFromRecords, hydrateSessionActor } from "../lib/session-actors";
import { buildSessionCookie, getSessionSigningSecret } from "../lib/session-config";
import { getRepositories } from "../lib/data";
import { json } from "../lib/http";
import { hashPassword, verifyPassword } from "../lib/passwords";
import { validateOpsuiCredentials } from "../lib/opsui-validation";
import {
  buildPasswordSessionToken,
  getCookieValue,
  SESSION_COOKIE_NAME,
  verifySessionClaims,
} from "../lib/session-cookie";
import { recordAuthMetric } from "../lib/analytics";
import type { Env } from "../types";

interface PasswordCredentialsBody {
  email?: string;
  password?: string;
}

interface AccountIdentityBody extends PasswordCredentialsBody {
  username?: string;
  firstName?: string;
  lastName?: string;
}

interface OrganisationSignupBody extends AccountIdentityBody {
  organizationName?: string;
  linkToOpsui?: boolean;
}

interface BusinessSignupBody extends AccountIdentityBody {
  organizationCode?: string;
}

export async function loginWithPassword(request: Request, env: Env): Promise<Response> {
  if (!isPasswordAuthConfigured(env)) {
    return authError(request, env, "login-password", 503, "password_auth_not_configured", "Password sign-in is not configured.", "not_configured");
  }

  const body = (await request.json().catch(() => null)) as PasswordCredentialsBody | null;
  const email = normalizeEmail(body?.email);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !password) {
    return authError(request, env, "login-password", 400, "credentials_required", "Email and password are required.", "invalid_input");
  }

  const repositories = await getRepositories(env);
  const user = repositories.users.getByEmail(email);
  const credential = user ? repositories.passwordCredentials.getByUserId(user.id) : null;
  const membership = user ? repositories.workspaceMemberships.listByUser(user.id)[0] ?? null : null;
  const workspace = membership ? repositories.workspaces.getById(membership.workspaceId) : null;
  await repositories.commit();

  if (!user || !credential || !membership || !workspace) {
    return authError(request, env, "login-password", 401, "invalid_credentials", "Email or password is incorrect.", "invalid_credentials");
  }

  const validPassword = await verifyPassword(password, credential.passwordHash, env.AUTH_PASSWORD_PEPPER!.trim());
  if (!validPassword) {
    return authError(request, env, "login-password", 401, "invalid_credentials", "Email or password is incorrect.", "invalid_credentials");
  }

  const actor = buildSessionActorFromRecords({
    workspace,
    user,
    membership,
  });
  return issuePasswordSessionResponse(actor, request, env, "login-password", "authenticated");
}

export async function signUpIndividual(request: Request, env: Env): Promise<Response> {
  if (!isPasswordAuthConfigured(env)) {
    return authError(request, env, "signup-individual", 503, "password_auth_not_configured", "Password sign-up is not configured.", "not_configured");
  }

  const body = (await request.json().catch(() => null)) as AccountIdentityBody | null;
  const parsed = parseAccountIdentity(body);
  if (!parsed.ok) {
    return authError(request, env, "signup-individual", 400, parsed.error, parsed.message, "invalid_input");
  }

  const repositories = await getRepositories(env);
  if (repositories.users.getByEmail(parsed.email)) {
    await repositories.commit();
    return authError(request, env, "signup-individual", 409, "email_already_exists", "An account with that email already exists.", "duplicate_email");
  }

  if (repositories.users.getByNormalizedUsername(parsed.usernameNormalized)) {
    await repositories.commit();
    return authError(request, env, "signup-individual", 409, "username_already_exists", "That username is already taken.", "duplicate_username");
  }

  const passwordHash = await hashPassword(parsed.password, env.AUTH_PASSWORD_PEPPER!.trim());
  const timestamp = new Date().toISOString();
  const workspace = {
    id: `workspace_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    name: `${parsed.firstName} ${parsed.lastName}'s Workspace`,
    slug: createWorkspaceSlug(`${parsed.firstName}-${parsed.lastName}`, repositories),
    workspaceKind: "personal" as const,
    organizationCode: null,
    organizationNameNormalized: null,
    planTier: "standard" as WorkspacePlanTier,
    opsuiLinked: false,
    opsuiBusinessId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const user = createUserRecord(parsed, timestamp);
  const membership = {
    id: `membership_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    workspaceId: workspace.id,
    userId: user.id,
    workspaceRole: "owner" as const,
    membershipSource: "password_individual" as const,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  repositories.workspaces.create(workspace);
  repositories.users.create(user);
  repositories.workspaceMemberships.create(membership);
  repositories.passwordCredentials.upsert({
    userId: user.id,
    passwordHash: passwordHash.hash,
    hashVersion: passwordHash.hashVersion,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await repositories.commit();

  return issuePasswordSessionResponse(
    buildSessionActorFromRecords({ workspace, user, membership }),
    request,
    env,
    "signup-individual",
    "created",
  );
}

export async function signUpOrganisation(request: Request, env: Env): Promise<Response> {
  if (!isPasswordAuthConfigured(env)) {
    return authError(request, env, "signup-organisation", 503, "password_auth_not_configured", "Password sign-up is not configured.", "not_configured");
  }

  const body = (await request.json().catch(() => null)) as OrganisationSignupBody | null;
  const parsed = parseAccountIdentity(body);
  const organizationName = typeof body?.organizationName === "string" ? body.organizationName.trim() : "";
  const organizationNameNormalized = normalizeOrganizationName(body?.organizationName);
  const linkToOpsui = body?.linkToOpsui === true;
  if (!parsed.ok) {
    return authError(
      request,
      env,
      "signup-organisation",
      400,
      parsed.error,
      parsed.message,
      "invalid_input",
    );
  }
  if (!organizationName) {
    return authError(
      request,
      env,
      "signup-organisation",
      400,
      "organization_name_required",
      "Organisation name is required.",
      "invalid_input",
    );
  }

  const repositories = await getRepositories(env);
  if (repositories.users.getByEmail(parsed.email)) {
    await repositories.commit();
    return authError(request, env, "signup-organisation", 409, "email_already_exists", "An account with that email already exists.", "duplicate_email");
  }

  if (repositories.users.getByNormalizedUsername(parsed.usernameNormalized)) {
    await repositories.commit();
    return authError(request, env, "signup-organisation", 409, "username_already_exists", "That username is already taken.", "duplicate_username");
  }

  if (!organizationNameNormalized) {
    await repositories.commit();
    return authError(
      request,
      env,
      "signup-organisation",
      400,
      "organization_name_required",
      "Organisation name is required.",
      "invalid_input",
    );
  }

  if (repositories.workspaces.getByNormalizedOrganizationName(organizationNameNormalized)) {
    await repositories.commit();
    return authError(
      request,
      env,
      "signup-organisation",
      409,
      "organization_name_already_exists",
      "An organisation with that name already exists.",
      "duplicate_organization_name",
    );
  }

  let opsuiBusinessId: string | null = null;
  let planTier: WorkspacePlanTier = "standard";
  let membershipSource: SessionActor["membershipSource"] = "password_organisation_owner";
  if (linkToOpsui) {
    const validation = await validateOpsuiCredentials(
      {
        email: parsed.email,
        password: parsed.password,
      },
      env,
    );
    if (!validation.ok) {
      await repositories.commit();
      return authError(
        request,
        env,
        "signup-organisation",
        validation.code === "service_unavailable" ? 503 : 403,
        validation.code,
        getOpsuiValidationMessage(validation.code),
        validation.code,
      );
    }

    opsuiBusinessId = validation.businessId;
    planTier = "super";
    membershipSource = "opsui_organisation_owner";
  }

  const passwordHash = await hashPassword(parsed.password, env.AUTH_PASSWORD_PEPPER!.trim());
  const timestamp = new Date().toISOString();
  const workspace = {
    id: `workspace_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    name: organizationName,
    slug: createWorkspaceSlug(organizationName, repositories),
    workspaceKind: "organisation" as const,
    organizationCode: generateOrganisationCode(repositories),
    organizationNameNormalized,
    planTier,
    opsuiLinked: linkToOpsui,
    opsuiBusinessId,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const user = createUserRecord(parsed, timestamp);
  const membership = {
    id: `membership_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    workspaceId: workspace.id,
    userId: user.id,
    workspaceRole: "owner" as const,
    membershipSource: membershipSource!,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  repositories.workspaces.create(workspace);
  repositories.users.create(user);
  repositories.workspaceMemberships.create(membership);
  repositories.passwordCredentials.upsert({
    userId: user.id,
    passwordHash: passwordHash.hash,
    hashVersion: passwordHash.hashVersion,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await repositories.commit();

  return issuePasswordSessionResponse(
    buildSessionActorFromRecords({ workspace, user, membership }),
    request,
    env,
    "signup-organisation",
    "created",
  );
}

export async function signUpBusiness(request: Request, env: Env): Promise<Response> {
  if (!isPasswordAuthConfigured(env)) {
    return authError(request, env, "signup-business", 503, "password_auth_not_configured", "Password sign-up is not configured.", "not_configured");
  }

  const body = (await request.json().catch(() => null)) as BusinessSignupBody | null;
  const parsed = parseAccountIdentity(body);
  const organizationCode = normalizeOrganizationCode(body?.organizationCode);
  if (!parsed.ok) {
    return authError(
      request,
      env,
      "signup-business",
      400,
      parsed.error,
      parsed.message,
      "invalid_input",
    );
  }
  if (!organizationCode) {
    return authError(
      request,
      env,
      "signup-business",
      400,
      "organization_code_required",
      "Organisation code is required.",
      "invalid_input",
    );
  }

  const repositories = await getRepositories(env);
  if (repositories.users.getByEmail(parsed.email)) {
    await repositories.commit();
    return authError(request, env, "signup-business", 409, "email_already_exists", "An account with that email already exists.", "duplicate_email");
  }

  if (repositories.users.getByNormalizedUsername(parsed.usernameNormalized)) {
    await repositories.commit();
    return authError(request, env, "signup-business", 409, "username_already_exists", "That username is already taken.", "duplicate_username");
  }

  const workspace = repositories.workspaces.getByOrganizationCode(organizationCode);
  if (!workspace || workspace.workspaceKind !== "organisation") {
    await repositories.commit();
    return authError(request, env, "signup-business", 404, "organization_not_found", "Organisation code was not found.", "organization_not_found");
  }

  let membershipSource: SessionActor["membershipSource"] = "password_organisation_member";
  if (workspace.opsuiLinked) {
    const validation = await validateOpsuiCredentials(
      {
        email: parsed.email,
        password: parsed.password,
      },
      env,
    );
    if (!validation.ok) {
      await repositories.commit();
      return authError(
        request,
        env,
        "signup-business",
        validation.code === "service_unavailable" ? 503 : 403,
        validation.code,
        getOpsuiValidationMessage(validation.code),
        validation.code,
      );
    }

    if (validation.businessId !== workspace.opsuiBusinessId) {
      await repositories.commit();
      return authError(
        request,
        env,
        "signup-business",
        403,
        "business_mismatch",
        "Those OpsUI credentials do not belong to this organisation.",
        "business_mismatch",
      );
    }

    membershipSource = "opsui_business_member";
  }

  const passwordHash = await hashPassword(parsed.password, env.AUTH_PASSWORD_PEPPER!.trim());
  const timestamp = new Date().toISOString();
  const user = createUserRecord(parsed, timestamp);
  const membership = {
    id: `membership_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    workspaceId: workspace.id,
    userId: user.id,
    workspaceRole: "participant" as const,
    membershipSource: membershipSource!,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  repositories.users.create(user);
  repositories.workspaceMemberships.create(membership);
  repositories.passwordCredentials.upsert({
    userId: user.id,
    passwordHash: passwordHash.hash,
    hashVersion: passwordHash.hashVersion,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await repositories.commit();

  return issuePasswordSessionResponse(
    buildSessionActorFromRecords({ workspace, user, membership }),
    request,
    env,
    "signup-business",
    "created",
  );
}

export async function getOrganisationProfile(request: Request, env: Env): Promise<Response> {
  const cookieValue = getCookieValue(request.headers.get("Cookie") ?? "", SESSION_COOKIE_NAME);
  const claims = await verifySessionClaims(cookieValue, getSessionSigningSecret(env));
  if (!claims?.actor) {
    return authError(request, env, "organisation-me", 401, "authentication_required", "Sign in to view your organisation.", "guest");
  }

  const repositories = await getRepositories(env);
  const actor = hydrateSessionActor(claims.actor, repositories, env);
  const workspace = repositories.workspaces.getById(actor.workspaceId);
  if (!workspace || workspace.workspaceKind !== "organisation" || !workspace.organizationCode) {
    await repositories.commit();
    return authError(request, env, "organisation-me", 404, "organization_not_found", "No organisation profile is available for this account.", "organization_not_found");
  }

    const members = repositories.workspaceMemberships
    .listByWorkspace(workspace.id)
    .map((membership): OrganisationMember | null => {
      const user = repositories.users.getById(membership.userId);
      if (!user) {
        return null;
      }

      const member: OrganisationMember = {
        userId: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        displayName: user.displayName,
        workspaceRole: membership.workspaceRole,
        membershipSource: membership.membershipSource,
        joinedAt: membership.createdAt,
      };
      return member;
    })
    .filter((member): member is OrganisationMember => Boolean(member))
    .sort((left: OrganisationMember, right: OrganisationMember) => {
      if (left.workspaceRole === "owner" && right.workspaceRole !== "owner") {
        return -1;
      }
      if (right.workspaceRole === "owner" && left.workspaceRole !== "owner") {
        return 1;
      }
      return left.displayName.localeCompare(right.displayName);
    });

  await repositories.commit();

  const profile: OrganisationProfile = {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    organizationCode: workspace.organizationCode,
    planTier: workspace.planTier,
    opsuiLinked: workspace.opsuiLinked,
    opsuiBusinessId: workspace.opsuiBusinessId,
    members,
  };
  const response = json(profile, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
  recordAuthMetric(env, {
    route: "organisation-me",
    status: response.status,
    request,
    outcome: "loaded",
    sessionType: "user",
  });
  return response;
}

function isPasswordAuthConfigured(env: Env): boolean {
  return Boolean(env.AUTH_PASSWORD_PEPPER?.trim());
}

function parseAccountIdentity(
  body: AccountIdentityBody | null,
): { ok: true; email: string; password: string; username: string; usernameNormalized: string; firstName: string; lastName: string } | { ok: false; error: string; message: string } {
  const email = normalizeEmail(body?.email);
  const password = typeof body?.password === "string" ? body.password : "";
  const usernameResult = validateUsername(body?.username);
  const firstName = typeof body?.firstName === "string" ? body.firstName.trim() : "";
  const lastName = typeof body?.lastName === "string" ? body.lastName.trim() : "";

  if (!email || !password || !firstName || !lastName) {
    return {
      ok: false,
      error: "required_fields_missing",
      message: "Email, username, first name, last name, and password are required.",
    };
  }

  if (!usernameResult.ok) {
    return usernameResult;
  }

  if (password.length < 8) {
    return {
      ok: false,
      error: "password_too_short",
      message: "Password must be at least 8 characters.",
    };
  }

  return {
    ok: true,
    email,
    password,
    username: usernameResult.value.username,
    usernameNormalized: usernameResult.value.usernameNormalized,
    firstName,
    lastName,
  };
}

function createUserRecord(
  input: { email: string; username: string; usernameNormalized: string; firstName: string; lastName: string },
  timestamp: string,
) {
  return {
    id: `user_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    email: input.email,
    username: input.username,
    usernameNormalized: input.usernameNormalized,
    firstName: input.firstName,
    lastName: input.lastName,
    displayName: `${input.firstName} ${input.lastName}`.trim(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function createWorkspaceSlug(name: string, repositories: Awaited<ReturnType<typeof getRepositories>>): string {
  const base = slugify(name) || "workspace";
  let candidate = base;
  let counter = 1;

  while (repositories.workspaces.getBySlug(candidate)) {
    counter += 1;
    candidate = `${base}-${counter}`;
  }

  return candidate;
}

function generateOrganisationCode(repositories: Awaited<ReturnType<typeof getRepositories>>): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let code = "";
    for (let index = 0; index < 8; index += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }

    if (!repositories.workspaces.getByOrganizationCode(code)) {
      return code;
    }
  }

  return crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
}

async function issuePasswordSessionResponse(
  actor: SessionActor,
  request: Request,
  env: Env,
  route: string,
  outcome: string,
): Promise<Response> {
  const session = await buildPasswordSessionToken(actor, getSessionSigningSecret(env));
  const response = json(
    {
      ok: true,
      actor,
      expiresAt: session.expiresAt,
    },
    {
      status: 200,
      headers: {
        "Set-Cookie": buildSessionCookie(session.token, env),
      },
    },
  );
  recordAuthMetric(env, {
    route,
    status: response.status,
    request,
    outcome,
    sessionType: "user",
  });
  return response;
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
  });
  return response;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function getOpsuiValidationMessage(code: "invalid_credentials" | "no_business_access" | "business_mismatch" | "service_unavailable"): string {
  switch (code) {
    case "invalid_credentials":
      return "Those OpsUI credentials were not accepted.";
    case "no_business_access":
      return "Those OpsUI credentials do not include business access.";
    case "business_mismatch":
      return "Those OpsUI credentials belong to a different business.";
    case "service_unavailable":
    default:
      return "OpsUI validation is unavailable right now.";
  }
}
