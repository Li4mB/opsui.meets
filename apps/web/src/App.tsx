import { useEffect, useRef, useState } from "react";
import type { AuthCapabilities, SessionInfo } from "@opsui/shared-types";
import { AppLayout } from "./components/AppLayout";
import { MeetingJoinLoader } from "./components/MeetingJoinLoader";
import { getAuthCapabilities, getSessionState, sendPresenceHeartbeat } from "./lib/auth";
import { createInstantMeeting, createRoom } from "./lib/commands";
import { loadDirectMessageThreads } from "./lib/direct-messages";
import { formatMeetingCodeLabel, generateMeetingCode } from "./lib/meeting-code";
import { useAppRoute } from "./lib/router";
import { AccountPlaceholderPage } from "./pages/AccountPlaceholderPage";
import { CompleteAccountPage } from "./pages/CompleteAccountPage";
import { DirectMessagesPage } from "./pages/DirectMessagesPage";
import { HomePage } from "./pages/HomePage";
import { LegacyJoinPage } from "./pages/LegacyJoinPage";
import { MeetingRoomPage } from "./pages/MeetingRoomPage";
import { MeetingStageLabPage } from "./pages/MeetingStageLabPage";
import { MyProfilePage } from "./pages/MyProfilePage";
import { MyOrganisationPage } from "./pages/MyOrganisationPage";
import { SignInPage } from "./pages/SignInPage";
import { SignUpPage } from "./pages/SignUpPage";

export function App() {
  const { route, navigate } = useAppRoute();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [authCapabilities, setAuthCapabilities] = useState<AuthCapabilities | null>(null);
  const [directMessagesUnreadCount, setDirectMessagesUnreadCount] = useState(0);
  const [pendingMeetingLaunch, setPendingMeetingLaunch] = useState<{
    meetingCode: string;
    requestId: number;
  } | null>(null);
  const [startMeetingError, setStartMeetingError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const activeMeetingLaunchRequestIdRef = useRef<number | null>(null);
  const nextMeetingLaunchRequestIdRef = useRef(0);

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
    if (!session?.authenticated || session.sessionType !== "user") {
      return;
    }

    let cancelled = false;

    async function heartbeat() {
      if (
        cancelled ||
        (typeof document !== "undefined" && document.visibilityState === "hidden") ||
        (typeof navigator !== "undefined" && navigator.onLine === false)
      ) {
        return;
      }

      await sendPresenceHeartbeat();
    }

    void heartbeat();
    const interval = window.setInterval(() => {
      void heartbeat();
    }, 20_000);

    function handlePresenceTrigger() {
      if (document.visibilityState === "visible") {
        void heartbeat();
      }
    }

    window.addEventListener("focus", handlePresenceTrigger);
    window.addEventListener("online", handlePresenceTrigger);
    document.addEventListener("visibilitychange", handlePresenceTrigger);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", handlePresenceTrigger);
      window.removeEventListener("online", handlePresenceTrigger);
      document.removeEventListener("visibilitychange", handlePresenceTrigger);
    };
  }, [session?.authenticated, session?.sessionType, session?.actor.userId]);

  useEffect(() => {
    setSidebarOpen(false);
  }, [route.pathname]);

  useEffect(() => {
    if (
      pendingMeetingLaunch &&
      route.kind === "meeting" &&
      route.meetingCode === pendingMeetingLaunch.meetingCode
    ) {
      setPendingMeetingLaunch(null);
    }
  }, [pendingMeetingLaunch, route]);

  const currentMeetingCode = route.kind === "meeting" ? route.meetingCode : null;

  function cancelPendingMeetingLaunch() {
    activeMeetingLaunchRequestIdRef.current = null;
    setPendingMeetingLaunch(null);
  }

  function handleStartMeeting() {
    const meetingCode = generateMeetingCode();
    const requestId = nextMeetingLaunchRequestIdRef.current + 1;
    nextMeetingLaunchRequestIdRef.current = requestId;
    activeMeetingLaunchRequestIdRef.current = requestId;
    setStartMeetingError(null);
    setPendingMeetingLaunch({
      meetingCode,
      requestId,
    });

    void (async () => {
      const room = await createRoom({
        isPersistent: false,
        name: meetingCode,
        roomType: "instant",
      });

      if (activeMeetingLaunchRequestIdRef.current !== requestId) {
        return;
      }

      if (!room) {
        setPendingMeetingLaunch(null);
        setStartMeetingError("We could not create a room right now.");
        return;
      }

      const meeting = await createInstantMeeting({
        roomId: room.id,
        startsAt: new Date().toISOString(),
        title: `Meeting ${formatMeetingCodeLabel(room.slug)}`,
      });

      if (activeMeetingLaunchRequestIdRef.current !== requestId) {
        return;
      }

      if (!meeting) {
        setPendingMeetingLaunch(null);
        setStartMeetingError("The room exists, but the meeting could not be started.");
        return;
      }

      navigate(`/${room.slug}`);
    })();
  }

  return (
    <>
      <AppLayout
        currentMeetingCode={currentMeetingCode}
        currentPath={route.pathname}
        directMessagesUnreadCount={directMessagesUnreadCount}
        isContentObscured={Boolean(pendingMeetingLaunch)}
        isSidebarOpen={sidebarOpen}
        session={session}
        onCloseSidebar={() => {
          setSidebarOpen(false);
        }}
        onNavigate={(pathname) => {
          navigate(pathname);
        }}
        onRefreshSession={(forceRefresh) => {
          return refreshAuth(forceRefresh);
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
            onStartMeeting={handleStartMeeting}
            startMeetingError={startMeetingError}
            startMeetingPending={Boolean(pendingMeetingLaunch)}
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
        {route.kind === "my-profile" ? (
          <MyProfilePage
            onNavigate={(pathname) => {
              navigate(pathname);
            }}
            onRefreshSession={(forceRefresh) => {
              return refreshAuth(forceRefresh);
            }}
            session={session}
          />
        ) : null}
        {route.kind === "appearance" ? <AccountPlaceholderPage title="Appearance" /> : null}
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

      {pendingMeetingLaunch ? (
        <MeetingJoinLoader
          active
          meetingCode={pendingMeetingLaunch.meetingCode}
          onCancel={cancelPendingMeetingLaunch}
        />
      ) : null}
    </>
  );
}
