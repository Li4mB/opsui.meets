function sizeOf(content) {
  return Buffer.byteLength(content, "utf8");
}

export function buildTopologyBundle({ manifest, checksums, files }) {
  const checksumMap = Object.fromEntries(
    checksums
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, name] = line.split(/\s{2,}/);
        return [name, hash];
      }),
  );

  return {
    product: manifest.product,
    source: manifest.source,
    artifactBaseName: "opsui-meets.topology",
    artifacts: [
      {
        fileName: "opsui-meets.topology.json",
        format: "json",
        contentType: "application/json",
        sizeBytes: sizeOf(files.json),
        sha256: checksumMap["opsui-meets.topology.json"] ?? null,
        downloadPath: "/opsui-meets.topology.json",
        publishedPaths: ["apps/docs/public/opsui-meets.topology.json", "apps/preview/public/opsui-meets.topology.json"],
        publicUrls: [
          "https://docs.opsuimeets.com/opsui-meets.topology.json",
          "https://preview.opsuimeets.com/opsui-meets.topology.json",
        ],
      },
      {
        fileName: "opsui-meets.topology.md",
        format: "markdown",
        contentType: "text/markdown",
        sizeBytes: sizeOf(files.markdown),
        sha256: checksumMap["opsui-meets.topology.md"] ?? null,
        downloadPath: "/opsui-meets.topology.md",
        publishedPaths: ["apps/docs/public/opsui-meets.topology.md", "apps/preview/public/opsui-meets.topology.md"],
        publicUrls: [
          "https://docs.opsuimeets.com/opsui-meets.topology.md",
          "https://preview.opsuimeets.com/opsui-meets.topology.md",
        ],
      },
      {
        fileName: "opsui-meets.topology.csv",
        format: "csv",
        contentType: "text/csv",
        sizeBytes: sizeOf(files.csv),
        sha256: checksumMap["opsui-meets.topology.csv"] ?? null,
        downloadPath: "/opsui-meets.topology.csv",
        publishedPaths: ["apps/docs/public/opsui-meets.topology.csv", "apps/preview/public/opsui-meets.topology.csv"],
        publicUrls: [
          "https://docs.opsuimeets.com/opsui-meets.topology.csv",
          "https://preview.opsuimeets.com/opsui-meets.topology.csv",
        ],
      },
      {
        fileName: "opsui-meets.topology.sha256",
        format: "checksum",
        contentType: "text/plain",
        sizeBytes: sizeOf(files.checksum),
        sha256: null,
        downloadPath: "/opsui-meets.topology.sha256",
        publishedPaths: ["apps/docs/public/opsui-meets.topology.sha256", "apps/preview/public/opsui-meets.topology.sha256"],
        publicUrls: [
          "https://docs.opsuimeets.com/opsui-meets.topology.sha256",
          "https://preview.opsuimeets.com/opsui-meets.topology.sha256",
        ],
      },
      {
        fileName: "opsui-meets.topology.bundle.json",
        format: "bundle",
        contentType: "application/json",
        sizeBytes: sizeOf(files.bundle),
        sha256: null,
        downloadPath: "/opsui-meets.topology.bundle.json",
        publishedPaths: [
          "apps/docs/public/opsui-meets.topology.bundle.json",
          "apps/preview/public/opsui-meets.topology.bundle.json",
        ],
        publicUrls: [
          "https://docs.opsuimeets.com/opsui-meets.topology.bundle.json",
          "https://preview.opsuimeets.com/opsui-meets.topology.bundle.json",
        ],
      },
    ],
  };
}

export function renderStableTopologyBundle({ manifest, checksums, files }) {
  let bundleContent = "";

  for (let index = 0; index < 5; index += 1) {
    const nextContent = `${JSON.stringify(
      buildTopologyBundle({
        manifest,
        checksums,
        files: {
          ...files,
          bundle: bundleContent,
        },
      }),
      null,
      2,
    )}\n`;

    if (nextContent === bundleContent) {
      return bundleContent;
    }

    bundleContent = nextContent;
  }

  return bundleContent;
}
