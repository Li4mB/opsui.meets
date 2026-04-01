# OpsUI Meets Cloudflare And Sentry Alerts

## Current Status

Cloudflare-side health and Analytics Engine telemetry are live now.

Sentry SDK wiring now exists in:

- `apps/web`
- `apps/api-worker`
- `apps/auth-worker`

Sentry still remains effectively inactive until the corresponding DSNs and release values are configured.

## Cloudflare Alert Checklist

Create uptime/health alerts for these endpoints:

- `https://opsuimeets.com/v1/health`
- `https://api.opsuimeets.com/v1/health`
- `https://auth.opsuimeets.com/v1/health`
- `https://ws.opsuimeets.com/v1/health`
- `https://media.opsuimeets.com/v1/health`
- `https://opsui-meets-media-control.liambarrry.workers.dev/v1/health`

Recommended alert names:

- `[prod] opsui gateway health down`
- `[prod] opsui api health down`
- `[prod] opsui auth health down`
- `[prod] opsui realtime health down`
- `[prod] opsui media health down`
- `[prod] opsui media-control health down`

Recommended health assertions:

- gateway: `ok=true`
- api: `ok=true`, `analyticsConfigured=true`, `databaseConfigured=true`, `persistenceReady=true`
- auth: `ok=true`, `oidcConfigured=true`, `membershipDirectoryConfigured=true`, `membershipEnforced=true`, `analyticsConfigured=true`
- media: `ok=true`, `controlPlaneAuthConfigured=true`, `controlPlaneReady=true`
- media-control: `ok=true`, `realtimeConfigured=true`, `controlSecretConfigured=true`

## Cloudflare Dashboard Query Set

These queries assume the Workers Analytics Engine dataset bound as `ANALYTICS`.

Field map for auth worker events from [analytics.ts](c:/Users/daabo/OneDrive/Documents/OpsUI/opsui.meets/apps/auth-worker/src/lib/analytics.ts):

- `blob1`: worker name, always `auth-worker`
- `blob2`: route
- `blob3`: method
- `blob4`: outcome
- `blob5`: session type
- `blob6`: client IP
- `double1`: HTTP status
- `double2`: timestamp in ms

Field map for API worker events from [analytics.ts](c:/Users/daabo/OneDrive/Documents/OpsUI/opsui.meets/apps/api-worker/src/lib/analytics.ts):

- `blob1`: worker name, always `api-worker`
- `blob2`: route
- `blob3`: method
- `blob4`: outcome
- `blob5`: workspace ID
- `blob6`: client IP
- `double1`: HTTP status
- `double2`: timestamp in ms

Use these as the default dashboard panels.

### Auth request volume by route

```sql
SELECT
  blob2 AS route,
  SUM(_sample_interval) AS request_count
FROM ANALYTICS
WHERE blob1 = 'auth-worker'
  AND timestamp > NOW() - INTERVAL '15' MINUTE
GROUP BY route
ORDER BY request_count DESC
```

### Auth failures by route and outcome

```sql
SELECT
  blob2 AS route,
  blob4 AS outcome,
  AVG(double1) AS average_status,
  SUM(_sample_interval) AS event_count
FROM ANALYTICS
WHERE blob1 = 'auth-worker'
  AND double1 >= 400
  AND timestamp > NOW() - INTERVAL '1' HOUR
GROUP BY route, outcome
ORDER BY event_count DESC
```

### API failures by route and outcome

```sql
SELECT
  blob2 AS route,
  blob4 AS outcome,
  AVG(double1) AS average_status,
  SUM(_sample_interval) AS event_count
FROM ANALYTICS
WHERE blob1 = 'api-worker'
  AND double1 >= 500
  AND timestamp > NOW() - INTERVAL '1' HOUR
GROUP BY route, outcome
ORDER BY event_count DESC
```

### Join flow outcomes

```sql
SELECT
  blob4 AS outcome,
  SUM(_sample_interval) AS event_count
FROM ANALYTICS
WHERE blob1 = 'api-worker'
  AND blob2 = 'join-meeting'
  AND timestamp > NOW() - INTERVAL '1' HOUR
GROUP BY outcome
ORDER BY event_count DESC
```

### Auth callback and logout outcomes

```sql
SELECT
  blob2 AS route,
  blob4 AS outcome,
  SUM(_sample_interval) AS event_count
FROM ANALYTICS
WHERE blob1 = 'auth-worker'
  AND blob2 IN ('oidc-callback', 'session-logout', 'session-info')
  AND timestamp > NOW() - INTERVAL '1' HOUR
GROUP BY route, outcome
ORDER BY event_count DESC
```

### Workspace hotspots

```sql
SELECT
  blob5 AS workspace_id,
  SUM(_sample_interval) AS request_count
FROM ANALYTICS
WHERE blob1 = 'api-worker'
  AND timestamp > NOW() - INTERVAL '1' HOUR
GROUP BY workspace_id
ORDER BY request_count DESC
LIMIT 20
```

### Blocked guest joins

```sql
SELECT
  blob4 AS outcome,
  SUM(_sample_interval) AS event_count
FROM ANALYTICS
WHERE blob1 = 'api-worker'
  AND blob2 = 'join-meeting'
  AND blob4 IN ('blocked', 'guest_join_disabled', 'room_locked')
  AND timestamp > NOW() - INTERVAL '6' HOUR
GROUP BY outcome
ORDER BY event_count DESC
```

## Cloudflare Triage Order

When an alert fires:

1. Run `corepack pnpm smoke:production`.
2. Check the failing health endpoint directly.
3. Run Wrangler tail against the implicated worker.
4. Check the dashboard queries above for route and outcome spikes.
5. If the issue is auth or join related, manually recheck `/sign-in`, signed-in join, and guest join in the browser.

## Sentry Alert Checklist

Apply these once the DSNs are configured and events begin flowing:

Projects to create:

- `opsui-meets-web`
- `opsui-meets-api`
- `opsui-meets-auth`

Suggested environments:

- `production`
- `preview`
- `development`

Recommended issue alerts:

- `[prod] api new unhandled exception`
  Condition: new issue in project `opsui-meets-api`, environment `production`
- `[prod] auth new unhandled exception`
  Condition: new issue in project `opsui-meets-auth`, environment `production`
- `[prod] web auth or room regression`
  Condition: issue in project `opsui-meets-web`, environment `production`, URL/tag contains `/sign-in` or meeting route, event frequency above 5 in 15 minutes

Recommended metric alerts after performance instrumentation exists:

- `[prod] auth callback error spike`
  Condition: error events on callback/login path exceed 10 in 10 minutes
- `[prod] join flow failure spike`
  Condition: meeting join failures exceed 10 in 10 minutes
- `[prod] browser room crash spike`
  Condition: frontend fatal errors in the meeting room exceed 5 in 10 minutes

Suggested release checklist:

- mark deploys with a release version
- watch Sentry for 30 minutes after each production deploy
- compare Sentry issue volume against `corepack pnpm smoke:production`
- page immediately if Cloudflare health is green but Sentry shows fast-growing frontend/auth failures

## Honest Gap

The Cloudflare side is actionable now because the health endpoints and Analytics Engine datapoints already exist. Sentry is now wired in code, but it still needs real DSNs, release wiring, and project-level alert rules before it becomes operationally useful.
