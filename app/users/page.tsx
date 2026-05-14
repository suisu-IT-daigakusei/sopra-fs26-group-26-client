// this code is part of S2 to display a list of all registered users
// clicking on a user in this list will display /app/users/[id]/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useApi } from "@/hooks/useApi";
import { useApiConnectionStatus } from "@/hooks/useApiConnectionStatus";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import useLocalStorage from "@/hooks/useLocalStorage";
import InlineMusicPlayer from "@/components/InlineMusicPlayer";
import { User } from "@/types/user";
import { PresenceKey, toPresenceKey, toPresenceLabel } from "@/utils/presence";
import { derivePlayedStatsFromHistoryPayload, UserHistoryPlayedStats } from "@/utils/userHistoryStats";
import { LoadingOutlined } from "@ant-design/icons";
import { Button, Card, Checkbox, Input, Table } from "antd";
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
};

const USERS_PAGE_SIZE = 10;
const FRIEND_ACTION_MIN_LOADING_MS = 800;
const FRIEND_REQUEST_STATUS_POLL_MS = 4000;

function toFiniteMetric(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
    sorter: (a, b) =>
      String(a.username ?? a.name ?? "").localeCompare(
        String(b.username ?? b.name ?? ""),
      ),
    sortDirections: ["ascend", "descend"],
    render: (value, row) => {
      const username = String(value ?? row.name ?? "-").trim() || "-";
      return (
        <span className="users-username-cell" title={username}>
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
    sorter: (a, b) => (a.roundsPlayed ?? -1) - (b.roundsPlayed ?? -1),
    sortDirections: ["ascend", "descend"],
    render: (value) => (value == null ? "-" : value),
  },
  {
    title: "Avg Score",
    dataIndex: "averageScore",
    key: "averageScore",
    align: "center",
    sorter: (a, b) => (a.averageScore ?? Number.MAX_SAFE_INTEGER) - (b.averageScore ?? Number.MAX_SAFE_INTEGER),
    sortDirections: ["ascend", "descend"],
    render: (value) =>
      value == null || Number.isNaN(Number(value))
        ? "-"
        : Number(value).toFixed(2).replace(/\.00$/, ""),
  },
  {
    title: "Rounds Won %",
    dataIndex: "roundsWonRatePct",
    key: "roundsWonRatePct",
    align: "center",
    sorter: (a, b) => (a.roundsWonRatePct ?? -1) - (b.roundsWonRatePct ?? -1),
    sortDirections: ["ascend", "descend", "ascend"],
    render: (_, row) => {
      if (!row.roundsPlayed || row.roundsPlayed <= 0) {
        return "-";
      }
      const pctText = Number(row.roundsWonRatePct ?? 0).toFixed(1).replace(/\.0$/, "");
      return `${row.roundsWonValue}/${row.roundsPlayed} (${pctText}%)`;
    },
  },
  {
    title: "Status",
    dataIndex: "presenceLabel",
    key: "status",
    align: "right",
    className: "users-status-col",
    sorter: (a, b) => a.presenceLabel.localeCompare(b.presenceLabel),
    sortDirections: ["ascend", "descend"],
    render: (_, row) => {
      const actionLabel = row.canAddFriend
        ? "Add Friend"
        : row.canRemoveFriend
          ? "Remove Friend"
          : "Friend Request Sent";
      return (
        <div className="users-status-action">
          <span className={`users-status-pill users-status-${row.presenceKey}`}>
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
                "X"
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
                "+"
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
    sorter: (a, b) => (a.overallRankValue ?? Number.MAX_SAFE_INTEGER) - (b.overallRankValue ?? Number.MAX_SAFE_INTEGER),
    sortDirections: ["ascend", "descend"],
    render: (value) => (value == null ? "-" : `#${value}`),
  },
  {
    title: "Username",
    dataIndex: "username",
    key: "username",
    align: "left",
    className: "users-username-col",
    width: "26%",
    sorter: (a, b) =>
      String(a.username ?? a.name ?? "").localeCompare(
        String(b.username ?? b.name ?? ""),
      ),
    sortDirections: ["ascend", "descend"],
    render: (value, row) => {
      const username = String(value ?? row.name ?? "-").trim() || "-";
      return (
        <span className="users-username-cell" title={username}>
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
    sorter: (a, b) => (a.roundsPlayed ?? -1) - (b.roundsPlayed ?? -1),
    sortDirections: ["ascend", "descend"],
    render: (value) => (value == null ? "-" : value),
  },
  {
    title: "Avg Score",
    dataIndex: "averageScore",
    key: "averageScore",
    align: "center",
    width: "12%",
    sorter: (a, b) => (a.averageScore ?? Number.MAX_SAFE_INTEGER) - (b.averageScore ?? Number.MAX_SAFE_INTEGER),
    sortDirections: ["ascend", "descend"],
    render: (value) =>
      value == null || Number.isNaN(Number(value))
        ? "-"
        : Number(value).toFixed(2).replace(/\.00$/, ""),
  },
  {
    title: "Rounds Won %",
    dataIndex: "roundsWonRatePct",
    key: "roundsWonRatePct",
    align: "center",
    width: "20%",
    sorter: (a, b) => (a.roundsWonRatePct ?? -1) - (b.roundsWonRatePct ?? -1),
    sortDirections: ["ascend", "descend"],
    render: (_, row) => {
      if (!row.roundsPlayed || row.roundsPlayed <= 0) {
        return "-";
      }
      const pctText = Number(row.roundsWonRatePct ?? 0).toFixed(1).replace(/\.0$/, "");
      return `${row.roundsWonValue}/${row.roundsPlayed} (${pctText}%)`;
    },
  },
  {
    title: "Games Won %",
    dataIndex: "gamesWonRatePct",
    key: "gamesWonRatePct",
    align: "center",
    width: "20%",
    sorter: (a, b) => (a.gamesWonRatePct ?? -1) - (b.gamesWonRatePct ?? -1),
    sortDirections: ["ascend", "descend"],
    render: (_, row) => {
      if (!row.gamesPlayed || row.gamesPlayed <= 0) {
        return "-";
      }
      const pctText = Number(row.gamesWonRatePct ?? 0).toFixed(1).replace(/\.0$/, "");
      return `${row.gamesWonValue}/${row.gamesPlayed} (${pctText}%)`;
    },
  },
];

const UsersPage: React.FC = () => {
  const router = useRouter();
  const apiService = useApi();
  const { value: token } = useLocalStorage<string>("token", "");
  const { value: userId } = useLocalStorage<string>("userId", "");
  const [users, setUsers] = useState<User[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearchTerm = useDebouncedValue(searchTerm, 1000);
  const [leaderboardSearchTerm, setLeaderboardSearchTerm] = useState("");
  const debouncedLeaderboardSearchTerm = useDebouncedValue(leaderboardSearchTerm, 1000);
  const [historyStatsByUserId, setHistoryStatsByUserId] = useState<Record<string, UserHistoryPlayedStats>>({});
  const [friendIds, setFriendIds] = useState<string[]>([]);
  const [pendingFriendRequestIds, setPendingFriendRequestIds] = useState<Record<string, true>>({});
  const [addingFriendById, setAddingFriendById] = useState<Record<string, boolean>>({});
  const [removingFriendById, setRemovingFriendById] = useState<Record<string, boolean>>({});
  const [showFriendsOnlyUsers, setShowFriendsOnlyUsers] = useState(false);
  const [showFriendsOnlyLeaderboard, setShowFriendsOnlyLeaderboard] = useState(false);
  const liveConnected = useApiConnectionStatus(userId.trim(), token.trim());

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

  const fetchUsers = useCallback(async () => {
    setRefreshing(true);
    try {
      const fetchedUsers: User[] = await apiService.get<User[]>("/users");
      setUsers(fetchedUsers);
    } catch (error) {
      setUsers([]);
      if (error instanceof Error) {
        alert(`Something went wrong while fetching users:\n${error.message}`);
      } else {
        console.error("An unknown error occurred while fetching users.");
      }
    } finally {
      setRefreshing(false);
    }
  }, [apiService]);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

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

  const refreshUsersAndFriends = useCallback(async () => {
    await fetchUsers();
    const acceptedIds = await loadFriendIds();
    await loadOutgoingPendingFriendRequestIds();
    reconcilePendingRequests(acceptedIds);
  }, [fetchUsers, loadFriendIds, loadOutgoingPendingFriendRequestIds, reconcilePendingRequests]);

  const handleAddFriend = useCallback(async (targetUserId: string) => {
    const authToken = token.trim();
    const normalizedTargetId = String(targetUserId ?? "").trim();
    if (!authToken || !normalizedTargetId) {
      return;
    }
    if (typeof window !== "undefined") {
      const confirmed = window.confirm("Do you really want to add this user to your friend list");
      if (!confirmed) {
        return;
      }
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

  const handleRemoveFriend = useCallback(async (targetUserId: string) => {
    const authToken = token.trim();
    const normalizedTargetId = String(targetUserId ?? "").trim();
    if (!authToken || !normalizedTargetId) {
      return;
    }
    if (typeof window !== "undefined") {
      const confirmed = window.confirm("Do you really want to remove this user from your friend list");
      if (!confirmed) {
        return;
      }
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

  useEffect(() => {
    const authToken = token.trim();
    const listedUsers = users ?? [];
    if (!authToken || listedUsers.length === 0) {
      setHistoryStatsByUserId({});
      return;
    }

    const usersNeedingFallbackStats = listedUsers
      .map((user) => {
        const id = String(user.id ?? "").trim();
        if (!id) {
          return null;
        }
        const roundsPlayedRaw = user.roundsPlayed ?? user.rounds ?? user.roundCount;
        const gamesPlayedRaw = user.gamesPlayed ?? user.games;
        const hasRoundsPlayed = toFiniteMetric(roundsPlayedRaw) != null;
        const hasGamesPlayed = toFiniteMetric(gamesPlayedRaw) != null;
        return !hasRoundsPlayed || !hasGamesPlayed ? id : null;
      })
      .filter((value): value is string => value != null);

    if (usersNeedingFallbackStats.length === 0) {
      setHistoryStatsByUserId({});
      return;
    }

    let active = true;
    void Promise.all(
      usersNeedingFallbackStats.map(async (id) => {
        try {
          const payload = await apiService.getWithAuth<unknown>(
            `/users/${encodeURIComponent(id)}/history`,
            authToken,
          );
          return [id, derivePlayedStatsFromHistoryPayload(payload, id)] as const;
        } catch {
          return [id, { gamesPlayed: null, roundsPlayed: null }] as const;
        }
      }),
    ).then((entries) => {
      if (!active) {
        return;
      }
      const next: Record<string, UserHistoryPlayedStats> = {};
      entries.forEach(([id, stats]) => {
        next[id] = stats;
      });
      setHistoryStatsByUserId(next);
    });

    return () => {
      active = false;
    };
  }, [apiService, token, users]);

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
          const historyStats = normalizedId ? historyStatsByUserId[normalizedId] : undefined;
          const rowWithLegacyMetrics = user as User & {
            gamesPlayed?: number | null;
            games?: number | null;
          };
          const roundsWon = Number(user.roundsWon ?? 0);
          const roundsPlayedRaw =
            user.roundsPlayed ?? user.rounds ?? user.roundCount ?? historyStats?.roundsPlayed;
          const roundsPlayed = toFiniteMetric(roundsPlayedRaw);
          const roundsWonRatePct =
            roundsPlayed != null && roundsPlayed > 0 ? (roundsWon / roundsPlayed) * 100 : null;
          const gamesWonValue = Number(user.gamesWon ?? 0);
          const gamesPlayedRaw =
            rowWithLegacyMetrics.gamesPlayed ?? rowWithLegacyMetrics.games ?? historyStats?.gamesPlayed;
          const gamesPlayed = toFiniteMetric(gamesPlayedRaw);
          const gamesWonRatePct =
            gamesPlayed != null && gamesPlayed > 0 ? (gamesWonValue / gamesPlayed) * 100 : null;
          const presenceKey = toPresenceKey(user.status);
          const averageScoreRaw = user.averageScorePerRound;
          const averageScore =
            toFiniteMetric(averageScoreRaw);
          const rankRaw = user.overallRank;
          const overallRankValue =
            toFiniteMetric(rankRaw);
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
            onAddFriend: canAddFriend ? async () => handleAddFriend(normalizedId) : null,
            onRemoveFriend: canRemoveFriend ? async () => handleRemoveFriend(normalizedId) : null,
          };
        }),
    [
      addingFriendById,
      friendIdSet,
      handleAddFriend,
      handleRemoveFriend,
      historyStatsByUserId,
      pendingFriendRequestIds,
      removingFriendById,
      token,
      userId,
      users,
    ],
  );

  const userRows = useMemo(
    () => rows.filter((user) => String(user.id ?? "").trim() !== userId.trim()),
    [rows, userId],
  );

  const normalizedSearch = debouncedSearchTerm.trim().toLowerCase();
  const filteredUsers =
    userRows?.filter((user) => {
      const id = String(user.id ?? "").trim();
      if (showFriendsOnlyUsers && !friendIdSet.has(id)) {
        return false;
      }
      if (!normalizedSearch) {
        return true;
      }
      const username = String(user.username ?? "").toLowerCase();
      const name = String(user.name ?? "").toLowerCase();
      const status = String(user.presenceLabel ?? "").toLowerCase();
      return (
        username.includes(normalizedSearch) ||
        name.includes(normalizedSearch) ||
        status.includes(normalizedSearch)
      );
    }) ?? [];

  const leaderboardRows = useMemo(
    () =>
      rows
        .filter((row) => row.overallRankValue != null)
        .sort((a, b) => {
          const rankDiff = (a.overallRankValue as number) - (b.overallRankValue as number);
          if (rankDiff !== 0) {
            return rankDiff;
          }
          const roundsDiff = (b.roundsPlayed ?? -1) - (a.roundsPlayed ?? -1);
          if (roundsDiff !== 0) {
            return roundsDiff;
          }
          return String(a.username ?? a.name ?? "").localeCompare(
            String(b.username ?? b.name ?? ""),
          );
        }),
    [rows],
  );

  const normalizedLeaderboardSearch = debouncedLeaderboardSearchTerm.trim().toLowerCase();
  const filteredLeaderboardRows =
    leaderboardRows?.filter((row) => {
      const id = String(row.id ?? "").trim();
      const isSelf = id.length > 0 && id === userId.trim();
      if (showFriendsOnlyLeaderboard && !isSelf && !friendIdSet.has(id)) {
        return false;
      }
      if (!normalizedLeaderboardSearch) {
        return true;
      }
      const username = String(row.username ?? row.name ?? "").toLowerCase();
      return username.includes(normalizedLeaderboardSearch);
    }) ?? [];

  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
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
            loading={!users}
            className="dashboard-container"
          >
            {users ? (
              <>
                <div className="users-overview-toolbar users-overview-toolbar-with-filters">
                  <Input
                    value={searchTerm}
                    allowClear
                    className="users-overview-search"
                    placeholder="Search by Username or Status"
                    onChange={(event) => setSearchTerm(event.target.value)}
                  />
                  <Checkbox
                    className="users-overview-filter-toggle"
                    checked={showFriendsOnlyUsers}
                    onChange={(event) => setShowFriendsOnlyUsers(event.target.checked)}
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
                  columns={columns}
                  dataSource={filteredUsers}
                  rowKey="key"
                  size="small"
                  tableLayout="fixed"
                  pagination={{
                    pageSize: USERS_PAGE_SIZE,
                    showSizeChanger: false,
                    hideOnSinglePage: false,
                    responsive: true,
                    position: ["bottomCenter"],
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
            <div className="users-overview-toolbar">
              <Input
                value={leaderboardSearchTerm}
                allowClear
                className="users-overview-search"
                placeholder="Search by Username"
                onChange={(event) => setLeaderboardSearchTerm(event.target.value)}
              />
              <Checkbox
                className="users-overview-filter-toggle"
                checked={showFriendsOnlyLeaderboard}
                onChange={(event) => setShowFriendsOnlyLeaderboard(event.target.checked)}
              >
                Show Friends Only
              </Checkbox>
            </div>
            <Table<UserRow>
              className="users-overview-table responsive-list-table"
              columns={leaderboardColumns}
              dataSource={filteredLeaderboardRows}
              rowKey="key"
              size="small"
              tableLayout="fixed"
              pagination={{
                pageSize: USERS_PAGE_SIZE,
                showSizeChanger: false,
                hideOnSinglePage: false,
                responsive: true,
                position: ["bottomCenter"],
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
            <div className="dashboard-button-stack">
              <Button type="default" onClick={handleBack}>
                {"\u2190"} Back
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
