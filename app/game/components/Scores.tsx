// "Score" button that shows the cumulative totals of the current session.

import React from "react";
import { Button } from "antd";

type PlayerScore = {
    userId: number;
    username: string;
    totalScore: number | null;
    roundScores?: Array<number | null> | null;
};

type PlayerScoreResolved = Omit<PlayerScore, "roundScores" | "totalScore"> & {
    totalScore: number | null;
    roundScores: Array<number | null>;
};

interface ScoresProps {
    isOpen: boolean;
    onClose: () => void;
    players: PlayerScore[];
    selfUserId: number | null;
    totalRounds?: number | null;
}

function toFiniteNumber(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function toScoreText(value: number | null): string {
    return value == null ? "-" : String(Math.trunc(value));
}

function toPlaceBadge(rank: number): string {
    if (rank === 1) return "\uD83E\uDD47";
    if (rank === 2) return "\uD83E\uDD48";
    if (rank === 3) return "\uD83E\uDD49";
    if (rank === 4) return "4.";
    return `${rank}.`;
}

function sortPlayersByScore(players: PlayerScoreResolved[], scoreByUserId: Record<number, number | null>): PlayerScoreResolved[] {
    return [...players].sort((a, b) => {
        const scoreA = scoreByUserId[a.userId];
        const scoreB = scoreByUserId[b.userId];
        if (scoreA == null && scoreB == null) {
            return a.username.localeCompare(b.username);
        }
        if (scoreA == null) return 1;
        if (scoreB == null) return -1;
        if (scoreA !== scoreB) return scoreA - scoreB;
        return a.username.localeCompare(b.username);
    });
}

function getRanksByUserId(players: PlayerScoreResolved[], scoreByUserId: Record<number, number | null>): Record<number, number> {
    const sorted = sortPlayersByScore(players, scoreByUserId);
    const out: Record<number, number> = {};
    
    // handle ties correctly
    let currentRank = 1;
    for (let i = 0; i < sorted.length; i++) {
        const player = sorted[i];
        const currentScore = scoreByUserId[player.userId];
        
        if (i > 0) {
            const prevPlayer = sorted[i - 1];
            const prevScore = scoreByUserId[prevPlayer.userId];
            
            if (currentScore !== prevScore) {
                currentRank = i + 1;
            }
        }
        
        out[player.userId] = currentRank;
    }
    
    return out;
}

const Scores: React.FC<ScoresProps> = ({
    isOpen,
    onClose,
    players,
    selfUserId,
    totalRounds,
}) => {
    if (!isOpen) return null;

    const normalizedPlayers: PlayerScoreResolved[] = players.map((player) => ({
        ...player,
        totalScore: toFiniteNumber(player.totalScore),
        roundScores: Array.isArray(player.roundScores)
            ? player.roundScores.map((value) => toFiniteNumber(value))
            : [],
    }));

    const roundsFromPlayers = normalizedPlayers.reduce(
        (max, player) => Math.max(max, player.roundScores.length),
        0,
    );
    const resolvedTotalRounds = Math.max(
        Number.isFinite(Number(totalRounds)) ? Number(totalRounds) : 0,
        roundsFromPlayers,
    );

    // Current-scores view intentionally excludes the running/current round.
    // Some payloads only expose one completed round even while the next round is active;
    // in that case keep one visible score column instead of collapsing to "-".
    let completedRoundsForScores = Math.max(0, resolvedTotalRounds - 1);
    const hasAnyPersistedScore = normalizedPlayers.some(
        (player) =>
            player.totalScore != null ||
            player.roundScores.some((value) => value != null),
    );
    if (completedRoundsForScores === 0 && hasAnyPersistedScore) {
        completedRoundsForScores = 1;
    }
    const hasRanking = completedRoundsForScores > 0;
    const showEarlyRoundsSummaryColumn = completedRoundsForScores >= 2;
    const showLatestCompletedRoundColumn = completedRoundsForScores >= 1;

    const totalsForDisplayByUserId: Record<number, number | null> = {};
    normalizedPlayers.forEach((player) => {
        if (!hasRanking) {
            totalsForDisplayByUserId[player.userId] = null;
            return;
        }

        const completedRoundValues = player.roundScores.slice(0, completedRoundsForScores);
        if (
            completedRoundValues.length === completedRoundsForScores &&
            completedRoundValues.every((value) => value != null)
        ) {
            totalsForDisplayByUserId[player.userId] = completedRoundValues.reduce(
                (sum, value) => sum + Number(value),
                0,
            );
            return;
        }

        if (player.totalScore != null) {
            totalsForDisplayByUserId[player.userId] = player.totalScore;
            return;
        }

        totalsForDisplayByUserId[player.userId] = null;
    });

    const sorted = hasRanking
        ? sortPlayersByScore(normalizedPlayers, totalsForDisplayByUserId)
        : [...normalizedPlayers].sort((a, b) => a.username.localeCompare(b.username));
    const ranksByUserId = hasRanking
        ? getRanksByUserId(normalizedPlayers, totalsForDisplayByUserId)
        : {};

    const previousTotalsByUserId: Record<number, number | null> = {};
    normalizedPlayers.forEach((player) => {
        if (completedRoundsForScores <= 1) {
            previousTotalsByUserId[player.userId] = null;
            return;
        }
        const previousRoundValues = player.roundScores.slice(0, completedRoundsForScores - 1);
        if (
            previousRoundValues.length === completedRoundsForScores - 1 &&
            previousRoundValues.every((value) => value != null)
        ) {
            previousTotalsByUserId[player.userId] = previousRoundValues.reduce(
                (sum, value) => sum + Number(value),
                0,
            );
            return;
        }
        previousTotalsByUserId[player.userId] = null;
    });
    const previousRanksByUserId = getRanksByUserId(normalizedPlayers, previousTotalsByUserId);

    const getRoundScoreText = (player: PlayerScoreResolved, roundIndex: number): string => {
        if (!hasRanking || roundIndex < 0 || roundIndex >= completedRoundsForScores) {
            return "-";
        }
        const roundValue = player.roundScores[roundIndex] ?? null;
        if (roundValue != null) {
            return toScoreText(roundValue);
        }
        if (completedRoundsForScores === 1 && player.totalScore != null) {
            return toScoreText(player.totalScore);
        }
        return "-";
    };

    const getEarlyRoundsSummaryText = (player: PlayerScoreResolved): string => {
        if (!showEarlyRoundsSummaryColumn || !hasRanking) {
            return "-";
        }
        const earlyRoundValues = player.roundScores.slice(0, completedRoundsForScores - 1);
        const numericEarlyRoundValues = earlyRoundValues.filter(
            (value): value is number => value != null,
        );
        if (
            earlyRoundValues.length !== Math.max(0, completedRoundsForScores - 1) ||
            numericEarlyRoundValues.length !== earlyRoundValues.length
        ) {
            return "-";
        }
        return toScoreText(
            numericEarlyRoundValues.reduce((sum, value) => sum + value, 0),
        );
    };

    const getEarlyRoundsLabel = (): string => {
        const endRound = Math.max(1, completedRoundsForScores - 1);
        if (endRound <= 1) {
            return "Round 1";
        }
        return `Rounds 1-${endRound}`;
    };

    const getLatestCompletedRoundLabel = (): string => {
        return `Round ${Math.max(1, completedRoundsForScores)}`;
    };

    const getMovementLabel = (player: PlayerScoreResolved): { text: string; className: string } => {
        if (completedRoundsForScores <= 1 || !hasRanking) {
            return { text: "-", className: "final-score-movement-neutral" };
        }

        const previousRank = previousRanksByUserId[player.userId];
        const currentRank = ranksByUserId[player.userId];
        const previousTotal = previousTotalsByUserId[player.userId];
        const currentTotal = totalsForDisplayByUserId[player.userId];

        if (
            previousRank == null ||
            currentRank == null ||
            previousTotal == null ||
            currentTotal == null
        ) {
            return { text: "-", className: "final-score-movement-neutral" };
        }

        const delta = previousRank - currentRank;
        if (delta > 0) return { text: "\u2191".repeat(delta), className: "final-score-movement-up" };
        if (delta < 0) return { text: "\u2193".repeat(Math.abs(delta)), className: "final-score-movement-down" };
        return { text: "-", className: "final-score-movement-neutral" };
    };

    return (
        <div className="current-scores-overlay">
            <div className="current-scores-card">
                <div className="final-score-headbar">
                    <h2 className="final-score-title">Current Scores</h2>
                    <Button type="default" onClick={onClose}>Close</Button>
                </div>

                <div className="final-score-table-wrap">
                    <table className="final-score-table">
                        <colgroup>
                            <col className="final-score-col-place" />
                            <col className="final-score-col-username" />
                            {showEarlyRoundsSummaryColumn ? <col /> : null}
                            {showLatestCompletedRoundColumn ? <col /> : null}
                            <col className="final-score-col-total" />
                        </colgroup>
                        <thead>
                            <tr>
                                <th className="final-score-col-place final-score-col-place-head"></th>
                                <th className="final-score-col-username final-score-col-username-head">Username</th>
                                {showEarlyRoundsSummaryColumn ? (
                                    <th>{getEarlyRoundsLabel()}</th>
                                ) : null}
                                {showLatestCompletedRoundColumn ? (
                                    <th>{getLatestCompletedRoundLabel()}</th>
                                ) : null}
                                <th className="final-score-col-total final-score-col-total-head">Total Score</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sorted.map((player) => {
                                const isSelf = selfUserId != null && player.userId === selfUserId;
                                const movement = getMovementLabel(player);
                                const rank = ranksByUserId[player.userId];
                                return (
                                    <tr key={player.userId} className={isSelf ? "final-score-row-self" : ""}>
                                        <td className="final-score-col-place final-score-place-badge">
                                            {hasRanking && rank != null ? toPlaceBadge(rank) : ""}
                                        </td>
                                        <td className="final-score-col-username">
                                            <span className={`final-score-player-name${hasRanking && rank === 1 ? " final-score-player-name-leading" : ""}`}>
                                                {player.username}
                                            </span>
                                            {movement.text !== "-" ? (
                                                <span className={`final-score-inline-movement ${movement.className}`}>{movement.text}</span>
                                            ) : null}
                                        </td>
                                        {hasRanking ? (
                                            <>
                                                {showEarlyRoundsSummaryColumn ? (
                                                    <td>{getEarlyRoundsSummaryText(player)}</td>
                                                ) : null}
                                                <td>{getRoundScoreText(player, completedRoundsForScores - 1)}</td>
                                            </>
                                        ) : (
                                            <td>-</td>
                                        )}
                                        <td className="final-score-col-total">{hasRanking ? toScoreText(totalsForDisplayByUserId[player.userId]) : "-"}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default Scores;
