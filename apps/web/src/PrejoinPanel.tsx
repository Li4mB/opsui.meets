import { useEffect, useState } from "react";
import type { AuthCapabilities } from "@opsui/shared-types";
import { joinMeeting } from "./lib/commands";
import { getAuthCapabilities, getSessionState, issueMockSession, requestJoinToken, startLogin } from "./lib/auth";

interface PrejoinPanelProps {
  roomId: string;
  meetingInstanceId: string;
}

export function PrejoinPanel(props: PrejoinPanelProps) {
  const [state, setState] = useState<{
    authenticated: boolean;
    sessionType: string;
    provider: string;
    joinToken: string;
    joinState: string;
    joinMessage: string;
    displayName: string;
    authEmail: string;
  }>({
    authenticated: false,
    sessionType: "guest",
    provider: "anonymous",
    joinToken: "loading",
    joinState: "ready",
    joinMessage: "Ready to join.",
    displayName: "Guest User",
    authEmail: "",
  });
  const [capabilities, setCapabilities] = useState<AuthCapabilities | null>(null);

  useEffect(() => {
    let mounted = true;

    void Promise.all([
      getAuthCapabilities(),
      getSessionState(),
      requestJoinToken(props.roomId, props.meetingInstanceId),
    ]).then(([nextCapabilities, session, joinToken]) => {
      if (mounted) {
        setCapabilities(nextCapabilities);
        setState({
          authenticated: session.authenticated,
          sessionType: session.sessionType,
          provider: session.provider ?? "anonymous",
          joinToken: joinToken.token.slice(0, 18),
          joinState: "ready",
          joinMessage: "Invite verified. Device preview can proceed.",
          displayName: "Guest User",
          authEmail: session.actor.email ?? "",
        });
      }
    });

    return () => {
      mounted = false;
    };
  }, [props.meetingInstanceId, props.roomId]);

  async function handleJoin() {
    const result = await joinMeeting(
      props.meetingInstanceId,
      props.roomId,
      state.displayName,
      state.sessionType,
    );
    if (result) {
      setState((current) => ({
        ...current,
        joinState: result.joinState,
        joinMessage: toJoinMessage(result.joinState, result.reason),
      }));
    }
  }

  async function handleAuthenticate() {
    const ok = await issueMockSession({
      email: state.authEmail,
    });
    if (!ok) {
      setState((current) => ({
        ...current,
        joinMessage: "Mock session request failed.",
      }));
      return;
    }

    const session = await getSessionState();
    setState((current) => ({
      ...current,
      authenticated: session.authenticated,
      sessionType: session.sessionType,
      provider: session.provider ?? "anonymous",
      joinMessage: session.authenticated
        ? "Authenticated session issued for join testing."
        : "Session refresh did not confirm authentication.",
    }));
  }

  return (
    <section
      style={{
        background: "#fff",
        borderRadius: 18,
        border: "1px solid rgba(17,32,24,0.08)",
        padding: 20,
        boxShadow: "0 12px 24px rgba(17,32,24,0.08)",
      }}
    >
      <div style={{ fontSize: 13, textTransform: "uppercase", color: "#4d6f61", marginBottom: 8 }}>
        Prejoin
      </div>
      <h2 style={{ margin: "0 0 10px", fontSize: 24 }}>Invite to room in one clean flow</h2>
      <div style={{ display: "grid", gap: 10 }}>
        <Line label="Identity" value={state.sessionType} />
        <Line label="Provider" value={state.provider} />
        <Line label="Authenticated" value={state.authenticated ? "yes" : "no"} />
        <Line label="Join token" value={state.joinToken} />
        <Line label="Steps" value="Link -> name -> device preview -> join" />
        <label style={{ display: "grid", gap: 8 }}>
          <span style={{ color: "#567567" }}>Display name</span>
          <input
            value={state.displayName}
            onChange={(event) => {
              const value = event.target.value;
              setState((current) => ({
                ...current,
        displayName: value,
      }));
    }}
            style={{
              borderRadius: 12,
              border: "1px solid rgba(17,32,24,0.12)",
              padding: "12px 14px",
              background: "#f6faf7",
              color: "#112018",
            }}
          />
        </label>
        <label style={{ display: "grid", gap: 8 }}>
          <span style={{ color: "#567567" }}>Auth email for membership-bound mock auth</span>
          <input
            value={state.authEmail}
            onChange={(event) => {
              const value = event.target.value;
              setState((current) => ({
                ...current,
                authEmail: value,
              }));
            }}
            placeholder="member@example.com"
            style={{
              borderRadius: 12,
              border: "1px solid rgba(17,32,24,0.12)",
              padding: "12px 14px",
              background: "#f6faf7",
              color: "#112018",
            }}
          />
        </label>
        <Line label="Join mode" value={state.joinState} />
        <Line label="Outcome" value={state.joinMessage} />
        <Line
          label="Auth directory"
          value={
            capabilities?.membershipDirectoryConfigured
              ? capabilities.membershipEnforced
                ? "configured and enforced"
                : "configured"
              : capabilities?.membershipEnforced
                ? "required but not configured"
                : "not configured"
          }
        />
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => {
            void handleJoin();
          }}
          style={primaryButtonStyle}
        >
          Simulate join request
        </button>
        <button
          type="button"
          onClick={() => {
            void handleAuthenticate();
          }}
          disabled={
            state.authenticated ||
            !capabilities?.mockAuthEnabled ||
            (Boolean(capabilities?.membershipDirectoryConfigured) && !state.authEmail.trim()) ||
            (Boolean(capabilities?.membershipEnforced) && !capabilities?.membershipDirectoryConfigured)
          }
          style={{
            ...secondaryButtonStyle,
            opacity:
              state.authenticated ||
              !capabilities?.mockAuthEnabled ||
              (Boolean(capabilities?.membershipDirectoryConfigured) && !state.authEmail.trim()) ||
              (Boolean(capabilities?.membershipEnforced) && !capabilities?.membershipDirectoryConfigured)
                ? 0.6
                : 1,
            cursor:
              state.authenticated ||
              !capabilities?.mockAuthEnabled ||
              (Boolean(capabilities?.membershipDirectoryConfigured) && !state.authEmail.trim()) ||
              (Boolean(capabilities?.membershipEnforced) && !capabilities?.membershipDirectoryConfigured)
                ? "not-allowed"
                : "pointer",
          }}
        >
          {!capabilities?.mockAuthEnabled
            ? "Mock auth unavailable"
            : capabilities?.membershipEnforced && !capabilities?.membershipDirectoryConfigured
              ? "Auth directory required"
              : capabilities?.membershipDirectoryConfigured && !state.authEmail.trim()
                ? "Enter member email"
            : state.authenticated
              ? "Authenticated"
              : "Simulate authenticated user"}
        </button>
        <button
          type="button"
          onClick={() => {
            startLogin(window.location.pathname + window.location.search);
          }}
          disabled={!capabilities?.oidcConfigured || (Boolean(capabilities?.membershipEnforced) && !capabilities?.membershipDirectoryConfigured)}
          style={{
            ...secondaryButtonStyle,
            opacity:
              capabilities?.oidcConfigured && !(capabilities?.membershipEnforced && !capabilities?.membershipDirectoryConfigured)
                ? 1
                : 0.6,
            cursor:
              capabilities?.oidcConfigured && !(capabilities?.membershipEnforced && !capabilities?.membershipDirectoryConfigured)
                ? "pointer"
                : "not-allowed",
          }}
        >
          {capabilities?.oidcConfigured
            ? capabilities?.membershipEnforced && !capabilities?.membershipDirectoryConfigured
              ? "OIDC needs auth directory"
              : "Start OIDC login"
            : "OIDC unavailable"}
        </button>
      </div>
    </section>
  );
}

function toJoinMessage(joinState: string, reason?: string): string {
  if (joinState === "blocked" && reason === "room_locked") {
    return "Room is locked. Host must reopen access.";
  }

  if (joinState === "blocked" && reason === "guest_join_disabled") {
    return "Guest access is disabled for this room.";
  }

  if (joinState === "lobby") {
    return "Join request sent to lobby for host review.";
  }

  if (joinState === "direct") {
    return "Direct entry approved.";
  }

  return "Join status updated.";
}

function Line(props: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 16,
        padding: "12px 14px",
        borderRadius: 12,
        background: "#f6faf7",
        border: "1px solid rgba(17,32,24,0.08)",
      }}
    >
      <span style={{ color: "#567567" }}>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

const primaryButtonStyle = {
  border: 0,
  borderRadius: 999,
  background: "#123326",
  color: "#f4f7f2",
  padding: "12px 16px",
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryButtonStyle = {
  border: "1px solid rgba(17,32,24,0.12)",
  borderRadius: 999,
  background: "#f6faf7",
  color: "#112018",
  padding: "12px 16px",
  fontWeight: 700,
};
