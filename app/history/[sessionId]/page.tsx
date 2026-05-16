"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useApi } from "@/hooks/useApi";
import useLocalStorage from "@/hooks/useLocalStorage";
import InlineMusicPlayer from "@/components/InlineMusicPlayer";
import type { ApplicationError } from "@/types/error";
import type { User } from "@/types/user";
import { formatLocalDateTime, toEpochMs } from "@/utils/dateTime";
import { Button, Card, Spin, Table } from "antd";
import type { TableProps } from "antd";

type SessionScorePlayer = {
  userId: number;
  username: string;
  totalScore: number | null;
  roundScores: Array<number | null>;
  isSpecialWin: boolean;
};

type SessionScoreSnapshot = {
  players: SessionScorePlayer[];
  totalRounds: number;
  sessionCode: string;
};

type HistoryScoreRow = {
  key: string;
  placeBadge: string;
  userId: number;
  username: string;
  isWinner: boolean;
  isSelf: boolean;
  isSpecialWin: boolean;
  totalScore: number | null;
  totalScoreText: string;
} & Record<string, unknown>;

const NO_RESULTS_TEXT = "No results found for this session.";

function normalizeValue(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function toPlainRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toFiniteScore(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNumericUserId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toUserIdKeyCandidates(userId: number): string[] {
  const asInt = Math.trunc(userId);
  return Array.from(new Set([String(userId), String(asInt)]));
}

function getMappedScore(record: Record<string, unknown> | null, userId: number): number | null {
  if (!record) {
    return null;
  }

  for (const candidateKey of toUserIdKeyCandidates(userId)) {
    const value = toFiniteScore(record[candidateKey]);
    if (value != null) {
      return value;
    }
  }

  return null;
}

function extractScoreboardRecords(payload: unknown): Record<string, unknown>[] {
  const root = toPlainRecord(payload);
  if (!root) {
    return [];
  }

  const candidates: Record<string, unknown>[] = [root];
  const nestedKeys = ["game", "session", "state", "data"];
  for (const key of nestedKeys) {
    const nested = toPlainRecord(root[key]);
    if (nested) {
      candidates.push(nested);
    }
  }

  return candidates;
}

function extractRoundScoreMaps(payload: unknown): Record<string, unknown>[] {
  const keys = [
    "userScoresPerRound",
    "roundScoresPerRound",
    "roundScores",
  ];

  for (const record of extractScoreboardRecords(payload)) {
    for (const key of keys) {
      const candidate = record[key];
      if (!Array.isArray(candidate)) {
        continue;
      }

      const maps = candidate
        .map((entry) => toPlainRecord(entry))
        .filter((entry): entry is Record<string, unknown> => entry != null);

      if (maps.length > 0) {
        return maps;
      }
    }
  }

  return [];
}

function extractTotalScoreMap(payload: unknown): Record<string, unknown> | null {
  const keys = [
    "totalScoreByUserId",
    "totalScoresByUserId",
    "userTotalScores",
    "scoresByUserId",
    "totalScores",
  ];

  for (const record of extractScoreboardRecords(payload)) {
    for (const key of keys) {
      const candidate = toPlainRecord(record[key]);
      if (candidate) {
        return candidate;
      }
    }
  }

  return null;
}

function extractPayloadPlayerMeta(payload: unknown): Array<{
  userId: number;
  username: string;
  totalScore: number | null;
  roundScore: number | null;
  isSpecialWin: boolean;
}> {
  const out: Array<{
    userId: number;
    username: string;
    totalScore: number | null;
    roundScore: number | null;
    isSpecialWin: boolean;
  }> = [];

  for (const record of extractScoreboardRecords(payload)) {
    const playersRaw = record.players;
    if (!Array.isArray(playersRaw)) {
      continue;
    }

    for (const entry of playersRaw) {
      const player = toPlainRecord(entry);
      if (!player) {
        continue;
      }

      const userId = toNumericUserId(player.userId ?? player.id);
      if (userId == null) {
        continue;
      }

      out.push({
        userId,
        username: String(player.username ?? player.name ?? "").trim(),
        totalScore: toFiniteScore(player.totalScore),
        roundScore: toFiniteScore(player.roundScore),
        isSpecialWin: player.isSpecialWin === true,
      });
    }

    if (out.length > 0) {
      return out;
    }
  }

  return out;
}

function buildFinalRoundScoresSnapshot(
  payload: unknown,
  fallbackPlayerIds: number[],
  playerNamesById: Record<number, string>,
): { players: SessionScorePlayer[]; totalRounds: number } | null {
  const roundScoreMaps = extractRoundScoreMaps(payload);
  const totalScoreMap = extractTotalScoreMap(payload);
  const payloadPlayers = extractPayloadPlayerMeta(payload);
  const payloadPlayerById = new Map<number, (typeof payloadPlayers)[number]>();
  payloadPlayers.forEach((entry) => {
    payloadPlayerById.set(entry.userId, entry);
  });

  let totalRounds = roundScoreMaps.length;
  if (totalRounds === 0 && payloadPlayers.some((entry) => entry.roundScore != null)) {
    totalRounds = 1;
  }

  const allIds = new Set<number>();
  fallbackPlayerIds.forEach((id) => allIds.add(id));
  payloadPlayers.forEach((entry) => allIds.add(entry.userId));

  if (totalScoreMap) {
    Object.keys(totalScoreMap).forEach((key) => {
      const parsedId = toNumericUserId(key);
      if (parsedId != null) {
        allIds.add(parsedId);
      }
    });
  }

  roundScoreMaps.forEach((roundMap) => {
    Object.keys(roundMap).forEach((key) => {
      const parsedId = toNumericUserId(key);
      if (parsedId != null) {
        allIds.add(parsedId);
      }
    });
  });

  if (allIds.size === 0) {
    return null;
  }

  const orderedIds: number[] = [];
  fallbackPlayerIds.forEach((id) => {
    if (allIds.has(id) && !orderedIds.includes(id)) {
      orderedIds.push(id);
    }
  });

  payloadPlayers.forEach((entry) => {
    if (!orderedIds.includes(entry.userId)) {
      orderedIds.push(entry.userId);
    }
  });

  Array.from(allIds)
    .sort((a, b) => a - b)
    .forEach((id) => {
      if (!orderedIds.includes(id)) {
        orderedIds.push(id);
      }
    });

  const players: SessionScorePlayer[] = orderedIds.map((userId) => {
    const payloadMeta = payloadPlayerById.get(userId);
    const roundScores = Array.from({ length: totalRounds }, () => null as number | null);

    roundScoreMaps.forEach((roundMap, roundIndex) => {
      roundScores[roundIndex] = getMappedScore(roundMap, userId);
    });

    if (totalRounds > 0 && payloadMeta?.roundScore != null && roundScores[totalRounds - 1] == null) {
      roundScores[totalRounds - 1] = payloadMeta.roundScore;
    }

    let totalScore = getMappedScore(totalScoreMap, userId);
    if (totalScore == null) {
      totalScore = payloadMeta?.totalScore ?? null;
    }
    if (totalScore == null && roundScores.length > 0 && roundScores.every((value) => value != null)) {
      totalScore = roundScores.reduce((sum, value) => sum + Number(value), 0);
    }

    const username = String(
      payloadMeta?.username ||
      playerNamesById[userId] ||
      `Player ${userId}`,
    ).trim();

    return {
      userId,
      username: username || `Player ${userId}`,
      totalScore,
      roundScores,
      isSpecialWin: payloadMeta?.isSpecialWin === true,
    };
  });

  return { players, totalRounds };
}

function extractSessionHistoryEntries(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload
      .map((entry) => toPlainRecord(entry))
      .filter((entry): entry is Record<string, unknown> => entry != null);
  }

  const root = toPlainRecord(payload);
  if (!root) {
    return [];
  }

  const candidateArrays = [root.history, root.results, root.items, root.sessions];
  for (const candidate of candidateArrays) {
    if (!Array.isArray(candidate)) {
      continue;
    }

    const entries = candidate
      .map((entry) => toPlainRecord(entry))
      .filter((entry): entry is Record<string, unknown> => entry != null);
    if (entries.length > 0) {
      return entries;
    }
  }

  if (root.sessionId != null || root.totalScoreByUserId != null || root.userScoresPerRound != null) {
    return [root];
  }

  return [];
}

function extractSessionHistoryCode(entry: Record<string, unknown>): string {
  const nestedSession = toPlainRecord(entry.session);
  return String(
    entry.sessionId ??
    nestedSession?.sessionId ??
    entry.code ??
    nestedSession?.code ??
    "",
  ).trim();
}

function selectSessionHistoryEntry(
  entries: Record<string, unknown>[],
  preferredSessionId: string,
): Record<string, unknown> | null {
  if (entries.length === 0) {
    return null;
  }

  const preferredId = normalizeValue(preferredSessionId);
  if (preferredId) {
    const exactMatch = entries.find(
      (entry) => normalizeValue(extractSessionHistoryCode(entry)) === preferredId,
    );
    if (exactMatch) {
      return exactMatch;
    }
  }

  const orderedByDate = [...entries].sort((a, b) => {
    const aTime = toEpochMs(a.startTime ?? a.playedAt ?? a.finishedAt ?? a.updatedAt ?? a.createdAt);
    const bTime = toEpochMs(b.startTime ?? b.playedAt ?? b.finishedAt ?? b.updatedAt ?? b.createdAt);
    return bTime - aTime;
  });
  return orderedByDate[0] ?? null;
}

function buildSessionHistoryScoresSnapshot(
  payload: unknown,
  preferredSessionId: string,
  fallbackPlayerIds: number[],
  playerNamesById: Record<number, string>,
): SessionScoreSnapshot | null {
  const entries = extractSessionHistoryEntries(payload);
  const selectedEntry = selectSessionHistoryEntry(entries, preferredSessionId);
  if (!selectedEntry) {
    return null;
  }

  const snapshot = buildFinalRoundScoresSnapshot(
    selectedEntry,
    fallbackPlayerIds,
    playerNamesById,
  );
  if (!snapshot) {
    return null;
  }

  return {
    players: snapshot.players,
    totalRounds: snapshot.totalRounds,
    sessionCode: extractSessionHistoryCode(selectedEntry) || preferredSessionId,
  };
}

function toPlaceBadge(rank: number): string {
  if (rank === 1) return "\uD83E\uDD47";
  if (rank === 2) return "\uD83E\uDD48";
  if (rank === 3) return "\uD83E\uDD49";
  if (rank === 4) return "4.";
  return `${rank}.`;
}

function toScoreText(value: number | null): string {
  if (value == null) {
    return "-";
  }
  return String(Math.trunc(value));
}

function sortPlayersByScore(players: SessionScorePlayer[]): SessionScorePlayer[] {
  return [...players].sort((a, b) => {
    const scoreA = a.totalScore;
    const scoreB = b.totalScore;

    if (scoreA == null && scoreB == null) {
      return a.username.localeCompare(b.username);
    }
    if (scoreA == null) return 1;
    if (scoreB == null) return -1;
    if (scoreA !== scoreB) return scoreA - scoreB;
    return a.username.localeCompare(b.username);
  });
}

function toRoundColumnKey(roundNumber: number): string {
  return `round_${roundNumber}`;
}

const MAX_VISIBLE_ROUND_COLUMNS = 7;
const ROUND_MOVES_EMPTY_TEXT = "No move history found for this player in this round.";

type SessionMoveLogEntry = {
  key: string;
  userId: number | null;
  username: string;
  actionType: string;
  details: string;
  timestampMs: number;
  timestampText: string;
  inferredRound: number;
};

type SelectedRoundScore = {
  userId: number;
  username: string;
  roundNumber: number;
  scoreText: string;
};

function toMoveTimestampText(epochMs: number): string {
  return formatLocalDateTime(epochMs);
}

function normalizeActionType(actionType: string): string {
  const trimmed = String(actionType ?? "").trim();
  if (!trimmed) {
    return "MOVE";
  }
  return trimmed
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function extractRoundHint(value: string): number | null {
  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }

  const patterns = [
    /(?:^|\s|[({[])round\s*[:#-]?\s*(\d+)(?:\s|$|[)}\]])/i,
    /(?:^|\s|[({[])r\s*[:#-]?\s*(\d+)(?:\s|$|[)}\]])/i,
  ];
  for (const pattern of patterns) {
    const matched = text.match(pattern);
    if (!matched) {
      continue;
    }
    const parsed = Number(matched[1]);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.trunc(parsed);
    }
  }

  return null;
}

function isRoundBoundaryMove(actionType: string, details: string): boolean {
  const normalizedAction = normalizeActionType(actionType);
  const upperDetails = String(details ?? "").toUpperCase();
  return (
    normalizedAction.includes("CABO") ||
    normalizedAction.includes("ROUND END") ||
    normalizedAction.includes("ROUND_ENDED") ||
    normalizedAction.includes("ROUND AWAITING REMATCH") ||
    upperDetails.includes("ROUND END")
  );
}

function extractSessionMoveLogEntriesPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  const root = toPlainRecord(payload);
  if (!root) {
    return [];
  }

  const arrayKeys = ["logs", "moves", "entries", "items", "history", "data"];
  for (const key of arrayKeys) {
    const candidate = root[key];
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  const nestedData = toPlainRecord(root.data);
  if (nestedData) {
    for (const key of ["logs", "moves", "entries", "items", "history"]) {
      const nestedCandidate = nestedData[key];
      if (Array.isArray(nestedCandidate)) {
        return nestedCandidate;
      }
    }
  }

  return [];
}

function parseSessionMoveLogEntries(payload: unknown): SessionMoveLogEntry[] {
  const rawEntries = extractSessionMoveLogEntriesPayload(payload);
  if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
    return [];
  }

  const extracted = rawEntries
    .map((entry, index) => {
      const record = toPlainRecord(entry);
      if (!record) {
        return null;
      }

      const userId = toNumericUserId(record.userId ?? record.playerId ?? record.id);
      const username = String(record.username ?? record.playerName ?? "").trim();
      const actionType = String(record.actionType ?? record.action ?? record.type ?? "").trim();
      const details = String(record.details ?? record.description ?? record.message ?? "").trim();
      const timestampMs = toEpochMs(
        record.timestamp ??
        record.time ??
        record.occurredAt ??
        record.createdAt,
      );

      return {
        key: `${index}-${timestampMs}-${userId ?? "unknown"}`,
        userId,
        username: username || (userId != null ? `Player ${userId}` : "Unknown"),
        actionType: normalizeActionType(actionType),
        details,
        timestampMs,
        timestampText: toMoveTimestampText(timestampMs),
        inferredRound: 1,
      } as SessionMoveLogEntry;
    })
    .filter((entry): entry is SessionMoveLogEntry => entry != null)
    .sort((a, b) => {
      const timeDiff = a.timestampMs - b.timestampMs;
      if (timeDiff !== 0) {
        return timeDiff;
      }
      return a.key.localeCompare(b.key);
    });

  let currentRound = 1;
  return extracted.map((entry) => {
    const explicitRound = extractRoundHint(entry.details) ?? extractRoundHint(entry.actionType);
    if (explicitRound != null && explicitRound > 0) {
      currentRound = explicitRound;
    }

    const withRound: SessionMoveLogEntry = {
      ...entry,
      inferredRound: Math.max(1, currentRound),
    };

    if (isRoundBoundaryMove(entry.actionType, entry.details)) {
      currentRound += 1;
    }

    return withRound;
  });
}

const HistoryPage: React.FC = () => {
  const router = useRouter();
  const params = useParams<{ sessionId?: string }>();
  const sessionId = String(params?.sessionId ?? "").trim();
  const apiService = useApi();

  const { value: token } = useLocalStorage<string>("token", "");
  const { value: userId } = useLocalStorage<string>("userId", "");
  const selfUserId = Number(userId);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionSnapshot, setSessionSnapshot] = useState<SessionScoreSnapshot | null>(null);
  const [roundWindowStart, setRoundWindowStart] = useState(1);
  const [selectedRoundScore, setSelectedRoundScore] = useState<SelectedRoundScore | null>(null);
  const [roundMoves, setRoundMoves] = useState<SessionMoveLogEntry[]>([]);
  const [roundMovesLoading, setRoundMovesLoading] = useState(false);
  const [roundMovesError, setRoundMovesError] = useState<string | null>(null);
  const [sessionLogEntries, setSessionLogEntries] = useState<SessionMoveLogEntry[] | null>(null);
  const [isSharingSession, setIsSharingSession] = useState(false);

  const handleBack = useCallback(() => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/dashboard");
  }, [router]);

  useEffect(() => {
    if (!sessionId) {
      setSessionSnapshot(null);
      setError("Missing session code.");
      setLoading(false);
      return;
    }

    const authToken = token.trim();
    if (!authToken) {
      setSessionSnapshot(null);
      setError("Please log in to view session results.");
      setLoading(false);
      return;
    }

    let active = true;

    const fetchSessionScores = async () => {
      setLoading(true);
      setError(null);

      let scorePayload: unknown;
      try {
        scorePayload = await apiService.getWithAuth<unknown>(
          `/sessions/${encodeURIComponent(sessionId)}/history`,
          authToken,
        );
      } catch (caughtError) {
        const status = (caughtError as ApplicationError)?.status;
        if (status === 403 || status === 404 || status === 405) {
          if (!active) {
            return;
          }
          setSessionSnapshot(null);
          setError("No scoreboard results were found for this session.");
          setLoading(false);
          return;
        }
        throw caughtError;
      }

      if (!active) {
        return;
      }

      const resolved = buildSessionHistoryScoresSnapshot(
        scorePayload,
        sessionId,
        [],
        {},
      ) ?? (() => {
        const fallback = buildFinalRoundScoresSnapshot(scorePayload, [], {});
        if (!fallback) {
          return null;
        }
        return {
          players: fallback.players,
          totalRounds: fallback.totalRounds,
          sessionCode: sessionId,
        } as SessionScoreSnapshot;
      })();

      if (!resolved || resolved.players.length === 0) {
        setSessionSnapshot(null);
        setError("No scoreboard results were found for this session.");
      } else {
        setSessionSnapshot(resolved);
        setSessionLogEntries(null);
        setSelectedRoundScore(null);
        setRoundMoves([]);
        setRoundMovesError(null);
      }

      setLoading(false);
    };

    void fetchSessionScores().catch((caughtError) => {
      if (!active) {
        return;
      }

      const message = caughtError instanceof Error
        ? caughtError.message
        : "Could not load session results.";
      setError(message);
      setSessionSnapshot(null);
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [apiService, sessionId, token]);

  useEffect(() => {
    if (!sessionSnapshot || sessionSnapshot.players.length === 0) {
      return;
    }

    const unresolvedPlayers = sessionSnapshot.players
      .filter((player) => /^Player \d+$/i.test(player.username.trim()))
      .map((player) => player.userId);

    if (unresolvedPlayers.length === 0) {
      return;
    }

    let active = true;
    void Promise.all(
      unresolvedPlayers.map(async (id) => {
        try {
          const fetched = await apiService.get<User>(`/users/${encodeURIComponent(String(id))}`);
          const username = String(fetched?.username ?? fetched?.name ?? "").trim();
          return [id, username || `Player ${id}`] as const;
        } catch {
          return [id, `Player ${id}`] as const;
        }
      }),
    ).then((entries) => {
      if (!active) {
        return;
      }

      setSessionSnapshot((previous) => {
        if (!previous) {
          return previous;
        }

        const usernameById = new Map<number, string>(entries);
        const nextPlayers = previous.players.map((player) => {
          const mapped = usernameById.get(player.userId);
          if (!mapped) {
            return player;
          }
          return { ...player, username: mapped };
        });

        return {
          ...previous,
          players: nextPlayers,
        };
      });
    });

    return () => {
      active = false;
    };
  }, [apiService, sessionSnapshot]);

  const totalRounds = sessionSnapshot?.totalRounds ?? 0;
  const maxRoundWindowStart = Math.max(1, totalRounds - MAX_VISIBLE_ROUND_COLUMNS + 1);

  useEffect(() => {
    setRoundWindowStart((previous) => Math.min(previous, maxRoundWindowStart));
  }, [maxRoundWindowStart]);

  const visibleRoundNumbers = useMemo(() => {
    if (totalRounds <= 0) {
      return [] as number[];
    }
    if (totalRounds <= MAX_VISIBLE_ROUND_COLUMNS) {
      return Array.from({ length: totalRounds }, (_, index) => index + 1);
    }
    return Array.from(
      { length: MAX_VISIBLE_ROUND_COLUMNS },
      (_, index) => roundWindowStart + index,
    ).filter((value) => value <= totalRounds);
  }, [roundWindowStart, totalRounds]);

  const hasRoundWindowBefore = totalRounds > MAX_VISIBLE_ROUND_COLUMNS && roundWindowStart > 1;
  const hasRoundWindowAfter = totalRounds > MAX_VISIBLE_ROUND_COLUMNS &&
    (roundWindowStart + MAX_VISIBLE_ROUND_COLUMNS - 1) < totalRounds;

  const loadRoundMoves = useCallback(async (target: SelectedRoundScore) => {
    const authToken = token.trim();
    const sessionCode = sessionSnapshot?.sessionCode?.trim() || sessionId;
    if (!authToken || !sessionCode) {
      setRoundMovesError("Please log in to load move history.");
      setRoundMoves([]);
      return;
    }

    setRoundMovesLoading(true);
    setRoundMovesError(null);
    setSelectedRoundScore(target);

    try {
      let entries = sessionLogEntries;
      if (!entries) {
        const payload = await apiService.getWithAuth<unknown>(
          `/sessions/${encodeURIComponent(sessionCode)}/log`,
          authToken,
        );
        entries = parseSessionMoveLogEntries(payload);
        setSessionLogEntries(entries);
      }

      const filtered = entries
        .filter((entry) => entry.userId != null && entry.userId === target.userId)
        .filter((entry) => entry.inferredRound === target.roundNumber);

      setRoundMoves(filtered);
      if (filtered.length === 0) {
        const isOtherPlayer = selfUserId != null && target.userId !== selfUserId;
        setRoundMovesError(
          isOtherPlayer
            ? "This player had move history set to private during this round."
            : ROUND_MOVES_EMPTY_TEXT,
        );
      }
    } catch (caughtError) {
      const status = (caughtError as ApplicationError)?.status;
      const message = status === 404
        ? "Move history endpoint is not available for this session."
        : status === 403
          ? "You are not allowed to view this move history."
          : caughtError instanceof Error
            ? caughtError.message
            : "Could not load move history.";
      setRoundMoves([]);
      setRoundMovesError(message);
    } finally {
      setRoundMovesLoading(false);
    }
  }, [apiService, selfUserId, sessionId, sessionSnapshot?.sessionCode, sessionLogEntries, token]);

  const scoreRows = useMemo(() => {
    if (!sessionSnapshot) {
      return [] as HistoryScoreRow[];
    }

    const sortedPlayers = sortPlayersByScore(sessionSnapshot.players);
    return sortedPlayers.map((player, index) => {
      const place = index + 1;
      const row: HistoryScoreRow = {
        key: String(player.userId),
        placeBadge: toPlaceBadge(place),
        userId: player.userId,
        username: player.username,
        isWinner: place === 1,
        isSelf: Number.isFinite(selfUserId) && selfUserId === player.userId,
        isSpecialWin: player.isSpecialWin,
        totalScore: player.totalScore,
        totalScoreText: toScoreText(player.totalScore),
      };

      for (let round = 1; round <= sessionSnapshot.totalRounds; round += 1) {
        const roundScore = player.roundScores[round - 1] ?? null;
        row[toRoundColumnKey(round)] = toScoreText(roundScore);
      }

      return row;
    });
  }, [selfUserId, sessionSnapshot]);

  const scoreColumns = useMemo(() => {
    const columns: TableProps<HistoryScoreRow>["columns"] = [
      {
        title: "",
        dataIndex: "placeBadge",
        key: "placeBadge",
        align: "center",
        width: 66,
        render: (value: unknown) => <span className="history-results-place-badge">{String(value ?? "")}</span>,
      },
      {
        title: "Username",
        dataIndex: "username",
        key: "username",
        ellipsis: false,
        className: "history-results-cell-username",
        onHeaderCell: () => ({ className: "history-results-head-username" }),
        render: (value: unknown, row) => {
          const username = String(value ?? `Player ${row.userId}`);

          return (
            <Link
              className="history-results-user-link"
              href={`/users/${encodeURIComponent(String(row.userId))}`}
              title={username}
            >
              {`${username}${row.isSpecialWin ? " *" : ""}`}
            </Link>
          );
        },
      },
    ];

    for (const round of visibleRoundNumbers) {
      columns.push({
        title: `R${round}`,
        dataIndex: toRoundColumnKey(round),
        key: toRoundColumnKey(round),
        align: "center",
        width: 68,
        className: "history-results-cell-round",
        onHeaderCell: () => ({ className: "history-results-head-round" }),
        render: (value: unknown, row) => {
          const scoreText = String(value ?? "-");
          const isClickable = scoreText !== "-";
          const isSelected = selectedRoundScore != null &&
            selectedRoundScore.userId === row.userId &&
            selectedRoundScore.roundNumber === round;

          if (!isClickable) {
            return <span className="history-results-score-static">{scoreText}</span>;
          }

          return (
            <button
              type="button"
              className={`history-results-score-link${isSelected ? " history-results-score-link-selected" : ""}`}
              onClick={() => {
                void loadRoundMoves({
                  userId: row.userId,
                  username: row.username,
                  roundNumber: round,
                  scoreText,
                });
              }}
              disabled={roundMovesLoading && isSelected}
              title={`Show move history for ${row.username}, round ${round}`}
            >
              {scoreText}
            </button>
          );
        },
      });
    }

    columns.push({
      title: "Total",
      dataIndex: "totalScoreText",
      key: "totalScoreText",
      align: "center",
      width: 86,
      sorter: (a, b) => (a.totalScore ?? Number.POSITIVE_INFINITY) - (b.totalScore ?? Number.POSITIVE_INFINITY),
      render: (value: unknown) => <span className="history-results-total-score">{String(value ?? "-")}</span>,
    });

    return columns;
  }, [loadRoundMoves, roundMovesLoading, selectedRoundScore, visibleRoundNumbers]);

  const sessionCodeLabel = sessionSnapshot?.sessionCode?.trim() || sessionId || "----";
  const handleShareSession = useCallback(async () => {
    if (isSharingSession || typeof window === "undefined") {
      return;
    }

    const shareUrl = window.location.href;
    const shareTitle = `Cabo Session ${sessionCodeLabel}`;
    setIsSharingSession(true);

    try {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({
          title: shareTitle,
          url: shareUrl,
        });
        return;
      }

      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === "function"
      ) {
        await navigator.clipboard.writeText(shareUrl);
      }
    } catch {
      // ignore aborts or permission issues
    } finally {
      setIsSharingSession(false);
    }
  }, [isSharingSession, sessionCodeLabel]);

  return (
    <div className="cabo-background">
      <div className="login-container">
        <div className="create-lobby-stack dashboard-stack">
          <Card
            className="dashboard-container"
            title={
              <div className="lobby-section-title-row">
                <span className="dashboard-section-title">Session Scoreboard</span>
                <span className="history-results-title-meta">
                  <span className="lobby-section-meta">{sessionCodeLabel}</span>
                  <Button
                    type="default"
                    className="final-score-share-btn"
                    onClick={() => {
                      void handleShareSession();
                    }}
                    loading={isSharingSession}
                  >
                    Share Result
                  </Button>
                </span>
              </div>
            }
          >
            {loading ? (
              <div style={{ textAlign: "center", padding: "20px" }}>
                <Spin />
              </div>
            ) : null}

            {!loading && error ? (
              <p className="profile-results-empty-text">{error}</p>
            ) : null}

            {!loading && !error && scoreRows.length === 0 ? (
              <p className="profile-results-empty-text">{NO_RESULTS_TEXT}</p>
            ) : null}

            {!loading && !error ? (
              <p className="history-results-hint">
                Click any round score to view that player&apos;s move history.
              </p>
            ) : null}

            {!loading && !error && scoreRows.length > 0 ? (
              <>
                {totalRounds > MAX_VISIBLE_ROUND_COLUMNS ? (
                  <div className="history-round-window-controls">
                    <button
                      type="button"
                      className="history-round-window-arrow"
                      onClick={() => setRoundWindowStart((previous) => Math.max(1, previous - 1))}
                      disabled={!hasRoundWindowBefore}
                      aria-label="Show previous rounds"
                    >
                      &lt;
                    </button>
                    <span className="history-round-window-ellipsis" aria-hidden={!hasRoundWindowBefore}>
                      {hasRoundWindowBefore ? "..." : ""}
                    </span>
                    <div className="history-round-window-labels">
                      {visibleRoundNumbers.map((round) => (
                        <span key={`window-${round}`} className="history-round-window-label">
                          R{round}
                        </span>
                      ))}
                    </div>
                    <span className="history-round-window-ellipsis" aria-hidden={!hasRoundWindowAfter}>
                      {hasRoundWindowAfter ? "..." : ""}
                    </span>
                    <button
                      type="button"
                      className="history-round-window-arrow"
                      onClick={() => setRoundWindowStart((previous) => Math.min(maxRoundWindowStart, previous + 1))}
                      disabled={!hasRoundWindowAfter}
                      aria-label="Show next rounds"
                    >
                      &gt;
                    </button>
                  </div>
                ) : null}

                <Table<HistoryScoreRow>
                  className="users-overview-table profile-results-table responsive-list-table history-results-table"
                  columns={scoreColumns}
                  dataSource={scoreRows}
                  rowKey="key"
                  size="small"
                  tableLayout="fixed"
                  pagination={false}
                  rowClassName={(row) => row.isSelf ? "profile-results-row history-results-row-self" : "profile-results-row"}
                />

                {selectedRoundScore ? (
                  <div className="history-round-moves-panel">
                    <div className="history-round-moves-title">
                      Move History for{" "}
                      <strong>{selectedRoundScore.username}</strong>
                      {" "}in{" "}
                      <strong>Round {selectedRoundScore.roundNumber}</strong>
                    </div>

                    {roundMovesLoading ? (
                      <div className="history-round-moves-loading">
                        <Spin size="small" />
                      </div>
                    ) : null}

                    {!roundMovesLoading && roundMovesError ? (
                      <p className="profile-results-empty-text">{roundMovesError}</p>
                    ) : null}

                    {!roundMovesLoading && !roundMovesError && roundMoves.length === 0 ? (
                      <p className="profile-results-empty-text">{ROUND_MOVES_EMPTY_TEXT}</p>
                    ) : null}

                    {!roundMovesLoading && !roundMovesError && roundMoves.length > 0 ? (
                      <ol className="history-round-moves-list">
                        {roundMoves.map((move) => (
                          <li key={move.key} className="history-round-move-item">
                            <span className="history-round-move-time">{move.timestampText}</span>
                            <span className="history-round-move-text">
                              <strong>{move.username}</strong> {move.actionType}
                              {move.details ? ` - ${move.details}` : ""}
                            </span>
                          </li>
                        ))}
                      </ol>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}
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

export default HistoryPage;
