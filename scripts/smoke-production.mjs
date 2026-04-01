import path from "node:path";
import { loadTopology } from "./load-topology.mjs";

const rootDir = path.resolve(import.meta.dirname, "..");
const { OPSUI_MEETS_SURFACES } = await loadTopology(rootDir);

const passes = [];
const failures = [];

const targets = OPSUI_MEETS_SURFACES.map((surface) => ({
  kind: surface.kind,
  surface,
  url: normalizeBaseUrl(process.env[getEnvName(surface.kind)] ?? `https://${surface.hostname}`),
}));

targets.push({
  kind: "media-control",
  surface: null,
  url: normalizeBaseUrl(
    process.env.PRODUCTION_SMOKE_MEDIA_CONTROL_URL ??
      "https://opsui-meets-media-control.liambarrry.workers.dev",
  ),
});

for (const target of targets) {
  try {
    if (target.kind === "media-control") {
      await checkMediaControl(target.url);
      continue;
    }

    const { surface, url } = target;
    if (surface.cloudflareProduct === "workers") {
      await checkWorkerSurface(surface.kind, url, surface.healthPath);
      continue;
    }

    await checkPageSurface(surface.kind, url);

    if (surface.kind === "docs" || surface.kind === "preview") {
      for (const assetPath of ["/opsui-meets.topology.json", "/opsui-meets.readiness.json"]) {
        const assetUrl = new URL(assetPath, url);
        const response = await fetch(assetUrl);
        if (!response.ok) {
          failures.push(`${surface.kind}: ${response.status} from ${assetUrl}`);
          continue;
        }

        passes.push(`${surface.kind}: asset check passed via ${assetUrl}`);
      }
    }
  } catch (error) {
    failures.push(`${target.kind}: request failed for ${target.url} (${formatError(error)})`);
  }
}

for (const pass of passes) {
  console.log(`PASS ${pass}`);
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`FAIL ${failure}`);
  }
  process.exit(1);
}

console.log(`Validated ${passes.length} production smoke checks across ${targets.length} targets.`);

async function checkWorkerSurface(kind, baseUrl, healthPath) {
  if (!healthPath) {
    failures.push(`${kind}: missing healthPath`);
    return;
  }

  const healthUrl = new URL(healthPath, baseUrl);
  const response = await fetch(healthUrl);
  if (!response.ok) {
    failures.push(`${kind}: ${response.status} from ${healthUrl}`);
    return;
  }

  const payload = await response.json().catch(() => null);
  if (!payload || payload.ok !== true) {
    failures.push(`${kind}: health response from ${healthUrl} was not ok=true JSON`);
    return;
  }

  if ((kind === "api" || kind === "auth") && payload.analyticsConfigured !== true) {
    failures.push(`${kind}: health response from ${healthUrl} did not report analyticsConfigured=true`);
    return;
  }

  if (kind === "api" && payload.persistenceReady !== true) {
    failures.push(`${kind}: health response from ${healthUrl} did not report persistenceReady=true`);
    return;
  }

  if (kind === "auth") {
    if (payload.oidcConfigured !== true) {
      failures.push(`auth: health response from ${healthUrl} did not report oidcConfigured=true`);
      return;
    }

    if (payload.membershipDirectoryConfigured !== true || payload.membershipEnforced !== true) {
      failures.push(
        `auth: health response from ${healthUrl} did not report membershipDirectoryConfigured=true and membershipEnforced=true`,
      );
      return;
    }
  }

  if (kind === "media" && payload.controlPlaneReady !== true) {
    failures.push(`${kind}: health response from ${healthUrl} did not report controlPlaneReady=true`);
    return;
  }

  passes.push(`${kind}: health check passed via ${healthUrl}`);
}

async function checkMediaControl(baseUrl) {
  const healthUrl = new URL("/v1/health", baseUrl);
  const response = await fetch(healthUrl);
  if (!response.ok) {
    failures.push(`media-control: ${response.status} from ${healthUrl}`);
    return;
  }

  const payload = await response.json().catch(() => null);
  if (!payload || payload.ok !== true) {
    failures.push(`media-control: health response from ${healthUrl} was not ok=true JSON`);
    return;
  }

  if (payload.realtimeConfigured !== true || payload.controlSecretConfigured !== true) {
    failures.push(
      "media-control: health response did not report realtimeConfigured=true and controlSecretConfigured=true",
    );
    return;
  }

  passes.push(`media-control: health check passed via ${healthUrl}`);
}

async function checkPageSurface(kind, baseUrl) {
  const response = await fetch(baseUrl);
  if (!response.ok) {
    failures.push(`${kind}: ${response.status} from ${baseUrl}`);
    return;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) {
    failures.push(`${kind}: expected HTML from ${baseUrl} but received ${contentType || "unknown content type"}`);
    return;
  }

  const body = await response.text();
  if (kind === "public-gateway" && !body.includes("OpsUI Meets")) {
    failures.push(`public-gateway: expected landing HTML marker at ${baseUrl}`);
    return;
  }

  passes.push(`${kind}: page responded at ${baseUrl}`);
}

function getEnvName(kind) {
  return `PRODUCTION_SMOKE_${kind.replace(/-/g, "_").toUpperCase()}_URL`;
}

function normalizeBaseUrl(value) {
  const withProtocol = /^https?:\/\//.test(value) ? value : `https://${value}`;
  return withProtocol.endsWith("/") ? withProtocol : `${withProtocol}/`;
}

function formatError(error) {
  return error instanceof Error ? error.message : "unknown error";
}
