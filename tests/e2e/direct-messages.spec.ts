import { expect, test, type Page } from "@playwright/test";

const FIXTURE_RESET_URL = "http://127.0.0.1:9877/__reset";

test.beforeEach(async ({ request }) => {
  const response = await request.post(FIXTURE_RESET_URL);
  expect(response.ok()).toBeTruthy();
});

test("unauthenticated users are prompted to sign in before accessing direct messages", async ({ page }) => {
  await page.goto("/direct-messages");

  await expect(page.getByRole("heading", { name: "Sign in to send direct messages" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
});

test("searching by username opens a persistent thread with full saved history", async ({ browser }) => {
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

    await firstPage.goto("/direct-messages");
    await firstPage.getByRole("searchbox").fill("blair.chat");
    await firstPage.getByRole("button", { name: /Blair Chat/i }).click();

    await expect(firstPage).toHaveURL(/\/direct-messages\/.+$/);
    await firstPage.getByPlaceholder("Message @blair.chat").fill("Hey Blair, this should stay saved.");
    await firstPage.getByRole("button", { name: "↗" }).click();

    await expect(firstPage.locator(".chat-message__bubble").getByText("Hey Blair, this should stay saved.")).toBeVisible();
    await expect(firstPage.getByRole("button", { name: /Blair Chat/i }).first()).toBeVisible();

    await firstPage.goto("/");
    await firstPage.goto("/direct-messages");
    await firstPage.getByRole("button", { name: /Blair Chat/i }).click();
    await expect(firstPage.locator(".chat-message__bubble").getByText("Hey Blair, this should stay saved.")).toBeVisible();
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

    await organisationPage.goto("/direct-messages");
    await organisationPage.getByRole("searchbox").fill("solo.member");
    await organisationPage.getByRole("button", { name: /Solo Member/i }).click();
    await organisationPage.getByPlaceholder("Message @solo.member").fill("Hello from the organisation side.");
    await organisationPage.getByRole("button", { name: "↗" }).click();
    await expect(organisationPage.locator(".chat-message__bubble").getByText("Hello from the organisation side.")).toBeVisible();

    await personalPage.goto("/");
    await personalPage.getByRole("button", { name: "Open navigation" }).click();
    await expect(personalPage.getByRole("button", { name: /Direct Messages/i })).toContainText("1");
    await personalPage.getByRole("button", { name: /Direct Messages/i }).click();

    await expect(personalPage.getByRole("button", { name: /Acme Owner/i })).toContainText("1");
    await personalPage.getByRole("button", { name: /Acme Owner/i }).click();
    await expect(personalPage.locator(".chat-message__bubble").getByText("Hello from the organisation side.")).toBeVisible();

    await personalPage.getByRole("button", { name: "Open navigation" }).click();
    await expect(personalPage.getByRole("button", { name: /Direct Messages/i })).toHaveCount(1);
    await expect(personalPage.getByRole("button", { name: /Direct Messages/i })).not.toContainText("1");
  } finally {
    await Promise.allSettled([organisationContext.close(), personalContext.close()]);
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
