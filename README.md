# OpsUI Meets

Cloudflare-native foundation for the OpsUI Meets product family under `opsuimeets.com`.

## Workspace

- `apps/web`: routed product UI for the landing page, sign-in flow, and meeting rooms
- `apps/admin`: internal admin UI
- `apps/docs`: documentation UI for `docs.opsuimeets.com`
- `apps/preview`: preview/staging UI for `preview.opsuimeets.com`
- `apps/api-worker`: edge API worker
- `apps/auth-worker`: auth/session worker
- `apps/gateway-worker`: public gateway worker that fronts `opsuimeets.com`, proxies SPA routes to `apps/web`, and preserves legacy join links
- `apps/realtime-worker`: websocket and Durable Object coordination
- `apps/media-worker`: media/upload placeholder worker
- `apps/media-control-worker`: internal Realtime control worker for meetings and recordings
- `packages/shared-types`: shared contracts
- `packages/db`: repository layer, migrations, adapters
- `packages/media-adapter`: media provider boundary
- `packages/config`: shared config helpers

The canonical hostname and deployment surface map now lives in `packages/config/src/topology.ts`.
That map now also carries the expected Wrangler project names, worker service bindings, analytics bindings, Durable Objects, and required env vars used by verification.

## Web Experience

The primary user-facing meeting app is now a minimal, route-based SPA with a shared header and sidebar shell:

- `/`: landing page with `Join Meeting` and `Start Meeting`
- `/sign-in`: auth status, OIDC login, logout, and optional mock-auth controls for local development
- `/:meetingCode`: full-screen meeting room with guest-name modal, auth-aware auto-join, participant/lobby state, moderation controls, and activity feed
- `/join?room=...`: legacy path that normalizes into `/:meetingCode`

Inside `apps/web/src`, the running UI is organized around:

- `components/AppLayout.tsx`: shared header + sidebar shell
- `components/Modal.tsx`: shared overlay/modal primitive
- `pages/HomePage.tsx`: landing flow
- `pages/SignInPage.tsx`: sign-in page
- `pages/MeetingRoomPage.tsx`: meeting room UI
- `lib/router.ts`: lightweight pathname router
- `lib/meetings.ts`: room-code resolution and meeting-room data loading
- `lib/auth.ts` and `lib/commands.ts`: preserved auth/session and meeting command integrations

Meeting codes are currently the room slug already used by existing join links. The meeting room resolves the slug to a room, then attaches to the latest meeting instance for that room using the existing API surface.

## Prerequisites

- Node.js 24.x
- Corepack enabled

## Setup

```powershell
corepack enable
corepack pnpm install
corepack pnpm db:status
```

## Verify

```powershell
corepack pnpm verify
corepack pnpm export:topology
corepack pnpm export:readiness
corepack pnpm smoke:production
corepack pnpm smoke:preview
corepack pnpm db:migrate
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\deploy-cloudflare.ps1
```

This runs:

- topology manifest consistency validation against the shared source config
- topology smoke validation against the shared deployment map
- readiness artifact validation against the current repository state
- optional production smoke validation against the live deployment surfaces
- workspace typecheck
- Vite production builds for web, admin, docs, and preview
- `wrangler deploy --dry-run` for Workers

## Local Development

```powershell
corepack pnpm dev:web
corepack pnpm dev:admin
corepack pnpm dev:docs
corepack pnpm dev:api
corepack pnpm dev:auth
corepack pnpm dev:media-control
corepack pnpm dev:realtime
```

### Local Web QA

When `apps/web` runs on `http://127.0.0.1:4173` or `http://localhost:4173`, the frontend points at the local worker ports already baked into `apps/web/src/lib/config.ts`:

- API: `http://127.0.0.1:8787`
- Auth: `http://127.0.0.1:8788`
- Realtime: disabled locally unless a dedicated local websocket endpoint is wired in

For local redesign and QA work:

- `/sign-in` exposes a development sign-in path on localhost when real OIDC or worker-side mock auth is unavailable
- guest users still stay on `/:meetingCode` and get the in-room display-name modal
- signed-in users auto-join with their account-derived display name

Useful local checks:

```powershell
corepack pnpm --filter @opsui/web typecheck
corepack pnpm --filter @opsui/web build
corepack pnpm typecheck
```

The web app also supports local endpoint overrides through Vite env vars:

- `VITE_API_BASE_URL`
- `VITE_AUTH_BASE_URL`
- `VITE_REALTIME_BASE_URL`
- `VITE_SENTRY_DSN`
- `VITE_SENTRY_ENVIRONMENT`
- `VITE_SENTRY_RELEASE`
- `VITE_SENTRY_TRACES_SAMPLE_RATE`

That makes it possible to run browser tests or alternate local fixtures without colliding with your normal worker ports.

### E2E Browser Tests

The repo now includes Playwright coverage for the redesigned web flows. The test harness starts:

- the web app on `http://127.0.0.1:4173`
- deterministic local API/auth fixtures on `http://127.0.0.1:9877` and `http://127.0.0.1:9878`

Install the browser once:

```powershell
corepack pnpm test:e2e:install
```

Run the suite:

```powershell
corepack pnpm test:e2e
```

The suite covers:

- landing page `Start Meeting`
- landing page `Join Meeting`
- legacy `/join?room=...` normalization
- guest join flow
- signed-in auto-join flow
- sign-in state and sign-out regression coverage
- shared mobile sidebar behavior

If you capture browser debugging artifacts locally, keep them under `output/playwright/` so they stay out of the main workspace.

## Deployment Notes

- Worker custom domains are configured at the hostname level, not `/*` path patterns.
- Vite frontends include Pages-style `_headers` and `_redirects` files under `public/` for SPA fallback and baseline headers.
- Frontend surfaces now include Pages Wrangler config files with `pages_build_output_dir=./dist` for `web`, `admin`, `docs`, and `preview`.
- `apps/realtime-worker` includes Durable Object migration `v1` for `RoomCoordinator`.
- `apps/api-worker` now targets `APP_DATA_MODE=postgres` in the scaffold, but `DATABASE_URL` is intentionally blank in checked-in config.
- Durable persistence is implemented through `packages/db/src/adapters/postgres.ts` and `packages/db/src/migrations/016_runtime_state.sql`.
- Use `corepack pnpm db:status` to see applied vs pending migrations for the configured `DATABASE_URL`.
- Use `corepack pnpm db:migrate` to create `opsui_schema_migrations`, apply the SQL files under `packages/db/src/migrations`, and bring up the runtime-state table.
- The auth worker now includes an OIDC-shaped `login` / `callback` / `logout` boundary, a signed session cookie path, and a membership-directory enforcement path.
- Sentry wiring is now available in `apps/web`, `apps/api-worker`, and `apps/auth-worker`; it stays dormant until the corresponding DSNs are configured.
- Production auth still requires live OIDC provider values plus a real `AUTH_MEMBERSHIP_DIRECTORY_JSON` binding instead of the empty checked-in scaffold value.
- `AUTH_ENFORCE_MEMBERSHIP_DIRECTORY=true` in production config makes auth fail closed when an OIDC user or mock-auth request has no configured membership entry.
- The media layer now uses an explicit control-service boundary between the API worker and media worker, and the media worker can now bind directly to the internal `apps/media-control-worker` service. `MEDIA_BACKEND_BASE_URL` remains available as an external-backend fallback.
- The internal media-control worker is designed for Cloudflare RealtimeKit account/app credentials and Durable Object-backed meeting mapping; it still needs live Realtime credentials before production media control is ready.
- API-to-media control requests are now HMAC-signed with `MEDIA_CONTROL_SHARED_SECRET`, and the media worker rejects unsigned control traffic before proxying to any backend or internal control service.
- The API health payload now reports `dataMode`, `databaseConfigured`, and `persistenceReady`, which lets preview/docs show whether Postgres mode is merely selected or actually deployable.
- Worker builds use `wrangler deploy --dry-run` in CI and local verification. Real deployment still requires Cloudflare authentication and account-level resources.
- `corepack pnpm smoke:topology` validates the shared deployment map against worker/Page app files and worker health route declarations.
- `corepack pnpm export:topology` writes `opsui-meets.topology.json`, `opsui-meets.topology.md`, `opsui-meets.topology.csv`, `opsui-meets.topology.bundle.json`, and `opsui-meets.topology.sha256` from the same shared topology source for external deployment handoff.
- `corepack pnpm export:readiness` writes `opsui-meets.readiness.json` and `opsui-meets.readiness.md` from repository-derived launch readiness signals so product and ops can see what is still blocking production.
- `corepack pnpm smoke:preview` runs env-driven smoke checks against deployed preview targets when `PREVIEW_SMOKE_*_URL` variables are configured, and it now expects preview health to report `analyticsConfigured=true`, `persistenceReady=true`, `membershipDirectoryConfigured=true` when auth enforcement is enabled, and `controlPlaneReady=true` for the media worker.
- `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\deploy-cloudflare.ps1` is a deployment helper that runs DB migration, Worker deploys, versioned Worker secret rollout, Pages deploys, repo verify, and preview smoke once the required environment variables are present.
- The deploy helper now exports the generated topology/readiness artifacts before Pages builds so docs/preview ship the current repo state and deploy verification does not fail on stale published copies.
- The deploy helper now deploys `auth`, `realtime`, `media-control`, `media`, `api`, and `gateway` in dependency order, rolls secrets onto versioned Worker deployments, and uses `DEPLOY_APP_ENV` / `DEPLOY_COOKIE_DOMAIN` for deploy-only overrides instead of leaking local `.env` values into production.
- Worker-side Sentry deploy vars are `API_SENTRY_DSN`, `API_SENTRY_RELEASE`, `API_SENTRY_TRACES_SAMPLE_RATE`, `AUTH_SENTRY_DSN`, `AUTH_SENTRY_RELEASE`, and `AUTH_SENTRY_TRACES_SAMPLE_RATE`.
- `corepack pnpm smoke:manifest` checks that the committed topology artifacts still match the shared topology source.
- `corepack pnpm smoke:readiness` checks that the committed readiness artifacts still match the current repository state.
- `corepack pnpm smoke:published-assets` checks that the built docs/preview `dist` folders contain published copies of those topology artifacts.
- `corepack pnpm smoke:published-readiness` checks that the built docs/preview `dist` folders contain the published readiness JSON and markdown files.
- CI now installs Chromium and runs the Playwright browser regression suite before `corepack pnpm verify`.
- CI uploads the generated topology JSON, markdown, CSV, bundle, and checksum files as workflow artifacts after verification.
- CI also uploads the generated readiness JSON and markdown files as workflow artifacts after verification.
- CI also uploads `output/playwright` artifacts so failed browser regressions can be debugged from the workflow run.
- `corepack pnpm smoke:production` validates the live production domains and health surfaces using default `opsuimeets.com` hosts, with optional `PRODUCTION_SMOKE_*_URL` overrides.
- `corepack pnpm export:topology` also publishes those artifacts into `apps/docs/public/` and `apps/preview/public/` so deployed Pages surfaces can expose the same handoff files.
- `corepack pnpm export:readiness` publishes the readiness JSON and markdown files into `apps/docs/public/` and `apps/preview/public/` for the same reason.
- Preview smoke target env names follow the topology kinds, for example `PREVIEW_SMOKE_PUBLIC_GATEWAY_URL`, `PREVIEW_SMOKE_API_URL`, `PREVIEW_SMOKE_DOCS_URL`, and `PREVIEW_SMOKE_PREVIEW_URL`.
- CI will also run `corepack pnpm smoke:preview` automatically when any `PREVIEW_SMOKE_*_URL` repository secret is configured.

## Observability Runbook

The repo now includes an ops checklist in `runbooks/observability.md` covering:

- production health endpoints to watch
- Analytics Engine event shapes emitted by the auth and API workers
- recommended tail commands during incidents
- launch-day smoke checks and alert priorities

## Database Bring-Up

```powershell
$env:DATABASE_URL="postgres://user:password@host:5432/opsui_meets"
corepack pnpm db:status
corepack pnpm db:migrate
```

After migrations are applied:

- bind the same `DATABASE_URL` into the deployed API worker
- deploy `apps/api-worker`
- check `https://api.opsuimeets.com/v1/health`
- confirm `dataMode=postgres`, `databaseConfigured=true`, and `persistenceReady=true`
- rerun `corepack pnpm smoke:preview` against deployed preview URLs

## Media Bring-Up

```powershell
$env:MEDIA_CONTROL_SHARED_SECRET="replace-me"
$env:CF_REALTIME_ACCOUNT_ID="replace-me"
$env:CF_REALTIME_APP_ID="replace-me"
$env:CF_REALTIME_API_TOKEN="replace-me"
```

Optional media vars:

- `MEDIA_DOWNLOAD_BASE_URL` and `MEDIA_UPLOAD_BASE_URL` if you want signed upload/download URLs exposed by `media.opsuimeets.com`
- `MEDIA_BACKEND_BASE_URL` only when you want `apps/media-worker` to proxy to an external backend instead of the internal `apps/media-control-worker`
- `CF_REALTIME_MEETING_PRESET`, `CF_REALTIME_HOST_PARTICIPANT_PRESET`, and `CF_REALTIME_ATTENDEE_PARTICIPANT_PRESET` if your RealtimeKit account uses named presets

After media config is applied:

- deploy `apps/media-control-worker` before `apps/media-worker`
- bind `MEDIA_CONTROL_SHARED_SECRET` into `apps/api-worker`, `apps/media-worker`, and `apps/media-control-worker`
- bind `CLOUDFLARE_REALTIME_ACCOUNT_ID`, `CLOUDFLARE_REALTIME_APP_ID`, and `CLOUDFLARE_REALTIME_API_TOKEN` into `apps/media-control-worker`
- check `https://media.opsuimeets.com/v1/health`
- confirm `controlPlaneAuthConfigured=true` and `controlPlaneReady=true`
- check the media-control worker health endpoint from Wrangler or its `workers.dev` URL and confirm `realtimeConfigured=true`

## Launch Order

1. Set production secrets and runtime vars from `.env.example`, including Postgres, OIDC, membership directory, and media control credentials.
2. Run `corepack pnpm db:status` and `corepack pnpm db:migrate` against the production `DATABASE_URL`.
3. Deploy Workers in dependency order: `auth`, `realtime`, `media-control`, `media`, `api`, then `gateway`.
4. Build and deploy Pages apps: `web`, `admin`, `docs`, and `preview`.
5. Run `corepack pnpm verify`.
6. Run `corepack pnpm smoke:preview` against deployed preview/public URLs.
7. Complete launch review with real sign-in, room join, moderation, recording, and observability checks.

## Auth Bring-Up

```powershell
$env:OIDC_ISSUER_URL="https://issuer.example.com"
$env:OIDC_CLIENT_ID="opsui-meets"
$env:OIDC_CLIENT_SECRET="replace-me"
$env:OIDC_REDIRECT_URI="https://auth.opsuimeets.com/v1/callback"
$env:AUTH_MEMBERSHIP_DIRECTORY_JSON='{"users":[{"email":"owner@example.com","workspaceId":"workspace_local","workspaceRole":"owner","providers":["oidc"]}]}'
$env:AUTH_SENTRY_DSN=""
$env:API_SENTRY_DSN=""
```

After auth config is applied:

- bind the same OIDC settings into the deployed auth worker
- for Auth0, use your tenant or custom-domain issuer URL and not `https://manage.auth0.com/`
- set `PUBLIC_APP_URL=https://opsuimeets.com` so the auth callback returns to the main meeting app instead of the auth subdomain
- bind a real `AUTH_MEMBERSHIP_DIRECTORY_JSON` value for the target tenant/workspace set
- check `https://auth.opsuimeets.com/v1/health`
- confirm `oidcConfigured=true`, `membershipDirectoryConfigured=true`, and `membershipEnforced=true`
- validate sign-in through `app.opsuimeets.com` or `admin.opsuimeets.com`

## Current Guardrails

- Root CI workflow: `.github/workflows/ci.yml`
- Root verification command: `corepack pnpm verify`
- Ops runbooks: `runbooks/observability.md` and `runbooks/cloudflare-sentry-alerts.md`
- Allowed install-time native build dependencies are pinned via `pnpm.onlyBuiltDependencies`
