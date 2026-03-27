import fs from "node:fs";
import path from "node:path";

const rootDir = path.resolve(import.meta.dirname, "..");
const rootJsonPath = path.join(rootDir, "opsui-meets.readiness.json");
const rootMarkdownPath = path.join(rootDir, "opsui-meets.readiness.md");
const publishedTargets = [
  path.join(rootDir, "apps", "docs", "dist"),
  path.join(rootDir, "apps", "preview", "dist"),
];

if (!fs.existsSync(rootJsonPath) || !fs.existsSync(rootMarkdownPath)) {
  console.error("FAIL root readiness artifacts are missing. Run `corepack pnpm export:readiness` first.");
  process.exit(1);
}

const expectedJson = fs.readFileSync(rootJsonPath, "utf8");
const expectedMarkdown = fs.readFileSync(rootMarkdownPath, "utf8");

for (const targetDir of publishedTargets) {
  const jsonPath = path.join(targetDir, "opsui-meets.readiness.json");
  const markdownPath = path.join(targetDir, "opsui-meets.readiness.md");

  if (!fs.existsSync(jsonPath) || !fs.existsSync(markdownPath)) {
    console.error(`FAIL built readiness assets are missing in ${path.relative(rootDir, targetDir)}.`);
    process.exit(1);
  }

  if (fs.readFileSync(jsonPath, "utf8") !== expectedJson) {
    console.error(`FAIL built readiness JSON in ${path.relative(rootDir, targetDir)} is out of sync.`);
    process.exit(1);
  }

  if (fs.readFileSync(markdownPath, "utf8") !== expectedMarkdown) {
    console.error(`FAIL built readiness markdown in ${path.relative(rootDir, targetDir)} is out of sync.`);
    process.exit(1);
  }
}

console.log("PASS built docs and preview readiness JSON and markdown assets match the exported root artifacts.");
