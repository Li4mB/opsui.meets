import fs from "node:fs";
import path from "node:path";

const rootDir = path.resolve(import.meta.dirname, "..");
const rootJsonPath = path.join(rootDir, "opsui-meets.topology.json");
const rootMarkdownPath = path.join(rootDir, "opsui-meets.topology.md");
const rootCsvPath = path.join(rootDir, "opsui-meets.topology.csv");
const rootChecksumPath = path.join(rootDir, "opsui-meets.topology.sha256");
const rootBundlePath = path.join(rootDir, "opsui-meets.topology.bundle.json");
const publishedTargets = [
  path.join(rootDir, "apps", "docs", "dist"),
  path.join(rootDir, "apps", "preview", "dist"),
];

if (!fs.existsSync(rootJsonPath) || !fs.existsSync(rootMarkdownPath) || !fs.existsSync(rootCsvPath) || !fs.existsSync(rootChecksumPath) || !fs.existsSync(rootBundlePath)) {
  console.error("FAIL root topology artifacts are missing. Run `corepack pnpm export:topology` first.");
  process.exit(1);
}

const expectedJson = fs.readFileSync(rootJsonPath, "utf8");
const expectedMarkdown = fs.readFileSync(rootMarkdownPath, "utf8");
const expectedCsv = fs.readFileSync(rootCsvPath, "utf8");
const expectedChecksums = fs.readFileSync(rootChecksumPath, "utf8");
const expectedBundle = fs.readFileSync(rootBundlePath, "utf8");

for (const targetDir of publishedTargets) {
  const jsonPath = path.join(targetDir, "opsui-meets.topology.json");
  const markdownPath = path.join(targetDir, "opsui-meets.topology.md");
  const csvPath = path.join(targetDir, "opsui-meets.topology.csv");
  const checksumPath = path.join(targetDir, "opsui-meets.topology.sha256");
  const bundlePath = path.join(targetDir, "opsui-meets.topology.bundle.json");

  if (!fs.existsSync(jsonPath) || !fs.existsSync(markdownPath) || !fs.existsSync(csvPath) || !fs.existsSync(checksumPath) || !fs.existsSync(bundlePath)) {
    console.error(`FAIL built topology assets are missing in ${path.relative(rootDir, targetDir)}.`);
    process.exit(1);
  }

  if (fs.readFileSync(jsonPath, "utf8") !== expectedJson) {
    console.error(`FAIL built topology JSON in ${path.relative(rootDir, targetDir)} is out of sync.`);
    process.exit(1);
  }

  if (fs.readFileSync(markdownPath, "utf8") !== expectedMarkdown) {
    console.error(`FAIL built topology markdown in ${path.relative(rootDir, targetDir)} is out of sync.`);
    process.exit(1);
  }

  if (fs.readFileSync(csvPath, "utf8") !== expectedCsv) {
    console.error(`FAIL built topology CSV in ${path.relative(rootDir, targetDir)} is out of sync.`);
    process.exit(1);
  }

  if (fs.readFileSync(checksumPath, "utf8") !== expectedChecksums) {
    console.error(`FAIL built topology checksum in ${path.relative(rootDir, targetDir)} is out of sync.`);
    process.exit(1);
  }

  if (fs.readFileSync(bundlePath, "utf8") !== expectedBundle) {
    console.error(`FAIL built topology bundle in ${path.relative(rootDir, targetDir)} is out of sync.`);
    process.exit(1);
  }
}

console.log("PASS built docs and preview topology JSON, markdown, CSV, checksum, and bundle assets match the exported root artifacts.");
