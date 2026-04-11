import { chromium, devices } from "@playwright/test";

const APP_BASE_URL = normalizeBaseUrl(process.env.MEETING_RUNTIME_SMOKE_APP_URL ?? "https://app.opsuimeets.com");
const ALLOW_CREATE = process.env.MEETING_RUNTIME_SMOKE_ALLOW_CREATE === "true";

if (!ALLOW_CREATE) {
  console.error(
    "Refusing to create throwaway production-like meetings without explicit opt-in. Set MEETING_RUNTIME_SMOKE_ALLOW_CREATE=true.",
  );
  process.exit(1);
}

const report = {
  appBaseUrl: APP_BASE_URL,
  checks: [],
  roomSlug: null,
};

const browser = await chromium.launch({
  headless: true,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});

try {
  const hostContext = await browser.newContext({
    permissions: ["camera", "microphone"],
  });
  const hostPage = await hostContext.newPage();
  const hostLogs = attachPageLogging(hostPage);

  await hostPage.goto(APP_BASE_URL, { waitUntil: "networkidle" });
  await hostPage.getByRole("button", { name: "Start Meeting" }).click();
  await hostPage.waitForURL(/\/ops-/i, { timeout: 30_000 });
  await joinAsGuest(hostPage, "Production Smoke Host");

  const hostReady = await waitForRoomState(hostPage, 35_000);
  const roomSlug = new URL(hostPage.url()).pathname.replace(/^\/+/, "");
  report.roomSlug = roomSlug;
  addCheck("desktop-host-media-ready", hostReady.kind === "media_ready", hostReady);
  addCheck("desktop-host-no-browser-errors", hostLogs.errors.length === 0, {
    errors: hostLogs.errors,
  });

  const mobileContext = await browser.newContext({
    ...devices["iPhone 13"],
    permissions: ["camera", "microphone"],
  });
  const mobilePage = await mobileContext.newPage();
  const mobileLogs = attachPageLogging(mobilePage);

  await mobilePage.goto(new URL(roomSlug, APP_BASE_URL).toString(), { waitUntil: "networkidle" });
  await joinAsGuest(mobilePage, "Production Smoke Phone");
  await mobilePage.waitForTimeout(3_000);
  await mobileContext.setOffline(true);
  await mobilePage.waitForTimeout(12_000);
  await mobileContext.setOffline(false);
  await mobilePage.evaluate(() => {
    window.dispatchEvent(new Event("online"));
  });

  const mobileRecovered = await waitForRoomState(mobilePage, 35_000);
  addCheck("mobile-recovery-no-fatal-media-error", mobileRecovered.kind !== "media_error", mobileRecovered);
  addCheck("mobile-recovery-media-ready", mobileRecovered.kind === "media_ready", mobileRecovered);
  addCheck("mobile-recovery-no-browser-errors", mobileLogs.errors.length === 0, {
    errors: mobileLogs.errors,
  });

  await Promise.all([hostContext.close(), mobileContext.close()]);
} finally {
  await browser.close();
}

finishReport();

async function joinAsGuest(page, name) {
  await page.getByRole("heading", { name: "Join as a guest" }).waitFor({ timeout: 15_000 });
  await page.getByRole("textbox", { name: "Display name" }).fill(name);
  await page.getByRole("button", { name: /Enter Room/i }).click();
}

async function waitForRoomState(page, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const body = await page.locator("body").innerText().catch(() => "");

    if (/Live media failed:/i.test(body)) {
      return {
        bodyPreview: body.slice(0, 2_000),
        kind: "media_error",
        url: page.url(),
      };
    }

    if (/Camera and microphone are live\./i.test(body)) {
      return {
        bodyPreview: body.slice(0, 2_000),
        kind: "media_ready",
        url: page.url(),
      };
    }

    await page.waitForTimeout(500);
  }

  return {
    bodyPreview: (await page.locator("body").innerText().catch(() => "")).slice(0, 2_000),
    kind: "timeout",
    url: page.url(),
  };
}

function attachPageLogging(page) {
  const errors = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      const entry = `console:${message.text()}`;
      if (!isExpectedOfflineError(entry)) {
        errors.push(entry);
      }
    }
  });
  page.on("pageerror", (error) => {
    errors.push(`pageerror:${error.message}`);
  });
  page.on("requestfailed", (request) => {
    const entry = `requestfailed:${request.method()} ${request.url()} ${request.failure()?.errorText ?? "unknown"}`;
    if (!isExpectedOfflineError(entry)) {
      errors.push(entry);
    }
  });

  return { errors };
}

function addCheck(name, ok, details) {
  report.checks.push({ details, name, ok });
}

function finishReport() {
  const failures = report.checks.filter((check) => !check.ok);
  if (failures.length > 0) {
    console.error(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify(report, null, 2));
}

function normalizeBaseUrl(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function isExpectedOfflineError(message) {
  return /ERR_INTERNET_DISCONNECTED/i.test(message);
}
