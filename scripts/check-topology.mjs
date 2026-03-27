import fs from "node:fs";
import path from "node:path";
import { loadTopology } from "./load-topology.mjs";

const rootDir = path.resolve(import.meta.dirname, "..");
const { OPSUI_MEETS_SURFACES, getSurfaceHealthUrl } = await loadTopology(rootDir);

const failures = [];
const passes = [];

function parseJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function hasExpectedServices(actualServices, expectedServices) {
  if (!expectedServices || expectedServices.length === 0) {
    return true;
  }

  return expectedServices.every((expected) =>
    Array.isArray(actualServices) &&
    actualServices.some(
      (service) => service.binding === expected.binding && service.service === expected.service,
    ),
  );
}

function hasExpectedVars(actualVars, requiredVars) {
  if (!requiredVars || requiredVars.length === 0) {
    return true;
  }

  return requiredVars.every((name) => actualVars && Object.prototype.hasOwnProperty.call(actualVars, name));
}

function hasExpectedAnalyticsBindings(actualBindings, expectedBindings) {
  if (!expectedBindings || expectedBindings.length === 0) {
    return true;
  }

  return expectedBindings.every((expected) =>
    Array.isArray(actualBindings) &&
    actualBindings.some((binding) => binding.binding === expected.binding),
  );
}

function hasExpectedDurableObjects(actualBindings, expectedBindings) {
  if (!expectedBindings || expectedBindings.length === 0) {
    return true;
  }

  const actualItems = actualBindings?.bindings;
  return expectedBindings.every((expected) =>
    Array.isArray(actualItems) &&
    actualItems.some(
      (binding) => binding.name === expected.name && binding.class_name === expected.className,
    ),
  );
}

for (const surface of OPSUI_MEETS_SURFACES) {
  const surfaceRoot = path.join(rootDir, surface.workspaceTarget);

  if (!fs.existsSync(surfaceRoot)) {
    failures.push(`${surface.kind}: missing workspace target ${surface.workspaceTarget}`);
    continue;
  }

  if (surface.cloudflareProduct === "workers") {
    const entryPath = path.join(surfaceRoot, "src", "index.ts");
    const wranglerPath = path.join(surfaceRoot, "wrangler.jsonc");

    if (!fs.existsSync(entryPath)) {
      failures.push(`${surface.kind}: missing worker entry ${surface.workspaceTarget}/src/index.ts`);
      continue;
    }

    if (!fs.existsSync(wranglerPath)) {
      failures.push(`${surface.kind}: missing worker wrangler config ${surface.workspaceTarget}/wrangler.jsonc`);
      continue;
    }

    const wranglerConfig = parseJsonFile(wranglerPath);
    if (wranglerConfig.name !== surface.wranglerName) {
      failures.push(`${surface.kind}: wrangler name ${wranglerConfig.name} does not match ${surface.wranglerName}`);
      continue;
    }

    if (wranglerConfig.workers_dev !== false) {
      failures.push(`${surface.kind}: workers_dev must be false for custom-domain deployment`);
      continue;
    }

    const routePattern = wranglerConfig.routes?.[0]?.pattern;
    if (routePattern !== surface.hostname) {
      failures.push(`${surface.kind}: wrangler route ${routePattern ?? "missing"} does not match ${surface.hostname}`);
      continue;
    }

    if (!hasExpectedServices(wranglerConfig.services, surface.serviceBindings)) {
      failures.push(`${surface.kind}: wrangler services do not match shared topology bindings`);
      continue;
    }

    if (!hasExpectedVars(wranglerConfig.vars, surface.requiredEnvVars)) {
      failures.push(`${surface.kind}: wrangler vars do not include all required shared topology env vars`);
      continue;
    }

    if (!hasExpectedAnalyticsBindings(wranglerConfig.analytics_engine_datasets, surface.analyticsBindings)) {
      failures.push(`${surface.kind}: wrangler analytics bindings do not match shared topology`);
      continue;
    }

    if (!hasExpectedDurableObjects(wranglerConfig.durable_objects, surface.durableObjectBindings)) {
      failures.push(`${surface.kind}: durable object bindings do not match shared topology`);
      continue;
    }

    const entrySource = fs.readFileSync(entryPath, "utf8");
    if (surface.healthPath && !entrySource.includes(surface.healthPath)) {
      failures.push(`${surface.kind}: worker entry does not expose ${surface.healthPath}`);
      continue;
    }

    passes.push(
      `${surface.kind}: worker surface wired as ${surface.wranglerName} with health ${getSurfaceHealthUrl(surface)}`,
    );
    continue;
  }

  const packagePath = path.join(surfaceRoot, "package.json");
  const wranglerPath = path.join(surfaceRoot, "wrangler.jsonc");
  const headersPath = path.join(surfaceRoot, "public", "_headers");
  const redirectsPath = path.join(surfaceRoot, "public", "_redirects");

  if (!fs.existsSync(packagePath)) {
    failures.push(`${surface.kind}: missing Pages package ${surface.workspaceTarget}/package.json`);
    continue;
  }

  if (!fs.existsSync(wranglerPath)) {
    failures.push(`${surface.kind}: missing Pages wrangler config ${surface.workspaceTarget}/wrangler.jsonc`);
    continue;
  }

  const wranglerConfig = parseJsonFile(wranglerPath);
  if (wranglerConfig.name !== surface.wranglerName) {
    failures.push(`${surface.kind}: wrangler name ${wranglerConfig.name} does not match ${surface.wranglerName}`);
    continue;
  }

  if (wranglerConfig.pages_build_output_dir !== "./dist") {
    failures.push(
      `${surface.kind}: pages_build_output_dir ${wranglerConfig.pages_build_output_dir ?? "missing"} must be ./dist`,
    );
    continue;
  }

  if (!fs.existsSync(headersPath) || !fs.existsSync(redirectsPath)) {
    failures.push(`${surface.kind}: missing Pages static edge files in ${surface.workspaceTarget}/public`);
    continue;
  }

  passes.push(`${surface.kind}: Pages surface wired as ${surface.wranglerName} for ${surface.hostname}`);
}

for (const pass of passes) {
  console.log(`PASS ${pass}`);
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`FAIL ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Validated ${passes.length} OpsUI Meets deployment surfaces.`);
}
