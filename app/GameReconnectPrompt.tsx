"use client";

import { useApi } from "@/hooks/useApi";
import useLocalStorage from "@/hooks/useLocalStorage";
import type { ApplicationError } from "@/types/error";
import { Button } from "antd";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

const STATUS_POLL_MS = 20000;

type SelfState = {
  status: string;
  gameId: string;
};

type ActiveGameResponse = {
  gameId?: unknown;
};

function normalizeString(value: unknown): string {
  return String(value ?? "").trim();
}

function isAuthRoute(pathname: string): boolean {
  return pathname === "/" || pathname === "/login";
}

function isGameRoute(pathname: string): boolean {
  return pathname === "/game" || pathname.startsWith("/game/");
}

export default function GameReconnectPrompt() {
  const api = useApi();
  const router = useRouter();
  const pathname = normalizeString(usePathname()).toLowerCase();
  const { value: token } = useLocalStorage<string>("token", "");
  const { value: userId } = useLocalStorage<string>("userId", "");
  const { value: pendingInitialPeekGameId } = useLocalStorage<string>(
    "pendingInitialPeekGameId",
    "",
  );
  const { value: activeSessionId, set: setActiveSessionId } = useLocalStorage<string>(
    "activeSessionId",
    "",
  );

  const [isPlayingOnServer, setIsPlayingOnServer] = useState(false);
  const [serverGameId, setServerGameId] = useState("");
  const [isReconnecting, setIsReconnecting] = useState(false);

  const tokenValue = token.trim();
  const userIdValue = String(userId).trim();
  const isVisibleRoute = !isAuthRoute(pathname) && !isGameRoute(pathname);
  const canTrack = Boolean(tokenValue && userIdValue && isVisibleRoute);

  const reconnectGameId = useMemo(() => {
    const fromServer = serverGameId.trim();
    if (fromServer) {
      return fromServer;
    }
    const fromInitialPeek = String(pendingInitialPeekGameId ?? "").trim();
    if (fromInitialPeek) {
      return fromInitialPeek;
    }
    return String(activeSessionId ?? "").trim();
  }, [serverGameId, pendingInitialPeekGameId, activeSessionId]);

  const loadSelfState = useCallback(async (): Promise<SelfState | null> => {
    if (!tokenValue || !userIdValue) {
      return null;
    }

    try {
      const activeGame = await api.getWithAuth<ActiveGameResponse>(
        "/games/active",
        tokenValue,
      );
      const gameId = normalizeString(activeGame?.gameId);
      if (!gameId) {
        return { status: "", gameId: "" };
      }
      return { status: "PLAYING", gameId };
    } catch (error) {
      const appError = error as Partial<ApplicationError> | undefined;
      // Keep previous prompt state on transient failures so the reconnect card
      // does not flap off during backend latency/rate-limit spikes.
      if (appError?.status === 401 || appError?.status === 403 || appError?.status === 404) {
        return { status: "", gameId: "" };
      }
      return null;
    }
  }, [api, tokenValue, userIdValue]);

  useEffect(() => {
    if (!canTrack) {
      setIsPlayingOnServer(false);
      setServerGameId("");
      setIsReconnecting(false);
      return;
    }

    let active = true;
    let pollingInFlight = false;

    const refresh = async () => {
      if (pollingInFlight) {
        return;
      }
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      pollingInFlight = true;
      try {
        const next = await loadSelfState();
        if (!active || !next) {
          return;
        }

        const isPlaying = Boolean(next.gameId);
        setIsPlayingOnServer(isPlaying);

        if (next.gameId) {
          setServerGameId(next.gameId);
          setActiveSessionId(next.gameId);
        } else {
          setServerGameId("");
        }
      } finally {
        pollingInFlight = false;
      }
    };

    void refresh();
    const refreshOnVisible = () => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    };
    const refreshOnFocus = () => {
      void refresh();
    };
    const intervalId = setInterval(() => {
      void refresh();
    }, STATUS_POLL_MS);
    window.addEventListener("visibilitychange", refreshOnVisible);
    window.addEventListener("focus", refreshOnFocus, { passive: true });

    return () => {
      active = false;
      clearInterval(intervalId);
      window.removeEventListener("visibilitychange", refreshOnVisible);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [canTrack, loadSelfState, setActiveSessionId]);

  const shouldShowPrompt = canTrack && isPlayingOnServer;

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    document.body.classList.toggle("cabo-reconnect-active", shouldShowPrompt);
    return () => {
      document.body.classList.remove("cabo-reconnect-active");
    };
  }, [shouldShowPrompt]);

  const resolveReconnectGameId = useCallback(async (): Promise<string> => {
    const fromState = reconnectGameId.trim();
    if (fromState) {
      return fromState;
    }

    try {
      const activeGame = await api.getWithAuth<ActiveGameResponse>(
        "/games/active",
        tokenValue,
      );
      const gameId = normalizeString(activeGame?.gameId);
      if (gameId) {
        setServerGameId(gameId);
        return gameId;
      }
    } catch {
      // handled by empty return
    }

    return "";
  }, [api, reconnectGameId, tokenValue]);

  const handleReconnect = async () => {
    setIsReconnecting(true);
    const gameId = await resolveReconnectGameId();
    if (!gameId) {
      setIsReconnecting(false);
      alert("Resyncing: Please wait until the current player's turn is finished.");
      return;
    }

    setActiveSessionId(gameId);
    router.push("/game");
  };

  if (!shouldShowPrompt) {
    return null;
  }

  return (
    <div className="cabo-reconnect-corner" role="status" aria-live="polite">
      <p className="cabo-reconnect-corner-title">Game still running</p>
      <p className="cabo-reconnect-corner-text">
        You are still in an active match. Reconnect now to continue.
      </p>
      <div className="cabo-reconnect-corner-actions">
        <Button
          type="primary"
          loading={isReconnecting}
          onClick={() => void handleReconnect()}
          className="cabo-reconnect-btn"
        >
          Reconnect
        </Button>
      </div>
    </div>
  );
}
