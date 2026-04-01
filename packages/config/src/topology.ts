import { APP_HOSTS } from "./routes";

export type SurfaceKind =
  | "public-gateway"
  | "app"
  | "api"
  | "realtime"
  | "media"
  | "auth"
  | "admin"
  | "docs"
  | "preview";

export type CloudflareProduct = "pages" | "workers";

export interface WorkerServiceBinding {
  binding: string;
  service: string;
}

export interface WorkerAnalyticsBinding {
  binding: string;
}

export interface DurableObjectBinding {
  name: string;
  className: string;
}

export interface TopologyArtifactDescriptor {
  fileName: string;
  format: "json" | "markdown" | "csv" | "checksum" | "bundle";
  contentType: string;
  sizeBytes: number;
  sha256: string | null;
  downloadPath: string;
  publishedPaths: string[];
  publicUrls: string[];
}

export interface TopologyArtifactBundle {
  product: string;
  source: string;
  artifactBaseName: string;
  artifacts: TopologyArtifactDescriptor[];
}

export interface DomainSurface {
  kind: SurfaceKind;
  hostname: string;
  cloudflareProduct: CloudflareProduct;
  workspaceTarget: string;
  wranglerName: string;
  purpose: string;
  rolloutStatus: "ready" | "active";
  healthPath?: string;
  requiredEnvVars?: string[];
  serviceBindings?: WorkerServiceBinding[];
  analyticsBindings?: WorkerAnalyticsBinding[];
  durableObjectBindings?: DurableObjectBinding[];
}

export const OPSUI_MEETS_SURFACES: DomainSurface[] = [
  {
    kind: "public-gateway",
    hostname: APP_HOSTS.public,
    cloudflareProduct: "workers",
    workspaceTarget: "apps/gateway-worker",
    wranglerName: "opsui-meets-gateway",
    purpose: "Public landing, room join routing, and app gateway.",
    rolloutStatus: "ready",
    healthPath: "/v1/health",
    serviceBindings: [
      {
        binding: "AUTH_SERVICE",
        service: "opsui-meets-auth",
      },
      {
        binding: "API_SERVICE",
        service: "opsui-meets-api",
      },
    ],
  },
  {
    kind: "app",
    hostname: APP_HOSTS.app,
    cloudflareProduct: "pages",
    workspaceTarget: "apps/web",
    wranglerName: "opsui-meets-web",
    purpose: "Primary meeting dashboard, prejoin, and live-room app shell.",
    rolloutStatus: "ready",
  },
  {
    kind: "api",
    hostname: APP_HOSTS.api,
    cloudflareProduct: "workers",
    workspaceTarget: "apps/api-worker",
    wranglerName: "opsui-meets-api",
    purpose: "Edge API for rooms, meetings, moderation, summaries, and exports.",
    rolloutStatus: "ready",
    healthPath: "/v1/health",
    requiredEnvVars: ["APP_ENV", "APP_DATA_MODE"],
    serviceBindings: [
      {
        binding: "REALTIME_SERVICE",
        service: "opsui-meets-realtime",
      },
      {
        binding: "MEDIA_SERVICE",
        service: "opsui-meets-media",
      },
    ],
    analyticsBindings: [
      {
        binding: "ANALYTICS",
      },
    ],
  },
  {
    kind: "realtime",
    hostname: APP_HOSTS.ws,
    cloudflareProduct: "workers",
    workspaceTarget: "apps/realtime-worker",
    wranglerName: "opsui-meets-realtime",
    purpose: "Realtime signaling and room coordination boundary.",
    rolloutStatus: "ready",
    healthPath: "/v1/health",
    durableObjectBindings: [
      {
        name: "ROOM_COORDINATOR",
        className: "RoomCoordinator",
      },
    ],
  },
  {
    kind: "media",
    hostname: APP_HOSTS.media,
    cloudflareProduct: "workers",
    workspaceTarget: "apps/media-worker",
    wranglerName: "opsui-meets-media",
    purpose: "Media delivery, upload, and recording service boundary.",
    rolloutStatus: "ready",
    healthPath: "/v1/health",
    requiredEnvVars: [],
    serviceBindings: [
      {
        binding: "MEDIA_CONTROL_SERVICE",
        service: "opsui-meets-media-control",
      },
    ],
  },
  {
    kind: "auth",
    hostname: APP_HOSTS.auth,
    cloudflareProduct: "workers",
    workspaceTarget: "apps/auth-worker",
    wranglerName: "opsui-meets-auth",
    purpose: "Session, join-token, and authentication glue services.",
    rolloutStatus: "ready",
    healthPath: "/v1/health",
    requiredEnvVars: [
      "COOKIE_DOMAIN",
      "ALLOW_MOCK_AUTH",
      "APP_ENV",
      "DEFAULT_WORKSPACE_ID",
      "AUTH_ENFORCE_MEMBERSHIP_DIRECTORY",
      "OIDC_SCOPE",
      "OIDC_WORKSPACE_CLAIM",
      "OIDC_EMAIL_DOMAIN_WORKSPACE_MAP",
      "OIDC_ALLOWED_WORKSPACE_IDS",
      "OIDC_ROLE_CLAIM",
      "OIDC_DEFAULT_ROLE",
    ],
    analyticsBindings: [
      {
        binding: "ANALYTICS",
      },
    ],
  },
  {
    kind: "admin",
    hostname: APP_HOSTS.admin,
    cloudflareProduct: "pages",
    workspaceTarget: "apps/admin",
    wranglerName: "opsui-meets-admin",
    purpose: "Internal governance, policy, audit, and delivery operations UI.",
    rolloutStatus: "ready",
  },
  {
    kind: "docs",
    hostname: APP_HOSTS.docs,
    cloudflareProduct: "pages",
    workspaceTarget: "apps/docs",
    wranglerName: "opsui-meets-docs",
    purpose: "Product, platform, and deployment documentation surface.",
    rolloutStatus: "ready",
  },
  {
    kind: "preview",
    hostname: APP_HOSTS.preview,
    cloudflareProduct: "pages",
    workspaceTarget: "apps/preview",
    wranglerName: "opsui-meets-preview",
    purpose: "Staging and preview lane for rollout validation.",
    rolloutStatus: "active",
  },
];

export function getSurfaceByKind(kind: SurfaceKind): DomainSurface | undefined {
  return OPSUI_MEETS_SURFACES.find((surface) => surface.kind === kind);
}

export function getSurfaceHealthUrl(surface: DomainSurface): string | null {
  return surface.healthPath ? `https://${surface.hostname}${surface.healthPath}` : null;
}
