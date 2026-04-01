import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureScriptPath = resolve(rootDir, "scripts/e2e-fixtures.mjs");
const appOrigin = "http://127.0.0.1:4173";
const apiOrigin = "http://127.0.0.1:9877";
const authOrigin = "http://127.0.0.1:9878";

const sharedEnv = {
  ...process.env,
  E2E_API_PORT: "9877",
  E2E_APP_ORIGIN: appOrigin,
  E2E_AUTH_PORT: "9878",
  VITE_API_BASE_URL: apiOrigin,
  VITE_AUTH_BASE_URL: authOrigin,
  VITE_REALTIME_BASE_URL: "",
};

const fixtureProcess = spawn(process.execPath, [fixtureScriptPath], {
  cwd: rootDir,
  env: sharedEnv,
  stdio: "inherit",
});

const webProcess = process.platform === "win32"
  ? spawn(
      process.env.ComSpec ?? "cmd.exe",
      ["/d", "/s", "/c", "corepack pnpm --filter @opsui/web exec vite --host 127.0.0.1 --port 4173 --strictPort"],
      {
        cwd: rootDir,
        env: sharedEnv,
        stdio: "inherit",
      },
    )
  : spawn(
      "corepack",
      ["pnpm", "--filter", "@opsui/web", "exec", "vite", "--host", "127.0.0.1", "--port", "4173", "--strictPort"],
      {
        cwd: rootDir,
        env: sharedEnv,
        stdio: "inherit",
      },
    );

let shuttingDown = false;

for (const child of [fixtureProcess, webProcess]) {
  child.on("exit", (code) => {
    if (!shuttingDown && code !== 0) {
      console.error(`[e2e-serve] child process exited unexpectedly with code ${code}`);
      void shutdown(1);
    }
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void shutdown(0);
  });
}

try {
  await waitForUrl(`${apiOrigin}/v1/health`, "API fixtures");
  await waitForUrl(`${authOrigin}/v1/health`, "Auth fixtures");
  await waitForUrl(appOrigin, "Web app");
  console.log("[e2e-serve] all services ready");
} catch (error) {
  console.error("[e2e-serve] startup failed", error);
  await shutdown(1);
}

await new Promise(() => {});

async function waitForUrl(url, label) {
  const timeoutAt = Date.now() + 90_000;
  while (Date.now() < timeoutAt) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        console.log(`[e2e-serve] ${label} ready`);
        return;
      }
    } catch {}

    if (fixtureProcess.exitCode !== null || webProcess.exitCode !== null) {
      throw new Error(`${label} could not be reached before a child exited`);
    }

    await delay(500);
  }

  throw new Error(`${label} did not become ready in time`);
}

async function shutdown(exitCode) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  for (const child of [webProcess, fixtureProcess]) {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
    }
  }

  await delay(500);

  for (const child of [webProcess, fixtureProcess]) {
    if (child.exitCode === null) {
      child.kill("SIGKILL");
    }
  }

  process.exit(exitCode);
}
