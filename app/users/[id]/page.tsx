"use client"; // all users, even oneself, uses this page now, reworked as a result

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useApi } from "@/hooks/useApi";
import useLocalStorage from "@/hooks/useLocalStorage";
import InlineMusicPlayer from "@/components/InlineMusicPlayer";
import type { ApplicationError } from "@/types/error";
import { User } from "@/types/user";
import { toPresenceKey, toPresenceLabel } from "@/utils/presence";
import { resolveCharacterColorId } from "@/utils/userSettings";
import CharacterAvatar from "@/components/CharacterAvatar";
import { deriveUserOutcomeStatsFromHistoryPayload } from "@/utils/userHistoryStats";
import { formatLocalDate, formatLocalDateTime, localDateSearchToken, toEpochMs } from "@/utils/dateTime";
import { showTimedConfirmation } from "@/utils/timedConfirmation";
import { LoadingOutlined } from "@ant-design/icons";
import { Button, Card, Input, Table } from "antd";
import type { TableProps } from "antd";

const DEFAULT_BIO = "This player hasn't added a bio yet."; //placeholder default text
const RESULTS_PAGE_SIZE = 6; // can be changed
const NO_RESULTS_TEXT = "This user has not played a game yet."; // to show a line
const FRIEND_ACTION_MIN_LOADING_MS = 800;
const FRIEND_REQUEST_STATUS_POLL_MS = 4000;

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

type ProfileResultRow = {
  key: string;
  lobbyCode: string;
  historySessionCode: string | null;
  winnerUserId: string | null;
  playedAtText: string;
  playedAtSort: number;
  roundsText: string;
  roundsSort: number | null;
  scoreText: string;
  scoreSort: number | null;
  winnerName: string;
  isWinnerCurrentUser: boolean;
  isEmptyState?: boolean;
};

const EMPTY_RESULTS_ROW: ProfileResultRow = {
  key: "__NO_RESULTS__",
  lobbyCode: "-",
  historySessionCode: null,
  winnerUserId: null,
  playedAtText: "-",
  playedAtSort: 0,
  roundsText: "-",
  roundsSort: null,
  scoreText: "-",
  scoreSort: null,
  winnerName: NO_RESULTS_TEXT,
  isWinnerCurrentUser: false,
  isEmptyState: true,
};

function toDigitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

function toPlayedAtSearchToken(sortValue: number): string {
  return localDateSearchToken(sortValue);
}

function normalizeLower(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function isPlaceholderWinnerName(value: unknown): boolean {
  const name = String(value ?? "").trim();
  if (!name || name === "-") {
    return true;
  }
  return /^user\s+\d+$/i.test(name);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function extractResultsArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) {
    return raw;
  }

  const record = asRecord(raw);
  if (!record) {
    return [];
  }

  const candidates: unknown[] = [
    record.results,
    record.games,
    record.history,
    record.items,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatMaxOneFractionDigit(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return Number(value.toFixed(1)).toString();
}

function toKeyCandidates(value: unknown): string[] {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return [];
  }

  const candidates = new Set<string>([raw]);
  const numeric = toFiniteNumber(raw);
  if (numeric != null) {
    candidates.add(String(numeric));
    candidates.add(String(Math.trunc(numeric)));
  }

  return Array.from(candidates);
}

function idsReferToSameUser(left: unknown, right: unknown): boolean {
  const leftCandidates = toKeyCandidates(left);
  const rightCandidates = new Set(toKeyCandidates(right));
  if (leftCandidates.length === 0 || rightCandidates.size === 0) {
    return false;
  }
  return leftCandidates.some((candidate) => rightCandidates.has(candidate));
}

function pickMappedNumber(record: Record<string, unknown> | null, key: string): number | null {
  if (!record) {
    return null;
  }

  for (const candidate of toKeyCandidates(key)) {
    const value = toFiniteNumber(record[candidate]);
    if (value != null) {
      return value;
    }
  }

  return null;
}

function deriveWinnerFromScoreMap(
  scoreMap: Record<string, unknown> | null,
  viewedUserId: string,
  viewedUsername: string,
): { winnerId: string; winnerName: string } {
  if (!scoreMap) {
    return { winnerId: "", winnerName: "" };
  }

  const entries = Object.entries(scoreMap)
    .map(([id, value]) => ({
      id: String(id ?? "").trim(),
      score: toFiniteNumber(value),
    }))
    .filter((entry) => entry.id.length > 0 && entry.score != null);

  if (entries.length === 0) {
    return { winnerId: "", winnerName: "" };
  }

  const bestScore = Math.min(...entries.map((entry) => entry.score as number));
  const winners = entries.filter((entry) => entry.score === bestScore);
  if (winners.length !== 1) {
    return { winnerId: "", winnerName: "-" };
  }

  const winnerId = winners[0].id;
  const winnerName =
    idsReferToSameUser(winnerId, viewedUserId) && viewedUsername.trim().length > 0
      ? viewedUsername
      : `User ${winnerId}`;

  return { winnerId, winnerName };
}

function toReadableScore(value: number | null): string {
  if (value == null) {
    return "-";
  }

  return formatMaxOneFractionDigit(value);
}

function toReadableRounds(value: number | null): string {
  if (value == null) {
    return "-";
  }
  return formatMaxOneFractionDigit(value);
}

function toPlayedAtDisplay(value: unknown): { text: string; sortValue: number } {
  const sortValue = toEpochMs(value);
  if (sortValue > 0) {
    return {
      text: formatLocalDateTime(sortValue),
      sortValue,
    };
  }

  const rawText = String(value ?? "").trim();
  return { text: rawText || "-", sortValue: 0 };
}

function toProfileResultRows(
  raw: unknown,
  viewedUserId: string,
  loggedInUserId: string,
  viewedUsername: string,
): ProfileResultRow[] {
  const resultItems = extractResultsArray(raw);
  const rows: ProfileResultRow[] = [];

  resultItems.forEach((entry, index) => {
    const record = asRecord(entry);
    if (!record) {
      return;
    }

    const sessionRecord = asRecord(record.session);
    const lobbyRecord = asRecord(record.lobby);

    const historySessionCode = String(
      record.sessionId ??
      record.lobbyCode ??
      record.code ??
      sessionRecord?.sessionId ??
      sessionRecord?.code ??
      lobbyRecord?.sessionId ??
      lobbyRecord?.code ??
      record.lobbyId ??
      "",
    ).trim();
    const lobbyCode = historySessionCode || "-";

    const playedAtRaw =
      record.playedAt ??
      record.startTime ??
      record.finishedAt ??
      record.completedAt ??
      record.endedAt ??
      record.createdAt ??
      record.updatedAt;
    const playedAt = toPlayedAtDisplay(playedAtRaw);

    const scoreMap =
      asRecord(record.totalScoreByUserId) ??
      asRecord(record.userScores) ??
      asRecord(record.scores) ??
      asRecord(record.playerScores);
    const mappedScore = pickMappedNumber(scoreMap, viewedUserId);
    const roundsFromPerRound = Array.isArray(record.userScoresPerRound)
      ? record.userScoresPerRound.length
      : null;
    const score =
      mappedScore ??
      toFiniteNumber(record.userScore) ??
      toFiniteNumber(record.score) ??
      toFiniteNumber(record.points) ??
      toFiniteNumber(record.finalScore);
    const statsRecord = asRecord(record.stats);
    const rounds =
      toFiniteNumber(roundsFromPerRound) ??
      toFiniteNumber(record.rounds) ??
      toFiniteNumber(record.totalRounds) ??
      toFiniteNumber(record.roundCount) ??
      toFiniteNumber(record.currentRound) ??
      toFiniteNumber(statsRecord?.rounds) ??
      toFiniteNumber(statsRecord?.totalRounds);

    const winnerRecord = asRecord(record.winner);
    const derivedWinner = deriveWinnerFromScoreMap(scoreMap, viewedUserId, viewedUsername);
    const winnerIdRaw = String(
      record.winnerUserId ??
      record.winnerId ??
      winnerRecord?.id ??
      derivedWinner.winnerId ??
      "",
    ).trim();
    const winnerId = winnerIdRaw || derivedWinner.winnerId;
    const winnerName = String(
      record.winnerUsername ??
      record.winnerName ??
      winnerRecord?.username ??
      winnerRecord?.name ??
      derivedWinner.winnerName ??
      (winnerId ? `User ${winnerId}` : "-"),
    ).trim() || "-";

    const winnerById = Boolean(
      loggedInUserId.length > 0 &&
      winnerId.length > 0 &&
      idsReferToSameUser(winnerId, loggedInUserId),
    );
    const winnerByName = Boolean(
      winnerId.length === 0 &&
      loggedInUserId === viewedUserId &&
      normalizeLower(winnerName) === normalizeLower(viewedUsername),
    );

    rows.push({
      key: `${lobbyCode}-${playedAt.sortValue}-${index}`,
      lobbyCode,
      historySessionCode: historySessionCode || null,
      winnerUserId: winnerId || null,
      playedAtText: playedAt.text,
      playedAtSort: playedAt.sortValue,
      roundsText: toReadableRounds(rounds),
      roundsSort: rounds,
      scoreText: toReadableScore(score),
      scoreSort: score,
      winnerName,
      isWinnerCurrentUser: winnerById || winnerByName,
    });
  });

  return rows.sort((a, b) => {
    if (a.playedAtSort !== b.playedAtSort) {
      return b.playedAtSort - a.playedAtSort;
    }
    return a.lobbyCode.localeCompare(b.lobbyCode);
  });
}

const resultsColumns: TableProps<ProfileResultRow>["columns"] = [
  {
    title: "Date Played",
    dataIndex: "playedAtText",
    key: "playedAtText",
    width: 188,
    ellipsis: true,
    className: "profile-results-col-date",
    onHeaderCell: () => ({ className: "profile-results-head-date" }),
    sorter: (a, b) => a.playedAtSort - b.playedAtSort,
    render: (value: string, row) => (row.isEmptyState ? "-" : value),
  },
  {
    title: "Lobby Code",
    dataIndex: "lobbyCode",
    key: "lobbyCode",
    width: 112,
    ellipsis: true,
    className: "profile-results-col-lobby",
    onHeaderCell: () => ({ className: "profile-results-head-lobby" }),
    render: (value: string, row) => {
      const historyCode = String(row.historySessionCode ?? "").trim();
      if (row.isEmptyState || historyCode.length === 0) {
        return (
          <span className="table-ellipsis-text" title={row.isEmptyState ? "" : value}>
            {row.isEmptyState ? "-" : value}
          </span>
        );
      }

      return (
        <span
          className="table-ellipsis-text profile-results-history-link"
          title={`Open move history for ${historyCode}`}
        >
          {value}
        </span>
      );
    },
  },
  {
    title: "Rounds",
    dataIndex: "roundsText",
    key: "roundsText",
    width: 84,
    align: "center",
    className: "profile-results-col-rounds",
    onHeaderCell: () => ({ className: "profile-results-head-rounds" }),
    sorter: (a, b) => (a.roundsSort ?? -1) - (b.roundsSort ?? -1),
    render: (value: string, row) => (row.isEmptyState ? "-" : value),
  },
  {
    title: "Score",
    dataIndex: "scoreText",
    key: "scoreText",
    width: 80,
    align: "center",
    className: "profile-results-col-score",
    onHeaderCell: () => ({ className: "profile-results-head-score" }),
    sorter: (a, b) => (a.scoreSort ?? -1) - (b.scoreSort ?? -1),
    render: (value: string, row) => (row.isEmptyState ? "-" : value),
  },
  {
    title: "Winner",
    dataIndex: "winnerName",
    key: "winnerName",
    align: "right",
    ellipsis: false,
    render: (value: string, row) => {
      if (row.isEmptyState) {
        return <span className="profile-results-empty-text">{NO_RESULTS_TEXT}</span>;
      }

      return (
        <span className="profile-results-winner" title={value}>
          <span className={`profile-results-name${row.isWinnerCurrentUser ? " profile-results-name-self-winner" : ""}`}>
            {value}
          </span>
        </span>
      );
    },
  },
];

const UserProfilePage: React.FC = () => {
  const router = useRouter();
  const params = useParams<{ id?: string }>();
  const apiService = useApi();

  const { value: storedUserId } = useLocalStorage<string>("userId", "");
  const { value: token } = useLocalStorage<string>("token", "");

  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoadError, setProfileLoadError] = useState<string | null>(null);
  const [resultsRaw, setResultsRaw] = useState<unknown>([]);
  const [loadingResults, setLoadingResults] = useState(false);
  const [resultsLobbyCodeQuery, setResultsLobbyCodeQuery] = useState("");
  const [resultsDateQuery, setResultsDateQuery] = useState("");
  const [winnerNameByUserId, setWinnerNameByUserId] = useState<Record<string, string>>({});
  const [friendIds, setFriendIds] = useState<string[]>([]);
  const [pendingFriendRequestIds, setPendingFriendRequestIds] = useState<Record<string, true>>({});
  const [addingFriendById, setAddingFriendById] = useState<Record<string, boolean>>({});
  const [removingFriendById, setRemovingFriendById] = useState<Record<string, boolean>>({});

  const viewedUserId = String(params?.id ?? "").trim();
  const ownUserId = String(storedUserId ?? "").trim();
  const isOwnProfile = viewedUserId.length > 0 && ownUserId === viewedUserId;
  const authToken = String(token ?? "").trim();

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

  const loadFriendIds = useCallback(async () => {
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
  }, [apiService, authToken]);

  const loadOutgoingPendingFriendRequestIds = useCallback(async () => {
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
  }, [apiService, authToken]);

  const handleAddFriend = useCallback(async (targetUserId: string, targetUsername: string) => {
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
  }, [apiService, authToken, loadFriendIds, loadOutgoingPendingFriendRequestIds]);

  const handleRemoveFriend = useCallback(async (targetUserId: string, targetUsername: string) => {
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
  }, [apiService, authToken, loadFriendIds, loadOutgoingPendingFriendRequestIds]);

  useEffect(() => {
    if (!viewedUserId) {
      router.replace("/users");
      return;
    }

    let active = true;

    const fetchUser = async () => {
      setLoading(true);
      setProfileLoadError(null);
      try {
        const fetched = authToken
          ? await apiService.getWithAuth<User>(`/users/${encodeURIComponent(viewedUserId)}`, authToken)
          : await apiService.get<User>(`/users/${encodeURIComponent(viewedUserId)}`);
        if (!active) {
          return;
        }
        setUser(fetched);
      } catch (error) {
        if (active && error instanceof Error) {
          setUser(null);
          setProfileLoadError(error.message);
          alert(`Could not load profile:\n${error.message}`);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void fetchUser();

    return () => {
      active = false;
    };
  }, [apiService, authToken, viewedUserId, router]);

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
  }, [authToken, loadFriendIds, loadOutgoingPendingFriendRequestIds, reconcilePendingRequests]);

  useEffect(() => {
    if (!viewedUserId) {
      setResultsRaw([]);
      setLoadingResults(false);
      setWinnerNameByUserId({});
      return;
    }

    let active = true;

    const loadResults = async () => {
      setLoadingResults(true);

      const authToken = String(token ?? "").trim();
      const unavailableStatuses = new Set<number>([404, 405, 501]);
      const endpoint = `/users/${encodeURIComponent(viewedUserId)}/results`;

      try {
        const response = authToken
          ? await apiService.getWithAuth<unknown>(endpoint, authToken)
          : await apiService.get<unknown>(endpoint);

        if (active) {
          setResultsRaw(response);
        }
        return;
      } catch (error: unknown) {
        const status = (error as ApplicationError)?.status;
        if (!unavailableStatuses.has(status ?? -1)) {
          console.error("Could not load user game results:", error);
          if (active) {
            setResultsRaw([]);
          }
          return;
        }
      }

      if (!authToken) {
        if (active) {
          setResultsRaw([]);
        }
        return;
      }

      const historyEndpoint = `/users/${encodeURIComponent(viewedUserId)}/history`;
      try {
        const historyResponse = await apiService.getWithAuth<unknown>(historyEndpoint, authToken);
        if (active) {
          setResultsRaw(historyResponse);
        }
        return;
      } catch (error: unknown) {
        const status = (error as ApplicationError)?.status;
        if (status !== 403 && status !== 404 && status !== 405) {
          console.error("Could not load user game history fallback:", error);
        }
      }

      if (active) {
        setResultsRaw([]);
      }
    };

    void loadResults().finally(() => {
      if (active) {
        setLoadingResults(false);
      }
    });

    return () => {
      active = false;
    };
  }, [apiService, token, viewedUserId]);

  const resultsRows = useMemo(() => {
    const rows = toProfileResultRows(
      resultsRaw,
      viewedUserId,
      ownUserId,
      String(user?.username ?? ""),
    );
    return rows.length > 0 ? rows : [EMPTY_RESULTS_ROW];
  }, [resultsRaw, viewedUserId, ownUserId, user?.username]);

  const filteredResultsRows = useMemo(() => {
    const lobbyCodeQuery = resultsLobbyCodeQuery.trim().toLowerCase();
    const dateQueryDigits = toDigitsOnly(resultsDateQuery.trim());
    const hasFilters = lobbyCodeQuery.length > 0 || dateQueryDigits.length > 0;

    if (!hasFilters) {
      return resultsRows;
    }

    if (resultsRows.length === 1 && resultsRows[0].isEmptyState) {
      return resultsRows;
    }

    return resultsRows.filter((row) => {
      if (row.isEmptyState) {
        return false;
      }

      const lobbyCodeMatches =
        lobbyCodeQuery.length === 0 ||
        row.lobbyCode.toLowerCase().includes(lobbyCodeQuery);
      if (!lobbyCodeMatches) {
        return false;
      }

      if (dateQueryDigits.length === 0) {
        return true;
      }

      const playedAtToken = toPlayedAtSearchToken(row.playedAtSort);
      const playedAtTextDigits = toDigitsOnly(row.playedAtText);

      return (
        playedAtToken.includes(dateQueryDigits) ||
        playedAtTextDigits.includes(dateQueryDigits)
      );
    });
  }, [resultsRows, resultsLobbyCodeQuery, resultsDateQuery]);

  useEffect(() => {
    const preferredViewedName = String(user?.username ?? "").trim();
    const seededWinnerNames: Record<string, string> = {};

    if (viewedUserId && preferredViewedName.length > 0) {
      seededWinnerNames[viewedUserId] = preferredViewedName;
    }

    resultsRows.forEach((row) => {
      if (row.isEmptyState || !row.winnerUserId) {
        return;
      }
      if (preferredViewedName.length > 0 && idsReferToSameUser(row.winnerUserId, viewedUserId)) {
        return;
      }
      const candidateName = String(row.winnerName ?? "").trim();
      if (isPlaceholderWinnerName(candidateName)) {
        return;
      }
      seededWinnerNames[row.winnerUserId] = candidateName;
    });

    setWinnerNameByUserId((previous) => {
      let changed = false;
      const next = { ...previous };
      Object.entries(seededWinnerNames).forEach(([id, name]) => {
        if (!name || (next[id] && next[id].trim().length > 0)) {
          return;
        }
        next[id] = name;
        changed = true;
      });
      return changed ? next : previous;
    });

    const unresolvedWinnerIds = Array.from(
      new Set(
        resultsRows
          .filter((row) => !row.isEmptyState && row.winnerUserId)
          .filter((row) => isPlaceholderWinnerName(row.winnerName))
          .map((row) => String(row.winnerUserId)),
      ),
    ).filter((winnerId) => {
      const cachedName = String(winnerNameByUserId[winnerId] ?? "").trim();
      return cachedName.length === 0;
    });

    if (unresolvedWinnerIds.length === 0) {
      return;
    }

    let active = true;
    void Promise.all(
      unresolvedWinnerIds.map(async (winnerId) => {
        try {
          const fetchedUser = await apiService.get<User>(`/users/${encodeURIComponent(winnerId)}`);
          const winnerName = String(fetchedUser?.username ?? fetchedUser?.name ?? "").trim();
          return [winnerId, winnerName] as const;
        } catch {
          return [winnerId, ""] as const;
        }
      }),
    ).then((resolvedEntries) => {
      if (!active) {
        return;
      }
      setWinnerNameByUserId((previous) => {
        let changed = false;
        const next = { ...previous };
        resolvedEntries.forEach(([winnerId, winnerName]) => {
          if (!winnerName || next[winnerId]) {
            return;
          }
          next[winnerId] = winnerName;
          changed = true;
        });
        return changed ? next : previous;
      });
    });

    return () => {
      active = false;
    };
  }, [apiService, resultsRows, user?.username, viewedUserId, winnerNameByUserId]);

  const displayResultsRows = useMemo(
    () => filteredResultsRows.map((row) => {
      if (row.isEmptyState || !row.winnerUserId) {
        return row;
      }
      const winnerName = String(winnerNameByUserId[row.winnerUserId] ?? "").trim();
      if (!winnerName) {
        return row;
      }
      return {
        ...row,
        winnerName,
      };
    }),
    [filteredResultsRows, winnerNameByUserId],
  );

  const hasActiveResultsFilters =
    resultsLobbyCodeQuery.trim().length > 0 || resultsDateQuery.trim().length > 0;

  const handleSpectateFromProfile = async (sourcePresence: ReturnType<typeof toPresenceKey>) => {
    if (viewedUserId.length === 0) {
      return;
    }
    const sessionId = String(user?.joinableSessionId ?? "").trim();
    if (!sessionId) {
      const sourceLabel =
        sourcePresence === "playing"
          ? "playing"
          : sourcePresence === "lobby"
            ? "lobby"
            : "spectating";
      alert(`This user's ${sourceLabel} session is currently unavailable.`);
      return;
    }

    const usernameLabel = String(user?.username ?? user?.name ?? viewedUserId).trim() || "this user";
    const confirmed = await showTimedConfirmation({
      title: `Do you want to spectate ${usernameLabel}?`,
      timeoutSeconds: 10,
    });
    if (!confirmed) {
      return;
    }

    router.push(`/spectator?sessionId=${encodeURIComponent(sessionId)}`);
  };

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

  const creationDateRaw = String(user?.creationDate ?? "").trim();
  const creationDate = creationDateRaw ? formatLocalDate(creationDateRaw, creationDateRaw) : "-";
  const rankNumber = toFiniteNumber(user?.overallRank);
  const rank = rankNumber == null
    ? (user?.overallRank ?? "-")
    : formatMaxOneFractionDigit(rankNumber);
  const derivedOutcomeStats = useMemo(
    () => deriveUserOutcomeStatsFromHistoryPayload(resultsRaw, viewedUserId),
    [resultsRaw, viewedUserId],
  );
  const roundsPlayedRaw = derivedOutcomeStats.roundsPlayed;
  const roundsPlayed = Number.isFinite(Number(roundsPlayedRaw))
    ? Number(roundsPlayedRaw)
    : null;
  const roundsPlayedText = roundsPlayed == null ? "-" : formatMaxOneFractionDigit(roundsPlayed);
  const roundsWonRaw = derivedOutcomeStats.roundsWon;
  const roundsWon = Number.isFinite(Number(roundsWonRaw))
    ? Number(roundsWonRaw)
    : null;
  const roundsWonRatePct =
    roundsPlayed != null && roundsPlayed > 0 && roundsWon != null ? (roundsWon / roundsPlayed) * 100 : null;
  const roundsWonRateText = roundsWonRatePct == null
    ? "-"
    : `${formatMaxOneFractionDigit(roundsWon as number)}/${formatMaxOneFractionDigit(roundsPlayed as number)} (${Number(roundsWonRatePct).toFixed(1).replace(/\.0$/, "")}%)`;
  const gamesWonRaw = derivedOutcomeStats.gamesWon;
  const gamesWon = Number.isFinite(Number(gamesWonRaw))
    ? Number(gamesWonRaw)
    : null;
  const gamesPlayedRaw = derivedOutcomeStats.gamesPlayed;
  const gamesPlayed = Number.isFinite(Number(gamesPlayedRaw))
    ? Number(gamesPlayedRaw)
    : null;
  const gamesWonRatePct =
    gamesPlayed != null && gamesPlayed > 0 && gamesWon != null ? (gamesWon / gamesPlayed) * 100 : null;
  const gamesWonRateText = gamesWonRatePct == null
    ? "-"
    : `${formatMaxOneFractionDigit(gamesWon as number)}/${formatMaxOneFractionDigit(gamesPlayed as number)} (${Number(gamesWonRatePct).toFixed(1).replace(/\.0$/, "")}%)`;
  const losses =
    gamesPlayed != null && gamesWon != null
      ? Math.max(0, gamesPlayed - gamesWon)
      : null;
  const averageScoreRaw = derivedOutcomeStats.averageScorePerRound;
  const averageScore =
    averageScoreRaw == null || !Number.isFinite(Number(averageScoreRaw))
      ? "-"
      : formatMaxOneFractionDigit(Number(averageScoreRaw));
  const shownBio = (user?.bio ?? "").trim() || DEFAULT_BIO;
  const isDefaultBio = shownBio === DEFAULT_BIO;
  const profilePresenceKey = toPresenceKey(user?.status);
  const profilePresenceLabel = user ? toPresenceLabel(profilePresenceKey) : "";
  const sessionIdHint = String(user?.joinableSessionId ?? "").trim();
  const canSpectateFromProfileStatus =
    (profilePresenceKey === "spectating" || profilePresenceKey === "lobby" || profilePresenceKey === "playing") &&
    viewedUserId.length > 0 &&
    sessionIdHint.length > 0;
  const profileSpectateSourceLabel =
    profilePresenceKey === "playing"
      ? "Playing"
      : profilePresenceKey === "spectating"
        ? "Spectating"
        : "In lobby";
  const canStatusActionFromProfile = canSpectateFromProfileStatus;
  const profileStatusTitle = canSpectateFromProfileStatus
    ? (sessionIdHint
        ? `${profileSpectateSourceLabel} ${sessionIdHint}. Click to spectate.`
        : `${profileSpectateSourceLabel}. Click to spectate.`)
    : profilePresenceLabel;
  const viewedUsername = String(user?.username ?? user?.name ?? viewedUserId).trim() || "this user";
  const friendIdSet = useMemo(() => new Set(friendIds), [friendIds]);
  const isFriend = viewedUserId.length > 0 && friendIdSet.has(viewedUserId);
  const isAddingFriend = viewedUserId.length > 0 && Boolean(addingFriendById[viewedUserId]);
  const isRemovingFriend = viewedUserId.length > 0 && Boolean(removingFriendById[viewedUserId]);
  const isPendingFriendRequest =
    viewedUserId.length > 0 &&
    Boolean(pendingFriendRequestIds[viewedUserId]) &&
    !isAddingFriend;
  const canAddFriend =
    !isOwnProfile &&
    viewedUserId.length > 0 &&
    authToken.length > 0 &&
    !isFriend &&
    !isPendingFriendRequest &&
    !isRemovingFriend;
  const canRemoveFriend =
    !isOwnProfile &&
    viewedUserId.length > 0 &&
    authToken.length > 0 &&
    isFriend;
  const shouldShowProfileFriendButton =
    !isOwnProfile &&
    viewedUserId.length > 0 &&
    authToken.length > 0;
  const profileFriendButtonLoading = isAddingFriend || isRemovingFriend || isPendingFriendRequest;
  const profileFriendActionLabel = canAddFriend
    ? "Add Friend"
    : canRemoveFriend
      ? "Remove Friend"
      : "Friend Request Sent";

  return (
    <div className="cabo-background">
      <div className="login-container">
        <div className="create-lobby-stack dashboard-stack">
          <Card
            loading={loading}
            className="dashboard-container"
            title={
              <div className="lobby-section-title-row">
                <span className="dashboard-section-title">{user?.username?.trim() || "User Profile"}</span>
                {!loading && user ? (
                  <div className="users-status-action profile-title-status-action">
                    {shouldShowProfileFriendButton ? (
                      canRemoveFriend ? (
                        <Button
                          type="default"
                          className="users-friend-remove-btn"
                          title={profileFriendActionLabel}
                          aria-label={profileFriendActionLabel}
                          disabled={!canRemoveFriend || profileFriendButtonLoading}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (profileFriendButtonLoading) {
                              return;
                            }
                            void handleRemoveFriend(viewedUserId, viewedUsername);
                          }}
                        >
                          {profileFriendButtonLoading ? (
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
                          title={profileFriendActionLabel}
                          aria-label={profileFriendActionLabel}
                          disabled={!canAddFriend || profileFriendButtonLoading}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (profileFriendButtonLoading) {
                              return;
                            }
                            void handleAddFriend(viewedUserId, viewedUsername);
                          }}
                        >
                          {profileFriendButtonLoading ? (
                            <LoadingOutlined spin className="users-friend-action-loading-icon" />
                          ) : (
                            <span className="users-friend-action-symbol users-friend-action-symbol-plus">{"\u002b"}</span>
                          )}
                        </Button>
                      )
                    ) : null}
                    <span
                      className={`users-status-pill users-status-${profilePresenceKey} profile-title-status${canStatusActionFromProfile ? " users-status-pill-action" : ""}`}
                      title={profileStatusTitle}
                      role={canStatusActionFromProfile ? "button" : undefined}
                      tabIndex={canStatusActionFromProfile ? 0 : undefined}
                      onClick={(event) => {
                        if (!canStatusActionFromProfile) {
                          return;
                        }
                        event.stopPropagation();
                        void handleSpectateFromProfile(profilePresenceKey);
                      }}
                      onKeyDown={(event) => {
                        if (!canStatusActionFromProfile || (event.key !== "Enter" && event.key !== " ")) {
                          return;
                        }
                        event.preventDefault();
                        event.stopPropagation();
                        void handleSpectateFromProfile(profilePresenceKey);
                      }}
                    >
                      {profilePresenceLabel}
                    </span>
                  </div>
                ) : null}
              </div>
            }
          >
            {!loading && user ? (
              <div className="profile-grid">
                <div className="profile-hero-row">
                  <div className="profile-hero-avatar-wrap" aria-hidden="true">
                    <CharacterAvatar
                      characterId={user?.profileCharacterId}
                      primaryColorId={resolveCharacterColorId(user?.preferredColorPriority)}
                      autoBlink
                      alt=""
                      width={156}
                      height={156}
                      className="profile-hero-avatar"
                    />
                  </div>
                  <div className="profile-hero-content">
                    <div className="profile-bio-block">
                      <div className="profile-bio-head">
                        <span className="profile-key">Bio</span>
                        {isOwnProfile ? (
                          <Button
                            type="default"
                            size="small"
                            className="profile-bio-edit-inline-btn"
                            onClick={() => router.push("/settings")}
                          >
                            Edit Profile
                          </Button>
                        ) : null}
                      </div>
                      <div className="profile-hero-bio-content">
                        <p className={`profile-bio-text${isDefaultBio ? " profile-bio-text-placeholder" : ""}`}>
                          {shownBio}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="profile-row">
                  <span className="profile-key">Creation Date</span>
                  <span className="profile-value">{creationDate}</span>
                </div>
                <div className="profile-row">
                  <span className="profile-key">Rank</span>
                  <span className="profile-value">{rank}</span>
                </div>
                <div className="profile-stat-gap" aria-hidden="true" />
                <div className="profile-row">
                  <span className="profile-key">Rounds</span>
                  <span className="profile-value">{roundsPlayedText}</span>
                </div>
                <div className="profile-row">
                  <span className="profile-key">Losses</span>
                  <span className="profile-value">
                    {losses == null ? "-" : losses}
                  </span>
                </div>
                <div className="profile-stat-gap" aria-hidden="true" />
                <div className="profile-row">
                  <span className="profile-key">Average Score per Round</span>
                  <span className="profile-value">{averageScore}</span>
                </div>
                <div className="profile-row">
                  <span className="profile-key">Rounds Won %</span>
                  <span className="profile-value">{roundsWonRateText}</span>
                </div>
                <div className="profile-row">
                  <span className="profile-key">Games Won %</span>
                  <span className="profile-value">{gamesWonRateText}</span>
                </div>
              </div>
            ) : null}

            {!loading && !user ? (
              <p className="profile-results-empty-text">
                {profileLoadError
                  ? `Could not load user profile: ${profileLoadError}`
                  : "Could not load user profile."}
              </p>
            ) : null}
          </Card>

          <Card
            className="dashboard-container"
            title={
              <div className="lobby-section-title-row">
                <span className="dashboard-section-title">Results</span>
                <Button
                  type="default"
                  size="small"
                  onClick={() => {
                    if (typeof window !== "undefined") {
                      window.location.reload();
                    }
                  }}
                >
                  Refresh
                </Button>
              </div>
            }
          >
            {!loadingResults && gamesPlayed === 0 ? (
              <p className="profile-results-empty-text">No games played yet.</p>
            ) : (
              <>
                <div className="profile-results-filters">
                  <Input
                    allowClear
                    className="users-overview-search"
                    placeholder="Search Lobby Code"
                    value={resultsLobbyCodeQuery}
                    onChange={(event) => setResultsLobbyCodeQuery(event.target.value)}
                  />
                  <Input
                    allowClear
                    className="users-overview-search"
                    placeholder="Search Date Played (local format)"
                    value={resultsDateQuery}
                    onChange={(event) => setResultsDateQuery(event.target.value)}
                  />
                </div>
                <Table<ProfileResultRow>
                  className="users-overview-table profile-results-table responsive-list-table"
                  columns={resultsColumns}
                  dataSource={displayResultsRows}
                  rowKey="key"
                  size="small"
                  tableLayout="fixed"
                  loading={loadingResults}
                  pagination={{
                    pageSize: RESULTS_PAGE_SIZE,
                    showSizeChanger: false,
                    hideOnSinglePage: false,
                    responsive: true,
                    position: ["bottomCenter"],
                  }}
                  rowClassName={() => "profile-results-row"}
                  onRow={(row) => {
                    const historyCode = String(row.historySessionCode ?? "").trim();
                    if (row.isEmptyState || historyCode.length === 0) {
                      return {};
                    }
                    return {
                      onClick: () => {
                        router.push(`/history/${encodeURIComponent(historyCode)}`);
                      },
                      onKeyDown: (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          router.push(`/history/${encodeURIComponent(historyCode)}`);
                        }
                      },
                      tabIndex: 0,
                      role: "link",
                      style: { cursor: "pointer" },
                    };
                  }}
                  locale={{
                    emptyText: hasActiveResultsFilters
                      ? "No results match the current search."
                      : NO_RESULTS_TEXT,
                  }}
                />
              </>
            )}
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

export default UserProfilePage;
