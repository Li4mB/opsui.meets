import { useEffect, useState } from "react";
import { normalizeMeetingCode } from "./meeting-code";

export type AppRoute =
  | { kind: "home"; pathname: "/" }
  | { kind: "sign-in"; pathname: "/sign-in" }
  | { kind: "legacy-join"; meetingCode: string | null; pathname: "/join" }
  | { kind: "stage-lab"; pathname: "/__stage-lab" }
  | { kind: "meeting"; meetingCode: string; pathname: string };

interface NavigateOptions {
  replace?: boolean;
}

export function useAppRoute() {
  const [route, setRoute] = useState<AppRoute>(() => parseRoute(window.location));

  useEffect(() => {
    function handlePopState() {
      setRoute(parseRoute(window.location));
    }

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  function navigate(pathname: string, options?: NavigateOptions) {
    if (pathname === window.location.pathname && !options?.replace) {
      return;
    }

    const method = options?.replace ? "replaceState" : "pushState";
    window.history[method]({}, "", pathname);
    setRoute(parseRoute(window.location));
  }

  return {
    navigate,
    route,
  };
}

function parseRoute(location: Location): AppRoute {
  const pathname = normalizePathname(location.pathname);

  if (pathname === "/") {
    return { kind: "home", pathname };
  }

  if (pathname === "/sign-in") {
    return { kind: "sign-in", pathname };
  }

  if (pathname === "/join") {
    const params = new URLSearchParams(location.search);
    return {
      kind: "legacy-join",
      meetingCode: normalizeMeetingCode(params.get("room") ?? ""),
      pathname,
    };
  }

  if (import.meta.env.DEV && pathname === "/__stage-lab") {
    return { kind: "stage-lab", pathname };
  }

  return {
    kind: "meeting",
    meetingCode: decodeURIComponent(pathname.slice(1)),
    pathname,
  };
}

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === "/") {
    return "/";
  }

  return pathname.replace(/\/+$/, "") || "/";
}
