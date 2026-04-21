import { useEffect, useState } from "react";
import type { AuthCapabilities, SessionInfo } from "@opsui/shared-types";
import { AppLayout } from "./components/AppLayout";
import { getAuthCapabilities, getSessionState } from "./lib/auth";
import { loadDirectMessageThreads } from "./lib/direct-messages";
import { useAppRoute } from "./lib/router";
import { CompleteAccountPage } from "./pages/CompleteAccountPage";
import { DirectMessagesPage } from "./pages/DirectMessagesPage";
import { HomePage } from "./pages/HomePage";
import { LegacyJoinPage } from "./pages/LegacyJoinPage";
import { MeetingRoomPage } from "./pages/MeetingRoomPage";
import { MeetingStageLabPage } from "./pages/MeetingStageLabPage";
import { MyOrganisationPage } from "./pages/MyOrganisationPage";
import { SignInPage } from "./pages/SignInPage";
import { SignUpPage } from "./pages/SignUpPage";

export function App() {
  const { route, navigate } = useAppRoute();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [authCapabilities, setAuthCapabilities] = useState<AuthCapabilities | null>(null);
  const [directMessagesUnreadCount, setDirectMessagesUnreadCount] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  async function refreshAuth(forceRefresh = false) {
    const [nextSession, nextCapabilities] = await Promise.all([
      getSessionState(forceRefresh),
      getAuthCapabilities(forceRefresh),
    ]);

    setSession(nextSession);
    setAuthCapabilities(nextCapabilities);
  }

  useEffect(() => {
    void refreshAuth();
  }, []);

  useEffect(() => {
    if (!session?.authenticated || session.sessionType !== "user") {
      setDirectMessagesUnreadCount(0);
      return;
    }

    let cancelled = false;

    async function refreshUnreadCount() {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }

      const threads = await loadDirectMessageThreads();
      if (cancelled) {
        return;
      }

      if (!threads.ok) {
        return;
      }

      setDirectMessagesUnreadCount(
        threads.items.reduce((total, thread) => total + thread.unreadCount, 0),
      );
    }

    void refreshUnreadCount();
    const interval = window.setInterval(() => {
      void refreshUnreadCount();
    }, 5_000);

    function handleVisibilityOrFocus() {
      if (document.visibilityState === "visible") {
        void refreshUnreadCount();
      }
    }

    window.addEventListener("focus", handleVisibilityOrFocus);
    window.addEventListener("online", handleVisibilityOrFocus);
    document.addEventListener("visibilitychange", handleVisibilityOrFocus);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", handleVisibilityOrFocus);
      window.removeEventListener("online", handleVisibilityOrFocus);
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
    };
  }, [session?.authenticated, session?.sessionType, session?.actor.userId]);

  useEffect(() => {
    setSidebarOpen(false);
  }, [route.pathname]);

  const currentMeetingCode = route.kind === "meeting" ? route.meetingCode : null;

  return (
    <AppLayout
      currentMeetingCode={currentMeetingCode}
      currentPath={route.pathname}
      directMessagesUnreadCount={directMessagesUnreadCount}
      isSidebarOpen={sidebarOpen}
      session={session}
      onCloseSidebar={() => {
        setSidebarOpen(false);
      }}
      onNavigate={(pathname) => {
        navigate(pathname);
      }}
      onToggleSidebar={() => {
        setSidebarOpen((current) => !current);
      }}
    >
      {route.kind === "home" ? (
        <HomePage
          onNavigate={(pathname) => {
            navigate(pathname);
          }}
        />
      ) : null}
      {route.kind === "sign-in" ? (
        <SignInPage
          authCapabilities={authCapabilities}
          isAuthLoading={!session || !authCapabilities}
          onNavigate={(pathname) => {
            navigate(pathname);
          }}
          onRefreshSession={(forceRefresh) => {
            return refreshAuth(forceRefresh);
          }}
          session={session}
        />
      ) : null}
      {route.kind === "sign-up" ? (
        <SignUpPage
          authCapabilities={authCapabilities}
          isAuthLoading={!session || !authCapabilities}
          onNavigate={(pathname) => {
            navigate(pathname);
          }}
          onRefreshSession={(forceRefresh) => {
            return refreshAuth(forceRefresh);
          }}
          session={session}
        />
      ) : null}
      {route.kind === "complete-account" ? (
        <CompleteAccountPage
          authCapabilities={authCapabilities}
          onNavigate={(pathname) => {
            navigate(pathname);
          }}
          onRefreshSession={(forceRefresh) => {
            return refreshAuth(forceRefresh);
          }}
          session={session}
        />
      ) : null}
      {route.kind === "direct-messages" || route.kind === "direct-message-thread" ? (
        <DirectMessagesPage
          onNavigate={(pathname) => {
            navigate(pathname);
          }}
          onUnreadCountChange={setDirectMessagesUnreadCount}
          selectedThreadId={route.kind === "direct-message-thread" ? route.threadId : null}
          session={session}
        />
      ) : null}
      {route.kind === "my-organisation" ? (
        <MyOrganisationPage
          authCapabilities={authCapabilities}
          onNavigate={(pathname) => {
            navigate(pathname);
          }}
          onRefreshSession={(forceRefresh) => {
            return refreshAuth(forceRefresh);
          }}
          session={session}
        />
      ) : null}
      {route.kind === "legacy-join" ? (
        <LegacyJoinPage
          meetingCode={route.meetingCode}
          onNavigate={(pathname, replace) => {
            navigate(pathname, { replace });
          }}
        />
      ) : null}
      {route.kind === "stage-lab" ? <MeetingStageLabPage search={window.location.search} /> : null}
      {route.kind === "meeting" ? (
        <MeetingRoomPage
          authCapabilities={authCapabilities}
          isAuthLoading={!session || !authCapabilities}
          meetingCode={route.meetingCode}
          onNavigate={(pathname, options) => {
            navigate(pathname, options);
          }}
          onRefreshSession={(forceRefresh) => {
            return refreshAuth(forceRefresh);
          }}
          session={session}
        />
      ) : null}
    </AppLayout>
  );
}
