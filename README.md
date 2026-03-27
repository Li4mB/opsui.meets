# OpsUI Meets

Cloudflare-native foundation for the OpsUI Meets product family under `opsuimeets.com`.

## Workspace

- `apps/web`: main product UI
- `apps/admin`: internal admin UI
- `apps/docs`: documentation UI for `docs.opsuimeets.com`
- `apps/preview`: preview/staging UI for `preview.opsuimeets.com`
- `apps/api-worker`: edge API worker
- `apps/auth-worker`: auth/session worker
- `apps/gateway-worker`: public gateway worker
- `apps/realtime-worker`: websocket and Durable Object coordination
- `apps/media-worker`: media/upload placeholder worker
- `packages/shared-types`: shared contracts
- `packages/db`: repository layer, migrations, adapters
- `packages/media-adapter`: media provider boundary
- `packages/config`: shared config helpers

The canonical hostname and deployment surface map now lives in `packages/config/src/topology.ts`.
That map now also carries the expected Wrangler project names, worker service bindings, analytics bindings, Durable Objects, and required env vars used by verification.

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
corepack pnpm smoke:preview
corepack pnpm db:migrate
pwsh ./scripts/deploy-cloudflare.ps1
```

This runs:

- topology manifest consistency validation against the shared source config
- topology smoke validation against the shared deployment map
- readiness artifact validation against the current repository state
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
corepack pnpm dev:realtime
```

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
- Production auth still requires live OIDC provider values plus a real `AUTH_MEMBERSHIP_DIRECTORY_JSON` binding instead of the empty checked-in scaffold value.
- `AUTH_ENFORCE_MEMBERSHIP_DIRECTORY=true` in production config makes auth fail closed when an OIDC user or mock-auth request has no configured membership entry.
- The media layer now uses an explicit control-service boundary between the API worker and media worker. Real recording/session handling still requires a dedicated backend behind `MEDIA_BACKEND_BASE_URL`; the repo no longer pretends that synthetic ids are a real provider integration.
- API-to-media control requests are now HMAC-signed with `MEDIA_CONTROL_SHARED_SECRET`, and the media worker rejects unsigned control traffic before proxying to any backend.
- The API health payload now reports `dataMode`, `databaseConfigured`, and `persistenceReady`, which lets preview/docs show whether Postgres mode is merely selected or actually deployable.
- Worker builds use `wrangler deploy --dry-run` in CI and local verification. Real deployment still requires Cloudflare authentication and account-level resources.
- `corepack pnpm smoke:topology` validates the shared deployment map against worker/Page app files and worker health route declarations.
- `corepack pnpm export:topology` writes `opsui-meets.topology.json`, `opsui-meets.topology.md`, `opsui-meets.topology.csv`, `opsui-meets.topology.bundle.json`, and `opsui-meets.topology.sha256` from the same shared topology source for external deployment handoff.
- `corepack pnpm export:readiness` writes `opsui-meets.readiness.json` and `opsui-meets.readiness.md` from repository-derived launch readiness signals so product and ops can see what is still blocking production.
- `corepack pnpm smoke:preview` runs env-driven smoke checks against deployed preview targets when `PREVIEW_SMOKE_*_URL` variables are configured, and it now expects preview health to report `analyticsConfigured=true`, `persistenceReady=true`, `membershipDirectoryConfigured=true` when auth enforcement is enabled, and `controlPlaneReady=true` for the media worker.
- `pwsh ./scripts/deploy-cloudflare.ps1` is a deployment helper that runs DB migration, Worker secret setup, Worker deploys, Pages deploys, repo verify, and preview smoke once the required environment variables are present.
- `corepack pnpm smoke:manifest` checks that the committed topology artifacts still match the shared topology source.
- `corepack pnpm smoke:readiness` checks that the committed readiness artifacts still match the current repository state.
- `corepack pnpm smoke:published-assets` checks that the built docs/preview `dist` folders contain published copies of those topology artifacts.
- `corepack pnpm smoke:published-readiness` checks that the built docs/preview `dist` folders contain the published readiness JSON and markdown files.
- CI uploads the generated topology JSON, markdown, CSV, bundle, and checksum files as workflow artifacts after verification.
- CI also uploads the generated readiness JSON and markdown files as workflow artifacts after verification.
- `corepack pnpm export:topology` also publishes those artifacts into `apps/docs/public/` and `apps/preview/public/` so deployed Pages surfaces can expose the same handoff files.
- `corepack pnpm export:readiness` publishes the readiness JSON and markdown files into `apps/docs/public/` and `apps/preview/public/` for the same reason.
- Preview smoke target env names follow the topology kinds, for example `PREVIEW_SMOKE_PUBLIC_GATEWAY_URL`, `PREVIEW_SMOKE_API_URL`, `PREVIEW_SMOKE_DOCS_URL`, and `PREVIEW_SMOKE_PREVIEW_URL`.
- CI will also run `corepack pnpm smoke:preview` automatically when any `PREVIEW_SMOKE_*_URL` repository secret is configured.

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

## Auth Bring-Up

```powershell
$env:OIDC_ISSUER_URL="https://issuer.example.com"
$env:OIDC_CLIENT_ID="opsui-meets"
$env:OIDC_CLIENT_SECRET="replace-me"
$env:OIDC_REDIRECT_URI="https://auth.opsuimeets.com/v1/callback"
$env:AUTH_MEMBERSHIP_DIRECTORY_JSON='{"users":[{"email":"owner@example.com","workspaceId":"workspace_local","workspaceRole":"owner","providers":["oidc"]}]}'
```

After auth config is applied:

- bind the same OIDC settings into the deployed auth worker
- bind a real `AUTH_MEMBERSHIP_DIRECTORY_JSON` value for the target tenant/workspace set
- check `https://auth.opsuimeets.com/v1/health`
- confirm `oidcConfigured=true`, `membershipDirectoryConfigured=true`, and `membershipEnforced=true`
- validate sign-in through `app.opsuimeets.com` or `admin.opsuimeets.com`

## Current Guardrails

- Root CI workflow: `.github/workflows/ci.yml`
- Root verification command: `corepack pnpm verify`
- Allowed install-time native build dependencies are pinned via `pnpm.onlyBuiltDependencies`
