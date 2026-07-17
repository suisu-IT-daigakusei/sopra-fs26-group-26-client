//A final score screen after Cabo reveal

import React from "react";
import { Button } from "antd";
import CaboChatPanel from "@/components/CaboChatPanel";
import {
    DEFAULT_CONFIRM_TIMEOUT_SECONDS,
    resolveConfirmationTimeoutSeconds,
} from "@/utils/timedConfirmation";

type FinalPlayer = {
    userId: number;
    username: string;
    totalScore: number | null;
    roundScores?: Array<number | null> | null;
    isSpecialWin?: boolean; // two 12s + two 13s
};

type FinalPlayerResolved = Omit<FinalPlayer, "roundScores" | "totalScore"> & {
    totalScore: number | null;
    roundScores: Array<number | null>;
};

type RematchDecision = "CONTINUE" | "FRESH" | "NONE";

interface FinalScoreScreenProps {
    isOpen: boolean;
    players: FinalPlayer[];
    selfUserId: number | null;
    chatSessionId?: string | null;
    chatToken?: string | null;
    chatUserId?: string | number | null;
    chatUserPrimaryColorById?: Record<string, string>;
    chatCooldownSeconds?: number;
    totalRounds?: number | null;
    rematchCountdownSeconds: number;
    sessionEnded: boolean;
    myRematchDecision: RematchDecision | null;
    isSubmittingRematchDecision: boolean;
    onChooseRematch: (decision: RematchDecision) => void;
    hideRematchSection?: boolean;
    // TODO: Backend needs to send final scores in game state
}

function toFiniteNumber(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function toScoreText(value: number | null): string {
    return value == null ? "-" : String(Math.trunc(value));
}

function toOverallPlaceText(rank: number): string {
    if (rank === 1) return "\uD83E\uDD47";
    if (rank === 2) return "\uD83E\uDD48";
    if (rank === 3) return "\uD83E\uDD49";
    if (rank === 4) return "4.";
    return `${rank}.`;
}

function toRoundMedal(rank: number): string {
    if (rank === 1) return "\uD83E\uDD47";
    if (rank === 2) return "\uD83E\uDD48";
    if (rank === 3) return "\uD83E\uDD49";
    return "";
}

function sortPlayersByScore(players: FinalPlayerResolved[], scoreByUserId: Record<number, number | null>): FinalPlayerResolved[] {
    return [...players].sort((a, b) => {
        const scoreA = scoreByUserId[a.userId];
        const scoreB = scoreByUserId[b.userId];
        if (scoreA == null && scoreB == null) {
            return a.username.localeCompare(b.username);
        }
        if (scoreA == null) {
            return 1;
        }
        if (scoreB == null) {
            return -1;
        }
        if (scoreA !== scoreB) {
            return scoreA - scoreB;
        }
        return a.username.localeCompare(b.username);
    });
}

function getRanksByUserId(players: FinalPlayerResolved[], scoreByUserId: Record<number, number | null>): Record<number, number> {
    const sorted = sortPlayersByScore(players, scoreByUserId);
    const out: Record<number, number> = {};
    
    // handle ties correctly
    let currentRank = 1;
    for (let i = 0; i < sorted.length; i++) {
        const player = sorted[i];
        const currentScore = scoreByUserId[player.userId];
        
        // Check if this player has the same score as the previous player
        if (i > 0) {
            const prevPlayer = sorted[i - 1];
            const prevScore = scoreByUserId[prevPlayer.userId];
            
            // If scores are different, update the rank to skip tied positions
            if (currentScore !== prevScore) {
                currentRank = i + 1;
            }
            // If scores are the same, keep the same rank
        }
        
        out[player.userId] = currentRank;
    }
    
    return out;
}

function getRoundRanksByUserId(players: FinalPlayerResolved[], roundIndex: number): Record<number, number> {
    const scored = players
        .map((player) => ({
            userId: player.userId,
            username: player.username,
            score: player.roundScores[roundIndex] ?? null,
        }))
        .filter((entry): entry is { userId: number; username: string; score: number } => entry.score != null)
        .sort((a, b) => {
            if (a.score !== b.score) {
                return a.score - b.score;
            }
            return a.username.localeCompare(b.username);
        });

    const out: Record<number, number> = {};
    
    // handle ties correctly  
    let currentRank = 1;
    for (let i = 0; i < scored.length; i++) {
        const entry = scored[i];
        
        // Check if this player has the same score as the previous player
        if (i > 0) {
            const prevEntry = scored[i - 1];
            
            // If scores are different, update the rank
            if (entry.score !== prevEntry.score) {
                currentRank = i + 1;
            }
        }
        
        out[entry.userId] = currentRank;
    }
    
    return out;
}

const FinalScoreScreen: React.FC<FinalScoreScreenProps> = ({
    isOpen,
    players,
    selfUserId,
    chatSessionId,
    chatToken,
    chatUserId,
    chatUserPrimaryColorById,
    chatCooldownSeconds = 3,
    totalRounds,
    rematchCountdownSeconds,
    sessionEnded,
    myRematchDecision,
    isSubmittingRematchDecision,
    onChooseRematch,
    hideRematchSection = false,
}) => {
    // Inline decision confirmation with countdown auto-cancel.
    //   #58
    const [pendingDecision, setPendingDecision] = React.useState<RematchDecision | null>(null);
    const [confirmCountdown, setConfirmCountdown] = React.useState<number>(
        DEFAULT_CONFIRM_TIMEOUT_SECONDS,
    );
    const confirmTimerRef = React.useRef<number | null>(null);

    React.useEffect(() => {
        return () => {
            if (confirmTimerRef.current != null) {
                window.clearInterval(confirmTimerRef.current);
            }
        };
    }, []);

    const clearPendingConfirm = () => {
        if (confirmTimerRef.current != null) {
            window.clearInterval(confirmTimerRef.current);
            confirmTimerRef.current = null;
        }
        setPendingDecision(null);
        setConfirmCountdown(DEFAULT_CONFIRM_TIMEOUT_SECONDS);
    };

    const startConfirm = (decision: RematchDecision) => {
        if (decision === 'CONTINUE' && sessionEnded) {
            return;
        }
        const resolvedConfirmWindowSeconds = resolveConfirmationTimeoutSeconds(
            DEFAULT_CONFIRM_TIMEOUT_SECONDS,
            rematchCountdownSeconds,
        );
        setPendingDecision(decision);
        setConfirmCountdown(resolvedConfirmWindowSeconds);
        if (confirmTimerRef.current != null) {
            window.clearInterval(confirmTimerRef.current);
        }
        confirmTimerRef.current = window.setInterval(() => {
            setConfirmCountdown((previous) => {
                if (previous <= 1) {
                    // Timeout should behave like pressing Cancel.
                    if (confirmTimerRef.current != null) {
                        window.clearInterval(confirmTimerRef.current);
                        confirmTimerRef.current = null;
                    }
                    setPendingDecision(null);
                    return DEFAULT_CONFIRM_TIMEOUT_SECONDS;
                }
                return previous - 1;
            });
        }, 1000);
    };

    // Keep pending confirmation bounded by live backend-derived rematch timer.
    // If the global rematch timer is <= 10s, use that remaining time.
    React.useEffect(() => {
        if (!isOpen) {
            if (confirmTimerRef.current != null) {
                window.clearInterval(confirmTimerRef.current);
                confirmTimerRef.current = null;
            }
            if (pendingDecision != null) {
                setPendingDecision(null);
            }
            setConfirmCountdown((previous) =>
                previous === DEFAULT_CONFIRM_TIMEOUT_SECONDS
                    ? previous
                    : DEFAULT_CONFIRM_TIMEOUT_SECONDS
            );
            return;
        }
        if (sessionEnded && pendingDecision === 'CONTINUE') {
            if (confirmTimerRef.current != null) {
                window.clearInterval(confirmTimerRef.current);
                confirmTimerRef.current = null;
            }
            setPendingDecision(null);
            setConfirmCountdown(DEFAULT_CONFIRM_TIMEOUT_SECONDS);
            return;
        }
        if (pendingDecision == null) {
            return;
        }
        const maxAllowedSeconds = resolveConfirmationTimeoutSeconds(
            DEFAULT_CONFIRM_TIMEOUT_SECONDS,
            rematchCountdownSeconds,
        );
        setConfirmCountdown((previous) => Math.min(previous, maxAllowedSeconds));
        if (rematchCountdownSeconds <= 0) {
            if (confirmTimerRef.current != null) {
                window.clearInterval(confirmTimerRef.current);
                confirmTimerRef.current = null;
            }
            setPendingDecision(null);
            setConfirmCountdown(DEFAULT_CONFIRM_TIMEOUT_SECONDS);
        }
    }, [isOpen, pendingDecision, rematchCountdownSeconds, sessionEnded]);

    if (!isOpen) return null;

    const normalizedPlayers: FinalPlayerResolved[] = players.map((player) => ({
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

    const currentTotalsByUserId: Record<number, number | null> = {};
    normalizedPlayers.forEach((player) => {
        currentTotalsByUserId[player.userId] = player.totalScore;
    });
    const sorted = sortPlayersByScore(normalizedPlayers, currentTotalsByUserId);
    const currentRanksByUserId = getRanksByUserId(normalizedPlayers, currentTotalsByUserId);

    const previousTotalsByUserId: Record<number, number | null> = {};
    normalizedPlayers.forEach((player) => {
        if (resolvedTotalRounds <= 1) {
            previousTotalsByUserId[player.userId] = null;
            return;
        }

        const previousRoundValues = player.roundScores.slice(0, resolvedTotalRounds - 1);
        if (previousRoundValues.length === resolvedTotalRounds - 1 && previousRoundValues.every((value) => value != null)) {
            previousTotalsByUserId[player.userId] = previousRoundValues.reduce(
                (sum, value) => sum + Number(value),
                0,
            );
            return;
        }

        const currentRoundScore = player.roundScores[resolvedTotalRounds - 1];
        if (player.totalScore != null && currentRoundScore != null) {
            previousTotalsByUserId[player.userId] = player.totalScore - currentRoundScore;
            return;
        }

        previousTotalsByUserId[player.userId] = null;
    });
    const previousRanksByUserId = getRanksByUserId(normalizedPlayers, previousTotalsByUserId);

    const showEarlyRoundsSummaryColumn = resolvedTotalRounds > 2;
    const showPreviousRoundColumn = resolvedTotalRounds >= 2;
    const hasSpecialWin = normalizedPlayers.some((player) => player.isSpecialWin);
    const isDecisionLocked = myRematchDecision != null || isSubmittingRematchDecision;
    const isUrgentCountdown = !isDecisionLocked && rematchCountdownSeconds <= 10;
    const currentRoundIndex = resolvedTotalRounds - 1;
    const currentRoundRanksByUserId = getRoundRanksByUserId(normalizedPlayers, currentRoundIndex);
    const normalizedChatSessionId = String(chatSessionId ?? "").trim();
    const normalizedChatToken = String(chatToken ?? "").trim();
    const normalizedChatUserId = String(chatUserId ?? "").trim();
    const shouldShowChat =
        !hideRematchSection &&
        normalizedChatSessionId.length > 0 &&
        normalizedChatToken.length > 0 &&
        normalizedChatUserId.length > 0;

    const getRoundScoreText = (player: FinalPlayerResolved, roundIndex: number): string => {
        if (roundIndex < 0 || roundIndex >= resolvedTotalRounds) {
            return "-";
        }
        const value = player.roundScores[roundIndex] ?? null;
        return toScoreText(value);
    };

    const getEarlyRoundsSummaryText = (player: FinalPlayerResolved): string => {
        if (!showEarlyRoundsSummaryColumn) {
            return "-";
        }
        const earlyRoundValues = player.roundScores.slice(0, resolvedTotalRounds - 2);
        const numericEarlyRoundValues = earlyRoundValues.filter(
            (value): value is number => value != null,
        );
        if (
            earlyRoundValues.length !== Math.max(0, resolvedTotalRounds - 2) ||
            numericEarlyRoundValues.length !== earlyRoundValues.length
        ) {
            return "-";
        }
        return toScoreText(
            numericEarlyRoundValues.reduce((sum, value) => sum + value, 0),
        );
    };

    const getMovementLabel = (player: FinalPlayerResolved): { text: string; className: string } | null => {
        if (resolvedTotalRounds <= 1) {
            return null;
        }

        const previousRank = previousRanksByUserId[player.userId];
        const currentRank = currentRanksByUserId[player.userId];
        const previousTotal = previousTotalsByUserId[player.userId];
        const currentTotal = currentTotalsByUserId[player.userId];

        if (
            previousRank == null ||
            currentRank == null ||
            previousTotal == null ||
            currentTotal == null
        ) {
            return null;
        }

        const delta = previousRank - currentRank;
        if (delta > 0) {
            return { text: "\u2191".repeat(delta), className: "final-score-movement-up" };
        }
        if (delta < 0) {
            return { text: "\u2193".repeat(Math.abs(delta)), className: "final-score-movement-down" };
        }
        return null;
    };

    const getCurrentRoundLabel = (): string => {
        return "Current Round";
    };

    const getEarlyRoundsLabel = (): string => {
        const endRound = Math.max(1, resolvedTotalRounds - 2);
        if (endRound <= 1) {
            return "Round 1";
        }
        return `Rounds 1-${endRound}`;
    };

    const getPreviousRoundLabel = (): string => {
        const previousRoundNumber = Math.max(1, resolvedTotalRounds - 1);
        return `Round ${previousRoundNumber}`;
    };

    return (
        <div className="final-score-overlay">
            <div className="final-score-card">
                <div className="final-score-headbar">
                    <h1 className="final-score-title">
                        Round Finished
                    </h1>
                </div>

                {hasSpecialWin && (
                    <div className="final-score-special-win">
                        Special Win! Two 12s + Two 13s = 0 points.
                    </div>
                )}

                <div className="final-score-table-wrap">
                    <table className="final-score-table">
                        <colgroup>
                            <col className="final-score-col-place" />
                            <col className="final-score-col-username" />
                            {showEarlyRoundsSummaryColumn ? <col /> : null}
                            {showPreviousRoundColumn ? <col /> : null}
                            <col />
                            <col className="final-score-col-total" />
                        </colgroup>
                        <thead>
                            <tr>
                                <th className="final-score-col-place final-score-col-place-head"></th>
                                <th className="final-score-col-username final-score-col-username-head">Username</th>
                                {showEarlyRoundsSummaryColumn ? (
                                    <th>{getEarlyRoundsLabel()}</th>
                                ) : null}
                                {showPreviousRoundColumn ? (
                                    <th>{getPreviousRoundLabel()}</th>
                                ) : null}
                                <th className="final-score-current-round-head">{getCurrentRoundLabel()}</th>
                                <th className="final-score-col-total final-score-col-total-head">Total Score</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sorted.map((player, index) => {
                                const isSelf = selfUserId != null && player.userId === selfUserId;
                                const movement = getMovementLabel(player);
                                return (
                                    <tr key={player.userId} className={isSelf ? "final-score-row-self" : ""}>
                                        <td className="final-score-col-place final-score-place-badge">{toOverallPlaceText(index + 1)}</td>
                                        <td className="final-score-col-username">
                                            <span className={`final-score-player-name${index === 0 ? " final-score-player-name-leading" : ""}`}>
                                                {`${player.username}${player.isSpecialWin ? " *" : ""}`}
                                            </span>
                                            {movement ? (
                                                <span className={`final-score-inline-movement ${movement.className}`}>{movement.text}</span>
                                            ) : null}
                                        </td>
                                        {showEarlyRoundsSummaryColumn ? (
                                            <td>{getEarlyRoundsSummaryText(player)}</td>
                                        ) : null}
                                        {showPreviousRoundColumn ? (
                                            <td>{getRoundScoreText(player, resolvedTotalRounds === 2 ? 0 : resolvedTotalRounds - 2)}</td>
                                        ) : null}
                                        <td className="final-score-current-round-cell">
                                            <span className={`final-score-current-round-score${currentRoundRanksByUserId[player.userId] === 1 ? " final-score-current-round-score-winning" : ""}`}>
                                                {getRoundScoreText(player, currentRoundIndex)}
                                            </span>
                                            {currentRoundRanksByUserId[player.userId] != null && toRoundMedal(currentRoundRanksByUserId[player.userId]) ? (
                                                <span className={`final-score-current-round-medal${currentRoundRanksByUserId[player.userId] === 1 ? " final-score-current-round-medal-winning" : ""}`}>
                                                    {toRoundMedal(currentRoundRanksByUserId[player.userId])}
                                                </span>
                                            ) : null}
                                        </td>
                                        <td className="final-score-col-total">{toScoreText(player.totalScore)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                {!hideRematchSection ? (
                <div className="final-score-rematch">
                    <h2 className="final-score-rematch-title">
                        Rematch?{" "}
                        <span className={`final-score-rematch-timer${isUrgentCountdown ? " final-score-rematch-timer-urgent" : ""}`}>
                            {rematchCountdownSeconds}s
                        </span>
                    </h2>
                    <p className="final-score-rematch-help">
                        {sessionEnded
                            ? 'The configured match has ended. Rematch (Continue) is unavailable; Rematch (Fresh) and No Rematch are still available.'
                            : 'Continue keeps the same lobby code. Fresh creates a new lobby code.'}
                    </p>

                    {/* 10s countdown confirmation after button click (or remaining rematch time if <=10s) */}
                    {pendingDecision !== null && (
                        <div className="final-score-confirm-modal cabo-inline-confirm">
                            <p className="final-score-confirm-text cabo-inline-confirm-text">
                                Confirm:{" "}
                                <strong>
                                    {pendingDecision === "CONTINUE"
                                        ? "Rematch (Continue)"
                                        : pendingDecision === "FRESH"
                                            ? "Rematch (Fresh)"
                                            : "No Rematch"}
                                </strong>
                                {" "}in{" "}
                                <span className="final-score-confirm-countdown cabo-inline-confirm-countdown">{confirmCountdown}s</span>
                            </p>
                            <div className="final-score-confirm-actions cabo-inline-confirm-actions">
                                <Button
                                    type="primary"
                                    loading={isSubmittingRematchDecision}
                                    disabled={sessionEnded && pendingDecision === 'CONTINUE'}
                                    onClick={() => {
                                        if (sessionEnded && pendingDecision === 'CONTINUE') {
                                            clearPendingConfirm();
                                            return;
                                        }
                                        onChooseRematch(pendingDecision);
                                        clearPendingConfirm();
                                    }}
                                >
                                    Confirm
                                </Button>
                                <Button
                                    type="default"
                                    danger
                                    onClick={clearPendingConfirm}
                                >
                                    Cancel
                                </Button>
                            </div>
                        </div>
                    )}

                    {myRematchDecision != null && (
                        <p className="final-score-rematch-choice">
                            You chose:{" "}
                            {myRematchDecision === "CONTINUE"
                                ? "Rematch (Continue Round Count)"
                                : myRematchDecision === "FRESH"
                                    ? "Rematch (Fresh Game)"
                                    : "No Rematch"}
                            . Waiting for other players...
                        </p>
                    )}

                    <div className="final-score-rematch-actions">
                        <Button
                            type={myRematchDecision === "CONTINUE" ? "primary" : "default"}
                            className={`final-score-rematch-btn${!isDecisionLocked ? " final-score-rematch-btn-glow" : ""}${isUrgentCountdown ? " final-score-rematch-btn-urgent" : ""}`}
                            disabled={sessionEnded || isDecisionLocked || pendingDecision !== null}
                            title={sessionEnded ? 'The configured match has ended. Start a fresh rematch instead.' : undefined}
                            onClick={() => startConfirm("CONTINUE")}
                        >
                            Rematch (Continue)
                        </Button>
                        <Button
                            type={myRematchDecision === "FRESH" ? "primary" : "default"}
                            className={`final-score-rematch-btn${!isDecisionLocked ? " final-score-rematch-btn-glow" : ""}${isUrgentCountdown ? " final-score-rematch-btn-urgent" : ""}`}
                            disabled={isDecisionLocked || pendingDecision !== null}
                            onClick={() => startConfirm("FRESH")}
                        >
                            Rematch (Fresh)
                        </Button>
                        <Button
                            type={myRematchDecision === "NONE" ? "primary" : "default"}
                            danger
                            className={`final-score-rematch-btn${!isDecisionLocked ? " final-score-rematch-btn-glow" : ""}${isUrgentCountdown ? " final-score-rematch-btn-urgent" : ""}`}
                            disabled={isDecisionLocked || pendingDecision !== null}
                            onClick={() => startConfirm("NONE")}
                        >
                            No Rematch
                        </Button>
                    </div>

                    {shouldShowChat ? (
                        <div className="final-score-chat-block">
                            <CaboChatPanel
                                sessionId={normalizedChatSessionId}
                                token={normalizedChatToken}
                                userId={normalizedChatUserId}
                                userPrimaryColorById={chatUserPrimaryColorById}
                                cooldownSeconds={chatCooldownSeconds}
                                variant="game"
                                className="final-score-chat-panel"
                            />
                        </div>
                    ) : null}
                </div>
                ) : null}
            </div>
        </div>
    );
};

export default FinalScoreScreen;
