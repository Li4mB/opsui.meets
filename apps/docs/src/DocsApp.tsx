import { useEffect, useState, type CSSProperties } from "react";
import {
  OPSUI_MEETS_SURFACES,
  formatTopologyArtifactSize,
  getSurfaceHealthUrl,
  getTopologyArtifactLabel,
  loadReadinessReport,
  loadRuntimeHealth,
  loadTopologyArtifactBundle,
} from "@opsui/config";
import type { ReadinessReport, RuntimeSurfaceHealth, TopologyArtifactBundle } from "@opsui/config";

const shellStyle: CSSProperties = {
  minHeight: "100vh",
  background: "radial-gradient(circle at top left, #f6f2e8 0%, #edf1ea 45%, #e2ebe4 100%)",
  color: "#15221b",
  fontFamily: '"Segoe UI", sans-serif',
};

const cardStyle: CSSProperties = {
  background: "rgba(255,255,255,0.86)",
  border: "1px solid rgba(21,34,27,0.08)",
  borderRadius: 22,
  padding: 24,
  boxShadow: "0 18px 40px rgba(21,34,27,0.08)",
};

const quickLinks = OPSUI_MEETS_SURFACES.filter((surface) =>
  ["docs", "app", "api", "realtime"].includes(surface.kind),
).map((surface) => ({
  label: `${surface.kind.replace("-", " ")} domain`,
  value: surface.hostname,
}));

const deliverySurfaceBullets = OPSUI_MEETS_SURFACES.map(
  (surface) =>
    `${surface.kind.replace("-", " ")} / ${surface.cloudflareProduct}: ${surface.hostname} -> ${surface.workspaceTarget} [${surface.wranglerName}]${surface.serviceBindings?.length ? ` services ${surface.serviceBindings.length}` : ""}${surface.analyticsBindings?.length ? ` analytics ${surface.analyticsBindings.length}` : ""}${surface.durableObjectBindings?.length ? ` durable-objects ${surface.durableObjectBindings.length}` : ""}${surface.requiredEnvVars?.length ? ` vars ${surface.requiredEnvVars.join(",")}` : ""}`,
);

const docSections = [
  {
    title: "Platform Model",
    body:
      "OpsUI Meets separates the browser experience, edge control plane, realtime coordination, and heavier media concerns so the join path stays fast and the operating model stays clean.",
    bullets: [
      "Public entry and room join flow on opsuimeets.com",
      "Main app shell on app.opsuimeets.com",
      "Edge API, auth, and websocket services on dedicated subdomains",
      "Media and recording handled behind an explicit service boundary",
    ],
  },
  {
    title: "Operator Principles",
    body:
      "The product is designed around lower clutter, stronger moderation, and faster recovery after things go wrong. The UI favors current room state, not buried settings.",
    bullets: [
      "Host console optimized for one-click action",
      "Late joiners, room locking, and muted entry are first-class controls",
      "Post-meeting outputs are treated as operational artifacts, not afterthoughts",
      "Delivery failures and follow-up retries are visible in admin and host views",
    ],
  },
  {
    title: "Delivery Surfaces",
    body:
      "This workspace already includes the core frontend and worker surfaces needed for the first platform pass, plus this docs app for product and operational documentation.",
    bullets: deliverySurfaceBullets,
  },
];

const implementationTracks = [
  "Replace memory repositories with the Postgres adapter behind @opsui/db",
  "Add Cloudflare Pages deployment config for docs and app surfaces",
  "Wire real auth/session persistence and signed join links",
  "Move delivery retry/audit history into persisted storage and add retention policies",
];

const downloadLinkStyle: CSSProperties = {
  color: "#17372c",
  fontWeight: 700,
};

export function DocsApp() {
  const [artifactBundle, setArtifactBundle] = useState<TopologyArtifactBundle | null>(null);
  const [readinessReport, setReadinessReport] = useState<ReadinessReport | null>(null);
  const [runtimeHealth, setRuntimeHealth] = useState<RuntimeSurfaceHealth[]>([]);

  useEffect(() => {
    let cancelled = false;

    loadTopologyArtifactBundle().then((payload: TopologyArtifactBundle | null) => {
        if (!cancelled && payload) {
          setArtifactBundle(payload);
        }
      });
    loadReadinessReport().then((payload: ReadinessReport | null) => {
      if (!cancelled && payload) {
        setReadinessReport(payload);
      }
    });
    loadRuntimeHealth().then((payload: RuntimeSurfaceHealth[]) => {
      if (!cancelled) {
        setRuntimeHealth(payload);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main style={shellStyle}>
      <div style={{ maxWidth: 1240, margin: "0 auto", padding: "48px 24px 64px" }}>
        <header style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 1.8, color: "#496154" }}>
            OpsUI Meets Docs
          </div>
          <h1 style={{ margin: "10px 0 14px", fontSize: 52, lineHeight: 1 }}>Product, platform, and deployment notes</h1>
          <p style={{ margin: 0, maxWidth: 760, fontSize: 18, lineHeight: 1.6, color: "#456154" }}>
            This docs surface is the internal-first reference for the OpsUI Meets foundation: domain model,
            operating principles, Cloudflare deployment boundaries, and the current implementation status of the workspace.
          </p>
        </header>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "1.5fr 0.9fr",
            gap: 20,
            marginBottom: 20,
          }}
        >
          <div style={{ ...cardStyle, background: "linear-gradient(135deg, rgba(18,51,38,0.98) 0%, rgba(42,83,63,0.94) 100%)", color: "#f3f6f2" }}>
            <div style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: 1.4, opacity: 0.8 }}>
              Foundation Status
            </div>
            <h2 style={{ margin: "10px 0 12px", fontSize: 34 }}>Verified workspace baseline</h2>
            <p style={{ margin: 0, maxWidth: 640, lineHeight: 1.7, color: "rgba(243,246,242,0.88)" }}>
              The monorepo now installs cleanly, passes workspace typecheck, and passes production build verification
              across the Vite apps and Worker dry-run deployments. CI also exports the shared topology artifacts for
              deployment handoff, which makes this a solid base for deeper product work instead of a speculative scaffold.
            </p>
            {readinessReport ? (
              <div
                style={{
                  display: "flex",
                  gap: 14,
                  flexWrap: "wrap",
                  marginTop: 18,
                }}
              >
                {[
                  `Foundations ${readinessReport.summary.readyFoundations}`,
                  `Blockers ${readinessReport.summary.blockers}`,
                  `Hardening ${readinessReport.summary.prelaunchHardening}`,
                ].map((item) => (
                  <div
                    key={item}
                    style={{
                      borderRadius: 999,
                      border: "1px solid rgba(243,246,242,0.16)",
                      padding: "8px 12px",
                      color: "#f3f6f2",
                      fontSize: 13,
                    }}
                  >
                    {item}
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div style={cardStyle}>
            <div style={{ fontSize: 13, textTransform: "uppercase", color: "#496154", marginBottom: 10 }}>
              Quick Links
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              {quickLinks.map((item) => (
                <div
                  key={item.label}
                  style={{
                    borderRadius: 16,
                    background: "#f6faf7",
                    border: "1px solid rgba(21,34,27,0.08)",
                    padding: "14px 16px",
                  }}
                >
                  <div style={{ fontSize: 12, textTransform: "uppercase", color: "#5d786a" }}>{item.label}</div>
                  <div style={{ marginTop: 6, fontWeight: 700 }}>{item.value}</div>
                  {OPSUI_MEETS_SURFACES.find((surface) => surface.hostname === item.value)?.healthPath ? (
                    <div style={{ marginTop: 6, fontSize: 12, color: "#5d786a" }}>
                      {getSurfaceHealthUrl(
                        OPSUI_MEETS_SURFACES.find((surface) => surface.hostname === item.value)!,
                      )}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 20,
            marginBottom: 20,
          }}
        >
          {docSections.map((section) => (
            <div key={section.title} style={cardStyle}>
              <div style={{ fontSize: 13, textTransform: "uppercase", color: "#496154", marginBottom: 10 }}>
                {section.title}
              </div>
              <p style={{ margin: "0 0 14px", color: "#456154", lineHeight: 1.7 }}>{section.body}</p>
              <div style={{ display: "grid", gap: 10 }}>
                {section.bullets.map((bullet) => (
                  <div
                    key={bullet}
                    style={{
                      borderRadius: 14,
                      background: "#f6faf7",
                      border: "1px solid rgba(21,34,27,0.08)",
                      padding: "12px 14px",
                      color: "#365244",
                    }}
                  >
                    {bullet}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "1.1fr 0.9fr",
            gap: 20,
          }}
        >
          <div style={cardStyle}>
            <div style={{ fontSize: 13, textTransform: "uppercase", color: "#496154", marginBottom: 10 }}>
              Next Tracks
            </div>
            <div style={{ display: "grid", gap: 12 }}>
              {implementationTracks.map((item, index) => (
                <div
                  key={item}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "40px 1fr",
                    gap: 12,
                    alignItems: "start",
                    padding: "12px 14px",
                    borderRadius: 16,
                    background: "#f6faf7",
                    border: "1px solid rgba(21,34,27,0.08)",
                  }}
                >
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 999,
                      background: "#123326",
                      color: "#f4f7f2",
                      display: "grid",
                      placeItems: "center",
                      fontWeight: 700,
                    }}
                  >
                    {index + 1}
                  </div>
                  <div style={{ color: "#365244", lineHeight: 1.6 }}>{item}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={cardStyle}>
            <div style={{ fontSize: 13, textTransform: "uppercase", color: "#496154", marginBottom: 10 }}>
              Verification
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              {[
                "corepack pnpm smoke:manifest",
                "corepack pnpm smoke:topology",
                "corepack pnpm install",
                "corepack pnpm typecheck",
                "corepack pnpm build",
                "corepack pnpm verify",
              ].map((item) => (
                <div
                  key={item}
                  style={{
                    fontFamily: '"Cascadia Code", "SFMono-Regular", Consolas, monospace',
                    borderRadius: 14,
                    background: "#10231b",
                    color: "#ecf4ef",
                    padding: "12px 14px",
                  }}
                >
                  {item}
                </div>
              ))}
            </div>
            <p style={{ margin: "14px 0 0", color: "#456154", lineHeight: 1.7 }}>
              The docs app exists to keep platform assumptions discoverable inside the workspace, not only in planning notes.
              It should evolve alongside the product shell and deployment model. The generated topology artifact lives at
              `opsui-meets.topology.json` and `opsui-meets.topology.md` for external deployment and ops handoff, and CI now checks and publishes them. Static copies are also emitted into the docs and preview public assets. The launch-gap snapshot now also lives in `opsui-meets.readiness.json` and `opsui-meets.readiness.md`.
            </p>
            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              {artifactBundle ? (
                artifactBundle.artifacts.map((artifact) => (
                  <div
                    key={artifact.fileName}
                    style={{
                      borderRadius: 14,
                      background: "#f6faf7",
                      border: "1px solid rgba(21,34,27,0.08)",
                      padding: "12px 14px",
                    }}
                  >
                    <a href={artifact.downloadPath} style={downloadLinkStyle}>
                      Download {getTopologyArtifactLabel(artifact.format)}
                    </a>
                    <div style={{ marginTop: 6, color: "#456154", fontSize: 13 }}>
                      {artifact.fileName} | {formatTopologyArtifactSize(artifact.sizeBytes)}
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <a href="/opsui-meets.topology.json" style={downloadLinkStyle}>
                    Download JSON
                  </a>
                  <a href="/opsui-meets.topology.md" style={downloadLinkStyle}>
                    Download Markdown
                  </a>
                  <a href="/opsui-meets.topology.csv" style={downloadLinkStyle}>
                    Download CSV
                  </a>
                  <a href="/opsui-meets.topology.bundle.json" style={downloadLinkStyle}>
                    Download Bundle
                  </a>
                  <a href="/opsui-meets.topology.sha256" style={downloadLinkStyle}>
                    Download SHA256
                  </a>
                </div>
              )}
            </div>
            <div style={{ marginTop: 16, display: "flex", gap: 12, flexWrap: "wrap" }}>
              <a href="/opsui-meets.readiness.json" style={downloadLinkStyle}>
                Download Readiness JSON
              </a>
              <a href="/opsui-meets.readiness.md" style={downloadLinkStyle}>
                Download Readiness Markdown
              </a>
            </div>
            {readinessReport ? (
              <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
                <div
                  style={{
                    borderRadius: 14,
                    background: "#f6faf7",
                    border: "1px solid rgba(21,34,27,0.08)",
                    padding: "12px 14px",
                    color: "#365244",
                  }}
                >
                  Overall status: <strong>{readinessReport.overallStatus}</strong>
                </div>
                <div
                  style={{
                    borderRadius: 14,
                    background: "#f6faf7",
                    border: "1px solid rgba(21,34,27,0.08)",
                    padding: "12px 14px",
                    color: "#365244",
                    lineHeight: 1.6,
                  }}
                >
                  Next step: {readinessReport.recommendedNextStep}
                </div>
                {readinessReport.blockers.slice(0, 2).map((item) => (
                  <div
                    key={item.id}
                    style={{
                      borderRadius: 14,
                      background: "#fff7ef",
                      border: "1px solid rgba(169,116,31,0.18)",
                      padding: "12px 14px",
                      color: "#5f4322",
                    }}
                  >
                    <strong>{item.title}</strong>
                    <div style={{ marginTop: 6, lineHeight: 1.6 }}>{item.summary}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </section>

        <section style={{ ...cardStyle, marginTop: 20 }}>
          <div style={{ fontSize: 13, textTransform: "uppercase", color: "#496154", marginBottom: 10 }}>
            Runtime Health
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 12,
            }}
          >
            {runtimeHealth.map((surface) => (
              <div
                key={surface.kind}
                style={{
                  borderRadius: 14,
                  background: surface.ok ? "#f6faf7" : "#fff7ef",
                  border: `1px solid ${surface.ok ? "rgba(21,34,27,0.08)" : "rgba(169,116,31,0.18)"}`,
                  padding: "12px 14px",
                }}
              >
                <div style={{ fontSize: 12, textTransform: "uppercase", color: "#5d786a" }}>{surface.kind}</div>
                <div style={{ marginTop: 6, fontWeight: 700 }}>{surface.hostname}</div>
                <div style={{ marginTop: 6, color: surface.ok ? "#365244" : "#8b4a18", fontSize: 13 }}>
                  {surface.ok ? "healthy" : `unavailable${surface.status ? ` [${surface.status}]` : ""}`}
                </div>
                {"dataMode" in (surface.payload ?? {}) ? (
                  <div style={{ marginTop: 6, fontSize: 12, color: "#5d786a" }}>
                    data mode {String(surface.payload?.dataMode)} / db configured {String(surface.payload?.databaseConfigured)} / persistence {String(surface.payload?.persistenceReady)}
                  </div>
                ) : null}
                {"oidcConfigured" in (surface.payload ?? {}) ? (
                  <div style={{ marginTop: 6, fontSize: 12, color: "#5d786a" }}>
                    oidc {String(surface.payload?.oidcConfigured)} / workspace map {String(surface.payload?.workspaceMappingConfigured)} / role map {String(surface.payload?.roleMappingConfigured)} / allowlist {String(surface.payload?.workspaceAllowlistConfigured)}
                  </div>
                ) : null}
                {"membershipDirectoryConfigured" in (surface.payload ?? {}) ? (
                  <div style={{ marginTop: 6, fontSize: 12, color: "#5d786a" }}>
                    membership dir {String(surface.payload?.membershipDirectoryConfigured)} / enforced {String(surface.payload?.membershipEnforced)}
                  </div>
                ) : null}
                {"controlPlaneAuthConfigured" in (surface.payload ?? {}) ? (
                  <div style={{ marginTop: 6, fontSize: 12, color: "#5d786a" }}>
                    control auth {String(surface.payload?.controlPlaneAuthConfigured)} / ready {String(surface.payload?.controlPlaneReady)}
                  </div>
                ) : null}
                {"signalingReady" in (surface.payload ?? {}) ? (
                  <div style={{ marginTop: 6, fontSize: 12, color: "#5d786a" }}>
                    signaling {String(surface.payload?.signalingReady)} / control sync {String(surface.payload?.controlSyncReady)}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
