import { defineConfig, devices } from "@playwright/test";

const OUTPUT_DIR = "output/playwright";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  outputDir: `${OUTPUT_DIR}/test-results`,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: `${OUTPUT_DIR}/report` }],
  ],
  use: {
    baseURL: "http://127.0.0.1:4173",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/e2e-serve.mjs",
    reuseExistingServer: false,
    timeout: 120_000,
    url: "http://127.0.0.1:4173",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
});
