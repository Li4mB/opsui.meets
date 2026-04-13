import { useState } from "react";
import type { AuthCapabilities, SessionInfo } from "@opsui/shared-types";
import { completeOidcAccount } from "../lib/auth";

interface CompleteAccountPageProps {
  authCapabilities: AuthCapabilities | null;
  onNavigate(pathname: string): void;
  onRefreshSession(forceRefresh?: boolean): Promise<void>;
  session: SessionInfo | null;
}

export function CompleteAccountPage(props: CompleteAccountPageProps) {
  const [username, setUsername] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  if (props.session?.authenticated) {
    return (
      <section className="page page--centered page--auth">
        <div className="settings-card auth-card">
          <div className="eyebrow">Account</div>
          <h1 className="settings-card__title">Your account is ready</h1>
          <p className="settings-card__copy">
            You have already finished setting up your OpsUI Meets account.
          </p>
          <div className="stack-actions">
            <button
              className="button button--primary"
              onClick={() => {
                props.onNavigate("/");
              }}
              type="button"
            >
              Back Home
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="page page--centered page--auth">
      <div className="settings-card auth-card">
        <div className="eyebrow">Complete Account</div>
        <h1 className="settings-card__title">Choose your username</h1>
        <p className="settings-card__copy">
          Finish your account setup with a unique username. This will be shown across OpsUI Meets outside of meeting rooms.
        </p>
        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <label className="field">
            <span className="field__label">Username</span>
            <input
              autoComplete="username"
              className="field__input"
              name="username"
              onChange={(event) => {
                setUsername(event.target.value);
              }}
              placeholder="your.name"
              value={username}
            />
          </label>
          <div className="stack-actions stack-actions--inline">
            <button className="button button--primary" disabled={isBusy} type="submit">
              {isBusy ? "Saving..." : "Finish Setup"}
            </button>
            <button
              className="button button--subtle"
              onClick={() => {
                props.onNavigate("/sign-in");
              }}
              type="button"
            >
              Back to Sign In
            </button>
          </div>
        </form>
        {message ? <p className="inline-feedback">{message}</p> : null}
      </div>
    </section>
  );

  async function handleSubmit() {
    setIsBusy(true);
    setMessage(null);
    const result = await completeOidcAccount({ username });
    if (!result.ok) {
      setIsBusy(false);
      setMessage(result.message ?? "We could not complete your account.");
      return;
    }

    await props.onRefreshSession(true);
    setIsBusy(false);
    props.onNavigate(result.redirectTo ?? "/");
  }
}
