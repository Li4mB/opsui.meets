export interface ValidUsername {
  username: string;
  usernameNormalized: string;
}

export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function normalizeOrganizationCode(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

export function normalizeOrganizationName(value: unknown): string {
  return typeof value === "string"
    ? value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    : "";
}

export function validateUsername(value: unknown):
  | { ok: true; value: ValidUsername }
  | { ok: false; error: string; message: string } {
  const username = typeof value === "string" ? value.trim() : "";
  if (!username) {
    return {
      ok: false,
      error: "username_required",
      message: "Username is required.",
    };
  }

  if (username.length < 3 || username.length > 24) {
    return {
      ok: false,
      error: "username_invalid_length",
      message: "Username must be between 3 and 24 characters.",
    };
  }

  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._]*[A-Za-z0-9])?$/.test(username)) {
    return {
      ok: false,
      error: "username_invalid_format",
      message: "Usernames may only use letters, numbers, dots, and underscores, and must start and end with a letter or number.",
    };
  }

  return {
    ok: true,
    value: {
      username,
      usernameNormalized: username.toLowerCase(),
    },
  };
}

export function prettifyEmailLocalPart(email: string): string {
  const localPart = email.includes("@") ? email.split("@")[0] ?? "" : email;
  const cleaned = localPart.replace(/[._-]+/g, " ").trim();
  if (!cleaned) {
    return "Member";
  }

  return cleaned.replace(/\b\w/g, (value) => value.toUpperCase());
}
