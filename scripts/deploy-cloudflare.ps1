Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Require-Env {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "Required environment variable missing: $Name"
  }

  return $value
}

function Set-WranglerSecret {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ConfigPath,
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [string]$Value
  )

  $Value | corepack pnpm exec wrangler secret put $Name --config $ConfigPath
}

function Deploy-Worker {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ConfigPath
  )

  corepack pnpm exec wrangler deploy --config $ConfigPath
}

function Deploy-Pages {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectName,
    [Parameter(Mandatory = $true)]
    [string]$DistPath
  )

  corepack pnpm exec wrangler pages deploy $DistPath --project-name $ProjectName
}

Write-Host "Validating required environment variables..."

$databaseUrl = Require-Env "DATABASE_URL"
$mockSessionSigningSecret = Require-Env "MOCK_SESSION_SIGNING_SECRET"
$authMembershipDirectoryJson = Require-Env "AUTH_MEMBERSHIP_DIRECTORY_JSON"
$oidcIssuerUrl = Require-Env "OIDC_ISSUER_URL"
$oidcClientId = Require-Env "OIDC_CLIENT_ID"
$oidcClientSecret = Require-Env "OIDC_CLIENT_SECRET"
$oidcRedirectUri = Require-Env "OIDC_REDIRECT_URI"
$mediaBackendBaseUrl = Require-Env "MEDIA_BACKEND_BASE_URL"
$mediaControlSharedSecret = Require-Env "MEDIA_CONTROL_SHARED_SECRET"

Write-Host "Running database status and migrations..."
$env:DATABASE_URL = $databaseUrl
corepack pnpm db:status
corepack pnpm db:migrate

Write-Host "Setting API worker secrets..."
Set-WranglerSecret -ConfigPath "apps/api-worker/wrangler.jsonc" -Name "DATABASE_URL" -Value $databaseUrl
Set-WranglerSecret -ConfigPath "apps/api-worker/wrangler.jsonc" -Name "MEDIA_CONTROL_SHARED_SECRET" -Value $mediaControlSharedSecret

Write-Host "Setting auth worker secrets..."
Set-WranglerSecret -ConfigPath "apps/auth-worker/wrangler.jsonc" -Name "MOCK_SESSION_SIGNING_SECRET" -Value $mockSessionSigningSecret
Set-WranglerSecret -ConfigPath "apps/auth-worker/wrangler.jsonc" -Name "OIDC_CLIENT_SECRET" -Value $oidcClientSecret
Set-WranglerSecret -ConfigPath "apps/auth-worker/wrangler.jsonc" -Name "AUTH_MEMBERSHIP_DIRECTORY_JSON" -Value $authMembershipDirectoryJson

Write-Host "Setting media worker secrets..."
Set-WranglerSecret -ConfigPath "apps/media-worker/wrangler.jsonc" -Name "MEDIA_CONTROL_SHARED_SECRET" -Value $mediaControlSharedSecret

Write-Host "Deploying auth worker..."
$env:OIDC_ISSUER_URL = $oidcIssuerUrl
$env:OIDC_CLIENT_ID = $oidcClientId
$env:OIDC_REDIRECT_URI = $oidcRedirectUri
$env:AUTH_ENFORCE_MEMBERSHIP_DIRECTORY = "true"
Deploy-Worker -ConfigPath "apps/auth-worker/wrangler.jsonc"

Write-Host "Deploying realtime worker..."
Deploy-Worker -ConfigPath "apps/realtime-worker/wrangler.jsonc"

Write-Host "Deploying media worker..."
$env:MEDIA_BACKEND_BASE_URL = $mediaBackendBaseUrl
Deploy-Worker -ConfigPath "apps/media-worker/wrangler.jsonc"

Write-Host "Deploying API worker..."
Deploy-Worker -ConfigPath "apps/api-worker/wrangler.jsonc"

Write-Host "Deploying gateway worker..."
Deploy-Worker -ConfigPath "apps/gateway-worker/wrangler.jsonc"

Write-Host "Building frontend apps..."
corepack pnpm --filter @opsui/web build
corepack pnpm --filter @opsui/admin build
corepack pnpm --filter @opsui/docs build
corepack pnpm --filter @opsui/preview build

Write-Host "Deploying Pages apps..."
Deploy-Pages -ProjectName "opsui-meets-web" -DistPath "apps/web/dist"
Deploy-Pages -ProjectName "opsui-meets-admin" -DistPath "apps/admin/dist"
Deploy-Pages -ProjectName "opsui-meets-docs" -DistPath "apps/docs/dist"
Deploy-Pages -ProjectName "opsui-meets-preview" -DistPath "apps/preview/dist"

Write-Host "Running repo verification..."
corepack pnpm verify

if (-not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable("PREVIEW_SMOKE_API_URL"))) {
  Write-Host "Running deployed preview smoke checks..."
  corepack pnpm smoke:preview
} else {
  Write-Host "Skipping preview smoke because PREVIEW_SMOKE_*_URL variables are not configured."
}

Write-Host "Deployment helper completed."
