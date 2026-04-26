import { devices, expect, test, type Browser, type Page } from "@playwright/test";

const FIXTURE_RESET_URL = "http://127.0.0.1:9877/__reset";
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

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
  await expect(page.getByRole("button", { name: "Sign In" })).toHaveCount(0);

  await page.goto("/ops-signin");
  await expect(page.getByRole("main").getByText("Casey", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("main").getByText("casey.lane")).toHaveCount(0);
});

test("signed-in topbar shows profile menu with profile and appearance routes", async ({ page }) => {
  await signInThroughUi(page, "liam@example.com");
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Sign In" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign Up" })).toHaveCount(0);

  const profileTrigger = page.getByRole("button", { name: /@liam/i });
  await expect(profileTrigger).toBeVisible();

  await profileTrigger.hover();
  const menu = page.getByRole("menu", { name: "Account" });
  await expect(menu).toBeVisible();
  await page.getByRole("menuitem", { name: "My profile" }).hover();
  await expect(menu).toBeVisible();

  await page.getByRole("menuitem", { name: "My profile" }).click();
  await expect(page).toHaveURL("/my-profile");
  await expect(page.getByRole("heading", { name: "Liam User" })).toBeVisible();
  await expect(page.getByTestId("profile-avatar-edit")).toBeVisible();
  await expect(page.getByTestId("profile-banner-edit")).toBeVisible();

  await page.getByRole("button", { name: /@liam/i }).hover();
  await page.getByRole("menuitem", { name: "Appearance" }).click();
  await expect(page).toHaveURL("/appearance");
  await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
});

test("my profile visual editor persists colors and uploaded images", async ({ page }) => {
  await page.goto("/sign-up");
  await fillIdentityFields(page, {
    email: "riley.profile@example.com",
    username: "riley.profile",
    firstName: "Riley",
    lastName: "Profile",
    password: "password123",
  });
  await page.getByRole("button", { name: "Create Account" }).click();
  await expect(page).toHaveURL("/");

  await page.goto("/my-profile");
  await expect(page.getByRole("heading", { name: "Riley Profile" })).toBeVisible();
  await expect(page.getByRole("main").getByText("@riley.profile", { exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByText("Riley Profile's Workspace", { exact: true })).toBeVisible();

  await page.getByTestId("profile-avatar-edit").hover();
  await expect(page.locator(".my-profile-avatar__overlay")).toHaveCSS("opacity", "1");
  await page.getByTestId("profile-avatar-edit").click();
  await page.getByRole("dialog").getByRole("button", { name: "Steel blue" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("profile-avatar-surface")).toHaveCSS("background-color", "rgb(61, 126, 170)");
  await expect(page.locator(".topbar-profile__avatar")).toHaveCSS("background-color", "rgb(61, 126, 170)");

  await page.reload();
  await expect(page.getByTestId("profile-avatar-surface")).toHaveCSS("background-color", "rgb(61, 126, 170)");
  await expect(page.locator(".topbar-profile__avatar")).toHaveCSS("background-color", "rgb(61, 126, 170)");

  await page.getByTestId("profile-banner-edit").click();
  await page.getByRole("dialog").getByRole("button", { name: "Muted teal" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("profile-banner-surface")).toHaveCSS("background-color", "rgb(90, 122, 110)");

  await page.reload();
  await expect(page.getByTestId("profile-banner-surface")).toHaveCSS("background-color", "rgb(90, 122, 110)");

  await page.getByTestId("profile-avatar-edit").click();
  await page.getByTestId("profile-visual-file-input").setInputFiles({
    name: "avatar.png",
    mimeType: "image/png",
    buffer: Buffer.from(TINY_PNG_BASE64, "base64"),
  });
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Crop profile picture" })).toBeVisible();
  await expect(page.getByTestId("profile-visual-zoom")).toHaveValue("0");
  await page.getByTestId("profile-visual-zoom").fill("35");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("profile-avatar-image")).toBeVisible();

  await page.getByTestId("profile-banner-edit").click();
  await page.getByTestId("profile-visual-file-input").setInputFiles({
    name: "banner.png",
    mimeType: "image/png",
    buffer: Buffer.from(TINY_PNG_BASE64, "base64"),
  });
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Crop banner" })).toBeVisible();
  await expect(page.getByTestId("profile-visual-zoom")).toHaveValue("0");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("profile-banner-image")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("profile-avatar-image")).toBeVisible();
  await expect(page.getByTestId("profile-banner-image")).toBeVisible();

  await page.getByTestId("profile-avatar-edit").click();
  await page.getByTestId("profile-visual-file-input").setInputFiles({
    name: "avatar.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not an image"),
  });
  await expect(page.getByText("Choose an image file.")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("profile-avatar-image")).toBeVisible();
});

test("profile menu sign out requires confirmation", async ({ page }) => {
  await signInThroughUi(page, "liam@example.com");
  await page.goto("/");

  await page.getByRole("button", { name: /@liam/i }).hover();
  await page.getByRole("menuitem", { name: "Sign out" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Sign out?" })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: /@liam/i })).toBeVisible();

  await page.getByRole("button", { name: /@liam/i }).hover();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Sign out" }).click();

  await expect(page).toHaveURL("/sign-in");
  await expect(page.getByRole("banner").getByRole("button", { name: "Sign In" })).toBeVisible();
  await expect(page.getByRole("button", { name: /@liam/i })).toHaveCount(0);
});

test("profile menu opens from mobile tap", async ({ browser }) => {
  const context = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await context.newPage();

  try {
    await signInThroughUi(page, "liam@example.com");
    await page.goto("/");

    const profileTrigger = page.getByRole("button", { name: /@liam/i });
    await profileTrigger.tap();
    const menu = page.getByRole("menu", { name: "Account" });
    await expect(menu).toBeVisible();

    await profileTrigger.tap();
    await expect(menu).toBeHidden();
  } finally {
    await context.close();
  }
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
  await expect(page.getByRole("main").getByRole("button", { name: "Sign In" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Email", exact: true })).toHaveAttribute("autocomplete", "email");
  await expect(page.getByLabel("Password")).toHaveAttribute("autocomplete", "current-password");

  await page.getByRole("textbox", { name: "Email", exact: true }).fill("login@example.com");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("main").getByRole("button", { name: "Sign In" }).click();

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

async function signInThroughUi(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByRole("textbox", { name: "Mock auth email" }).fill(email);
  await page.getByRole("button", { name: "Use Dev Sign-In" }).click();
  await expect(page.getByText("You are signed in for local testing.")).toBeVisible();
  await expect(page.getByText("Signed in", { exact: true })).toBeVisible();
}
