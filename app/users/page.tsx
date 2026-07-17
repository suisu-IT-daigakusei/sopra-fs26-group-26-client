// this code is part of S2 to display a list of all registered users
// clicking on a user in this list will display /app/users/[id]/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useApi } from "@/hooks/useApi";
import {
  getUsersPage,
  UserListDirection,
  UserListSort,
  UserPageResponse,
} from "@/api/userDirectory";
import { useApiConnectionStatus } from "@/hooks/useApiConnectionStatus";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import useLocalStorage from "@/hooks/useLocalStorage";
import InlineMusicPlayer from "@/components/InlineMusicPlayer";
import { User } from "@/types/user";
import { PresenceKey, toPresenceKey, toPresenceLabel } from "@/utils/presence";
import { showTimedConfirmation } from "@/utils/timedConfirmation";
import { LoadingOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Checkbox, Input, Table } from "antd";
import type { TableProps } from "antd";

type UserRow = User & {
  key: string;
  roundsPlayed: number | null;
  roundsWonValue: number;
  roundsWonRatePct: number | null;
  gamesPlayed: number | null;
  gamesWonValue: number;
  gamesWonRatePct: number | null;
  averageScore: number | null;
  overallRankValue: number | null;
  presenceLabel: string;
  presenceKey: PresenceKey;
  canAddFriend: boolean;
  canRemoveFriend: boolean;
  friendButtonLoading: boolean;
  onAddFriend: (() => void) | null;
  onRemoveFriend: (() => void) | null;
  canStatusAction: boolean;
  statusActionTitle: string;
  onStatusAction: (() => void) | null;
};

const USERS_PAGE_SIZE = 10;
const FRIEND_ACTION_MIN_LOADING_MS = 800;
const FRIEND_REQUEST_STATUS_POLL_MS = 12000;

function emptyUserPage(page: number): UserPageResponse {
  return {
    items: [],
    page,
    size: USERS_PAGE_SIZE,
    totalElements: 0,
    totalPages: 0,
    hasNext: false,
  };
}

function toServerSort(columnKey: unknown): UserListSort | null {
  switch (String(columnKey ?? "")) {
    case "username":
      return "username";
    case "roundsPlayed":
      return "roundsPlayed";
    case "averageScore":
      return "averageScore";
    case "roundsWonRatePct":
      return "roundWinRate";
    case "gamesWonRatePct":
      return "gamesWinRate";
    case "status":
      return "status";
    case "overallRankValue":
      return "rank";
    default:
      return null;
  }
}

function resolveSummaryStatusSearchTerm(rawStatus: unknown): string {
  const normalized = String(rawStatus ?? "").trim().toLowerCase();
  if (normalized === "playing") {
    return "Playing";
  }
  if (normalized === "lobby" || normalized === "in lobby" || normalized === "in_lobby") {
    return "Lobby";
  }
  if (normalized === "spectating") {
    return "Spectating";
  }
  return "";
}

function toFiniteMetric(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatMaxOneFractionDigit(value: unknown): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return "-";
  }
  return Number(parsed.toFixed(1)).toString();
}

async function keepLoadingVisible(startedAtMs: number) {
  const elapsedMs = Date.now() - startedAtMs;
  const remainingMs = FRIEND_ACTION_MIN_LOADING_MS - elapsedMs;
  if (remainingMs <= 0) {
    return;
  }
  await new Promise((resolve) => {
    setTimeout(resolve, remainingMs);
  });
}

const columns: TableProps<UserRow>["columns"] = [
  {
    title: "Username",
    dataIndex: "username",
    key: "username",
    align: "left",
    className: "users-username-col",
    width: "42%",
    sorter: true,
    sortDirections: ["ascend", "descend"],
    render: (value, row) => {
      const username = String(value ?? row.name ?? "-").trim() || "-";
      return (
        <span
          className={`users-username-cell${row.canAddFriend ? " users-username-cell-action" : ""}`}
          title={username}
          onClick={(event) => {
            if (!row.canAddFriend || row.friendButtonLoading) {
              return;
            }
            event.stopPropagation();
            void row.onAddFriend?.();
          }}
        >
          {username}
        </span>
      );
    },
  },
  {
    title: "Rounds",
    dataIndex: "roundsPlayed",
    key: "roundsPlayed",
    align: "center",
    sorter: true,
    sortDirections: ["ascend", "descend"],
    render: (value) => formatMaxOneFractionDigit(value),
  },
  {
    title: "Avg Score",
    dataIndex: "averageScore",
    key: "averageScore",
    align: "center",
    sorter: true,
    sortDirections: ["ascend", "descend"],
    render: (value) => formatMaxOneFractionDigit(value),
  },
  {
    title: "Rounds Won %",
    dataIndex: "roundsWonRatePct",
    key: "roundsWonRatePct",
    align: "center",
    sorter: true,
    sortDirections: ["ascend", "descend", "ascend"],
    render: (_, row) => {
      if (!row.roundsPlayed || row.roundsPlayed <= 0) {
        return "-";
      }
      const pctText = Number(row.roundsWonRatePct ?? 0).toFixed(1).replace(/\.0$/, "");
      return `${formatMaxOneFractionDigit(row.roundsWonValue)}/${formatMaxOneFractionDigit(row.roundsPlayed)} (${pctText}%)`;
    },
  },
  {
    title: "Status",
    dataIndex: "presenceLabel",
    key: "status",
    align: "right",
    className: "users-status-col",
    sorter: true,
    sortDirections: ["ascend", "descend"],
    render: (_, row) => {
      const actionLabel = row.canAddFriend
        ? "Add Friend"
        : row.canRemoveFriend
          ? "Remove Friend"
          : "Friend Request Sent";
      const canUseStatusAction = row.canStatusAction && row.onStatusAction != null;
      return (
        <div className="users-status-action">
          <span
            className={`users-status-pill users-status-${row.presenceKey}${canUseStatusAction ? " users-status-pill-action" : ""}`}
            title={row.statusActionTitle || row.presenceLabel}
            role={canUseStatusAction ? "button" : undefined}
            tabIndex={canUseStatusAction ? 0 : undefined}
            onClick={(event) => {
              if (!canUseStatusAction) {
                return;
              }
              event.stopPropagation();
              void row.onStatusAction?.();
            }}
            onKeyDown={(event) => {
              if (!canUseStatusAction || (event.key !== "Enter" && event.key !== " ")) {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              void row.onStatusAction?.();
            }}
          >
            {row.presenceLabel}
          </span>
          {row.canRemoveFriend ? (
            <Button
              type="default"
              className="users-friend-remove-btn"
              title={actionLabel}
              aria-label={actionLabel}
              disabled={!row.canRemoveFriend || row.friendButtonLoading}
              onClick={(event) => {
                event.stopPropagation();
                if (row.friendButtonLoading) {
                  return;
                }
                void row.onRemoveFriend?.();
              }}
            >
              {row.friendButtonLoading ? (
                <LoadingOutlined spin className="users-friend-action-loading-icon" />
              ) : (
                <span className="users-friend-action-symbol">{"\u2715"}</span>
              )}
            </Button>
          ) : (
            <Button
              type="primary"
              shape="circle"
              className="users-friend-add-btn"
              title={actionLabel}
              aria-label={actionLabel}
              disabled={!row.canAddFriend || row.friendButtonLoading}
              onClick={(event) => {
                event.stopPropagation();
                if (row.friendButtonLoading) {
                  return;
                }
                void row.onAddFriend?.();
              }}
            >
              {row.friendButtonLoading ? (
                <LoadingOutlined spin className="users-friend-action-loading-icon" />
              ) : (
                <span className="users-friend-action-symbol users-friend-action-symbol-plus">{"\u002b"}</span>
              )}
            </Button>
          )}
        </div>
      );
    },
  },
];

const leaderboardColumns: TableProps<UserRow>["columns"] = [
  {
    title: "Rank",
    dataIndex: "overallRankValue",
    key: "overallRankValue",
    align: "center",
    width: "10%",
    sorter: true,
    sortDirections: ["ascend", "descend"],
    render: (value) => (value == null ? "-" : `#${formatMaxOneFractionDigit(value)}`),
  },
  {
    title: "Username",
    dataIndex: "username",
    key: "username",
    align: "left",
    className: "users-username-col",
    width: "26%",
    sorter: true,
    sortDirections: ["ascend", "descend"],
    render: (value, row) => {
      const username = String(value ?? row.name ?? "-").trim() || "-";
      return (
        <span
          className={`users-username-cell${row.canAddFriend ? " users-username-cell-action" : ""}`}
          title={username}
          onClick={(event) => {
            if (!row.canAddFriend || row.friendButtonLoading) {
              return;
            }
            event.stopPropagation();
            void row.onAddFriend?.();
          }}
        >
          {username}
        </span>
      );
    },
  },
  {
    title: "Rounds",
    dataIndex: "roundsPlayed",
    key: "roundsPlayed",
    align: "center",
    width: "12%",
    sorter: true,
    sortDirections: ["ascend", "descend"],
    render: (value) => formatMaxOneFractionDigit(value),
  },
  {
    title: "Avg Score",
    dataIndex: "averageScore",
    key: "averageScore",
    align: "center",
    width: "12%",
    sorter: true,
    sortDirections: ["ascend", "descend"],
    render: (value) => formatMaxOneFractionDigit(value),
  },
  {
    title: "Rounds Won %",
    dataIndex: "roundsWonRatePct",
    key: "roundsWonRatePct",
    align: "center",
    width: "20%",
    sorter: true,
    sortDirections: ["ascend", "descend"],
    render: (_, row) => {
      if (!row.roundsPlayed || row.roundsPlayed <= 0) {
        return "-";
      }
      const pctText = Number(row.roundsWonRatePct ?? 0).toFixed(1).replace(/\.0$/, "");
      return `${formatMaxOneFractionDigit(row.roundsWonValue)}/${formatMaxOneFractionDigit(row.roundsPlayed)} (${pctText}%)`;
    },
  },
  {
    title: "Games Won %",
    dataIndex: "gamesWonRatePct",
    key: "gamesWonRatePct",
    align: "center",
    width: "20%",
    sorter: true,
    sortDirections: ["ascend", "descend"],
    render: (_, row) => {
      if (!row.gamesPlayed || row.gamesPlayed <= 0) {
        return "-";
      }
      const pctText = Number(row.gamesWonRatePct ?? 0).toFixed(1).replace(/\.0$/, "");
      return `${formatMaxOneFractionDigit(row.gamesWonValue)}/${formatMaxOneFractionDigit(row.gamesPlayed)} (${pctText}%)`;
    },
  },
];

const UsersPage: React.FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const apiService = useApi();
  const { value: token } = useLocalStorage<string>("token", "");
  const { value: userId } = useLocalStorage<string>("userId", "");
  const [directoryPage, setDirectoryPage] = useState<UserPageResponse | null>(null);
  const [leaderboardPage, setLeaderboardPage] = useState<UserPageResponse | null>(null);
  const [directoryPageIndex, setDirectoryPageIndex] = useState(0);
  const [leaderboardPageIndex, setLeaderboardPageIndex] = useState(0);
  const [directorySort, setDirectorySort] = useState<UserListSort>("username");
  const [directoryDirection, setDirectoryDirection] = useState<UserListDirection>("asc");
  const [leaderboardSort, setLeaderboardSort] = useState<UserListSort>("rank");
  const [leaderboardDirection, setLeaderboardDirection] = useState<UserListDirection>("asc");
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearchTerm = useDebouncedValue(searchTerm, 1000);
  const [leaderboardSearchTerm, setLeaderboardSearchTerm] = useState("");
  const debouncedLeaderboardSearchTerm = useDebouncedValue(leaderboardSearchTerm, 1000);
  const [friendIds, setFriendIds] = useState<string[]>([]);
  const [pendingFriendRequestIds, setPendingFriendRequestIds] = useState<Record<string, true>>({});
  const [addingFriendById, setAddingFriendById] = useState<Record<string, boolean>>({});
  const [removingFriendById, setRemovingFriendById] = useState<Record<string, boolean>>({});
  const [showFriendsOnlyUsers, setShowFriendsOnlyUsers] = useState(false);
  const [showFriendsOnlyLeaderboard, setShowFriendsOnlyLeaderboard] = useState(false);
  const previousFriendIdsKeyRef = useRef<string | null>(null);
  const liveConnected = useApiConnectionStatus(userId.trim(), token.trim());
  const refreshing = directoryLoading || leaderboardLoading;

  useEffect(() => {
    const isSummaryFilterNavigation = String(searchParams.get("summary") ?? "").trim() === "1";
    if (!isSummaryFilterNavigation) {
      return;
    }

    const friendsOnlyParam = String(searchParams.get("friendsOnly") ?? "").trim().toLowerCase();
    const shouldShowFriendsOnly = friendsOnlyParam === "1" || friendsOnlyParam === "true";
    const statusSearchTerm = resolveSummaryStatusSearchTerm(searchParams.get("status"));

    setShowFriendsOnlyUsers(shouldShowFriendsOnly);
    setSearchTerm(statusSearchTerm);
  }, [searchParams]);

  const reconcilePendingRequests = useCallback((acceptedFriendIds: string[]) => {
    const acceptedSet = new Set(acceptedFriendIds);
    setPendingFriendRequestIds((previous) => {
      const next: Record<string, true> = {};
      Object.keys(previous).forEach((id) => {
        if (!acceptedSet.has(id)) {
          next[id] = true;
        }
      });
      return next;
    });
  }, []);

  const loadDirectoryPage = useCallback(() => getUsersPage(
    apiService,
    {
      view: "directory",
      page: directoryPageIndex,
      size: USERS_PAGE_SIZE,
      q: debouncedSearchTerm,
      friendsOnly: showFriendsOnlyUsers,
      sort: directorySort,
      direction: directoryDirection,
      excludeIds: userId.trim() ? [userId.trim()] : undefined,
    },
    token,
  ), [
    apiService,
    debouncedSearchTerm,
    directoryDirection,
    directoryPageIndex,
    directorySort,
    showFriendsOnlyUsers,
    token,
    userId,
  ]);

  const loadLeaderboardPage = useCallback(() => getUsersPage(
    apiService,
    {
      view: "leaderboard",
      page: leaderboardPageIndex,
      size: USERS_PAGE_SIZE,
      q: debouncedLeaderboardSearchTerm,
      friendsOnly: showFriendsOnlyLeaderboard,
      sort: leaderboardSort,
      direction: leaderboardDirection,
    },
    token,
  ), [
    apiService,
    debouncedLeaderboardSearchTerm,
    leaderboardDirection,
    leaderboardPageIndex,
    leaderboardSort,
    showFriendsOnlyLeaderboard,
    token,
  ]);

  useEffect(() => {
    let active = true;
    setDirectoryLoading(true);
    void loadDirectoryPage()
      .then((response) => {
        if (active) {
          const lastPageIndex = Math.max(0, response.totalPages - 1);
          if (directoryPageIndex > lastPageIndex) {
            setDirectoryPageIndex(lastPageIndex);
            return;
          }
          setDirectoryPage(response);
          setDirectoryError(null);
        }
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        setDirectoryPage((previous) => previous ?? emptyUserPage(directoryPageIndex));
        setDirectoryError("Could not refresh the user directory. Showing the last available data.");
        if (error instanceof Error) {
          console.error("Could not load user directory:", error.message);
        }
      })
      .finally(() => {
        if (active) {
          setDirectoryLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [directoryPageIndex, loadDirectoryPage, refreshVersion]);

  useEffect(() => {
    let active = true;
    setLeaderboardLoading(true);
    void loadLeaderboardPage()
      .then((response) => {
        if (active) {
          const lastPageIndex = Math.max(0, response.totalPages - 1);
          if (leaderboardPageIndex > lastPageIndex) {
            setLeaderboardPageIndex(lastPageIndex);
            return;
          }
          setLeaderboardPage(response);
          setLeaderboardError(null);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setLeaderboardPage((previous) => previous ?? emptyUserPage(leaderboardPageIndex));
          setLeaderboardError("Could not refresh the leaderboard. Showing the last available data.");
          console.error("Could not load leaderboard:", error);
        }
      })
      .finally(() => {
        if (active) {
          setLeaderboardLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [leaderboardPageIndex, loadLeaderboardPage, refreshVersion]);

  const loadFriendIds = useCallback(async () => {
    const authToken = token.trim();
    if (!authToken) {
      setFriendIds([]);
      return [];
    }

    try {
      const payload = await apiService.getWithAuth<Array<string | number>>(
        "/users/me/friends/ids",
        authToken,
      );
      const normalized = (payload ?? [])
        .map((entry) => String(entry ?? "").trim())
        .filter((entry) => entry.length > 0);
      setFriendIds(normalized);
      return normalized;
    } catch {
      setFriendIds([]);
      return [];
    }
  }, [apiService, token]);

  const loadOutgoingPendingFriendRequestIds = useCallback(async () => {
    const authToken = token.trim();
    if (!authToken) {
      setPendingFriendRequestIds({});
      return [];
    }

    try {
      const payload = await apiService.getWithAuth<Array<string | number>>(
        "/users/me/friends/requests/outgoing/ids",
        authToken,
      );
      const normalized = (payload ?? [])
        .map((entry) => String(entry ?? "").trim())
        .filter((entry) => entry.length > 0);
      setPendingFriendRequestIds(
        normalized.reduce<Record<string, true>>((acc, id) => {
          acc[id] = true;
          return acc;
        }, {}),
      );
      return normalized;
    } catch {
      return [];
    }
  }, [apiService, token]);

  useEffect(() => {
    let active = true;
    void Promise.all([loadFriendIds(), loadOutgoingPendingFriendRequestIds()]).then(([ids]) => {
      if (!active) {
        return;
      }
      reconcilePendingRequests(ids);
    });
    return () => {
      active = false;
    };
  }, [loadFriendIds, loadOutgoingPendingFriendRequestIds, reconcilePendingRequests]);

  useEffect(() => {
    const authToken = token.trim();
    if (!authToken || typeof window === "undefined") {
      return;
    }
    let active = true;
    const refreshFriendRequestState = async () => {
      const acceptedIds = await loadFriendIds();
      if (!active) {
        return;
      }
      reconcilePendingRequests(acceptedIds);
      await loadOutgoingPendingFriendRequestIds();
    };
    void refreshFriendRequestState();
    const intervalId = window.setInterval(() => {
      void refreshFriendRequestState();
    }, FRIEND_REQUEST_STATUS_POLL_MS);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [loadFriendIds, loadOutgoingPendingFriendRequestIds, reconcilePendingRequests, token]);

  useEffect(() => {
    const key = [...friendIds].sort().join("|");
    const previousKey = previousFriendIdsKeyRef.current;
    previousFriendIdsKeyRef.current = key;
    if (previousKey == null || previousKey === key) {
      return;
    }
    if (showFriendsOnlyUsers) {
      setDirectoryPageIndex(0);
    }
    if (showFriendsOnlyLeaderboard) {
      setLeaderboardPageIndex(0);
    }
    if (showFriendsOnlyUsers || showFriendsOnlyLeaderboard) {
      setRefreshVersion((current) => current + 1);
    }
  }, [friendIds, showFriendsOnlyLeaderboard, showFriendsOnlyUsers]);

  const refreshUsersAndFriends = useCallback(async () => {
    setRefreshVersion((current) => current + 1);
    const acceptedIds = await loadFriendIds();
    await loadOutgoingPendingFriendRequestIds();
    reconcilePendingRequests(acceptedIds);
  }, [loadFriendIds, loadOutgoingPendingFriendRequestIds, reconcilePendingRequests]);

  const handleAddFriend = useCallback(async (targetUserId: string, targetUsername: string) => {
    const authToken = token.trim();
    const normalizedTargetId = String(targetUserId ?? "").trim();
    const normalizedTargetUsername = String(targetUsername ?? "").trim() || "this user";
    if (!authToken || !normalizedTargetId) {
      return;
    }
    const confirmed = await showTimedConfirmation({
      title: `Do you really want to add ${normalizedTargetUsername} to your friendlist?`,
      timeoutSeconds: 10,
    });
    if (!confirmed) {
      return;
    }

    setAddingFriendById((previous) => ({
      ...previous,
      [normalizedTargetId]: true,
    }));
    const startedAtMs = Date.now();
    try {
      await apiService.postWithAuth<void>(
        `/users/me/friends/requests/${encodeURIComponent(normalizedTargetId)}`,
        {},
        authToken,
      );
      setPendingFriendRequestIds((previous) => ({
        ...previous,
        [normalizedTargetId]: true,
      }));
      const [acceptedIds] = await Promise.all([
        loadFriendIds(),
        loadOutgoingPendingFriendRequestIds(),
      ]);
      if (acceptedIds.includes(normalizedTargetId)) {
        setPendingFriendRequestIds((previous) => {
          const next = { ...previous };
          delete next[normalizedTargetId];
          return next;
        });
      }
    } catch (error) {
      if (error instanceof Error) {
        alert(`Could not send friend request:\n${error.message}`);
      } else {
        alert("Could not send friend request.");
      }
    } finally {
      await keepLoadingVisible(startedAtMs);
      setAddingFriendById((previous) => ({
        ...previous,
        [normalizedTargetId]: false,
      }));
    }
  }, [apiService, token, loadFriendIds, loadOutgoingPendingFriendRequestIds]);

  const handleRemoveFriend = useCallback(async (targetUserId: string, targetUsername: string) => {
    const authToken = token.trim();
    const normalizedTargetId = String(targetUserId ?? "").trim();
    const normalizedTargetUsername = String(targetUsername ?? "").trim() || "this user";
    if (!authToken || !normalizedTargetId) {
      return;
    }
    const confirmed = await showTimedConfirmation({
      title: `Do you really want to remove ${normalizedTargetUsername} from your friendlist?`,
      timeoutSeconds: 10,
      danger: true,
    });
    if (!confirmed) {
      return;
    }

    setRemovingFriendById((previous) => ({
      ...previous,
      [normalizedTargetId]: true,
    }));
    const startedAtMs = Date.now();
    try {
      await apiService.deleteWithAuth<void>(
        `/users/me/friends/${encodeURIComponent(normalizedTargetId)}`,
        authToken,
      );
      setPendingFriendRequestIds((previous) => {
        const next = { ...previous };
        delete next[normalizedTargetId];
        return next;
      });
      await Promise.all([loadFriendIds(), loadOutgoingPendingFriendRequestIds()]);
      setRefreshVersion((current) => current + 1);
    } catch (error) {
      if (error instanceof Error) {
        alert(`Could not remove friend:\n${error.message}`);
      } else {
        alert("Could not remove friend.");
      }
    } finally {
      await keepLoadingVisible(startedAtMs);
      setRemovingFriendById((previous) => ({
        ...previous,
        [normalizedTargetId]: false,
      }));
    }
  }, [apiService, token, loadFriendIds, loadOutgoingPendingFriendRequestIds]);

  const handleSpectateFromStatus = useCallback(async (
    targetUsername: string,
    knownSessionId: string,
    sourcePresence: PresenceKey,
  ) => {
    const resolvedSessionId = String(knownSessionId ?? "").trim();
    if (!resolvedSessionId) {
      const sourceLabel =
        sourcePresence === "playing"
          ? "playing"
          : sourcePresence === "lobby"
            ? "lobby"
            : "spectating";
      alert(`This user's ${sourceLabel} session is currently unavailable.`);
      return;
    }

    const confirmed = await showTimedConfirmation({
      title: `Do you want to spectate ${targetUsername}?`,
      timeoutSeconds: 10,
    });
    if (!confirmed) {
      return;
    }

    router.push(`/spectator?sessionId=${encodeURIComponent(resolvedSessionId)}`);
  }, [router]);

  const users = useMemo(() => {
    const byId = new Map<string, User>();
    [...(directoryPage?.items ?? []), ...(leaderboardPage?.items ?? [])].forEach((user) => {
      const id = String(user.id ?? "").trim();
      if (id) {
        byId.set(id, user);
      }
    });
    return Array.from(byId.values());
  }, [directoryPage?.items, leaderboardPage?.items]);

  const friendIdSet = useMemo(() => new Set(friendIds), [friendIds]);

  const rows: UserRow[] = useMemo(
    () =>
      (users ?? [])
        .map((user) => {
          const normalizedId = String(user.id ?? "").trim();
          const isSelf = normalizedId.length > 0 && normalizedId === userId.trim();
          const isFriend = normalizedId.length > 0 && friendIdSet.has(normalizedId);
          const isAddingFriend = normalizedId.length > 0 && Boolean(addingFriendById[normalizedId]);
          const isRemovingFriend = normalizedId.length > 0 && Boolean(removingFriendById[normalizedId]);
          const isPendingFriendRequest =
            normalizedId.length > 0 &&
            Boolean(pendingFriendRequestIds[normalizedId]) &&
            !isAddingFriend;
          const canAddFriend =
            !isSelf &&
            normalizedId.length > 0 &&
            token.trim().length > 0 &&
            !isFriend &&
            !isPendingFriendRequest &&
            !isRemovingFriend;
          const canRemoveFriend =
            !isSelf &&
            normalizedId.length > 0 &&
            token.trim().length > 0 &&
            isFriend;
          const rowWithLegacyMetrics = user as User & {
            gamesPlayed?: number | null;
            games?: number | null;
          };
          const roundsWon = Number(user.roundsWon ?? 0);
          const roundsPlayedRaw =
            user.roundsPlayed ?? user.rounds ?? user.roundCount;
          const roundsPlayed = toFiniteMetric(roundsPlayedRaw);
          const roundsWonRatePct =
            roundsPlayed != null && roundsPlayed > 0 ? (roundsWon / roundsPlayed) * 100 : null;
          const gamesWonValue = Number(user.gamesWon ?? 0);
          const gamesPlayedRaw =
            rowWithLegacyMetrics.gamesPlayed ?? rowWithLegacyMetrics.games;
          const gamesPlayed = toFiniteMetric(gamesPlayedRaw);
          const gamesWonRatePct =
            gamesPlayed != null && gamesPlayed > 0 ? (gamesWonValue / gamesPlayed) * 100 : null;
          const presenceKey = toPresenceKey(user.status);
          const sessionIdHint = String(user.joinableSessionId ?? "").trim();
          const canSpectateFromStatus =
            (presenceKey === "spectating" || presenceKey === "lobby" || presenceKey === "playing") &&
            normalizedId.length > 0 &&
            sessionIdHint.length > 0;
          const spectateSourceLabel =
            presenceKey === "playing"
              ? "Playing"
              : presenceKey === "spectating"
                ? "Spectating"
                : "In lobby";
          const statusActionTitle = canSpectateFromStatus
            ? (sessionIdHint
                ? `${spectateSourceLabel} ${sessionIdHint}. Click to spectate.`
                : `${spectateSourceLabel}. Click to spectate.`)
            : toPresenceLabel(presenceKey);
          const averageScoreRaw = user.averageScorePerRound;
          const averageScore =
            toFiniteMetric(averageScoreRaw);
          const rankRaw = user.overallRank;
          const overallRankValue =
            toFiniteMetric(rankRaw);
          const usernameLabel = String(user.username ?? user.name ?? normalizedId).trim() || normalizedId;
          return {
            ...user,
            key: String(user.id ?? ""),
            roundsPlayed,
            roundsWonValue: roundsWon,
            roundsWonRatePct,
            gamesPlayed,
            gamesWonValue,
            gamesWonRatePct,
            averageScore,
            overallRankValue,
            presenceLabel: toPresenceLabel(presenceKey),
            presenceKey,
            canAddFriend,
            canRemoveFriend,
            friendButtonLoading: isAddingFriend || isRemovingFriend || isPendingFriendRequest,
            onAddFriend: canAddFriend ? async () => handleAddFriend(normalizedId, usernameLabel) : null,
            onRemoveFriend: canRemoveFriend ? async () => handleRemoveFriend(normalizedId, usernameLabel) : null,
            canStatusAction: canSpectateFromStatus,
            statusActionTitle,
            onStatusAction: canSpectateFromStatus
              ? async () => handleSpectateFromStatus(usernameLabel, sessionIdHint, presenceKey)
              : null,
          };
        }),
    [
      addingFriendById,
      friendIdSet,
      handleAddFriend,
      handleRemoveFriend,
      pendingFriendRequestIds,
      removingFriendById,
      token,
      userId,
      users,
      handleSpectateFromStatus,
    ],
  );

  const rowsById = useMemo(
    () => new Map(rows.map((row) => [String(row.id ?? "").trim(), row] as const)),
    [rows],
  );
  const filteredUsers = useMemo(
    () => (directoryPage?.items ?? [])
      .map((user) => rowsById.get(String(user.id ?? "").trim()))
      .filter((row): row is UserRow => row != null),
    [directoryPage?.items, rowsById],
  );
  const filteredLeaderboardRows = useMemo(
    () => (leaderboardPage?.items ?? [])
      .map((user) => rowsById.get(String(user.id ?? "").trim()))
      .filter((row): row is UserRow => row != null && row.overallRankValue != null),
    [leaderboardPage?.items, rowsById],
  );

  const directoryColumns = useMemo<TableProps<UserRow>["columns"]>(
    () => (columns ?? []).map((column) => ({
      ...column,
      sortOrder:
        toServerSort(column.key) === directorySort
          ? directoryDirection === "desc" ? "descend" : "ascend"
          : null,
    })),
    [directoryDirection, directorySort],
  );
  const controlledLeaderboardColumns = useMemo<TableProps<UserRow>["columns"]>(
    () => (leaderboardColumns ?? []).map((column) => ({
      ...column,
      sortOrder:
        toServerSort(column.key) === leaderboardSort
          ? leaderboardDirection === "desc" ? "descend" : "ascend"
          : null,
    })),
    [leaderboardDirection, leaderboardSort],
  );

  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/dashboard");
  };

  const handleDashboard = () => {
    router.push("/dashboard");
  };

  return (
    <div className="cabo-background">
      <div className="login-container">
        <div className="create-lobby-stack dashboard-stack">
          <Card
            title={
              <div className="lobby-section-title-row">
                <span className="dashboard-section-title">All Users</span>
                <span
                  className={`live-connection-symbol ${liveConnected ? "connected" : "disconnected"}`}
                  title={liveConnected ? "Connected" : "Disconnected"}
                >
                  <span className="connection-symbol-dot" aria-hidden="true">{"\u25CF"}</span>
                </span>
              </div>
            }
            loading={directoryPage == null && directoryLoading}
            className="dashboard-container"
          >
            {directoryPage ? (
              <>
                {directoryError ? (
                  <Alert showIcon type="error" message={directoryError} />
                ) : null}
                <div className="users-overview-toolbar users-overview-toolbar-with-filters">
                  <Input
                    value={searchTerm}
                    allowClear
                    className="users-overview-search"
                    placeholder="Search by Username or Status"
                    maxLength={64}
                    onChange={(event) => {
                      setSearchTerm(event.target.value);
                      setDirectoryPageIndex(0);
                    }}
                  />
                  <Checkbox
                    className="users-overview-filter-toggle"
                    checked={showFriendsOnlyUsers}
                    onChange={(event) => {
                      setShowFriendsOnlyUsers(event.target.checked);
                      setDirectoryPageIndex(0);
                    }}
                  >
                    Show Friends Only
                  </Checkbox>
                  <Button
                    type="default"
                    className="users-refresh-btn"
                    loading={refreshing}
                    onClick={() => void refreshUsersAndFriends()}
                  >
                    Refresh
                  </Button>
                </div>
                <Table<UserRow>
                  className="users-overview-table responsive-list-table"
                  columns={directoryColumns}
                  dataSource={filteredUsers}
                  rowKey="key"
                  size="small"
                  tableLayout="fixed"
                  loading={directoryLoading}
                  pagination={{
                    current: (directoryPage.page ?? 0) + 1,
                    pageSize: USERS_PAGE_SIZE,
                    total: directoryPage.totalElements,
                    showSizeChanger: false,
                    hideOnSinglePage: false,
                    responsive: true,
                    position: ["bottomCenter"],
                    onChange: (page) => setDirectoryPageIndex(Math.max(0, page - 1)),
                  }}
                  onChange={(_pagination, _filters, sorter) => {
                    const selected = Array.isArray(sorter) ? sorter[0] : sorter;
                    const nextSort = toServerSort(selected?.columnKey ?? selected?.field);
                    if (!selected?.order) {
                      setDirectorySort("username");
                      setDirectoryDirection("asc");
                      setDirectoryPageIndex(0);
                      return;
                    }
                    if (!nextSort) {
                      return;
                    }
                    const nextDirection: UserListDirection = selected.order === "descend" ? "desc" : "asc";
                    if (nextSort !== directorySort || nextDirection !== directoryDirection) {
                      setDirectorySort(nextSort);
                      setDirectoryDirection(nextDirection);
                      setDirectoryPageIndex(0);
                    }
                  }}
                  rowClassName={() => "users-overview-row"}
                  onRow={(row: UserRow) => ({
                    onClick: () => router.push(`/users/${row.id}`),
                  })}
                />
              </>
            ) : null}
          </Card>

          <Card
            className="dashboard-container"
            title={
              <div className="lobby-section-title-row">
                <span className="dashboard-section-title">Leaderboard</span>
              </div>
            }
          >
            {leaderboardError ? (
              <Alert showIcon type="error" message={leaderboardError} />
            ) : null}
            <div className="users-overview-toolbar">
              <Input
                value={leaderboardSearchTerm}
                allowClear
                className="users-overview-search"
                placeholder="Search by Username"
                maxLength={64}
                onChange={(event) => {
                  setLeaderboardSearchTerm(event.target.value);
                  setLeaderboardPageIndex(0);
                }}
              />
              <Checkbox
                className="users-overview-filter-toggle"
                checked={showFriendsOnlyLeaderboard}
                onChange={(event) => {
                  setShowFriendsOnlyLeaderboard(event.target.checked);
                  setLeaderboardPageIndex(0);
                }}
              >
                Show Friends Only
              </Checkbox>
            </div>
            <Table<UserRow>
              className="users-overview-table responsive-list-table"
              columns={controlledLeaderboardColumns}
              dataSource={filteredLeaderboardRows}
              rowKey="key"
              size="small"
              tableLayout="fixed"
              loading={leaderboardLoading}
              pagination={{
                current: (leaderboardPage?.page ?? 0) + 1,
                pageSize: USERS_PAGE_SIZE,
                total: leaderboardPage?.totalElements ?? 0,
                showSizeChanger: false,
                hideOnSinglePage: false,
                responsive: true,
                position: ["bottomCenter"],
                onChange: (page) => setLeaderboardPageIndex(Math.max(0, page - 1)),
              }}
              onChange={(_pagination, _filters, sorter) => {
                const selected = Array.isArray(sorter) ? sorter[0] : sorter;
                const nextSort = toServerSort(selected?.columnKey ?? selected?.field);
                if (!selected?.order) {
                  setLeaderboardSort("rank");
                  setLeaderboardDirection("asc");
                  setLeaderboardPageIndex(0);
                  return;
                }
                if (!nextSort) {
                  return;
                }
                const nextDirection: UserListDirection = selected.order === "descend" ? "desc" : "asc";
                if (nextSort !== leaderboardSort || nextDirection !== leaderboardDirection) {
                  setLeaderboardSort(nextSort);
                  setLeaderboardDirection(nextDirection);
                  setLeaderboardPageIndex(0);
                }
              }}
              rowClassName={() => "users-overview-row"}
              onRow={(row: UserRow) => ({
                onClick: () => router.push(`/users/${row.id}`),
              })}
              locale={{
                emptyText: "No ranked players available yet.",
              }}
            />
          </Card>

          <Card className="dashboard-container">
            <div className="dashboard-nav-row">
              <Button type="default" onClick={handleBack}>
                {"\u2190"} Back
              </Button>
              <Button type="default" onClick={handleDashboard}>
                {"\u2302"} Dashboard
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
};

export default UsersPage;
