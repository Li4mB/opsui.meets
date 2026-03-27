import fs from "node:fs";
import path from "node:path";
import { loadTopology } from "./load-topology.mjs";
import { buildTopologyManifest } from "./topology-manifest.mjs";
import { renderTopologyMarkdown } from "./topology-markdown.mjs";
import { buildTopologyChecksums } from "./topology-checksums.mjs";
import { renderTopologyCsv } from "./topology-csv.mjs";
import { renderStableTopologyBundle } from "./topology-bundle.mjs";

const rootDir = path.resolve(import.meta.dirname, "..");
const outputPath = path.join(rootDir, "opsui-meets.topology.json");
const markdownOutputPath = path.join(rootDir, "opsui-meets.topology.md");
const csvOutputPath = path.join(rootDir, "opsui-meets.topology.csv");
const checksumOutputPath = path.join(rootDir, "opsui-meets.topology.sha256");
const bundleOutputPath = path.join(rootDir, "opsui-meets.topology.bundle.json");
const publishedArtifactTargets = [
  path.join(rootDir, "apps", "docs", "public"),
  path.join(rootDir, "apps", "preview", "public"),
];
const { OPSUI_MEETS_SURFACES, getSurfaceHealthUrl } = await loadTopology(rootDir);

const manifest = {
  ...buildTopologyManifest({
    surfaces: OPSUI_MEETS_SURFACES,
    getSurfaceHealthUrl,
  }),
  generatedAt: new Date().toISOString(),
};
const jsonContent = `${JSON.stringify(manifest, null, 2)}\n`;
const markdownContent = renderTopologyMarkdown(manifest);
const csvContent = renderTopologyCsv(manifest);
const checksumContent = buildTopologyChecksums([
  {
    name: "opsui-meets.topology.json",
    content: jsonContent,
  },
  {
    name: "opsui-meets.topology.md",
    content: markdownContent,
  },
  {
    name: "opsui-meets.topology.csv",
    content: csvContent,
  },
]);
const bundleContent = renderStableTopologyBundle({
  manifest,
  checksums: checksumContent,
  files: {
    json: jsonContent,
    markdown: markdownContent,
    csv: csvContent,
    checksum: checksumContent,
  },
});

fs.writeFileSync(outputPath, jsonContent, "utf8");
fs.writeFileSync(markdownOutputPath, markdownContent, "utf8");
fs.writeFileSync(csvOutputPath, csvContent, "utf8");
fs.writeFileSync(checksumOutputPath, checksumContent, "utf8");
fs.writeFileSync(bundleOutputPath, bundleContent, "utf8");
for (const targetDir of publishedArtifactTargets) {
  fs.writeFileSync(path.join(targetDir, "opsui-meets.topology.json"), jsonContent, "utf8");
  fs.writeFileSync(path.join(targetDir, "opsui-meets.topology.md"), markdownContent, "utf8");
  fs.writeFileSync(path.join(targetDir, "opsui-meets.topology.csv"), csvContent, "utf8");
  fs.writeFileSync(path.join(targetDir, "opsui-meets.topology.sha256"), checksumContent, "utf8");
  fs.writeFileSync(path.join(targetDir, "opsui-meets.topology.bundle.json"), bundleContent, "utf8");
}
console.log(`Wrote ${path.relative(rootDir, outputPath)}`);
console.log(`Wrote ${path.relative(rootDir, markdownOutputPath)}`);
console.log(`Wrote ${path.relative(rootDir, csvOutputPath)}`);
console.log(`Wrote ${path.relative(rootDir, checksumOutputPath)}`);
console.log(`Wrote ${path.relative(rootDir, bundleOutputPath)}`);
for (const targetDir of publishedArtifactTargets) {
  console.log(`Published topology artifacts to ${path.relative(rootDir, targetDir)}`);
}
