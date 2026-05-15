"use client";

import { useApi } from "@/hooks/useApi";
import { useApiConnectionStatus } from "@/hooks/useApiConnectionStatus";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import useLocalStorage from "@/hooks/useLocalStorage";
import { useAttentionTitleBlink } from "@/hooks/useAttentionTitleBlink";
import {
  playSharedCaboSoundEffect,
  startSharedLoopedCaboSoundEffect,
  stopSharedLoopedCaboSoundEffect,
} from "@/hooks/useCaboMusicPlayer";
import {
  useOutgoingInviteStatuses,
  type CaboSentInviteEntry,
} from "@/hooks/useOutgoingInviteStatuses";
import type { ApplicationError } from "@/types/error";
import type { User } from "@/types/user";
import { getApiDomain, getStompBrokerUrl } from "@/utils/domain";
import { PresenceKey, toPresenceKey, toPresenceLabel } from "@/utils/presence";
import CharacterAvatar from "@/components/CharacterAvatar";
import CaboChatPanel from "@/components/CaboChatPanel";
import InlineMusicPlayer from "@/components/InlineMusicPlayer";
import { getCharacterWavingFrameMax } from "@/utils/userSettings";
import { Client } from "@stomp/stompjs";
import { Button, Card, Checkbox, Collapse, Input, List, Popconfirm, Slider, Spin, Switch, Typography } from "antd";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

type WaitingRow = {
  userId?: number;
  username: string;
  joinStatus: string;
  profileCharacterId?: string;
  characterColorId?: string;
  ready?: boolean;
};

type WaitingView = {
  sessionId?: string;
  isPublic?: boolean;
  viewerIsHost?: boolean;
  afkTimeoutSeconds?: number;
  websocketGraceSeconds?: number;
  initialPeekSeconds?: number;
  turnSeconds?: number;
  abilityRevealSeconds?: number;
  abilitySwapSeconds?: number;
  absentRoundPoints?: number;
  chatCooldownSeconds?: number;
  players?: WaitingRow[];
  spectators?: WaitingRow[];
};

type LobbySession = {
  sessionId?: string;
};

type GameStateSignal = {
  gameId?: string | null;
  id?: string | null;
  status?: string | null;
  gameStatus?: string | null;
  phase?: string | null;
};

type ActiveGameResponse = {
  gameId?: string | null;
};

type ActiveGameStatusSnapshot = {
  gameId?: string | null;
  status?: string | null;
};

type Player = {
  id: number;
  name: string;
  invited: boolean;
  loading: boolean;
  presenceKey: PresenceKey;
  presenceLabel: string;
  joined?: boolean;
  isSelf?: boolean;
};

type LobbySlot = {
  key: string;
  label: string;
  status: string;
  usernameKey: string;
  userId?: number;
  isViewer: boolean;
  isHost: boolean;
  occupied: boolean;
  isOpenSlot: boolean;
  ready: boolean;
  profileCharacterId?: string;
  characterColorId?: string;
};

type LobbyTimerSettings = {
  afkTimeoutSeconds: number;
  websocketGraceSeconds: number;
  initialPeekSeconds: number;
  turnSeconds: number;
  abilityRevealSeconds: number;
  abilitySwapSeconds: number;
  absentRoundPoints: number;
  chatCooldownSeconds: number;
};

const MAX_ACTIVE_INVITES = 10; // CAN BE CHANGED, set to 10 to avoid users spamming invites, but enough for legit cases
const MAX_LOBBY_PLAYERS = 4;
const HOST_CROWN = "\uD83D\uDC51\uFE0E";
const KICK_ICON = "\u2716";
const INVITE_PANEL_KEY = "invite-online-players";
const INVITE_USERS_POLL_MS = 10000;
const DEFAULT_LOBBY_TIMERS: LobbyTimerSettings = {
  afkTimeoutSeconds: 300,
  websocketGraceSeconds: 300,
  initialPeekSeconds: 10,
  turnSeconds: 30,
  abilityRevealSeconds: 5,
  abilitySwapSeconds: 10,
  absentRoundPoints: 20,
  chatCooldownSeconds: 3,
};
const BLINK_MIN_INTERVAL_MS = 2600;
const BLINK_MAX_INTERVAL_MS = 6800;
const BLINK_CLOSED_MIN_MS = 95;
const BLINK_CLOSED_MAX_MS = 170;

const TIMER_LIMITS = {
  afkTimeoutSeconds: { min: 180, max: 600 },
  websocketGraceSeconds: { min: 180, max: 600 },
  initialPeekSeconds: { min: 3, max: 60 },
  turnSeconds: { min: 10, max: 60 },
  abilityRevealSeconds: { min: 3, max: 10 },
  abilitySwapSeconds: { min: 5, max: 30 },
  absentRoundPoints: { min: 0, max: 100 },
  chatCooldownSeconds: { min: 1, max: 60 },
} as const;

function clampTimerValue(
  key: keyof LobbyTimerSettings,
  nextValue: number,
): number {
  const { min, max } = TIMER_LIMITS[key];
  return Math.max(min, Math.min(max, Math.floor(nextValue)));
}

function randomInt(minInclusive: number, maxInclusive: number): number {
  const min = Math.ceil(minInclusive);
  const max = Math.floor(maxInclusive);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function nextBlinkDelayMs(): number {
  return randomInt(BLINK_MIN_INTERVAL_MS, BLINK_MAX_INTERVAL_MS);
}

function nextBlinkClosedDurationMs(): number {
  return randomInt(BLINK_CLOSED_MIN_MS, BLINK_CLOSED_MAX_MS);
}

function resolveTimerSettingFromView(
  waitingView: WaitingView,
  key: keyof LobbyTimerSettings,
  currentValue: number,
): number {
  const rawValue = waitingView?.[key];
  const parsedValue = Number(rawValue);
  if (Number.isFinite(parsedValue)) {
    return clampTimerValue(key, parsedValue);
  }
  return currentValue;
}

function getAfkWarningLeadSeconds(afkTimeoutSeconds: number): number {
  if (afkTimeoutSeconds <= 300) {
    return 60;
  }
  if (afkTimeoutSeconds <= 600) {
    return 180;
  }
  return 300;
}

function normalizeValue(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function extractGameId(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  const directId = String(record.gameId ?? record.id ?? "").trim();
  if (directId) {
    return directId;
  }

  const nestedGame = record.game;
  if (!nestedGame || typeof nestedGame !== "object") {
    return "";
  }

  const nestedRecord = nestedGame as Record<string, unknown>;
  return String(nestedRecord.gameId ?? nestedRecord.id ?? "").trim();
}

function extractGameStatus(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  const directStatus = normalizeValue(record.status ?? record.gameStatus ?? record.phase);
  if (directStatus) {
    return directStatus;
  }

  const nestedGame = record.game;
  if (!nestedGame || typeof nestedGame !== "object") {
    return "";
  }

  const nestedRecord = nestedGame as Record<string, unknown>;
  return normalizeValue(nestedRecord.status ?? nestedRecord.gameStatus ?? nestedRecord.phase);
}

function canInvitePresence(presence: PresenceKey): boolean {
  return presence === "online" || presence === "lobby";
}

function countActiveInvites(sentEntries: Record<string, CaboSentInviteEntry>) {
  return Object.values(sentEntries).filter(
    (entry) => entry.status === "PENDING" || entry.status === "ACCEPTED",
  ).length;
}

function toLobbySlotStatus(
  joinStatus: string,
  isHostSlot: boolean,
  occupied: boolean,
): string {
  if (isHostSlot) {
    return "Host";
  }
  if (!occupied) {
    return "Open";
  }

  const normalized = normalizeValue(joinStatus);
  if (
    normalized === "joined" ||
    normalized === "you" ||
    normalized === "accepted"
  ) {
    return "Joined";
  }
  if (normalized === "pending" || normalized === "invited") {
    return "Invited";
  }
  if (!normalized) {
    return "Joined";
  }
  return normalized[0].toUpperCase() + normalized.slice(1);
}

function buildPublicLobbyPlayers(
  candidateUsers: User[],
  selfId: string,
  sentEntries: Record<string, CaboSentInviteEntry>,
  inviteLoadingById: Record<string, boolean>,
  joinedByUsername: Record<string, true>,
  selfIsHost: boolean,
): Player[] {
  const selfTrim = selfId.trim();
  const selfNumeric = selfTrim ? Number(selfTrim) : 0;
  const selfUser = candidateUsers.find(
    (user) => user.id != null && String(user.id) === selfTrim,
  );
  const selfLabel = selfUser?.username?.trim() || selfUser?.name?.trim() || "Player";
  const selfPresenceKey = toPresenceKey(selfUser?.status);

  const selfRow: Player = {
    id: selfNumeric,
    name: selfIsHost ? `${selfLabel} ${HOST_CROWN}` : selfLabel, // give host a crown
    invited: true,
    loading: false,
    presenceKey: selfPresenceKey,
    presenceLabel: toPresenceLabel(selfPresenceKey),
    isSelf: true,
  };

  if (!selfTrim) {
    return [selfRow];
  }

  const onlineById = new Map<number, User>();
  for (const user of candidateUsers) {
    if (user.id == null || String(user.id) === selfTrim) {
      continue;
    }
    const id = Number(user.id);
    if (Number.isFinite(id)) {
      onlineById.set(id, user);
    }
  }

  const activeInviteIds = Object.entries(sentEntries)
    .filter(([, entry]) => entry.status === "PENDING" || entry.status === "ACCEPTED")
    .map(([id]) => Number(id))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  const seen = new Set<number>();
  const invitedRows: Player[] = [];
  for (const id of activeInviteIds) {
    seen.add(id);

    const key = String(id);
    const user = onlineById.get(id);
    const inviteStatus = sentEntries[key]?.status;
    const serverInvited = inviteStatus === "PENDING" || inviteStatus === "ACCEPTED";
    const inviteRequestPending = inviteLoadingById[key] ?? false;

    const acceptedInvite = inviteStatus === "ACCEPTED";
    const usernameKey = normalizeValue(sentEntries[key]?.toUsername ?? user?.username);
    const joined = acceptedInvite && Boolean(usernameKey && joinedByUsername[usernameKey]);
    const loading = acceptedInvite && !joined;

    const name =
      sentEntries[key]?.toUsername?.trim() ||
      user?.username ||
      user?.name ||
      `User ${id}`;
    const rowPresenceKey = toPresenceKey(user?.status);

    invitedRows.push({
      id,
      name,
      invited: serverInvited || inviteRequestPending || loading,
      loading,
      presenceKey: rowPresenceKey,
      presenceLabel: toPresenceLabel(rowPresenceKey),
      joined,
    });
  }

  const otherOnlineRows: Player[] = [];
  for (const [id, user] of onlineById) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);

    const key = String(id);
    const inviteStatus = sentEntries[key]?.status;
    const serverInvited = inviteStatus === "PENDING" || inviteStatus === "ACCEPTED";
    const inviteRequestPending = inviteLoadingById[key] ?? false;

    const acceptedInvite = inviteStatus === "ACCEPTED";
    const usernameKey = normalizeValue(sentEntries[key]?.toUsername ?? user?.username);
    const joined = acceptedInvite && Boolean(usernameKey && joinedByUsername[usernameKey]);
    const loading = acceptedInvite && !joined;
    const rowPresenceKey = toPresenceKey(user?.status);

    otherOnlineRows.push({
      id,
      name: user.username ?? user.name ?? "User",
      invited: serverInvited || inviteRequestPending || loading,
      loading,
      presenceKey: rowPresenceKey,
      presenceLabel: toPresenceLabel(rowPresenceKey),
      joined,
    });
  }
  otherOnlineRows.sort((a, b) => a.id - b.id);

  return [selfRow, ...invitedRows, ...otherOnlineRows];
}

function WaitingLobbyContent() {
  const router = useRouter();
  const params = useParams<{ sessionId?: string }>();
  const searchParams = useSearchParams();

  const sessionIdFromPath = String(params?.sessionId ?? "").trim();
  const sessionIdFromQuery = String(searchParams.get("sessionId") ?? "").trim();
  const sessionIdParam = sessionIdFromPath || sessionIdFromQuery;

  const api = useApi();
  const { value: token } = useLocalStorage<string>("token", "");
  const { value: userId } = useLocalStorage<string>("userId", "");
  const normalizedUserId = String(userId).trim();
  const lobbyApiConnected = useApiConnectionStatus(normalizedUserId, token.trim());
  const { set: setActiveSessionId } = useLocalStorage<string>("activeSessionId", "");
  const { set: setActiveLobbySessionId } = useLocalStorage<string>("activeLobbySessionId", "");
  const { set: setPendingInitialPeekGameId } = useLocalStorage<string>("pendingInitialPeekGameId", "");
  const { set: setActiveGameStatusSnapshot } = useLocalStorage<ActiveGameStatusSnapshot | null>(
    "activeGameStatusSnapshot",
    null,
  );
  const { sentEntries, loadSent, markPending } = useOutgoingInviteStatuses(
    userId,
    token,
  );

  const [view, setView] = useState<WaitingView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  //Add a section in the Lobby view to display the names of users currently spectating.
  //  #49
  const [spectators, setSpectators] = useState<WaitingRow[]>([]);

  const [lobbyWsConnected, setLobbyWsConnected] = useState(false);
  const [userIsHost, setUserIsHost] = useState(false);
  const [isPublicLobby, setIsPublicLobby] = useState(false);
  const [moveHistoryPublic, setMoveHistoryPublic] = useState<boolean>(true);
  const [updatingMoveHistoryPublic, setUpdatingMoveHistoryPublic] = useState(false);

  const [inviteLoadingById, setInviteLoadingById] = useState<
    Record<string, boolean>
  >({});
  const [inviteUsersApi, setInviteUsersApi] = useState<User[]>([]);
  const [isInvitePanelOpen, setIsInvitePanelOpen] = useState(false);
  const [inviteSearch, setInviteSearch] = useState("");
  const debouncedInviteSearch = useDebouncedValue(inviteSearch, 1000);
  const [showFriendsOnlyInvites, setShowFriendsOnlyInvites] = useState(false);
  const [friendIds, setFriendIds] = useState<string[]>([]);
  const [lobbyTimerSettings, setLobbyTimerSettings] = useState<LobbyTimerSettings>(DEFAULT_LOBBY_TIMERS);
  const [updatingTimerKey, setUpdatingTimerKey] = useState<string>("");
  const [togglingReady, setTogglingReady] = useState(false);
  const [startingGame, setStartingGame] = useState(false);
  const [leavingLobby, setLeavingLobby] = useState(false);
  const [, setLaunchingGame] = useState(false);
  const [lobbyAfkRemainingSeconds, setLobbyAfkRemainingSeconds] = useState<number>(DEFAULT_LOBBY_TIMERS.afkTimeoutSeconds);
  const lastLobbyActivityMsRef = useRef<number>(Date.now());
  const timerSettingDebounceMs = 300;
  const timerSaveTimeoutsRef = useRef<Record<string, number>>({});
  const previousLobbyUsernamesRef = useRef<Set<string>>(new Set());
  const [avatarModeByUsername, setAvatarModeByUsername] = useState<Record<string, "idle" | "waving" | "thumbsup">>({});
  const [avatarFrameByUsername, setAvatarFrameByUsername] = useState<Record<string, number>>({});
  const [stableCharacterColorByUsername, setStableCharacterColorByUsername] = useState<Record<string, string>>({});
  const nextBlinkAtMsByUsernameRef = useRef<Record<string, number>>({});
  const blinkReturnAtMsByUsernameRef = useRef<Record<string, number>>({});
  const hasSeenReadyStateRef = useRef<boolean>(false);
  const previousLobbyReadyStateRef = useRef<boolean>(false);
  const lobbyAfkWarningLoopActiveRef = useRef<boolean>(false);

  const launchToGame = useCallback((rawGameId: unknown, rawStatus?: string, forceInitialPeekBootstrap = false) => {
    const gameId = String(rawGameId ?? "").trim();
    if (!gameId) {
      return;
    }
    const lobbySessionId = sessionIdParam.trim();
    const status = normalizeValue(rawStatus ?? "");
    setLaunchingGame((isAlreadyLaunching) => {
      if (isAlreadyLaunching) {
        return isAlreadyLaunching;
      }
      setActiveGameStatusSnapshot({ gameId, status: status || null });
      if (lobbySessionId) {
        setActiveLobbySessionId(lobbySessionId);
      }
      setActiveSessionId(gameId);
      if (status === "initial_peek" || forceInitialPeekBootstrap) {
        setPendingInitialPeekGameId(gameId);
      }
      router.push("/game");
      return true;
    });
  }, [
    router,
    sessionIdParam,
    setActiveGameStatusSnapshot,
    setActiveLobbySessionId,
    setActiveSessionId,
    setPendingInitialPeekGameId,
  ]);

  const tryLaunchFromActiveGameFallback = useCallback(async () => {
    const authToken = token.trim();
    if (!authToken) {
      return;
    }
    try {
      const activeGame = await api.getWithAuth<ActiveGameResponse>(
        "/games/active",
        authToken,
      );
      const activeGameId = extractGameId(activeGame);
      if (activeGameId) {
        launchToGame(activeGameId);
      }
    } catch {
      // ignore temporary lookup failures
    }
  }, [api, launchToGame, token]);

  useEffect(() => {
    const authToken = token.trim();
    const sessionId = sessionIdParam.trim();
    if (!authToken || !sessionId) {
      return;
    }

    void fetch(`${getApiDomain()}/heartbeat`, {
      method: "POST",
      headers: { Authorization: authToken },
    }).catch(() => {
      // ignore transient failures
    });
  }, [sessionIdParam, token]);

  useEffect(() => {
    const authToken = token.trim();
    const sessionId = sessionIdParam.trim();
    if (!authToken || !sessionId) {
      return;
    }

    const markLobbyActive = () => {
      lastLobbyActivityMsRef.current = Date.now();
    };
    const markLobbyActiveOnVisible = () => {
      if (document.visibilityState === "visible") {
        markLobbyActive();
      }
    };

    markLobbyActive();
    window.addEventListener("pointerdown", markLobbyActive, { passive: true });
    window.addEventListener("pointermove", markLobbyActive, { passive: true });
    window.addEventListener("keydown", markLobbyActive, { passive: true });
    window.addEventListener("wheel", markLobbyActive, { passive: true });
    window.addEventListener("touchstart", markLobbyActive, { passive: true });
    window.addEventListener("focus", markLobbyActive, { passive: true });
    document.addEventListener("visibilitychange", markLobbyActiveOnVisible);

    return () => {
      window.removeEventListener("pointerdown", markLobbyActive);
      window.removeEventListener("pointermove", markLobbyActive);
      window.removeEventListener("keydown", markLobbyActive);
      window.removeEventListener("wheel", markLobbyActive);
      window.removeEventListener("touchstart", markLobbyActive);
      window.removeEventListener("focus", markLobbyActive);
      document.removeEventListener("visibilitychange", markLobbyActiveOnVisible);
    };
  }, [sessionIdParam, token]);

  useEffect(() => {
    const authToken = token.trim();
    const sessionId = sessionIdParam.trim();
    if (!authToken || !sessionId) {
      return;
    }
    const tick = () => {
      const elapsedSeconds = Math.floor((Date.now() - lastLobbyActivityMsRef.current) / 1000);
      setLobbyAfkRemainingSeconds(Math.max(0, lobbyTimerSettings.afkTimeoutSeconds - elapsedSeconds));
    };

    tick();
    const intervalId = window.setInterval(tick, 1000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [lobbyTimerSettings.afkTimeoutSeconds, sessionIdParam, token]);

  useEffect(() => {
    const sessionId = sessionIdParam.trim();
    if (sessionId) {
      return;
    }

    const authToken = token.trim();
    if (!authToken) {
      setView(null);
      setError("Not logged in");
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    const bootstrapLobby = async () => {
      try {
        const existing = await api.getWithAuth<LobbySession>(
          "/lobbies/my/waiting",
          authToken,
        );
        const existingSessionId = String(existing.sessionId ?? "").trim();
        if (existingSessionId) {
          if (active) {
            router.replace(`/lobby/${encodeURIComponent(existingSessionId)}`);
          }
          return;
        }
      } catch {
        /* no waiting lobby yet */
      }

      if (normalizedUserId && typeof window !== "undefined") {
        try {
          const me = await api.getWithAuth<User>(
            `/users/${encodeURIComponent(normalizedUserId)}`,
            authToken,
          );
          const status = String(me?.status ?? "").trim().toUpperCase();
          if (status === "LOBBY") {
            const confirmed = window.confirm(
              "You are already in a lobby. Creating a new lobby will leave your current lobby. Continue?",
            );
            if (!confirmed) {
              if (active) {
                setLoading(false);
                setError("Lobby switch canceled.");
              }
              return;
            }
          }
        } catch {
          // If status lookup fails, continue with create flow.
        }
      }

      try {
        const created = await api.postWithAuth<LobbySession>(
          "/lobbies",
          { isPublic: false },
          authToken,
        );
        const createdSessionId = String(created.sessionId ?? "").trim();
        if (!createdSessionId) {
          throw new Error("Missing sessionId");
        }
        if (active) {
          router.replace(`/lobby/${encodeURIComponent(createdSessionId)}`);
        }
      } catch (error: unknown) {
        if (active) {
          const status = (error as ApplicationError)?.status;
          const message = error instanceof Error ? error.message : "";
          setView(null);
          if (status === 409 && message.includes("active lobby")) {
            setError("You already have an active lobby or game. Leave it first, then create a new one.");
          } else {
            setError("Could not open lobby.");
          }
          setLoading(false);
        }
      }
    };

    void bootstrapLobby();

    return () => {
      active = false;
    };
  }, [api, normalizedUserId, router, sessionIdParam, token]);

  useEffect(() => {
    const authToken = token.trim();
    const uid = normalizedUserId;
    if (!authToken || !uid) {
      return;
    }

    let active = true;
    const loadMoveHistoryVisibility = async () => {
      try {
        const me = await api.getWithAuth<User>(
          `/users/${encodeURIComponent(uid)}`,
          authToken,
        );
        if (!active) {
          return;
        }
        setMoveHistoryPublic(me?.isPublicLog !== false);
      } catch {
        if (active) {
          setMoveHistoryPublic(true);
        }
      }
    };

    void loadMoveHistoryVisibility();

    return () => {
      active = false;
    };
  }, [api, normalizedUserId, token]);

  const loadView = useCallback(async () => {
    const authToken = token.trim();
    const sessionId = sessionIdParam.trim();

    if (!authToken || !sessionId) {
      setView(null);
      setError(!sessionId ? "Missing session" : "Not logged in");
      setLoading(false);
      return;
    }

    setError(null);
    try {
      const waitingView = await api.getWithAuth<WaitingView>(
        `/lobbies/waiting/${encodeURIComponent(sessionId)}`,
        authToken,
      );
      setView(waitingView);
      // Add a section in the Lobby view to display the names of users currently spectating.
      // #49
      // # 116: TODO: Backend needs to include spectators in WaitingView response
      const rawSpectators = (waitingView as Record<string, unknown>)?.spectators;
      if (Array.isArray(rawSpectators)) {
        setSpectators(rawSpectators.map((spectator) => {
          const spectatorRecord = spectator as Record<string, unknown>;
          return {
            userId: Number(spectatorRecord?.userId ?? spectatorRecord?.id ?? 0) || undefined,
            username: String(spectatorRecord?.username ?? spectator ?? "").trim(),
            joinStatus: String(spectatorRecord?.joinStatus ?? "spectator"),
            profileCharacterId: String(spectatorRecord?.profileCharacterId ?? ""),
            characterColorId: String(spectatorRecord?.characterColorId ?? spectatorRecord?.primaryColorId ?? ""),
            ready: false,
          } as WaitingRow;
        }).filter((row) => row.username.length > 0));
      } else {
        setSpectators([]);
      }
      setIsPublicLobby(waitingView?.isPublic !== false);
      setUserIsHost(waitingView?.viewerIsHost === true);
      setLobbyTimerSettings((previous) => {
        const nextSettings: LobbyTimerSettings = {
          afkTimeoutSeconds: resolveTimerSettingFromView(
            waitingView,
            "afkTimeoutSeconds",
            previous.afkTimeoutSeconds,
          ),
          websocketGraceSeconds: resolveTimerSettingFromView(
            waitingView,
            "websocketGraceSeconds",
            previous.websocketGraceSeconds,
          ),
          initialPeekSeconds: resolveTimerSettingFromView(
            waitingView,
            "initialPeekSeconds",
            previous.initialPeekSeconds,
          ),
          turnSeconds: resolveTimerSettingFromView(
            waitingView,
            "turnSeconds",
            previous.turnSeconds,
          ),
          abilityRevealSeconds: resolveTimerSettingFromView(
            waitingView,
            "abilityRevealSeconds",
            previous.abilityRevealSeconds,
          ),
          abilitySwapSeconds: resolveTimerSettingFromView(
            waitingView,
            "abilitySwapSeconds",
            previous.abilitySwapSeconds,
          ),
          absentRoundPoints: resolveTimerSettingFromView(
            waitingView,
            "absentRoundPoints",
            previous.absentRoundPoints,
          ),
          chatCooldownSeconds: resolveTimerSettingFromView(
            waitingView,
            "chatCooldownSeconds",
            previous.chatCooldownSeconds,
          ),
        };

        const unchanged =
          nextSettings.afkTimeoutSeconds === previous.afkTimeoutSeconds &&
          nextSettings.websocketGraceSeconds === previous.websocketGraceSeconds &&
          nextSettings.initialPeekSeconds === previous.initialPeekSeconds &&
          nextSettings.turnSeconds === previous.turnSeconds &&
          nextSettings.abilityRevealSeconds === previous.abilityRevealSeconds &&
          nextSettings.abilitySwapSeconds === previous.abilitySwapSeconds &&
          nextSettings.absentRoundPoints === previous.absentRoundPoints &&
          nextSettings.chatCooldownSeconds === previous.chatCooldownSeconds;

        return unchanged ? previous : nextSettings;
      });
    } catch (error: unknown) {
      const status = (error as ApplicationError)?.status;
      if (status === 401 || status === 403 || status === 404) {
        router.replace("/dashboard?kicked=1");
        return;
      }
      setView(null);
      setError("Could not load waiting lobby.");
    } finally {
      setLoading(false);
    }
  }, [api, router, token, sessionIdParam]);

  useEffect(() => {
    if (!sessionIdParam.trim()) {
      return;
    }
    void loadView();
  }, [loadView, sessionIdParam]);

  useEffect(() => {
    const authToken = token.trim();
    const sessionId = sessionIdParam.trim();

    if (!authToken || !sessionId || typeof window === "undefined") {
      setLobbyWsConnected(false);
      return;
    }

    let stopped = false;
    let client: Client | null = null;

    setLobbyWsConnected(false);
    void loadView();
    void tryLaunchFromActiveGameFallback();

    const connectLobbyTopic = async () => {
      const { default: SockJS } = await import("sockjs-client");
      if (stopped) {
        return;
      }

      client = new Client({
        webSocketFactory: () => new SockJS(getStompBrokerUrl()),
        connectHeaders: { Authorization: authToken },
        reconnectDelay: 5000,
        onConnect: () => {
          setLobbyWsConnected(true);
          client?.subscribe(`/topic/lobby/session/${sessionId}`, () => {
            void loadView();
            void tryLaunchFromActiveGameFallback();
          });
          client?.subscribe("/user/queue/game-state", (message) => {
            try {
              const payload = JSON.parse(String(message.body ?? "{}")) as GameStateSignal;
              launchToGame(extractGameId(payload), extractGameStatus(payload));
            } catch {
              /* ignore malformed payload */
            }
          });
          void loadView();
          void tryLaunchFromActiveGameFallback();
        },
        onStompError: () => {
          setLobbyWsConnected(false);
        },
        onWebSocketClose: () => {
          setLobbyWsConnected(false);
        },
        onWebSocketError: () => {
          setLobbyWsConnected(false);
        },
      });

      client.activate();
    };

    void connectLobbyTopic();
    return () => {
      stopped = true;
      setLobbyWsConnected(false);
      if (client) {
        void client.deactivate();
      }
    };
  }, [token, sessionIdParam, loadView, launchToGame, tryLaunchFromActiveGameFallback]);

  useEffect(() => {
    const authToken = token.trim();
    const sessionId = sessionIdParam.trim();
    if (!authToken || !sessionId) {
      return;
    }

    const pollMs = lobbyWsConnected ? 5000 : 2500;
    const pollId = setInterval(() => {
      void loadView();
      void loadSent();
      void tryLaunchFromActiveGameFallback();
    }, pollMs);

    return () => {
      clearInterval(pollId);
    };
  }, [token, sessionIdParam, loadView, loadSent, lobbyWsConnected, tryLaunchFromActiveGameFallback]);

  useEffect(() => {
    const authToken = token.trim();
    if (!authToken) {
      setFriendIds([]);
      return;
    }

    let active = true;
    const loadFriendIds = async () => {
      try {
        const payload = await api.getWithAuth<Array<string | number>>(
          "/users/me/friends/ids",
          authToken,
        );
        if (!active) {
          return;
        }
        const normalized = (payload ?? [])
          .map((entry) => String(entry ?? "").trim())
          .filter((entry) => entry.length > 0);
        setFriendIds(normalized);
      } catch {
        if (active) {
          setFriendIds([]);
        }
      }
    };

    void loadFriendIds();
    return () => {
      active = false;
    };
  }, [api, token]);

  useEffect(() => {
    if (!userIsHost || !isInvitePanelOpen || typeof window === "undefined") {
      return;
    }

    let active = true;
    const refreshInviteUsers = async () => {
      try {
        const allUsers = await api.get<User[]>("/users");
        if (!active) {
          return;
        }
        setInviteUsersApi(
          allUsers.filter((user) => {
            const presence = toPresenceKey(user.status);
            return (
              presence === "online" ||
              presence === "lobby" ||
              presence === "playing" ||
              presence === "spectating"
            );
          }),
        );
      } catch {
        if (active) {
          setInviteUsersApi([]);
        }
      }
    };

    void refreshInviteUsers();
    const intervalId = window.setInterval(() => {
      void refreshInviteUsers();
    }, INVITE_USERS_POLL_MS);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [api, isInvitePanelOpen, userIsHost]);

  const waitingPlayers = useMemo(
    () =>
      (view?.players ?? [])
        .filter((player) => String(player.username ?? "").trim().length > 0)
        .map((player) => ({
          userId: Number(player.userId ?? 0) || undefined,
          username: String(player.username ?? "").trim(),
          joinStatus: String(player.joinStatus ?? ""),
          profileCharacterId: String(player.profileCharacterId ?? ""),
          characterColorId: String(player.characterColorId ?? ""),
          ready: Boolean(player.ready),
        }))
        .slice(0, MAX_LOBBY_PLAYERS),
    [view],
  );

  const joinedByUsername = useMemo(() => {
    const joinedUsers: Record<string, true> = {};

    for (const player of waitingPlayers) {
      const usernameKey = normalizeValue(player.username);
      const status = normalizeValue(player.joinStatus);
      if (!usernameKey) {
        continue;
      }
      if (status === "joined" || status === "you") {
        joinedUsers[usernameKey] = true;
      }
    }

    return joinedUsers;
  }, [waitingPlayers]);

  const usernamesAlreadyInLobby = useMemo(() => {
    const usernames = new Set<string>();
    for (const player of waitingPlayers) {
      const usernameKey = normalizeValue(player.username);
      if (usernameKey) {
        usernames.add(usernameKey);
      }
    }
    return usernames;
  }, [waitingPlayers]);

  const usersForInvite = useMemo(() => inviteUsersApi, [inviteUsersApi]);
  const friendIdSet = useMemo(() => new Set(friendIds), [friendIds]);

  const characterByUsername = useMemo(() => {
    const mapping: Record<string, string> = {};
    for (const player of waitingPlayers) {
      const usernameKey = normalizeValue(player.username);
      if (!usernameKey) {
        continue;
      }
      mapping[usernameKey] = String(player.profileCharacterId ?? "");
    }
    for (const spectator of spectators) {
      const usernameKey = normalizeValue(spectator.username);
      if (!usernameKey) {
        continue;
      }
      mapping[usernameKey] = String(spectator.profileCharacterId ?? "");
    }
    return mapping;
  }, [spectators, waitingPlayers]);

  const incomingCharacterColorByUsername = useMemo(() => {
    const mapping: Record<string, string> = {};
    for (const player of waitingPlayers) {
      const usernameKey = normalizeValue(player.username);
      if (!usernameKey) {
        continue;
      }
      const rawColorId = String(player.characterColorId ?? "").trim();
      if (rawColorId) {
        mapping[usernameKey] = rawColorId;
      }
    }
    for (const spectator of spectators) {
      const usernameKey = normalizeValue(spectator.username);
      if (!usernameKey) {
        continue;
      }
      const rawColorId = String(spectator.characterColorId ?? "").trim();
      if (rawColorId) {
        mapping[usernameKey] = rawColorId;
      }
    }
    return mapping;
  }, [spectators, waitingPlayers]);

  useEffect(() => {
    const presentUsernameKeys = new Set<string>();
    waitingPlayers.forEach((player) => {
      const usernameKey = normalizeValue(player.username);
      if (usernameKey) {
        presentUsernameKeys.add(usernameKey);
      }
    });
    spectators.forEach((spectator) => {
      const usernameKey = normalizeValue(spectator.username);
      if (usernameKey) {
        presentUsernameKeys.add(usernameKey);
      }
    });

    setStableCharacterColorByUsername((previous) => {
      const next: Record<string, string> = {};
      let changed = false;

      for (const usernameKey of presentUsernameKeys) {
        const previousColor = previous[usernameKey];
        const incomingColor = incomingCharacterColorByUsername[usernameKey];
        if (incomingColor) {
          const isWaving = avatarModeByUsername[usernameKey] === "waving";
          next[usernameKey] =
            previousColor && previousColor !== incomingColor && isWaving
              ? previousColor
              : incomingColor;
        } else if (previousColor) {
          next[usernameKey] = previousColor;
        }

        if (next[usernameKey] !== previousColor) {
          changed = true;
        }
      }

      if (!changed && Object.keys(previous).length !== Object.keys(next).length) {
        changed = true;
      }
      return changed ? next : previous;
    });
  }, [avatarModeByUsername, incomingCharacterColorByUsername, spectators, waitingPlayers]);

  const readyByUsernameFromLobby = useMemo(() => {
    const mapping: Record<string, boolean> = {};
    for (const player of waitingPlayers) {
      const usernameKey = normalizeValue(player.username);
      if (!usernameKey) {
        continue;
      }
      const isHost = normalizeValue(player.joinStatus) === "host";
      mapping[usernameKey] = isHost || Boolean(player.ready);
    }
    return mapping;
  }, [waitingPlayers]);

  useEffect(() => {
    const presentPlayers = waitingPlayers
      .map((player) => ({
        usernameKey: normalizeValue(player.username),
        isReady: normalizeValue(player.joinStatus) === "host" || Boolean(player.ready),
      }))
      .filter((entry) => entry.usernameKey.length > 0);
    const presentUsernameKeys = new Set(presentPlayers.map((entry) => entry.usernameKey));

    setAvatarModeByUsername((previousModes) => {
      const nextModes: Record<string, "idle" | "waving" | "thumbsup"> = {};
      for (const entry of presentPlayers) {
        const previousMode = previousModes[entry.usernameKey] ?? "idle";
        const isNewlyJoined = !previousLobbyUsernamesRef.current.has(entry.usernameKey);
        if (isNewlyJoined) {
          nextModes[entry.usernameKey] = "waving";
          continue;
        }
        if (previousMode === "waving") {
          nextModes[entry.usernameKey] = "waving";
          continue;
        }
        nextModes[entry.usernameKey] = entry.isReady ? "thumbsup" : "idle";
      }

      setAvatarFrameByUsername((previousFrames) => {
        const nextFrames: Record<string, number> = {};
        let changed = false;
        for (const [usernameKey, nextMode] of Object.entries(nextModes)) {
          const previousMode = previousModes[usernameKey];
          const previousFrame = previousFrames[usernameKey] ?? 1;
          if (nextMode !== previousMode) {
            nextFrames[usernameKey] = nextMode === "thumbsup" ? 1 : 1;
            changed = true;
            if (nextMode === "thumbsup") {
              nextBlinkAtMsByUsernameRef.current[usernameKey] = Date.now() + nextBlinkDelayMs();
            } else {
              delete nextBlinkAtMsByUsernameRef.current[usernameKey];
              delete blinkReturnAtMsByUsernameRef.current[usernameKey];
            }
            continue;
          }
          nextFrames[usernameKey] = previousFrame;
        }

        for (const previousKey of Object.keys(previousFrames)) {
          if (presentUsernameKeys.has(previousKey)) {
            continue;
          }
          changed = true;
          delete nextBlinkAtMsByUsernameRef.current[previousKey];
          delete blinkReturnAtMsByUsernameRef.current[previousKey];
        }

        return changed ? nextFrames : previousFrames;
      });

      previousLobbyUsernamesRef.current = presentUsernameKeys;
      return nextModes;
    });
  }, [waitingPlayers]);

  useEffect(() => {
    const tickIntervalMs = 180;
    const intervalId = window.setInterval(() => {
      const now = Date.now();
      const completedWaveUsernames: string[] = [];

      setAvatarFrameByUsername((previousFrames) => {
        const nextFrames = { ...previousFrames };
        let changed = false;

        for (const [usernameKey, mode] of Object.entries(avatarModeByUsername)) {
          const currentFrame = nextFrames[usernameKey] ?? 1;
          if (mode === "waving") {
            const maxFrame = getCharacterWavingFrameMax(characterByUsername[usernameKey]);
            if (currentFrame < maxFrame) {
              nextFrames[usernameKey] = currentFrame + 1;
              changed = true;
            } else {
              completedWaveUsernames.push(usernameKey);
            }
            continue;
          }

          if (mode === "thumbsup") {
            if (currentFrame < 3) {
              nextFrames[usernameKey] = currentFrame + 1;
              changed = true;
              if (nextFrames[usernameKey] === 3 && nextBlinkAtMsByUsernameRef.current[usernameKey] == null) {
                nextBlinkAtMsByUsernameRef.current[usernameKey] = now + nextBlinkDelayMs();
              }
              continue;
            }

            if (currentFrame === 9) {
              let blinkReturnAt = blinkReturnAtMsByUsernameRef.current[usernameKey];
              if (blinkReturnAt == null) {
                blinkReturnAt = now + nextBlinkClosedDurationMs();
                blinkReturnAtMsByUsernameRef.current[usernameKey] = blinkReturnAt;
              }
              if (now >= blinkReturnAt) {
                nextFrames[usernameKey] = 3;
                nextBlinkAtMsByUsernameRef.current[usernameKey] = now + nextBlinkDelayMs();
                delete blinkReturnAtMsByUsernameRef.current[usernameKey];
                changed = true;
              }
              continue;
            }

            const nextBlinkAt = nextBlinkAtMsByUsernameRef.current[usernameKey] ?? (now + nextBlinkDelayMs());
            nextBlinkAtMsByUsernameRef.current[usernameKey] = nextBlinkAt;
            if (now >= nextBlinkAt) {
              nextFrames[usernameKey] = 9;
              blinkReturnAtMsByUsernameRef.current[usernameKey] = now + nextBlinkClosedDurationMs();
              changed = true;
            }
            continue;
          }

          if (currentFrame !== 1) {
            nextFrames[usernameKey] = 1;
            changed = true;
          }
        }

        return changed ? nextFrames : previousFrames;
      });

      if (completedWaveUsernames.length > 0) {
        setAvatarModeByUsername((previousModes) => {
          const nextModes = { ...previousModes };
          for (const usernameKey of completedWaveUsernames) {
            nextModes[usernameKey] = readyByUsernameFromLobby[usernameKey] ? "thumbsup" : "idle";
          }
          return nextModes;
        });
      }
    }, tickIntervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [avatarModeByUsername, characterByUsername, readyByUsernameFromLobby]);

  const inviteRows = useMemo(
    () =>
      buildPublicLobbyPlayers(
        usersForInvite,
        userId,
        sentEntries,
        inviteLoadingById,
        joinedByUsername,
        userIsHost,
      ),
    [
      usersForInvite,
      userId,
      sentEntries,
      inviteLoadingById,
      joinedByUsername,
      userIsHost,
    ],
  );

  const filteredInviteRows = useMemo(() => {
    const query = normalizeValue(debouncedInviteSearch);
    return inviteRows
      .filter((player) => !player.isSelf)
      .filter((player) => !usernamesAlreadyInLobby.has(normalizeValue(player.name)))
      .filter((player) => !player.joined)
      .filter((player) => {
        if (!showFriendsOnlyInvites) {
          return true;
        }
        const id = String(player.id ?? "").trim();
        return id.length > 0 && friendIdSet.has(id);
      })
      .filter(
        (player) =>
          player.presenceKey !== "offline" &&
          player.presenceKey !== "playing",
      )
      .filter((player) => {
        if (!query) {
          return true;
        }
        return normalizeValue(player.name).includes(query);
      });
  }, [inviteRows, debouncedInviteSearch, usernamesAlreadyInLobby, showFriendsOnlyInvites, friendIdSet]);

  const activeInviteCount = countActiveInvites(sentEntries);

  const { lobbySlots, presentCount } = useMemo(() => {
    const explicitViewerIndex = waitingPlayers.findIndex(
      (player) => normalizeValue(player.joinStatus) === "you",
    );
    const viewerIndex =
      explicitViewerIndex >= 0
        ? explicitViewerIndex
        : userIsHost && waitingPlayers.length > 0
          ? 0
          : -1;

    const slots: LobbySlot[] = [];
    for (let index = 0; index < MAX_LOBBY_PLAYERS; index += 1) {
      const player = waitingPlayers[index];
      const isHost = index === 0;
      const occupied = Boolean(player);
      const fallbackLabel = isHost ? "Host" : "Open Slot";
      const label = player?.username?.trim() || fallbackLabel;
      const isOpenSlot = !occupied && !isHost;
      const usernameKey = occupied ? normalizeValue(player?.username) : "";
      const ready = occupied
        ? (isHost || Boolean(player?.ready))
        : false;

      slots.push({
        key: `slot-${index + 1}`,
        label,
        usernameKey,
        userId: player?.userId,
        status: toLobbySlotStatus(String(player?.joinStatus ?? ""), isHost, occupied),
        isViewer: index === viewerIndex,
        isHost,
        occupied,
        isOpenSlot,
        ready,
        profileCharacterId: player?.profileCharacterId,
        characterColorId: player?.characterColorId,
      });
    }

    return {
      lobbySlots: slots,
      presentCount: waitingPlayers.length,
    };
  }, [waitingPlayers, userIsHost]);

  const viewerLobbySlot = useMemo(
    () => lobbySlots.find((slot) => slot.isViewer && slot.occupied),
    [lobbySlots],
  );

  const viewerReadyKey = viewerLobbySlot?.usernameKey ?? "";
  const viewerIsReady = Boolean(viewerLobbySlot?.ready);
  const allNonHostPlayersReady = useMemo(
    () => lobbySlots
      .filter((slot) => slot.occupied && !slot.isHost)
      .every((slot) => slot.ready),
    [lobbySlots],
  );

  const sessionId = String(view?.sessionId ?? sessionIdParam ?? "").trim();
  const everyoneReadyForStart = presentCount >= 2 && allNonHostPlayersReady;
  const lobbyConnectionIsGreen = lobbyApiConnected;
  const lobbyAfkWarningLeadSeconds = getAfkWarningLeadSeconds(lobbyTimerSettings.afkTimeoutSeconds);
  const showLobbyAfkWarning =
    sessionId.length > 0 &&
    lobbyAfkRemainingSeconds <= lobbyAfkWarningLeadSeconds;

  useAttentionTitleBlink({
    enabled: showLobbyAfkWarning,
    alertTitle: "AFK WARNING - Return to lobby",
  });

  useEffect(() => {
    const sid = sessionId.trim();
    if (sid) {
      setActiveLobbySessionId(sid);
      setActiveSessionId(sid);
    }
  }, [sessionId, setActiveLobbySessionId, setActiveSessionId]);

  useEffect(() => {
    hasSeenReadyStateRef.current = false;
    previousLobbyReadyStateRef.current = false;
  }, [sessionId]);

  useEffect(() => {
    const readyNow = everyoneReadyForStart;
    if (!hasSeenReadyStateRef.current) {
      hasSeenReadyStateRef.current = true;
      previousLobbyReadyStateRef.current = readyNow;
      return;
    }
    if (!previousLobbyReadyStateRef.current && readyNow) {
      playSharedCaboSoundEffect("players_ready");
    }
    previousLobbyReadyStateRef.current = readyNow;
  }, [everyoneReadyForStart]);

  useEffect(() => {
    if (showLobbyAfkWarning) {
      if (!lobbyAfkWarningLoopActiveRef.current) {
        startSharedLoopedCaboSoundEffect("afk_warning");
        lobbyAfkWarningLoopActiveRef.current = true;
      }
    } else if (lobbyAfkWarningLoopActiveRef.current) {
      stopSharedLoopedCaboSoundEffect("afk_warning");
      lobbyAfkWarningLoopActiveRef.current = false;
    }
    return () => {
      if (lobbyAfkWarningLoopActiveRef.current) {
        stopSharedLoopedCaboSoundEffect("afk_warning");
        lobbyAfkWarningLoopActiveRef.current = false;
      }
    };
  }, [showLobbyAfkWarning]);

  const handleInvite = (id: number) => {
    if (!userIsHost) {
      return;
    }

    const authToken = token.trim();
    const uid = userId.trim();

    if (!authToken || !uid || !sessionId) {
      return;
    }

    const rowId = String(id);
    const label = inviteRows.find((player) => !player.isSelf && player.id === id)?.name;

    setInviteLoadingById((prev) => ({ ...prev, [rowId]: true }));

    void api
      .postWithAuth(
        `/users/${encodeURIComponent(uid)}/invites`,
        { toUserId: id },
        authToken,
      )
      .then(() => {
        markPending(id, label);
        setInviteLoadingById((prev) => ({ ...prev, [rowId]: false }));
        void loadSent();
      })
      .catch((error: unknown) => {
        const status = (error as ApplicationError)?.status;
        const message = error instanceof Error ? error.message : "";

        setInviteLoadingById((prev) => ({ ...prev, [rowId]: false }));

        if (status === 409 && message.includes("Pending invite already exists")) {
          markPending(id, label);
        }
        void loadSent();
      });
  };

  const handlePrivacyToggle = (makePrivate: boolean) => {
    if (!userIsHost) {
      return;
    }

    const authToken = token.trim();
    if (!authToken || !sessionId) {
      return;
    }

    const nextIsPublic = !makePrivate;
    const previousIsPublic = isPublicLobby;

    setIsPublicLobby(nextIsPublic);

    void api
      .patchWithAuth(
        `/lobbies/${encodeURIComponent(sessionId)}/settings`,
        { isPublic: nextIsPublic },
        authToken,
      )
      .catch(() => {
        setIsPublicLobby(previousIsPublic);
      });
  };

  const handleMoveHistoryVisibilityToggle = (makePublic: boolean) => {
    const authToken = token.trim();
    const uid = normalizedUserId;
    if (!authToken || !uid || updatingMoveHistoryPublic) {
      return;
    }

    const previous = moveHistoryPublic;
    setMoveHistoryPublic(makePublic);
    setUpdatingMoveHistoryPublic(true);

    void api.putWithAuth(
      `/users/${encodeURIComponent(uid)}`,
      { isPublicLog: makePublic },
      authToken,
    ).catch(() => {
      setMoveHistoryPublic(previous);
    }).finally(() => {
      setUpdatingMoveHistoryPublic(false);
    });
  };

  const handleViewerReadyToggle = () => {
    if (!viewerReadyKey || togglingReady) {
      return;
    }
    const authToken = token.trim();
    const sid = sessionId.trim();
    if (!authToken || !sid) {
      return;
    }
    setTogglingReady(true);
    void api.patchWithAuth(
      `/lobbies/${encodeURIComponent(sid)}/ready`,
      { ready: !viewerIsReady },
      authToken,
    ).then(() => {
      void loadView();
    }).catch(() => {
      // keep current UI state on failure
    }).finally(() => {
      setTogglingReady(false);
    });
  };

  const updateLobbyTimerSetting = async (
    key: keyof LobbyTimerSettings,
    value: number,
  ) => {
    if (!userIsHost) {
      return;
    }

    const authToken = token.trim();
    if (!authToken || !sessionId) {
      return;
    }

    const nextValue = clampTimerValue(key, value);
    const previousSettings = lobbyTimerSettings;
    const nextSettings = { ...previousSettings, [key]: nextValue };
    setLobbyTimerSettings(nextSettings);
    setUpdatingTimerKey(key);

    try {
      await api.patchWithAuth(
        `/lobbies/${encodeURIComponent(sessionId)}/settings`,
        { [key]: nextValue },
        authToken,
      );
    } catch {
      setLobbyTimerSettings(previousSettings);
    } finally {
      setUpdatingTimerKey("");
    }
  };

  const scheduleLobbyTimerSettingUpdate = (
    key: keyof LobbyTimerSettings,
    value: number,
  ) => {
    const timeoutKey = String(key);
    const existingTimeoutId = timerSaveTimeoutsRef.current[timeoutKey];
    if (existingTimeoutId != null) {
      window.clearTimeout(existingTimeoutId);
    }
    timerSaveTimeoutsRef.current[timeoutKey] = window.setTimeout(() => {
      void updateLobbyTimerSetting(key, value);
      delete timerSaveTimeoutsRef.current[timeoutKey];
    }, timerSettingDebounceMs);
  };

  useEffect(() => {
    return () => {
      Object.values(timerSaveTimeoutsRef.current).forEach((timeoutId) => window.clearTimeout(timeoutId));
      timerSaveTimeoutsRef.current = {};
    };
  }, []);

  const handleStartGame = async () => {
    if (!userIsHost || startingGame) {
      return;
    }

    const authToken = token.trim();
    const sid = sessionId.trim();
    if (!authToken || !sid) {
      return;
    }

    setStartingGame(true);
    try {
      const started = await api.postWithAuth<unknown>(
        `/lobbies/${encodeURIComponent(sid)}/start`,
        {},
        authToken,
      );
      const startedGameId = extractGameId(started);
      if (startedGameId) {
        launchToGame(startedGameId, extractGameStatus(started));
      }
    } catch (error: unknown) {
      const status = (error as ApplicationError)?.status;
      const rawMessage = error instanceof Error ? error.message : "";
      const message = rawMessage.toLowerCase();
      if (status === 409 || message.includes("not in waiting state")) {
        alert("Could not start game. Lobby is not ready.");
      } else if ((status === 400 && message.includes("player disconnected")) || message.includes("player disconnected")) {
        alert("Could not start game. A player appears disconnected. Ask everyone to reopen the lobby page.");
      } else if (status === 403 || message.includes("only the session host")) {
        alert("Could not start game. Only the host can start this lobby.");
      } else if (status === 404 || message.includes("session could not be found")) {
        alert("Could not start game. Lobby session was not found. Reopen the lobby from dashboard.");
      } else {
        const fallbackDetail = rawMessage.trim();
        alert(
          status
            ? `Could not start game (HTTP ${status}). ${fallbackDetail || "Please try again."}`
            : `Could not start game. ${fallbackDetail || "Please try again."}`,
        );
      }
    } finally {
      setStartingGame(false);
    }
  };

  const handleLeaveLobby = async () => {
    if (leavingLobby) {
      return;
    }

    const authToken = token.trim();
    const uid = userId.trim();
    const sid = sessionId.trim();
    if (!authToken || !uid || !sid) {
      return;
    }

    if (typeof window !== "undefined") {
      const confirmed = window.confirm("Leave this lobby and return to dashboard?");
      if (!confirmed) {
        return;
      }
    }

    setLeavingLobby(true);
    try {
      await api.deleteWithAuth(
        `/lobbies/${encodeURIComponent(sid)}/players/${uid}`,
        authToken,
      );
      router.push("/dashboard");
    } catch (error: unknown) {
      const status = (error as ApplicationError)?.status;
      const detail = error instanceof Error ? error.message.trim() : "";
      alert(
        status
          ? `Could not leave lobby (HTTP ${status}). ${detail || "Please try again."}`
          : `Could not leave lobby. ${detail || "Please try again."}`,
      );
    } finally {
      setLeavingLobby(false);
    }
  };

  if (loading && !view) {
    return (
      <div className="cabo-background">
        <div className="login-container waiting-lobby-loading">
          <Spin size="large" />
        </div>
      </div>
    );
  }

  if (error && !view) {
    return (
      <div className="cabo-background">
        <div className="login-container">
          <Card className="dashboard-container">
            <Typography.Paragraph>{error}</Typography.Paragraph>
            <Link href="/dashboard">Back to dashboard</Link>
          </Card>
        </div>
      </div>
    );
  }

  // fun times below
  return (
    <div className="cabo-background">
      <div className="login-container">
        <div className="create-lobby-stack">
          <Card
            title={
              <div className="lobby-header-row">
                <span className="lobby-header-title-wrap">
                  <span
                    className={`lobby-header-mode ${isPublicLobby ? "lobby-header-mode-open" : "lobby-header-mode-private"}`}
                  >
                    {isPublicLobby ? "Open" : "Private"}
                  </span>
                  <span className="lobby-header-title">Lobby</span>
                </span>
                <span
                  className={`lobby-connection-symbol ${lobbyConnectionIsGreen ? "connected" : "disconnected"}`}
                  title={lobbyConnectionIsGreen ? "Connected" : "Disconnected"}
                >
                  <span className="connection-symbol-dot" aria-hidden="true">{"\u25CF"}</span>
                </span>
              </div>
            }
            className="dashboard-container lobby-title-card"
          >
            <div className="lobby-intro-copy">
              <span>Welcome to Lobby {sessionId || "----"}.</span>
              {userIsHost ? <span>As the host you can invite up to 3 players.</span> : null}
              {/*host vs other players see diff things*/}
            </div>
            {showLobbyAfkWarning ? (
              <div className="lobby-afk-warning-banner" role="status" aria-live="polite">
                <span>AFK timeout in </span>
                <strong>{lobbyAfkRemainingSeconds}s</strong>
                <span>. Interact with this tab to stay in lobby.</span>
              </div>
            ) : null}
          </Card>

          {userIsHost ? ( // host vs other players see diff things
            <Card
              title={
                <div className="lobby-section-title-row">
                  <span className="lobby-section-title">Invite</span>
                </div>
              }
              className="dashboard-container"
            >
              <Collapse
                className="lobby-invite-collapse"
                onChange={(keys) => {
                  const openKeys = Array.isArray(keys) ? keys : [keys];
                  setIsInvitePanelOpen(openKeys.includes(INVITE_PANEL_KEY));
                }}
                items={[
                  {
                    key: INVITE_PANEL_KEY,
                    label: "Invite Online Players",
                    children: (
                      <List
                        header={
                          <div className="lobby-invite-toolbar">
                            <Input
                              className="lobby-invite-search"
                              placeholder="Search Players by Username"
                              value={inviteSearch}
                              allowClear
                              onChange={(event) => setInviteSearch(event.target.value)}
                            />
                            <Checkbox
                              className="users-overview-filter-toggle"
                              checked={showFriendsOnlyInvites}
                              onChange={(event) => setShowFriendsOnlyInvites(event.target.checked)}
                            >
                              Show Friends Only
                            </Checkbox>
                          </div>
                        }
                        dataSource={filteredInviteRows}
                        locale={{
                          emptyText: inviteSearch.trim()
                            ? "No players match your search"
                            : "No players available",
                        }}
                        rowKey={(player) => String(player.id)}
                        renderItem={(player) => (
                          <List.Item className="create-lobby-player-row">
                            <div className="lobby-slot-label">
                              <span>{player.name}</span>
                              {player.loading ? (
                                <Spin size="small" className="create-lobby-spin" />
                              ) : null}
                            </div>
                            <span
                              className={`users-status-pill users-status-${player.presenceKey} lobby-invite-status-pill`}
                            >
                              {player.presenceLabel}
                            </span>
                            <Button
                              className={`create-lobby-player-action${player.joined ? " lobby-invite-joined-btn" : ""}`}
                              type={player.invited || player.joined ? "default" : "primary"}
                              disabled={
                                player.invited ||
                                !token.trim() ||
                                !sessionId ||
                                (!player.invited &&
                                  !player.joined &&
                                  !canInvitePresence(player.presenceKey)) ||
                                (!player.invited &&
                                  activeInviteCount >= MAX_ACTIVE_INVITES)
                              }
                              onClick={() => handleInvite(player.id)}
                            >
                              {player.joined
                                ? "Joined"
                                : player.invited
                                  ? "Invited"
                                  : "Invite"}
                            </Button>
                          </List.Item>
                        )}
                      />
                    ),
                  },
                ]}
              />
            </Card>
          ) : null}

          <Card
            title={
              <div className="lobby-section-title-row">
                <span className="lobby-section-title">Players</span>
                <span className="lobby-section-meta">{presentCount}/4</span>
              </div>
            }
            className="dashboard-container lobby-players-card"
          >
            <List
              className="lobby-players-list"
              dataSource={lobbySlots}
              rowKey={(slot) => slot.key}
              renderItem={(slot) => (
                <List.Item
                  className={`lobby-slot-row lobby-slot-highlight-row${slot.isViewer ? " lobby-slot-highlight-row-active" : ""}${slot.isOpenSlot ? " lobby-slot-row-open" : ""}`}
                >
                  <div className="lobby-slot-label">
                    {slot.occupied ? (
                      <span className="lobby-slot-avatar-wrap" aria-hidden="true">
                        {(() => {
                          const avatarMode = avatarModeByUsername[slot.usernameKey] ?? (slot.ready ? "thumbsup" : "idle");
                          const avatarFrame = avatarFrameByUsername[slot.usernameKey] ?? 1;
                          const avatarVariant =
                            avatarMode === "waving"
                              ? "waving"
                              : avatarMode === "thumbsup"
                                ? "thumbsup"
                                : "profile";
                          return (
                        <CharacterAvatar
                          characterId={slot.profileCharacterId || characterByUsername[slot.usernameKey]}
                          primaryColorId={
                            stableCharacterColorByUsername[slot.usernameKey] ||
                            slot.characterColorId
                          }
                          variant={avatarVariant}
                          frame={avatarFrame}
                          alt=""
                          width={56}
                          height={56}
                          className="lobby-slot-avatar"
                        />
                          );
                        })()}
                      </span>
                    ) : null}
                    <span className={slot.isOpenSlot ? "lobby-open-slot-text" : ""}>
                      {slot.label}
                    </span>
                  </div>
                  <span
                    className={`lobby-slot-status-pill lobby-slot-status-btn${slot.status === "Host" ? " lobby-slot-status-host" : ""}${slot.status === "Joined" ? " lobby-slot-status-joined" : ""}${slot.status === "Open" ? " lobby-slot-status-open" : ""}`}
                  >
                    {slot.status === "Host" ? `Host ${HOST_CROWN}` : slot.status}
                  </span>
                  <div className="lobby-slot-actions">
                    {userIsHost && slot.occupied && !slot.isHost ? ( // only host can kick in this lobby type
                      <Popconfirm
                        title={`Do you really want to kick ${slot.label}?`}
                        okText="YES, KICK HIM"
                        cancelText="NO"
                        arrow={false}
                        overlayStyle={{ background: "transparent" }}
                        overlayInnerStyle={{
                          background: "rgba(58, 58, 58, 0.96)",
                          border: "1px solid rgba(0, 0, 0, 0.5)",
                          boxShadow: "0 10px 24px rgba(0, 0, 0, 0.45)",
                          padding: "14px 16px",
                        }}
                        okButtonProps={{ danger: true, type: "primary" }}
                        cancelButtonProps={{ type: "default" }}
                        overlayClassName="lobby-kick-confirm"
                        onConfirm={() => {
                          const authToken = token.trim();
                          if (!authToken || !sessionId) return;
                          const playerToKickId = slot.userId;
                          if (!playerToKickId) return;
                          void api.deleteWithAuth(
                          `/lobbies/${encodeURIComponent(sessionId)}/players/${playerToKickId}`,
                          authToken,
                          ).then(() => void loadView());
                        }}
                      >
                        <Button
                          className="lobby-kick-btn lobby-kick-btn-host"
                          title={`Kick ${slot.label}`}
                        >
                          <span className="lobby-kick-icon">{KICK_ICON}</span>
                        </Button>
                      </Popconfirm>
                    ) : null}
                  </div>
                </List.Item>
              )}
            />
          </Card>
          {/* Add a section in the Lobby view to display the names of users currently spectating.#49 */}
          {spectators.length > 0 && (
              <Card
                  title={
                      <div className="lobby-section-title-row">
                          <span className="lobby-section-title">👁️ Spectators</span>
                          <span className="lobby-section-meta">{spectators.length}</span>
                      </div>
                  }
                  className="dashboard-container"
              >
                  <List
                      className="lobby-players-list"
                      dataSource={spectators}
                      rowKey={(spectator) => String(spectator.userId ?? spectator.username)}
                      renderItem={(spectator) => (
                          <List.Item className="lobby-slot-row lobby-slot-highlight-row">
                              <div className="lobby-slot-label">
                                  <span className="lobby-slot-avatar-wrap" aria-hidden="true">
                                      <CharacterAvatar
                                          characterId={spectator.profileCharacterId || characterByUsername[normalizeValue(spectator.username)]}
                                          primaryColorId={
                                            stableCharacterColorByUsername[normalizeValue(spectator.username)] ||
                                            spectator.characterColorId
                                          }
                                          alt=""
                                          width={56}
                                          height={56}
                                          className="lobby-slot-avatar"
                                      />
                                  </span>
                                  <span>{spectator.username}</span>
                              </div>
                              <span className="lobby-slot-status-pill lobby-slot-status-open">
                                  Spectating
                              </span>
                          </List.Item>
                      )}
                  />
              </Card>
	          )}

	          <Card
	            title={
	              <div className="lobby-section-title-row">
	                <span className="lobby-section-title">Chat</span>
	              </div>
	            }
	            className="dashboard-container"
	          >
	            <div className="create-lobby-actions lobby-chat-panel-wrap">
	              <CaboChatPanel
	                sessionId={sessionId}
	                token={token}
	                userId={userId}
	                cooldownSeconds={lobbyTimerSettings.chatCooldownSeconds}
	                variant="lobby"
	              />
	            </div>
	          </Card>

	          {userIsHost ? ( //host vs other players see diff things
	            <Card
              title={
                <div className="lobby-section-title-row">
                  <span className="lobby-section-title">Settings</span>
                </div>
              }
              className="dashboard-container"
            >
              <div className="create-lobby-actions">
                <div className="lobby-settings-list">
                  <div className="lobby-setting-row lobby-setting-row-toggle">
                    <span className="lobby-setting-row-label">Invite only</span>
                    <div className="lobby-setting-row-control lobby-setting-row-control-toggle">
                      <Switch
                        className="lobby-private-switch"
                        checked={!isPublicLobby}
                        onChange={handlePrivacyToggle}
                        checkedChildren="Yes"
                        unCheckedChildren="No"
                      />
                    </div>
                  </div>
                  <div className="lobby-setting-row lobby-setting-row-toggle">
                    <span className="lobby-setting-row-label">Share Move History</span>
                    <div className="lobby-setting-row-control lobby-setting-row-control-toggle">
                      <Switch
                        className="lobby-private-switch"
                        checked={moveHistoryPublic}
                        loading={updatingMoveHistoryPublic}
                        onChange={handleMoveHistoryVisibilityToggle}
                        checkedChildren="Yes"
                        unCheckedChildren="No"
                      />
                    </div>
                  </div>
                  <div className="lobby-setting-row">
                    <span className="lobby-setting-row-label">Game AFK/DC Timeout (sec)</span>
                    <div className="lobby-setting-row-control">
                      <Slider
                        min={TIMER_LIMITS.afkTimeoutSeconds.min}
                        max={TIMER_LIMITS.afkTimeoutSeconds.max}
                        step={30}
                        marks={{
                          [TIMER_LIMITS.afkTimeoutSeconds.min]: String(TIMER_LIMITS.afkTimeoutSeconds.min),
                          300: "300",
                          [TIMER_LIMITS.afkTimeoutSeconds.max]: String(TIMER_LIMITS.afkTimeoutSeconds.max),
                        }}
                        value={lobbyTimerSettings.afkTimeoutSeconds}
                        disabled={updatingTimerKey === "afkTimeoutSeconds"}
                        onChange={(nextValue) => {
                          const numeric = Array.isArray(nextValue) ? nextValue[0] : nextValue;
                          const clamped = clampTimerValue("afkTimeoutSeconds", Number(numeric));
                          setLobbyTimerSettings((prev) => ({
                            ...prev,
                            afkTimeoutSeconds: clamped,
                          }));
                          scheduleLobbyTimerSettingUpdate("afkTimeoutSeconds", clamped);
                        }}
                      />
                      <span className="lobby-setting-row-value">{lobbyTimerSettings.afkTimeoutSeconds}s</span>
                    </div>
                  </div>
                  <div className="lobby-setting-row">
                    <span className="lobby-setting-row-label">Lobby Disconnect Grace (sec)</span>
                    <div className="lobby-setting-row-control">
                      <Slider
                        min={TIMER_LIMITS.websocketGraceSeconds.min}
                        max={TIMER_LIMITS.websocketGraceSeconds.max}
                        step={30}
                        marks={{
                          [TIMER_LIMITS.websocketGraceSeconds.min]: String(TIMER_LIMITS.websocketGraceSeconds.min),
                          300: "300",
                          [TIMER_LIMITS.websocketGraceSeconds.max]: String(TIMER_LIMITS.websocketGraceSeconds.max),
                        }}
                        value={lobbyTimerSettings.websocketGraceSeconds}
                        disabled={updatingTimerKey === "websocketGraceSeconds"}
                        onChange={(nextValue) => {
                          const numeric = Array.isArray(nextValue) ? nextValue[0] : nextValue;
                          const clamped = clampTimerValue("websocketGraceSeconds", Number(numeric));
                          setLobbyTimerSettings((prev) => ({
                            ...prev,
                            websocketGraceSeconds: clamped,
                          }));
                          scheduleLobbyTimerSettingUpdate("websocketGraceSeconds", clamped);
                        }}
                      />
                      <span className="lobby-setting-row-value">{lobbyTimerSettings.websocketGraceSeconds}s</span>
                    </div>
                  </div>
                  <div className="lobby-setting-row">
                    <span className="lobby-setting-row-label">Initial Peek (sec)</span>
                    <div className="lobby-setting-row-control">
                      <Slider
                        min={TIMER_LIMITS.initialPeekSeconds.min}
                        max={TIMER_LIMITS.initialPeekSeconds.max}
                        step={1}
                        marks={{
                          [TIMER_LIMITS.initialPeekSeconds.min]: String(TIMER_LIMITS.initialPeekSeconds.min),
                          10: "10",
                          30: "30",
                          [TIMER_LIMITS.initialPeekSeconds.max]: String(TIMER_LIMITS.initialPeekSeconds.max),
                        }}
                        value={lobbyTimerSettings.initialPeekSeconds}
                        disabled={updatingTimerKey === "initialPeekSeconds"}
                        onChange={(nextValue) => {
                          const numeric = Array.isArray(nextValue) ? nextValue[0] : nextValue;
                          const clamped = clampTimerValue("initialPeekSeconds", Number(numeric));
                          setLobbyTimerSettings((prev) => ({
                            ...prev,
                            initialPeekSeconds: clamped,
                          }));
                          scheduleLobbyTimerSettingUpdate("initialPeekSeconds", clamped);
                        }}
                      />
                      <span className="lobby-setting-row-value">{lobbyTimerSettings.initialPeekSeconds}s</span>
                    </div>
                  </div>
                  <div className="lobby-setting-row">
                    <span className="lobby-setting-row-label">Turn Timer (sec)</span>
                    <div className="lobby-setting-row-control">
                      <Slider
                        min={TIMER_LIMITS.turnSeconds.min}
                        max={TIMER_LIMITS.turnSeconds.max}
                        step={1}
                        marks={{
                          [TIMER_LIMITS.turnSeconds.min]: String(TIMER_LIMITS.turnSeconds.min),
                          30: "30",
                          [TIMER_LIMITS.turnSeconds.max]: String(TIMER_LIMITS.turnSeconds.max),
                        }}
                        value={lobbyTimerSettings.turnSeconds}
                        disabled={updatingTimerKey === "turnSeconds"}
                        onChange={(nextValue) => {
                          const numeric = Array.isArray(nextValue) ? nextValue[0] : nextValue;
                          const clamped = clampTimerValue("turnSeconds", Number(numeric));
                          setLobbyTimerSettings((prev) => ({
                            ...prev,
                            turnSeconds: clamped,
                          }));
                          scheduleLobbyTimerSettingUpdate("turnSeconds", clamped);
                        }}
                      />
                      <span className="lobby-setting-row-value">{lobbyTimerSettings.turnSeconds}s</span>
                    </div>
                  </div>
                  <div className="lobby-setting-row">
                    <span className="lobby-setting-row-label">Peek/Spy Reveal (sec)</span>
                    <div className="lobby-setting-row-control">
                      <Slider
                        min={TIMER_LIMITS.abilityRevealSeconds.min}
                        max={TIMER_LIMITS.abilityRevealSeconds.max}
                        step={1}
                        marks={{
                          [TIMER_LIMITS.abilityRevealSeconds.min]: String(TIMER_LIMITS.abilityRevealSeconds.min),
                          5: "5",
                          [TIMER_LIMITS.abilityRevealSeconds.max]: String(TIMER_LIMITS.abilityRevealSeconds.max),
                        }}
                        value={lobbyTimerSettings.abilityRevealSeconds}
                        disabled={updatingTimerKey === "abilityRevealSeconds"}
                        onChange={(nextValue) => {
                          const numeric = Array.isArray(nextValue) ? nextValue[0] : nextValue;
                          const clamped = clampTimerValue("abilityRevealSeconds", Number(numeric));
                          setLobbyTimerSettings((prev) => ({
                            ...prev,
                            abilityRevealSeconds: clamped,
                          }));
                          scheduleLobbyTimerSettingUpdate("abilityRevealSeconds", clamped);
                        }}
                      />
                      <span className="lobby-setting-row-value">{lobbyTimerSettings.abilityRevealSeconds}s</span>
                    </div>
                  </div>
                  <div className="lobby-setting-row">
                    <span className="lobby-setting-row-label">Swap Ability (sec)</span>
                    <div className="lobby-setting-row-control">
                      <Slider
                        min={TIMER_LIMITS.abilitySwapSeconds.min}
                        max={TIMER_LIMITS.abilitySwapSeconds.max}
                        step={1}
                        marks={{
                          [TIMER_LIMITS.abilitySwapSeconds.min]: String(TIMER_LIMITS.abilitySwapSeconds.min),
                          10: "10",
                          20: "20",
                          [TIMER_LIMITS.abilitySwapSeconds.max]: String(TIMER_LIMITS.abilitySwapSeconds.max),
                        }}
                        value={lobbyTimerSettings.abilitySwapSeconds}
                        disabled={updatingTimerKey === "abilitySwapSeconds"}
                        onChange={(nextValue) => {
                          const numeric = Array.isArray(nextValue) ? nextValue[0] : nextValue;
                          const clamped = clampTimerValue("abilitySwapSeconds", Number(numeric));
                          setLobbyTimerSettings((prev) => ({
                            ...prev,
                            abilitySwapSeconds: clamped,
                          }));
                          scheduleLobbyTimerSettingUpdate("abilitySwapSeconds", clamped);
                        }}
                      />
                      <span className="lobby-setting-row-value">{lobbyTimerSettings.abilitySwapSeconds}s</span>
                    </div>
                  </div>
                  <div className="lobby-setting-row">
                    <span className="lobby-setting-row-label">Absent Round Score (pts)</span>
                    <div className="lobby-setting-row-control">
                      <Slider
                        min={TIMER_LIMITS.absentRoundPoints.min}
                        max={TIMER_LIMITS.absentRoundPoints.max}
                        step={1}
                        marks={{
                          [TIMER_LIMITS.absentRoundPoints.min]: String(TIMER_LIMITS.absentRoundPoints.min),
                          20: "20",
                          50: "50",
                          [TIMER_LIMITS.absentRoundPoints.max]: String(TIMER_LIMITS.absentRoundPoints.max),
                        }}
                        value={lobbyTimerSettings.absentRoundPoints}
                        disabled={updatingTimerKey === "absentRoundPoints"}
                        onChange={(nextValue) => {
                          const numeric = Array.isArray(nextValue) ? nextValue[0] : nextValue;
                          const clamped = clampTimerValue("absentRoundPoints", Number(numeric));
                          setLobbyTimerSettings((prev) => ({
                            ...prev,
                            absentRoundPoints: clamped,
                          }));
                          scheduleLobbyTimerSettingUpdate("absentRoundPoints", clamped);
                        }}
                      />
                      <span className="lobby-setting-row-value">{lobbyTimerSettings.absentRoundPoints}</span>
                    </div>
                  </div>
                  <div className="lobby-setting-row">
                    <span className="lobby-setting-row-label">Chat Cooldown (sec)</span>
                    <div className="lobby-setting-row-control">
                      <Slider
                        min={TIMER_LIMITS.chatCooldownSeconds.min}
                        max={TIMER_LIMITS.chatCooldownSeconds.max}
                        step={1}
                        marks={{
                          [TIMER_LIMITS.chatCooldownSeconds.min]: String(TIMER_LIMITS.chatCooldownSeconds.min),
                          3: "3",
                          10: "10",
                          [TIMER_LIMITS.chatCooldownSeconds.max]: String(TIMER_LIMITS.chatCooldownSeconds.max),
                        }}
                        value={lobbyTimerSettings.chatCooldownSeconds}
                        disabled={updatingTimerKey === "chatCooldownSeconds"}
                        onChange={(nextValue) => {
                          const numeric = Array.isArray(nextValue) ? nextValue[0] : nextValue;
                          const clamped = clampTimerValue("chatCooldownSeconds", Number(numeric));
                          setLobbyTimerSettings((prev) => ({
                            ...prev,
                            chatCooldownSeconds: clamped,
                          }));
                          scheduleLobbyTimerSettingUpdate("chatCooldownSeconds", clamped);
                        }}
                      />
                      <span className="lobby-setting-row-value">{lobbyTimerSettings.chatCooldownSeconds}s</span>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          ) : null}

          {!userIsHost ? (
            <Card
              title={
                <div className="lobby-section-title-row">
                  <span className="lobby-section-title">Settings</span>
                </div>
              }
              className="dashboard-container"
            >
              <div className="create-lobby-actions">
                <div className="lobby-settings-list">
                  <div className="lobby-setting-row lobby-setting-row-toggle">
                    <span className="lobby-setting-row-label">Share Move History</span>
                    <div className="lobby-setting-row-control lobby-setting-row-control-toggle">
                      <Switch
                        className="lobby-private-switch"
                        checked={moveHistoryPublic}
                        loading={updatingMoveHistoryPublic}
                        onChange={handleMoveHistoryVisibilityToggle}
                        checkedChildren="Yes"
                        unCheckedChildren="No"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          ) : null}

          <Card className="dashboard-container">
            <div className="create-lobby-actions">
              {userIsHost ? ( //host vs other players see diff things
                <Button
                  type="primary"
                  className="create-lobby-start-game-btn"
                  disabled={presentCount < 2 || !allNonHostPlayersReady || startingGame}
                  loading={startingGame}
                  onClick={() => void handleStartGame()}
                >
                  Start Game
                </Button>
              ) : (
                <Button
                  type="default"
                  className={`create-lobby-start-game-btn lobby-viewer-ready-main-btn${!viewerReadyKey ? " lobby-viewer-ready-main-btn-not-ready" : viewerIsReady ? " lobby-viewer-ready-main-btn-no-longer-ready" : " lobby-viewer-ready-main-btn-ready-up"}`}
                  disabled={!viewerReadyKey || togglingReady}
                  loading={togglingReady}
                  onClick={handleViewerReadyToggle}
                >
                  {!viewerReadyKey
                    ? "Not Ready"
                    : viewerIsReady
                      ? "No Longer Ready"
                      : "Ready Up"}
                </Button>
              )}
              <Button
                type="primary"
                className="lobby-leave-btn"
                disabled={leavingLobby}
                loading={leavingLobby}
                onClick={() => void handleLeaveLobby()}
              >
                Leave Lobby
              </Button>
            </div>
          </Card>

          <Card className="dashboard-container dashboard-music-card">
            <InlineMusicPlayer className="dashboard-inline-music-player" />
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function WaitingLobbyPage() {
  return (
    <Suspense
      fallback={
        <div className="cabo-background">
          <div className="login-container waiting-lobby-loading">
            <Spin size="large" />
          </div>
        </div>
      }
    >
      <WaitingLobbyContent />
    </Suspense>
  );
}
