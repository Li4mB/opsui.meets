# OpsUI Meets Deployment Topology

Source: `packages/config/src/topology.ts`

| Surface | Hostname | Product | Wrangler | Workspace | Health | Runtime bindings |
| --- | --- | --- | --- | --- | --- | --- |
| public-gateway | opsuimeets.com | workers | opsui-meets-gateway | apps/gateway-worker | https://opsuimeets.com/v1/health | AUTH_SERVICE -> opsui-meets-auth<br>API_SERVICE -> opsui-meets-api |
| app | app.opsuimeets.com | pages | opsui-meets-web | apps/web | - | - |
| api | api.opsuimeets.com | workers | opsui-meets-api | apps/api-worker | https://api.opsuimeets.com/v1/health | REALTIME_SERVICE -> opsui-meets-realtime<br>MEDIA_SERVICE -> opsui-meets-media<br>analytics:ANALYTICS<br>env:APP_ENV<br>env:APP_DATA_MODE |
| realtime | ws.opsuimeets.com | workers | opsui-meets-realtime | apps/realtime-worker | https://ws.opsuimeets.com/v1/health | do:ROOM_COORDINATOR -> RoomCoordinator |
| media | media.opsuimeets.com | workers | opsui-meets-media | apps/media-worker | https://media.opsuimeets.com/v1/health | MEDIA_CONTROL_SERVICE -> opsui-meets-media-control |
| auth | auth.opsuimeets.com | workers | opsui-meets-auth | apps/auth-worker | https://auth.opsuimeets.com/v1/health | analytics:ANALYTICS<br>env:COOKIE_DOMAIN<br>env:ALLOW_MOCK_AUTH<br>env:APP_ENV<br>env:DEFAULT_WORKSPACE_ID<br>env:AUTH_ENFORCE_MEMBERSHIP_DIRECTORY<br>env:OIDC_SCOPE<br>env:OIDC_WORKSPACE_CLAIM<br>env:OIDC_EMAIL_DOMAIN_WORKSPACE_MAP<br>env:OIDC_ALLOWED_WORKSPACE_IDS<br>env:OIDC_ROLE_CLAIM<br>env:OIDC_DEFAULT_ROLE |
| admin | admin.opsuimeets.com | pages | opsui-meets-admin | apps/admin | - | - |
| docs | docs.opsuimeets.com | pages | opsui-meets-docs | apps/docs | - | - |
| preview | preview.opsuimeets.com | pages | opsui-meets-preview | apps/preview | - | - |

Generated from the shared topology config. Do not edit manually.
