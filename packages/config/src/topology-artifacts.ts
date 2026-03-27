import type { TopologyArtifactBundle, TopologyArtifactDescriptor } from "./topology";

export const TOPOLOGY_BUNDLE_PATH = "/opsui-meets.topology.bundle.json";

export async function loadTopologyArtifactBundle(
  fetcher: typeof fetch = fetch,
): Promise<TopologyArtifactBundle | null> {
  try {
    const response = await fetcher(TOPOLOGY_BUNDLE_PATH);
    if (!response.ok) {
      return null;
    }

    return (await response.json()) as TopologyArtifactBundle;
  } catch {
    return null;
  }
}

export function getTopologyArtifactLabel(
  format: TopologyArtifactDescriptor["format"],
): string {
  switch (format) {
    case "json":
      return "JSON";
    case "markdown":
      return "Markdown";
    case "csv":
      return "CSV";
    case "checksum":
      return "SHA256";
    case "bundle":
      return "Bundle";
    default:
      return format;
  }
}

export function formatTopologyArtifactSize(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  return `${(sizeBytes / 1024).toFixed(1)} KB`;
}
