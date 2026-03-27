import fs from "node:fs";
import path from "node:path";

function readText(rootDir, relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), "utf8");
}

function hasLine(text, fragment) {
  return text.includes(fragment);
}

function findLineNumber(text, fragment) {
  const lines = text.split(/\r?\n/);
  const index = lines.findIndex((line) => line.includes(fragment));
  return index >= 0 ? index + 1 : null;
}

function evidence(relativePath, text, fragment, note) {
  const line = fragment ? findLineNumber(text, fragment) : null;
  return {
    path: relativePath,
    line,
    note,
  };
}

function createItem(input) {
  return {
    id: input.id,
    title: input.title,
    status: input.status,
    summary: input.summary,
    details: input.details,
    evidence: input.evidence,
  };
}

function renderEvidence(item) {
  return item.evidence
    .map((entry) => {
      const lineSuffix = entry.line ? `:${entry.line}` : "";
      return `- ${entry.path}${lineSuffix} - ${entry.note}`;
    })
    .join("\n");
}

function renderSection(title, items) {
  if (!items.length) {
    return `## ${title}\n\nNone.\n`;
  }

  return [
    `## ${title}`,
    "",
    ...items.flatMap((item) => [
      `### ${item.title} [${item.status}]`,
      "",
      item.summary,
      "",
      ...item.details.map((detail) => `- ${detail}`),
      "",
      renderEvidence(item),
      "",
    ]),
  ].join("\n");
}

export function buildReadinessReport(rootDir) {
  const apiWranglerPath = "apps/api-worker/wrangler.jsonc";
  const postgresAdapterPath = "packages/db/src/adapters/postgres.ts";
  const authSessionPath = "apps/auth-worker/src/routes/session.ts";
  const authIndexPath = "apps/auth-worker/src/index.ts";
  const authWranglerPath = "apps/auth-worker/wrangler.jsonc";
  const authMembershipPath = "apps/auth-worker/src/lib/membership-directory.ts";
  const authAnalyticsPath = "apps/auth-worker/src/lib/analytics.ts";
  const apiAnalyticsPath = "apps/api-worker/src/lib/analytics.ts";
  const apiDataPath = "apps/api-worker/src/lib/data.ts";
  const apiDataStatusPath = "apps/api-worker/src/lib/data-status.ts";
  const mediaAdapterPath = "packages/media-adapter/src/cloudflare-realtime.ts";
  const mediaControlAuthPath = "packages/media-adapter/src/control-auth.ts";
  const mediaWorkerPath = "apps/media-worker/src/index.ts";
  const realtimePath = "apps/realtime-worker/src/durable/RoomCoordinator.ts";
  const webApiPath = "apps/web/src/lib/api.ts";
  const webCommandsPath = "apps/web/src/lib/commands.ts";
  const adminApiPath = "apps/admin/src/lib/api.ts";
  const adminCommandsPath = "apps/admin/src/lib/commands.ts";
  const packageJsonPath = "package.json";
  const ciPath = ".github/workflows/ci.yml";
  const topologyScriptPath = "scripts/export-topology.mjs";

  const apiWrangler = readText(rootDir, apiWranglerPath);
  const postgresAdapter = readText(rootDir, postgresAdapterPath);
  const authSession = readText(rootDir, authSessionPath);
  const authIndex = readText(rootDir, authIndexPath);
  const authWrangler = readText(rootDir, authWranglerPath);
  const authMembership = readText(rootDir, authMembershipPath);
  const authAnalytics = readText(rootDir, authAnalyticsPath);
  const authSessionInfo = readText(rootDir, "apps/auth-worker/src/routes/session-info.ts");
  const authOidcRoute = readText(rootDir, "apps/auth-worker/src/routes/oidc.ts");
  const authRateLimit = readText(rootDir, "apps/auth-worker/src/lib/rate-limit.ts");
  const apiAnalytics = readText(rootDir, apiAnalyticsPath);
  const apiData = readText(rootDir, apiDataPath);
  const apiDataStatus = readText(rootDir, apiDataStatusPath);
  const mediaAdapter = readText(rootDir, mediaAdapterPath);
  const mediaControlAuth = readText(rootDir, mediaControlAuthPath);
  const mediaWorker = readText(rootDir, mediaWorkerPath);
  const realtimeWorker = readText(rootDir, realtimePath);
  const webApi = readText(rootDir, webApiPath);
  const webCommands = readText(rootDir, webCommandsPath);
  const adminApi = readText(rootDir, adminApiPath);
  const adminCommands = readText(rootDir, adminCommandsPath);
  const apiRateLimit = readText(rootDir, "apps/api-worker/src/lib/rate-limit.ts");
  const apiJoinRoute = readText(rootDir, "apps/api-worker/src/routes/join.ts");
  const apiHookTestRoute = readText(rootDir, "apps/api-worker/src/routes/post-meeting-hook-test.ts");
  const apiFollowUpDispatchRoute = readText(rootDir, "apps/api-worker/src/routes/follow-up-dispatch.ts");
  const previewSmokeScript = readText(rootDir, "scripts/smoke-preview.mjs");
  const packageJson = readText(rootDir, packageJsonPath);
  const ciWorkflow = readText(rootDir, ciPath);
  const topologyScript = readText(rootDir, topologyScriptPath);
  const runtimeStateMigration = readText(rootDir, "packages/db/src/migrations/016_runtime_state.sql");
  const dbPackageJson = readText(rootDir, "packages/db/package.json");
  const dbMigrateScript = readText(rootDir, "packages/db/scripts/migrate.mjs");
  const dbStatusScript = readText(rootDir, "packages/db/scripts/status.mjs");

  const readyFoundations = [];
  const blockers = [];
  const prelaunchHardening = [];

  if (
    hasLine(packageJson, '"verify"') &&
    hasLine(ciWorkflow, "corepack pnpm verify") &&
    hasLine(topologyScript, "apps\", \"docs\", \"public") &&
    hasLine(topologyScript, "apps\", \"preview\", \"public")
  ) {
    readyFoundations.push(
      createItem({
        id: "verified-workspace-guardrails",
        title: "Workspace verification and deployment artifacts",
        status: "ready",
        summary:
          "The repo already has an enforced verification path, CI execution, and exported topology artifacts for deployment handoff.",
        details: [
          "Local verification is codified in the root verify script.",
          "CI runs the same verify path before exporting deployment artifacts.",
          "Topology artifacts are published into docs and preview public assets for direct download.",
        ],
        evidence: [
          evidence(packageJsonPath, packageJson, '"verify"', "Root verify script is defined."),
          evidence(ciPath, ciWorkflow, "corepack pnpm verify", "CI runs the verify workflow."),
          evidence(topologyScriptPath, topologyScript, 'apps", "docs", "public', "Topology export publishes docs assets."),
          evidence(topologyScriptPath, topologyScript, 'apps", "preview", "public', "Topology export publishes preview assets."),
        ],
      }),
    );
  }

  if (
    hasLine("".concat(authWrangler), '"binding": "ANALYTICS"') &&
    hasLine(apiWrangler, '"binding": "ANALYTICS"') &&
    hasLine(authAnalytics, "writeDataPoint") &&
    hasLine(apiAnalytics, "writeDataPoint") &&
    hasLine(authIndex, 'recordAuthMetric') &&
    hasLine(readText(rootDir, "apps/api-worker/src/index.ts"), "recordApiMetric")
  ) {
    readyFoundations.push(
      createItem({
        id: "worker-analytics-baseline",
        title: "Worker analytics baseline",
        status: "ready",
        summary:
          "The auth and API workers now emit baseline request analytics for health, join, session, recording, moderation, and follow-up flows, which closes the previous zero-telemetry gap at the edge.",
        details: [
          "Both Workers now declare Cloudflare Analytics Engine bindings.",
          "Shared helpers emit low-overhead route metrics with route, outcome, and client metadata.",
          "This is a baseline telemetry layer; external alert routing is still separate launch work.",
        ],
        evidence: [
          evidence(authWranglerPath, authWrangler, '"binding": "ANALYTICS"', "Auth worker declares an analytics dataset binding."),
          evidence(apiWranglerPath, apiWrangler, '"binding": "ANALYTICS"', "API worker declares an analytics dataset binding."),
          evidence(authAnalyticsPath, authAnalytics, "writeDataPoint", "Auth worker emits Analytics Engine datapoints."),
          evidence(apiAnalyticsPath, apiAnalytics, "writeDataPoint", "API worker emits Analytics Engine datapoints."),
        ],
      }),
    );
  }

  if (
    hasLine(authWrangler, '"ALLOW_MOCK_AUTH": "false"') &&
    hasLine(mediaWorker, 'media_download_not_configured') &&
    hasLine(mediaWorker, 'media_upload_not_configured')
  ) {
    readyFoundations.push(
      createItem({
        id: "fail-closed-auth-media-guards",
        title: "Fail-closed auth and media guardrails",
        status: "ready",
        summary:
          "Mock auth is disabled by default in production config, and the media worker now fails closed when upload or download bases are not configured.",
        details: [
          "The auth worker no longer exposes the mock session path in production mode by default.",
          "Media download and upload routes return explicit configuration errors instead of placeholder URLs.",
        ],
        evidence: [
          evidence(authWranglerPath, authWrangler, '"ALLOW_MOCK_AUTH": "false"', "Mock auth is disabled by default."),
          evidence(mediaWorkerPath, mediaWorker, "media_download_not_configured", "Download route fails closed when not configured."),
          evidence(mediaWorkerPath, mediaWorker, "media_upload_not_configured", "Upload route fails closed when not configured."),
        ],
      }),
    );
  }

  if (
    hasLine(apiWrangler, '"binding": "MEDIA_SERVICE"') &&
    hasLine(mediaWorker, "/v1/control/recordings/start") &&
    hasLine(mediaWorker, "media_control_backend_not_configured") &&
    hasLine(mediaAdapter, "/v1/control/recordings/start")
  ) {
    readyFoundations.push(
      createItem({
        id: "media-control-service-boundary",
        title: "Media control-service boundary",
        status: "ready",
        summary:
          "The API worker now talks to the media worker over an explicit service binding, and the media worker proxies control requests to a dedicated backend only when configured.",
        details: [
          "Recording control no longer returns synthetic ids inside the adapter itself.",
          "The media worker fails closed when no dedicated backend is configured.",
          "This is the correct architectural boundary for a real media plane, even though the backend is still not live.",
        ],
        evidence: [
          evidence(apiWranglerPath, apiWrangler, '"binding": "MEDIA_SERVICE"', "API worker now binds to the media worker."),
          evidence(mediaWorkerPath, mediaWorker, "/v1/control/recordings/start", "Media worker exposes explicit control-plane routes."),
          evidence(mediaWorkerPath, mediaWorker, "media_control_backend_not_configured", "Media control fails closed when no backend is configured."),
          evidence(mediaAdapterPath, mediaAdapter, "/v1/control/recordings/start", "Media adapter now calls the control boundary instead of generating ids locally."),
        ],
      }),
    );
  }

  if (
    hasLine(mediaControlAuth, "createMediaControlHeaders") &&
    hasLine(mediaControlAuth, "verifyMediaControlRequest") &&
    hasLine(mediaWorker, "verifyMediaControlRequest(") &&
    hasLine(apiWrangler, '"MEDIA_CONTROL_SHARED_SECRET": ""')
  ) {
    readyFoundations.push(
      createItem({
        id: "media-control-plane-auth",
        title: "Signed media control-plane auth",
        status: "ready",
        summary:
          "Media control requests are now signed from the API boundary and verified by the media worker instead of leaving those public control routes effectively open.",
        details: [
          "The shared media adapter now signs control-plane payloads with a timestamped HMAC.",
          "The media worker rejects unsigned or invalid control requests before proxying to a backend.",
          "This closes an important control-plane trust gap even though the real backend is still not configured.",
        ],
        evidence: [
          evidence(mediaControlAuthPath, mediaControlAuth, "createMediaControlHeaders", "Media adapter now creates signed control-plane headers."),
          evidence(mediaControlAuthPath, mediaControlAuth, "verifyMediaControlRequest", "Media worker can verify signed control-plane requests."),
          evidence(mediaWorkerPath, mediaWorker, "verifyMediaControlRequest(", "Media worker now verifies signed control-plane requests before proxying."),
          evidence(apiWranglerPath, apiWrangler, '"MEDIA_CONTROL_SHARED_SECRET": ""', "API scaffold now carries a dedicated shared secret for media control signing."),
        ],
      }),
    );
  }

  if (
    hasLine(apiWrangler, '"DATABASE_URL": ""') &&
    hasLine(readText(rootDir, "apps/api-worker/src/routes/health.ts"), "databaseConfigured") &&
    hasLine(readText(rootDir, "apps/api-worker/src/routes/health.ts"), "persistenceReady")
  ) {
    readyFoundations.push(
      createItem({
        id: "persistence-runtime-signals",
        title: "Persistence runtime signals",
        status: "ready",
        summary:
          "The API now exposes whether durable persistence is selected, configured, and launch-ready, which makes preview and docs much more honest about the database rollout state.",
        details: [
          "Health now reports the active data mode.",
          "Health distinguishes between database configuration and actual persistence readiness.",
          "This reduces ambiguity before the full Postgres repository implementation lands.",
        ],
        evidence: [
          evidence(apiWranglerPath, apiWrangler, '"DATABASE_URL": ""', "API scaffold now carries an explicit database connection placeholder."),
          evidence("apps/api-worker/src/routes/health.ts", readText(rootDir, "apps/api-worker/src/routes/health.ts"), "databaseConfigured", "API health reports whether database connectivity is configured."),
          evidence("apps/api-worker/src/routes/health.ts", readText(rootDir, "apps/api-worker/src/routes/health.ts"), "persistenceReady", "API health reports whether persistence is actually ready for launch."),
        ],
      }),
    );
  }

  if (
    hasLine(apiDataStatus, "getPersistenceAvailabilityError") &&
    hasLine(apiDataStatus, "postgres_not_configured") &&
    hasLine(apiData, "assertPersistenceAvailable(env)") &&
    hasLine(readText(rootDir, "apps/api-worker/src/index.ts"), "assertPersistenceAvailable(env)")
  ) {
    readyFoundations.push(
      createItem({
        id: "persistence-mode-guardrails",
        title: "Persistence mode guardrails",
        status: "ready",
        summary:
          "If Postgres mode is selected before the durable adapter exists, the API now fails early with a clear 503 instead of leaking that mismatch through arbitrary route failures.",
        details: [
          "The persistence availability decision now lives in one shared helper.",
          "The main router blocks non-health traffic before route execution when Postgres mode is unavailable.",
          "Repository access uses the same guard, which keeps direct route-level data access aligned with the top-level worker behavior.",
        ],
        evidence: [
          evidence(apiDataStatusPath, apiDataStatus, "getPersistenceAvailabilityError", "API exposes a shared persistence-availability helper."),
          evidence(apiDataStatusPath, apiDataStatus, "postgres_not_configured", "Unavailable Postgres mode now maps to a clear 503 error code."),
          evidence(apiDataPath, apiData, "assertPersistenceAvailable(env)", "Repository access uses the shared persistence guard."),
          evidence("apps/api-worker/src/index.ts", readText(rootDir, "apps/api-worker/src/index.ts"), "assertPersistenceAvailable(env)", "Top-level API routing blocks unavailable persistence mode before executing routes."),
        ],
      }),
    );
  }

  if (
    hasLine(postgresAdapter, "loadRuntimeState") &&
    hasLine(postgresAdapter, "saveRuntimeState") &&
    hasLine(postgresAdapter, "opsui_runtime_state") &&
    hasLine(runtimeStateMigration, "create table if not exists opsui_runtime_state")
  ) {
    readyFoundations.push(
      createItem({
        id: "postgres-runtime-state-adapter",
        title: "Postgres runtime-state adapter",
        status: "ready",
        summary:
          "The DB package now has a real Postgres-backed persistence path that loads and commits request-scoped state instead of throwing not-implemented errors.",
        details: [
          "The adapter now loads a runtime-state snapshot from Postgres and commits back through a versioned row.",
          "Existing repository behavior is reused against that request-scoped state, which keeps the product logic aligned between memory and Postgres modes.",
          "A dedicated migration now creates the runtime-state table required by the adapter.",
        ],
        evidence: [
          evidence(postgresAdapterPath, postgresAdapter, "loadRuntimeState", "Postgres adapter now loads persisted runtime state."),
          evidence(postgresAdapterPath, postgresAdapter, "saveRuntimeState", "Postgres adapter now commits runtime state back to Postgres."),
          evidence(postgresAdapterPath, postgresAdapter, "opsui_runtime_state", "Adapter targets the runtime-state table instead of throwing not-implemented errors."),
          evidence("packages/db/src/migrations/016_runtime_state.sql", runtimeStateMigration, "create table if not exists opsui_runtime_state", "A dedicated migration now creates the runtime-state table."),
        ],
      }),
    );
  }

  if (
    hasLine(packageJson, '"db:migrate"') &&
    hasLine(packageJson, '"db:status"') &&
    hasLine(dbPackageJson, '"db:migrate"') &&
    hasLine(dbMigrateScript, "opsui_schema_migrations") &&
    hasLine(dbStatusScript, "Pending migrations")
  ) {
    readyFoundations.push(
      createItem({
        id: "database-migration-tooling",
        title: "Database migration tooling",
        status: "ready",
        summary:
          "The repo now has a concrete migration workflow for provisioning the Postgres schema instead of leaving database bring-up as a manual, undocumented step.",
        details: [
          "Root commands now expose database status and migration execution.",
          "The DB package tracks applied migrations in opsui_schema_migrations.",
          "This turns DATABASE_URL activation into an operational procedure instead of an ad hoc task.",
        ],
        evidence: [
          evidence(packageJsonPath, packageJson, '"db:migrate"', "Root workspace now exposes a database migration command."),
          evidence(packageJsonPath, packageJson, '"db:status"', "Root workspace now exposes a database status command."),
          evidence("packages/db/scripts/migrate.mjs", dbMigrateScript, "opsui_schema_migrations", "Database migrations are tracked in a schema-migrations table."),
          evidence("packages/db/scripts/status.mjs", dbStatusScript, "Pending migrations", "DB status command reports applied vs pending migrations."),
        ],
      }),
    );
  }

  const persistenceBlocked =
    hasLine(apiWrangler, '"APP_DATA_MODE": "memory"') ||
    hasLine(apiWrangler, '"DATABASE_URL": ""') ||
    hasLine(postgresAdapter, "notImplemented(");
  if (persistenceBlocked) {
    blockers.push(
      createItem({
        id: "persistence-not-production-ready",
        title: "Durable persistence is not production-ready",
        status: "blocked",
        summary:
          "The Postgres code path now exists, but the checked-in API deployment scaffold still does not carry a real database connection string. Durable persistence still needs an actual bound database secret before production traffic should rely on it.",
        details: [
          "The repository adapter is now wired to a real Postgres-backed runtime-state table.",
          "The checked-in worker config now selects Postgres mode, but still leaves DATABASE_URL empty for safety.",
          "The runtime health surface can prove whether database connectivity is configured and whether persistence is ready.",
          "Production launch should not proceed until DATABASE_URL is bound to a real durable database.",
        ],
        evidence: [
          evidence(apiWranglerPath, apiWrangler, '"APP_DATA_MODE": "postgres"', "API worker now targets Postgres mode in the deployment scaffold."),
          evidence(apiWranglerPath, apiWrangler, '"DATABASE_URL": ""', "The checked-in deployment scaffold still leaves the database connection unset."),
          evidence("apps/api-worker/src/routes/health.ts", readText(rootDir, "apps/api-worker/src/routes/health.ts"), "persistenceReady", "API runtime health still reflects that persistence is not ready."),
          evidence(postgresAdapterPath, postgresAdapter, "opsui_runtime_state", "Postgres adapter now persists runtime state into a database table."),
        ],
      }),
    );
  }

  if (
    hasLine(authSession, "buildMockSessionToken") &&
    hasLine(authSessionInfo, "verifySessionClaims") &&
    hasLine(authWrangler, '"MOCK_SESSION_SIGNING_SECRET"')
  ) {
    readyFoundations.push(
      createItem({
        id: "signed-mock-session-cookies",
        title: "Signed scaffold session cookies",
        status: "ready",
        summary:
          "The auth scaffold no longer trusts any opaque cookie value. Mock sessions are now signed and verified before actor data is accepted by the app surfaces.",
        details: [
          "Session issuance now creates a signed cookie payload instead of storing only a random id.",
          "Session reads verify the signature before treating the actor as authenticated.",
          "This is stronger than the original scaffold, even though a real identity provider is still required.",
        ],
        evidence: [
          evidence(authSessionPath, authSession, "buildMockSessionToken", "Mock session issuance now signs the cookie payload."),
          evidence("apps/auth-worker/src/routes/session-info.ts", authSessionInfo, "verifySessionClaims", "Session reads verify the signed cookie before authenticating."),
          evidence(authWranglerPath, authWrangler, '"MOCK_SESSION_SIGNING_SECRET"', "Auth worker now carries a signing secret setting."),
        ],
      }),
    );
  }

  if (
    hasLine(authIndex, "/v1/login") &&
    hasLine(authIndex, "/v1/callback") &&
    hasLine(authOidcRoute, "authorization_code") &&
    hasLine(authWrangler, '"OIDC_SCOPE"')
  ) {
    readyFoundations.push(
      createItem({
        id: "oidc-provider-boundary",
        title: "OIDC provider boundary",
        status: "ready",
        summary:
          "The auth worker now exposes provider-aware login, callback, and logout routes, with generic OIDC token and userinfo exchange scaffolding instead of only a local mock-session lane.",
        details: [
          "The auth surface now has explicit OIDC login and callback routes.",
          "Callback handling exchanges an authorization code for tokens and derives a session from userinfo claims.",
          "Workspace mapping is still scaffolded, but the provider boundary is no longer missing.",
        ],
        evidence: [
          evidence(authIndexPath, authIndex, "/v1/login", "Auth worker exposes an OIDC login route."),
          evidence(authIndexPath, authIndex, "/v1/callback", "Auth worker exposes an OIDC callback route."),
          evidence("apps/auth-worker/src/routes/oidc.ts", authOidcRoute, "authorization_code", "OIDC callback performs an authorization-code exchange."),
          evidence(authWranglerPath, authWrangler, '"OIDC_SCOPE"', "Auth worker now carries OIDC configuration variables."),
        ],
      }),
    );
  }

  if (
    hasLine(authMembership, "resolveMembershipDirectoryEntry") &&
    hasLine(authMembership, "isMembershipDirectoryEnforced") &&
    hasLine(authWrangler, '"AUTH_MEMBERSHIP_DIRECTORY_JSON"') &&
    hasLine(authOidcRoute, "oidc_membership_not_found") &&
    hasLine(readText(rootDir, "apps/auth-worker/src/routes/health.ts"), "membershipDirectoryConfigured")
  ) {
    readyFoundations.push(
      createItem({
        id: "auth-membership-directory-boundary",
        title: "Authoritative auth membership directory boundary",
        status: "ready",
        summary:
          "The auth worker now has an explicit membership directory boundary for OIDC and mock session issuance, instead of trusting provider claims and defaults alone.",
        details: [
          "OIDC callback can now fail closed when a user has no configured membership entry.",
          "Mock session issuance can also require a configured membership record.",
          "Auth health now reports whether the membership directory exists and whether enforcement is active.",
        ],
        evidence: [
          evidence(authMembershipPath, authMembership, "resolveMembershipDirectoryEntry", "Auth worker now resolves membership through a dedicated directory helper."),
          evidence(authMembershipPath, authMembership, "isMembershipDirectoryEnforced", "Membership enforcement policy is centralized in the auth worker."),
          evidence(authWranglerPath, authWrangler, '"AUTH_MEMBERSHIP_DIRECTORY_JSON"', "Auth worker scaffold now carries a membership directory variable."),
          evidence("apps/auth-worker/src/routes/oidc.ts", authOidcRoute, "oidc_membership_not_found", "OIDC callback now fails closed when no membership entry exists."),
          evidence("apps/auth-worker/src/routes/health.ts", readText(rootDir, "apps/auth-worker/src/routes/health.ts"), "membershipDirectoryConfigured", "Auth health now reports directory configuration and enforcement state."),
        ],
      }),
    );
  }

  if (
    hasLine(authOidcRoute, "resolveWorkspaceTarget") &&
    hasLine(authOidcRoute, "OIDC_WORKSPACE_CLAIM") &&
    hasLine(authOidcRoute, "OIDC_EMAIL_DOMAIN_WORKSPACE_MAP")
  ) {
    readyFoundations.push(
      createItem({
        id: "oidc-workspace-resolution",
        title: "Configurable OIDC workspace resolution",
        status: "ready",
        summary:
          "OIDC callback handling can now derive the workspace from a configured claim or email-domain map instead of always forcing every authenticated user into the default workspace.",
        details: [
          "Workspace resolution can come from an explicit OIDC claim.",
          "A domain-to-workspace map can be used when claim-based routing is unavailable.",
          "This reduces tenant coupling, even though full membership and role enforcement are still not complete.",
        ],
        evidence: [
          evidence("apps/auth-worker/src/routes/oidc.ts", authOidcRoute, "resolveWorkspaceTarget", "OIDC callback now resolves workspace through a helper instead of hardcoding the default workspace."),
          evidence("apps/auth-worker/src/routes/oidc.ts", authOidcRoute, "OIDC_WORKSPACE_CLAIM", "Workspace resolution can use a configured OIDC claim."),
          evidence("apps/auth-worker/src/routes/oidc.ts", authOidcRoute, "OIDC_EMAIL_DOMAIN_WORKSPACE_MAP", "Workspace resolution can fall back to an email-domain map."),
        ],
      }),
    );
  }

  if (
    hasLine(authOidcRoute, "isWorkspaceAllowed") &&
    hasLine(authOidcRoute, "resolveWorkspaceRole") &&
    hasLine(authOidcRoute, "oidc_workspace_not_allowed") &&
    hasLine(authWrangler, '"OIDC_ALLOWED_WORKSPACE_IDS"') &&
    hasLine(authWrangler, '"OIDC_ROLE_CLAIM"')
  ) {
    readyFoundations.push(
      createItem({
        id: "oidc-workspace-role-guards",
        title: "OIDC workspace and role guardrails",
        status: "ready",
        summary:
          "OIDC callback handling now fails closed for disallowed workspaces and carries a mapped workspace role into the signed session instead of treating every authenticated user as equally trusted.",
        details: [
          "Workspace access can now be restricted to an explicit allowlist.",
          "A role claim or default role can be normalized into the session actor.",
          "This is still not a substitute for database-backed membership enforcement, but it is much closer to a real production boundary.",
        ],
        evidence: [
          evidence("apps/auth-worker/src/routes/oidc.ts", authOidcRoute, "isWorkspaceAllowed", "OIDC callback now checks an explicit workspace allowlist."),
          evidence("apps/auth-worker/src/routes/oidc.ts", authOidcRoute, "resolveWorkspaceRole", "OIDC callback now maps a workspace role into the session actor."),
          evidence("apps/auth-worker/src/routes/oidc.ts", authOidcRoute, "oidc_workspace_not_allowed", "Disallowed workspace resolution now fails closed."),
          evidence(authWranglerPath, authWrangler, '"OIDC_ALLOWED_WORKSPACE_IDS"', "Auth worker config exposes allowed workspace ids."),
        ],
      }),
    );
  }

  const authBlocked =
    !hasLine(authMembership, "resolveMembershipDirectoryEntry") ||
    hasLine(authWrangler, '"AUTH_MEMBERSHIP_DIRECTORY_JSON": "{\\"users\\":[]}"') ||
    !hasLine(authOidcRoute, "oidc_membership_not_found");
  if (authBlocked) {
    blockers.push(
      createItem({
        id: "auth-session-still-synthetic",
        title: "Authoritative auth membership still needs production binding",
        status: "blocked",
        summary:
          "The auth layer now has signed sessions, an OIDC boundary, and a real membership-directory enforcement path, but the checked-in production scaffold still leaves that directory empty and the live identity provider still needs to be bound.",
        details: [
          "Session integrity is stronger now because the cookie is signed and verified.",
          "OIDC callback can now fail closed on missing membership instead of trusting provider claims by default.",
          "The checked-in auth worker scaffold still leaves AUTH_MEMBERSHIP_DIRECTORY_JSON empty for safety.",
          "Production launch still needs live OIDC provider configuration and a real membership directory binding.",
        ],
        evidence: [
          evidence(authMembershipPath, authMembership, "resolveMembershipDirectoryEntry", "Auth worker now has an authoritative membership directory helper."),
          evidence("apps/auth-worker/src/routes/oidc.ts", authOidcRoute, "oidc_membership_not_found", "OIDC callback can now reject users without configured membership."),
          evidence(authWranglerPath, authWrangler, '"AUTH_MEMBERSHIP_DIRECTORY_JSON": "{\\"users\\":[]}"', "The checked-in auth scaffold still leaves the membership directory empty."),
          evidence(authWranglerPath, authWrangler, '"OIDC_SCOPE"', "OIDC config knobs exist, but live provider values still need deployment-time binding."),
          evidence(authIndexPath, authIndex, "/v1/session/mock", "Mock session route still exists behind an explicit flag for non-production testing."),
        ],
      }),
    );
  }

  const mediaBlocked =
    hasLine(mediaWorker, "media_control_backend_not_configured") ||
    hasLine(mediaWorker, '"MEDIA_BACKEND_BASE_URL": ""');
  if (mediaBlocked) {
    blockers.push(
      createItem({
        id: "media-provider-not-integrated",
        title: "Media session and recording provider integration is still synthetic",
        status: "blocked",
        summary:
          "The media boundary and signed control-plane auth now exist, but the checked-in scaffold still leaves both the backend base URL and the shared control secret unset, so real session and recording operations cannot run yet.",
        details: [
          "The API worker now calls the media worker over a real service binding instead of fabricating provider ids.",
          "The media worker now rejects unsigned control traffic and still fails closed until `MEDIA_BACKEND_BASE_URL` points at a real backend.",
          "The checked-in scaffolds still leave `MEDIA_CONTROL_SHARED_SECRET` empty in both API and media worker config.",
          "Screen share, recording, and playback cannot be treated as production-capable until that backend is live.",
        ],
        evidence: [
          evidence(mediaWorkerPath, mediaWorker, "media_control_backend_not_configured", "Media worker still blocks control operations until a backend is configured."),
          evidence("apps/media-worker/wrangler.jsonc", readText(rootDir, "apps/media-worker/wrangler.jsonc"), '"MEDIA_BACKEND_BASE_URL": ""', "Media backend base URL is still empty in the worker scaffold."),
          evidence("apps/media-worker/wrangler.jsonc", readText(rootDir, "apps/media-worker/wrangler.jsonc"), '"MEDIA_CONTROL_SHARED_SECRET": ""', "Media worker shared control secret is still empty in the worker scaffold."),
          evidence(apiWranglerPath, apiWrangler, '"MEDIA_CONTROL_SHARED_SECRET": ""', "API worker shared control secret is still empty in the worker scaffold."),
        ],
      }),
    );
  }

  const realtimeBlocked =
    hasLine(realtimeWorker, 'type: "hello"') &&
    hasLine(realtimeWorker, 'type: "hand.raise"') &&
    !hasLine(realtimeWorker, 'type: "signal.offer"') &&
    !hasLine(realtimeWorker, 'type: "signal.ice"');
  if (realtimeBlocked) {
    blockers.push(
      createItem({
        id: "realtime-limited-control-plane",
        title: "Realtime worker is still a lightweight coordination layer",
        status: "blocked",
        summary:
          "The Durable Object handles presence and simple room events, but it does not yet implement the full signaling and moderation sync needed for a real browser meeting experience.",
        details: [
          "Current websocket messages are limited to hello, ping, and raised-hand events.",
          "There is no explicit SDP or ICE exchange path for WebRTC signaling yet.",
          "Production meetings require backend-authoritative moderation and full media-session signaling.",
        ],
        evidence: [
          evidence(realtimePath, realtimeWorker, 'type: "hello"', "Realtime coordinator supports hello events."),
          evidence(realtimePath, realtimeWorker, 'type: "hand.raise"', "Realtime coordinator supports raised-hand events."),
          evidence(realtimePath, realtimeWorker, "type ClientMessage =", "Client message set is still small and control-plane only."),
        ],
      }),
    );
  }

  if (
    hasLine(realtimeWorker, 'type: "signal.offer"') &&
    hasLine(realtimeWorker, 'type: "signal.answer"') &&
    hasLine(realtimeWorker, 'type: "signal.ice"') &&
    hasLine(realtimeWorker, 'type: "room.snapshot"')
  ) {
    readyFoundations.push(
      createItem({
        id: "realtime-signaling-primitives",
        title: "Realtime signaling and room-state primitives",
        status: "ready",
        summary:
          "The realtime worker now supports direct offer/answer/ICE relay plus room snapshot propagation, which moves it beyond a pure hand-raise presence channel.",
        details: [
          "Participants can relay WebRTC signaling messages through the Durable Object.",
          "Room snapshots now include lock and recording state and can be requested or broadcast on change.",
          "This is still not a full production media plane, but it is a more credible realtime control foundation.",
        ],
        evidence: [
          evidence(realtimePath, realtimeWorker, 'type: "signal.offer"', "Realtime coordinator can relay offer messages."),
          evidence(realtimePath, realtimeWorker, 'type: "signal.answer"', "Realtime coordinator can relay answer messages."),
          evidence(realtimePath, realtimeWorker, 'type: "signal.ice"', "Realtime coordinator can relay ICE candidates."),
          evidence(realtimePath, realtimeWorker, 'type: "room.snapshot"', "Realtime coordinator can publish room snapshots."),
        ],
      }),
    );
  }

  if (
    hasLine(realtimeWorker, 'url.pathname.endsWith("/state")') &&
    hasLine(realtimeWorker, "applyPatch(") &&
    hasLine(readText(rootDir, "apps/api-worker/src/lib/realtime.ts"), "syncRealtimeRoomState") &&
    hasLine(readText(rootDir, "apps/realtime-worker/src/index.ts"), "controlSyncReady")
  ) {
    readyFoundations.push(
      createItem({
        id: "realtime-control-sync",
        title: "Realtime backend control sync",
        status: "ready",
        summary:
          "The realtime worker can now accept backend room-state patches and the API pushes join, moderation, recording, and lifecycle updates into it, so websocket room state no longer drifts as easily from backend truth.",
        details: [
          "The Durable Object now exposes an internal state-sync route in addition to websocket handling.",
          "API room lifecycle routes now best-effort sync lock, lobby, admit, remove, recording, and end-meeting state into realtime.",
          "Realtime health now reports control-sync readiness separately from raw websocket availability.",
        ],
        evidence: [
          evidence(realtimePath, realtimeWorker, 'url.pathname.endsWith("/state")', "Realtime coordinator now accepts internal state-sync requests."),
          evidence(realtimePath, realtimeWorker, "applyPatch(", "Realtime coordinator can merge backend room-state patches into the live snapshot."),
          evidence("apps/api-worker/src/lib/realtime.ts", readText(rootDir, "apps/api-worker/src/lib/realtime.ts"), "syncRealtimeRoomState", "API worker now has a helper for syncing backend state into realtime."),
          evidence("apps/realtime-worker/src/index.ts", readText(rootDir, "apps/realtime-worker/src/index.ts"), "controlSyncReady", "Realtime health now reports control-sync readiness."),
        ],
      }),
    );
  }

  if (
    hasLine(authRateLimit, "rate_limit_exceeded") &&
    hasLine(apiRateLimit, "rate_limit_exceeded") &&
    hasLine(authIndex, 'bucket: "join-token"') &&
    hasLine(apiJoinRoute, 'bucket: "meeting-join"') &&
    hasLine(apiHookTestRoute, 'bucket: "post-meeting-hook-test"') &&
    hasLine(apiFollowUpDispatchRoute, 'bucket: "follow-up-dispatch"')
  ) {
    readyFoundations.push(
      createItem({
        id: "edge-rate-limit-baseline",
        title: "Edge rate-limit baseline",
        status: "ready",
        summary:
          "The public auth and API edges now have explicit request throttles for join, mock session, and hook-trigger surfaces instead of relying on no abuse controls at all.",
        details: [
          "Join-token and mock-session issuance are rate limited in the auth worker.",
          "Meeting join and hook-trigger routes are rate limited in the API worker.",
          "This is still a local fixed-window baseline, but it closes the previous zero-control gap.",
        ],
        evidence: [
          evidence("apps/auth-worker/src/lib/rate-limit.ts", authRateLimit, "rate_limit_exceeded", "Auth worker now exposes a shared rate-limit helper."),
          evidence(authIndexPath, authIndex, 'bucket: "join-token"', "Auth join-token issuance is rate limited."),
          evidence("apps/api-worker/src/lib/rate-limit.ts", apiRateLimit, "rate_limit_exceeded", "API worker now exposes a shared rate-limit helper."),
          evidence("apps/api-worker/src/routes/join.ts", apiJoinRoute, 'bucket: "meeting-join"', "Meeting join is rate limited."),
        ],
      }),
    );
  }

  if (
    hasLine(packageJson, '"smoke:preview"') &&
    hasLine(previewSmokeScript, "PREVIEW_SMOKE_") &&
    hasLine(previewSmokeScript, "/opsui-meets.readiness.json") &&
    hasLine(ciWorkflow, "corepack pnpm smoke:preview")
  ) {
    readyFoundations.push(
      createItem({
        id: "preview-smoke-runner",
        title: "Preview smoke runner",
        status: "ready",
        summary:
          "The repo now includes an env-driven smoke runner for deployed preview surfaces, so ops can validate bound hostnames and published artifacts without inventing one-off checks.",
        details: [
          "Worker surfaces are checked through their health endpoints.",
          "Docs and preview Pages surfaces are checked for both page response and published topology/readiness assets.",
          "The runner is optional until preview host URLs are configured, which keeps local verification stable while still allowing CI execution.",
        ],
        evidence: [
          evidence(packageJsonPath, packageJson, '"smoke:preview"', "Root package now exposes a preview smoke script."),
          evidence("scripts/smoke-preview.mjs", previewSmokeScript, "PREVIEW_SMOKE_", "Preview smoke runner uses env-configured targets."),
          evidence("scripts/smoke-preview.mjs", previewSmokeScript, "/opsui-meets.readiness.json", "Preview smoke runner verifies published readiness assets."),
          evidence(ciPath, ciWorkflow, "corepack pnpm smoke:preview", "CI can execute preview smoke checks when preview URLs are configured."),
        ],
      }),
    );
  }

  const identityBlocked =
    hasLine(webApi, '"x-workspace-id": "workspace_local"') ||
    hasLine(webCommands, '"x-user-id": "user_local"') ||
    hasLine(adminApi, '"x-workspace-id": "workspace_local"') ||
    hasLine(adminCommands, '"x-user-id": "user_local"');
  if (identityBlocked) {
    blockers.push(
      createItem({
        id: "frontend-identity-hardcoded",
        title: "Frontend requests still use hardcoded local identity headers",
        status: "blocked",
        summary:
          "The app shell is still issuing API requests as a fixed local workspace and user instead of deriving those values from a real authenticated session.",
        details: [
          "This is fine for scaffolding and mock flows, but it is not tenant-safe.",
          "Host permissions, audit entries, and session-sensitive policy checks need real actor identity before launch.",
        ],
        evidence: [
          evidence(webApiPath, webApi, '"x-workspace-id": "workspace_local"', "Web dashboard reads still use a fixed local workspace id."),
          evidence(webCommandsPath, webCommands, '"x-user-id": "user_local"', "Web mutation commands still use a fixed local user id."),
          evidence(adminApiPath, adminApi, '"x-workspace-id": "workspace_local"', "Admin reads still use a fixed local workspace id."),
          evidence(adminCommandsPath, adminCommands, '"x-user-id": "user_local"', "Admin mutation commands still use a fixed local user id."),
        ],
      }),
    );
  }

  prelaunchHardening.push(
    createItem({
      id: "preview-smoke-tests-missing",
      title: "Deployed preview smoke execution still needs rollout wiring",
      status: "pending",
      summary:
        "The smoke runner now exists, but deployed preview host URLs and regular execution still need to be wired into an environment where those domains are actually live.",
      details: [
        "Local and CI verification now support deployed preview smoke execution when preview URLs are configured.",
        "Launch readiness still needs those preview URLs to be provisioned and maintained against live preview domains.",
      ],
      evidence: [
        evidence(packageJsonPath, packageJson, '"smoke:preview"', "Preview smoke runner now exists in the root package."),
        evidence(ciPath, ciWorkflow, "corepack pnpm smoke:preview", "CI can run preview smoke checks, but only after preview URLs are configured."),
      ],
    }),
  );

  if (
    !hasLine(authIndex, 'bucket: "join-token"') ||
    !hasLine(apiJoinRoute, 'bucket: "meeting-join"')
  ) {
    prelaunchHardening.push(
      createItem({
        id: "rate-limits-and-abuse-controls",
        title: "Public route abuse controls still need explicit implementation",
        status: "pending",
        summary:
          "Join, auth, and webhook-trigger routes still need explicit rate limiting and abuse controls before the public hostnames should be trusted at scale.",
        details: [
          "This matters most for public join paths, hook dispatch, and auth/session edges.",
          "The repo should add explicit rate-limit policy and enforcement points before production cutover.",
        ],
        evidence: [
          evidence("apps/api-worker/src/index.ts", readText(rootDir, "apps/api-worker/src/index.ts"), "/v1/meetings/", "API routes are present, but readiness still needs abuse controls around public edges."),
          evidence(authIndexPath, authIndex, "/v1/session", "Auth/session routes exist and need production abuse controls."),
        ],
      }),
    );
  }

  prelaunchHardening.push(
    createItem({
      id: "observability-and-alerting",
      title: "External alerting and SLO rollout still need first-class work",
      status: "pending",
      summary:
        "Worker telemetry and in-product audit visibility now exist, but production launch still needs alert routing, thresholds, and SLO ownership outside the product UI.",
      details: [
        "The product already exposes useful admin and room activity surfaces, and the Workers now emit baseline analytics datapoints.",
        "Production readiness still needs external alert routing, thresholding, dashboards, and on-call ownership outside the app surfaces.",
      ],
      evidence: [
        evidence(authAnalyticsPath, authAnalytics, "writeDataPoint", "Auth worker telemetry baseline now exists."),
        evidence(apiAnalyticsPath, apiAnalytics, "writeDataPoint", "API worker telemetry baseline now exists."),
        evidence("apps/admin/src/FollowUpHooksPanel.tsx", readText(rootDir, "apps/admin/src/FollowUpHooksPanel.tsx"), "Needs Attention", "Admin UI already exposes failure triage."),
        evidence("apps/admin/src/AuditList.tsx", readText(rootDir, "apps/admin/src/AuditList.tsx"), "Audit", "Admin audit view exists, but external monitoring is still separate work."),
      ],
    }),
  );

  const report = {
    generatedAt: new Date().toISOString(),
    overallStatus: blockers.length ? "not_ready" : "ready_for_launch_review",
    recommendedNextStep: blockers.some((item) => item.id === "persistence-not-production-ready")
      ? "Bind DATABASE_URL to a real Postgres service, apply packages/db/src/migrations/016_runtime_state.sql, and rerun preview smoke before public launch."
      : blockers.length
        ? "Complete the remaining launch blockers, then run launch review against deployed preview."
        : "Run launch review against deployed preview and complete final compliance checks.",
    summary: {
      readyFoundations: readyFoundations.length,
      blockers: blockers.length,
      prelaunchHardening: prelaunchHardening.length,
    },
    readyFoundations,
    blockers,
    prelaunchHardening,
  };

  return report;
}

export function renderReadinessMarkdown(report) {
  return [
    "# OpsUI Meets Readiness Report",
    "",
    `Generated at: ${report.generatedAt}`,
    "",
    `Overall status: ${report.overallStatus}`,
    "",
    `Recommended next step: ${report.recommendedNextStep}`,
    "",
    "## Summary",
    "",
    `- Ready foundations: ${report.summary.readyFoundations}`,
    `- Launch blockers: ${report.summary.blockers}`,
    `- Prelaunch hardening items: ${report.summary.prelaunchHardening}`,
    "",
    renderSection("Ready Foundations", report.readyFoundations),
    "",
    renderSection("Launch Blockers", report.blockers),
    "",
    renderSection("Prelaunch Hardening", report.prelaunchHardening),
    "",
  ].join("\n");
}
