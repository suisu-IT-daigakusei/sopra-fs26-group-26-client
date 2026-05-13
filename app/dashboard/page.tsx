"use client"; // seite wird im browser ausgeführt, nicht auf dem server 

// S1: nach erfolgreichem login: Dashboard Screen - wird nach dem Login angezeigt
// beinhaltet overview des users und seiner daten, möglichkeit zum logout, aber auch inspektion der anderen user sowie auch password change button  (s3)

import React, { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useApi } from "@/hooks/useApi";
import { useApiConnectionStatus } from "@/hooks/useApiConnectionStatus";
import useLocalStorage from "@/hooks/useLocalStorage";
import { User } from "@/types/user";
import CharacterAvatar from "@/components/CharacterAvatar";
import { derivePlayedStatsFromHistoryPayload } from "@/utils/userHistoryStats";
import { resolveCharacterColorId } from "@/utils/userSettings";
import { Button, Card } from "antd";

// Simple 3 variant dynamic greetings on Dashboard
type GreetingSlot = "morning" | "day" | "afternoon" | "evening" | "night";
type FriendOnlineSummary = {
  friendsOnline: number;
  playing: number;
  lobby: number;
  spectating: number;
};

const GREETINGS_BY_TIME_SLOT: Record<GreetingSlot, string[]> = {
  morning: [
    "Online-CABO is ready to be played.",
    "Good morning! Welcome back to Online-CABO.",
    "Good morning. Ready for Online-CABO?",
  ],
  day: [
    "Good day. Welcome to Online-CABO.",
    "Good day. Enjoy Online-CABO.",
    "Good day. Great to see you in Online-CABO.",
  ],
  afternoon: [
    "Good afternoon. Welcome back to Online-CABO.",
    "Afternoon! Ready for Online-CABO?",
    "Good afternoon. Let's play Online-CABO.",
  ],
  evening: [
    "Good evening. Welcome back to Online-CABO.",
    "Evening! Time for Online-CABO.",
    "Good evening. Online-CABO is ready.",
  ],
  night: [
    "Welcome back to Online-CABO, night owl.",
    "Late session? Online-CABO is ready.",
    "Online-CABO is ready whenever you are.",
  ],
};

function getGreetingSlotByHour(localHour: number): GreetingSlot {
  if (localHour >= 5 && localHour < 11) return "morning";
  if (localHour >= 11 && localHour < 14) return "day";
  if (localHour >= 14 && localHour < 18) return "afternoon";
  if (localHour >= 18 && localHour < 23) return "evening";
  return "night";
}

function pickRandomGreeting(slot: GreetingSlot): string {
  const options = GREETINGS_BY_TIME_SLOT[slot];
  return options[Math.floor(Math.random() * options.length)] ?? "Welcome back to Online-CABO!";
}

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const apiService = useApi();

  const [user, setUser] = useState<User | null>(null);
  const [userHistoryPayload, setUserHistoryPayload] = useState<unknown>(null);
  const [friendOnlineSummary, setFriendOnlineSummary] = useState<FriendOnlineSummary>({
    friendsOnline: 0,
    playing: 0,
    lobby: 0,
    spectating: 0,
  });

  const { value: userId, clear: clearUserId } = useLocalStorage<string>("userId", "");
  const { value: token, clear: clearToken } = useLocalStorage<string>("token", "");
  const normalizedUserId = typeof userId === "string" ? userId.trim() : "";
  const normalizedToken = typeof token === "string" ? token.trim() : "";
  const liveConnected = useApiConnectionStatus(normalizedUserId, normalizedToken);

  useEffect(() => {
    const kicked = searchParams.get("kicked");
    if (kicked === "1") {
      alert("You were removed from the lobby.");
      router.replace("/dashboard");
    }
  }, [router, searchParams]);

  // user vom back end holen via get request und speichern, fehlermeldung falls es nicht geht.
  useEffect(() => {
    if (!normalizedUserId || !normalizedToken) {
      clearToken();
      clearUserId();
      router.replace("/login");
      return;
    }

    let active = true;

    const fetchUser = async () => {
      try {
        const fetchedUser = await apiService.getWithAuth<User>(
          `/users/${encodeURIComponent(normalizedUserId)}`,
          normalizedToken,
        );
        if (active) {
          setUser(fetchedUser);
        }
      } catch (error) {
        const status = (error as { status?: number })?.status;
        if (active && (status === 401 || status === 403 || status === 404)) {
          clearToken();
          clearUserId();
          router.replace("/login");
          return;
        }
        if (active && error instanceof Error) {
          alert(`Something went wrong:\n${error.message}`);
        }
      }
    };

    void fetchUser();

    return () => {
      active = false;
    };
  }, [apiService, normalizedUserId, normalizedToken, router, clearToken, clearUserId]);

  useEffect(() => {
    if (!normalizedUserId || !normalizedToken) {
      setUserHistoryPayload(null);
      return;
    }

    let active = true;

    const fetchHistory = async () => {
      try {
        const payload = await apiService.getWithAuth<unknown>(
          `/users/${encodeURIComponent(normalizedUserId)}/history`,
          normalizedToken,
        );
        if (active) {
          setUserHistoryPayload(payload);
        }
      } catch {
        if (active) {
          setUserHistoryPayload(null);
        }
      }
    };

    void fetchHistory();

    return () => {
      active = false;
    };
  }, [apiService, normalizedToken, normalizedUserId]);

  useEffect(() => {
    if (!normalizedToken || !normalizedUserId) {
      setFriendOnlineSummary({
        friendsOnline: 0,
        playing: 0,
        lobby: 0,
        spectating: 0,
      });
      return;
    }

    let active = true;
    let timerId: ReturnType<typeof setInterval> | null = null;

    const fetchFriendSummary = async () => {
      try {
        const summary = await apiService.getWithAuth<FriendOnlineSummary>(
          "/users/me/friends/online-summary",
          normalizedToken,
        );
        if (!active) {
          return;
        }
        setFriendOnlineSummary({
          friendsOnline: Number(summary?.friendsOnline ?? 0),
          playing: Number(summary?.playing ?? 0),
          lobby: Number(summary?.lobby ?? 0),
          spectating: Number(summary?.spectating ?? 0),
        });
      } catch {
        // Keep last known values on transient failures; next poll/focus refresh will retry.
      }
    };

    void fetchFriendSummary();
    timerId = setInterval(() => {
      void fetchFriendSummary();
    }, 60000);

    const refreshOnVisibleOrFocus = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      void fetchFriendSummary();
    };

    if (typeof window !== "undefined") {
      window.addEventListener("focus", refreshOnVisibleOrFocus);
      document.addEventListener("visibilitychange", refreshOnVisibleOrFocus);
    }

    return () => {
      active = false;
      if (timerId) {
        clearInterval(timerId);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", refreshOnVisibleOrFocus);
        document.removeEventListener("visibilitychange", refreshOnVisibleOrFocus);
      }
    };
  }, [apiService, normalizedToken, normalizedUserId]);

  const greeting = useMemo(() => {
    const localHour = new Date().getHours();
    const slot = getGreetingSlotByHour(localHour);
    return pickRandomGreeting(slot);
  }, []);

  // für logout button:
  const handleLogout = (): void => {
    const authToken = normalizedToken;

    // Local-first logout to keep UX instant even if backend/network is slow.
    clearToken();
    clearUserId();

    if (authToken) {
      void apiService.postWithAuth("/auth/logout", {}, authToken).catch(() => {
        // ignore: user is already logged out locally
      });
    }

    window.location.assign("/login");
  };

  const derivedPlayedStats = useMemo(
    () => derivePlayedStatsFromHistoryPayload(userHistoryPayload, normalizedUserId),
    [normalizedUserId, userHistoryPayload],
  );
  const roundsWon = Number(user?.roundsWon ?? 0);
  const roundsPlayedRaw = (
    user as User & { roundsPlayed?: number | null; rounds?: number | null; roundCount?: number | null }
  )?.roundsPlayed ?? (
    user as User & { roundsPlayed?: number | null; rounds?: number | null; roundCount?: number | null }
  )?.rounds ?? (
    user as User & { roundsPlayed?: number | null; rounds?: number | null; roundCount?: number | null }
  )?.roundCount ?? derivedPlayedStats.roundsPlayed ?? 0;
  const roundsPlayed = Number.isFinite(Number(roundsPlayedRaw))
    ? Number(roundsPlayedRaw)
    : 0;
  const winRatePct = roundsPlayed > 0 ? (roundsWon / roundsPlayed) * 100 : 0;
  const winRateText = Number(winRatePct).toFixed(1).replace(/\.0$/, "");
  const winsRoundsSummary = `${roundsWon}/${roundsPlayed} (${winRateText}%)`;
  const averageScore = user?.averageScorePerRound ?? "-";
  const friendOnlineLabel = friendOnlineSummary.friendsOnline === 1
    ? "Friend Online"
    : "Friends Online";

  return (
    <div className="cabo-background">
      <div className="login-container">
        <div className="create-lobby-stack dashboard-stack">
          <Card
            className="dashboard-container"
            title={
              <div className="dashboard-main-header">
                <span className="dashboard-welcome-title">
                  <span className="dashboard-welcome-greeting">{greeting}</span>
                </span>
                <div className="dashboard-friends-summary-row">
                  <span className="dashboard-friends-summary-line">
                    <span className="users-status-pill users-status-online dashboard-friends-summary-pill">
                      <strong>{friendOnlineSummary.friendsOnline}</strong>&nbsp;{friendOnlineLabel}
                    </span>
                    <span className="users-status-pill users-status-playing dashboard-friends-summary-pill">
                      <strong>{friendOnlineSummary.playing}</strong>&nbsp;Playing
                    </span>
                    <span className="users-status-pill users-status-lobby dashboard-friends-summary-pill">
                      <strong>{friendOnlineSummary.lobby}</strong>&nbsp;in Lobby
                    </span>
                    <span className="users-status-pill users-status-spectating dashboard-friends-summary-pill">
                      <strong>{friendOnlineSummary.spectating}</strong>&nbsp;Spectating
                    </span>
                  </span>
                  <span
                    className={`live-connection-symbol dashboard-friends-connection-symbol ${liveConnected ? "connected" : "disconnected"}`}
                    title={liveConnected ? "Connected" : "Disconnected"}
                  >
                    <span className="connection-symbol-dot" aria-hidden="true">{"\u25CF"}</span>
                  </span>
                </div>
              </div>
            }
          >
            <div className="dashboard-profile-hero">
              <div className="dashboard-profile-avatar-wrap" aria-hidden="true">
                <CharacterAvatar
                  characterId={user?.profileCharacterId}
                  primaryColorId={resolveCharacterColorId(user?.preferredColorPriority, user?.primaryColorId)}
                  alt=""
                  width={112}
                  height={112}
                  className="dashboard-profile-avatar"
                />
              </div>
              <div className="dashboard-profile-metrics">
                <div className="dashboard-welcome-player">{user?.username?.trim() || "Player"}</div>
                <div className="dashboard-profile-metrics-spacer" aria-hidden="true" />
                <div className="dashboard-metric-row">
                  <span>Wins / Rounds</span>
                  <span>{winsRoundsSummary}</span>
                </div>
                <div className="dashboard-metric-row">
                  <span>Average Score per Round</span>
                  <span>{averageScore}</span>
                </div>
              </div>
            </div>
          </Card>

          <Card
            className="dashboard-container"
            title={<div className="dashboard-section-title">Play</div>}
          >
            <div className="dashboard-button-stack">
              <Button type="primary" onClick={() => router.push("/lobby/join")}>
                Join a Game
              </Button>
              <Button type="primary" onClick={() => router.push("/create_lobby")}>
                Create a New Lobby
              </Button>
            </div>
          </Card>

          <Card
            className="dashboard-container"
            title={<div className="dashboard-section-title">Users</div>}
          >
            <div className="dashboard-button-stack">
              <Button
                type="primary"
                onClick={() => router.push(`/users/${encodeURIComponent(normalizedUserId)}`)}
              >
                User Profile
              </Button>
              <Button type="primary" onClick={() => router.push("/users")}>
                Users & Leaderboard
              </Button>
            </div>
          </Card>

          <Card
            className="dashboard-container"
            title={<div className="dashboard-section-title">Settings</div>}
          >
            <div className="dashboard-button-stack">
              <Button type="primary" onClick={() => router.push("/settings")}>
                Settings
              </Button>
              <Button type="primary" onClick={() => router.push("/credits")}>
                Credits
              </Button>
              <Button type="primary" className="dashboard-logout-btn" onClick={() => void handleLogout()}>
                Logout
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

const Dashboard = () => {
  return (
    <Suspense fallback={<div className="cabo-background" />}>
      <DashboardContent />
    </Suspense>
  );
};

export default Dashboard;
