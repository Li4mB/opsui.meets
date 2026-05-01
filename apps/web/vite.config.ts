import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const projectDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(projectDir, "../..");

export default defineConfig({
  envDir: repoRoot,
  build: {
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }

          if (id.includes("@cloudflare/realtimekit")) {
            return "realtime";
          }

          if (id.includes("@sentry")) {
            return "sentry";
          }

          if (
            id.includes("react-dom") ||
            id.includes(`${path.sep}react${path.sep}`) ||
            id.includes("/react/") ||
            id.includes("\\react\\") ||
            id.includes("scheduler")
          ) {
            return "react-vendor";
          }

          return "vendor";
        },
      },
    },
  },
  plugins: [react()],
});
