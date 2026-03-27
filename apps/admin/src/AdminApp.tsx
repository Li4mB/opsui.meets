import { useEffect, useState } from "react";
import type {
  AuditLogEntry,
  AuthCapabilities,
  HookDeliveryAttempt,
  HookDeliverySummary,
  SessionInfo,
  TemplateSummary,
  WorkspacePolicy,
} from "@opsui/shared-types";
import { AuditList } from "./AuditList";
import { FollowUpHooksPanel } from "./FollowUpHooksPanel";
import { TemplateCreatePanel } from "./TemplateCreatePanel";
import { getAdminDashboardPayload } from "./lib/api";
import { getAuthCapabilities, getSessionState, logout, startLogin } from "./lib/auth";
import { retryFailedMeetingFollowUps, retryMeetingFollowUp } from "./lib/commands";
import { normalizeAdminMetrics } from "./lib/view-models";
import { ADMIN_NAV_ITEMS } from "./navigation";
import { PolicyPanel } from "./PolicyPanel";
import { TemplatesPanel } from "./TemplatesPanel";

type ActivityTone = "success" | "warning" | "error";

export function AdminApp() {
  const [metrics, setMetrics] = useState<Array<{ label: string; value: string }>>([]);
  const [auditItems, setAuditItems] = useState<AuditLogEntry[]>([]);
  const [hookDeliveries, setHookDeliveries] = useState<HookDeliveryAttempt[]>([]);
  const [hookDeliverySummary, setHookDeliverySummary] = useState<HookDeliverySummary>({
    currentFailureCount: 0,
    autoOnEndFailureCount: 0,
    historicalFailureCount: 0,
    attentionItems: [],
  });
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [workspacePolicy, setWorkspacePolicy] = useState<WorkspacePolicy | null>(null);
  const [activityMessage, setActivityMessage] = useState<{ text: string; tone: ActivityTone } | null>(null);
  const [isRetryingHook, setIsRetryingHook] = useState(false);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [authCapabilities, setAuthCapabilities] = useState<AuthCapabilities | null>(null);

  async function refreshAudit(message?: { text: string; tone: ActivityTone }) {
    try {
      const payload = await getAdminDashboardPayload();
      setMetrics(normalizeAdminMetrics(payload));
      setAuditItems(payload.audit);
      setHookDeliveries(payload.hookDeliveries);
      setHookDeliverySummary(payload.hookDeliverySummary);
      setTemplates(payload.templates);
      setWorkspacePolicy(payload.workspacePolicy);
      if (message) {
        setActivityMessage(message);
      }
    } catch {}
  }

  useEffect(() => {
    let mounted = true;

    void getAdminDashboardPayload().then((payload) => {
      if (mounted) {
        setMetrics(normalizeAdminMetrics(payload));
        setAuditItems(payload.audit);
        setHookDeliveries(payload.hookDeliveries);
        setHookDeliverySummary(payload.hookDeliverySummary);
        setTemplates(payload.templates);
        setWorkspacePolicy(payload.workspacePolicy);
      }
    });
    void getSessionState().then((nextSession) => {
      if (mounted) {
        setSession(nextSession);
      }
    });
    void getAuthCapabilities().then((nextCapabilities) => {
      if (mounted) {
        setAuthCapabilities(nextCapabilities);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        gridTemplateColumns: "280px 1fr",
        background: "#f0f3ef",
        color: "#132119",
        fontFamily: '"Segoe UI", sans-serif',
      }}
    >
      <aside
        style={{
          padding: 24,
          borderRight: "1px solid rgba(19,33,25,0.1)",
          background: "#10231b",
          color: "#edf5f0",
        }}
      >
        <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 1.6, opacity: 0.7 }}>
          OpsUI Meets
        </div>
        <h1 style={{ margin: "8px 0 20px", fontSize: 24 }}>Admin</h1>
        <div
          style={{
            marginBottom: 20,
            display: "grid",
            gap: 8,
          }}
        >
          <div
            style={{
              borderRadius: 12,
              background: "rgba(237,245,240,0.12)",
              padding: "10px 12px",
              fontSize: 13,
            }}
          >
            {session?.authenticated ? `Signed in ${session.actor.userId}` : "Guest session"}
          </div>
          <div
            style={{
              borderRadius: 12,
              background: "rgba(237,245,240,0.08)",
              padding: "10px 12px",
              fontSize: 12,
              color: "rgba(237,245,240,0.8)",
            }}
          >
            {session?.provider ?? "anonymous"} / {session?.actor.workspaceId ?? "workspace_local"}
          </div>
          <div
            style={{
              borderRadius: 12,
              background: "rgba(237,245,240,0.08)",
              padding: "10px 12px",
              fontSize: 12,
              color: "rgba(237,245,240,0.8)",
            }}
          >
            role {session?.actor.workspaceRole ?? "guest"} / source {session?.actor.membershipSource ?? "anonymous"}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => {
                startLogin(window.location.pathname + window.location.search);
              }}
              disabled={!authCapabilities?.oidcConfigured}
              style={{
                ...asideSecondaryButtonStyle,
                opacity: authCapabilities?.oidcConfigured ? 1 : 0.6,
                cursor: authCapabilities?.oidcConfigured ? "pointer" : "not-allowed",
              }}
            >
              {authCapabilities?.oidcConfigured ? "OIDC login" : "OIDC unavailable"}
            </button>
            <button
              type="button"
              onClick={() => {
                void logout().then(async (ok) => {
                  if (!ok) {
                    setActivityMessage({ text: "Logout failed.", tone: "error" });
                    return;
                  }
                  const nextSession = await getSessionState(true);
                  setSession(nextSession);
                  setActivityMessage({ text: "Session cleared.", tone: "success" });
                });
              }}
              style={asidePrimaryButtonStyle}
            >
              Logout
            </button>
          </div>
        </div>
        <nav style={{ display: "grid", gap: 10 }}>
          {ADMIN_NAV_ITEMS.map((item) => (
            <div
              key={item.path}
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                background: item.path === "/" ? "rgba(237,245,240,0.12)" : "transparent",
              }}
            >
              {item.label}
            </div>
          ))}
        </nav>
      </aside>

      <section style={{ padding: 28 }}>
        {activityMessage ? (
          <div
            style={{
              marginBottom: 20,
              borderRadius: 14,
              background:
                activityMessage.tone === "error"
                  ? "#fff1ee"
                  : activityMessage.tone === "warning"
                    ? "#fff4eb"
                    : "#dfeee7",
              border:
                activityMessage.tone === "error"
                  ? "1px solid rgba(166,63,41,0.16)"
                  : activityMessage.tone === "warning"
                    ? "1px solid rgba(139,74,24,0.16)"
                    : "1px solid rgba(19,33,25,0.08)",
              padding: "14px 16px",
              color:
                activityMessage.tone === "error"
                  ? "#8d3321"
                  : activityMessage.tone === "warning"
                    ? "#8b4a18"
                    : "#24463a",
              fontWeight: 600,
            }}
          >
            {activityMessage.text}
          </div>
        ) : null}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            gap: 16,
            marginBottom: 20,
          }}
        >
          {metrics.map((metric) => (
            <div
              key={metric.label}
              style={{
                borderRadius: 18,
                background: "#fff",
                border: "1px solid rgba(19,33,25,0.08)",
                padding: 18,
              }}
            >
              <div style={{ fontSize: 12, textTransform: "uppercase", color: "#5d786a" }}>{metric.label}</div>
              <div style={{ fontSize: 28, fontWeight: 700, marginTop: 8 }}>{metric.value}</div>
            </div>
          ))}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.1fr 0.9fr",
            gap: 20,
          }}
        >
          <div
            style={{
              borderRadius: 20,
              background: "#fff",
              border: "1px solid rgba(19,33,25,0.08)",
              padding: 24,
              boxShadow: "0 12px 30px rgba(19,33,25,0.06)",
            }}
          >
            <div style={{ fontSize: 13, textTransform: "uppercase", color: "#547163", marginBottom: 8 }}>
              Governance Baseline
            </div>
            <h2 style={{ marginTop: 0 }}>Workspace controls for rooms, policies, analytics, and audit</h2>
            <p style={{ maxWidth: 720, lineHeight: 1.6 }}>
              This first admin shell is intentionally operational: navigation is optimized for tenant
              controls, not for consumer-style browsing. The next implementation step is wiring each
              section to the shared policy, template, and audit models.
            </p>
          </div>

          <AuditList items={auditItems} />
        </div>

        <div style={{ marginTop: 20 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 20,
            }}
          >
            <TemplatesPanel templates={templates} />
            <PolicyPanel
              policy={workspacePolicy}
              onActivity={(message) => {
                void refreshAudit({ text: message, tone: "success" });
              }}
              onUpdated={(nextPolicy) => {
                setWorkspacePolicy(nextPolicy);
              }}
            />
          </div>
        </div>

        <div style={{ marginTop: 20 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 20,
            }}
          >
            <TemplateCreatePanel
              onActivity={(message) => {
                void refreshAudit({ text: `Template created: ${message}.`, tone: "success" });
              }}
              onCreated={(template) => {
                setTemplates((current) => [template, ...current]);
              }}
            />
            <FollowUpHooksPanel
              policy={workspacePolicy}
              attempts={hookDeliveries}
              summary={hookDeliverySummary}
              isRetrying={isRetryingHook}
              onRetryAllFailures={() => {
                setIsRetryingHook(true);
                setActivityMessage(null);

                void retryFailedMeetingFollowUps()
                  .then((result) => {
                    const tone: ActivityTone =
                      result.failureCount > 0 ? "warning" : "success";
                    const message =
                      result.retriedCount > 0
                        ? `Retried ${result.retriedCount} failing meetings. ${result.successCount} succeeded, ${result.failureCount} still failing.`
                        : "No failing meeting deliveries needed a retry.";
                    void refreshAudit({ text: message, tone });
                  })
                  .catch((error) => {
                    setActivityMessage({
                      text: error instanceof Error ? error.message : "Bulk follow-up retry failed.",
                      tone: "error",
                    });
                  })
                  .finally(() => {
                    setIsRetryingHook(false);
                  });
              }}
              onRetryAttempt={(meetingInstanceId) => {
                setIsRetryingHook(true);
                setActivityMessage(null);

                void retryMeetingFollowUp(meetingInstanceId)
                  .then((result) => {
                    void refreshAudit(
                      {
                        text: result.ok
                          ? `Follow-up retry sent to ${result.targetUrl}.`
                          : `Follow-up retry failed for ${result.targetUrl}.`,
                        tone: result.ok ? "success" : "warning",
                      },
                    );
                  })
                  .catch((error) => {
                    setActivityMessage({
                      text: error instanceof Error ? error.message : "Follow-up retry failed.",
                      tone: "error",
                    });
                  })
                  .finally(() => {
                    setIsRetryingHook(false);
                  });
              }}
            />
          </div>
        </div>
      </section>
    </main>
  );
}

const asidePrimaryButtonStyle = {
  border: 0,
  borderRadius: 999,
  background: "#edf5f0",
  color: "#10231b",
  padding: "10px 12px",
  fontWeight: 700,
  cursor: "pointer",
};

const asideSecondaryButtonStyle = {
  border: "1px solid rgba(237,245,240,0.16)",
  borderRadius: 999,
  background: "transparent",
  color: "#edf5f0",
  padding: "10px 12px",
  fontWeight: 700,
  cursor: "pointer",
};
