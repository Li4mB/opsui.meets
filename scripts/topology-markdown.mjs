function formatList(items, emptyValue = "-") {
  return items.length > 0 ? items.join("<br>") : emptyValue;
}

export function renderTopologyMarkdown(manifest) {
  const lines = [
    "# OpsUI Meets Deployment Topology",
    "",
    `Source: \`${manifest.source}\``,
    "",
    "| Surface | Hostname | Product | Wrangler | Workspace | Health | Runtime bindings |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const surface of manifest.surfaces) {
    const runtimeBindings = [
      ...surface.serviceBindings.map((binding) => `${binding.binding} -> ${binding.service}`),
      ...surface.analyticsBindings.map((binding) => `analytics:${binding.binding}`),
      ...surface.durableObjectBindings.map((binding) => `do:${binding.name} -> ${binding.className}`),
      ...surface.requiredEnvVars.map((name) => `env:${name}`),
    ];

    lines.push(
      `| ${surface.kind} | ${surface.hostname} | ${surface.cloudflareProduct} | ${surface.wranglerName} | ${surface.workspaceTarget} | ${surface.healthUrl ?? "-"} | ${formatList(runtimeBindings)} |`,
    );
  }

  lines.push("", "Generated from the shared topology config. Do not edit manually.", "");
  return lines.join("\n");
}
