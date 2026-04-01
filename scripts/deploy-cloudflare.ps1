Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Import-DotEnv {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }

  Get-Content -LiteralPath $Path | ForEach-Object {
    $line = $_.Trim()
    if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith("#")) {
      return
    }

    $pair = $line -split "=", 2
    if ($pair.Length -ne 2) {
      return
    }

    $name = $pair[0].Trim()
    if ([string]::IsNullOrWhiteSpace($name)) {
      return
    }

    $value = $pair[1]
    if (
      ($value.StartsWith('"') -and $value.EndsWith('"')) -or
      ($value.StartsWith("'") -and $value.EndsWith("'"))
    ) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    [Environment]::SetEnvironmentVariable($name, $value)
  }
}

function Get-OptionalEnv {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    return $null
  }

  return $value
}

Import-DotEnv -Path (Join-Path $PSScriptRoot "..\.env")

function Require-Env {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  $value = Get-OptionalEnv -Name $Name
  if ($null -eq $value) {
    throw "Required environment variable missing: $Name"
  }

  return $value
}

function Get-EnvOrDefault {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [AllowEmptyString()]
    [string]$Default
  )

  $value = Get-OptionalEnv -Name $Name
  if ($null -eq $value) {
    return $Default
  }

  return $value
}

function Invoke-CheckedCorepack {
  param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
  )

  & corepack @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed: corepack $($Arguments -join ' ')"
  }
}

function Set-WranglerVersionSecret {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ConfigPath,
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [string]$Value,
    [Parameter(Mandatory = $true)]
    [string]$Message
  )

  $output = $Value | corepack pnpm exec wrangler versions secret put $Name --config $ConfigPath --message $Message 2>&1
  $exitCode = $LASTEXITCODE

  $output | ForEach-Object { Write-Host $_ }

  if ($exitCode -ne 0) {
    throw "Failed to create Worker version secret '$Name' for $ConfigPath"
  }

  $match = [regex]::Match(($output -join "`n"), "Created version ([0-9a-fA-F-]+) with secret")
  if (-not $match.Success) {
    throw "Unable to determine created Worker version for secret '$Name' in $ConfigPath"
  }

  return $match.Groups[1].Value
}

function Deploy-WranglerVersion {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ConfigPath,
    [Parameter(Mandatory = $true)]
    [string]$VersionId,
    [Parameter(Mandatory = $true)]
    [string]$Message
  )

  Invoke-CheckedCorepack pnpm exec wrangler versions deploy "$VersionId@100" --config $ConfigPath --message $Message --yes
}

function Add-OptionalVar {
  param(
    [Parameter(Mandatory = $true)]
    [hashtable]$Vars,
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [string]$Value
  )

  if (-not [string]::IsNullOrWhiteSpace($Value)) {
    $Vars[$Name] = $Value
  }
}

function Deploy-Worker {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ConfigPath,
    [hashtable]$Vars = @{}
  )

  $args = @("pnpm", "exec", "wrangler", "deploy", "--config", $ConfigPath)
  foreach ($entry in ($Vars.GetEnumerator() | Sort-Object Key)) {
    $args += "--var"
    $args += "$($entry.Key):$($entry.Value)"
  }

  Invoke-CheckedCorepack @args
}

function Deploy-Pages {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectName,
    [Parameter(Mandatory = $true)]
    [string]$DistPath
  )

  Invoke-CheckedCorepack pnpm exec wrangler pages deploy $DistPath --project-name $ProjectName
}

Write-Host "Validating required environment variables..."

$databaseUrl = Require-Env "DATABASE_URL"
$mockSessionSigningSecret = Require-Env "MOCK_SESSION_SIGNING_SECRET"
$authMembershipDirectoryJson = Require-Env "AUTH_MEMBERSHIP_DIRECTORY_JSON"
$oidcIssuerUrl = Require-Env "OIDC_ISSUER_URL"
$oidcClientId = Require-Env "OIDC_CLIENT_ID"
$oidcClientSecret = Require-Env "OIDC_CLIENT_SECRET"
$oidcRedirectUri = Require-Env "OIDC_REDIRECT_URI"
$mediaControlSharedSecret = Require-Env "MEDIA_CONTROL_SHARED_SECRET"
$cloudflareRealtimeAccountId = Require-Env "CF_REALTIME_ACCOUNT_ID"
$cloudflareRealtimeAppId = Require-Env "CF_REALTIME_APP_ID"
$cloudflareRealtimeApiToken = Require-Env "CF_REALTIME_API_TOKEN"

$appEnv = Get-EnvOrDefault "DEPLOY_APP_ENV" "production"
$appDataMode = Get-EnvOrDefault "APP_DATA_MODE" "postgres"
$cookieDomain = Get-EnvOrDefault "DEPLOY_COOKIE_DOMAIN" ".opsuimeets.com"
$publicAppUrl = Get-EnvOrDefault "PUBLIC_APP_URL" "https://opsuimeets.com"
$allowMockAuth = Get-EnvOrDefault "ALLOW_MOCK_AUTH" "false"
$defaultWorkspaceId = Get-EnvOrDefault "DEFAULT_WORKSPACE_ID" "workspace_local"
$mockAuthDefaultEmail = Get-OptionalEnv "MOCK_AUTH_DEFAULT_EMAIL"
$authEnforceMembershipDirectory = Get-EnvOrDefault "AUTH_ENFORCE_MEMBERSHIP_DIRECTORY" "true"
$oidcScope = Get-EnvOrDefault "OIDC_SCOPE" "openid profile email"
$oidcAuthorizationEndpoint = Get-OptionalEnv "OIDC_AUTHORIZATION_ENDPOINT"
$oidcTokenEndpoint = Get-OptionalEnv "OIDC_TOKEN_ENDPOINT"
$oidcUserinfoEndpoint = Get-OptionalEnv "OIDC_USERINFO_ENDPOINT"
$oidcWorkspaceClaim = Get-EnvOrDefault "OIDC_WORKSPACE_CLAIM" "workspace_id"
$oidcEmailDomainWorkspaceMap = Get-EnvOrDefault "OIDC_EMAIL_DOMAIN_WORKSPACE_MAP" "{}"
$oidcAllowedWorkspaceIds = Get-EnvOrDefault "OIDC_ALLOWED_WORKSPACE_IDS" ""
$oidcRoleClaim = Get-EnvOrDefault "OIDC_ROLE_CLAIM" "role"
$oidcDefaultRole = Get-EnvOrDefault "OIDC_DEFAULT_ROLE" "participant"
$apiSentryDsn = Get-OptionalEnv "API_SENTRY_DSN"
$apiSentryRelease = Get-OptionalEnv "API_SENTRY_RELEASE"
$apiSentryTracesSampleRate = Get-OptionalEnv "API_SENTRY_TRACES_SAMPLE_RATE"
$authSentryDsn = Get-OptionalEnv "AUTH_SENTRY_DSN"
$authSentryRelease = Get-OptionalEnv "AUTH_SENTRY_RELEASE"
$authSentryTracesSampleRate = Get-OptionalEnv "AUTH_SENTRY_TRACES_SAMPLE_RATE"
$mediaDownloadBaseUrl = Get-OptionalEnv "MEDIA_DOWNLOAD_BASE_URL"
$mediaUploadBaseUrl = Get-OptionalEnv "MEDIA_UPLOAD_BASE_URL"
$mediaBackendBaseUrl = Get-OptionalEnv "MEDIA_BACKEND_BASE_URL"
$cloudflareRealtimeMeetingPreset = Get-OptionalEnv "CF_REALTIME_MEETING_PRESET"
$cloudflareRealtimeHostParticipantPreset = Get-OptionalEnv "CF_REALTIME_HOST_PARTICIPANT_PRESET"
$cloudflareRealtimeAttendeeParticipantPreset = Get-OptionalEnv "CF_REALTIME_ATTENDEE_PARTICIPANT_PRESET"
$cloudflareRealtimeMeetingPrefix = Get-EnvOrDefault "CF_REALTIME_MEETING_PREFIX" "opsui-meets"

$authVars = @{
  "ALLOW_MOCK_AUTH" = $allowMockAuth
  "APP_ENV" = $appEnv
  "AUTH_ENFORCE_MEMBERSHIP_DIRECTORY" = $authEnforceMembershipDirectory
  "COOKIE_DOMAIN" = $cookieDomain
  "DEFAULT_WORKSPACE_ID" = $defaultWorkspaceId
  "OIDC_ALLOWED_WORKSPACE_IDS" = $oidcAllowedWorkspaceIds
  "OIDC_CLIENT_ID" = $oidcClientId
  "OIDC_DEFAULT_ROLE" = $oidcDefaultRole
  "OIDC_EMAIL_DOMAIN_WORKSPACE_MAP" = $oidcEmailDomainWorkspaceMap
  "OIDC_ISSUER_URL" = $oidcIssuerUrl
  "PUBLIC_APP_URL" = $publicAppUrl
  "OIDC_REDIRECT_URI" = $oidcRedirectUri
  "OIDC_ROLE_CLAIM" = $oidcRoleClaim
  "OIDC_SCOPE" = $oidcScope
  "OIDC_WORKSPACE_CLAIM" = $oidcWorkspaceClaim
  "SENTRY_ENVIRONMENT" = $appEnv
}
Add-OptionalVar -Vars $authVars -Name "MOCK_AUTH_DEFAULT_EMAIL" -Value $mockAuthDefaultEmail
Add-OptionalVar -Vars $authVars -Name "OIDC_AUTHORIZATION_ENDPOINT" -Value $oidcAuthorizationEndpoint
Add-OptionalVar -Vars $authVars -Name "OIDC_TOKEN_ENDPOINT" -Value $oidcTokenEndpoint
Add-OptionalVar -Vars $authVars -Name "OIDC_USERINFO_ENDPOINT" -Value $oidcUserinfoEndpoint
Add-OptionalVar -Vars $authVars -Name "SENTRY_DSN" -Value $authSentryDsn
Add-OptionalVar -Vars $authVars -Name "SENTRY_RELEASE" -Value $authSentryRelease
Add-OptionalVar -Vars $authVars -Name "SENTRY_TRACES_SAMPLE_RATE" -Value $authSentryTracesSampleRate

$apiVars = @{
  "APP_DATA_MODE" = $appDataMode
  "APP_ENV" = $appEnv
  "SENTRY_ENVIRONMENT" = $appEnv
}
Add-OptionalVar -Vars $apiVars -Name "SENTRY_DSN" -Value $apiSentryDsn
Add-OptionalVar -Vars $apiVars -Name "SENTRY_RELEASE" -Value $apiSentryRelease
Add-OptionalVar -Vars $apiVars -Name "SENTRY_TRACES_SAMPLE_RATE" -Value $apiSentryTracesSampleRate

$mediaVars = @{}
Add-OptionalVar -Vars $mediaVars -Name "MEDIA_BACKEND_BASE_URL" -Value $mediaBackendBaseUrl
Add-OptionalVar -Vars $mediaVars -Name "MEDIA_DOWNLOAD_BASE_URL" -Value $mediaDownloadBaseUrl
Add-OptionalVar -Vars $mediaVars -Name "MEDIA_UPLOAD_BASE_URL" -Value $mediaUploadBaseUrl

$mediaControlVars = @{
  "CLOUDFLARE_REALTIME_ACCOUNT_ID" = $cloudflareRealtimeAccountId
  "CLOUDFLARE_REALTIME_APP_ID" = $cloudflareRealtimeAppId
  "CLOUDFLARE_REALTIME_MEETING_PREFIX" = $cloudflareRealtimeMeetingPrefix
}
Add-OptionalVar -Vars $mediaControlVars -Name "CLOUDFLARE_REALTIME_ATTENDEE_PARTICIPANT_PRESET" -Value $cloudflareRealtimeAttendeeParticipantPreset
Add-OptionalVar -Vars $mediaControlVars -Name "CLOUDFLARE_REALTIME_HOST_PARTICIPANT_PRESET" -Value $cloudflareRealtimeHostParticipantPreset
Add-OptionalVar -Vars $mediaControlVars -Name "CLOUDFLARE_REALTIME_MEETING_PRESET" -Value $cloudflareRealtimeMeetingPreset

Write-Host "Exporting generated topology and readiness artifacts..."
Invoke-CheckedCorepack pnpm export:topology
Invoke-CheckedCorepack pnpm export:readiness

Write-Host "Running database status and migrations..."
$env:DATABASE_URL = $databaseUrl
Invoke-CheckedCorepack pnpm db:status
Invoke-CheckedCorepack pnpm db:migrate

Write-Host "Deploying auth worker..."
Deploy-Worker -ConfigPath "apps/auth-worker/wrangler.jsonc" -Vars $authVars

Write-Host "Attaching auth worker secrets to the freshly uploaded version..."
$authVersionId = Set-WranglerVersionSecret -ConfigPath "apps/auth-worker/wrangler.jsonc" -Name "MOCK_SESSION_SIGNING_SECRET" -Value $mockSessionSigningSecret -Message "Attach MOCK_SESSION_SIGNING_SECRET"
$authVersionId = Set-WranglerVersionSecret -ConfigPath "apps/auth-worker/wrangler.jsonc" -Name "OIDC_CLIENT_SECRET" -Value $oidcClientSecret -Message "Attach OIDC_CLIENT_SECRET"
$authVersionId = Set-WranglerVersionSecret -ConfigPath "apps/auth-worker/wrangler.jsonc" -Name "AUTH_MEMBERSHIP_DIRECTORY_JSON" -Value $authMembershipDirectoryJson -Message "Attach AUTH_MEMBERSHIP_DIRECTORY_JSON"
Deploy-WranglerVersion -ConfigPath "apps/auth-worker/wrangler.jsonc" -VersionId $authVersionId -Message "Deploy auth worker with secrets"

Write-Host "Deploying realtime worker..."
Deploy-Worker -ConfigPath "apps/realtime-worker/wrangler.jsonc"

Write-Host "Deploying media-control worker..."
Deploy-Worker -ConfigPath "apps/media-control-worker/wrangler.jsonc" -Vars $mediaControlVars

Write-Host "Attaching media-control worker secrets to the freshly uploaded version..."
$mediaControlVersionId = Set-WranglerVersionSecret -ConfigPath "apps/media-control-worker/wrangler.jsonc" -Name "MEDIA_CONTROL_SHARED_SECRET" -Value $mediaControlSharedSecret -Message "Attach MEDIA_CONTROL_SHARED_SECRET"
$mediaControlVersionId = Set-WranglerVersionSecret -ConfigPath "apps/media-control-worker/wrangler.jsonc" -Name "CLOUDFLARE_REALTIME_API_TOKEN" -Value $cloudflareRealtimeApiToken -Message "Attach CLOUDFLARE_REALTIME_API_TOKEN"
Deploy-WranglerVersion -ConfigPath "apps/media-control-worker/wrangler.jsonc" -VersionId $mediaControlVersionId -Message "Deploy media-control worker with secrets"

Write-Host "Deploying media worker..."
Deploy-Worker -ConfigPath "apps/media-worker/wrangler.jsonc" -Vars $mediaVars

Write-Host "Attaching media worker secrets to the freshly uploaded version..."
$mediaVersionId = Set-WranglerVersionSecret -ConfigPath "apps/media-worker/wrangler.jsonc" -Name "MEDIA_CONTROL_SHARED_SECRET" -Value $mediaControlSharedSecret -Message "Attach MEDIA_CONTROL_SHARED_SECRET"
Deploy-WranglerVersion -ConfigPath "apps/media-worker/wrangler.jsonc" -VersionId $mediaVersionId -Message "Deploy media worker with secrets"

Write-Host "Deploying API worker..."
Deploy-Worker -ConfigPath "apps/api-worker/wrangler.jsonc" -Vars $apiVars

Write-Host "Attaching API worker secrets to the freshly uploaded version..."
$apiVersionId = Set-WranglerVersionSecret -ConfigPath "apps/api-worker/wrangler.jsonc" -Name "DATABASE_URL" -Value $databaseUrl -Message "Attach DATABASE_URL"
$apiVersionId = Set-WranglerVersionSecret -ConfigPath "apps/api-worker/wrangler.jsonc" -Name "MEDIA_CONTROL_SHARED_SECRET" -Value $mediaControlSharedSecret -Message "Attach MEDIA_CONTROL_SHARED_SECRET"
Deploy-WranglerVersion -ConfigPath "apps/api-worker/wrangler.jsonc" -VersionId $apiVersionId -Message "Deploy API worker with secrets"

Write-Host "Deploying gateway worker..."
Deploy-Worker -ConfigPath "apps/gateway-worker/wrangler.jsonc"

Write-Host "Building frontend apps..."
Invoke-CheckedCorepack pnpm --filter @opsui/web build
Invoke-CheckedCorepack pnpm --filter @opsui/admin build
Invoke-CheckedCorepack pnpm --filter @opsui/docs build
Invoke-CheckedCorepack pnpm --filter @opsui/preview build

Write-Host "Deploying Pages apps..."
Deploy-Pages -ProjectName "opsui-meets-web" -DistPath "apps/web/dist"
Deploy-Pages -ProjectName "opsui-meets-admin" -DistPath "apps/admin/dist"
Deploy-Pages -ProjectName "opsui-meets-docs" -DistPath "apps/docs/dist"
Deploy-Pages -ProjectName "opsui-meets-preview" -DistPath "apps/preview/dist"

Write-Host "Running repo verification..."
Invoke-CheckedCorepack pnpm verify

$previewSmokeConfigured =
  @(
    "PREVIEW_SMOKE_PUBLIC_GATEWAY_URL",
    "PREVIEW_SMOKE_API_URL",
    "PREVIEW_SMOKE_AUTH_URL",
    "PREVIEW_SMOKE_DOCS_URL",
    "PREVIEW_SMOKE_PREVIEW_URL"
  ) |
  ForEach-Object { Get-OptionalEnv -Name $_ } |
  Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
  Select-Object -First 1

if ($null -ne $previewSmokeConfigured) {
  Write-Host "Running deployed preview smoke checks..."
  Invoke-CheckedCorepack pnpm smoke:preview
} else {
  Write-Host "Skipping preview smoke because PREVIEW_SMOKE_*_URL variables are not configured."
}

Write-Host "Deployment helper completed."
