# OpsUI Meets Readiness Report

Generated at: 2026-03-27T21:07:05.079Z

Overall status: not_ready

Recommended next step: Bind DATABASE_URL to a real Postgres service, apply packages/db/src/migrations/016_runtime_state.sql, and rerun preview smoke before public launch.

## Summary

- Ready foundations: 18
- Launch blockers: 3
- Prelaunch hardening items: 2

## Ready Foundations

### Workspace verification and deployment artifacts [ready]

The repo already has an enforced verification path, CI execution, and exported topology artifacts for deployment handoff.

- Local verification is codified in the root verify script.
- CI runs the same verify path before exporting deployment artifacts.
- Topology artifacts are published into docs and preview public assets for direct download.

- package.json:31 - Root verify script is defined.
- .github/workflows/ci.yml:37 - CI runs the verify workflow.
- scripts/export-topology.mjs:17 - Topology export publishes docs assets.
- scripts/export-topology.mjs:18 - Topology export publishes preview assets.

### Worker analytics baseline [ready]

The auth and API workers now emit baseline request analytics for health, join, session, recording, moderation, and follow-up flows, which closes the previous zero-telemetry gap at the edge.

- Both Workers now declare Cloudflare Analytics Engine bindings.
- Shared helpers emit low-overhead route metrics with route, outcome, and client metadata.
- This is a baseline telemetry layer; external alert routing is still separate launch work.

- apps/auth-worker/wrangler.jsonc:30 - Auth worker declares an analytics dataset binding.
- apps/api-worker/wrangler.jsonc:31 - API worker declares an analytics dataset binding.
- apps/auth-worker/src/lib/analytics.ts:12 - Auth worker emits Analytics Engine datapoints.
- apps/api-worker/src/lib/analytics.ts:12 - API worker emits Analytics Engine datapoints.

### Fail-closed auth and media guardrails [ready]

Mock auth is disabled by default in production config, and the media worker now fails closed when upload or download bases are not configured.

- The auth worker no longer exposes the mock session path in production mode by default.
- Media download and upload routes return explicit configuration errors instead of placeholder URLs.

- apps/auth-worker/wrangler.jsonc:14 - Mock auth is disabled by default.
- apps/media-worker/src/index.ts:47 - Download route fails closed when not configured.
- apps/media-worker/src/index.ts:68 - Upload route fails closed when not configured.

### Media control-service boundary [ready]

The API worker now talks to the media worker over an explicit service binding, and the media worker proxies control requests to a dedicated backend only when configured.

- Recording control no longer returns synthetic ids inside the adapter itself.
- The media worker fails closed when no dedicated backend is configured.
- This is the correct architectural boundary for a real media plane, even though the backend is still not live.

- apps/api-worker/wrangler.jsonc:25 - API worker now binds to the media worker.
- apps/media-worker/src/index.ts:34 - Media worker exposes explicit control-plane routes.
- apps/media-worker/src/index.ts:123 - Media control fails closed when no backend is configured.
- packages/media-adapter/src/cloudflare-realtime.ts:24 - Media adapter now calls the control boundary instead of generating ids locally.

### Signed media control-plane auth [ready]

Media control requests are now signed from the API boundary and verified by the media worker instead of leaving those public control routes effectively open.

- The shared media adapter now signs control-plane payloads with a timestamped HMAC.
- The media worker rejects unsigned or invalid control requests before proxying to a backend.
- This closes an important control-plane trust gap even though the real backend is still not configured.

- packages/media-adapter/src/control-auth.ts:12 - Media adapter now creates signed control-plane headers.
- packages/media-adapter/src/control-auth.ts:31 - Media worker can verify signed control-plane requests.
- apps/media-worker/src/index.ts:95 - Media worker now verifies signed control-plane requests before proxying.
- apps/api-worker/wrangler.jsonc:17 - API scaffold now carries a dedicated shared secret for media control signing.

### Persistence runtime signals [ready]

The API now exposes whether durable persistence is selected, configured, and launch-ready, which makes preview and docs much more honest about the database rollout state.

- Health now reports the active data mode.
- Health distinguishes between database configuration and actual persistence readiness.
- This reduces ambiguity before the full Postgres repository implementation lands.

- apps/api-worker/wrangler.jsonc:16 - API scaffold now carries an explicit database connection placeholder.
- apps/api-worker/src/routes/health.ts:13 - API health reports whether database connectivity is configured.
- apps/api-worker/src/routes/health.ts:14 - API health reports whether persistence is actually ready for launch.

### Persistence mode guardrails [ready]

If Postgres mode is selected before the durable adapter exists, the API now fails early with a clear 503 instead of leaking that mismatch through arbitrary route failures.

- The persistence availability decision now lives in one shared helper.
- The main router blocks non-health traffic before route execution when Postgres mode is unavailable.
- Repository access uses the same guard, which keeps direct route-level data access aligned with the top-level worker behavior.

- apps/api-worker/src/lib/data-status.ts:41 - API exposes a shared persistence-availability helper.
- apps/api-worker/src/lib/data-status.ts:51 - Unavailable Postgres mode now maps to a clear 503 error code.
- apps/api-worker/src/lib/data.ts:11 - Repository access uses the shared persistence guard.
- apps/api-worker/src/index.ts:65 - Top-level API routing blocks unavailable persistence mode before executing routes.

### Postgres runtime-state adapter [ready]

The DB package now has a real Postgres-backed persistence path that loads and commits request-scoped state instead of throwing not-implemented errors.

- The adapter now loads a runtime-state snapshot from Postgres and commits back through a versioned row.
- Existing repository behavior is reused against that request-scoped state, which keeps the product logic aligned between memory and Postgres modes.
- A dedicated migration now creates the runtime-state table required by the adapter.

- packages/db/src/adapters/postgres.ts:39 - Postgres adapter now loads persisted runtime state.
- packages/db/src/adapters/postgres.ts:129 - Postgres adapter now commits runtime state back to Postgres.
- packages/db/src/adapters/postgres.ts:141 - Adapter targets the runtime-state table instead of throwing not-implemented errors.
- packages/db/src/migrations/016_runtime_state.sql:1 - A dedicated migration now creates the runtime-state table.

### Database migration tooling [ready]

The repo now has a concrete migration workflow for provisioning the Postgres schema instead of leaving database bring-up as a manual, undocumented step.

- Root commands now expose database status and migration execution.
- The DB package tracks applied migrations in opsui_schema_migrations.
- This turns DATABASE_URL activation into an operational procedure instead of an ad hoc task.

- package.json:19 - Root workspace now exposes a database migration command.
- package.json:20 - Root workspace now exposes a database status command.
- packages/db/scripts/migrate.mjs:22 - Database migrations are tracked in a schema-migrations table.
- packages/db/scripts/status.mjs:51 - DB status command reports applied vs pending migrations.

### Signed scaffold session cookies [ready]

The auth scaffold no longer trusts any opaque cookie value. Mock sessions are now signed and verified before actor data is accepted by the app surfaces.

- Session issuance now creates a signed cookie payload instead of storing only a random id.
- Session reads verify the signature before treating the actor as authenticated.
- This is stronger than the original scaffold, even though a real identity provider is still required.

- apps/auth-worker/src/routes/session.ts:8 - Mock session issuance now signs the cookie payload.
- apps/auth-worker/src/routes/session-info.ts:4 - Session reads verify the signed cookie before authenticating.
- apps/auth-worker/wrangler.jsonc:17 - Auth worker now carries a signing secret setting.

### OIDC provider boundary [ready]

The auth worker now exposes provider-aware login, callback, and logout routes, with generic OIDC token and userinfo exchange scaffolding instead of only a local mock-session lane.

- The auth surface now has explicit OIDC login and callback routes.
- Callback handling exchanges an authorization code for tokens and derives a session from userinfo claims.
- Workspace mapping is still scaffolded, but the provider boundary is no longer missing.

- apps/auth-worker/src/index.ts:45 - Auth worker exposes an OIDC login route.
- apps/auth-worker/src/index.ts:57 - Auth worker exposes an OIDC callback route.
- apps/auth-worker/src/routes/oidc.ts:125 - OIDC callback performs an authorization-code exchange.
- apps/auth-worker/wrangler.jsonc:21 - Auth worker now carries OIDC configuration variables.

### Authoritative auth membership directory boundary [ready]

The auth worker now has an explicit membership directory boundary for OIDC and mock session issuance, instead of trusting provider claims and defaults alone.

- OIDC callback can now fail closed when a user has no configured membership entry.
- Mock session issuance can also require a configured membership record.
- Auth health now reports whether the membership directory exists and whether enforcement is active.

- apps/auth-worker/src/lib/membership-directory.ts:45 - Auth worker now resolves membership through a dedicated directory helper.
- apps/auth-worker/src/lib/membership-directory.ts:33 - Membership enforcement policy is centralized in the auth worker.
- apps/auth-worker/wrangler.jsonc:19 - Auth worker scaffold now carries a membership directory variable.
- apps/auth-worker/src/routes/oidc.ts:228 - OIDC callback now fails closed when no membership entry exists.
- apps/auth-worker/src/routes/health.ts:21 - Auth health now reports directory configuration and enforcement state.

### Configurable OIDC workspace resolution [ready]

OIDC callback handling can now derive the workspace from a configured claim or email-domain map instead of always forcing every authenticated user into the default workspace.

- Workspace resolution can come from an explicit OIDC claim.
- A domain-to-workspace map can be used when claim-based routing is unavailable.
- This reduces tenant coupling, even though full membership and role enforcement are still not complete.

- apps/auth-worker/src/routes/oidc.ts:395 - OIDC callback now resolves workspace through a helper instead of hardcoding the default workspace.
- apps/auth-worker/src/routes/oidc.ts:408 - Workspace resolution can use a configured OIDC claim.
- apps/auth-worker/src/routes/oidc.ts:454 - Workspace resolution can fall back to an email-domain map.

### OIDC workspace and role guardrails [ready]

OIDC callback handling now fails closed for disallowed workspaces and carries a mapped workspace role into the signed session instead of treating every authenticated user as equally trusted.

- Workspace access can now be restricted to an explicit allowlist.
- A role claim or default role can be normalized into the session actor.
- This is still not a substitute for database-backed membership enforcement, but it is much closer to a real production boundary.

- apps/auth-worker/src/routes/oidc.ts:244 - OIDC callback now checks an explicit workspace allowlist.
- apps/auth-worker/src/routes/oidc.ts:399 - OIDC callback now maps a workspace role into the session actor.
- apps/auth-worker/src/routes/oidc.ts:253 - Disallowed workspace resolution now fails closed.
- apps/auth-worker/wrangler.jsonc:24 - Auth worker config exposes allowed workspace ids.

### Realtime signaling and room-state primitives [ready]

The realtime worker now supports direct offer/answer/ICE relay plus room snapshot propagation, which moves it beyond a pure hand-raise presence channel.

- Participants can relay WebRTC signaling messages through the Durable Object.
- Room snapshots now include lock and recording state and can be requested or broadcast on change.
- This is still not a full production media plane, but it is a more credible realtime control foundation.

- apps/realtime-worker/src/durable/RoomCoordinator.ts:28 - Realtime coordinator can relay offer messages.
- apps/realtime-worker/src/durable/RoomCoordinator.ts:29 - Realtime coordinator can relay answer messages.
- apps/realtime-worker/src/durable/RoomCoordinator.ts:30 - Realtime coordinator can relay ICE candidates.
- apps/realtime-worker/src/durable/RoomCoordinator.ts:105 - Realtime coordinator can publish room snapshots.

### Realtime backend control sync [ready]

The realtime worker can now accept backend room-state patches and the API pushes join, moderation, recording, and lifecycle updates into it, so websocket room state no longer drifts as easily from backend truth.

- The Durable Object now exposes an internal state-sync route in addition to websocket handling.
- API room lifecycle routes now best-effort sync lock, lobby, admit, remove, recording, and end-meeting state into realtime.
- Realtime health now reports control-sync readiness separately from raw websocket availability.

- apps/realtime-worker/src/durable/RoomCoordinator.ts:60 - Realtime coordinator now accepts internal state-sync requests.
- apps/realtime-worker/src/durable/RoomCoordinator.ts:72 - Realtime coordinator can merge backend room-state patches into the live snapshot.
- apps/api-worker/src/lib/realtime.ts:4 - API worker now has a helper for syncing backend state into realtime.
- apps/realtime-worker/src/index.ts:19 - Realtime health now reports control-sync readiness.

### Edge rate-limit baseline [ready]

The public auth and API edges now have explicit request throttles for join, mock session, and hook-trigger surfaces instead of relying on no abuse controls at all.

- Join-token and mock-session issuance are rate limited in the auth worker.
- Meeting join and hook-trigger routes are rate limited in the API worker.
- This is still a local fixed-window baseline, but it closes the previous zero-control gap.

- apps/auth-worker/src/lib/rate-limit.ts:37 - Auth worker now exposes a shared rate-limit helper.
- apps/auth-worker/src/index.ts:20 - Auth join-token issuance is rate limited.
- apps/api-worker/src/lib/rate-limit.ts:32 - API worker now exposes a shared rate-limit helper.
- apps/api-worker/src/routes/join.ts:18 - Meeting join is rate limited.

### Preview smoke runner [ready]

The repo now includes an env-driven smoke runner for deployed preview surfaces, so ops can validate bound hostnames and published artifacts without inventing one-off checks.

- Worker surfaces are checked through their health endpoints.
- Docs and preview Pages surfaces are checked for both page response and published topology/readiness assets.
- The runner is optional until preview host URLs are configured, which keeps local verification stable while still allowing CI execution.

- package.json:25 - Root package now exposes a preview smoke script.
- scripts/smoke-preview.mjs:25 - Preview smoke runner uses env-configured targets.
- scripts/smoke-preview.mjs:99 - Preview smoke runner verifies published readiness assets.
- .github/workflows/ci.yml:47 - CI can execute preview smoke checks when preview URLs are configured.


## Launch Blockers

### Durable persistence is not production-ready [blocked]

The Postgres code path now exists, but the checked-in API deployment scaffold still does not carry a real database connection string. Durable persistence still needs an actual bound database secret before production traffic should rely on it.

- The repository adapter is now wired to a real Postgres-backed runtime-state table.
- The checked-in worker config now selects Postgres mode, but still leaves DATABASE_URL empty for safety.
- The runtime health surface can prove whether database connectivity is configured and whether persistence is ready.
- Production launch should not proceed until DATABASE_URL is bound to a real durable database.

- apps/api-worker/wrangler.jsonc:15 - API worker now targets Postgres mode in the deployment scaffold.
- apps/api-worker/wrangler.jsonc:16 - The checked-in deployment scaffold still leaves the database connection unset.
- apps/api-worker/src/routes/health.ts:14 - API runtime health still reflects that persistence is not ready.
- packages/db/src/adapters/postgres.ts:141 - Postgres adapter now persists runtime state into a database table.

### Authoritative auth membership still needs production binding [blocked]

The auth layer now has signed sessions, an OIDC boundary, and a real membership-directory enforcement path, but the checked-in production scaffold still leaves that directory empty and the live identity provider still needs to be bound.

- Session integrity is stronger now because the cookie is signed and verified.
- OIDC callback can now fail closed on missing membership instead of trusting provider claims by default.
- The checked-in auth worker scaffold still leaves AUTH_MEMBERSHIP_DIRECTORY_JSON empty for safety.
- Production launch still needs live OIDC provider configuration and a real membership directory binding.

- apps/auth-worker/src/lib/membership-directory.ts:45 - Auth worker now has an authoritative membership directory helper.
- apps/auth-worker/src/routes/oidc.ts:228 - OIDC callback can now reject users without configured membership.
- apps/auth-worker/wrangler.jsonc:19 - The checked-in auth scaffold still leaves the membership directory empty.
- apps/auth-worker/wrangler.jsonc:21 - OIDC config knobs exist, but live provider values still need deployment-time binding.
- apps/auth-worker/src/index.ts:30 - Mock session route still exists behind an explicit flag for non-production testing.

### Media session and recording provider integration is still synthetic [blocked]

The media boundary and signed control-plane auth now exist, but the checked-in scaffold still leaves both the backend base URL and the shared control secret unset, so real session and recording operations cannot run yet.

- The API worker now calls the media worker over a real service binding instead of fabricating provider ids.
- The media worker now rejects unsigned control traffic and still fails closed until `MEDIA_BACKEND_BASE_URL` points at a real backend.
- The checked-in scaffolds still leave `MEDIA_CONTROL_SHARED_SECRET` empty in both API and media worker config.
- Screen share, recording, and playback cannot be treated as production-capable until that backend is live.

- apps/media-worker/src/index.ts:123 - Media worker still blocks control operations until a backend is configured.
- apps/media-worker/wrangler.jsonc:15 - Media backend base URL is still empty in the worker scaffold.
- apps/media-worker/wrangler.jsonc:16 - Media worker shared control secret is still empty in the worker scaffold.
- apps/api-worker/wrangler.jsonc:17 - API worker shared control secret is still empty in the worker scaffold.


## Prelaunch Hardening

### Deployed preview smoke execution still needs rollout wiring [pending]

The smoke runner now exists, but deployed preview host URLs and regular execution still need to be wired into an environment where those domains are actually live.

- Local and CI verification now support deployed preview smoke execution when preview URLs are configured.
- Launch readiness still needs those preview URLs to be provisioned and maintained against live preview domains.

- package.json:25 - Preview smoke runner now exists in the root package.
- .github/workflows/ci.yml:47 - CI can run preview smoke checks, but only after preview URLs are configured.

### External alerting and SLO rollout still need first-class work [pending]

Worker telemetry and in-product audit visibility now exist, but production launch still needs alert routing, thresholds, and SLO ownership outside the product UI.

- The product already exposes useful admin and room activity surfaces, and the Workers now emit baseline analytics datapoints.
- Production readiness still needs external alert routing, thresholding, dashboards, and on-call ownership outside the app surfaces.

- apps/auth-worker/src/lib/analytics.ts:12 - Auth worker telemetry baseline now exists.
- apps/api-worker/src/lib/analytics.ts:12 - API worker telemetry baseline now exists.
- apps/admin/src/FollowUpHooksPanel.tsx:113 - Admin UI already exposes failure triage.
- apps/admin/src/AuditList.tsx:1 - Admin audit view exists, but external monitoring is still separate work.

