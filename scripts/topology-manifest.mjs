export function buildTopologyManifest({ surfaces, getSurfaceHealthUrl }) {
  return {
    product: "OpsUI Meets",
    source: "packages/config/src/topology.ts",
    surfaces: surfaces.map((surface) => ({
      kind: surface.kind,
      hostname: surface.hostname,
      cloudflareProduct: surface.cloudflareProduct,
      wranglerName: surface.wranglerName,
      workspaceTarget: surface.workspaceTarget,
      purpose: surface.purpose,
      rolloutStatus: surface.rolloutStatus,
      healthUrl: getSurfaceHealthUrl(surface),
      requiredEnvVars: surface.requiredEnvVars ?? [],
      serviceBindings: surface.serviceBindings ?? [],
      analyticsBindings: surface.analyticsBindings ?? [],
      durableObjectBindings: surface.durableObjectBindings ?? [],
    })),
  };
}
