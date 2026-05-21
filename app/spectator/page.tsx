"use client";

import React, { useEffect, useState } from "react";
import { Button, Card, Spin } from "antd";
import { useRouter, useSearchParams } from "next/navigation";
import { useApi } from "@/hooks/useApi";
import useLocalStorage from "@/hooks/useLocalStorage";
import type { ApplicationError } from "@/types/error";

type ActiveGameResponse = {
  gameId?: unknown;
};

const PRE_JOIN_ACTIVE_GAME_LOOKUP_ATTEMPTS = 2;
const POST_JOIN_ACTIVE_GAME_LOOKUP_ATTEMPTS = 2;

const SpectatorJoinPage: React.FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const api = useApi();
  const { value: token } = useLocalStorage<string>("token", "");
  const { set: setSpectatorMode } = useLocalStorage<string>("spectatorMode", "");
  const { set: setActiveSessionId } = useLocalStorage<string>("activeSessionId", "");
  const { set: setActiveLobbySessionId } = useLocalStorage<string>("activeLobbySessionId", "");
  const { set: setActiveGameStatusSnapshot } = useLocalStorage<{ gameId?: string | null; status?: string | null } | null>(
    "activeGameStatusSnapshot",
    null,
  );

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sessionId = String(searchParams.get("sessionId") ?? "").trim();
    const authToken = token.trim();

    if (!authToken) {
      router.replace("/login");
      return;
    }

    if (!sessionId) {
      setError("Missing lobby code.");
      setLoading(false);
      return;
    }

    let active = true;
    const resolveActiveGameId = async (maxAttempts: number): Promise<string> => {
      const attempts = Math.max(1, Math.floor(maxAttempts));
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (!active) {
          return "";
        }
        try {
          const activeGame = await api.getWithAuth<ActiveGameResponse>(
            "/games/active",
            authToken,
          );
          const activeGameId = String(activeGame?.gameId ?? "").trim();
          if (activeGameId) {
            return activeGameId;
          }
        } catch {
          // best-effort active-game lookup only
        }
        if (attempt < attempts - 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 250));
        }
      }
      return "";
    };

    const openSpectatorView = async (activeGameLookupAttempts: number) => {
      const activeGameId = await resolveActiveGameId(activeGameLookupAttempts);
      if (!active) {
        return;
      }
      if (activeGameId) {
        // If the user is an active player, force normal game mode.
        setSpectatorMode("");
        setActiveLobbySessionId(sessionId);
        setActiveSessionId(activeGameId);
        setActiveGameStatusSnapshot({ gameId: activeGameId, status: null });
        router.replace("/game");
        return;
      }
      setSpectatorMode("1");
      setActiveLobbySessionId(sessionId);
      router.replace(`/lobby/${encodeURIComponent(sessionId)}?spectator=1`);
    };

    const joinAsSpectator = async () => {
      setLoading(true);
      setError(null);
      const activeGameId = await resolveActiveGameId(PRE_JOIN_ACTIVE_GAME_LOOKUP_ATTEMPTS);
      if (!active) {
        return;
      }
      if (activeGameId) {
        setSpectatorMode("");
        setActiveLobbySessionId(sessionId);
        setActiveSessionId(activeGameId);
        setActiveGameStatusSnapshot({ gameId: activeGameId, status: null });
        router.replace("/game");
        return;
      }
      try {
        await api.postWithAuth(
          `/lobbies/${encodeURIComponent(sessionId)}/spectators`,
          {},
          authToken,
        );
        if (!active) {
          return;
        }
        await openSpectatorView(POST_JOIN_ACTIVE_GAME_LOOKUP_ATTEMPTS);
      } catch (caughtError: unknown) {
        if (!active) {
          return;
        }
        const status = (caughtError as ApplicationError)?.status;
        const message = caughtError instanceof Error ? caughtError.message : "";
        if (status === 409 && message.toLowerCase().includes("already")) {
          await openSpectatorView(POST_JOIN_ACTIVE_GAME_LOOKUP_ATTEMPTS);
          return;
        }
        if (status === 404) {
          setError("Lobby not found.");
        } else if (status === 403) {
          setError("You cannot spectate this lobby right now.");
        } else {
          setError("Could not join as spectator. Please try again.");
        }
        setLoading(false);
      }
    };

    void joinAsSpectator();
    return () => {
      active = false;
    };
  }, [
    api,
    router,
    searchParams,
    setActiveGameStatusSnapshot,
    setActiveLobbySessionId,
    setActiveSessionId,
    setSpectatorMode,
    token,
  ]);

  if (loading) {
    return (
      <div className="cabo-background">
        <div className="login-container waiting-lobby-loading">
          <Spin size="large" />
        </div>
      </div>
    );
  }

  return (
    <div className="cabo-background">
      <div className="login-container">
        <div className="create-lobby-stack">
          <Card className="dashboard-container" title="Spectator Join">
            <p className="profile-results-empty-text">{error ?? "Could not join as spectator."}</p>
            <div className="dashboard-nav-row">
              <Button type="primary" onClick={() => router.push("/lobby/join")}>
                Back to Join
              </Button>
              <Button type="default" onClick={() => router.push("/dashboard")}>
                {"\u2302"} Dashboard
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default SpectatorJoinPage;
