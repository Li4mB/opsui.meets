import fs from "node:fs";
import path from "node:path";
import { buildReadinessReport, renderReadinessMarkdown } from "./readiness-report.mjs";

const rootDir = path.resolve(import.meta.dirname, "..");
const report = buildReadinessReport(rootDir);
const jsonContent = `${JSON.stringify(report, null, 2)}\n`;
const markdownContent = renderReadinessMarkdown(report);
const publishedArtifactTargets = [
  path.join(rootDir, "apps", "docs", "public"),
  path.join(rootDir, "apps", "preview", "public"),
];

fs.writeFileSync(path.join(rootDir, "opsui-meets.readiness.json"), jsonContent, "utf8");
fs.writeFileSync(path.join(rootDir, "opsui-meets.readiness.md"), markdownContent, "utf8");

for (const targetDir of publishedArtifactTargets) {
  fs.writeFileSync(path.join(targetDir, "opsui-meets.readiness.json"), jsonContent, "utf8");
  fs.writeFileSync(path.join(targetDir, "opsui-meets.readiness.md"), markdownContent, "utf8");
}

console.log("Wrote opsui-meets.readiness.json");
console.log("Wrote opsui-meets.readiness.md");
for (const targetDir of publishedArtifactTargets) {
  console.log(`Published readiness artifacts to ${path.relative(rootDir, targetDir)}`);
}
