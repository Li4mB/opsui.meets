import type { Env } from "../types";

export type OpsuiValidationResult =
  | {
      ok: true;
      businessId: string;
      businessName: string;
    }
  | {
      ok: false;
      code: "invalid_credentials" | "no_business_access" | "business_mismatch" | "service_unavailable";
    };

export function isOpsuiValidationConfigured(env: Env): boolean {
  return Boolean(env.OPSUI_VALIDATION_URL?.trim() && env.OPSUI_VALIDATION_SHARED_SECRET?.trim());
}

export async function validateOpsuiCredentials(
  input: { email: string; password: string },
  env: Env,
): Promise<OpsuiValidationResult> {
  if (!isOpsuiValidationConfigured(env)) {
    return {
      ok: false,
      code: "service_unavailable",
    };
  }

  try {
    const response = await fetch(env.OPSUI_VALIDATION_URL!, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-opsui-shared-secret": env.OPSUI_VALIDATION_SHARED_SECRET!,
      },
      body: JSON.stringify({
        email: input.email,
        password: input.password,
      }),
    });

    const payload = (await response.json().catch(() => null)) as
      | {
          ok?: boolean;
          businessId?: string;
          businessName?: string;
          code?: OpsuiValidationResult extends { ok: false; code: infer T } ? T : never;
        }
      | null;

    if (!payload || payload.ok !== true) {
      return {
        ok: false,
        code:
          payload?.code === "invalid_credentials" ||
          payload?.code === "no_business_access" ||
          payload?.code === "business_mismatch"
            ? payload.code
            : "service_unavailable",
      };
    }

    return {
      ok: true,
      businessId: String(payload.businessId ?? ""),
      businessName: String(payload.businessName ?? ""),
    };
  } catch {
    return {
      ok: false,
      code: "service_unavailable",
    };
  }
}
