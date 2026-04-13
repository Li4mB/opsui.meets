import { useEffect, useState } from "react";
import type { AuthCapabilities, OrganisationProfile, SessionInfo } from "@opsui/shared-types";
import { getOrganisationProfile } from "../lib/auth";

interface MyOrganisationPageProps {
  authCapabilities: AuthCapabilities | null;
  onNavigate(pathname: string): void;
  onRefreshSession(forceRefresh?: boolean): Promise<void>;
  session: SessionInfo | null;
}

export function MyOrganisationPage(props: MyOrganisationPageProps) {
  const [profile, setProfile] = useState<OrganisationProfile | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      if (!props.session?.authenticated) {
        setProfile(null);
        setMessage("Sign in to view your organisation.");
        return;
      }

      const nextProfile = await getOrganisationProfile(true);
      if (cancelled) {
        return;
      }

      if (!nextProfile) {
        setProfile(null);
        setMessage("This account is not attached to an organisation profile yet.");
        return;
      }

      setProfile(nextProfile);
      setMessage(null);
    }

    void loadProfile();
    return () => {
      cancelled = true;
    };
  }, [props.session?.authenticated, props.session?.actor.workspaceId]);

  if (!props.session?.authenticated) {
    return (
      <section className="page page--centered page--auth">
        <div className="settings-card auth-card">
          <div className="eyebrow">My Organisation</div>
          <h1 className="settings-card__title">Sign in first</h1>
          <p className="settings-card__copy">
            Your organisation profile lives behind your signed-in account.
          </p>
          <div className="stack-actions">
            <button
              className="button button--primary"
              onClick={() => {
                props.onNavigate("/sign-in");
              }}
              type="button"
            >
              Sign In
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="page page--centered page--auth">
      <div className="settings-card auth-card auth-card--wide">
        <div className="eyebrow">My Organisation</div>
        <h1 className="settings-card__title">{profile?.workspaceName ?? props.session.actor.workspaceName}</h1>
        <p className="settings-card__copy">
          Organisation members share the same profile, organisation code, and account roster.
        </p>

        {profile ? (
          <>
            <div className="status-pills auth-pills">
              <span className="status-pill">Code {profile.organizationCode}</span>
              {profile.opsuiLinked ? <span className="status-pill status-pill--accent">OpsUI Linked</span> : null}
              {profile.planTier === "super" ? <span className="status-pill status-pill--accent">Super</span> : null}
            </div>
            <div className="detail-grid">
              <Detail label="Organisation Code" value={profile.organizationCode} />
              <Detail label="Plan" value={profile.planTier} />
              <Detail label="Members" value={String(profile.members.length)} />
              <Detail label="OpsUI Link" value={profile.opsuiLinked ? "Connected" : "Not linked"} />
            </div>
            <div className="auth-roster">
              <div className="panel-card__header">
                <h2 className="panel-card__title">Members</h2>
                <button
                  className="button button--ghost"
                  onClick={() => {
                    void props.onRefreshSession(true).then(async () => {
                      const refreshed = await getOrganisationProfile(true);
                      setProfile(refreshed);
                    });
                  }}
                  type="button"
                >
                  Refresh
                </button>
              </div>
              <div className="auth-roster__list">
                {profile.members.map((member) => (
                  <div className="auth-roster__row" key={member.userId}>
                    <div>
                      <strong>{member.displayName}</strong>
                      <p>@{member.username}</p>
                      <p>{member.email}</p>
                    </div>
                    <div className="status-pills">
                      <span className="status-pill">{member.workspaceRole}</span>
                      <span className="status-pill">{member.membershipSource}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
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
