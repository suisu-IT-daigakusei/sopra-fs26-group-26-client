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

export function derivePlayedStatsFromHistoryPayload(
  raw: unknown,
  userId: string | number,
): UserHistoryPlayedStats {
  const normalizedUserId = String(userId ?? "").trim();
  if (!normalizedUserId) {
    return { gamesPlayed: null, roundsPlayed: null };
  }

  const entries = extractResultsArray(raw);
  if (entries.length === 0) {
    return { gamesPlayed: 0, roundsPlayed: 0 };
  }

  let gamesPlayed = 0;
  let roundsPlayed = 0;
  let hasAnyGameSignal = false;
  let hasAnyRoundSignal = false;

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
      const roundScore = pickMappedNumber(roundMap, normalizedUserId);
      if (roundScore == null) {
        return;
      }
      userRoundCountInSession += 1;
      roundsPlayed += 1;
      hasAnyRoundSignal = true;
    });

    const totalScore =
      pickMappedNumber(scoreMap, normalizedUserId) ??
      toFiniteNumber(record.userScore) ??
      toFiniteNumber(record.score) ??
      toFiniteNumber(record.points) ??
      toFiniteNumber(record.finalScore);

    let countedAsPlayedGame = totalScore != null || userRoundCountInSession > 0;

    // Last-resort fallback for user-centric payloads that don't include maps.
    if (!countedAsPlayedGame) {
      const directUserId = String(record.userId ?? record.playerId ?? "").trim();
      if (directUserId && toKeyCandidates(normalizedUserId).includes(directUserId)) {
        countedAsPlayedGame = true;
      }
    }

    if (countedAsPlayedGame) {
      gamesPlayed += 1;
      hasAnyGameSignal = true;
    }

    if (userRoundCountInSession === 0 && countedAsPlayedGame) {
      const explicitRoundCount =
        toFiniteNumber(record.rounds) ??
        toFiniteNumber(record.totalRounds) ??
        toFiniteNumber(record.roundCount) ??
        toFiniteNumber(record.currentRound) ??
        toFiniteNumber(sessionRecord?.rounds) ??
        toFiniteNumber(sessionRecord?.totalRounds);
      if (explicitRoundCount != null && explicitRoundCount > 0) {
        roundsPlayed += Math.max(0, Math.floor(explicitRoundCount));
        hasAnyRoundSignal = true;
      }
    }
  });

  return {
    gamesPlayed: hasAnyGameSignal ? gamesPlayed : 0,
    roundsPlayed: hasAnyRoundSignal ? roundsPlayed : 0,
  };
}
