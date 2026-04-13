import { expect, test, type Browser, type Page } from "@playwright/test";

const FIXTURE_RESET_URL = "http://127.0.0.1:9877/__reset";

test.beforeEach(async ({ request }) => {
  const response = await request.post(FIXTURE_RESET_URL);
  expect(response.ok()).toBeTruthy();
});

test("individual signup creates a signed-in personal account without My Organisation", async ({ page }) => {
  await page.goto("/sign-up");
  await fillIdentityFields(page, {
    email: "person@example.com",
    username: "casey.lane",
    firstName: "Casey",
    lastName: "Lane",
    password: "password123",
  });
  await page.getByRole("button", { name: "Create Account" }).click();

  await expect(page).toHaveURL("/");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("button", { name: "My Organisation" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();

  await page.goto("/ops-signin");
  await expect(page.getByRole("main").getByText("Casey", { exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByText("casey.lane")).toHaveCount(0);
});

test("create organisation signs the owner in and exposes My Organisation with code and roster", async ({ page }) => {
  await page.goto("/sign-up");
  await page.getByRole("button", { name: "Create organisation" }).click();
  await page.getByRole("textbox", { name: "Organisation name" }).fill("Acme Studio");
  await page.getByRole("button", { name: "Continue" }).click();
  await fillIdentityFields(page, {
    email: "owner@acme.com",
    username: "alex.owner",
    firstName: "Alex",
    lastName: "Owner",
    password: "password123",
  });
  await page.getByRole("button", { name: "Create Organisation", exact: true }).click();

  await expect(page).toHaveURL("/my-organisation");
  await expect(page.getByRole("heading", { name: "Acme Studio", exact: true })).toBeVisible();
  await expect(page.locator(".detail-card").filter({ hasText: "Organisation Code" })).toContainText(/[A-Z0-9]{8}/);
  await expect(page.getByText("Alex Owner")).toBeVisible();
  await expect(page.getByRole("main").getByText("@alex.owner", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("button", { name: "My Organisation" })).toBeVisible();
});

test("opsui-linked organisation shows Super and a business member can join the same organisation", async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const memberContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const memberPage = await memberContext.newPage();

  try {
    await ownerPage.goto("/sign-up");
    await ownerPage.getByRole("button", { name: "Create organisation" }).click();
    await ownerPage.getByRole("textbox", { name: "Organisation name" }).fill("Acme Linked");
    await ownerPage.getByRole("checkbox", { name: /Link this organisation to OpsUI/i }).check();
    await ownerPage.getByRole("button", { name: "Continue" }).click();
    await fillIdentityFields(ownerPage, {
      email: "owner@acme.com",
      username: "alex.owner",
      firstName: "Alex",
      lastName: "Owner",
      password: "password123",
    });
    await ownerPage.getByRole("button", { name: "Create Organisation", exact: true }).click();

    await expect(ownerPage).toHaveURL("/my-organisation");
    await expect(ownerPage.locator(".status-pill--accent").filter({ hasText: "Super" }).first()).toBeVisible();

    const codeText = await ownerPage.locator(".detail-card").filter({ hasText: "Organisation Code" }).textContent();
    const organizationCode = codeText?.match(/[A-Z0-9]{8}/)?.[0] ?? "";
    expect(organizationCode).toHaveLength(8);

    await memberPage.goto("/sign-up");
    await memberPage.getByRole("button", { name: "Sign up with your business" }).click();
    await memberPage.getByRole("textbox", { name: "Organisation code" }).fill(organizationCode);
    await fillIdentityFields(memberPage, {
      email: "member@acme.com",
      username: "mia.member",
      firstName: "Mia",
      lastName: "Member",
      password: "password123",
    });
    await memberPage.getByRole("button", { name: "Join Organisation" }).click();

    await expect(memberPage).toHaveURL("/my-organisation");
    await expect(memberPage.getByRole("heading", { name: "Acme Linked", exact: true })).toBeVisible();
    await expect(memberPage.locator(".detail-card").filter({ hasText: "Organisation Code" })).toContainText(organizationCode);
    await expect(memberPage.getByText("Mia Member")).toBeVisible();
    await expect(memberPage.getByRole("main").getByText("@mia.member", { exact: true })).toBeVisible();
    await expect(memberPage.locator(".status-pill--accent").filter({ hasText: "Super" }).first()).toBeVisible();
  } finally {
    await Promise.allSettled([ownerContext.close(), memberContext.close()]);
  }
});

test("password sign-in works after signup and forms expose password-manager-friendly autocomplete", async ({ page }) => {
  await page.goto("/sign-up");
  await fillIdentityFields(page, {
    email: "login@example.com",
    username: "logan.west",
    firstName: "Logan",
    lastName: "West",
    password: "password123",
  });

  await expect(page.getByRole("textbox", { name: "Email", exact: true })).toHaveAttribute("autocomplete", "email");
  await expect(page.getByRole("textbox", { name: "Username", exact: true })).toHaveAttribute("autocomplete", "username");
  await expect(page.getByRole("textbox", { name: "First name", exact: true })).toHaveAttribute("autocomplete", "given-name");
  await expect(page.getByRole("textbox", { name: "Last name", exact: true })).toHaveAttribute("autocomplete", "family-name");
  await expect(page.getByLabel("Password")).toHaveAttribute("autocomplete", "new-password");

  await page.getByRole("button", { name: "Create Account" }).click();
  await expect(page).toHaveURL("/");

  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sign Out" }).click();
  await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Email", exact: true })).toHaveAttribute("autocomplete", "email");
  await expect(page.getByLabel("Password")).toHaveAttribute("autocomplete", "current-password");

  await page.getByRole("textbox", { name: "Email", exact: true }).fill("login@example.com");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign In" }).click();

  await expect(page.getByText("You are signed in.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Signed In" })).toBeDisabled();
  await expect(page.locator(".detail-card").filter({ hasText: "Username" }).getByText("@logan.west", { exact: true })).toBeVisible();
});

test("duplicate username and duplicate organisation name show clear errors", async ({ browser }) => {
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const thirdContext = await browser.newContext();
  const firstPage = await firstContext.newPage();
  const secondPage = await secondContext.newPage();
  const thirdPage = await thirdContext.newPage();
  try {
    await firstPage.goto("/sign-up");
    await fillIdentityFields(firstPage, {
      email: "owner@acme.com",
      username: "shared.name",
      firstName: "Alex",
      lastName: "Owner",
      password: "password123",
    });
    await firstPage.getByRole("button", { name: "Create Account" }).click();
    await expect(firstPage).toHaveURL("/");

    await secondPage.goto("/sign-up");
    await fillIdentityFields(secondPage, {
      email: "other@example.com",
      username: "shared.name",
      firstName: "Jordan",
      lastName: "West",
      password: "password123",
    });
    await secondPage.getByRole("button", { name: "Create Account" }).click();
    await expect(secondPage.getByText("That username is already taken.")).toBeVisible();

    await secondPage.goto("/sign-up");
    await secondPage.getByRole("button", { name: "Create organisation" }).click();
    await secondPage.getByRole("textbox", { name: "Organisation name" }).fill("Acme-Inc");
    await secondPage.getByRole("button", { name: "Continue" }).click();
    await fillIdentityFields(secondPage, {
      email: "org1@acme.com",
      username: "org.owner.one",
      firstName: "Taylor",
      lastName: "One",
      password: "password123",
    });
    await secondPage.getByRole("button", { name: "Create Organisation", exact: true }).click();
    await expect(secondPage).toHaveURL("/my-organisation");

    await thirdPage.goto("/sign-up");
    await thirdPage.getByRole("button", { name: "Create organisation" }).click();
    await thirdPage.getByRole("textbox", { name: "Organisation name" }).fill("Acme Inc");
    await thirdPage.getByRole("button", { name: "Continue" }).click();
    await fillIdentityFields(thirdPage, {
      email: "org2@acme.com",
      username: "org.owner.two",
      firstName: "Taylor",
      lastName: "Two",
      password: "password123",
    });
    await thirdPage.getByRole("button", { name: "Create Organisation", exact: true }).click();
    await expect(thirdPage.getByText("An organisation with that name already exists.")).toBeVisible();
  } finally {
    await Promise.allSettled([firstContext.close(), secondContext.close(), thirdContext.close()]);
  }
});

test("first-time OIDC sign-in redirects to complete-account and subsequent sign-in reuses the linked account", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Continue with Identity Provider" }).click();

  await expect(page).toHaveURL("/complete-account");
  await page.getByRole("textbox", { name: "Username", exact: true }).fill("oidc.member");
  await page.getByRole("button", { name: "Finish Setup" }).click();

  await expect(page).toHaveURL("/sign-in");
  await expect(page.locator(".detail-card").filter({ hasText: "Username" }).getByText("@oidc.member", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Sign Out" }).click();
  await expect(page.getByRole("button", { name: "Continue with Identity Provider" })).toBeVisible();

  await page.getByRole("button", { name: "Continue with Identity Provider" }).click();
  await expect(page).toHaveURL("/sign-in");
  await expect(page.locator(".detail-card").filter({ hasText: "Username" }).getByText("@oidc.member", { exact: true })).toBeVisible();
});

async function fillIdentityFields(
  page: Page,
  input: { email: string; username: string; firstName: string; lastName: string; password: string },
) {
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(input.email);
  await page.getByRole("textbox", { name: "Username", exact: true }).fill(input.username);
  await page.getByRole("textbox", { name: "First name", exact: true }).fill(input.firstName);
  await page.getByRole("textbox", { name: "Last name", exact: true }).fill(input.lastName);
  await page.getByLabel("Password").fill(input.password);
}
