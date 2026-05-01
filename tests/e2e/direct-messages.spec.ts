import { expect, test, type Page } from "@playwright/test";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FIXTURE_API_URL = "http://127.0.0.1:9877";
const FIXTURE_AUTH_URL = "http://127.0.0.1:9878";
const FIXTURE_RESET_URL = `${FIXTURE_API_URL}/__reset`;

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a40cAAAAASUVORK5CYII=",
  "base64",
);
const TINY_MP4 = Buffer.from("00000020667479706d703432000000006d7034326d703431", "hex");
const TINY_PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF", "utf8");
const TINY_ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x00, 0x00]);

test.beforeEach(async ({ request }) => {
  const response = await request.post(FIXTURE_RESET_URL);
  expect(response.ok()).toBeTruthy();
});

test("unauthenticated users are prompted to sign in before accessing direct messages", async ({ page }) => {
  await page.goto("/direct-messages");

  await expect(page.getByRole("heading", { name: "Sign in to send direct messages" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("button", { name: "Sign In" })).toBeVisible();
});

test("searching by username opens a persistent thread with full saved history", async ({ browser }) => {
  test.setTimeout(45_000);
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const firstPage = await firstContext.newPage();
  const secondPage = await secondContext.newPage();

  try {
    await signUpIndividual(firstPage, {
      email: "alex@example.com",
      username: "alex.chat",
      firstName: "Alex",
      lastName: "Chat",
      password: "password123",
    });
    await signUpIndividual(secondPage, {
      email: "blair@example.com",
      username: "blair.chat",
      firstName: "Blair",
      lastName: "Chat",
      password: "password123",
    });

    await openDirectMessageThread(firstPage, "blair.chat", /Blair Chat/i);
    await sendComposerMessage(firstPage, "Hey Blair, this should stay saved.");

    await expect(firstPage.locator(".dm-message__bubble").getByText("Hey Blair, this should stay saved.")).toBeVisible();
    await expect(firstPage.getByRole("button", { name: /Blair Chat/i }).first()).toBeVisible();

    await firstPage.goto("/");
    await firstPage.goto("/direct-messages");
    await firstPage.getByRole("button", { name: /Blair Chat/i }).click();
    await expect(firstPage.locator(".dm-message__bubble").getByText("Hey Blair, this should stay saved.")).toBeVisible();
  } finally {
    await Promise.allSettled([firstContext.close(), secondContext.close()]);
  }
});

test("group chats can be created from existing chats and searched users", async ({ browser }) => {
  test.setTimeout(60_000);
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const thirdContext = await browser.newContext();
  const firstPage = await firstContext.newPage();
  const secondPage = await secondContext.newPage();
  const thirdPage = await thirdContext.newPage();

  try {
    await signUpIndividual(firstPage, {
      email: "group-owner@example.com",
      username: "group.owner",
      firstName: "Group",
      lastName: "Owner",
      password: "password123",
    });
    await signUpIndividual(secondPage, {
      email: "group-blair@example.com",
      username: "group.blair",
      firstName: "Blair",
      lastName: "Group",
      password: "password123",
    });
    await signUpIndividual(thirdPage, {
      email: "group-casey@example.com",
      username: "group.casey",
      firstName: "Casey",
      lastName: "Group",
      password: "password123",
    });

    await openDirectMessageThread(firstPage, "group.blair", /Blair Group/i);
    await sendComposerMessage(firstPage, "Direct chat exists before creating the group.");

    await firstPage.goto("/direct-messages");
    await firstPage.getByRole("button", { name: "Create group chat" }).click();

    const groupCreator = firstPage.locator(".dm-group-creator");
    await expect(groupCreator.locator(".dm-group-candidate .dm-search-result__name").first()).toHaveText("Blair Group");
    await groupCreator.getByRole("button", { name: /Blair Group/i }).click();
    await groupCreator.getByRole("searchbox", { name: "Search people for group chat" }).fill("group.casey");
    await groupCreator.getByRole("button", { name: /Casey Group/i }).click();
    await groupCreator.getByRole("button", { name: "Create" }).click();

    await expect(firstPage).toHaveURL(/\/direct-messages\/.+$/);
    await expect(firstPage.locator(".dm-conversation__name")).toContainText("Blair Group");
    await expect(firstPage.locator(".dm-conversation__name")).toContainText("Casey Group");
    await expect(firstPage.locator(".dm-conversation__username")).toHaveText("3 members");
    await sendComposerMessage(firstPage, "Hello group.");

    await secondPage.goto("/direct-messages");
    await expect(secondPage.getByRole("button", { name: /Group Owner, Casey Group/i })).toBeVisible();
    await secondPage.getByRole("button", { name: /Group Owner, Casey Group/i }).click();
    await expect(secondPage.locator(".dm-message__bubble").getByText("Hello group.")).toBeVisible();
  } finally {
    await Promise.allSettled([firstContext.close(), secondContext.close(), thirdContext.close()]);
  }
});

test("active users show an online indicator on direct-message avatars", async ({ browser }) => {
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const firstPage = await firstContext.newPage();
  const secondPage = await secondContext.newPage();

  try {
    await signUpIndividual(firstPage, {
      email: "online-a@example.com",
      username: "online.alpha",
      firstName: "Online",
      lastName: "Alpha",
      password: "password123",
    });
    await signUpIndividual(secondPage, {
      email: "online-b@example.com",
      username: "online.beta",
      firstName: "Online",
      lastName: "Beta",
      password: "password123",
    });

    await expect.poll(async () => {
      const response = await dmApiRequest(firstPage, {
        method: "GET",
        pathname: "/v1/direct-messages/search?query=online.beta",
      });
      return Boolean(response.body?.items?.[0]?.isOnline);
    }).toBe(true);

    await firstPage.goto("/direct-messages");
    await firstPage.getByRole("searchbox").fill("online.beta");

    const searchResult = firstPage.getByRole("button", { name: /Online Beta/i });
    await expect(searchResult.locator(".dm-avatar__online")).toBeVisible();

    await searchResult.click();
    await expect(firstPage.locator(".dm-thread-item.is-active .dm-avatar__online")).toBeVisible();
    await expect(firstPage.locator(".dm-conversation__header .dm-avatar__online")).toBeVisible();
  } finally {
    await Promise.allSettled([firstContext.close(), secondContext.close()]);
  }
});

test("conversation list stays visible when a refresh request fails", async ({ browser }) => {
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const firstPage = await firstContext.newPage();
  const secondPage = await secondContext.newPage();
  let failThreadListRefresh = false;
  let failedThreadListRefreshes = 0;

  try {
    await firstPage.route("**/v1/direct-messages/threads", async (route) => {
      if (route.request().method() === "GET" && failThreadListRefresh) {
        failedThreadListRefreshes += 1;
        await route.abort("failed");
        return;
      }

      await route.continue();
    });

    await signUpIndividual(firstPage, {
      email: "resilient-a@example.com",
      username: "resilient.a",
      firstName: "Resilient",
      lastName: "Alpha",
      password: "password123",
    });
    await signUpIndividual(secondPage, {
      email: "resilient-b@example.com",
      username: "resilient.b",
      firstName: "Resilient",
      lastName: "Beta",
      password: "password123",
    });

    await openDirectMessageThread(firstPage, "resilient.b", /Resilient Beta/i);
    await sendComposerMessage(firstPage, "This thread must not disappear after one failed refresh.");
    await firstPage.goto("/direct-messages");
    await expect(firstPage.getByRole("button", { name: /Resilient Beta/i })).toBeVisible();

    failThreadListRefresh = true;
    await firstPage.evaluate(() => {
      window.dispatchEvent(new Event("focus"));
    });

    await expect.poll(() => failedThreadListRefreshes).toBeGreaterThan(0);
    await expect(firstPage.getByRole("button", { name: /Resilient Beta/i })).toBeVisible();
    await expect(
      firstPage.getByText("Search for a username above to start your first direct conversation."),
    ).toHaveCount(0);
  } finally {
    await Promise.allSettled([firstContext.close(), secondContext.close()]);
  }
});

test("legacy direct-message payloads without attachments still render usable threads", async ({ browser }) => {
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const firstPage = await firstContext.newPage();
  const secondPage = await secondContext.newPage();
  const pageErrors: string[] = [];

  try {
    firstPage.on("pageerror", (error) => {
      pageErrors.push(error.message);
    });
    await signUpIndividual(firstPage, {
      email: "legacy-a@example.com",
      username: "legacy.a",
      firstName: "Legacy",
      lastName: "Alpha",
      password: "password123",
    });
    await signUpIndividual(secondPage, {
      email: "legacy-b@example.com",
      username: "legacy.b",
      firstName: "Legacy",
      lastName: "Beta",
      password: "password123",
    });

    await openDirectMessageThread(firstPage, "legacy.b", /Legacy Beta/i);
    await sendComposerMessage(firstPage, "Old payload still needs to render.");
    await firstPage.goto("/direct-messages");

    await firstPage.route("**/v1/direct-messages/threads/*/messages", async (route) => {
      const response = await route.fetch();
      const payload = await response.json().catch(() => null) as { items?: Array<Record<string, unknown>> } | null;
      if (payload && Array.isArray(payload.items)) {
        payload.items = payload.items.map((item) => {
          const next = { ...item };
          delete next.attachments;
          return next;
        });
      }

      await route.fulfill({
        response,
        json: payload ?? { items: [] },
      });
    });

    await firstPage.getByRole("button", { name: /Legacy Beta/i }).click();
    await expect(firstPage.locator(".dm-conversation__header")).toBeVisible();
    await expect(firstPage.locator(".dm-message__bubble").getByText("Old payload still needs to render.")).toBeVisible();
    expect(pageErrors).toEqual([]);
  } finally {
    await Promise.allSettled([firstContext.close(), secondContext.close()]);
  }
});

test("direct messages work across organisation and personal accounts with unread badges", async ({ browser }) => {
  const organisationContext = await browser.newContext();
  const personalContext = await browser.newContext();
  const organisationPage = await organisationContext.newPage();
  const personalPage = await personalContext.newPage();

  try {
    await signUpOrganisation(organisationPage, {
      organizationName: "Acme Direct",
      email: "owner@acme.com",
      username: "acme.owner",
      firstName: "Acme",
      lastName: "Owner",
      password: "password123",
    });
    await signUpIndividual(personalPage, {
      email: "solo@example.com",
      username: "solo.member",
      firstName: "Solo",
      lastName: "Member",
      password: "password123",
    });

    await openDirectMessageThread(organisationPage, "solo.member", /Solo Member/i);
    await sendComposerMessage(organisationPage, "Hello from the organisation side.");
    await expect(organisationPage.locator(".dm-message__bubble").getByText("Hello from the organisation side.")).toBeVisible();

    await personalPage.goto("/");
    await personalPage.getByRole("button", { name: "Open navigation" }).click();
    await expect(personalPage.getByRole("button", { name: /Direct Messages/i })).toContainText("1");
    await personalPage.getByRole("button", { name: /Direct Messages/i }).click();

    await expect(personalPage.getByRole("button", { name: /Acme Owner/i })).toContainText("1");
    await personalPage.getByRole("button", { name: /Acme Owner/i }).click();
    await expect(personalPage.locator(".dm-message__bubble").getByText("Hello from the organisation side.")).toBeVisible();

    await personalPage.getByRole("button", { name: "Open navigation" }).click();
    await expect(personalPage.getByRole("button", { name: /Direct Messages/i })).toHaveCount(1);
    await expect(personalPage.getByRole("button", { name: /Direct Messages/i })).not.toContainText("1");
  } finally {
    await Promise.allSettled([organisationContext.close(), personalContext.close()]);
  }
});

test("image attachments render inline in chat and remain visible after reload", async ({ browser }) => {
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const firstPage = await firstContext.newPage();
  const secondPage = await secondContext.newPage();

  try {
    await signUpIndividual(firstPage, {
      email: "ivy@example.com",
      username: "ivy.dm",
      firstName: "Ivy",
      lastName: "Preview",
      password: "password123",
    });
    await signUpIndividual(secondPage, {
      email: "nina@example.com",
      username: "nina.dm",
      firstName: "Nina",
      lastName: "Preview",
      password: "password123",
    });

    await openDirectMessageThread(firstPage, "nina.dm", /Nina Preview/i);
    await attachFiles(firstPage, [
      {
        name: "preview.png",
        mimeType: "image/png",
        buffer: PNG_1X1,
      },
    ]);
    await sendComposerMessage(firstPage, "Photo proof.");

    await expect(firstPage.locator(".dm-message__bubble").getByText("Photo proof.")).toBeVisible();
    await expect(firstPage.locator(".dm-attachment-card__image")).toBeVisible();

    await firstPage.goto("/");
    await firstPage.goto("/direct-messages");
    await firstPage.getByRole("button", { name: /Nina Preview/i }).click();
    await expect(firstPage.locator(".dm-attachment-card__image")).toBeVisible();
  } finally {
    await Promise.allSettled([firstContext.close(), secondContext.close()]);
  }
});

test("shared files remain in direct-message history after logout and login", async ({ browser }) => {
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const firstPage = await firstContext.newPage();
  const secondPage = await secondContext.newPage();

  try {
    await signUpIndividual(firstPage, {
      email: "history-a@example.com",
      username: "history.a",
      firstName: "History",
      lastName: "Alpha",
      password: "password123",
    });
    await signUpIndividual(secondPage, {
      email: "history-b@example.com",
      username: "history.b",
      firstName: "History",
      lastName: "Beta",
      password: "password123",
    });

    await openDirectMessageThread(firstPage, "history.b", /History Beta/i);
    await attachFiles(firstPage, [
      {
        name: "persistent.png",
        mimeType: "image/png",
        buffer: PNG_1X1,
      },
    ]);
    await sendComposerMessage(firstPage, "File should survive auth churn.");
    await expect(firstPage.locator(".dm-message__bubble").getByText("File should survive auth churn.")).toBeVisible();
    await expect(firstPage.locator(".dm-attachment-card__image")).toBeVisible();

    await firstPage.goto("/sign-in");
    await firstPage.getByRole("button", { name: "Sign Out" }).click();
    await expect(firstPage.getByRole("heading", { name: "Sign in to OpsUI Meets" })).toBeVisible();

    await signInWithPassword(firstPage, {
      email: "history-a@example.com",
      password: "password123",
    });
    await firstPage.goto("/direct-messages");
    await firstPage.getByRole("button", { name: /History Beta/i }).click();

    await expect(firstPage.locator(".dm-message__bubble").getByText("File should survive auth churn.")).toBeVisible();
    await expect(firstPage.locator(".dm-attachment-card__meta").getByText("persistent.png")).toBeVisible();
    await expect(firstPage.locator(".dm-attachment-card__image")).toBeVisible();
  } finally {
    await Promise.allSettled([firstContext.close(), secondContext.close()]);
  }
});

test("video attachments render inline without leaving the conversation", async ({ browser }) => {
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const firstPage = await firstContext.newPage();
  const secondPage = await secondContext.newPage();

  try {
    await signUpIndividual(firstPage, {
      email: "vera@example.com",
      username: "vera.dm",
      firstName: "Vera",
      lastName: "Video",
      password: "password123",
    });
    await signUpIndividual(secondPage, {
      email: "omar@example.com",
      username: "omar.dm",
      firstName: "Omar",
      lastName: "Video",
      password: "password123",
    });

    await openDirectMessageThread(firstPage, "omar.dm", /Omar Video/i);
    await attachFiles(firstPage, [
      {
        name: "clip.mp4",
        mimeType: "video/mp4",
        buffer: TINY_MP4,
      },
    ]);
    await sendComposerMessage(firstPage);

    await expect(firstPage).toHaveURL(/\/direct-messages\/.+$/);
    await expect(firstPage.locator(".dm-attachment-card__video")).toBeVisible();
    await expect(firstPage.getByRole("button", { name: "Open" }).first()).toBeVisible();
    await expect(firstPage.getByRole("button", { name: "Download" }).first()).toBeVisible();
  } finally {
    await Promise.allSettled([firstContext.close(), secondContext.close()]);
  }
});

test("attachment-only file messages render cards and thread previews", async ({ browser }) => {
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const firstPage = await firstContext.newPage();
  const secondPage = await secondContext.newPage();

  try {
    await signUpIndividual(firstPage, {
      email: "paul@example.com",
      username: "paul.dm",
      firstName: "Paul",
      lastName: "Files",
      password: "password123",
    });
    await signUpIndividual(secondPage, {
      email: "rhea@example.com",
      username: "rhea.dm",
      firstName: "Rhea",
      lastName: "Files",
      password: "password123",
    });

    await openDirectMessageThread(firstPage, "rhea.dm", /Rhea Files/i);
    await attachFiles(firstPage, [
      {
        name: "brief.pdf",
        mimeType: "application/pdf",
        buffer: TINY_PDF,
      },
      {
        name: "bundle.zip",
        mimeType: "application/zip",
        buffer: TINY_ZIP,
      },
    ]);
    await sendComposerMessage(firstPage);

    await expect(firstPage.locator(".dm-attachment-card")).toHaveCount(2);
    await expect(firstPage.locator(".dm-attachment-card__meta").getByText("brief.pdf")).toBeVisible();
    await expect(firstPage.locator(".dm-attachment-card__meta").getByText("bundle.zip")).toBeVisible();
    await expect(firstPage.locator(".dm-thread-item.is-active .dm-thread-item__preview")).toContainText("Sent 2 files");
  } finally {
    await Promise.allSettled([firstContext.close(), secondContext.close()]);
  }
});

test("composer rejects too many files and files over 100 MB", async ({ browser }) => {
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const firstPage = await firstContext.newPage();
  const secondPage = await secondContext.newPage();
  const largeFilePath = await createLargeFixtureFile("huge.bin", 101 * 1024 * 1024);

  try {
    await signUpIndividual(firstPage, {
      email: "maya@example.com",
      username: "maya.dm",
      firstName: "Maya",
      lastName: "Limits",
      password: "password123",
    });
    await signUpIndividual(secondPage, {
      email: "leo@example.com",
      username: "leo.dm",
      firstName: "Leo",
      lastName: "Limits",
      password: "password123",
    });

    await openDirectMessageThread(firstPage, "leo.dm", /Leo Limits/i);
    await attachFiles(
      firstPage,
      Array.from({ length: 11 }, (_, index) => ({
        name: `tiny-${index + 1}.txt`,
        mimeType: "text/plain",
        buffer: Buffer.from(`tiny-${index + 1}`, "utf8"),
      })),
    );
    await expect(firstPage.getByText("You can attach up to 10 files per message.")).toBeVisible();
    await expect(firstPage.locator(".dm-composer-attachment")).toHaveCount(0);

    await attachFiles(firstPage, [
      largeFilePath,
    ]);
    await sendComposerMessage(firstPage);
    await expect(firstPage.getByText("Files must be 100 MB or smaller.")).toBeVisible();
  } finally {
    await fs.unlink(largeFilePath).catch(() => undefined);
    await Promise.allSettled([firstContext.close(), secondContext.close()]);
  }
});

test("attachment APIs reject cross-thread reuse and non-member access", async ({ browser }) => {
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const thirdContext = await browser.newContext();
  const firstPage = await firstContext.newPage();
  const secondPage = await secondContext.newPage();
  const thirdPage = await thirdContext.newPage();

  try {
    await signUpIndividual(firstPage, {
      email: "alexx@example.com",
      username: "alexx.dm",
      firstName: "Alexx",
      lastName: "Scope",
      password: "password123",
    });
    await signUpIndividual(secondPage, {
      email: "blake@example.com",
      username: "blake.dm",
      firstName: "Blake",
      lastName: "Scope",
      password: "password123",
    });
    await signUpIndividual(thirdPage, {
      email: "casey@example.com",
      username: "casey.dm",
      firstName: "Casey",
      lastName: "Scope",
      password: "password123",
    });

    await openDirectMessageThread(firstPage, "blake.dm", /Blake Scope/i);
    await attachFiles(firstPage, [
      {
        name: "scope.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("scope", "utf8"),
      },
    ]);
    await sendComposerMessage(firstPage, "Scoped file");
    await expect(firstPage.locator(".dm-attachment-card")).toHaveCount(1);

    const threadWithBlake = currentThreadId(firstPage.url());
    const attachmentId = await getLatestAttachmentId(firstPage, threadWithBlake);

    await openDirectMessageThread(firstPage, "casey.dm", /Casey Scope/i);
    const threadWithCasey = currentThreadId(firstPage.url());
    const crossThreadSend = await dmApiRequest(firstPage, {
      method: "POST",
      pathname: `/v1/direct-messages/threads/${threadWithCasey}/messages`,
      body: {
        text: "",
        attachmentIds: [attachmentId],
      },
    });
    expect(crossThreadSend.status).toBe(404);
    expect(crossThreadSend.body?.error).toBe("attachment_not_found");

    const crossMemberFetch = await dmApiRequest(thirdPage, {
      method: "GET",
      pathname: `/v1/direct-messages/attachments/${attachmentId}/content`,
    });
    expect(crossMemberFetch.status).toBe(404);
    expect(crossMemberFetch.body?.error).toBe("attachment_not_found");
  } finally {
    await Promise.allSettled([firstContext.close(), secondContext.close(), thirdContext.close()]);
  }
});

test("composer stays pinned while long direct-message threads scroll", async ({ browser }) => {
  const firstContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const secondContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const firstPage = await firstContext.newPage();
  const secondPage = await secondContext.newPage();

  try {
    await signUpIndividual(firstPage, {
      email: "pinned-a@example.com",
      username: "pinned.a",
      firstName: "Pinned",
      lastName: "Alpha",
      password: "password123",
    });
    await signUpIndividual(secondPage, {
      email: "pinned-b@example.com",
      username: "pinned.b",
      firstName: "Pinned",
      lastName: "Beta",
      password: "password123",
    });

    await openDirectMessageThread(firstPage, "pinned.b", /Pinned Beta/i);
    const threadId = currentThreadId(firstPage.url());

    for (let index = 0; index < 24; index += 1) {
      const response = await dmApiRequest(firstPage, {
        method: "POST",
        pathname: `/v1/direct-messages/threads/${threadId}/messages`,
        body: {
          text: `Pinned message ${index + 1}`,
          attachmentIds: [],
        },
      });
      expect(response.status).toBe(201);
    }

    await firstPage.reload();
    await expect(firstPage.locator(".dm-message")).toHaveCount(24);
    await expect(firstPage.locator(".dm-composer__text-input")).toBeVisible();

    const beforeScroll = await firstPage.evaluate(() => {
      const composer = document.querySelector(".dm-composer");
      const log = document.querySelector(".dm-conversation__messages");
      if (!(composer instanceof HTMLElement) || !(log instanceof HTMLElement)) {
        return null;
      }

      const composerRect = composer.getBoundingClientRect();
      return {
        composerBottom: composerRect.bottom,
        composerTop: composerRect.top,
        logClientHeight: log.clientHeight,
        logScrollHeight: log.scrollHeight,
        viewportHeight: window.innerHeight,
      };
    });

    expect(beforeScroll).not.toBeNull();
    expect(beforeScroll?.logScrollHeight ?? 0).toBeGreaterThan(beforeScroll?.logClientHeight ?? 0);

    const afterScroll = await firstPage.evaluate(() => {
      const composer = document.querySelector(".dm-composer");
      const log = document.querySelector(".dm-conversation__messages");
      if (!(composer instanceof HTMLElement) || !(log instanceof HTMLElement)) {
        return null;
      }

      log.scrollTop = log.scrollHeight;
      const composerRect = composer.getBoundingClientRect();
      return {
        composerBottom: composerRect.bottom,
        composerTop: composerRect.top,
        viewportHeight: window.innerHeight,
      };
    });

    expect(afterScroll).not.toBeNull();
    expect(beforeScroll?.composerTop ?? 0).toBeCloseTo(afterScroll?.composerTop ?? 0, 0);
    expect(beforeScroll?.composerBottom ?? 0).toBeCloseTo(afterScroll?.composerBottom ?? 0, 0);
    expect(afterScroll?.composerBottom ?? 0).toBeLessThanOrEqual((afterScroll?.viewportHeight ?? 0) - 12);
  } finally {
    await Promise.allSettled([firstContext.close(), secondContext.close()]);
  }
});

async function signUpIndividual(
  page: Page,
  input: { email: string; username: string; firstName: string; lastName: string; password: string },
) {
  await page.goto("/sign-up");
  await fillIdentityFields(page, input);
  await page.getByRole("button", { name: "Create Account" }).click();
  await expect(page).toHaveURL("/");
}

async function signInWithPassword(
  page: Page,
  input: { email: string; password: string },
) {
  await page.goto("/sign-in");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(input.email);
  await page.getByLabel("Password").fill(input.password);
  await page.getByRole("main").getByRole("button", { name: "Sign In" }).click();
  await expect(page.getByRole("button", { name: "Signed In" })).toBeDisabled();
}

async function signUpOrganisation(
  page: Page,
  input: {
    organizationName: string;
    email: string;
    username: string;
    firstName: string;
    lastName: string;
    password: string;
  },
) {
  await page.goto("/sign-up");
  await page.getByRole("button", { name: "Create organisation" }).click();
  await page.getByRole("textbox", { name: "Organisation name" }).fill(input.organizationName);
  await page.getByRole("button", { name: "Continue" }).click();
  await fillIdentityFields(page, input);
  await page.getByRole("button", { name: "Create Organisation", exact: true }).click();
  await expect(page).toHaveURL("/my-organisation");
}

async function fillIdentityFields(page: Page, input: { email: string; username: string; firstName: string; lastName: string; password: string }) {
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(input.email);
  await page.getByRole("textbox", { name: "Username", exact: true }).fill(input.username);
  await page.getByRole("textbox", { name: "First name", exact: true }).fill(input.firstName);
  await page.getByRole("textbox", { name: "Last name", exact: true }).fill(input.lastName);
  await page.getByLabel("Password").fill(input.password);
}

async function openDirectMessageThread(page: Page, username: string, resultName: RegExp) {
  await page.goto("/direct-messages");
  await page.getByRole("searchbox").fill(username);
  await page.getByRole("button", { name: resultName }).click();
  await expect(page).toHaveURL(/\/direct-messages\/.+$/);
}

async function attachFiles(
  page: Page,
  files: Array<
    { name: string; mimeType: string; buffer: Buffer } |
    string
  >,
) {
  await page.getByLabel("Attach files").setInputFiles(files);
}

async function sendComposerMessage(page: Page, text?: string) {
  if (text !== undefined) {
    const composerInput = page.locator(".dm-composer__text-input");
    await expect(composerInput).toBeVisible();
    await composerInput.fill(text, { force: true });
  }

  await page.locator(".dm-composer__send-btn").click();
}

function currentThreadId(url: string) {
  const parsed = new URL(url);
  return parsed.pathname.split("/").at(-1) ?? "";
}

async function getLatestAttachmentId(page: Page, threadId: string) {
  const response = await dmApiRequest(page, {
    method: "GET",
    pathname: `/v1/direct-messages/threads/${threadId}/messages`,
  });
  expect(response.status).toBe(200);
  const items = Array.isArray(response.body?.items) ? response.body.items : [];
  const latest = items.at(-1);
  const attachments = Array.isArray(latest?.attachments) ? latest.attachments : [];
  expect(attachments.length).toBeGreaterThan(0);
  return String(attachments[0]?.id ?? "");
}

async function dmApiRequest(
  page: Page,
  input: { method: "GET" | "POST"; pathname: string; body?: unknown },
) {
  return page.evaluate(async ({ apiBaseUrl, authBaseUrl, body, method, pathname }) => {
    const sessionResponse = await fetch(`${authBaseUrl}/v1/session`, {
      credentials: "include",
    });
    const session = await sessionResponse.json();
    const actor = session.actor ?? {};
    const headers = {
      ...(method === "POST" ? { "content-type": "application/json" } : {}),
      "x-session-type": session.sessionType ?? "guest",
      "x-user-email": actor.email ?? "",
      "x-user-id": actor.userId ?? "",
      "x-workspace-id": actor.workspaceId ?? "",
      "x-workspace-role": actor.workspaceRole ?? "",
    };

    const response = await fetch(`${apiBaseUrl}${pathname}`, {
      method,
      credentials: "include",
      headers,
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
    });
    const responseBody = await response.json().catch(() => null);
    return {
      body: responseBody,
      status: response.status,
    };
  }, {
    apiBaseUrl: FIXTURE_API_URL,
    authBaseUrl: FIXTURE_AUTH_URL,
    body: input.body,
    method: input.method,
    pathname: input.pathname,
  });
}

async function createLargeFixtureFile(filename: string, sizeBytes: number) {
  const filePath = join(tmpdir(), `opsui-meets-${Date.now()}-${filename}`);
  await fs.writeFile(filePath, Buffer.alloc(1));
  await fs.truncate(filePath, sizeBytes);
  return filePath;
}
