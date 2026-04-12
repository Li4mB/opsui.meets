import { useEffect, useState } from "react";
import type { AuthCapabilities, SessionInfo } from "@opsui/shared-types";
import { AppLayout } from "./components/AppLayout";
import { getAuthCapabilities, getSessionState } from "./lib/auth";
import { useAppRoute } from "./lib/router";
import { HomePage } from "./pages/HomePage";
import { LegacyJoinPage } from "./pages/LegacyJoinPage";
import { MeetingRoomPage } from "./pages/MeetingRoomPage";
import { MeetingStageLabPage } from "./pages/MeetingStageLabPage";
import { SignInPage } from "./pages/SignInPage";

export function App() {
  const { route, navigate } = useAppRoute();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [authCapabilities, setAuthCapabilities] = useState<AuthCapabilities | null>(null);
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
    setSidebarOpen(false);
  }, [route.pathname]);

  const currentMeetingCode = route.kind === "meeting" ? route.meetingCode : null;

  return (
    <AppLayout
      currentMeetingCode={currentMeetingCode}
      currentPath={route.pathname}
      isSidebarOpen={sidebarOpen}
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
