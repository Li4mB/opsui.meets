# OpsUI Meets Observability Runbook

## Health Endpoints

Check these first during deploys or incidents:

- `https://opsuimeets.com/v1/health`
- `https://api.opsuimeets.com/v1/health`
- `https://auth.opsuimeets.com/v1/health`
- `https://ws.opsuimeets.com/v1/health`
- `https://media.opsuimeets.com/v1/health`
- `https://opsui-meets-media-control.liambarrry.workers.dev/v1/health`

Expected high-signal fields:

- API: `ok`, `dataMode`, `databaseConfigured`, `persistenceReady`, `analyticsConfigured`
- Auth: `ok`, `oidcConfigured`, `membershipDirectoryConfigured`, `membershipEnforced`, `analyticsConfigured`
- Media: `ok`, `controlPlaneAuthConfigured`, `controlPlaneReady`
- Media control: `ok`, `realtimeConfigured`

## Edge Analytics Shape

Auth worker datapoints from [apps/auth-worker/src/lib/analytics.ts](c:/Users/daabo/OneDrive/Documents/OpsUI/opsui.meets/apps/auth-worker/src/lib/analytics.ts):

- blobs: `["auth-worker", route, method, outcome, sessionType, clientIp]`
- doubles: `[status, timestampMs]`
- indexes: `[route]`

API worker datapoints from [apps/api-worker/src/lib/analytics.ts](c:/Users/daabo/OneDrive/Documents/OpsUI/opsui.meets/apps/api-worker/src/lib/analytics.ts):

- blobs: `["api-worker", route, method, outcome, workspaceId, clientIp]`
- doubles: `[status, timestampMs]`
- indexes: `[route]`

Routes already emitting baseline telemetry include:

- auth: `health`, `session-info`, `session-mock`, `oidc-callback`, `session-logout`, `join-token`
- api: `health`, `join-meeting`, moderation, recordings, media session, follow-up hooks

## Tail Commands

Use Wrangler tail during live debugging:

```powershell
corepack pnpm exec wrangler tail --config apps/api-worker/wrangler.jsonc
corepack pnpm exec wrangler tail --config apps/auth-worker/wrangler.jsonc
corepack pnpm exec wrangler tail --config apps/media-worker/wrangler.jsonc
corepack pnpm exec wrangler tail --config apps/media-control-worker/wrangler.jsonc
corepack pnpm exec wrangler tail --config apps/realtime-worker/wrangler.jsonc
```

Focus first on:

- unhandled exceptions
- repeated 401/403 on auth flows
- repeated 5xx on `join-meeting` or `media-session`
- spikes in `join.blocked`, `room_locked`, or `guest_join_disabled`

## Launch-Day Smoke

Run these after each production deploy:

1. `corepack pnpm verify`
2. `corepack pnpm smoke:production`
3. Open `/sign-in` and confirm a real signed-in session can be created.
4. Start a meeting while signed in and confirm direct entry with host controls.
5. Sign out and confirm the session returns to `Guest`.
6. Start a meeting while signed out and confirm the guest-name modal appears.
7. Check the six health endpoints above for green status and expected config flags.

The production smoke command validates:

- `opsuimeets.com`
- `app.opsuimeets.com`
- `admin.opsuimeets.com`
- `docs.opsuimeets.com`
- `preview.opsuimeets.com`
- worker health on `api`, `auth`, `realtime`, `media`
- the media-control worker health endpoint
- published docs/preview topology and readiness assets

Use env overrides if you need to target alternates:

- `PRODUCTION_SMOKE_PUBLIC_GATEWAY_URL`
- `PRODUCTION_SMOKE_APP_URL`
- `PRODUCTION_SMOKE_API_URL`
- `PRODUCTION_SMOKE_AUTH_URL`
- `PRODUCTION_SMOKE_REALTIME_URL`
- `PRODUCTION_SMOKE_MEDIA_URL`
- `PRODUCTION_SMOKE_ADMIN_URL`
- `PRODUCTION_SMOKE_DOCS_URL`
- `PRODUCTION_SMOKE_PREVIEW_URL`
- `PRODUCTION_SMOKE_MEDIA_CONTROL_URL`

## Alerts And Dashboards

Use `runbooks/cloudflare-sentry-alerts.md` for the concrete Cloudflare alert checklist, Analytics Engine query set, and the Sentry rule template list.

## Suggested Alert Priorities

Page immediately:

- any health endpoint returns non-200
- `oidcConfigured=false` in production auth health
- `databaseConfigured=false` or `persistenceReady=false` in API health
- `controlPlaneReady=false` in media health

Investigate quickly:

- sudden increase in auth 401/403 outcomes after deploy
- repeated `join-meeting` 5xx
- repeated media session failures
- sign-out or callback regressions reported by browser checks

## Current Gap

The repo now emits baseline edge telemetry, has repeatable browser coverage, and includes Sentry SDK wiring for web/api/auth. External dashboards, DSNs, and paging rules still need to be configured in Cloudflare and Sentry before the full alerting layer is live.
