"use client";

import { useEffect, useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import useLocalStorage from "@/hooks/useLocalStorage";

function decodePathSegment(value: string | undefined): string {
  if (!value) {
    return "";
  }
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return String(value).trim();
  }
}

function withCode(baseTitle: string, code: string): string {
  const normalizedCode = code.trim();
  return normalizedCode ? `${baseTitle} ${normalizedCode}` : baseTitle;
}

export default function TabTitleManager() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { value: activeSessionId } = useLocalStorage<string>("activeSessionId", "");
  const { value: activeLobbySessionId } = useLocalStorage<string>("activeLobbySessionId", "");

  const resolvedTitle = useMemo(() => {
    const rawPath = String(pathname ?? "").trim();
    const path = rawPath.length > 1 ? rawPath.replace(/\/+$/, "") : rawPath;
    const segments = path.split("/").filter((part) => part.length > 0);

    if (path === "/" || path === "/login") {
      return "Welcome to Cabo";
    }

    if (path === "/dashboard") {
      return "Cabo: Dashboard";
    }

    if (path === "/game") {
      const gameCode = String(activeLobbySessionId ?? "").trim() || String(activeSessionId ?? "").trim();
      return withCode("Cabo: Game", gameCode);
    }

    if (path === "/lobby/join") {
      return "Cabo: Join Lobby";
    }

    if (path === "/lobby/waiting" || path === "/create_lobby") {
      const waitingCode = String(searchParams?.get("sessionId") ?? "").trim() || String(activeLobbySessionId ?? "").trim();
      return withCode("Cabo: Lobby", waitingCode);
    }

    if (segments[0] === "lobby" && segments[1] && segments[1] !== "join" && segments[1] !== "waiting") {
      return withCode("Cabo: Lobby", decodePathSegment(segments[1]));
    }

    if (segments[0] === "history" && segments[1]) {
      return withCode("Cabo: History", decodePathSegment(segments[1]));
    }

    if (path === "/users") {
      return "Cabo: Users";
    }

    if (segments[0] === "users" && segments[1] && segments[2] === "edit") {
      return "Cabo: Edit Profile";
    }

    if (segments[0] === "users" && segments[1]) {
      return "Cabo: Profile";
    }

    if (path === "/settings") {
      return "Cabo: Settings";
    }

    if (path === "/credits") {
      return "Cabo: Credits";
    }

    return "Cabo";
  }, [pathname, searchParams, activeLobbySessionId, activeSessionId]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const applyTitle = () => {
      if (document.title !== resolvedTitle) {
        document.title = resolvedTitle;
      }
    };

    applyTitle();
    const timeoutId = window.setTimeout(applyTitle, 0);
    const rafId = window.requestAnimationFrame(applyTitle);
    window.addEventListener("focus", applyTitle);
    window.addEventListener("pageshow", applyTitle);
    document.addEventListener("visibilitychange", applyTitle);

    return () => {
      window.clearTimeout(timeoutId);
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("focus", applyTitle);
      window.removeEventListener("pageshow", applyTitle);
      document.removeEventListener("visibilitychange", applyTitle);
    };
  }, [resolvedTitle]);

  return null;
}
