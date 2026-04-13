import { useEffect } from "react";
import type { PropsWithChildren } from "react";
import type { SessionInfo } from "@opsui/shared-types";

interface AppLayoutProps extends PropsWithChildren {
  currentMeetingCode: string | null;
  currentPath: string;
  directMessagesUnreadCount: number;
  isSidebarOpen: boolean;
  session: SessionInfo | null;
  onCloseSidebar(): void;
  onNavigate(pathname: string): void;
  onToggleSidebar(): void;
}

interface NavigationItem {
  active: boolean;
  badge?: number;
  href: string;
  label: string;
}

export function AppLayout(props: AppLayoutProps) {
  const isOrganisationMember = props.session?.authenticated && props.session.actor.workspaceKind === "organisation";
  const isSuper = props.session?.actor.planTier === "super";
  const navigationItems: NavigationItem[] = [
    {
      active: props.currentPath === "/",
      href: "/",
      label: "Home",
    },
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
    ...(props.session?.authenticated
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

  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          aria-label="Open navigation"
          className="icon-button"
          onClick={props.onToggleSidebar}
          type="button"
        >
          <span aria-hidden="true">☰</span>
        </button>
        <button
          className="brand-mark"
          onClick={() => {
            props.onNavigate("/");
          }}
          type="button"
        >
          Opsuimeets
        </button>
        {isSuper ? <span className="status-pill status-pill--accent topbar__pill">Super</span> : null}
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
            {props.session?.authenticated && props.session.actor.username ? (
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
    </div>
  );
}
