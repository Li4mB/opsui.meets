import { useEffect, useRef, useState } from "react";
import type {
  CSSProperties,
  FocusEvent,
  PointerEvent as ReactPointerEvent,
  PropsWithChildren,
} from "react";
import { DEFAULT_PROFILE_VISUALS, type ProfileVisualAsset, type SessionInfo } from "@opsui/shared-types";
import { getSessionDisplayName, logout, shouldUseRedirectLogout, startLogout } from "../lib/auth";
import { AnimatedBackground } from "./AnimatedBackground";
import { Modal } from "./Modal";

interface AppLayoutProps extends PropsWithChildren {
  currentMeetingCode: string | null;
  currentPath: string;
  directMessagesUnreadCount: number;
  isContentObscured?: boolean;
  isSidebarOpen: boolean;
  session: SessionInfo | null;
  onCloseSidebar(): void;
  onNavigate(pathname: string): void;
  onRefreshSession(forceRefresh?: boolean): Promise<void>;
  onToggleSidebar(): void;
}

interface NavigationItem {
  active: boolean;
  badge?: number;
  href: string;
  label: string;
}

export function AppLayout(props: AppLayoutProps) {
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const profileCloseTimeoutRef = useRef<number | null>(null);
  const lastProfilePointerTypeRef = useRef<string | null>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [signOutModalOpen, setSignOutModalOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const signedIn = Boolean(props.session?.authenticated);
  const isOrganisationMember = signedIn && props.session?.actor.workspaceKind === "organisation";
  const isSuper = props.session?.actor.planTier === "super";
  const displayName = getSessionDisplayName(props.session);
  const username = props.session?.actor.username?.trim();
  const profileLabel = username ? `@${username}` : displayName;
  const profileInitials = getProfileInitials(username ?? displayName);
  const avatarVisual = props.session?.actor.profileVisuals?.avatar ?? DEFAULT_PROFILE_VISUALS.avatar;

  const navigationItems: NavigationItem[] = [
    {
      active: props.currentPath === "/",
      href: "/",
      label: "Home",
    },
    {
      active: props.currentPath === "/styles",
      href: "/styles",
      label: "Styles",
    },
    {
      active: props.currentPath === "/recordings",
      href: "/recordings",
      label: "Recordings",
    },
    ...(!signedIn
      ? [
          {
            active: props.currentPath === "/sign-in",
            href: "/sign-in",
            label: "Sign In",
          },
          {
            active: props.currentPath === "/sign-up",
            href: "/sign-up",
            label: "Sign Up",
          },
        ]
      : []),
    ...(signedIn
      ? [
          {
            active: props.currentPath === "/direct-messages" || props.currentPath.startsWith("/direct-messages/"),
            badge: props.directMessagesUnreadCount,
            href: "/direct-messages",
            label: "Direct Messages",
          },
        ]
      : []),
    ...(isOrganisationMember
      ? [
          {
            active: props.currentPath === "/my-organisation",
            href: "/my-organisation",
            label: "My Organisation",
          },
        ]
      : []),
    ...(props.currentMeetingCode
      ? [
          {
            active: props.currentPath === `/${props.currentMeetingCode}`,
            href: `/${props.currentMeetingCode}`,
            label: "Current Meeting",
          },
        ]
      : []),
  ];

  useEffect(() => {
    if (!props.isSidebarOpen) {
      return;
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        props.onCloseSidebar();
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [props.isSidebarOpen, props.onCloseSidebar]);

  useEffect(() => {
    return () => {
      clearProfileCloseTimeout();
    };
  }, []);

  useEffect(() => {
    setProfileMenuOpen(false);
    setSignOutModalOpen(false);
    setSignOutError(null);
  }, [props.currentPath]);

  useEffect(() => {
    if (signedIn) {
      return;
    }

    setProfileMenuOpen(false);
    setSignOutModalOpen(false);
    setSignOutError(null);
  }, [signedIn]);

  useEffect(() => {
    if (!profileMenuOpen && !signOutModalOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      setProfileMenuOpen(false);
      setSignOutModalOpen(false);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [profileMenuOpen, signOutModalOpen]);

  useEffect(() => {
    if (!profileMenuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (profileMenuRef.current?.contains(event.target as Node)) {
        return;
      }

      setProfileMenuOpen(false);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [profileMenuOpen]);

  async function handleConfirmedSignOut() {
    setSignOutError(null);
    setIsSigningOut(true);

    if (shouldUseRedirectLogout()) {
      startLogout("/sign-in");
      return;
    }

    const ok = await logout();
    if (!ok) {
      setIsSigningOut(false);
      setSignOutError("Sign out failed.");
      return;
    }

    await props.onRefreshSession(true);
    setIsSigningOut(false);
    setSignOutModalOpen(false);
    setProfileMenuOpen(false);
    props.onNavigate("/sign-in");
  }

  function handleProfileBlur(event: FocusEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }

    setProfileMenuOpen(false);
  }

  function handleProfilePointer(event: ReactPointerEvent<HTMLDivElement>, open: boolean) {
    lastProfilePointerTypeRef.current = event.pointerType;
    if (event.pointerType !== "mouse") {
      return;
    }

    if (open) {
      clearProfileCloseTimeout();
      setProfileMenuOpen(open);
      return;
    }

    profileCloseTimeoutRef.current = window.setTimeout(() => {
      setProfileMenuOpen(false);
      profileCloseTimeoutRef.current = null;
    }, 120);
  }

  function clearProfileCloseTimeout() {
    if (profileCloseTimeoutRef.current === null) {
      return;
    }

    window.clearTimeout(profileCloseTimeoutRef.current);
    profileCloseTimeoutRef.current = null;
  }

  return (
    <div className={`app-shell${props.isContentObscured ? " app-shell--content-obscured" : ""}`}>
      <AnimatedBackground />

      <header className="topbar topbar--dark">
        <div className="topbar__left">
          <button
            aria-label="Open navigation"
            className="hamburger-button"
            onClick={props.onToggleSidebar}
            type="button"
          >
            <svg width="20" height="14" viewBox="0 0 20 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="20" height="1.5" rx="0.75" fill="white" fillOpacity="0.5" />
              <rect y="6" width="14" height="1.5" rx="0.75" fill="white" fillOpacity="0.35" />
              <rect y="12" width="20" height="1.5" rx="0.75" fill="white" fillOpacity="0.5" />
            </svg>
          </button>
          <button
            className="brand-mark brand-mark--dark"
            onClick={() => {
              props.onNavigate("/");
            }}
            type="button"
          >
            Opsuimeets
          </button>
          {isSuper ? <span className="status-pill status-pill--accent topbar__pill">Super</span> : null}
        </div>
        <div className="topbar__right">
          {signedIn ? (
            <div
              className="topbar-profile"
              onBlur={handleProfileBlur}
              onFocus={() => {
                if (!lastProfilePointerTypeRef.current || lastProfilePointerTypeRef.current === "mouse") {
                  setProfileMenuOpen(true);
                }
              }}
              onPointerEnter={(event) => {
                handleProfilePointer(event, true);
              }}
              onPointerLeave={(event) => {
                handleProfilePointer(event, false);
              }}
              ref={profileMenuRef}
            >
              <button
                aria-expanded={profileMenuOpen}
                aria-haspopup="menu"
                aria-label={`Account menu ${profileLabel}`}
                className="topbar-profile__button"
                onClick={() => {
                  setProfileMenuOpen((current) =>
                    lastProfilePointerTypeRef.current === "mouse" && current ? current : !current,
                  );
                }}
                onPointerDown={(event) => {
                  lastProfilePointerTypeRef.current = event.pointerType;
                }}
                type="button"
              >
                <span
                  aria-hidden="true"
                  className={`topbar-profile__avatar topbar-profile__avatar--${avatarVisual.mode}`}
                  style={{ "--profile-avatar-color": avatarVisual.color } as CSSProperties}
                >
                  {avatarVisual.mode === "image" && avatarVisual.imageDataUrl ? (
                    <img
                      alt=""
                      src={avatarVisual.imageDataUrl}
                      style={{ transform: `scale(${getVisualScale(avatarVisual)})` }}
                    />
                  ) : (
                    profileInitials
                  )}
                </span>
                <span className="topbar-profile__name">{profileLabel}</span>
              </button>
              <div
                aria-label="Account"
                className={`topbar-profile__menu${profileMenuOpen ? " is-open" : ""}`}
                role="menu"
              >
                <button
                  className="topbar-profile__item"
                  onClick={() => {
                    setProfileMenuOpen(false);
                    props.onNavigate("/my-profile");
                  }}
                  role="menuitem"
                  type="button"
                >
                  My profile
                </button>
                <button
                  className="topbar-profile__item"
                  onClick={() => {
                    setProfileMenuOpen(false);
                    props.onNavigate("/appearance");
                  }}
                  role="menuitem"
                  type="button"
                >
                  Appearance
                </button>
                <button
                  className="topbar-profile__item topbar-profile__item--danger"
                  onClick={() => {
                    setProfileMenuOpen(false);
                    setSignOutModalOpen(true);
                  }}
                  role="menuitem"
                  type="button"
                >
                  Sign out
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                className="topbar-auth-button"
                onClick={() => {
                  props.onNavigate("/sign-in");
                }}
                type="button"
              >
                Sign In
              </button>
              <button
                className="topbar-auth-button topbar-auth-button--accent"
                onClick={() => {
                  props.onNavigate("/sign-up");
                }}
                type="button"
              >
                Sign Up
              </button>
            </>
          )}
        </div>
      </header>

      <button
        aria-hidden={!props.isSidebarOpen}
        className={`sidebar-scrim${props.isSidebarOpen ? " is-open" : ""}`}
        onClick={props.onCloseSidebar}
        tabIndex={props.isSidebarOpen ? 0 : -1}
        type="button"
      />

      <aside
        aria-hidden={!props.isSidebarOpen}
        className={`sidebar${props.isSidebarOpen ? " is-open" : ""}`}
      >
        <div className="sidebar__header">
          <div>
            <div className="eyebrow">Navigation</div>
            <h2 className="sidebar__title">Opsuimeets</h2>
            {isOrganisationMember ? (
              <p className="sidebar__copy sidebar__copy--tight">
                {props.session?.actor.workspaceName}
                {isSuper ? " · Super" : ""}
              </p>
            ) : null}
            {signedIn && props.session?.actor.username ? (
              <p className="sidebar__copy sidebar__copy--tight">@{props.session.actor.username}</p>
            ) : null}
          </div>
          <button
            aria-label="Close navigation"
            className="icon-button icon-button--small"
            onClick={props.onCloseSidebar}
            type="button"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <nav aria-label="Primary" className="sidebar__nav">
          {navigationItems.map((item) => (
            <button
              className={`sidebar__link${item.active ? " is-active" : ""}`}
              key={item.href}
              onClick={() => {
                props.onNavigate(item.href);
              }}
              type="button"
            >
              <span>{item.label}</span>
              {item.badge ? <span className="sidebar__badge">{item.badge}</span> : null}
            </button>
          ))}
        </nav>

        <div className="sidebar__footer">
          <p className="sidebar__copy">
            Minimal meeting rooms on top of the existing auth, API, realtime, and media services.
          </p>
        </div>
      </aside>

      <main className="page-shell">{props.children}</main>

      <Modal
        actions={
          <>
            <button
              className="button button--subtle"
              disabled={isSigningOut}
              onClick={() => {
                setSignOutModalOpen(false);
                setSignOutError(null);
              }}
              type="button"
            >
              Cancel
            </button>
            <button
              className="button button--primary"
              disabled={isSigningOut}
              onClick={() => {
                void handleConfirmedSignOut();
              }}
              type="button"
            >
              {isSigningOut ? "Signing out..." : "Sign out"}
            </button>
          </>
        }
        description="You will need to sign in again to use your account."
        onClose={() => {
          if (isSigningOut) {
            return;
          }

          setSignOutModalOpen(false);
          setSignOutError(null);
        }}
        open={signOutModalOpen}
        title="Sign out?"
      >
        {signOutError ? <p className="inline-feedback inline-feedback--error">{signOutError}</p> : null}
      </Modal>
    </div>
  );
}

function getProfileInitials(value: string): string {
  const parts = value
    .replace(/^@/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);

  const initials = parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return initials || "U";
}

function getVisualScale(visual: ProfileVisualAsset): number {
  return 1 + (Math.min(100, Math.max(0, visual.zoom)) / 100) * 1.5;
}
