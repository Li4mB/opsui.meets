import path from "node:path";
import { loadTopology } from "./load-topology.mjs";

const rootDir = path.resolve(import.meta.dirname, "..");
const { OPSUI_MEETS_SURFACES } = await loadTopology(rootDir);

const configuredTargets = OPSUI_MEETS_SURFACES
  .map((surface) => {
    const envName = getEnvName(surface.kind);
    const configuredUrl = process.env[envName];

    if (!configuredUrl) {
      return null;
    }

    return {
      surface,
      url: normalizeBaseUrl(configuredUrl),
      envName,
    };
  })
  .filter(Boolean);

if (configuredTargets.length === 0) {
  console.log("SKIP preview smoke: no PREVIEW_SMOKE_* environment variables are configured.");
  process.exit(0);
}

const failures = [];
const passes = [];

for (const target of configuredTargets) {
  const { surface, url, envName } = target;

  try {
    if (surface.cloudflareProduct === "workers") {
      if (!surface.healthPath) {
        failures.push(`${surface.kind}: missing healthPath in topology for ${envName}`);
        continue;
      }

      const response = await fetch(new URL(surface.healthPath, url));
      if (!response.ok) {
        failures.push(`${surface.kind}: ${response.status} from ${new URL(surface.healthPath, url)}`);
        continue;
      }

      const payload = await response.json().catch(() => null);
      if (!payload || payload.ok !== true) {
        failures.push(`${surface.kind}: health response from ${new URL(surface.healthPath, url)} was not ok=true JSON`);
        continue;
      }

      if ((surface.kind === "api" || surface.kind === "auth") && payload.analyticsConfigured !== true) {
        failures.push(
          `${surface.kind}: health response from ${new URL(surface.healthPath, url)} did not report analyticsConfigured=true`,
        );
        continue;
      }

      if (surface.kind === "api" && payload.persistenceReady !== true) {
        failures.push(
          `api: health response from ${new URL(surface.healthPath, url)} did not report persistenceReady=true`,
        );
        continue;
      }

      if (
        surface.kind === "auth" &&
        payload.membershipEnforced === true &&
        payload.membershipDirectoryConfigured !== true
      ) {
        failures.push(
          `auth: health response from ${new URL(surface.healthPath, url)} enforced membership without membershipDirectoryConfigured=true`,
        );
        continue;
      }

      if (surface.kind === "media" && payload.controlPlaneReady !== true) {
        failures.push(
          `media: health response from ${new URL(surface.healthPath, url)} did not report controlPlaneReady=true`,
        );
        continue;
      }

      passes.push(`${surface.kind}: health check passed via ${new URL(surface.healthPath, url)}`);
      continue;
    }

    const response = await fetch(url);
    if (!response.ok) {
      failures.push(`${surface.kind}: ${response.status} from ${url}`);
      continue;
    }

    passes.push(`${surface.kind}: page responded at ${url}`);

    if (surface.kind === "docs" || surface.kind === "preview") {
      for (const assetPath of ["/opsui-meets.topology.json", "/opsui-meets.readiness.json"]) {
        const assetResponse = await fetch(new URL(assetPath, url));
        if (!assetResponse.ok) {
          failures.push(`${surface.kind}: ${assetResponse.status} from ${new URL(assetPath, url)}`);
          continue;
        }

        passes.push(`${surface.kind}: asset check passed via ${new URL(assetPath, url)}`);
      }
    }
  } catch (error) {
    failures.push(`${surface.kind}: request failed for ${url} (${formatError(error)})`);
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

console.log(`Validated ${passes.length} preview smoke checks across ${configuredTargets.length} configured targets.`);

function getEnvName(kind) {
  return `PREVIEW_SMOKE_${kind.replace(/-/g, "_").toUpperCase()}_URL`;
}

function normalizeBaseUrl(value) {
  const withProtocol = /^https?:\/\//.test(value) ? value : `https://${value}`;
  return withProtocol.endsWith("/") ? withProtocol : `${withProtocol}/`;
}

function formatError(error) {
  return error instanceof Error ? error.message : "unknown error";
}
