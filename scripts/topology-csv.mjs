function escapeCsv(value) {
  const text = String(value ?? "");
  if (text.includes('"') || text.includes(",") || text.includes("\n")) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function formatList(items) {
  return items.length > 0 ? items.join("; ") : "";
}

export function renderTopologyCsv(manifest) {
  const header = [
    "kind",
    "hostname",
    "cloudflareProduct",
    "wranglerName",
    "workspaceTarget",
    "purpose",
    "rolloutStatus",
    "healthUrl",
    "serviceBindings",
    "analyticsBindings",
    "durableObjectBindings",
    "requiredEnvVars",
  ];

  const rows = manifest.surfaces.map((surface) => [
    surface.kind,
    surface.hostname,
    surface.cloudflareProduct,
    surface.wranglerName,
    surface.workspaceTarget,
    surface.purpose,
    surface.rolloutStatus,
    surface.healthUrl ?? "",
    formatList(surface.serviceBindings.map((binding) => `${binding.binding}:${binding.service}`)),
    formatList(surface.analyticsBindings.map((binding) => binding.binding)),
    formatList(surface.durableObjectBindings.map((binding) => `${binding.name}:${binding.className}`)),
    formatList(surface.requiredEnvVars),
  ]);

  return [header, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\n").concat("\n");
}
