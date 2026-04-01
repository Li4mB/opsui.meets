import { useEffect, useState } from "react";
import type { AuthCapabilities, SessionInfo } from "@opsui/shared-types";
import {
  getSessionDisplayName,
  issueMockSession,
  logout,
  shouldUseRedirectLogout,
  startLogin,
  startLogout,
} from "../lib/auth";

interface SignInPageProps {
  authCapabilities: AuthCapabilities | null;
  isAuthLoading: boolean;
  onNavigate(pathname: string): void;
  onRefreshSession(forceRefresh?: boolean): Promise<void>;
  session: SessionInfo | null;
}

export function SignInPage(props: SignInPageProps) {
  const [mockEmail, setMockEmail] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (props.session?.actor.email) {
      setMockEmail(props.session.actor.email);
    }
  }, [props.session?.actor.email]);

  const signedIn = Boolean(props.session?.authenticated);
  const canUseOidc = Boolean(props.authCapabilities?.oidcConfigured);
  const canUseMockAuth = Boolean(props.authCapabilities?.mockAuthEnabled);
  const displayName = getSessionDisplayName(props.session);

  async function handleMockSignIn() {
    setIsBusy(true);
    setMessage(null);

    const ok = await issueMockSession({
      email: mockEmail.trim() || undefined,
    });

    if (!ok) {
      setIsBusy(false);
      setMessage("Development sign-in failed.");
      return;
    }

    await props.onRefreshSession(true);
    setIsBusy(false);
    setMessage("You are signed in for local testing.");
  }

  async function handleLogout() {
    setIsBusy(true);
    setMessage(null);

    const ok = await logout();
    if (!ok) {
      setIsBusy(false);
      setMessage("Sign out failed.");
      return;
    }

    await props.onRefreshSession(true);
    setIsBusy(false);
    setMessage("You are signed out.");
  }

  return (
    <section className="page page--centered">
      <div className="settings-card">
        <div className="eyebrow">Account</div>
        <h1 className="settings-card__title">
          {props.isAuthLoading ? "Checking session..." : signedIn ? displayName : "Sign in to join faster"}
        </h1>
        <p className="settings-card__copy">
          Signed-in users enter meetings immediately with their account identity. Guests can still join from a room URL and pick a display name on the spot.
        </p>

        <div className="detail-grid">
          <Detail label="Status" value={props.isAuthLoading ? "Loading" : signedIn ? "Signed in" : "Guest"} />
          <Detail label="Provider" value={props.session?.provider ?? "anonymous"} />
          <Detail label="Workspace" value={props.session?.actor.workspaceId ?? "workspace_local"} />
          <Detail label="User" value={props.session?.actor.email ?? props.session?.actor.userId ?? "guest"} />
        </div>

        <div className="stack-actions">
          <button
            className="button button--primary"
            disabled={!canUseOidc || isBusy || signedIn}
            onClick={() => {
              if (!signedIn) {
                startLogin(window.location.pathname);
              }
            }}
            type="button"
          >
            {signedIn ? "Signed In" : canUseOidc ? "Sign In" : "OIDC Unavailable"}
          </button>
          <button
            className="button button--ghost"
            disabled={!signedIn || isBusy}
            onClick={() => {
              if (shouldUseRedirectLogout()) {
                startLogout(window.location.pathname);
                return;
              }

              void handleLogout();
            }}
            type="button"
          >
            Sign Out
          </button>
          <button
            className="button button--subtle"
            onClick={() => {
              props.onNavigate("/");
            }}
            type="button"
          >
            Back Home
          </button>
        </div>

        {canUseMockAuth ? (
          <div className="dev-panel">
            <div className="eyebrow">Development</div>
            <label className="field">
              <span className="field__label">Mock auth email</span>
              <input
                className="field__input"
                onChange={(event) => {
                  setMockEmail(event.target.value);
                }}
                placeholder="member@example.com"
                value={mockEmail}
              />
            </label>
            <button
              className="button button--secondary"
              disabled={isBusy}
              onClick={() => {
                void handleMockSignIn();
              }}
              type="button"
            >
              Use Dev Sign-In
            </button>
          </div>
        ) : null}

        {message ? <p className="inline-feedback">{message}</p> : null}
      </div>
    </section>
  );
}

function Detail(props: { label: string; value: string }) {
  return (
    <div className="detail-card">
      <span className="detail-card__label">{props.label}</span>
      <strong className="detail-card__value">{props.value}</strong>
    </div>
  );
}
