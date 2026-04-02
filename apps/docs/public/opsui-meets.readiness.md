# OpsUI Meets Readiness Report

Generated at: 2026-04-01T11:07:03.365Z

Overall status: ready_for_launch_review

Recommended next step: Run launch review against deployed preview and complete final compliance checks.

## Summary

- Ready foundations: 14
- Launch blockers: 0
- Prelaunch hardening items: 2

## Ready Foundations

### Workspace verification and deployment artifacts [ready]

The repo already has an enforced verification path, CI execution, and exported topology artifacts for deployment handoff.

- Local verification is codified in the root verify script.
- CI runs the same verify path before exporting deployment artifacts.
- Topology artifacts are published into docs and preview public assets for direct download.

- package.json:36 - Root verify script is defined.
- .github/workflows/ci.yml:43 - CI runs the verify workflow.
- scripts/export-topology.mjs:17 - Topology export publishes docs assets.
- scripts/export-topology.mjs:18 - Topology export publishes preview assets.

### Worker analytics baseline [ready]

The auth and API workers now emit baseline request analytics for health, join, session, recording, moderation, and follow-up flows, which closes the previous zero-telemetry gap at the edge.

- Both Workers now declare Cloudflare Analytics Engine bindings.
- Shared helpers emit low-overhead route metrics with route, outcome, and client metadata.
- This is a baseline telemetry layer; external alert routing is still separate launch work.

- apps/auth-worker/wrangler.jsonc:30 - Auth worker declares an analytics dataset binding.
- apps/api-worker/wrangler.jsonc:29 - API worker declares an analytics dataset binding.
- apps/auth-worker/src/lib/analytics.ts:12 - Auth worker emits Analytics Engine datapoints.
- apps/api-worker/src/lib/analytics.ts:12 - API worker emits Analytics Engine datapoints.

### Fail-closed auth and media guardrails [ready]

Mock auth is disabled by default in production config, and the media worker now fails closed when upload or download bases are not configured.

- The auth worker no longer exposes the mock session path in production mode by default.
- Media download and upload routes return explicit configuration errors instead of placeholder URLs.

- apps/auth-worker/wrangler.jsonc:16 - Mock auth is disabled by default.
- apps/media-worker/src/index.ts:49 - Download route fails closed when not configured.
- apps/media-worker/src/index.ts:70 - Upload route fails closed when not configured.

### Media control-service boundary [ready]

The API worker now talks to the media worker over an explicit service binding, and the media worker proxies control requests to a dedicated backend only when configured.

- Recording control no longer returns synthetic ids inside the adapter itself.
- The media worker fails closed when no dedicated backend is configured.
- This is the correct architectural boundary for a real media plane, even though the backend is still not live.

- apps/api-worker/wrangler.jsonc:23 - API worker now binds to the media worker.
- apps/media-worker/src/index.ts:36 - Media worker exposes explicit control-plane routes.
- apps/media-worker/src/index.ts:125 - Media control fails closed when no backend is configured.
- packages/media-adapter/src/cloudflare-realtime.ts:24 - Media adapter now calls the control boundary instead of generating ids locally.

### Persistence mode guardrails [ready]

If Postgres mode is selected before the durable adapter exists, the API now fails early with a clear 503 instead of leaking that mismatch through arbitrary route failures.

- The persistence availability decision now lives in one shared helper.
- The main router blocks non-health traffic before route execution when Postgres mode is unavailable.
- Repository access uses the same guard, which keeps direct route-level data access aligned with the top-level worker behavior.

- apps/api-worker/src/lib/data-status.ts:41 - API exposes a shared persistence-availability helper.
- apps/api-worker/src/lib/data-status.ts:51 - Unavailable Postgres mode now maps to a clear 503 error code.
- apps/api-worker/src/lib/data.ts:11 - Repository access uses the shared persistence guard.
- apps/api-worker/src/index.ts:77 - Top-level API routing blocks unavailable persistence mode before executing routes.

### Postgres runtime-state adapter [ready]

The DB package now has a real Postgres-backed persistence path that loads and commits request-scoped state instead of throwing not-implemented errors.

- The adapter now loads a runtime-state snapshot from Postgres and commits back through a versioned row.
- Existing repository behavior is reused against that request-scoped state, which keeps the product logic aligned between memory and Postgres modes.
- A dedicated migration now creates the runtime-state table required by the adapter.

- packages/db/src/adapters/postgres.ts:50 - Postgres adapter now loads persisted runtime state.
- packages/db/src/adapters/postgres.ts:147 - Postgres adapter now commits runtime state back to Postgres.
- packages/db/src/adapters/postgres.ts:162 - Adapter targets the runtime-state table instead of throwing not-implemented errors.
- packages/db/src/migrations/016_runtime_state.sql:1 - A dedicated migration now creates the runtime-state table.

### Database migration tooling [ready]

The repo now has a concrete migration workflow for provisioning the Postgres schema instead of leaving database bring-up as a manual, undocumented step.

- Root commands now expose database status and migration execution.
- The DB package tracks applied migrations in opsui_schema_migrations.
- This turns DATABASE_URL activation into an operational procedure instead of an ad hoc task.

- package.json:20 - Root workspace now exposes a database migration command.
- package.json:21 - Root workspace now exposes a database status command.
- packages/db/scripts/migrate.mjs:24 - Database migrations are tracked in a schema-migrations table.
- packages/db/scripts/status.mjs:53 - DB status command reports applied vs pending migrations.

### OIDC provider boundary [ready]

The auth worker now exposes provider-aware login, callback, and logout routes, with generic OIDC token and userinfo exchange scaffolding instead of only a local mock-session lane.

- The auth surface now has explicit OIDC login and callback routes.
- Callback handling exchanges an authorization code for tokens and derives a session from userinfo claims.
- Workspace mapping is still scaffolded, but the provider boundary is no longer missing.

- apps/auth-worker/src/index.ts:57 - Auth worker exposes an OIDC login route.
- apps/auth-worker/src/index.ts:70 - Auth worker exposes an OIDC callback route.
- apps/auth-worker/src/routes/oidc.ts:125 - OIDC callback performs an authorization-code exchange.
- apps/auth-worker/wrangler.jsonc:21 - Auth worker now carries OIDC configuration variables.

### Configurable OIDC workspace resolution [ready]

OIDC callback handling can now derive the workspace from a configured claim or email-domain map instead of always forcing every authenticated user into the default workspace.

- Workspace resolution can come from an explicit OIDC claim.
- A domain-to-workspace map can be used when claim-based routing is unavailable.
- This reduces tenant coupling, even though full membership and role enforcement are still not complete.

- apps/auth-worker/src/routes/oidc.ts:454 - OIDC callback now resolves workspace through a helper instead of hardcoding the default workspace.
- apps/auth-worker/src/routes/oidc.ts:467 - Workspace resolution can use a configured OIDC claim.
- apps/auth-worker/src/routes/oidc.ts:513 - Workspace resolution can fall back to an email-domain map.

### OIDC workspace and role guardrails [ready]

OIDC callback handling now fails closed for disallowed workspaces and carries a mapped workspace role into the signed session instead of treating every authenticated user as equally trusted.

- Workspace access can now be restricted to an explicit allowlist.
- A role claim or default role can be normalized into the session actor.
- This is still not a substitute for database-backed membership enforcement, but it is much closer to a real production boundary.

- apps/auth-worker/src/routes/oidc.ts:244 - OIDC callback now checks an explicit workspace allowlist.
- apps/auth-worker/src/routes/oidc.ts:458 - OIDC callback now maps a workspace role into the session actor.
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
- apps/auth-worker/src/index.ts:30 - Auth join-token issuance is rate limited.
- apps/api-worker/src/lib/rate-limit.ts:32 - API worker now exposes a shared rate-limit helper.
- apps/api-worker/src/routes/join.ts:18 - Meeting join is rate limited.

### Preview smoke runner [ready]

The repo now includes an env-driven smoke runner for deployed preview surfaces, so ops can validate bound hostnames and published artifacts without inventing one-off checks.

- Worker surfaces are checked through their health endpoints.
- Docs and preview Pages surfaces are checked for both page response and published topology/readiness assets.
- The runner is optional until preview host URLs are configured, which keeps local verification stable while still allowing CI execution.

- package.json:27 - Root package now exposes a preview smoke script.
- scripts/smoke-preview.mjs:25 - Preview smoke runner uses env-configured targets.
- scripts/smoke-preview.mjs:99 - Preview smoke runner verifies published readiness assets.
- .github/workflows/ci.yml:53 - CI can execute preview smoke checks when preview URLs are configured.


## Launch Blockers

None.


## Prelaunch Hardening

### Deployed preview smoke execution still needs rollout wiring [pending]

The smoke runner now exists, but deployed preview host URLs and regular execution still need to be wired into an environment where those domains are actually live.

- Local and CI verification now support deployed preview smoke execution when preview URLs are configured.
- Launch readiness still needs those preview URLs to be provisioned and maintained against live preview domains.

- package.json:27 - Preview smoke runner now exists in the root package.
- .github/workflows/ci.yml:53 - CI can run preview smoke checks, but only after preview URLs are configured.

### External alerting and SLO rollout still need first-class work [pending]

Worker telemetry and in-product audit visibility now exist, but production launch still needs alert routing, thresholds, and SLO ownership outside the product UI.

- The product already exposes useful admin and room activity surfaces, and the Workers now emit baseline analytics datapoints.
- Production readiness still needs external alert routing, thresholding, dashboards, and on-call ownership outside the app surfaces.

- apps/auth-worker/src/lib/analytics.ts:12 - Auth worker telemetry baseline now exists.
- apps/api-worker/src/lib/analytics.ts:12 - API worker telemetry baseline now exists.
- apps/admin/src/FollowUpHooksPanel.tsx:113 - Admin UI already exposes failure triage.
- apps/admin/src/AuditList.tsx:1 - Admin audit view exists, but external monitoring is still separate work.

