import { useEffect, useState, type CSSProperties } from "react";
import {
  OPSUI_MEETS_SURFACES,
  formatTopologyArtifactSize,
  getTopologyArtifactLabel,
  loadReadinessReport,
  loadRuntimeHealth,
  loadTopologyArtifactBundle,
} from "@opsui/config";
import type { ReadinessReport, RuntimeSurfaceHealth, TopologyArtifactBundle } from "@opsui/config";

const shellStyle: CSSProperties = {
  minHeight: "100vh",
  background: "linear-gradient(160deg, #0f1f19 0%, #17372c 45%, #edf1ea 45%, #edf1ea 100%)",
  color: "#132119",
  fontFamily: '"Segoe UI", sans-serif',
};

const panelStyle: CSSProperties = {
  background: "rgba(255,255,255,0.88)",
  border: "1px solid rgba(19,33,25,0.08)",
  borderRadius: 20,
  padding: 22,
  boxShadow: "0 18px 40px rgba(19,33,25,0.08)",
};

const checkpoints = [
  "Workspace install verified through corepack pnpm",
  "Typecheck passes across frontend apps and workers",
  "Wrangler dry-run builds pass for edge services",
  "Durable Object migration is declared for realtime",
  "Cloudflare custom domains are configured at host level",
  "CI exports topology JSON and markdown artifacts for deployment handoff",
];

const stagedSurfaces = OPSUI_MEETS_SURFACES.map((surface) => ({
  name: surface.purpose,
  target: surface.hostname,
  status: surface.rolloutStatus,
  workspaceTarget: surface.workspaceTarget,
  platform: surface.cloudflareProduct,
  wranglerName: surface.wranglerName,
  dependencyCount: surface.serviceBindings?.length ?? 0,
  analyticsCount: surface.analyticsBindings?.length ?? 0,
  durableObjectCount: surface.durableObjectBindings?.length ?? 0,
}));

const nextRolloutItems = [
  "Bind Pages projects to web, admin, docs, and preview dist outputs",
  "Replace memory mode with the Postgres adapter for shared persistence",
  "Introduce authenticated preview data and tenant-safe environment variables",
  "Extend smoke checks into deployed-route validation against preview hostnames",
];

const downloadLinkStyle: CSSProperties = {
  color: "#17372c",
  fontWeight: 700,
};

export function PreviewApp() {
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
      <div style={{ maxWidth: 1240, margin: "0 auto", padding: "48px 24px 72px" }}>
        <header style={{ color: "#f1f6f2", marginBottom: 30 }}>
          <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 1.8, opacity: 0.74 }}>
            OpsUI Meets Preview
          </div>
          <h1 style={{ margin: "12px 0 14px", fontSize: 52, lineHeight: 1 }}>Staging posture and rollout readiness</h1>
          <p style={{ margin: 0, maxWidth: 760, fontSize: 18, lineHeight: 1.7, color: "rgba(241,246,242,0.86)" }}>
            This surface is for deployment confidence: what is already stable, which hostnames are represented in the
            workspace, and what still needs to happen before the preview environment becomes a fuller staging lane.
          </p>
        </header>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "1.2fr 0.8fr",
            gap: 20,
            marginBottom: 20,
          }}
        >
          <div style={panelStyle}>
            <div style={{ fontSize: 13, textTransform: "uppercase", color: "#4f6a5d", marginBottom: 10 }}>
              Verification Checkpoints
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              {checkpoints.map((item) => (
                <div
                  key={item}
                  style={{
                    borderRadius: 14,
                    background: "#f6faf7",
                    border: "1px solid rgba(19,33,25,0.08)",
                    padding: "12px 14px",
                    color: "#355144",
                  }}
                >
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div style={panelStyle}>
            <div style={{ fontSize: 13, textTransform: "uppercase", color: "#4f6a5d", marginBottom: 10 }}>
              Preview Role
            </div>
            <p style={{ margin: "0 0 14px", color: "#456154", lineHeight: 1.7 }}>
              `preview.opsuimeets.com` is the right place for integration previews, release candidate validation,
              and environment notes before changes hit the public app surfaces.
            </p>
            <div
              style={{
                borderRadius: 16,
                background: "#123326",
                color: "#f1f6f2",
                padding: "14px 16px",
                fontFamily: '"Cascadia Code", "SFMono-Regular", Consolas, monospace',
              }}
            >
              corepack pnpm verify
            </div>
            <div style={{ marginTop: 10, color: "#456154", fontSize: 13 }}>
              Exportable deployment manifests: `opsui-meets.topology.json` and `opsui-meets.topology.md`, checked for drift in repo verification and uploaded by CI.
            </div>
            <div style={{ marginTop: 8, color: "#456154", fontSize: 13 }}>
              Published copies are also emitted into the preview/docs static assets for direct download. Launch blockers and hardening gaps are exported separately as `opsui-meets.readiness.json` and `opsui-meets.readiness.md`.
            </div>
            {readinessReport ? (
              <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
                <div
                  style={{
                    borderRadius: 14,
                    background: "#f6faf7",
                    border: "1px solid rgba(19,33,25,0.08)",
                    padding: "12px 14px",
                    color: "#365244",
                  }}
                >
                  Status <strong>{readinessReport.overallStatus}</strong> | foundations {readinessReport.summary.readyFoundations} | blockers {readinessReport.summary.blockers}
                </div>
                <div
                  style={{
                    borderRadius: 14,
                    background: "#fff7ef",
                    border: "1px solid rgba(169,116,31,0.18)",
                    padding: "12px 14px",
                    color: "#5f4322",
                    lineHeight: 1.6,
                  }}
                >
                  {readinessReport.recommendedNextStep}
                </div>
              </div>
            ) : null}
            <div style={{ marginTop: 8, display: "grid", gap: 10 }}>
              {artifactBundle ? (
                artifactBundle.artifacts.map((artifact) => (
                  <div
                    key={artifact.fileName}
                    style={{
                      borderRadius: 14,
                      background: "#f6faf7",
                      border: "1px solid rgba(19,33,25,0.08)",
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
          {stagedSurfaces.map((surface) => (
            <div key={surface.target} style={panelStyle}>
              <div style={{ fontSize: 12, textTransform: "uppercase", color: "#5d786a" }}>{surface.status}</div>
              <h2 style={{ margin: "8px 0 8px", fontSize: 24 }}>{surface.target}</h2>
              <div style={{ color: "#365244", fontWeight: 700, marginBottom: 8 }}>{surface.name}</div>
              <div style={{ color: "#5d786a", fontSize: 13, textTransform: "uppercase" }}>
                {surface.platform} / {surface.workspaceTarget}
              </div>
              <div style={{ color: "#5d786a", fontSize: 12, marginTop: 6 }}>
                {surface.wranglerName} / dependencies {surface.dependencyCount}
              </div>
              <div style={{ color: "#5d786a", fontSize: 12, marginTop: 4 }}>
                analytics {surface.analyticsCount} / durable objects {surface.durableObjectCount}
              </div>
            </div>
          ))}
        </section>

        <section style={{ ...panelStyle, marginBottom: 20 }}>
          <div style={{ fontSize: 13, textTransform: "uppercase", color: "#4f6a5d", marginBottom: 10 }}>
            Runtime Pulse
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
                  background: surface.ok ? "#f6faf7" : "#fff4eb",
                  border: `1px solid ${surface.ok ? "rgba(19,33,25,0.08)" : "rgba(169,116,31,0.18)"}`,
                  padding: "12px 14px",
                }}
              >
                <div style={{ fontSize: 12, textTransform: "uppercase", color: "#5d786a" }}>{surface.kind}</div>
                <div style={{ fontWeight: 700, marginTop: 6 }}>{surface.hostname}</div>
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
                    oidc {String(surface.payload?.oidcConfigured)} / workspace map {String(surface.payload?.workspaceMappingConfigured)}
                  </div>
                ) : null}
                {"membershipDirectoryConfigured" in (surface.payload ?? {}) ? (
                  <div style={{ marginTop: 6, fontSize: 12, color: "#5d786a" }}>
                    membership dir {String(surface.payload?.membershipDirectoryConfigured)} / enforced {String(surface.payload?.membershipEnforced)}
                  </div>
                ) : null}
                {"roleMappingConfigured" in (surface.payload ?? {}) ? (
                  <div style={{ marginTop: 6, fontSize: 12, color: "#5d786a" }}>
                    role map {String(surface.payload?.roleMappingConfigured)} / allowlist {String(surface.payload?.workspaceAllowlistConfigured)}
                  </div>
                ) : null}
                {"controlBackendConfigured" in (surface.payload ?? {}) ? (
                  <div style={{ marginTop: 6, fontSize: 12, color: "#5d786a" }}>
                    control backend {String(surface.payload?.controlBackendConfigured)}
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

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 20,
          }}
        >
          <div style={panelStyle}>
            <div style={{ fontSize: 13, textTransform: "uppercase", color: "#4f6a5d", marginBottom: 10 }}>
              Next Rollout Work
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              {(readinessReport?.blockers.map((item) => item.title) ?? nextRolloutItems).slice(0, 4).map((item, index) => (
                <div
                  key={item}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "36px 1fr",
                    gap: 12,
                    alignItems: "start",
                    borderRadius: 14,
                    background: "#f6faf7",
                    border: "1px solid rgba(19,33,25,0.08)",
                    padding: "12px 14px",
                  }}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 999,
                      background: "#123326",
                      color: "#f1f6f2",
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

          <div style={panelStyle}>
            <div style={{ fontSize: 13, textTransform: "uppercase", color: "#4f6a5d", marginBottom: 10 }}>
              Environment Notes
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              {[
                "Preview should stay close to production topology, but it can use lower-risk bindings and test datasets.",
                "The current worker scaffold now targets Postgres mode, but still needs live DATABASE_URL and auth membership bindings at deployment time.",
                "Preview is the right lane for Pages domain binding, auth callback validation, and release smoke checks.",
                ...(readinessReport
                  ? [`Current hardening backlog: ${readinessReport.summary.prelaunchHardening} items still outside the main blockers.`]
                  : []),
              ].map((item) => (
                <div
                  key={item}
                  style={{
                    borderRadius: 14,
                    background: "#f6faf7",
                    border: "1px solid rgba(19,33,25,0.08)",
                    padding: "12px 14px",
                    color: "#365244",
                    lineHeight: 1.7,
                  }}
                >
                  {item}
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
