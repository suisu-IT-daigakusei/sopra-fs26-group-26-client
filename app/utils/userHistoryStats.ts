function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toKeyCandidates(value: string): string[] {
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
    record.sessions,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  if (
    record.totalScoreByUserId != null ||
    record.userScoresPerRound != null ||
    record.sessionId != null
  ) {
    return [record];
  }

  return [];
}

function readScoreMap(record: Record<string, unknown>, sessionRecord: Record<string, unknown> | null): Record<string, unknown> | null {
  return (
    asRecord(record.totalScoreByUserId) ??
    asRecord(record.userScores) ??
    asRecord(record.scores) ??
    asRecord(record.playerScores) ??
    asRecord(sessionRecord?.totalScoreByUserId) ??
    asRecord(sessionRecord?.scores)
  );
}

function readRoundMaps(record: Record<string, unknown>, sessionRecord: Record<string, unknown> | null): Record<string, unknown>[] {
  const direct = Array.isArray(record.userScoresPerRound)
    ? record.userScoresPerRound
    : Array.isArray(record.roundScoresPerRound)
      ? record.roundScoresPerRound
      : Array.isArray(record.roundScores)
        ? record.roundScores
        : [];
  const nested = Array.isArray(sessionRecord?.userScoresPerRound)
    ? sessionRecord.userScoresPerRound
    : [];

  const raw = direct.length > 0 ? direct : nested;
  return raw
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry != null);
}

export type UserHistoryPlayedStats = {
  gamesPlayed: number | null;
  roundsPlayed: number | null;
};

export type UserHistoryOutcomeStats = {
  gamesPlayed: number | null;
  roundsPlayed: number | null;
  gamesWon: number | null;
  roundsWon: number | null;
  averageScorePerRound: number | null;
};

function idsMatch(candidate: string, userId: string): boolean {
  const normalizedCandidate = String(candidate ?? "").trim();
  const normalizedUserId = String(userId ?? "").trim();
  if (!normalizedCandidate || !normalizedUserId) {
    return false;
  }

  const userCandidates = new Set(toKeyCandidates(normalizedUserId));
  return toKeyCandidates(normalizedCandidate).some((entry) => userCandidates.has(entry));
}

function resolveUniqueWinnerIdFromScoreMap(scoreMap: Record<string, unknown> | null): string | null {
  if (!scoreMap) {
    return null;
  }

  const entries = Object.entries(scoreMap)
    .map(([id, value]) => ({
      id: String(id ?? "").trim(),
      score: toFiniteNumber(value),
    }))
    .filter((entry) => entry.id.length > 0 && entry.score != null);

  if (entries.length === 0) {
    return null;
  }

  const bestScore = Math.min(...entries.map((entry) => entry.score as number));
  const winners = entries.filter((entry) => entry.score === bestScore);
  if (winners.length !== 1) {
    return null;
  }

  return winners[0].id;
}

function resolveWinnerId(
  record: Record<string, unknown>,
  sessionRecord: Record<string, unknown> | null,
  scoreMap: Record<string, unknown> | null,
): string | null {
  const winnerRecord = asRecord(record.winner) ?? asRecord(sessionRecord?.winner);
  const explicitWinnerId = String(
    record.winnerUserId ??
    record.winnerId ??
    winnerRecord?.id ??
    sessionRecord?.winnerUserId ??
    sessionRecord?.winnerId ??
    "",
  ).trim();

  if (explicitWinnerId) {
    return explicitWinnerId;
  }

  return resolveUniqueWinnerIdFromScoreMap(scoreMap);
}

function readExplicitRoundCount(record: Record<string, unknown>, sessionRecord: Record<string, unknown> | null): number | null {
  const explicitRoundCount =
    toFiniteNumber(record.rounds) ??
    toFiniteNumber(record.totalRounds) ??
    toFiniteNumber(record.roundCount) ??
    toFiniteNumber(record.currentRound) ??
    toFiniteNumber(sessionRecord?.rounds) ??
    toFiniteNumber(sessionRecord?.totalRounds);
  if (explicitRoundCount == null || explicitRoundCount <= 0) {
    return null;
  }
  return Math.max(0, Math.floor(explicitRoundCount));
}

export function deriveUserOutcomeStatsFromHistoryPayload(
  raw: unknown,
  userId: string | number,
): UserHistoryOutcomeStats {
  const normalizedUserId = String(userId ?? "").trim();
  if (!normalizedUserId) {
    return {
      gamesPlayed: null,
      roundsPlayed: null,
      gamesWon: null,
      roundsWon: null,
      averageScorePerRound: null,
    };
  }

  const entries = extractResultsArray(raw);
  if (entries.length === 0) {
    return {
      gamesPlayed: 0,
      roundsPlayed: 0,
      gamesWon: 0,
      roundsWon: 0,
      averageScorePerRound: null,
    };
  }

  let gamesPlayed = 0;
  let roundsPlayed = 0;
  let gamesWon = 0;
  let roundsWon = 0;
  let totalScoreSum = 0;
  let hasAnyGameSignal = false;
  let hasAnyRoundSignal = false;
  let hasAnyGameWinSignal = false;
  let hasAnyRoundWinSignal = false;
  let hasAnyScoreSignal = false;

  entries.forEach((entry) => {
    const record = asRecord(entry);
    if (!record) {
      return;
    }

    const sessionRecord = asRecord(record.session);
    const scoreMap = readScoreMap(record, sessionRecord);
    const roundMaps = readRoundMaps(record, sessionRecord);

    let userRoundCountInSession = 0;
    roundMaps.forEach((roundMap) => {
      const userRoundScore = pickMappedNumber(roundMap, normalizedUserId);
      if (userRoundScore == null) {
        return;
      }

      userRoundCountInSession += 1;
      roundsPlayed += 1;
      hasAnyRoundSignal = true;

      const roundWinnerId = resolveUniqueWinnerIdFromScoreMap(roundMap);
      hasAnyRoundWinSignal = true;
      if (roundWinnerId && idsMatch(roundWinnerId, normalizedUserId)) {
        roundsWon += 1;
      }
    });

    const totalScore =
      pickMappedNumber(scoreMap, normalizedUserId) ??
      toFiniteNumber(record.userScore) ??
      toFiniteNumber(record.score) ??
      toFiniteNumber(record.points) ??
      toFiniteNumber(record.finalScore);

    let countedAsPlayedGame = totalScore != null || userRoundCountInSession > 0;

    if (!countedAsPlayedGame) {
      const directUserId = String(record.userId ?? record.playerId ?? "").trim();
      if (directUserId && idsMatch(directUserId, normalizedUserId)) {
        countedAsPlayedGame = true;
      }
    }

    if (!countedAsPlayedGame) {
      return;
    }

    gamesPlayed += 1;
    hasAnyGameSignal = true;

    if (totalScore != null) {
      totalScoreSum += totalScore;
      hasAnyScoreSignal = true;
    }

    const winnerId = resolveWinnerId(record, sessionRecord, scoreMap);
    if (winnerId) {
      hasAnyGameWinSignal = true;
      if (idsMatch(winnerId, normalizedUserId)) {
        gamesWon += 1;
      }
    }

    if (userRoundCountInSession === 0) {
      const explicitRoundCount = readExplicitRoundCount(record, sessionRecord);
      if (explicitRoundCount != null) {
        roundsPlayed += explicitRoundCount;
        hasAnyRoundSignal = true;

        // Conservative fallback: only infer round win count from game winner in guaranteed one-round sessions.
        if (explicitRoundCount === 1 && winnerId) {
          hasAnyRoundWinSignal = true;
          if (idsMatch(winnerId, normalizedUserId)) {
            roundsWon += 1;
          }
        }
      }
    }
  });

  const averageScorePerRound =
    hasAnyScoreSignal && roundsPlayed > 0
      ? totalScoreSum / roundsPlayed
      : null;

  return {
    gamesPlayed: hasAnyGameSignal ? gamesPlayed : 0,
    roundsPlayed: hasAnyRoundSignal ? roundsPlayed : 0,
    gamesWon: hasAnyGameWinSignal ? gamesWon : null,
    roundsWon: hasAnyRoundWinSignal ? roundsWon : null,
    averageScorePerRound,
  };
}

export function derivePlayedStatsFromHistoryPayload(
  raw: unknown,
  userId: string | number,
): UserHistoryPlayedStats {
  const outcome = deriveUserOutcomeStatsFromHistoryPayload(raw, userId);
  return {
    gamesPlayed: outcome.gamesPlayed,
    roundsPlayed: outcome.roundsPlayed,
  };
}
