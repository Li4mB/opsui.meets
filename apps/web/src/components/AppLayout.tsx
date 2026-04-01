import { useEffect } from "react";
import type { PropsWithChildren } from "react";

interface AppLayoutProps extends PropsWithChildren {
  currentMeetingCode: string | null;
  currentPath: string;
  isSidebarOpen: boolean;
  onCloseSidebar(): void;
  onNavigate(pathname: string): void;
  onToggleSidebar(): void;
}

interface NavigationItem {
  active: boolean;
  href: string;
  label: string;
}

export function AppLayout(props: AppLayoutProps) {
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
              {item.label}
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
