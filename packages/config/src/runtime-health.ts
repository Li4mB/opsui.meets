import { OPSUI_MEETS_SURFACES, type SurfaceKind } from "./topology";

export interface RuntimeSurfaceHealth {
  kind: SurfaceKind;
  hostname: string;
  ok: boolean;
  status: number | null;
  payload: Record<string, unknown> | null;
}

const DEFAULT_RUNTIME_HEALTH_KINDS: SurfaceKind[] = [
  "public-gateway",
  "api",
  "auth",
  "realtime",
  "media",
];

export async function loadRuntimeHealth(
  kinds: SurfaceKind[] = DEFAULT_RUNTIME_HEALTH_KINDS,
): Promise<RuntimeSurfaceHealth[]> {
  const selected = OPSUI_MEETS_SURFACES.filter(
    (surface) => kinds.includes(surface.kind) && surface.healthPath,
  );

  return Promise.all(
    selected.map(async (surface) => {
      const url = `https://${surface.hostname}${surface.healthPath}`;
      try {
        const response = await fetch(url, {
          headers: {
            accept: "application/json",
          },
        });
        const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
        return {
          kind: surface.kind,
          hostname: surface.hostname,
          ok: response.ok && payload?.ok === true,
          status: response.status,
          payload,
        } satisfies RuntimeSurfaceHealth;
      } catch {
        return {
          kind: surface.kind,
          hostname: surface.hostname,
          ok: false,
          status: null,
          payload: null,
        } satisfies RuntimeSurfaceHealth;
      }
    }),
  );
}
