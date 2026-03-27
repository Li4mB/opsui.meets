import fs from "node:fs";
import path from "node:path";
import { loadTopology } from "./load-topology.mjs";
import { buildTopologyManifest } from "./topology-manifest.mjs";
import { renderTopologyMarkdown } from "./topology-markdown.mjs";
import { buildTopologyChecksums } from "./topology-checksums.mjs";
import { renderTopologyCsv } from "./topology-csv.mjs";
import { renderStableTopologyBundle } from "./topology-bundle.mjs";

const rootDir = path.resolve(import.meta.dirname, "..");
const manifestPath = path.join(rootDir, "opsui-meets.topology.json");
const markdownManifestPath = path.join(rootDir, "opsui-meets.topology.md");
const csvManifestPath = path.join(rootDir, "opsui-meets.topology.csv");
const checksumManifestPath = path.join(rootDir, "opsui-meets.topology.sha256");
const bundleManifestPath = path.join(rootDir, "opsui-meets.topology.bundle.json");
const publishedArtifactTargets = [
  path.join(rootDir, "apps", "docs", "public"),
  path.join(rootDir, "apps", "preview", "public"),
];

if (!fs.existsSync(manifestPath)) {
  console.error("FAIL topology manifest is missing. Run `corepack pnpm export:topology`.");
  process.exit(1);
}

if (!fs.existsSync(markdownManifestPath)) {
  console.error("FAIL topology markdown is missing. Run `corepack pnpm export:topology`.");
  process.exit(1);
}

if (!fs.existsSync(csvManifestPath)) {
  console.error("FAIL topology CSV is missing. Run `corepack pnpm export:topology`.");
  process.exit(1);
}

if (!fs.existsSync(checksumManifestPath)) {
  console.error("FAIL topology checksum file is missing. Run `corepack pnpm export:topology`.");
  process.exit(1);
}

if (!fs.existsSync(bundleManifestPath)) {
  console.error("FAIL topology bundle file is missing. Run `corepack pnpm export:topology`.");
  process.exit(1);
}

for (const targetDir of publishedArtifactTargets) {
  if (!fs.existsSync(path.join(targetDir, "opsui-meets.topology.json"))) {
    console.error(`FAIL published topology JSON is missing in ${path.relative(rootDir, targetDir)}.`);
    process.exit(1);
  }

  if (!fs.existsSync(path.join(targetDir, "opsui-meets.topology.md"))) {
    console.error(`FAIL published topology markdown is missing in ${path.relative(rootDir, targetDir)}.`);
    process.exit(1);
  }

  if (!fs.existsSync(path.join(targetDir, "opsui-meets.topology.csv"))) {
    console.error(`FAIL published topology CSV is missing in ${path.relative(rootDir, targetDir)}.`);
    process.exit(1);
  }

  if (!fs.existsSync(path.join(targetDir, "opsui-meets.topology.sha256"))) {
    console.error(`FAIL published topology checksum is missing in ${path.relative(rootDir, targetDir)}.`);
    process.exit(1);
  }

  if (!fs.existsSync(path.join(targetDir, "opsui-meets.topology.bundle.json"))) {
    console.error(`FAIL published topology bundle is missing in ${path.relative(rootDir, targetDir)}.`);
    process.exit(1);
  }
}

const { OPSUI_MEETS_SURFACES, getSurfaceHealthUrl } = await loadTopology(rootDir);
const expectedManifest = buildTopologyManifest({
  surfaces: OPSUI_MEETS_SURFACES,
  getSurfaceHealthUrl,
});
const actualManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const { generatedAt: _generatedAt, ...actualComparable } = actualManifest;

if (JSON.stringify(actualComparable) !== JSON.stringify(expectedManifest)) {
  console.error("FAIL topology manifest is out of sync with packages/config/src/topology.ts.");
  console.error("Run `corepack pnpm export:topology` and commit the updated topology artifacts.");
  process.exit(1);
}

const expectedMarkdown = renderTopologyMarkdown(expectedManifest);
const expectedCsv = renderTopologyCsv(expectedManifest);
const actualMarkdown = fs.readFileSync(markdownManifestPath, "utf8");
const actualCsv = fs.readFileSync(csvManifestPath, "utf8");
const expectedChecksums = buildTopologyChecksums([
  {
    name: "opsui-meets.topology.json",
    content: `${JSON.stringify(actualManifest, null, 2)}\n`,
  },
  {
    name: "opsui-meets.topology.md",
    content: expectedMarkdown,
  },
  {
    name: "opsui-meets.topology.csv",
    content: expectedCsv,
  },
]);
const actualChecksums = fs.readFileSync(checksumManifestPath, "utf8");
const expectedBundle = renderStableTopologyBundle({
  manifest: expectedManifest,
  checksums: expectedChecksums,
  files: {
    json: `${JSON.stringify(actualManifest, null, 2)}\n`,
    markdown: expectedMarkdown,
    csv: expectedCsv,
    checksum: expectedChecksums,
  },
});
const actualBundle = fs.readFileSync(bundleManifestPath, "utf8");

if (actualMarkdown !== expectedMarkdown) {
  console.error("FAIL topology markdown is out of sync with packages/config/src/topology.ts.");
  console.error("Run `corepack pnpm export:topology` and commit the updated topology artifacts.");
  process.exit(1);
}

if (actualChecksums !== expectedChecksums) {
  console.error("FAIL topology checksum file is out of sync with the exported topology artifacts.");
  console.error("Run `corepack pnpm export:topology` and commit the updated topology artifacts.");
  process.exit(1);
}

if (actualCsv !== expectedCsv) {
  console.error("FAIL topology CSV is out of sync with packages/config/src/topology.ts.");
  console.error("Run `corepack pnpm export:topology` and commit the updated topology artifacts.");
  process.exit(1);
}

if (actualBundle !== expectedBundle) {
  console.error("FAIL topology bundle is out of sync with the exported topology artifacts.");
  console.error("Run `corepack pnpm export:topology` and commit the updated topology artifacts.");
  process.exit(1);
}

for (const targetDir of publishedArtifactTargets) {
  const publishedJson = fs.readFileSync(path.join(targetDir, "opsui-meets.topology.json"), "utf8");
  const publishedMarkdown = fs.readFileSync(path.join(targetDir, "opsui-meets.topology.md"), "utf8");
  const publishedCsv = fs.readFileSync(path.join(targetDir, "opsui-meets.topology.csv"), "utf8");
  const publishedChecksums = fs.readFileSync(path.join(targetDir, "opsui-meets.topology.sha256"), "utf8");
  const publishedBundle = fs.readFileSync(path.join(targetDir, "opsui-meets.topology.bundle.json"), "utf8");

  if (publishedJson !== `${JSON.stringify(actualManifest, null, 2)}\n`) {
    console.error(`FAIL published topology JSON in ${path.relative(rootDir, targetDir)} is out of sync.`);
    console.error("Run `corepack pnpm export:topology` and commit the updated topology artifacts.");
    process.exit(1);
  }

  if (publishedMarkdown !== expectedMarkdown) {
    console.error(`FAIL published topology markdown in ${path.relative(rootDir, targetDir)} is out of sync.`);
    console.error("Run `corepack pnpm export:topology` and commit the updated topology artifacts.");
    process.exit(1);
  }

  if (publishedChecksums !== expectedChecksums) {
    console.error(`FAIL published topology checksum in ${path.relative(rootDir, targetDir)} is out of sync.`);
    console.error("Run `corepack pnpm export:topology` and commit the updated topology artifacts.");
    process.exit(1);
  }

  if (publishedCsv !== expectedCsv) {
    console.error(`FAIL published topology CSV in ${path.relative(rootDir, targetDir)} is out of sync.`);
    console.error("Run `corepack pnpm export:topology` and commit the updated topology artifacts.");
    process.exit(1);
  }

  if (publishedBundle !== expectedBundle) {
    console.error(`FAIL published topology bundle in ${path.relative(rootDir, targetDir)} is out of sync.`);
    console.error("Run `corepack pnpm export:topology` and commit the updated topology artifacts.");
    process.exit(1);
  }
}

console.log("PASS topology JSON, markdown, CSV, checksum, and bundle artifacts match shared source config and published copies.");
