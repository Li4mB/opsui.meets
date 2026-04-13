import { useState } from "react";
import type { AuthCapabilities, SessionInfo } from "@opsui/shared-types";
import {
  signUpIndividual,
  signUpOrganisation,
  signUpWithBusiness,
} from "../lib/auth";

type SignUpMode = "individual" | "business" | "organisation";

interface SignUpPageProps {
  authCapabilities: AuthCapabilities | null;
  isAuthLoading: boolean;
  onNavigate(pathname: string): void;
  onRefreshSession(forceRefresh?: boolean): Promise<void>;
  session: SessionInfo | null;
}

export function SignUpPage(props: SignUpPageProps) {
  const [mode, setMode] = useState<SignUpMode>("individual");
  const [step, setStep] = useState<1 | 2>(1);
  const [message, setMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const [individual, setIndividual] = useState({
    email: "",
    username: "",
    firstName: "",
    lastName: "",
    password: "",
  });
  const [business, setBusiness] = useState({
    organizationCode: "",
    email: "",
    username: "",
    firstName: "",
    lastName: "",
    password: "",
  });
  const [organisation, setOrganisation] = useState({
    organizationName: "",
    linkToOpsui: false,
    email: "",
    username: "",
    firstName: "",
    lastName: "",
    password: "",
  });

  if (props.session?.authenticated) {
    return (
      <section className="page page--centered page--auth">
        <div className="settings-card auth-card">
          <div className="eyebrow">Account</div>
          <h1 className="settings-card__title">You already have an account here</h1>
          <p className="settings-card__copy">
            You are already signed in. We can head home, or open your organisation if you belong to one.
          </p>
          <div className="stack-actions">
            {props.session.actor.workspaceKind === "organisation" ? (
              <button
                className="button button--primary"
                onClick={() => {
                  props.onNavigate("/my-organisation");
                }}
                type="button"
              >
                My Organisation
              </button>
            ) : null}
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
        </div>
      </section>
    );
  }

  const signUpEnabled = Boolean(props.authCapabilities?.signupEnabled);
  const opsuiValidationConfigured = Boolean(props.authCapabilities?.opsuiValidationConfigured);

  async function handleSubmit() {
    setIsBusy(true);
    setMessage(null);

    const result =
      mode === "individual"
        ? await signUpIndividual(individual)
        : mode === "business"
          ? await signUpWithBusiness(business)
          : await signUpOrganisation({
              organizationName: organisation.organizationName,
              linkToOpsui: organisation.linkToOpsui,
              email: organisation.email,
              username: organisation.username,
              firstName: organisation.firstName,
              lastName: organisation.lastName,
              password: organisation.password,
            });

    if (!result.ok) {
      setIsBusy(false);
      setMessage(result.message ?? "We could not complete sign-up.");
      return;
    }

    await props.onRefreshSession(true);
    setIsBusy(false);
    setMessage("Your account is ready.");
    props.onNavigate(mode === "individual" ? "/" : "/my-organisation");
  }

  return (
    <section className="page page--centered page--auth">
      <div className="settings-card auth-card auth-card--wide">
        <div className="eyebrow">Sign Up</div>
        <h1 className="settings-card__title">Create your OpsUI Meets account</h1>
        <p className="settings-card__copy">
          Choose the path that matches how you want to use OpsUI Meets. Every path lands in the same meeting product.
        </p>

        <div className="auth-choice-grid" role="tablist" aria-label="Sign up options">
          <ChoiceCard
            active={mode === "individual"}
            description="Create your own personal account."
            label="Sign up as an individual"
            onSelect={() => {
              setMode("individual");
              setStep(1);
              setMessage(null);
            }}
          />
          <ChoiceCard
            active={mode === "business"}
            description="Join an existing organisation with its code."
            label="Sign up with your business"
            onSelect={() => {
              setMode("business");
              setStep(1);
              setMessage(null);
            }}
          />
          <ChoiceCard
            active={mode === "organisation"}
            description="Create an organisation profile and owner account."
            label="Create organisation"
            onSelect={() => {
              setMode("organisation");
              setStep(1);
              setMessage(null);
            }}
          />
        </div>

        {!signUpEnabled ? (
          <p className="inline-feedback inline-feedback--warning">
            Password sign-up is not enabled in this environment yet.
          </p>
        ) : null}

        {mode === "individual" ? (
          <form
            className="auth-form"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSubmit();
            }}
          >
            <IdentityFields
              email={individual.email}
              username={individual.username}
              firstName={individual.firstName}
              lastName={individual.lastName}
              password={individual.password}
              onChange={(field, value) => {
                setIndividual((current) => ({ ...current, [field]: value }));
              }}
            />
            <div className="stack-actions stack-actions--inline">
              <button className="button button--primary" disabled={!signUpEnabled || isBusy} type="submit">
                {isBusy ? "Creating Account..." : "Create Account"}
              </button>
              <button
                className="button button--subtle"
                onClick={() => {
                  props.onNavigate("/sign-in");
                }}
                type="button"
              >
                Already have an account?
              </button>
            </div>
          </form>
        ) : null}

        {mode === "business" ? (
          <form
            className="auth-form"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSubmit();
            }}
          >
            <label className="field">
              <span className="field__label">Organisation code</span>
              <input
                className="field__input field__input--code"
                name="organizationCode"
                onChange={(event) => {
                  setBusiness((current) => ({ ...current, organizationCode: event.target.value.toUpperCase() }));
                }}
                placeholder="AB12CD34"
                value={business.organizationCode}
              />
            </label>
            <IdentityFields
              email={business.email}
              username={business.username}
              firstName={business.firstName}
              lastName={business.lastName}
              password={business.password}
              onChange={(field, value) => {
                setBusiness((current) => ({ ...current, [field]: value }));
              }}
            />
            <div className="stack-actions stack-actions--inline">
              <button className="button button--primary" disabled={!signUpEnabled || isBusy} type="submit">
                {isBusy ? "Joining..." : "Join Organisation"}
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
        ) : null}

        {mode === "organisation" ? (
          <>
            {step === 1 ? (
              <form
                className="auth-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  setStep(2);
                }}
              >
                <label className="field">
                  <span className="field__label">Organisation name</span>
                  <input
                    autoComplete="organization"
                    className="field__input"
                    name="organization"
                    onChange={(event) => {
                      setOrganisation((current) => ({ ...current, organizationName: event.target.value }));
                    }}
                    placeholder="OpsUI North Team"
                    value={organisation.organizationName}
                  />
                </label>
                <label className="field field--checkbox">
                  <input
                    checked={organisation.linkToOpsui}
                    onChange={(event) => {
                      setOrganisation((current) => ({ ...current, linkToOpsui: event.target.checked }));
                    }}
                    type="checkbox"
                  />
                  <span>
                    Link this organisation to OpsUI
                    <small>
                      {opsuiValidationConfigured
                        ? "Members with valid OpsUI business credentials will receive Meets Super."
                        : "OpsUI validation is not configured in this environment yet."}
                    </small>
                  </span>
                </label>
                <div className="stack-actions stack-actions--inline">
                  <button className="button button--primary" disabled={!signUpEnabled || isBusy} type="submit">
                    Continue
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
            ) : (
              <form
                className="auth-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSubmit();
                }}
              >
                <div className="detail-card">
                  <span className="detail-card__label">Organisation</span>
                  <strong className="detail-card__value">{organisation.organizationName || "Untitled organisation"}</strong>
                  {organisation.linkToOpsui ? (
                    <span className="status-pill status-pill--accent auth-inline-pill">OpsUI Linked</span>
                  ) : null}
                </div>
                <IdentityFields
                  email={organisation.email}
                  username={organisation.username}
                  firstName={organisation.firstName}
                  lastName={organisation.lastName}
                  password={organisation.password}
                  onChange={(field, value) => {
                    setOrganisation((current) => ({ ...current, [field]: value }));
                  }}
                />
                <div className="stack-actions stack-actions--inline">
                  <button className="button button--ghost" disabled={isBusy} onClick={() => setStep(1)} type="button">
                    Back
                  </button>
                  <button className="button button--primary" disabled={!signUpEnabled || isBusy} type="submit">
                    {isBusy ? "Creating Organisation..." : "Create Organisation"}
                  </button>
                </div>
              </form>
            )}
          </>
        ) : null}

        {message ? <p className="inline-feedback">{message}</p> : null}
      </div>
    </section>
  );
}

function ChoiceCard(props: { active: boolean; description: string; label: string; onSelect(): void }) {
  return (
    <button
      aria-pressed={props.active}
      className={`auth-choice-card${props.active ? " is-active" : ""}`}
      onClick={props.onSelect}
      type="button"
    >
      <strong>{props.label}</strong>
      <span>{props.description}</span>
    </button>
  );
}

function IdentityFields(props: {
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  password: string;
  onChange(field: "email" | "username" | "firstName" | "lastName" | "password", value: string): void;
}) {
  return (
    <>
      <label className="field">
        <span className="field__label">Email</span>
        <input
          autoComplete="email"
          className="field__input"
          name="email"
          onChange={(event) => props.onChange("email", event.target.value)}
          placeholder="you@company.com"
          type="email"
          value={props.email}
        />
      </label>
      <label className="field">
        <span className="field__label">Username</span>
        <input
          autoComplete="username"
          className="field__input"
          name="username"
          onChange={(event) => props.onChange("username", event.target.value)}
          placeholder="your.name"
          value={props.username}
        />
      </label>
      <div className="auth-form__row">
        <label className="field">
          <span className="field__label">First name</span>
          <input
            autoComplete="given-name"
            className="field__input"
            name="firstName"
            onChange={(event) => props.onChange("firstName", event.target.value)}
            placeholder="First name"
            value={props.firstName}
          />
        </label>
        <label className="field">
          <span className="field__label">Last name</span>
          <input
            autoComplete="family-name"
            className="field__input"
            name="lastName"
            onChange={(event) => props.onChange("lastName", event.target.value)}
            placeholder="Last name"
            value={props.lastName}
          />
        </label>
      </div>
      <label className="field">
        <span className="field__label">Password</span>
        <input
          autoComplete="new-password"
          className="field__input"
          name="password"
          onChange={(event) => props.onChange("password", event.target.value)}
          placeholder="Create a secure password"
          type="password"
          value={props.password}
        />
      </label>
    </>
  );
}
