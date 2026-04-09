import { chromium, devices } from "@playwright/test";

const APP_BASE_URL = normalizeBaseUrl(process.env.MEETING_RUNTIME_SMOKE_APP_URL ?? "https://app.opsuimeets.com");
const API_BASE_URL = normalizeBaseUrl(process.env.MEETING_RUNTIME_SMOKE_API_URL ?? "https://api.opsuimeets.com");
const REALTIME_BASE_URL = normalizeWsUrl(process.env.MEETING_RUNTIME_SMOKE_REALTIME_URL ?? "wss://ws.opsuimeets.com");
const ALLOW_CREATE = process.env.MEETING_RUNTIME_SMOKE_ALLOW_CREATE === "true";
const OUTPUT_DIR = "output/playwright";
const GUEST_HEADERS = {
  "x-workspace-id": "workspace_local",
  "x-user-id": "guest_anonymous",
};

if (!ALLOW_CREATE) {
  console.error(
    "Refusing to create throwaway production-like meetings without explicit opt-in. Set MEETING_RUNTIME_SMOKE_ALLOW_CREATE=true.",
  );
  process.exit(1);
}

const report = {
  apiBaseUrl: API_BASE_URL,
  appBaseUrl: APP_BASE_URL,
  checks: [],
  realtimeBaseUrl: REALTIME_BASE_URL,
  roomSlug: null,
};

const browser = await chromium.launch({ headless: true });

try {
  const desktopContext = await browser.newContext();
  const desktopPage = await desktopContext.newPage();
  const desktopLogs = attachPageLogging(desktopPage);

  const createdMeeting = await createThrowawayMeeting(desktopPage);
  addCheck("desktop-start-meeting", createdMeeting.ok, createdMeeting);
  if (!createdMeeting.ok || !createdMeeting.roomSlug) {
    addCheck("desktop-browser-errors", desktopLogs.errors.length === 0, {
      errors: desktopLogs.errors,
    });
    finishReport();
  }

  const roomSlug = createdMeeting.roomSlug;
  report.roomSlug = roomSlug;

  const desktopBody = await desktopPage.locator("body").innerText();
  addCheck("desktop-room-page-loaded", !/Meeting services are temporarily unavailable/i.test(desktopBody), {
    bodyPreview: desktopBody.slice(0, 1_000),
    roomSlug,
  });

  const fetchProbe = await desktopPage.evaluate(async ({ apiBaseUrl, roomSlug }) => {
    async function run(label, init) {
      try {
        const response = await fetch(`${apiBaseUrl}/v1/rooms/resolve/${roomSlug}`, init);
        return {
          label,
          ok: response.ok,
          status: response.status,
          text: await response.text(),
        };
      } catch (error) {
        return {
          error: String(error),
          label,
        };
      }
    }

    return [
      await run("plain", undefined),
      await run("custom", {
        headers: {
          "x-workspace-id": "workspace_local",
          "x-user-id": "guest_anonymous",
        },
      }),
    ];
  }, { apiBaseUrl: API_BASE_URL, roomSlug });
  const plainFetchProbe = fetchProbe.find((entry) => entry.label === "plain");
  const customFetchProbe = fetchProbe.find((entry) => entry.label === "custom");
  addCheck("browser-plain-room-resolve", Boolean(plainFetchProbe?.ok), plainFetchProbe);
  addCheck("browser-custom-room-resolve", Boolean(customFetchProbe?.ok), customFetchProbe);

  const room = await fetchJson(`${API_BASE_URL}/v1/rooms/resolve/${encodeURIComponent(roomSlug)}`, {
    headers: GUEST_HEADERS,
  });
  const meetings = await fetchJson(`${API_BASE_URL}/v1/meetings`, {
    headers: GUEST_HEADERS,
  });
  const meeting = Array.isArray(meetings.items)
    ? meetings.items.find((entry) => entry.roomId === room.id)
    : null;
  addCheck("meeting-created-in-api", Boolean(meeting?.id), {
    meetingId: meeting?.id ?? null,
    roomId: room.id,
  });

  let snapshotParticipantId = null;
  if (meeting?.id) {
    const realtimeProbe = await probeRealtime(meeting.id);
    addCheck("realtime-ping-and-snapshot", realtimeProbe.ok, realtimeProbe);
    snapshotParticipantId = realtimeProbe.participantId ?? null;

    const joinProbe = await postJson(`${API_BASE_URL}/v1/meetings/${meeting.id}/join`, {
      clientSessionId: `smoke-${Date.now()}`,
      displayName: "Production Smoke Guest",
      roomId: room.id,
      sessionType: "guest",
    });
    addCheck("api-join-direct", joinProbe.ok, joinProbe);

    const participants = await fetchJson(`${API_BASE_URL}/v1/meetings/${meeting.id}/participants`, {
      headers: GUEST_HEADERS,
    });
    addCheck("participants-list-after-join", Array.isArray(participants.items), {
      count: Array.isArray(participants.items) ? participants.items.length : null,
      sample: Array.isArray(participants.items) ? participants.items.slice(0, 3) : participants,
    });

    const participantId =
      (joinProbe.body && typeof joinProbe.body.participantId === "string" ? joinProbe.body.participantId : null) ??
      snapshotParticipantId;
    if (participantId) {
      const mediaProbe = await postJson(`${API_BASE_URL}/v1/meetings/${meeting.id}/media-session`, {
        displayName: "Production Smoke Guest",
        participantId,
        role: "host",
      });
      addCheck("media-session-create", mediaProbe.ok, mediaProbe);
    }
  }

  addCheck("desktop-browser-errors", desktopLogs.errors.length === 0, {
    errors: desktopLogs.errors,
  });

  const mobileContext = await browser.newContext({
    ...devices["iPhone 13"],
  });
  const mobilePage = await mobileContext.newPage();
  const mobileLogs = attachPageLogging(mobilePage);
  await mobilePage.goto(new URL(roomSlug, APP_BASE_URL).toString(), { waitUntil: "networkidle" });
  const mobileBody = await mobilePage.locator("body").innerText();
  addCheck("mobile-room-page-loaded", !/Meeting services are temporarily unavailable/i.test(mobileBody), {
    bodyPreview: mobileBody.slice(0, 1_000),
  });
  addCheck("mobile-browser-errors", mobileLogs.errors.length === 0, {
    errors: mobileLogs.errors,
  });

  await Promise.all([desktopContext.close(), mobileContext.close()]);
} finally {
  await browser.close();
}

finishReport();

async function createThrowawayMeeting(page) {
  await page.goto(APP_BASE_URL, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Start Meeting" }).click();

  const started = await waitForRoomUrl(page, 30_000);
  if (!started) {
    return {
      bodyPreview: (await page.locator("body").innerText()).slice(0, 1_000),
      ok: false,
      roomSlug: null,
      url: page.url(),
    };
  }

  const pathname = new URL(page.url()).pathname;
  const roomSlug = pathname.replace(/^\/+/, "");
  if (!roomSlug.startsWith("ops-")) {
    return {
      bodyPreview: (await page.locator("body").innerText()).slice(0, 1_000),
      ok: false,
      roomSlug: null,
      url: page.url(),
    };
  }

  return {
    ok: true,
    roomSlug,
    url: page.url(),
  };
}

function attachPageLogging(page) {
  const errors = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`console:${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    errors.push(`pageerror:${error.message}`);
  });
  page.on("requestfailed", (request) => {
    errors.push(`requestfailed:${request.method()} ${request.url()} ${request.failure()?.errorText ?? "unknown"}`);
  });

  return { errors };
}

async function waitForRoomUrl(page, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const pathname = new URL(page.url()).pathname;
    if (/^\/ops-[a-z0-9]+$/i.test(pathname)) {
      return true;
    }

    await page.waitForTimeout(250);
  }

  return false;
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  return JSON.parse(text);
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...GUEST_HEADERS,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();

  return {
    body: tryParseJson(text),
    ok: response.ok,
    status: response.status,
    textPreview: text.slice(0, 500),
  };
}

async function probeRealtime(meetingId) {
  return new Promise((resolve) => {
    const socket = new WebSocket(`${REALTIME_BASE_URL}/v1/rooms/${meetingId}`);
    const timeoutId = setTimeout(() => {
      socket.close();
      resolve({
        error: "timeout",
        ok: false,
      });
    }, 8_000);
    const messages = [];

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "ping" }));
      socket.send(JSON.stringify({ type: "snapshot.request" }));
    });
    socket.addEventListener("message", (event) => {
      messages.push(String(event.data));
      if (messages.length < 2) {
        return;
      }

      clearTimeout(timeoutId);
      socket.close();
      const parsedMessages = messages.map((entry) => tryParseJson(entry));
      const snapshot = parsedMessages.find((entry) => entry?.type === "room.snapshot");
      const participantId = snapshot?.payload?.participants
        ? Object.keys(snapshot.payload.participants)[0] ?? null
        : null;
      resolve({
        messages: parsedMessages,
        ok: true,
        participantId,
      });
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeoutId);
      resolve({
        error: "websocket_error",
        ok: false,
      });
    });
  });
}

function addCheck(name, ok, detail) {
  report.checks.push({
    detail,
    name,
    ok,
  });
}

function finishReport() {
  for (const check of report.checks) {
    const prefix = check.ok ? "PASS" : "FAIL";
    console.log(`${prefix} ${check.name}`);
    console.log(JSON.stringify(check.detail, null, 2));
  }

  const failedChecks = report.checks.filter((check) => !check.ok);
  if (failedChecks.length > 0) {
    console.error(
      `Production meeting smoke failed ${failedChecks.length} check(s) against ${APP_BASE_URL}.`,
    );
    process.exit(1);
  }

  console.log(
    `Production meeting smoke passed ${report.checks.length} checks against ${APP_BASE_URL}.`,
  );
}

function normalizeBaseUrl(value) {
  const nextValue = /^https?:\/\//.test(value) ? value : `https://${value}`;
  return nextValue.endsWith("/") ? nextValue.slice(0, -1) : nextValue;
}

function normalizeWsUrl(value) {
  if (/^wss?:\/\//.test(value)) {
    return value.replace(/\/+$/, "");
  }

  return `wss://${value.replace(/\/+$/, "")}`;
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
