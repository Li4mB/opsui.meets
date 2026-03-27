import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

export async function loadTopology(rootDir) {
  const topologySourcePath = path.join(rootDir, "packages", "config", "src", "topology.ts");
  const routesSourcePath = path.join(rootDir, "packages", "config", "src", "routes.ts");
  const topologySource = fs.readFileSync(topologySourcePath, "utf8");
  const routesSource = fs.readFileSync(routesSourcePath, "utf8");
  const transpiledRoutes = ts.transpileModule(routesSource, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const transpiledTopology = ts
    .transpileModule(topologySource, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    })
    .outputText.replace('from "./routes";', 'from "./routes.mjs";');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opsui-meets-topology-"));
  const tempModulePath = path.join(tempDir, "topology.mjs");
  const tempRoutesPath = path.join(tempDir, "routes.mjs");

  fs.writeFileSync(tempRoutesPath, transpiledRoutes, "utf8");
  fs.writeFileSync(
    tempModulePath,
    `${transpiledTopology}
export default { OPSUI_MEETS_SURFACES, getSurfaceHealthUrl };
`,
    "utf8",
  );

  const topologyModule = await import(pathToFileURL(tempModulePath).href);
  return topologyModule.default;
}
