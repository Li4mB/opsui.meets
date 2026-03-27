import fs from "node:fs";
import path from "node:path";
import { buildReadinessReport, renderReadinessMarkdown } from "./readiness-report.mjs";

const rootDir = path.resolve(import.meta.dirname, "..");
const rootJsonPath = path.join(rootDir, "opsui-meets.readiness.json");
const rootMarkdownPath = path.join(rootDir, "opsui-meets.readiness.md");
const publishedArtifactTargets = [
  path.join(rootDir, "apps", "docs", "public"),
  path.join(rootDir, "apps", "preview", "public"),
];

if (!fs.existsSync(rootJsonPath) || !fs.existsSync(rootMarkdownPath)) {
  console.error("FAIL readiness artifacts are missing. Run `corepack pnpm export:readiness`.");
  process.exit(1);
}

for (const targetDir of publishedArtifactTargets) {
  if (!fs.existsSync(path.join(targetDir, "opsui-meets.readiness.json"))) {
    console.error(`FAIL published readiness JSON is missing in ${path.relative(rootDir, targetDir)}.`);
    process.exit(1);
  }

  if (!fs.existsSync(path.join(targetDir, "opsui-meets.readiness.md"))) {
    console.error(`FAIL published readiness markdown is missing in ${path.relative(rootDir, targetDir)}.`);
    process.exit(1);
  }
}

const expectedReport = buildReadinessReport(rootDir);
const actualReport = JSON.parse(fs.readFileSync(rootJsonPath, "utf8"));
const expectedComparable = { ...expectedReport, generatedAt: actualReport.generatedAt };

if (JSON.stringify(actualReport) !== JSON.stringify(expectedComparable)) {
  console.error("FAIL readiness JSON is out of sync with the current repository state.");
  console.error("Run `corepack pnpm export:readiness` and commit the updated readiness artifacts.");
  process.exit(1);
}

const expectedMarkdown = renderReadinessMarkdown(actualReport);
const actualMarkdown = fs.readFileSync(rootMarkdownPath, "utf8");

if (actualMarkdown !== expectedMarkdown) {
  console.error("FAIL readiness markdown is out of sync with the current repository state.");
  console.error("Run `corepack pnpm export:readiness` and commit the updated readiness artifacts.");
  process.exit(1);
}

for (const targetDir of publishedArtifactTargets) {
  const publishedJson = fs.readFileSync(path.join(targetDir, "opsui-meets.readiness.json"), "utf8");
  const publishedMarkdown = fs.readFileSync(path.join(targetDir, "opsui-meets.readiness.md"), "utf8");

  if (publishedJson !== `${JSON.stringify(actualReport, null, 2)}\n`) {
    console.error(`FAIL published readiness JSON in ${path.relative(rootDir, targetDir)} is out of sync.`);
    console.error("Run `corepack pnpm export:readiness` and commit the updated readiness artifacts.");
    process.exit(1);
  }

  if (publishedMarkdown !== expectedMarkdown) {
    console.error(`FAIL published readiness markdown in ${path.relative(rootDir, targetDir)} is out of sync.`);
    console.error("Run `corepack pnpm export:readiness` and commit the updated readiness artifacts.");
    process.exit(1);
  }
}

console.log("PASS readiness JSON and markdown artifacts match the current repository state and published copies.");
