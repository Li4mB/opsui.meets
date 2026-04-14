import { useEffect, useState } from "react";
import type { AuthCapabilities, SessionInfo } from "@opsui/shared-types";
import {
  getSessionDisplayName,
  issueMockSession,
  loginWithPassword,
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mockEmail, setMockEmail] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (props.session?.actor.email) {
      setEmail(props.session.actor.email);
      setMockEmail(props.session.actor.email);
    }
  }, [props.session?.actor.email]);

  const signedIn = Boolean(props.session?.authenticated);
  const canUseOidc = Boolean(props.authCapabilities?.oidcConfigured);
  const canUseMockAuth = Boolean(props.authCapabilities?.mockAuthEnabled);
  const canUsePassword = Boolean(props.authCapabilities?.passwordAuthEnabled);
  const authStorageReady = props.authCapabilities?.authStorageReady !== false;
  const displayName = getSessionDisplayName(props.session);
  const isSuper = props.session?.actor.planTier === "super";

  async function handlePasswordSignIn() {
    setIsBusy(true);
    setMessage(null);

    const result = await loginWithPassword({
      email,
      password,
    });

    if (!result.ok) {
      setIsBusy(false);
      setMessage(result.message ?? "Sign in failed.");
      return;
    }

    await props.onRefreshSession(true);
    setPassword("");
    setIsBusy(false);
    setMessage("You are signed in.");
  }

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
    <section className="page page--centered page--auth">
      <div className="settings-card auth-card">
        <div className="eyebrow">Account</div>
        <h1 className="settings-card__title">
          {props.isAuthLoading ? "Checking session..." : signedIn ? displayName : "Sign in to OpsUI Meets"}
        </h1>
        <p className="settings-card__copy">
          Use your local OpsUI Meets account for email/password sign-in. OIDC stays available as an alternate path when it is configured.
        </p>

        {signedIn ? (
          <>
            <div className="status-pills auth-pills">
              <span className="status-pill">{props.session?.provider ?? "anonymous"}</span>
              <span className="status-pill">{props.session?.actor.workspaceName ?? "My Workspace"}</span>
              {props.session?.actor.username ? <span className="status-pill">@{props.session.actor.username}</span> : null}
              {isSuper ? <span className="status-pill status-pill--accent">Super</span> : null}
            </div>

            <div className="detail-grid">
              <Detail label="Status" value="Signed in" />
              <Detail
                label="Name"
                value={
                  [props.session?.actor.firstName, props.session?.actor.lastName].filter(Boolean).join(" ") ||
                  displayName
                }
              />
              <Detail label="Username" value={props.session?.actor.username ? `@${props.session.actor.username}` : "Not set"} />
              <Detail label="Workspace" value={props.session?.actor.workspaceName ?? "My Workspace"} />
              <Detail label="Workspace Type" value={props.session?.actor.workspaceKind ?? "personal"} />
              <Detail label="Email" value={props.session?.actor.email ?? props.session?.actor.userId ?? "guest"} />
              <Detail label="Role" value={props.session?.actor.workspaceRole ?? "participant"} />
              <Detail label="Plan" value={props.session?.actor.planTier ?? "standard"} />
            </div>

            <div className="stack-actions">
              <button className="button button--primary" disabled type="button">
                Signed In
              </button>
              {props.session?.actor.workspaceKind === "organisation" ? (
                <button
                  className="button button--secondary"
                  onClick={() => {
                    props.onNavigate("/my-organisation");
                  }}
                  type="button"
                >
                  My Organisation
                </button>
              ) : null}
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
          </>
        ) : (
          <>
            <form
              className="auth-form"
              onSubmit={(event) => {
                event.preventDefault();
                void handlePasswordSignIn();
              }}
            >
              <label className="field">
                <span className="field__label">Email</span>
                <input
                  autoComplete="email"
                  className="field__input"
                  name="email"
                  onChange={(event) => {
                    setEmail(event.target.value);
                  }}
                  placeholder="you@company.com"
                  type="email"
                  value={email}
                />
              </label>
              <label className="field">
                <span className="field__label">Password</span>
                <input
                  autoComplete="current-password"
                  className="field__input"
                  name="password"
                  onChange={(event) => {
                    setPassword(event.target.value);
                  }}
                  placeholder="Enter your password"
                  type="password"
                  value={password}
                />
              </label>
              <div className="stack-actions stack-actions--inline">
                <button
                  className="button button--primary"
                  disabled={!canUsePassword || isBusy}
                  type="submit"
                >
                  {isBusy ? "Signing In..." : canUsePassword ? "Sign In" : "Password Sign-In Unavailable"}
                </button>
                <button
                  className="button button--subtle"
                  onClick={() => {
                    props.onNavigate("/sign-up");
                  }}
                  type="button"
                >
                  Create Account
                </button>
              </div>
            </form>

            {canUseOidc ? (
              <div className="auth-alt-panel">
                <div className="eyebrow">Alternate Sign-In</div>
                <p className="settings-card__copy">
                  Your organisation can still use the existing identity provider flow.
                </p>
                <button
                  className="button button--ghost"
                  disabled={isBusy}
                  onClick={() => {
                    startLogin(window.location.pathname);
                  }}
                  type="button"
                >
                  Continue with Identity Provider
                </button>
              </div>
            ) : null}

            {!canUsePassword && !authStorageReady ? (
              <p className="inline-feedback inline-feedback--warning">
                Account sign-in is temporarily unavailable while auth storage is being configured.
              </p>
            ) : null}
          </>
        )}

        {canUseMockAuth ? (
          <div className="dev-panel">
            <div className="eyebrow">Development</div>
            <label className="field">
              <span className="field__label">Mock auth email</span>
              <input
                autoComplete="email"
                className="field__input"
                name="mock-email"
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
