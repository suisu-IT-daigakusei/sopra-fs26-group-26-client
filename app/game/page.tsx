"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CharacterAvatar from "@/components/CharacterAvatar";
import CaboChatPanel from "@/components/CaboChatPanel";
import InlineMusicPlayer from "@/components/InlineMusicPlayer";
import { useApi } from "@/hooks/useApi";
import { useAttentionTitleBlink } from "@/hooks/useAttentionTitleBlink";
import {
    playSharedCaboSoundEffect,
    startSharedLoopedCaboSoundEffect,
    stopSharedLoopedCaboSoundEffect,
} from "@/hooks/useCaboMusicPlayer";
import { Button } from "antd";
import useLocalStorage from "@/hooks/useLocalStorage";
import CardComponent from "./components/CardComponent";
import PeekTimer from "./components/PeekTimer";
import type { ApplicationError } from "@/types/error";
import { getApiDomain, getStompBrokerUrl } from "@/utils/domain";
import { Client } from "@stomp/stompjs";
import SockJS from "sockjs-client";
import type { User } from "@/types/user";
import { useRouter } from "next/navigation";
import Scores from "./components/Scores";
import FinalScoreScreen from "./components/FinalScoreScreen";
import {
    getCharacterWavingFrameMax,
    normalizeCharacterId,
    normalizePrimaryColorId,
} from "@/utils/userSettings";

interface Card {
    value: number;
    visibility: boolean;
    ability: string;
}

type PlayerHandSignal = {
    userId?: number | string | null;
    id?: number | string | null;
    username?: string | null;
    name?: string | null;
    totalScore?: number | string | null;
    roundScore?: number | string | null;
    isSpecialWin?: boolean | null;
    cards?: CardViewSignal[] | null;
};

type CardViewSignal = {
    position?: number | string | null;
    faceDown?: boolean | null;
    value?: number | string | null;
    code?: string | null;
};

type SeatCardView = {
    position: number;
    faceDown: boolean;
    value?: number;
    code?: string;
};

type UnknownRecord = Record<string, unknown>;

type GameStateSignal = {
    gameId?: string | null;
    id?: string | null;
    sessionId?: string | null;
    lobbySessionId?: string | null;
    lobbyId?: string | null;
    code?: string | null;
    status?: string | null;
    gameStatus?: string | null;
    phase?: string | null;
    currentTurnUserId?: number | string | null;
    currentPlayerId?: number | string | null;
    currentTurnPlayerId?: number | string | null;
    caboCalled?: boolean | null;
    caboForcedByTimeout?: boolean | null;
    turnSeconds?: number | string | null;
    initialPeekSeconds?: number | string | null;
    abilityRevealSeconds?: number | string | null;
    abilitySwapSeconds?: number | string | null;
    caboRevealSeconds?: number | string | null;
    rematchDecisionSeconds?: number | string | null;
    afkTimeoutSeconds?: number | string | null;
    timedOutPlayerIds?: Array<number | string | null> | null;
    lastMoveEvent?: LastMoveEventSignal | null;
    userScoresPerRound?: Array<Record<string, number | string | null>> | null;
    totalScoreByUserId?: Record<string, number | string | null> | null;
    discardPileTop?: {
        value?: number | string | null;
        code?: string | null;
    } | null;
    players?: PlayerHandSignal[] | null;
};

type GameRuntimeConfigResponse = {
    turnSeconds?: number | string | null;
    initialPeekSeconds?: number | string | null;
    abilityRevealSeconds?: number | string | null;
    abilitySwapSeconds?: number | string | null;
    caboRevealSeconds?: number | string | null;
    afkTimeoutSeconds?: number | string | null;
    rematchDecisionSeconds?: number | string | null;
};

type WaitingLobbyPlayerRow = {
    userId?: number | string | null;
    username?: string | null;
    profileCharacterId?: string | null;
    characterColorId?: string | null;
};

type WaitingLobbySnapshot = {
    players?: WaitingLobbyPlayerRow[] | null;
    chatCooldownSeconds?: number | string | null;
};

type ActiveGameStatusSnapshot = {
    gameId?: string | null;
    status?: string | null;
};

type MoveZoneSignal = "DRAW_PILE" | "DISCARD_PILE" | "HAND";

type MoveStepSignal = {
    sourceZone?: MoveZoneSignal | string | null;
    sourceUserId?: number | string | null;
    sourceCardIndex?: number | string | null;
    targetZone?: MoveZoneSignal | string | null;
    targetUserId?: number | string | null;
    targetCardIndex?: number | string | null;
    hidden?: boolean | null;
    value?: number | string | null;
};

type LastMoveEventSignal = {
    sequence?: number | string | null;
    actorUserId?: number | string | null;
    primary?: MoveStepSignal | null;
    secondary?: MoveStepSignal | null;
};

type FlyingCardAnimation = {
    id: number;
    hidden: boolean;
    value?: number;
    startX: number;
    startY: number;
    deltaX: number;
    deltaY: number;
    width: number;
    height: number;
    fadeMode: "default" | "late";
};

type FlyingCardAnimationOptions = {
    fadeMode?: "default" | "late";
};

type PendingRemoteDrawAnimation = {
    source: "draw_pile" | "discard_pile";
    cardValue?: number;
};

type DrawSource = "draw_pile" | "discard_pile" | "unknown";

type ParsedMoveStep = {
    sourceZone: MoveZoneSignal;
    sourceUserId: number | null;
    sourceCardIndex: number | null;
    targetZone: MoveZoneSignal;
    targetUserId: number | null;
    targetCardIndex: number | null;
    hidden: boolean;
    value?: number;
};

type ParsedMoveEvent = {
    sequence: number;
    actorUserId: number | null;
    primary: ParsedMoveStep;
    secondary: ParsedMoveStep | null;
};

type FinalRoundPlayerScore = {
    userId: number;
    username: string;
    totalScore: number | null;
    roundScores: Array<number | null>;
    isSpecialWin?: boolean;
};

type FinalRoundScoresSnapshot = {
    players: FinalRoundPlayerScore[];
    totalRounds: number;
};

function getAbilityCardLabel(value?: number): string | undefined {
    if (value === 7 || value === 8) {
        return "PEEK";
    }
    if (value === 9 || value === 10) {
        return "SPY";
    }
    if (value === 11 || value === 12) {
        return "SWAP";
    }
    return undefined;
}

function formatPointsLabel(score: number | null | undefined): string {
    if (score == null || !Number.isFinite(score)) {
        return "-";
    }
    const normalized = Math.trunc(score);
    return normalized === 1 ? "1 pt" : `${normalized} pts`;
}

function normalizeValue(value: unknown): string {
    return String(value ?? "").trim().toLowerCase();
}

function isPlaceholderPlayerName(value: unknown): boolean {
    const label = String(value ?? "").trim();
    return !label || /^player\s+\d+$/i.test(label);
}

function toFiniteNumberOrUndefined(value: unknown): number | undefined {
    if (value == null) {
        return undefined;
    }
    if (typeof value === "string" && value.trim() === "") {
        return undefined;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeGameStatus(value: unknown): string {
    const normalized = normalizeValue(value);
    if (!normalized) {
        return "";
    }

    const canonical = normalized.replace(/[\s-]+/g, "_");
    switch (canonical) {
        case "intro":
        case "round_intro":
        case "intro_phase":
            return "intro";
        case "initial_peek":
        case "peek_phase":
            return "initial_peek";
        case "round_active":
        case "normal_phase":
            return "round_active";
        case "cabo_reveal":
            return "cabo_reveal";
        case "round_awaiting_rematch":
        case "scoreboard_and_rematch":
            return "round_awaiting_rematch";
        default:
            return canonical;
    }
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
    const directStatus = normalizeGameStatus(record.status ?? record.gameStatus ?? record.phase);
    if (directStatus) {
        return directStatus;
    }

    const nestedGame = record.game;
    if (!nestedGame || typeof nestedGame !== "object") {
        return "";
    }

    const nestedRecord = nestedGame as Record<string, unknown>;
    return normalizeGameStatus(nestedRecord.status ?? nestedRecord.gameStatus ?? nestedRecord.phase);
}

function extractCurrentTurnUserId(value: unknown): number | null {
    if (!value || typeof value !== "object") {
        return null;
    }

    const record = value as Record<string, unknown>;
    const candidate =
        record.currentTurnUserId ??
        record.currentPlayerId ??
        record.currentTurnPlayerId;

    if (candidate == null || candidate === "") {
        return null;
    }

    const parsed = Number(candidate);
    return Number.isFinite(parsed) ? parsed : null;
}

function extractGameStateRecords(value: unknown): Record<string, unknown>[] {
    if (!value || typeof value !== "object") {
        return [];
    }

    const root = value as Record<string, unknown>;
    const records: Record<string, unknown>[] = [root];
    const nestedKeys = ["game", "state", "data", "session"];
    for (const key of nestedKeys) {
        const nested = root[key];
        if (!nested || typeof nested !== "object" || Array.isArray(nested)) {
            continue;
        }
        records.push(nested as Record<string, unknown>);
    }
    return records;
}

function extractGameStatePlayers(value: unknown): Record<string, unknown>[] {
    for (const record of extractGameStateRecords(value)) {
        const playersRaw = record.players;
        if (!Array.isArray(playersRaw)) {
            continue;
        }

        const players = playersRaw
            .map((entry) => (entry && typeof entry === "object" && !Array.isArray(entry)
                ? entry as Record<string, unknown>
                : null))
            .filter((entry): entry is Record<string, unknown> => entry != null);

        if (players.length > 0) {
            return players;
        }
    }

    return [];
}

function extractPlayerIds(value: unknown): number[] {
    const ids: number[] = [];
    for (const playerRecord of extractGameStatePlayers(value)) {
        const rawId = playerRecord.userId ?? playerRecord.id;
        if (rawId == null || rawId === "") {
            continue;
        }

        const parsedId = Number(rawId);
        if (Number.isFinite(parsedId)) {
            ids.push(parsedId);
        }
    }

    return ids;
}

function normalizeSeatCards(cards: CardViewSignal[] | null | undefined): SeatCardView[] {
    if (!Array.isArray(cards)) {
        return [];
    }

    return cards
        .map((card, index) => {
            const parsedPosition = Number(card?.position);
            const parsedValue = toFiniteNumberOrUndefined(card?.value);
            const parsedCode =
                typeof card?.code === "string" && card.code.trim() !== ""
                    ? card.code.trim()
                    : undefined;
            return {
                position: Number.isFinite(parsedPosition) ? parsedPosition : index,
                faceDown: card?.faceDown !== false,
                value: parsedValue,
                code: parsedCode,
            };
        })
        .sort((a, b) => a.position - b.position);
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

function extractPlayerCardsById(value: unknown): Record<number, SeatCardView[]> {
    const byId: Record<number, SeatCardView[]> = {};
    for (const playerRecord of extractGameStatePlayers(value)) {
        const rawId = playerRecord.userId ?? playerRecord.id;
        const parsedId = Number(rawId);
        if (!Number.isFinite(parsedId)) {
            continue;
        }

        byId[parsedId] = normalizeSeatCards(playerRecord.cards as CardViewSignal[] | null | undefined);
    }

    return byId;
}

function extractTouchedHandIndicesByPlayerId(value: unknown): Record<number, number[]> {
    const touchedById: Record<number, number[]> = {};
    for (const playerRecord of extractGameStatePlayers(value)) {
        const rawId = playerRecord.userId ?? playerRecord.id;
        const parsedId = Number(rawId);
        if (!Number.isFinite(parsedId)) {
            continue;
        }

        const cards = playerRecord.cards;
        if (!Array.isArray(cards)) {
            continue;
        }

        const touched = new Set<number>();
        cards.forEach((cardEntry, fallbackIndex) => {
            if (!cardEntry || typeof cardEntry !== "object") {
                return;
            }
            const cardRecord = cardEntry as Record<string, unknown>;
            const parsedPosition = Number(cardRecord.position);
            const slotIndex = Number.isFinite(parsedPosition) ? parsedPosition : fallbackIndex;
            if (slotIndex >= 0) {
                touched.add(slotIndex);
            }
        });

        if (touched.size > 0) {
            touchedById[parsedId] = Array.from(touched).sort((a, b) => a - b);
        }
    }

    return touchedById;
}

function extractDiscardTopUpdate(value: unknown): { hasDiscardTop: boolean; card: Card | null } {
    if (!value || typeof value !== "object") {
        return { hasDiscardTop: false, card: null };
    }

    const record = value as Record<string, unknown>;
    let discardCandidate: unknown;
    if ("discardPileTop" in record) {
        discardCandidate = record.discardPileTop;
    } else {
        const nestedGame = record.game;
        if (nestedGame && typeof nestedGame === "object" && "discardPileTop" in (nestedGame as Record<string, unknown>)) {
            discardCandidate = (nestedGame as Record<string, unknown>).discardPileTop;
        } else {
            return { hasDiscardTop: false, card: null };
        }
    }

    if (!discardCandidate || typeof discardCandidate !== "object") {
        return { hasDiscardTop: true, card: null };
    }

    const parsedValue = toFiniteNumberOrUndefined((discardCandidate as Record<string, unknown>).value);
    if (parsedValue == null) {
        return { hasDiscardTop: true, card: null };
    }

    return {
        hasDiscardTop: true,
        card: {
            value: parsedValue,
            visibility: true,
            ability: "",
        },
    };
}

function extractDrawnCardPresence(value: unknown): { hasDrawnCardField: boolean; present: boolean } {
    if (!value || typeof value !== "object") {
        return { hasDrawnCardField: false, present: false };
    }

    const record = value as Record<string, unknown>;
    if ("drawnCard" in record) {
        return {
            hasDrawnCardField: true,
            present: Boolean(record.drawnCard && typeof record.drawnCard === "object"),
        };
    }

    const nestedGame = record.game;
    if (nestedGame && typeof nestedGame === "object" && "drawnCard" in (nestedGame as Record<string, unknown>)) {
        const nestedRecord = nestedGame as Record<string, unknown>;
        return {
            hasDrawnCardField: true,
            present: Boolean(nestedRecord.drawnCard && typeof nestedRecord.drawnCard === "object"),
        };
    }

    return { hasDrawnCardField: false, present: false };
}

function parseMoveZone(value: unknown): MoveZoneSignal | null {
    const normalized = String(value ?? "").trim().toUpperCase();
    if (normalized === "DRAW_PILE" || normalized === "DISCARD_PILE" || normalized === "HAND") {
        return normalized;
    }
    return null;
}

function parseMoveStep(value: unknown): ParsedMoveStep | null {
    if (!value || typeof value !== "object") {
        return null;
    }
    const record = value as Record<string, unknown>;
    const sourceZone = parseMoveZone(record.sourceZone);
    const targetZone = parseMoveZone(record.targetZone);
    if (!sourceZone || !targetZone) {
        return null;
    }
    const sourceUserId = Number(record.sourceUserId);
    const sourceCardIndex = Number(record.sourceCardIndex);
    const targetUserId = Number(record.targetUserId);
    const targetCardIndex = Number(record.targetCardIndex);
    const parsedValue = toFiniteNumberOrUndefined(record.value);
    return {
        sourceZone,
        sourceUserId: Number.isFinite(sourceUserId) ? sourceUserId : null,
        sourceCardIndex: Number.isFinite(sourceCardIndex) ? sourceCardIndex : null,
        targetZone,
        targetUserId: Number.isFinite(targetUserId) ? targetUserId : null,
        targetCardIndex: Number.isFinite(targetCardIndex) ? targetCardIndex : null,
        hidden: record.hidden !== false,
        value: parsedValue,
    };
}

function extractLastMoveEvent(value: unknown): ParsedMoveEvent | null {
    if (!value || typeof value !== "object") {
        return null;
    }
    const record = value as Record<string, unknown>;
    const candidate = record.lastMoveEvent ?? (record.game && typeof record.game === "object"
        ? (record.game as Record<string, unknown>).lastMoveEvent
        : null);
    if (!candidate || typeof candidate !== "object") {
        return null;
    }
    const moveRecord = candidate as Record<string, unknown>;
    const sequence = Number(moveRecord.sequence);
    if (!Number.isFinite(sequence) || sequence <= 0) {
        return null;
    }
    const primary = parseMoveStep(moveRecord.primary);
    if (!primary) {
        return null;
    }
    const secondary = parseMoveStep(moveRecord.secondary);
    const actorUserId = Number(moveRecord.actorUserId);
    return {
        sequence,
        actorUserId: Number.isFinite(actorUserId) ? actorUserId : null,
        primary,
        secondary,
    };
}

function areSeatCardsEquivalent(previousCard?: SeatCardView, nextCard?: SeatCardView): boolean {
    if (!previousCard && !nextCard) {
        return true;
    }
    if (!previousCard || !nextCard) {
        return false;
    }
    return (
        previousCard.faceDown === nextCard.faceDown &&
        previousCard.value === nextCard.value &&
        previousCard.code === nextCard.code
    );
}

function normalizeHandSlotIndex(rawIndex: number, handSize: number): number | null {
    if (rawIndex >= 0 && rawIndex < handSize) {
        return rawIndex;
    }
    if (rawIndex >= 1 && rawIndex <= handSize) {
        return rawIndex - 1;
    }
    return null;
}

function arraysEqual(a: number[], b: number[]): boolean {
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i += 1) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}

function toValidCardOrNull(candidate: unknown): Card | null {
    if (!candidate || typeof candidate !== "object") {
        return null;
    }

    const record = candidate as UnknownRecord;
    const parsedValue = Number(record.value);
    if (!Number.isFinite(parsedValue)) {
        return null;
    }

    return {
        value: parsedValue,
        visibility: Boolean(record.visibility),
        ability: typeof record.ability === "string" ? record.ability : "",
    };
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
): FinalRoundScoresSnapshot | null {
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

    const players: FinalRoundPlayerScore[] = orderedIds.map((userId) => {
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

function toEpochMs(value: unknown): number {
    if (typeof value === "number" && Number.isFinite(value)) {
        const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
        return Number.isFinite(milliseconds) ? milliseconds : 0;
    }
    const text = String(value ?? "").trim();
    if (!text) {
        return 0;
    }
    const parsedNumeric = Number(text);
    if (Number.isFinite(parsedNumeric)) {
        const milliseconds = parsedNumeric < 10_000_000_000 ? parsedNumeric * 1000 : parsedNumeric;
        return Number.isFinite(milliseconds) ? milliseconds : 0;
    }
    const parsedDate = new Date(text).getTime();
    return Number.isFinite(parsedDate) ? parsedDate : 0;
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
            (entry) => normalizeValue(extractSessionHistoryCode(entry)) === preferredId
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
): { snapshot: FinalRoundScoresSnapshot; sessionCode: string } | null {
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
        snapshot,
        sessionCode: extractSessionHistoryCode(selectedEntry),
    };
}

const Game = () => {
  const apiService = useApi();
  const router = useRouter();
  const { value: activeSessionId, set: setActiveSessionId } = useLocalStorage<string>("activeSessionId", "");
  const { value: activeLobbySessionId, set: setActiveLobbySessionId } =
      useLocalStorage<string>("activeLobbySessionId", "");
  const { value: activeGameStatusSnapshot, set: setActiveGameStatusSnapshot } =
      useLocalStorage<ActiveGameStatusSnapshot | null>("activeGameStatusSnapshot", null);
  const gameId = activeSessionId.trim();
  const lobbySessionId = activeLobbySessionId.trim();
  const { value: token } = useLocalStorage<string>("token", "");
  const HAND_SIZE = 4; // referencing here, keeps it consistent and less prone to errors
  const HOW_TO_PLAY_PANEL_DEFAULT_WIDTH = 360;
  const HOW_TO_PLAY_PANEL_MARGIN = 14;
  const HOW_TO_PLAY_PANEL_DEFAULT_TOP = 18;
  const TURN_CARD_DRAG_MIME = "application/x-cabo-turn-card";
  const DISCARD_PILE_SWAP_DRAG_MIME = "application/x-cabo-discard-pile-swap";
  const FLYING_CARD_ANIMATION_MS = 3000; // slower
  const SESSION_SCORE_REFRESH_MS = 8000;
  const createHiddenPeekCards = () => Array(HAND_SIZE).fill(false); // hide card by default



  // Backlog #9: Implement logic to always render the DiscardPile top card with its face-up value
      const [discardTopCard, setDiscardTopCard] = useState<Card | null>(null);

      //get the top card from the backend
      useEffect(() => {
          const authToken = token.trim();
          if (!gameId || !authToken) {
              setDiscardTopCard(null);
              return;
          }

          const fetchDiscardTopCard = async () => {
              try {
                  const card = await apiService.getWithAuth<Card | null>(
                      `/games/${gameId}/discard-pile/top`,
                      authToken
                  );
                  setDiscardTopCard(card ?? null);
              } catch (error) {
                  console.error("Failed to fetch discard pile top card:", error);
              }
          };

          fetchDiscardTopCard();
      }, [apiService, gameId, token]);

      // 1st we get userID out of local storage
      const { value: userId } = useLocalStorage<string>("userId", "");

      // #15: track wich bottom cards are faced up during the peekphase
      const [peekVisibleCards, setPeekVisibleCards] = useState<boolean[]>(createHiddenPeekCards);
      // #17: Peek Phase Timer
      const [isPeekPhase, setIsPeekPhase] = useState<boolean>(false);
      const gameStatusSnapshotForCurrentGame = useMemo(() => {
          if (!activeGameStatusSnapshot || !gameId) {
              return "";
          }
          const snapshotGameId = String(activeGameStatusSnapshot.gameId ?? "").trim();
          if (!snapshotGameId || snapshotGameId !== gameId) {
              return "";
          }
          return normalizeGameStatus(activeGameStatusSnapshot.status);
      }, [activeGameStatusSnapshot, gameId]);
      // #15: player's own hand
      const [gameStatus, setGameStatus] = useState<string>(gameStatusSnapshotForCurrentGame);
      const isIntroPhase = gameStatus === "intro";
      const isCaboRevealPhase = gameStatus === "cabo_reveal";
      const isAwaitingRematchDecision = gameStatus === "round_awaiting_rematch";
      const isRoundEndedPhase = gameStatus === "round_ended";
      const isRematchScreenPhase = isAwaitingRematchDecision || isRoundEndedPhase;
      const isPostRoundPhase = isCaboRevealPhase || isRematchScreenPhase;
      const [myHand, setMyHand] = useState<Card[]>([]);
      const [selectedPeekIndices, setSelectedPeekIndices] = useState<number[]>([]);
      const [isSubmittingInitialPeek, setIsSubmittingInitialPeek] = useState<boolean>(false);
      const revealedPeekCount = peekVisibleCards.filter(Boolean).length;
      //#19 Add a visual timer/progress bar that syncs with the backend to warn the player of expiring time
      const DEFAULT_TURN_SECONDS = 30;
      const DEFAULT_INITIAL_PEEK_SECONDS = 10;
      const DEFAULT_ABILITY_REVEAL_SECONDS = 5;
      const DEFAULT_ABILITY_SWAP_SECONDS = 10;
      const DEFAULT_ROUND_REVEAL_SECONDS = 30;
      const [rematchDecisionDuration, setRematchDecisionDuration] = useState<number>(30);
      const [caboRevealDurationSeconds, setCaboRevealDurationSeconds] =
          useState<number>(DEFAULT_ROUND_REVEAL_SECONDS);
      const [turnDurationSeconds, setTurnDurationSeconds] = useState<number>(DEFAULT_TURN_SECONDS);
      const [initialPeekDurationSeconds, setInitialPeekDurationSeconds] =
          useState<number>(DEFAULT_INITIAL_PEEK_SECONDS);
      const [abilityRevealDurationSeconds, setAbilityRevealDurationSeconds] =
          useState<number>(DEFAULT_ABILITY_REVEAL_SECONDS);
      const [abilitySwapDurationSeconds, setAbilitySwapDurationSeconds] =
          useState<number>(DEFAULT_ABILITY_SWAP_SECONDS);
      const [isHowToPlayOpen, setIsHowToPlayOpen] = useState<boolean>(false);
      const [howToPlayPanelPosition, setHowToPlayPanelPosition] = useState<{ x: number; y: number } | null>(null);
      const [isAbilityRevealWindow, setIsAbilityRevealWindow] = useState<boolean>(false);
      const [isCaboCalledGlobal, setIsCaboCalledGlobal] = useState<boolean>(false);
      const [isCaboForcedByTimeoutGlobal, setIsCaboForcedByTimeoutGlobal] = useState<boolean>(false);
      const [afkTimeoutSeconds, setAfkTimeoutSeconds] = useState<number>(300);
      const [afkRemainingSeconds, setAfkRemainingSeconds] = useState<number>(300);
      const [socketSynced, setSocketSynced] = useState<boolean>(true);
      // #20
      const [drawnCard, setDrawnCard] = useState<Card | null>(null);
      const [selectedDrawSource, setSelectedDrawSource] = useState<DrawSource | null>(null);
      const [, setHasChosenDrawSourceThisTurn] = useState<boolean>(false);
      const [isDrawingFromPile, setIsDrawingFromPile] = useState<boolean>(false);
      const [isDrawingFromDiscardPile, setIsDrawingFromDiscardPile] = useState<boolean>(false);
      const [isSwappingDrawnCard, setIsSwappingDrawnCard] = useState<boolean>(false);
      const [isDiscardingDrawnCard, setIsDiscardingDrawnCard] = useState<boolean>(false);
      const [isSkippingAbilityChoice, setIsSkippingAbilityChoice] = useState<boolean>(false);
      const [isDraggingTurnCard, setIsDraggingTurnCard] = useState<boolean>(false);
      const [isDraggingDiscardPileSwapCard, setIsDraggingDiscardPileSwapCard] = useState<boolean>(false);
      const [dragOverOwnCardIndex, setDragOverOwnCardIndex] = useState<number | null>(null);
      const [isDragOverDiscardPile, setIsDragOverDiscardPile] = useState<boolean>(false);
      const [isDiscardPileTemporarilyHidden, setIsDiscardPileTemporarilyHidden] = useState<boolean>(false);
      const [discardTopAnimationOverride, setDiscardTopAnimationOverride] = useState<Card | null>(null);
      const [flyingCardAnimations, setFlyingCardAnimations] = useState<FlyingCardAnimation[]>([]);
      const drawRequestInFlightRef = useRef<boolean>(false);
      const drawPileCardRef = useRef<HTMLDivElement | null>(null);
      const discardPileCardRef = useRef<HTMLDivElement | null>(null);
      const ownHandCardRefs = useRef<Array<HTMLDivElement | null>>([]);
      const topSeatCardRefs = useRef<Array<HTMLDivElement | null>>([]);
      const leftSeatCardRefs = useRef<Array<HTMLDivElement | null>>([]);
      const rightSeatCardRefs = useRef<Array<HTMLDivElement | null>>([]);
      const flyingCardIdRef = useRef<number>(0);
      const flyingCardTimeoutsRef = useRef<number[]>([]);
      const discardRevealTimeoutRef = useRef<number | null>(null);
      const abilityPeekHideTimeoutRef = useRef<number | null>(null);
      const discardTopOverrideTimeoutRef = useRef<number | null>(null);
      const howToPlayPanelRef = useRef<HTMLDivElement | null>(null);
      const howToPlayPanelDragRef = useRef<{
          active: boolean;
          pointerId: number | null;
          offsetX: number;
          offsetY: number;
      }>({
          active: false,
          pointerId: null,
          offsetX: 0,
          offsetY: 0,
      });
      const pendingRemoteDrawAnimationRef = useRef<PendingRemoteDrawAnimation | null>(null);
      const drawnCardPresentRef = useRef<boolean>(false);
      const playerCardsByIdRef = useRef<Record<number, SeatCardView[]>>({});
      const discardTopCardRef = useRef<Card | null>(null);
      const currentTurnUserIdRef = useRef<number | null>(null);
      const lastActivityMsRef = useRef<number>(Date.now());
      const lastProcessedMoveSequenceRef = useRef<number>(0);
      const lastGameStateSignalMsRef = useRef<number>(Date.now());
      const lastAuthoritativeResyncMsRef = useRef<number>(0);
      const hasSeenCaboCallStateRef = useRef<boolean>(false);
      const previousCaboCalledStateRef = useRef<boolean>(false);
      const gameStartSoundPlayedForGameRef = useRef<string>("");
      const previousCaboRevealWinnerStageRef = useRef<boolean>(false);
      const gameAfkWarningLoopActiveRef = useRef<boolean>(false);
      const [orderedPlayerIds, setOrderedPlayerIds] = useState<number[]>([]);
      const [playerCardsById, setPlayerCardsById] = useState<Record<number, SeatCardView[]>>({});
      const [playerNamesById, setPlayerNamesById] = useState<Record<number, string>>({});
      const [playerCharacterById, setPlayerCharacterById] = useState<Record<number, string>>({});
      const [playerPrimaryColorById, setPlayerPrimaryColorById] = useState<Record<number, string>>({});
      const [chatCooldownSeconds, setChatCooldownSeconds] = useState<number>(3);
      // Final scores state (declare early so handlers can use them safely)
      const [finalScores, setFinalScores] = useState<Array<{
          userId: number;
          username: string;
          totalScore: number | null;
          roundScores?: Array<number | null>;
          isSpecialWin?: boolean;
      }>>([]);
      const [finalScoreTotalRounds, setFinalScoreTotalRounds] = useState<number>(0);
      const tablePlayerIdsRef = useRef<number[]>([]);
      const playerNamesByIdRef = useRef<Record<number, string>>({});
      const [timedOutPlayerIds, setTimedOutPlayerIds] = useState<number[]>([]);
      const [currentTurnUserId, setCurrentTurnUserId] = useState<number | null>(null);
      const [turnTimeLeftMs, setTurnTimeLeftMs] = useState<number>(DEFAULT_TURN_SECONDS * 1000);
      const [isCallingCabo, setIsCallingCabo] = useState<boolean>(false);
      const [isSubmittingRematchDecision, setIsSubmittingRematchDecision] = useState<boolean>(false);
      const [caboRevealCountdown, setCaboRevealCountdown] = useState<number>(0);
      const [caboRevealElapsedMs, setCaboRevealElapsedMs] = useState<number>(0);
      const [rematchCountdown, setRematchCountdown] = useState<number>(0);
      const [introElapsedMs, setIntroElapsedMs] = useState<number>(0);
      const [myRematchDecision, setMyRematchDecision] =
          useState<"CONTINUE" | "FRESH" | "NONE" | null>(null);
      const caboRevealPhaseStartedAtMsRef = useRef<number | null>(null);
      const introPhaseStartedAtMsRef = useRef<number | null>(null);
      const turnDeadlineMsRef = useRef<number | null>(null);
      const caboRevealDeadlineMsRef = useRef<number | null>(null);
      const rematchDeadlineMsRef = useRef<number | null>(null);
      const consecutiveNotMyTurnPollsRef = useRef<number>(0);
      const consecutiveNoOwnerProbePollsRef = useRef<number>(0);

      const parsedSelfUserId = Number(userId);
      const selfUserId = userId.trim() !== "" && Number.isFinite(parsedSelfUserId)
          ? parsedSelfUserId
          : null;

      const clampHowToPlayPanelPosition = useCallback(
          (x: number, y: number, panelWidth: number, panelHeight: number) => {
              if (typeof window === "undefined") {
                  return { x, y };
              }
              const minX = HOW_TO_PLAY_PANEL_MARGIN;
              const minY = HOW_TO_PLAY_PANEL_MARGIN;
              const maxX = Math.max(minX, window.innerWidth - panelWidth - HOW_TO_PLAY_PANEL_MARGIN);
              const maxY = Math.max(minY, window.innerHeight - panelHeight - HOW_TO_PLAY_PANEL_MARGIN);
              return {
                  x: Math.min(Math.max(x, minX), maxX),
                  y: Math.min(Math.max(y, minY), maxY),
              };
          },
          [HOW_TO_PLAY_PANEL_MARGIN],
      );

      const ensureHowToPlayPanelPosition = useCallback(() => {
          if (typeof window === "undefined") {
              return;
          }
          setHowToPlayPanelPosition((previous) => {
              const panel = howToPlayPanelRef.current;
              const panelWidth = panel?.offsetWidth ?? HOW_TO_PLAY_PANEL_DEFAULT_WIDTH;
              const panelHeight = panel?.offsetHeight ?? 340;
              const defaultX = window.innerWidth - panelWidth - HOW_TO_PLAY_PANEL_MARGIN;
              const defaultY = HOW_TO_PLAY_PANEL_DEFAULT_TOP;
              const source = previous ?? { x: defaultX, y: defaultY };
              return clampHowToPlayPanelPosition(source.x, source.y, panelWidth, panelHeight);
          });
      }, [
          HOW_TO_PLAY_PANEL_DEFAULT_TOP,
          HOW_TO_PLAY_PANEL_DEFAULT_WIDTH,
          HOW_TO_PLAY_PANEL_MARGIN,
          clampHowToPlayPanelPosition,
      ]);

      const handleHowToPlayDragStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
          if (event.button !== 0) {
              return;
          }
          const panel = howToPlayPanelRef.current;
          if (!panel) {
              return;
          }
          const panelRect = panel.getBoundingClientRect();
          howToPlayPanelDragRef.current = {
              active: true,
              pointerId: event.pointerId,
              offsetX: event.clientX - panelRect.left,
              offsetY: event.clientY - panelRect.top,
          };
          event.preventDefault();
      }, []);

      useEffect(() => {
          if (!isHowToPlayOpen) {
              howToPlayPanelDragRef.current.active = false;
              howToPlayPanelDragRef.current.pointerId = null;
              return;
          }
          const frameId = window.requestAnimationFrame(() => {
              ensureHowToPlayPanelPosition();
          });
          return () => {
              window.cancelAnimationFrame(frameId);
          };
      }, [ensureHowToPlayPanelPosition, isHowToPlayOpen]);

      useEffect(() => {
          if (!isHowToPlayOpen) {
              return;
          }

          const handlePointerMove = (event: PointerEvent) => {
              const dragState = howToPlayPanelDragRef.current;
              if (!dragState.active) {
                  return;
              }
              if (dragState.pointerId !== null && event.pointerId !== dragState.pointerId) {
                  return;
              }
              const panel = howToPlayPanelRef.current;
              const panelWidth = panel?.offsetWidth ?? HOW_TO_PLAY_PANEL_DEFAULT_WIDTH;
              const panelHeight = panel?.offsetHeight ?? 340;
              const rawX = event.clientX - dragState.offsetX;
              const rawY = event.clientY - dragState.offsetY;
              setHowToPlayPanelPosition(
                  clampHowToPlayPanelPosition(rawX, rawY, panelWidth, panelHeight),
              );
          };

          const stopDragging = (event: PointerEvent) => {
              const dragState = howToPlayPanelDragRef.current;
              if (!dragState.active) {
                  return;
              }
              if (dragState.pointerId !== null && event.pointerId !== dragState.pointerId) {
                  return;
              }
              howToPlayPanelDragRef.current.active = false;
              howToPlayPanelDragRef.current.pointerId = null;
          };

          window.addEventListener("pointermove", handlePointerMove);
          window.addEventListener("pointerup", stopDragging);
          window.addEventListener("pointercancel", stopDragging);
          return () => {
              window.removeEventListener("pointermove", handlePointerMove);
              window.removeEventListener("pointerup", stopDragging);
              window.removeEventListener("pointercancel", stopDragging);
          };
      }, [
          HOW_TO_PLAY_PANEL_DEFAULT_WIDTH,
          clampHowToPlayPanelPosition,
          isHowToPlayOpen,
      ]);

      useEffect(() => {
          if (!isHowToPlayOpen) {
              return;
          }
          const handleResize = () => {
              ensureHowToPlayPanelPosition();
          };
          window.addEventListener("resize", handleResize);
          return () => {
              window.removeEventListener("resize", handleResize);
          };
      }, [ensureHowToPlayPanelPosition, isHowToPlayOpen]);

      useEffect(() => {
          const authToken = token.trim();
          const sessionCode = lobbySessionId.trim();
          if (!authToken || !sessionCode) {
              return;
          }

          let active = true;
          const loadLobbyCharacterAssignments = async () => {
              try {
                  const waitingSnapshot = await apiService.getWithAuth<WaitingLobbySnapshot>(
                      `/lobbies/waiting/${encodeURIComponent(sessionCode)}`,
                      authToken,
                  );
                  if (!active) {
                      return;
                  }
                  const rows = Array.isArray(waitingSnapshot?.players) ? waitingSnapshot.players : [];
                  const nextChatCooldown = Number(waitingSnapshot?.chatCooldownSeconds);
                  if (Number.isFinite(nextChatCooldown) && nextChatCooldown > 0) {
                      setChatCooldownSeconds(Math.max(1, Math.min(60, Math.floor(nextChatCooldown))));
                  }
                  if (rows.length === 0) {
                      return;
                  }

                  setPlayerNamesById((previous) => {
                      const next = { ...previous };
                      for (const row of rows) {
                          const parsedUserId = Number(row?.userId);
                          if (!Number.isFinite(parsedUserId)) {
                              continue;
                          }
                          const username = String(row?.username ?? "").trim();
                          if (!isPlaceholderPlayerName(username)) {
                              next[parsedUserId] = username;
                          }
                      }
                      return next;
                  });

                  setPlayerCharacterById((previous) => {
                      const next = { ...previous };
                      for (const row of rows) {
                          const parsedUserId = Number(row?.userId);
                          if (!Number.isFinite(parsedUserId)) {
                              continue;
                          }
                          next[parsedUserId] = normalizeCharacterId(row?.profileCharacterId);
                      }
                      return next;
                  });

                  setPlayerPrimaryColorById((previous) => {
                      const next = { ...previous };
                      for (const row of rows) {
                          const parsedUserId = Number(row?.userId);
                          if (!Number.isFinite(parsedUserId)) {
                              continue;
                          }
                          const rawCharacterColorId = String(row?.characterColorId ?? "").trim();
                          if (!rawCharacterColorId) {
                              continue;
                          }
                          next[parsedUserId] = normalizePrimaryColorId(rawCharacterColorId);
                      }
                      return next;
                  });
              } catch {
                  // fallback to user profile lookup later if waiting snapshot is unavailable
              }
          };

          void loadLobbyCharacterAssignments();
          return () => {
              active = false;
          };
      }, [apiService, lobbySessionId, token]);

      useEffect(() => {
          if (gameStatus !== "" || gameStatusSnapshotForCurrentGame === "") {
              return;
          }
          setGameStatus(gameStatusSnapshotForCurrentGame);
      }, [gameStatus, gameStatusSnapshotForCurrentGame]);

      useEffect(() => {
          if (!gameId || !gameStatus) {
              return;
          }
          const snapshotGameId = String(activeGameStatusSnapshot?.gameId ?? "").trim();
          const snapshotStatus = normalizeGameStatus(activeGameStatusSnapshot?.status);
          if (snapshotGameId === gameId && snapshotStatus === gameStatus) {
              return;
          }
          setActiveGameStatusSnapshot({
              gameId,
              status: gameStatus,
          });
      }, [activeGameStatusSnapshot, gameId, gameStatus, setActiveGameStatusSnapshot]);

      const tablePlayerIds = useMemo(() => {
          const unique = Array.from(new Set(orderedPlayerIds));
          if (selfUserId != null && !unique.includes(selfUserId)) {
              unique.push(selfUserId);
          }
          return unique;
      }, [orderedPlayerIds, selfUserId]);

      const seatAssignments = useMemo(() => {
          if (selfUserId == null || tablePlayerIds.length === 0) {
              return {
                  topOpponentId: null as number | null,
                  leftOpponentId: null as number | null,
                  rightOpponentId: null as number | null,
              };
          }

          const selfIndex = tablePlayerIds.indexOf(selfUserId);
          if (selfIndex < 0) {
              const fallbackOpponents = tablePlayerIds.filter((id) => id !== selfUserId);
              return {
                  topOpponentId: fallbackOpponents[0] ?? null,
                  leftOpponentId: fallbackOpponents[1] ?? null,
                  rightOpponentId: fallbackOpponents[2] ?? null,
              };
          }

          const clockwiseOpponents: number[] = [];
          for (let offset = 1; offset < tablePlayerIds.length; offset += 1) {
              clockwiseOpponents.push(
                  tablePlayerIds[(selfIndex + offset) % tablePlayerIds.length]
              );
          }

          if (clockwiseOpponents.length === 1) {
              // 2 players: opponent sits opposite
              return {
                  topOpponentId: clockwiseOpponents[0],
                  leftOpponentId: null,
                  rightOpponentId: null,
              };
          }

          if (clockwiseOpponents.length === 2) {
              // 3 players: left + top (right seat empty for now)
              return {
                  leftOpponentId: clockwiseOpponents[0],
                  topOpponentId: clockwiseOpponents[1],
                  rightOpponentId: null,
              };
          }

          // 4 players: left, top, right relative to viewer (bottom)
          return {
              leftOpponentId: clockwiseOpponents[0] ?? null,
              topOpponentId: clockwiseOpponents[1] ?? null,
              rightOpponentId: clockwiseOpponents[2] ?? null,
          };
      }, [selfUserId, tablePlayerIds]);

      const topSeatCards = useMemo(() => {
          if (seatAssignments.topOpponentId == null) {
              return [];
          }
          const sourceCards = playerCardsById[seatAssignments.topOpponentId] ?? [];
          const cardsBySlot = new Map<number, SeatCardView>();
          sourceCards.forEach((card) => {
              const normalizedSlot = normalizeHandSlotIndex(card.position, HAND_SIZE);
              if (normalizedSlot != null) {
                  cardsBySlot.set(normalizedSlot, card);
              }
          });
          return Array.from({ length: HAND_SIZE }, (_, index) => (
              cardsBySlot.get(index) ?? { position: index, faceDown: true, value: undefined }
          ));
      }, [seatAssignments.topOpponentId, playerCardsById, HAND_SIZE]);

      const leftSeatCards = useMemo(() => {
          if (seatAssignments.leftOpponentId == null) {
              return [];
          }
          const sourceCards = playerCardsById[seatAssignments.leftOpponentId] ?? [];
          const cardsBySlot = new Map<number, SeatCardView>();
          sourceCards.forEach((card) => {
              const normalizedSlot = normalizeHandSlotIndex(card.position, HAND_SIZE);
              if (normalizedSlot != null) {
                  cardsBySlot.set(normalizedSlot, card);
              }
          });
          return Array.from({ length: HAND_SIZE }, (_, index) => (
              cardsBySlot.get(index) ?? { position: index, faceDown: true, value: undefined }
          ));
      }, [seatAssignments.leftOpponentId, playerCardsById, HAND_SIZE]);

      const rightSeatCards = useMemo(() => {
          if (seatAssignments.rightOpponentId == null) {
              return [];
          }
          const sourceCards = playerCardsById[seatAssignments.rightOpponentId] ?? [];
          const cardsBySlot = new Map<number, SeatCardView>();
          sourceCards.forEach((card) => {
              const normalizedSlot = normalizeHandSlotIndex(card.position, HAND_SIZE);
              if (normalizedSlot != null) {
                  cardsBySlot.set(normalizedSlot, card);
              }
          });
          return Array.from({ length: HAND_SIZE }, (_, index) => (
              cardsBySlot.get(index) ?? { position: index, faceDown: true, value: undefined }
          ));
      }, [seatAssignments.rightOpponentId, playerCardsById, HAND_SIZE]);

      const topSeatDisplayCards = useMemo(
          () => [...topSeatCards].reverse(),
          [topSeatCards]
      );

      useEffect(() => {
          playerCardsByIdRef.current = playerCardsById;
      }, [playerCardsById]);

      useEffect(() => {
          tablePlayerIdsRef.current = tablePlayerIds;
      }, [tablePlayerIds]);

      useEffect(() => {
          playerNamesByIdRef.current = playerNamesById;
      }, [playerNamesById]);

      useEffect(() => {
          discardTopCardRef.current = discardTopCard;
      }, [discardTopCard]);

      useEffect(() => {
          currentTurnUserIdRef.current = currentTurnUserId;
      }, [currentTurnUserId]);

      useEffect(() => {
          if (!hasSeenCaboCallStateRef.current) {
              hasSeenCaboCallStateRef.current = true;
              previousCaboCalledStateRef.current = isCaboCalledGlobal;
              return;
          }

          if (!previousCaboCalledStateRef.current && isCaboCalledGlobal) {
              playSharedCaboSoundEffect("cabo_call");
          }
          previousCaboCalledStateRef.current = isCaboCalledGlobal;
      }, [isCaboCalledGlobal]);

      useEffect(() => {
          const normalizedGameId = String(gameId ?? "").trim();
          if (!normalizedGameId) {
              return;
          }
          if (gameStatus === "intro" && gameStartSoundPlayedForGameRef.current !== normalizedGameId) {
              gameStartSoundPlayedForGameRef.current = normalizedGameId;
              playSharedCaboSoundEffect("game_start");
          }
      }, [gameId, gameStatus]);

      const applyDrawnCardState = (nextDrawnCard: Card | null, sourceHint: DrawSource | null = null) => {
          setDrawnCard(nextDrawnCard);
          drawnCardPresentRef.current = nextDrawnCard != null;
          if (!nextDrawnCard) {
              setSelectedDrawSource(null);
              setHasChosenDrawSourceThisTurn(false);
              return;
          }
          setSelectedDrawSource((currentSource) => currentSource ?? sourceHint ?? "unknown");
          setHasChosenDrawSourceThisTurn(true);
      };

      const getCardAnchorByPlayerId = (playerId: number, cardIndex: number): HTMLDivElement | null => {
          if (selfUserId != null && playerId === selfUserId) {
              return ownHandCardRefs.current[cardIndex] ?? null;
          }
          if (seatAssignments.topOpponentId === playerId) {
              return topSeatCardRefs.current[cardIndex] ?? null;
          }
          if (seatAssignments.leftOpponentId === playerId) {
              return leftSeatCardRefs.current[cardIndex] ?? null;
          }
          if (seatAssignments.rightOpponentId === playerId) {
              return rightSeatCardRefs.current[cardIndex] ?? null;
          }
          return null;
      };

      const resolveAnchorFromMoveStep = (step: ParsedMoveStep, endpoint: "source" | "target"): HTMLDivElement | null => {
          const zone = endpoint === "source" ? step.sourceZone : step.targetZone;
          const userId = endpoint === "source" ? step.sourceUserId : step.targetUserId;
          const cardIndex = endpoint === "source" ? step.sourceCardIndex : step.targetCardIndex;
          if (zone === "DRAW_PILE") {
              return drawPileCardRef.current;
          }
          if (zone === "DISCARD_PILE") {
              return discardPileCardRef.current;
          }
          if (zone === "HAND" && userId != null) {
              const resolvedIndex = cardIndex != null
                  ? normalizeHandSlotIndex(cardIndex, HAND_SIZE) ?? Math.floor(HAND_SIZE / 2)
                  : Math.floor(HAND_SIZE / 2);
              return getCardAnchorByPlayerId(userId, resolvedIndex);
          }
          return null;
      };

      const animateParsedMoveStep = (step: ParsedMoveStep, authoritativeDiscardTopValue?: number) => {
          const sourceAnchor = resolveAnchorFromMoveStep(step, "source");
          const targetAnchor = resolveAnchorFromMoveStep(step, "target");
          if (!sourceAnchor || !targetAnchor) {
              return;
          }
          const revealMoveToDiscard =
              step.targetZone === "DISCARD_PILE" &&
              (step.sourceZone === "HAND" || step.sourceZone === "DRAW_PILE");
          const resolvedVisibleValue =
              step.value ?? (Number.isFinite(authoritativeDiscardTopValue) ? authoritativeDiscardTopValue : undefined);
          const shouldShowFront =
              revealMoveToDiscard &&
              resolvedVisibleValue !== undefined;
          launchFlyingCardAnimation(sourceAnchor, targetAnchor, {
              hidden: shouldShowFront ? false : step.hidden,
              value: shouldShowFront ? resolvedVisibleValue : step.value,
          });
      };

      const findChangedHandIndices = (
          previousHand: SeatCardView[] | undefined,
          nextHand: SeatCardView[] | undefined
      ): number[] => {
          const previousByPosition = new Map<number, SeatCardView>();
          const nextByPosition = new Map<number, SeatCardView>();
          previousHand?.forEach((card) => {
              previousByPosition.set(card.position, card);
          });
          nextHand?.forEach((card) => {
              nextByPosition.set(card.position, card);
          });

          const changedIndices: number[] = [];
          for (let index = 0; index < HAND_SIZE; index += 1) {
              const previousCard = previousByPosition.get(index);
              const nextCard = nextByPosition.get(index);
              if (!areSeatCardsEquivalent(previousCard, nextCard)) {
                  changedIndices.push(index);
              }
          }
          return changedIndices;
      };

      const clearDiscardTopOverrideTimer = () => {
          if (discardTopOverrideTimeoutRef.current != null) {
              window.clearTimeout(discardTopOverrideTimeoutRef.current);
              discardTopOverrideTimeoutRef.current = null;
          }
      };

      const setDiscardTopOverrideUntilClear = (card: Card | null, delayMs: number | null = null) => {
          clearDiscardTopOverrideTimer();
          setDiscardTopAnimationOverride(card);
          const resolvedDelayMs =
              delayMs != null
                  ? delayMs
                  : card
                      ? FLYING_CARD_ANIMATION_MS + 300
                      : null;
          if (resolvedDelayMs != null && resolvedDelayMs > 0) {
              discardTopOverrideTimeoutRef.current = window.setTimeout(() => {
                  setDiscardTopAnimationOverride(null);
                  discardTopOverrideTimeoutRef.current = null;
              }, resolvedDelayMs);
          }
      };

      const clearAbilityPeekHideTimer = () => {
          if (abilityPeekHideTimeoutRef.current != null) {
              window.clearTimeout(abilityPeekHideTimeoutRef.current);
              abilityPeekHideTimeoutRef.current = null;
          }
      };


      const resetPeekSelection = () => {
          setPeekVisibleCards(createHiddenPeekCards());
          setSelectedPeekIndices([]);
      };

      const startPeekPhase = () => {
          resetPeekSelection();
          setIsPeekPhase(true);
      };

      const submitInitialPeekSelection = async (indices: number[]) => {
          if (!gameId || !token || !userId) {
              return;
          }

          setIsSubmittingInitialPeek(true);
          try {
              await apiService.postWithAuth(
                  `/games/${gameId}/peek`,
                  {
                      peekType: "initial",
                      handUserId: Number(userId),
                      indices,
                  },
                  token
              );
          } catch (error) {
              const appError = error as ApplicationError;
              // round is already active or initial peek was already consumed
              if (appError.status === 403 || appError.status === 409) {
                  setIsPeekPhase(false);
                  resetPeekSelection();
              }
              console.error("Failed to apply initial peek selection:", error);
          } finally {
              setIsSubmittingInitialPeek(false);
          }
      };

      const handlePeekCardClick = (cardIndex: number) => {
          if (!isPeekPhase || isSubmittingInitialPeek) {
              return;
          }

          if (peekVisibleCards[cardIndex]) {
              return;
          }

          if (selectedPeekIndices.length >= 2) {
              return;
          }

          const nextVisibleCards = [...peekVisibleCards];
          nextVisibleCards[cardIndex] = true;
          setPeekVisibleCards(nextVisibleCards);

          const nextSelectedIndices = [...selectedPeekIndices, cardIndex];
          setSelectedPeekIndices(nextSelectedIndices);

          if (nextSelectedIndices.length === 2) {
              void submitInitialPeekSelection(nextSelectedIndices);
          }
      };

      useEffect(() => {
          const authToken = token.trim();
          if (!authToken || !gameId) {
              setSocketSynced(false);
              return;
          }

          setSocketSynced(true);
          const client = new Client({
              webSocketFactory: () => new SockJS(getStompBrokerUrl()),
              connectHeaders: { Authorization: authToken },
              reconnectDelay: 5000,
              onConnect: () => {
                  setSocketSynced(true);
                  lastGameStateSignalMsRef.current = Date.now();
                  // Catch up immediately after reconnect in case one or more websocket
                  // game-state frames were missed while disconnected/backgrounded.
                  void Promise.allSettled([
                      apiService
                          .getWithAuth<Card[]>(`/games/${gameId}/my-hand`, authToken)
                          .then((hand) => setMyHand(hand)),
                      apiService
                          .getWithAuth<Card | null>(`/games/${gameId}/discard-pile/top`, authToken)
                          .then((topCard) => {
                              const normalizedTopCard = topCard ?? null;
                              setDiscardTopCard(normalizedTopCard);
                              discardTopCardRef.current = normalizedTopCard;
                              clearDiscardTopOverrideTimer();
                              setDiscardTopAnimationOverride(null);
                          }),
                      apiService
                          .getWithAuth<unknown>(`/games/${gameId}/drawn-card`, authToken)
                          .then((rawCard) => {
                              const nextDrawnCard = toValidCardOrNull(rawCard);
                              applyDrawnCardState(nextDrawnCard);
                          })
                          .catch(() => {
                              applyDrawnCardState(null);
                          }),
                  ]);
                  client.subscribe("/user/queue/game-state", (message) => {
                      try {
                          const payload = JSON.parse(String(message.body ?? "{}")) as GameStateSignal;
                          const payloadGameId = extractGameId(payload);
                          if (payloadGameId && payloadGameId !== gameId) {
                              return;
                          }
                          const payloadSessionId = String(
                              payload.sessionId ??
                              payload.lobbySessionId ??
                              payload.lobbyId ??
                              payload.code ??
                              "",
                          ).trim();
                          if (payloadSessionId) {
                              const localStorageSessionId = typeof window !== "undefined"
                                  ? String(window.localStorage.getItem("activeLobbySessionId") ?? "").trim()
                                  : "";
                              if (normalizeValue(payloadSessionId) !== normalizeValue(localStorageSessionId)) {
                                  setActiveLobbySessionId(payloadSessionId);
                              }
                          }
                          setSocketSynced(true);
                          lastGameStateSignalMsRef.current = Date.now();

                          const nextStatus = extractGameStatus(payload);
                          if (nextStatus) {
                              setGameStatus((currentStatus) =>
                                  currentStatus === nextStatus ? currentStatus : nextStatus
                              );
                          }

                          if (typeof payload?.caboCalled === "boolean") {
                              setIsCaboCalledGlobal(payload.caboCalled);
                          }
                          if (typeof payload?.caboForcedByTimeout === "boolean") {
                              setIsCaboForcedByTimeoutGlobal(payload.caboForcedByTimeout);
                          }
                          setTimedOutPlayerIds(
                              Array.isArray(payload?.timedOutPlayerIds)
                                  ? payload.timedOutPlayerIds
                                      .map((id) => Number(id))
                                      .filter((id) => Number.isFinite(id))
                                  : []
                          );

                          const nextTurnSeconds = Number(payload?.turnSeconds);
                          if (Number.isFinite(nextTurnSeconds) && nextTurnSeconds > 0) {
                              setTurnDurationSeconds(Math.floor(nextTurnSeconds));
                          }

                          const nextInitialPeekSeconds = Number(payload?.initialPeekSeconds);
                          if (Number.isFinite(nextInitialPeekSeconds) && nextInitialPeekSeconds > 0) {
                              setInitialPeekDurationSeconds(Math.floor(nextInitialPeekSeconds));
                          }

                          const nextRematchSeconds = Number(payload?.rematchDecisionSeconds);
                          if (Number.isFinite(nextRematchSeconds) && nextRematchSeconds > 0) {
                              setRematchDecisionDuration(Math.floor(nextRematchSeconds));
                          }
                          const nextCaboRevealSeconds = Number(payload?.caboRevealSeconds);
                          if (Number.isFinite(nextCaboRevealSeconds) && nextCaboRevealSeconds > 0) {
                              setCaboRevealDurationSeconds(Math.floor(nextCaboRevealSeconds));
                          }
                          const nextAbilityRevealSeconds = Number(payload?.abilityRevealSeconds);
                          if (Number.isFinite(nextAbilityRevealSeconds) && nextAbilityRevealSeconds > 0) {
                              setAbilityRevealDurationSeconds(Math.floor(nextAbilityRevealSeconds));
                          }
                          const nextAbilitySwapSeconds = Number(payload?.abilitySwapSeconds);
                          if (Number.isFinite(nextAbilitySwapSeconds) && nextAbilitySwapSeconds > 0) {
                              setAbilitySwapDurationSeconds(Math.floor(nextAbilitySwapSeconds));
                          }
                          const nextAfkTimeout = Number(payload?.afkTimeoutSeconds);
                          if (Number.isFinite(nextAfkTimeout) && nextAfkTimeout > 0) {
                              setAfkTimeoutSeconds(Math.floor(nextAfkTimeout));
                          }

                          const nextPlayerIds = extractPlayerIds(payload);
                          if (nextPlayerIds.length > 0) {
                              setOrderedPlayerIds((previous) =>
                                  arraysEqual(previous, nextPlayerIds) ? previous : nextPlayerIds
                              );
                          }

                          const previousPlayerCardsById = playerCardsByIdRef.current;
                          const previousDiscardTopCard = discardTopCardRef.current;
                          const previousTurnUserId = currentTurnUserIdRef.current;
                          const previousDrawnCardPresent = drawnCardPresentRef.current;

                          const parsedNextPlayerCardsById = extractPlayerCardsById(payload);
                          const effectiveNextPlayerCardsById =
                              Object.keys(parsedNextPlayerCardsById).length > 0
                                  ? parsedNextPlayerCardsById
                                  : previousPlayerCardsById;
                          const touchedHandIndicesByPlayerId = extractTouchedHandIndicesByPlayerId(payload);

                          const discardTopUpdate = extractDiscardTopUpdate(payload);
                          const effectiveNextDiscardTopCard = discardTopUpdate.hasDiscardTop
                              ? discardTopUpdate.card
                              : previousDiscardTopCard;
                          const authoritativeDiscardTopValue = discardTopUpdate.hasDiscardTop
                              ? discardTopUpdate.card?.value
                              : undefined;

                          const drawnCardPresence = extractDrawnCardPresence(payload);
                          const nextDrawnCardPresent = drawnCardPresence.hasDrawnCardField
                              ? drawnCardPresence.present
                              : previousDrawnCardPresent;

                          const actingPlayerId = previousTurnUserId;
                          const canAnimateOtherPlayerMove = actingPlayerId != null && (
                              selfUserId == null || actingPlayerId !== selfUserId
                          );
                          let handledByExplicitMoveEvent = false;
                          const explicitMoveEvent = extractLastMoveEvent(payload);
                          if (
                              explicitMoveEvent &&
                              explicitMoveEvent.sequence > lastProcessedMoveSequenceRef.current &&
                              (selfUserId == null || explicitMoveEvent.actorUserId !== selfUserId)
                          ) {
                              animateParsedMoveStep(explicitMoveEvent.primary, authoritativeDiscardTopValue);
                              if (explicitMoveEvent.secondary) {
                                  animateParsedMoveStep(explicitMoveEvent.secondary, authoritativeDiscardTopValue);
                              }
                              lastProcessedMoveSequenceRef.current = explicitMoveEvent.sequence;
                              handledByExplicitMoveEvent = true;
                          }
                          const discardChanged =
                              (previousDiscardTopCard?.value ?? null) !== (effectiveNextDiscardTopCard?.value ?? null);

                          if (
                              !handledByExplicitMoveEvent &&
                              canAnimateOtherPlayerMove &&
                              !previousDrawnCardPresent &&
                              nextDrawnCardPresent
                          ) {
                              if (discardChanged && previousDiscardTopCard) {
                                  pendingRemoteDrawAnimationRef.current = {
                                      source: "discard_pile",
                                      cardValue: previousDiscardTopCard.value,
                                  };
                                  setDiscardTopOverrideUntilClear(previousDiscardTopCard);
                              } else {
                                  pendingRemoteDrawAnimationRef.current = {
                                      source: "draw_pile",
                                  };
                              }
                          }

                          if (
                              !handledByExplicitMoveEvent &&
                              canAnimateOtherPlayerMove &&
                              previousDrawnCardPresent &&
                              !nextDrawnCardPresent
                          ) {
                              const pendingAnimation = pendingRemoteDrawAnimationRef.current;
                              if (pendingAnimation) {
                                  const resolvedActingPlayerId = actingPlayerId as number;
                                  const previousActingHand = previousPlayerCardsById[resolvedActingPlayerId];
                                  const nextActingHand = effectiveNextPlayerCardsById[resolvedActingPlayerId];
                                  const changedIndices = findChangedHandIndices(previousActingHand, nextActingHand);
                                  const touchedIndices = touchedHandIndicesByPlayerId[resolvedActingPlayerId] ?? [];
                                  const normalizedTouchedIndex = touchedIndices.length === 1
                                      ? normalizeHandSlotIndex(touchedIndices[0], HAND_SIZE)
                                      : null;
                                  const resolvedTargetIndex =
                                      changedIndices.length > 0
                                          ? changedIndices[0]
                                          : normalizedTouchedIndex != null
                                              ? normalizedTouchedIndex
                                              : null;
                                  const targetAnchor = resolvedTargetIndex != null
                                      ? getCardAnchorByPlayerId(resolvedActingPlayerId, resolvedTargetIndex)
                                      : null;
                                  const discardAnchor = discardPileCardRef.current;
                                  const drawAnchor = drawPileCardRef.current;
                                  const sourceAnchor = pendingAnimation.source === "discard_pile"
                                      ? discardAnchor
                                      : drawAnchor;

                                  if (sourceAnchor && targetAnchor) {
                                      launchFlyingCardAnimation(sourceAnchor, targetAnchor, {
                                          hidden: pendingAnimation.source !== "discard_pile",
                                          value: pendingAnimation.cardValue,
                                      });
                                  }

                                  if (discardChanged && discardAnchor) {
                                      if (targetAnchor) {
                                          const discardTopValue =
                                              Number.isFinite(effectiveNextDiscardTopCard?.value)
                                                  ? effectiveNextDiscardTopCard?.value
                                                  : undefined;
                                          launchFlyingCardAnimation(targetAnchor, discardAnchor, {
                                              hidden: discardTopValue === undefined,
                                              value: discardTopValue,
                                          });
                                      } else if (pendingAnimation.source === "draw_pile" && drawAnchor) {
                                          // No changed/touched hand slot means this was likely an automatic
                                          // draw+discard timeout path; animate directly to discard.
                                          const discardTopValue =
                                              Number.isFinite(effectiveNextDiscardTopCard?.value)
                                                  ? effectiveNextDiscardTopCard?.value
                                                  : undefined;
                                          launchFlyingCardAnimation(drawAnchor, discardAnchor, {
                                              hidden: discardTopValue === undefined,
                                              value: discardTopValue,
                                          });
                                      }
                                  }

                                  if (pendingAnimation.source === "discard_pile" && pendingAnimation.cardValue != null) {
                                      setDiscardTopOverrideUntilClear(
                                          { value: pendingAnimation.cardValue, visibility: true, ability: "" },
                                          FLYING_CARD_ANIMATION_MS
                                      );
                                  } else {
                                      setDiscardTopOverrideUntilClear(null);
                                  }
                                  pendingRemoteDrawAnimationRef.current = null;
                              } else {
                                  setDiscardTopOverrideUntilClear(null);
                              }
                          }

                          if (
                              !handledByExplicitMoveEvent &&
                              canAnimateOtherPlayerMove &&
                              !previousDrawnCardPresent &&
                              !nextDrawnCardPresent &&
                              discardChanged
                          ) {
                              const resolvedActingPlayerId = actingPlayerId as number;
                              const previousActingHand = previousPlayerCardsById[resolvedActingPlayerId];
                              const nextActingHand = effectiveNextPlayerCardsById[resolvedActingPlayerId];
                              const changedIndices = findChangedHandIndices(previousActingHand, nextActingHand);
                              const touchedIndices = touchedHandIndicesByPlayerId[resolvedActingPlayerId] ?? [];
                              if (changedIndices.length === 0 && touchedIndices.length === 0) {
                                  const drawAnchor = drawPileCardRef.current;
                                  const discardAnchor = discardPileCardRef.current;
                                  if (drawAnchor && discardAnchor) {
                                      const discardTopValue =
                                          Number.isFinite(effectiveNextDiscardTopCard?.value)
                                              ? effectiveNextDiscardTopCard?.value
                                              : undefined;
                                      launchFlyingCardAnimation(drawAnchor, discardAnchor, {
                                          hidden: discardTopValue === undefined,
                                          value: discardTopValue,
                                      });
                                  }
                                  pendingRemoteDrawAnimationRef.current = null;
                                  setDiscardTopOverrideUntilClear(null);
                              }
                          }

                          if (Object.keys(parsedNextPlayerCardsById).length > 0) {
                              setPlayerCardsById(parsedNextPlayerCardsById);
                              playerCardsByIdRef.current = parsedNextPlayerCardsById;
                          }

                          if (discardTopUpdate.hasDiscardTop) {
                              setDiscardTopCard(discardTopUpdate.card);
                              discardTopCardRef.current = discardTopUpdate.card;
                          }

                          drawnCardPresentRef.current = nextDrawnCardPresent;

                          const nextTurnUserId = extractCurrentTurnUserId(payload);
                          if (nextTurnUserId != null) {
                              setCurrentTurnUserId((previous) =>
                                  previous === nextTurnUserId ? previous : nextTurnUserId
                              );
                              currentTurnUserIdRef.current = nextTurnUserId;
                              consecutiveNoOwnerProbePollsRef.current = 0;
                          }
                      } catch {
                          /* ignore malformed payload */
                      }
                  });
                  client.subscribe("/user/queue/redirect", (message) => {
                      try {
                          const payload = JSON.parse(String(message.body ?? "{}")) as Record<string, unknown>;

                          // extrahiere neue Session/Lobby ID
                          const newSessionId = String(
                              payload.sessionId ??
                              payload.lobbyId ??
                              payload.code ??
                              payload.id ??
                              ""
                          ).trim();

                          if (!newSessionId) {
                              return;
                          }

                          // update local storage und navigiere zur neuen Lobby
                          setActiveLobbySessionId(newSessionId);
                          setActiveSessionId(newSessionId);
                          router.replace(`/lobby/${encodeURIComponent(newSessionId)}`);
                      } catch {
                          /* ignore malformed payload */
                      }
                  });

              },
              onStompError: () => {
                  setSocketSynced(false);
              },
              onWebSocketClose: () => {
                  setSocketSynced(false);
              },
              onWebSocketError: () => {
                  setSocketSynced(false);
              },
          });

          client.activate();
          return () => {
              void client.deactivate();
          };
      // Keep this websocket subscription scoped to game/seat identity;
      // helper callbacks inside intentionally do not trigger reconnects on each render.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [
          token,
          gameId,
          selfUserId,
          seatAssignments.topOpponentId,
          seatAssignments.leftOpponentId,
          seatAssignments.rightOpponentId,
      ]);

      useEffect(() => {
          if (!token || !gameId) {
              return;
          }

          const markActive = () => {
              lastActivityMsRef.current = Date.now();
          };
          const markActiveOnVisible = () => {
              if (document.visibilityState === "visible") {
                  markActive();
              }
          };

          markActive();
          window.addEventListener("pointerdown", markActive, { passive: true });
          window.addEventListener("keydown", markActive, { passive: true });
          window.addEventListener("focus", markActive, { passive: true });
          document.addEventListener("visibilitychange", markActiveOnVisible);

          return () => {
              window.removeEventListener("pointerdown", markActive);
              window.removeEventListener("keydown", markActive);
              window.removeEventListener("focus", markActive);
              document.removeEventListener("visibilitychange", markActiveOnVisible);
          };
      }, [token, gameId]);

      useEffect(() => {
          if (!token || !gameId) {
              return;
          }

          const tick = () => {
              const elapsedSeconds = Math.floor((Date.now() - lastActivityMsRef.current) / 1000);
              setAfkRemainingSeconds(Math.max(0, afkTimeoutSeconds - elapsedSeconds));
          };

          tick();
          const intervalId = window.setInterval(tick, 1000);
          return () => {
              window.clearInterval(intervalId);
          };
      }, [token, gameId, afkTimeoutSeconds]);

      useEffect(() => {
          if (gameStatus === "initial_peek") {
              startPeekPhase();
              return;
          }

          setIsPeekPhase(false);
          resetPeekSelection();
      // These helpers are intentionally not dependencies to avoid resetting peek flow on unrelated renders.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [gameStatus]);

      useEffect(() => {
          const authToken = token.trim();
          if (!authToken) {
              return;
          }
          const canUseProfileColorFallback = !lobbySessionId.trim();

          const candidateIds = [...tablePlayerIds];
          finalScores.forEach((entry) => {
              if (!candidateIds.includes(entry.userId)) {
                  candidateIds.push(entry.userId);
              }
          });

          const missingIds = candidateIds.filter(
              (id) =>
                  isPlaceholderPlayerName(playerNamesById[id]) ||
                  !playerCharacterById[id] ||
                  (canUseProfileColorFallback && !playerPrimaryColorById[id])
          );
          if (missingIds.length === 0) {
              return;
          }

          let active = true;
          void Promise.all(
              missingIds.map(async (id) => {
                  try {
                      const fetchedUser = await apiService.getWithAuth<User>(
                          `/users/${encodeURIComponent(String(id))}`,
                          authToken,
                      );
                      const displayName = String(
                          fetchedUser?.username ?? fetchedUser?.name ?? ""
                      ).trim();
                      const profileCharacterId = normalizeCharacterId(fetchedUser?.profileCharacterId);
                      const primaryColorId = normalizePrimaryColorId(fetchedUser?.primaryColorId);
                      return [id, displayName, profileCharacterId, primaryColorId] as const;
                  } catch {
                      return [id, "", "", ""] as const;
                  }
              })
          ).then((entries) => {
              if (!active) {
                  return;
              }
              setPlayerNamesById((previous) => {
                  const next = { ...previous };
                  for (const [id, label] of entries) {
                      if (!isPlaceholderPlayerName(label)) {
                          next[id] = label;
                      }
                  }
                  return next;
              });
              setPlayerCharacterById((previous) => {
                  const next = { ...previous };
                  for (const [id, , characterId] of entries) {
                      if (characterId) {
                          next[id] = characterId;
                      }
                  }
                  return next;
              });
              setPlayerPrimaryColorById((previous) => {
                  if (!canUseProfileColorFallback) {
                      return previous;
                  }
                  const next = { ...previous };
                  for (const [id, , , primaryColorId] of entries) {
                      if (primaryColorId) {
                          next[id] = primaryColorId;
                      }
                  }
                  return next;
              });
          });

          return () => {
              active = false;
          };
      }, [apiService, finalScores, lobbySessionId, playerCharacterById, playerNamesById, playerPrimaryColorById, tablePlayerIds, token]);

      const refreshSessionScoresFromSessionState = useCallback(async () => {
          const authToken = token.trim();
          const sessionCode = lobbySessionId;
          if (!authToken || !sessionCode) {
              return;
          }

          let scorePayload: unknown;
          try {
              scorePayload = await apiService.getWithAuth<unknown>(
                  `/sessions/${encodeURIComponent(sessionCode)}/history`,
                  authToken,
              );
          } catch (error) {
              const status = (error as ApplicationError)?.status;
              if (status === 403 || status === 404 || status === 405) {
                  return;
              }
              throw error;
          }

          const fallbackPlayerIds = tablePlayerIds.length > 0
              ? tablePlayerIds
              : (selfUserId != null ? [selfUserId] : []);
          const sessionSnapshot = buildSessionHistoryScoresSnapshot(
              scorePayload,
              sessionCode,
              fallbackPlayerIds,
              playerNamesById,
          ) ?? (() => {
              const fallbackSnapshot = buildFinalRoundScoresSnapshot(
                  scorePayload,
                  fallbackPlayerIds,
                  playerNamesById,
              );
              if (!fallbackSnapshot) {
                  return null;
              }
              return {
                  snapshot: fallbackSnapshot,
                  sessionCode,
              };
          })();
          if (!sessionSnapshot) {
              return;
          }

          const { snapshot, sessionCode: resolvedSessionCode } = sessionSnapshot;
          setFinalScores(snapshot.players);
          setFinalScoreTotalRounds(snapshot.totalRounds);

          if (
              resolvedSessionCode &&
              normalizeValue(resolvedSessionCode) !== normalizeValue(lobbySessionId)
          ) {
              setActiveLobbySessionId(resolvedSessionCode);
          }
      }, [
          apiService,
          lobbySessionId,
          playerNamesById,
          selfUserId,
          setActiveLobbySessionId,
          tablePlayerIds,
          token,
      ]);

      useEffect(() => {
          if (!gameId || !lobbySessionId) {
              return;
          }
          void refreshSessionScoresFromSessionState().catch((error) => {
              console.error("Could not load session scores:", error);
          });
      }, [gameId, lobbySessionId, refreshSessionScoresFromSessionState]);

      useEffect(() => {
          if (!gameId || !lobbySessionId) {
              return;
          }

          const intervalId = window.setInterval(() => {
              void refreshSessionScoresFromSessionState().catch(() => {
                  // keep existing scores on transient failures
              });
          }, SESSION_SCORE_REFRESH_MS);

          return () => {
              window.clearInterval(intervalId);
          };
      }, [SESSION_SCORE_REFRESH_MS, gameId, lobbySessionId, refreshSessionScoresFromSessionState]);

      useEffect(() => {
          if (
              gameStatus !== "cabo_reveal" &&
              gameStatus !== "round_awaiting_rematch" &&
              gameStatus !== "round_ended"
          ) {
              return;
          }
          if (!gameId || !lobbySessionId) {
              return;
          }
          void refreshSessionScoresFromSessionState().catch((error) => {
              console.error("Could not refresh session scores at round boundary:", error);
          });
      }, [gameId, gameStatus, lobbySessionId, refreshSessionScoresFromSessionState]);

      useEffect(() => {
          if (!gameId || !token) {
              return;
          }

          let active = true;
          const loadRuntimeConfig = async () => {
              try {
                  const config = await apiService.getWithAuth<GameRuntimeConfigResponse>(
                      `/games/${gameId}/config`,
                      token
                  );
                  if (!active) {
                      return;
                  }
                  const nextTurnSeconds = Number(config?.turnSeconds);
                  if (Number.isFinite(nextTurnSeconds) && nextTurnSeconds > 0) {
                      setTurnDurationSeconds(Math.floor(nextTurnSeconds));
                  }
                  const nextInitialPeekSeconds = Number(config?.initialPeekSeconds);
                  if (Number.isFinite(nextInitialPeekSeconds) && nextInitialPeekSeconds > 0) {
                      setInitialPeekDurationSeconds(Math.floor(nextInitialPeekSeconds));
                  }
                  const nextAbilityRevealSeconds = Number(config?.abilityRevealSeconds);
                  if (Number.isFinite(nextAbilityRevealSeconds) && nextAbilityRevealSeconds > 0) {
                      setAbilityRevealDurationSeconds(Math.floor(nextAbilityRevealSeconds));
                  }
                  const nextAbilitySwapSeconds = Number(config?.abilitySwapSeconds);
                  if (Number.isFinite(nextAbilitySwapSeconds) && nextAbilitySwapSeconds > 0) {
                      setAbilitySwapDurationSeconds(Math.floor(nextAbilitySwapSeconds));
                  }
                  const nextCaboRevealSeconds = Number(config?.caboRevealSeconds);
                  if (Number.isFinite(nextCaboRevealSeconds) && nextCaboRevealSeconds > 0) {
                      setCaboRevealDurationSeconds(Math.floor(nextCaboRevealSeconds));
                  }
                  const nextRematchSeconds = Number(config?.rematchDecisionSeconds);
                  if (Number.isFinite(nextRematchSeconds) && nextRematchSeconds > 0) {
                      setRematchDecisionDuration(Math.floor(nextRematchSeconds));
                  }
                  const nextAfkTimeout = Number(config?.afkTimeoutSeconds);
                  if (Number.isFinite(nextAfkTimeout) && nextAfkTimeout > 0) {
                      setAfkTimeoutSeconds(Math.floor(nextAfkTimeout));
                  }
              } catch {
                  // keep defaults if config fetch fails
              }
          };
          void loadRuntimeConfig();

          return () => {
              active = false;
          };
      }, [apiService, gameId, token]);

      useEffect(() => {
          if (!isCaboRevealPhase) {
              setCaboRevealCountdown(0);
              setCaboRevealElapsedMs(0);
              caboRevealPhaseStartedAtMsRef.current = null;
              caboRevealDeadlineMsRef.current = null;
              return;
          }

          caboRevealPhaseStartedAtMsRef.current = Date.now();
          caboRevealDeadlineMsRef.current = caboRevealPhaseStartedAtMsRef.current + (caboRevealDurationSeconds * 1000);
          const tick = () => {
              const startedAt = caboRevealPhaseStartedAtMsRef.current;
              const deadline = caboRevealDeadlineMsRef.current;
              if (startedAt == null || deadline == null) {
                  setCaboRevealCountdown(0);
                  setCaboRevealElapsedMs(0);
                  return;
              }
              setCaboRevealElapsedMs(Math.max(0, Date.now() - startedAt));
              const remainingMs = Math.max(0, deadline - Date.now());
              setCaboRevealCountdown(Math.max(0, Math.ceil(remainingMs / 1000)));
          };
          tick();
          const intervalId = window.setInterval(tick, 100);
          return () => {
              window.clearInterval(intervalId);
          };
      }, [isCaboRevealPhase, caboRevealDurationSeconds]);
      useEffect(() => {
          if (!isIntroPhase) {
              introPhaseStartedAtMsRef.current = null;
              setIntroElapsedMs(0);
              return;
          }

          introPhaseStartedAtMsRef.current = Date.now();
          const tick = () => {
              const startedAt = introPhaseStartedAtMsRef.current;
              if (startedAt == null) {
                  setIntroElapsedMs(0);
                  return;
              }
              const elapsedMs = Math.max(0, Date.now() - startedAt);
              setIntroElapsedMs(elapsedMs);
          };

          tick();
          const intervalId = window.setInterval(tick, 100);
          return () => {
              window.clearInterval(intervalId);
          };
      }, [isIntroPhase]);
      // #34: Build final score payload once reveal window has ended and rematch voting opens
      useEffect(() => {
          if (!isAwaitingRematchDecision) return;

          setFinalScores((previous) => {
              const previousById = new Map(previous.map((entry) => [entry.userId, entry] as const));
              const combinedIds: number[] = [...tablePlayerIds];
              previous.forEach((entry) => {
                  if (!combinedIds.includes(entry.userId)) {
                      combinedIds.push(entry.userId);
                  }
              });

              return combinedIds.map((id) => {
                  const existing = previousById.get(id);
                  const nextUsername = playerNamesById[id] ?? existing?.username ?? `Player ${id}`;
                  if (existing) {
                      return {
                          ...existing,
                          username: nextUsername,
                      };
                  }
                  return {
                      userId: id,
                      username: nextUsername,
                      totalScore: null,
                      roundScores: [],
                  };
              });
          });
      }, [isAwaitingRematchDecision, tablePlayerIds, playerNamesById]);

      useEffect(() => {
          if (!isAwaitingRematchDecision) {
              setFinalScoreTotalRounds(0);
          }
      }, [isAwaitingRematchDecision]);
      useEffect(() => {
          if (!isAwaitingRematchDecision || !gameId || !token) {
              setRematchCountdown(0);
              setMyRematchDecision(null);
              rematchDeadlineMsRef.current = null;
              return;
          }

          let active = true;
          const loadRematchConfig = async () => {
              try {
                  const response = await apiService.getWithAuth<{ decisionSeconds?: number }>(
                      `/games/${gameId}/rematch/config`,
                      token
                  );
                  const configuredSeconds = Number(response?.decisionSeconds);
                  if (active && Number.isFinite(configuredSeconds) && configuredSeconds > 0) {
                      setRematchDecisionDuration(Math.floor(configuredSeconds));
                  }
              } catch {
                  // fallback to last known local default
              }
          };
          void loadRematchConfig();

          rematchDeadlineMsRef.current = Date.now() + (rematchDecisionDuration * 1000);
          const tick = () => {
              const deadline = rematchDeadlineMsRef.current;
              if (deadline == null) {
                  setRematchCountdown(0);
                  return;
              }
              const remainingMs = Math.max(0, deadline - Date.now());
              setRematchCountdown(Math.max(0, Math.ceil(remainingMs / 1000)));
          };
          tick();
          const intervalId = window.setInterval(tick, 250);

          return () => {
              active = false;
              window.clearInterval(intervalId);
          };
      }, [apiService, gameId, token, isAwaitingRematchDecision, rematchDecisionDuration]);

      useEffect(() => {
          if (gameStatus !== "round_ended" || !gameId || !token) {
              return;
          }

          let active = true;
          const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
          const navigateAfterRound = async () => {
              // Rematch lobby assignment can be slightly delayed after ROUND_ENDED.
              // Retry briefly before falling back to dashboard.
              for (let attempt = 0; attempt < 10; attempt += 1) {
                  try {
                      const response = await apiService.getWithAuth<{ sessionId?: string }>(
                          `/games/${gameId}/post-round-lobby`,
                          token
                      );
                      if (!active) {
                          return;
                      }
                      const waitingSessionId = String(response?.sessionId ?? "").trim();
                      if (waitingSessionId) {
                          setActiveLobbySessionId(waitingSessionId);
                          setActiveSessionId(waitingSessionId);
                          router.replace(`/lobby/${encodeURIComponent(waitingSessionId)}`);
                          return;
                      }
                  } catch {
                      // continue to fallback checks below
                  }

                  try {
                      const myWaitingLobby = await apiService.getWithAuth<{ sessionId?: string }>(
                          "/lobbies/my/waiting",
                          token
                      );
                      if (!active) {
                          return;
                      }
                      const myWaitingSessionId = String(myWaitingLobby?.sessionId ?? "").trim();
                      if (myWaitingSessionId) {
                          setActiveLobbySessionId(myWaitingSessionId);
                          setActiveSessionId(myWaitingSessionId);
                          router.replace(`/lobby/${encodeURIComponent(myWaitingSessionId)}`);
                          return;
                      }
                  } catch {
                      // still waiting for backend handoff
                  }

                  if (attempt < 9) {
                      await sleep(800);
                  }
              }

              if (active) {
                  router.replace("/dashboard");
              }
          };

          void navigateAfterRound();
          return () => {
              active = false;
          };
      }, [apiService, gameStatus, gameId, token, router, setActiveLobbySessionId, setActiveSessionId]);

      const isPeekOrSpyPhaseForCountdown =
          gameStatus === "ability_peek_self" ||
          gameStatus === "ability_peek_opponent";
      const isSwapPhaseForCountdown = gameStatus === "ability_swap";
      const isAbilityPhaseForCountdown = isPeekOrSpyPhaseForCountdown || isSwapPhaseForCountdown;
      const showTurnCountdown =
          !isPeekPhase &&
          (gameStatus === "round_active" || isAbilityPhaseForCountdown) &&
          currentTurnUserId != null;
      const showCenterTurnCountdown =
          showTurnCountdown && selfUserId != null && currentTurnUserId === selfUserId;
      const activeTurnWindowSeconds = isPeekOrSpyPhaseForCountdown
          ? (isAbilityRevealWindow ? abilityRevealDurationSeconds : turnDurationSeconds)
          : isSwapPhaseForCountdown
              ? abilitySwapDurationSeconds
              : turnDurationSeconds;
      const isCurrentTurnMine = selfUserId != null && currentTurnUserId === selfUserId;
      const isMyTurnUi = isCurrentTurnMine && !isPeekPhase && !isPostRoundPhase;
      const afkWarningLeadSeconds = getAfkWarningLeadSeconds(afkTimeoutSeconds);
      const showAfkWarning =
          !isPostRoundPhase &&
          gameStatus !== "round_ended" &&
          afkRemainingSeconds <= afkWarningLeadSeconds;
      const shouldPlayAfkWarningLoop =
          showAfkWarning &&
          !isRematchScreenPhase &&
          !isCaboCalledGlobal;
      useAttentionTitleBlink({
          enabled: showAfkWarning,
          alertTitle: "AFK WARNING - Return to game",
      });
      useEffect(() => {
          if (shouldPlayAfkWarningLoop) {
              if (!gameAfkWarningLoopActiveRef.current) {
                  startSharedLoopedCaboSoundEffect("afk_warning");
                  gameAfkWarningLoopActiveRef.current = true;
              }
          } else if (gameAfkWarningLoopActiveRef.current) {
              stopSharedLoopedCaboSoundEffect("afk_warning");
              gameAfkWarningLoopActiveRef.current = false;
          }
          return () => {
              if (gameAfkWarningLoopActiveRef.current) {
                  stopSharedLoopedCaboSoundEffect("afk_warning");
                  gameAfkWarningLoopActiveRef.current = false;
              }
          };
      }, [shouldPlayAfkWarningLoop]);
      const toDisplayedSeconds = (seconds: number): number =>
          seconds > 0 ? Math.max(0, seconds - 1) : 0;
      // Single source of truth for countdown: derive both label and bar from ms.
      const displayedTurnTimeLeft = Math.max(0, Math.ceil(turnTimeLeftMs / 1000));
      const activeTurnWindowMs = Math.max(1, activeTurnWindowSeconds * 1000);
      const clampedTurnTimeLeftMs = Math.max(0, Math.min(turnTimeLeftMs, activeTurnWindowMs));
      const turnProgressPercent = displayedTurnTimeLeft <= 0
          ? 0
          : Math.max(0, Math.min(100, (clampedTurnTimeLeftMs / activeTurnWindowMs) * 100));
      const displayedCaboRevealCountdown = toDisplayedSeconds(caboRevealCountdown);
      const displayedRematchCountdown = toDisplayedSeconds(rematchCountdown);
      const displayedAfkRemainingSeconds = toDisplayedSeconds(afkRemainingSeconds);
      useEffect(() => {
          if (!showTurnCountdown) {
              setTurnTimeLeftMs(activeTurnWindowSeconds * 1000);
              turnDeadlineMsRef.current = null;
              return;
          }

          turnDeadlineMsRef.current = Date.now() + (activeTurnWindowSeconds * 1000);
          const tick = () => {
              const deadline = turnDeadlineMsRef.current;
              if (deadline == null) {
                  setTurnTimeLeftMs(activeTurnWindowSeconds * 1000);
                  return;
              }
              const remainingMs = Math.max(0, deadline - Date.now());
              setTurnTimeLeftMs(remainingMs);
          };
          tick();
          const intervalId = window.setInterval(tick, 50);

          return () => {
              window.clearInterval(intervalId);
          };
      }, [showTurnCountdown, currentTurnUserId, gameStatus, activeTurnWindowSeconds]);

      useEffect(() => {
          const fetchDrawnCard = async () => {
              if (!gameId || !token) {
                  applyDrawnCardState(null);
                  setIsDrawingFromPile(false);
                  setIsDrawingFromDiscardPile(false);
                  drawRequestInFlightRef.current = false;
                  return;
              }

              try {
                  await refreshDrawnCardFromServer(gameId, token);
              } catch {
                  // refreshDrawnCardFromServer already applied the safe fallback state.
              } finally {
                  setIsDrawingFromPile(false);
                  setIsDrawingFromDiscardPile(false);
                  drawRequestInFlightRef.current = false;
              }
          };

          void fetchDrawnCard();
      // Drawn-card refresh runs on turn ownership changes; helper refs are intentionally omitted.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [gameId, token, isCurrentTurnMine]);

      // #15: fetch player's hand
      useEffect(() => {
        const fetchMyHand = async () => {
            if (!gameId || !token) return;
            try {
                const hand = await apiService.getWithAuth<Card[]>(
                    `/games/${gameId}/my-hand`,
                     token
                );
                setMyHand(hand);
            } catch (error) {
                console.error("Failed to fetch hand:", error);
            }
        };
        fetchMyHand();
      }, [apiService, gameId, token]);


// Disable regular "Draw/Discard" buttons while an ability choice is pending.
// #26
const isAbilityPending =
    gameStatus === "ability_peek_self" ||
    gameStatus === "ability_peek_opponent" ||
    gameStatus === "ability_swap";

const isRoundActive = gameStatus === "round_active";
const canRecoverTurnFromDrawnCard =
    !!drawnCard &&
    !isPeekPhase &&
    !isPostRoundPhase &&
    !isAbilityPending;
const isStandardTurnActionBlocked =
    (!isCurrentTurnMine && !canRecoverTurnFromDrawnCard) ||
    (!isRoundActive && !canRecoverTurnFromDrawnCard) ||
    isPeekPhase ||
    isDrawingFromPile ||
    isDrawingFromDiscardPile ||
    isSwappingDrawnCard ||
    isDiscardingDrawnCard ||
    isAbilityPending;
const canDrawFromPile = !isStandardTurnActionBlocked && !drawnCard;
const canDrawFromDiscardPile = !isStandardTurnActionBlocked && !drawnCard;
const hasDrawnTurnCardInHand = !!drawnCard;
const canSwapDrawnCardWithHand =
    !isStandardTurnActionBlocked &&
    hasDrawnTurnCardInHand;
const canDiscardDrawnCard =
    !isStandardTurnActionBlocked &&
    hasDrawnTurnCardInHand &&
    selectedDrawSource !== "discard_pile";
const showDrawPileAsRevealedCard =
    hasDrawnTurnCardInHand &&
    selectedDrawSource !== "discard_pile";
const isDrawPileSelectedForTurnAction =
    hasDrawnTurnCardInHand &&
    (selectedDrawSource === "draw_pile" || selectedDrawSource === "unknown");
const isDiscardPileSelectedForTurnAction =
    hasDrawnTurnCardInHand && selectedDrawSource === "discard_pile";
const shouldHighlightPileChoice = canDrawFromPile || canDrawFromDiscardPile;
const shouldHighlightDiscardPileAsAction = shouldHighlightPileChoice || canDiscardDrawnCard;
const shouldHighlightOwnCardsForTurnSwap = canSwapDrawnCardWithHand;
const visibleDiscardPileCard =
    isDiscardPileSelectedForTurnAction && drawnCard
        ? drawnCard
        : (discardTopAnimationOverride ?? discardTopCard);
const drawPileAbilityLabel =
    showDrawPileAsRevealedCard
        ? getAbilityCardLabel(drawnCard?.value)
        : undefined;
const canDragSelectedTurnCard =
    (isDrawPileSelectedForTurnAction && (canSwapDrawnCardWithHand || canDiscardDrawnCard)) ||
    (isDiscardPileSelectedForTurnAction && canSwapDrawnCardWithHand);
const drawPileCardInteractive = canDrawFromPile || (isDrawPileSelectedForTurnAction && canDragSelectedTurnCard);
const discardPileCardInteractive =
    canDrawFromDiscardPile ||
    canDiscardDrawnCard ||
    (isDiscardPileSelectedForTurnAction && canDragSelectedTurnCard);
const selectedPileCardStyle: React.CSSProperties = {
    outline: "3px solid #ffb14a",
    outlineOffset: "2px",
    boxShadow:
        "0 0 0 2px rgba(255, 177, 74, 0.45), 0 0 16px rgba(255, 177, 74, 0.75), 0 0 30px rgba(255, 177, 74, 0.45)",
    animation: "gameSelectedPilePulse 1.25s ease-in-out infinite",
    filter: "saturate(1.08) brightness(1.04)",
    opacity: 1,
};

// Implement logic to highlight valid cards (own cards for 7-8, opponent cards for 9-12) and capture the user's click.
//  #28
const [abilitySelectedOwnCardIndex, setAbilitySelectedOwnCardIndex] = useState<number | null>(null);
const [isSubmittingAbility, setIsSubmittingAbility] = useState<boolean>(false);
const [isAbilityChoicePending, setIsAbilityChoicePending] = useState<boolean>(false);
const [isUseAbilitySelected, setIsUseAbilitySelected] = useState<boolean>(false);
const seenAbilityPhaseRef = useRef<string>("");
const canShowAbilityChoiceButtons =
    isAbilityPending &&
    isCurrentTurnMine &&
    (isAbilityChoicePending || isUseAbilitySelected);
const abilityPhaseLabel = gameStatus === "ability_peek_self"
    ? "PEEK"
    : gameStatus === "ability_peek_opponent"
        ? "SPY"
        : gameStatus === "ability_swap"
            ? "SWAP"
            : "Ability";
const canInteractWithAbilityTargets =
    isAbilityPending &&
    isCurrentTurnMine &&
    !isSubmittingAbility &&
    isUseAbilitySelected &&
    !isSkippingAbilityChoice;
const shouldShowReadableSpyOpponentCards =
    gameStatus === "ability_peek_opponent" &&
    isAbilityRevealWindow;
const shouldUseReadableSpyOrientation = (cardFaceDown: boolean): boolean =>
    shouldShowReadableSpyOpponentCards && !cardFaceDown;
const buildOpponentCardStyle = (
    highlightedForAbility: boolean,
): React.CSSProperties | undefined => {
    if (!highlightedForAbility) {
        return undefined;
    }

    const nextStyle: React.CSSProperties = {};
    if (highlightedForAbility) {
        nextStyle.outline = "3px solid #c4827a";
        nextStyle.outlineOffset = "2px";
    }

    return nextStyle;
};

// reset the ability selection when the phase ends
const resetAbilitySelection = () => {
    setAbilitySelectedOwnCardIndex(null);
    setIsSubmittingAbility(false);
};

// find specific opponent card for animation
const getOpponentCardAnchor = (opponentId: number, cardIndex: number): HTMLDivElement | null => {
    if (seatAssignments.topOpponentId === opponentId) {
        return topSeatCardRefs.current[cardIndex] ?? null;
    }
    if (seatAssignments.leftOpponentId === opponentId) {
        return leftSeatCardRefs.current[cardIndex] ?? null;
    }
    if (seatAssignments.rightOpponentId === opponentId) {
        return rightSeatCardRefs.current[cardIndex] ?? null;
    }
    return null;
};

// #28: reset ability state when phase changes and require explicit use/skip choice
useEffect(() => {
    if (!isAbilityPending) {
        seenAbilityPhaseRef.current = "";
        setIsAbilityChoicePending(false);
        setIsUseAbilitySelected(false);
        setIsSkippingAbilityChoice(false);
        setIsAbilityRevealWindow(false);
        resetAbilitySelection();
        return;
    }

    const abilityTurnKey = `${currentTurnUserId ?? "none"}:${gameStatus}`;
    if (isCurrentTurnMine && seenAbilityPhaseRef.current !== abilityTurnKey) {
        seenAbilityPhaseRef.current = abilityTurnKey;
        setIsAbilityChoicePending(true);
        setIsUseAbilitySelected(false);
        setIsAbilityRevealWindow(false);
    }
}, [isAbilityPending, isCurrentTurnMine, currentTurnUserId, gameStatus]);

useEffect(() => {
    if (isPeekPhase) {
        return;
    }
    if (isCurrentTurnMine && gameStatus === "ability_peek_self" && isUseAbilitySelected) {
        return;
    }

    clearAbilityPeekHideTimer();
    setPeekVisibleCards(createHiddenPeekCards());
}, [isPeekPhase, isCurrentTurnMine, gameStatus, currentTurnUserId, isUseAbilitySelected]);

// Recover from rare local state drift where ability choice UI gets stuck hidden.
useEffect(() => {
    if (!isAbilityPending || !isCurrentTurnMine) {
        return;
    }
    if (!isUseAbilitySelected && !isAbilityChoicePending) {
        setIsAbilityChoicePending(true);
    }
}, [isAbilityPending, isCurrentTurnMine, isUseAbilitySelected, isAbilityChoicePending]);

// #28: handle own card click during ability phase
const handleAbilityOwnCardClick = (cardIndex: number) => {
    if (!canInteractWithAbilityTargets || !gameId || !token) return;

    if (gameStatus === "ability_peek_self") {
        // 7/8: peek own card -> POST immediately
        setIsSubmittingAbility(true);
        void apiService.postWithAuth(
            `/games/${gameId}/peek`,
            {
                peekType: "special",
                handUserId: selfUserId,
                indices: [cardIndex],
            },
            token
        ).then(() => {
            setIsAbilityRevealWindow(true);
            clearAbilityPeekHideTimer();
            setPeekVisibleCards(() => {
                const next = createHiddenPeekCards();
                next[cardIndex] = true;
                return next;
            });
            abilityPeekHideTimeoutRef.current = window.setTimeout(() => {
                setPeekVisibleCards(createHiddenPeekCards());
                abilityPeekHideTimeoutRef.current = null;
            }, Math.max(1000, abilityRevealDurationSeconds * 1000));
        }).catch(async (error) => {
            console.error("Failed to execute self-peek ability:", error);
            await resyncTurnActionState(gameId, token, { resetTransientActionFlags: false });
        })
        .finally(() => setIsSubmittingAbility(false));

    } else if (gameStatus === "ability_swap") {
        // 11/12: first select own card
        setAbilitySelectedOwnCardIndex(cardIndex);
    }
};


// #28: handle opponent card click during ability phase
const handleAbilityOpponentCardClick = (opponentId: number, cardIndex: number) => {
    if (!canInteractWithAbilityTargets || !gameId || !token) return;

    if (gameStatus === "ability_peek_opponent") {
        // 9/10: peek opponent card, POST immediately
        setIsSubmittingAbility(true);
        void apiService.postWithAuth(
            `/games/${gameId}/peek`,
            {
                peekType: "special",
                handUserId: opponentId,
                indices: [cardIndex],
            },
            token
        ).then(() => {
            setIsAbilityRevealWindow(true);
            resetAbilitySelection();
        }).catch(async (error) => {
            console.error("Failed to execute opponent-spy ability:", error);
            await resyncTurnActionState(gameId, token, { resetTransientActionFlags: false });
        })
        .finally(() => setIsSubmittingAbility(false));

    } else if (gameStatus === "ability_swap" && abilitySelectedOwnCardIndex !== null) {
        // 11/12: own card already selected, now swap
        const ownCardIndex = abilitySelectedOwnCardIndex;
        const ownCardAnchor = ownHandCardRefs.current[ownCardIndex] ?? null;
        const opponentCardAnchor = getOpponentCardAnchor(opponentId, cardIndex);

        setIsSubmittingAbility(true);
        void apiService.postWithAuth(
            `/games/${gameId}/abilities/swap`,
            {
                ownCardIndex,
                targetUserId: opponentId,
                targetCardIndex: cardIndex,
            },
            token
        ).then(() => {
            if (ownCardAnchor && opponentCardAnchor) {
                launchFlyingCardAnimation(ownCardAnchor, opponentCardAnchor, {
                    hidden: true,
                }, {
                    fadeMode: "late",
                });
                launchFlyingCardAnimation(opponentCardAnchor, ownCardAnchor, {
                    hidden: true,
                }, {
                    fadeMode: "late",
                });
            }
            resetAbilitySelection();
            return apiService.getWithAuth<Card[]>(
                `/games/${gameId}/my-hand`,
                token
            );
        }).then(hand => setMyHand(hand))
        .catch(async (error) => {
            console.error("Failed to execute swap ability:", error);
            await resyncTurnActionState(gameId, token, { resetTransientActionFlags: false });
        })
        .finally(() => setIsSubmittingAbility(false));
    }
};

const refreshOwnHand = async (activeGameId: string, authToken: string) => {
    const hand = await apiService.getWithAuth<Card[]>(
        `/games/${activeGameId}/my-hand`,
        authToken
    );
    setMyHand(hand);
};

const refreshDiscardPileTop = async (activeGameId: string, authToken: string) => {
    try {
        const topCard = await apiService.getWithAuth<Card | null>(
            `/games/${activeGameId}/discard-pile/top`,
            authToken
        );
        setDiscardTopCard(topCard ?? null);
        discardTopCardRef.current = topCard ?? null;
        // Use authoritative server state on explicit refreshes.
        clearDiscardTopOverrideTimer();
        setDiscardTopAnimationOverride(null);
    } catch (error) {
        console.error("Failed to refresh discard pile top card:", error);
    }
};

const refreshDrawnCardFromServer = async (
    activeGameId: string,
    authToken: string,
    sourceHint: DrawSource | null = null,
): Promise<Card | null> => {
    try {
        const rawCard = await apiService.getWithAuth<unknown>(
            `/games/${activeGameId}/drawn-card`,
            authToken,
        );
        const nextDrawnCard = toValidCardOrNull(rawCard);
        applyDrawnCardState(nextDrawnCard, sourceHint);
        return nextDrawnCard;
    } catch {
        applyDrawnCardState(null);
        return null;
    }
};

const resyncTurnActionState = async (
    activeGameId: string,
    authToken: string,
    options?: { resetTransientActionFlags?: boolean },
) => {
    await Promise.allSettled([
        refreshOwnHand(activeGameId, authToken),
        refreshDiscardPileTop(activeGameId, authToken),
        refreshDrawnCardFromServer(activeGameId, authToken),
    ]);
    if (options?.resetTransientActionFlags !== false) {
        setIsDrawingFromPile(false);
        setIsDrawingFromDiscardPile(false);
        setIsSwappingDrawnCard(false);
        setIsDiscardingDrawnCard(false);
        drawRequestInFlightRef.current = false;
    }
    lastAuthoritativeResyncMsRef.current = Date.now();
};

useEffect(() => {
    const authToken = token.trim();
    if (!gameId || !authToken) {
        return;
    }

    const resyncOnFocus = async () => {
        lastActivityMsRef.current = Date.now();
        clearDiscardTopOverrideTimer();
        setDiscardTopAnimationOverride(null);

        // Keep local view aligned after tab/background throttling without waiting for a manual click.
        await Promise.allSettled([
            refreshOwnHand(gameId, authToken),
            refreshDiscardPileTop(gameId, authToken),
            refreshDrawnCardFromServer(gameId, authToken),
            fetch(`${getApiDomain()}/heartbeat`, {
                method: "POST",
                headers: { Authorization: authToken },
            }),
        ]);
        lastAuthoritativeResyncMsRef.current = Date.now();
    };

    const handleVisibilityChange = () => {
        if (typeof document !== "undefined" && document.visibilityState === "visible") {
            void resyncOnFocus();
        }
    };

    void resyncOnFocus();
    window.addEventListener("focus", resyncOnFocus, { passive: true });
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
        window.removeEventListener("focus", resyncOnFocus);
        document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
// Resync runs on focus/visibility/game changes; helper refs are intentionally omitted.
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [apiService, gameId, token]);

useEffect(() => {
    const authToken = token.trim();
    if (!gameId || selfUserId == null || !authToken) {
        return;
    }

    let active = true;
    consecutiveNotMyTurnPollsRef.current = 0;
    consecutiveNoOwnerProbePollsRef.current = 0;
    const resolveTurnOwnerFromServer = async (): Promise<number | null> => {
        try {
            const selfTurn = await apiService.getWithAuth<boolean>(
                `/games/${encodeURIComponent(gameId)}/is-my-turn/${selfUserId}`,
                authToken,
            );
            if (selfTurn) {
                return selfUserId;
            }
        } catch {
            // fall back to full ownership probe below
        }

        const candidateIds = Array.from(
            new Set(
                [...tablePlayerIdsRef.current, selfUserId].filter((id) => Number.isFinite(id))
            )
        );
        if (candidateIds.length === 0) {
            return null;
        }

        const checks = await Promise.allSettled(
            candidateIds.map(async (candidateUserId) => {
                const isTurn = await apiService.getWithAuth<boolean>(
                    `/games/${encodeURIComponent(gameId)}/is-my-turn/${candidateUserId}`,
                    authToken,
                );
                return isTurn ? candidateUserId : null;
            })
        );

        for (const result of checks) {
            if (result.status === "fulfilled" && result.value != null) {
                return result.value;
            }
        }
        return null;
    };

    const syncTurnOwnership = async () => {
        try {
            const nextTurnUserId = await resolveTurnOwnerFromServer();
            if (!active) {
                return;
            }

            // Successful authoritative HTTP turn probe means we are synced enough to resume input.
            setSocketSynced(true);

            setCurrentTurnUserId((previous) => {
                if (nextTurnUserId != null) {
                    consecutiveNotMyTurnPollsRef.current = 0;
                    consecutiveNoOwnerProbePollsRef.current = 0;
                    currentTurnUserIdRef.current = nextTurnUserId;
                    return previous === nextTurnUserId ? previous : nextTurnUserId;
                }

                // Do not immediately demote during an active ability interaction.
                // Some backends briefly report false while still expecting the ability click target.
                if (
                    previous === selfUserId &&
                    isAbilityPending &&
                    (isUseAbilitySelected || isAbilityChoicePending)
                ) {
                    consecutiveNotMyTurnPollsRef.current = 0;
                    return previous;
                }

                // Treat null owner probe responses as ambiguous unless websocket is stale.
                // This avoids false lockouts when HTTP turn probes briefly lag behind live game-state.
                const nextNoOwnerStreak = consecutiveNoOwnerProbePollsRef.current + 1;
                consecutiveNoOwnerProbePollsRef.current = nextNoOwnerStreak;
                const websocketFreshMs = Date.now() - lastGameStateSignalMsRef.current;
                const shouldDemoteFromNoOwner =
                    !socketSynced &&
                    websocketFreshMs > 9000 &&
                    nextNoOwnerStreak >= 4;

                if (!shouldDemoteFromNoOwner) {
                    if (previous === selfUserId) {
                        consecutiveNotMyTurnPollsRef.current = Math.min(
                            consecutiveNotMyTurnPollsRef.current + 1,
                            1,
                        );
                        return previous;
                    }
                    consecutiveNotMyTurnPollsRef.current = 0;
                    return previous;
                }

                if (previous === selfUserId) {
                    currentTurnUserIdRef.current = null;
                    return null;
                }
                consecutiveNotMyTurnPollsRef.current = 0;
                currentTurnUserIdRef.current = null;
                return null;
            });
        } catch {
            // Keep websocket state as-is when poll fails transiently
        }
    };

    const runFocusRecoveryBurst = () => {
        void syncTurnOwnership();
        let attempts = 0;
        const burstId = window.setInterval(() => {
            attempts += 1;
            void syncTurnOwnership();
            if (attempts >= 4) {
                window.clearInterval(burstId);
            }
        }, 450);
        return burstId;
    };

    const handleFocus = () => {
        void syncTurnOwnership();
    };
    const handleVisibilityChange = () => {
        if (document.visibilityState === "visible") {
            runFocusRecoveryBurst();
        }
    };

    void syncTurnOwnership();
    window.addEventListener("focus", handleFocus, { passive: true });
    document.addEventListener("visibilitychange", handleVisibilityChange);
    const intervalId = window.setInterval(
        syncTurnOwnership,
        socketSynced ? 2500 : 1000
    );

    return () => {
        active = false;
        window.removeEventListener("focus", handleFocus);
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        window.clearInterval(intervalId);
    };
}, [
    apiService,
    gameId,
    selfUserId,
    token,
    socketSynced,
    isAbilityPending,
    isUseAbilitySelected,
    isAbilityChoicePending,
]);

useEffect(() => {
    const authToken = token.trim();
    if (!gameId || !authToken) {
        return;
    }

    const resyncDiscardPileTop = async () => {
        const now = Date.now();
        const shouldRunFullResync =
            !socketSynced ||
            now - lastGameStateSignalMsRef.current > 8000 ||
            now - lastAuthoritativeResyncMsRef.current > 12000;

        await refreshDiscardPileTop(gameId, authToken);

        // When websocket is desynced, also refresh hand and drawn-card state so
        // board state converges without waiting for manual focus/click recovery.
        if (shouldRunFullResync) {
            await Promise.allSettled([
                refreshOwnHand(gameId, authToken),
                refreshDrawnCardFromServer(gameId, authToken),
            ]);
            lastAuthoritativeResyncMsRef.current = Date.now();
        }
    };

    const handleVisibilityChange = () => {
        if (document.visibilityState === "visible") {
            void resyncDiscardPileTop();
        }
    };
    const handlePageShow = () => {
        void resyncDiscardPileTop();
    };

    void resyncDiscardPileTop();
    const intervalId = window.setInterval(resyncDiscardPileTop, socketSynced ? 4000 : 1800);
    window.addEventListener("pointerdown", handlePageShow, { passive: true });
    window.addEventListener("focus", handlePageShow, { passive: true });
    window.addEventListener("pageshow", handlePageShow, { passive: true });
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
        window.clearInterval(intervalId);
        window.removeEventListener("pointerdown", handlePageShow);
        window.removeEventListener("focus", handlePageShow);
        window.removeEventListener("pageshow", handlePageShow);
        document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
// Poll cadence depends on sync state; helper refs are intentionally omitted.
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [apiService, gameId, token, socketSynced]);

useEffect(() => {
    const authToken = token.trim();
    if (!gameId || !authToken || socketSynced) {
        return;
    }

    let active = true;
    const recoverSyncFromHttp = async () => {
        try {
            await apiService.getWithAuth<GameRuntimeConfigResponse>(
                `/games/${gameId}/config`,
                authToken
            );
            if (!active) {
                return;
            }
            setSocketSynced(true);
        } catch {
            // keep waiting for next retry
        }
    };

    void recoverSyncFromHttp();
    const intervalId = window.setInterval(recoverSyncFromHttp, 1500);
    return () => {
        active = false;
        window.clearInterval(intervalId);
    };
}, [apiService, gameId, token, socketSynced]);

const clearFlyingCardTimer = () => {
    if (flyingCardTimeoutsRef.current.length === 0) {
        return;
    }

    for (const timeoutId of flyingCardTimeoutsRef.current) {
        window.clearTimeout(timeoutId);
    }
    flyingCardTimeoutsRef.current = [];
};

const clearDiscardRevealTimer = () => {
    if (discardRevealTimeoutRef.current != null) {
        window.clearTimeout(discardRevealTimeoutRef.current);
        discardRevealTimeoutRef.current = null;
    }
};

const triggerDiscardFlipReveal = () => {
    clearDiscardRevealTimer();
    setIsDiscardPileTemporarilyHidden(true);
    discardRevealTimeoutRef.current = window.setTimeout(() => {
        setIsDiscardPileTemporarilyHidden(false);
        discardRevealTimeoutRef.current = null;
    }, 240);
};

const getCardAnimationRect = (anchorElement: HTMLDivElement): DOMRect | null => {
    const renderedCardElement = anchorElement.querySelector<HTMLElement>(".card");
    const measureElement = renderedCardElement ?? anchorElement;
    const rect = measureElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
        return null;
    }
    return rect;
};

const launchFlyingCardAnimation = (
    fromElement: HTMLDivElement | null,
    toElement: HTMLDivElement | null,
    card: { hidden: boolean; value?: number },
    options?: FlyingCardAnimationOptions,
) => {
    if (!fromElement || !toElement) {
        return;
    }

    const fromRect = getCardAnimationRect(fromElement);
    const toRect = getCardAnimationRect(toElement);
    if (!fromRect || !toRect) {
        return;
    }

    const fromCenterX = fromRect.left + (fromRect.width / 2);
    const fromCenterY = fromRect.top + (fromRect.height / 2);
    const toCenterX = toRect.left + (toRect.width / 2);
    const toCenterY = toRect.top + (toRect.height / 2);

    const animationId = flyingCardIdRef.current + 1;
    flyingCardIdRef.current = animationId;

    setFlyingCardAnimations((current) => [
        ...current,
        {
        id: animationId,
        hidden: card.hidden,
        value: card.value,
        // Anchor the flying card to source center, then move center-to-center.
        startX: fromCenterX - (fromRect.width / 2),
        startY: fromCenterY - (fromRect.height / 2),
        deltaX: toCenterX - fromCenterX,
        deltaY: toCenterY - fromCenterY,
        width: fromRect.width,
        height: fromRect.height,
        fadeMode: options?.fadeMode ?? "late",
        },
    ]);
    const timeoutId = window.setTimeout(() => {
        setFlyingCardAnimations((current) =>
            current.filter((animation) => animation.id !== animationId)
        );
        flyingCardTimeoutsRef.current = flyingCardTimeoutsRef.current.filter((id) => id !== timeoutId);
    }, FLYING_CARD_ANIMATION_MS);
    flyingCardTimeoutsRef.current.push(timeoutId);
};

const swapDrawnCardWithHand = (targetCardIndex: number) => {
    if (!canSwapDrawnCardWithHand || !gameId || !token) {
        return;
    }

    const drawnCardToMove = drawnCard;
    const sourceForDrawnCard = selectedDrawSource;
    const sourceElement =
        sourceForDrawnCard === "discard_pile" ? discardPileCardRef.current : drawPileCardRef.current;
    const targetElement = ownHandCardRefs.current[targetCardIndex] ?? null;
    const swappedOutHandCard = myHand[targetCardIndex];
    const swappedOutSourceElement = ownHandCardRefs.current[targetCardIndex] ?? null;
    const swappedOutTargetElement = discardPileCardRef.current;

    setIsSwappingDrawnCard(true);
    void apiService.postWithAuth(
        `/games/${gameId}/drawn-card/swap`,
        { targetCardIndex },
        token
    ).then(async () => {
        if (drawnCardToMove && sourceElement && targetElement) {
            launchFlyingCardAnimation(sourceElement, targetElement, {
                hidden: false,
                value: drawnCardToMove.value,
            });
        }
        if (swappedOutHandCard && swappedOutSourceElement && swappedOutTargetElement) {
            launchFlyingCardAnimation(swappedOutSourceElement, swappedOutTargetElement, {
                hidden: false,
                value: swappedOutHandCard.value,
            });
            triggerDiscardFlipReveal();
        }
        setDrawnCard(null);
        setSelectedDrawSource(null);
        setHasChosenDrawSourceThisTurn(false);
        await Promise.all([
            refreshOwnHand(gameId, token),
            refreshDiscardPileTop(gameId, token),
        ]);
    }).catch(async (error) => {
        console.error("Failed to swap drawn card:", error);
        await resyncTurnActionState(gameId, token);
    }).finally(() => {
        setIsSwappingDrawnCard(false);
    });
};

// Discard the currently drawn card
const tryDiscardDrawnCard = async (activeGameId: string, authToken: string) => {
    await apiService.postWithAuth(
        `/games/${activeGameId}/drawn-card/discard`,
        {},
        authToken,
    );
};

const discardDrawnCard = () => {
    if (!canDiscardDrawnCard || !gameId || !token || !drawnCard) {
        return;
    }

    const drawnCardToMove = drawnCard;
    const sourceElement = drawPileCardRef.current;
    const targetElement = discardPileCardRef.current;

    setIsDiscardingDrawnCard(true);
    void tryDiscardDrawnCard(gameId, token).then(async () => {
        if (drawnCardToMove && sourceElement && targetElement) {
            launchFlyingCardAnimation(sourceElement, targetElement, {
                hidden: false,
                value: drawnCardToMove.value,
            });
        }
        setDrawnCard(null);
        setSelectedDrawSource(null);
        setHasChosenDrawSourceThisTurn(false);
        await refreshDiscardPileTop(gameId, token);
    }).catch(async (error) => {
        console.error("Failed to discard drawn card:", error);
        await resyncTurnActionState(gameId, token);
    }).finally(() => {
        setIsDiscardingDrawnCard(false);
    });
};

const swapDiscardPileTopWithHand = (targetCardIndex: number) => {
    if (!canDrawFromDiscardPile || !gameId || !token) {
        return;
    }

    const sourceElement = discardPileCardRef.current;
    const targetElement = ownHandCardRefs.current[targetCardIndex] ?? null;
    const swappedOutHandCard = myHand[targetCardIndex];
    const swappedOutSourceElement = ownHandCardRefs.current[targetCardIndex] ?? null;
    const swappedOutTargetElement = discardPileCardRef.current;
    const discardTopValue = discardTopCard?.value;

    setIsSwappingDrawnCard(true);
    void apiService.postWithAuth(
        `/games/${gameId}/discard-pile/swap`,
        { targetCardIndex },
        token
    ).then(async () => {
        if (sourceElement && targetElement) {
            launchFlyingCardAnimation(sourceElement, targetElement, {
                hidden: false,
                value: discardTopValue,
            });
        }
        if (swappedOutHandCard && swappedOutSourceElement && swappedOutTargetElement) {
            launchFlyingCardAnimation(swappedOutSourceElement, swappedOutTargetElement, {
                hidden: false,
                value: swappedOutHandCard.value,
            });
        }
        triggerDiscardFlipReveal();
        await Promise.all([
            refreshOwnHand(gameId, token),
            refreshDiscardPileTop(gameId, token),
        ]);
    }).catch(async (error) => {
        console.error("Failed to swap discard pile top card:", error);
        await resyncTurnActionState(gameId, token);
    }).finally(() => {
        setIsSwappingDrawnCard(false);
    });
};

const drawFromPile = () => {
    if (!canDrawFromPile || !gameId || !token || drawRequestInFlightRef.current) {
        return;
    }

    drawRequestInFlightRef.current = true;
    setIsDrawingFromPile(true);
    setSelectedDrawSource("draw_pile");
    setHasChosenDrawSourceThisTurn(true);
    void apiService.postWithAuth(
        `/games/${gameId}/moves/draw`,
        {},
        token
    ).then(() => {
        return apiService.getWithAuth<unknown>(
            `/games/${gameId}/drawn-card`,
            token
        );
    }).then((rawCard) => {
        const nextDrawnCard = toValidCardOrNull(rawCard);
        applyDrawnCardState(nextDrawnCard, "draw_pile");
    }).catch(async (error) => {
        console.error("Failed to draw from pile:", error);
        await resyncTurnActionState(gameId, token);
    }).finally(() => {
        setIsDrawingFromPile(false);
        drawRequestInFlightRef.current = false;
    });
};

const drawFromDiscardPile = () => {
    if (!canDrawFromDiscardPile || !gameId || !token || drawRequestInFlightRef.current) {
        return;
    }

    drawRequestInFlightRef.current = true;
    setIsDrawingFromDiscardPile(true);
    setSelectedDrawSource("discard_pile");
    setHasChosenDrawSourceThisTurn(true);
    void apiService.postWithAuth(
        `/games/${gameId}/discard-pile/draw`,
        {},
        token
    ).then(async () => {
        const [rawDrawnCard] = await Promise.all([
            apiService.getWithAuth<unknown>(
                `/games/${gameId}/drawn-card`,
                token
            ),
            refreshDiscardPileTop(gameId, token),
            refreshOwnHand(gameId, token),
        ]);
        const nextDrawnCard = toValidCardOrNull(rawDrawnCard);
        applyDrawnCardState(nextDrawnCard, "discard_pile");
    }).catch(async (error) => {
        console.error("Failed to draw from discard pile:", error);
        await resyncTurnActionState(gameId, token);
    }).finally(() => {
        setIsDrawingFromDiscardPile(false);
        drawRequestInFlightRef.current = false;
    });
};

const eventHasTurnCardDrag = (event: React.DragEvent<HTMLDivElement>) =>
    isDraggingTurnCard || Array.from(event.dataTransfer.types).includes(TURN_CARD_DRAG_MIME);
const eventHasDiscardPileSwapCardDrag = (event: React.DragEvent<HTMLDivElement>) =>
    isDraggingDiscardPileSwapCard || Array.from(event.dataTransfer.types).includes(DISCARD_PILE_SWAP_DRAG_MIME);

const handleTurnCardDragStart = (event: React.DragEvent<HTMLDivElement>) => {
    if (!canDragSelectedTurnCard) {
        event.preventDefault();
        return;
    }

    setIsDraggingTurnCard(true);
    setDragOverOwnCardIndex(null);
    setIsDragOverDiscardPile(false);
    event.dataTransfer.setData(TURN_CARD_DRAG_MIME, "turn-card");
    event.dataTransfer.effectAllowed = "move";
};

const handleTurnCardDragEnd = () => {
    setIsDraggingTurnCard(false);
    setIsDraggingDiscardPileSwapCard(false);
    setDragOverOwnCardIndex(null);
    setIsDragOverDiscardPile(false);
};

const handleDiscardPileCardDragStart = (event: React.DragEvent<HTMLDivElement>) => {
    if (isDiscardPileSelectedForTurnAction && canDragSelectedTurnCard) {
        handleTurnCardDragStart(event);
        return;
    }

    if (!canDrawFromDiscardPile || !gameId || !token) {
        event.preventDefault();
        return;
    }

    setIsDraggingTurnCard(false);
    setIsDraggingDiscardPileSwapCard(true);
    setDragOverOwnCardIndex(null);
    setIsDragOverDiscardPile(false);
    event.dataTransfer.setData(DISCARD_PILE_SWAP_DRAG_MIME, "discard-pile-swap-card");
    event.dataTransfer.effectAllowed = "move";
};

const handleOwnCardDragOver = (event: React.DragEvent<HTMLDivElement>, ownCardIndex: number) => {
    const swappingDrawnCard = canSwapDrawnCardWithHand && eventHasTurnCardDrag(event);
    const swappingDiscardTop = canDrawFromDiscardPile && eventHasDiscardPileSwapCardDrag(event);
    if (!swappingDrawnCard && !swappingDiscardTop) {
        return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (isDragOverDiscardPile) {
        setIsDragOverDiscardPile(false);
    }
    if (dragOverOwnCardIndex !== ownCardIndex) {
        setDragOverOwnCardIndex(ownCardIndex);
    }
};

const handleOwnCardDragLeave = (ownCardIndex: number) => {
    if (dragOverOwnCardIndex === ownCardIndex) {
        setDragOverOwnCardIndex(null);
    }
};

const handleOwnCardDrop = (event: React.DragEvent<HTMLDivElement>, ownCardIndex: number) => {
    const swappingDrawnCard = canSwapDrawnCardWithHand && eventHasTurnCardDrag(event);
    const swappingDiscardTop = canDrawFromDiscardPile && eventHasDiscardPileSwapCardDrag(event);
    if (!swappingDrawnCard && !swappingDiscardTop) {
        return;
    }

    event.preventDefault();
    setIsDraggingTurnCard(false);
    setIsDraggingDiscardPileSwapCard(false);
    setDragOverOwnCardIndex(null);
    setIsDragOverDiscardPile(false);
    if (swappingDrawnCard) {
        swapDrawnCardWithHand(ownCardIndex);
        return;
    }
    swapDiscardPileTopWithHand(ownCardIndex);
};

const handleDiscardPileDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!canDiscardDrawnCard || !eventHasTurnCardDrag(event)) {
        return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dragOverOwnCardIndex != null) {
        setDragOverOwnCardIndex(null);
    }
    if (!isDragOverDiscardPile) {
        setIsDragOverDiscardPile(true);
    }
};

const handleDiscardPileDragLeave = () => {
    if (isDragOverDiscardPile) {
        setIsDragOverDiscardPile(false);
    }
};

const handleDiscardPileDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!canDiscardDrawnCard || !eventHasTurnCardDrag(event)) {
        return;
    }

    event.preventDefault();
    setIsDraggingTurnCard(false);
    setIsDraggingDiscardPileSwapCard(false);
    setDragOverOwnCardIndex(null);
    setIsDragOverDiscardPile(false);
    discardDrawnCard();
};

// End an active ability phase without using it.
const trySkipAbility = async (activeGameId: string, authToken: string) => {
    const delay = (milliseconds: number) =>
        new Promise<void>((resolve) => {
            setTimeout(resolve, milliseconds);
        });

    const maxAttempts = 4;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
            await apiService.postWithAuth(`/games/${activeGameId}/abilities/skip`, {}, authToken);
            return;
        } catch (error) {
            const status = (error as Partial<ApplicationError>)?.status;
            if ((status === 400 || status === 409 || status === 423) && attempt < maxAttempts - 1) {
                await delay(200);
                continue;
            }
            throw error;
        }
    }
};

const chooseUseAbility = () => {
    if (!canShowAbilityChoiceButtons) {
        return;
    }
    // Prevent a stale negative turn poll from immediately locking targets
    consecutiveNotMyTurnPollsRef.current = 0;
    setIsUseAbilitySelected(true);
    setIsAbilityChoicePending(false);
};

const skipAbilityChoice = () => {
    if (!canShowAbilityChoiceButtons || !gameId || !token) {
        return;
    }

    setIsSkippingAbilityChoice(true);
    void trySkipAbility(gameId, token).catch((error) => {
        console.error("Failed to skip ability:", error);
    }).finally(() => {
        setIsSkippingAbilityChoice(false);
    });
};

const canCallCabo =
    isCurrentTurnMine &&
    isRoundActive &&
    !isCaboCalledGlobal &&
    !isPeekPhase &&
    !isAbilityPending &&
    !drawnCard &&
    !isDrawingFromPile &&
    !isDrawingFromDiscardPile &&
    !isSwappingDrawnCard &&
    !isDiscardingDrawnCard &&
    !isCallingCabo &&
    !isPostRoundPhase;

const callCabo = () => {
    if (!canCallCabo || !gameId || !token || isCaboCalledGlobal) {
        return;
    }
    if (typeof window !== "undefined") {
        const confirmed = window.confirm(
            "Are you sure you want to call Cabo? This ends your turn immediately and starts the last round."
        );
        if (!confirmed) {
            return;
        }
    }

    setIsCallingCabo(true);
    void apiService.postWithAuth<void>(
        `/games/${gameId}/moves/cabo`,
        {},
        token
    ).catch((error) => {
        console.error("Failed to call Cabo:", error);
    }).finally(() => {
        setIsCallingCabo(false);
    });
};

// #36/#42: Scores
const [isScoresOpen, setIsScoresOpen] = useState<boolean>(false);

const scoreModalPlayers = useMemo(() => {
    if (finalScores.length === 0) {
        return tablePlayerIds.map((id) => ({
            userId: id,
            username: playerNamesById[id] ?? `Player ${id}`,
            totalScore: null,
            roundScores: [] as Array<number | null>,
        }));
    }

    const byId = new Map(finalScores.map((entry) => [entry.userId, entry] as const));
    const ids = [...tablePlayerIds];
    finalScores.forEach((entry) => {
        if (!ids.includes(entry.userId)) {
            ids.push(entry.userId);
        }
    });

    return ids.map((id) => {
        const existing = byId.get(id);
        if (existing) {
            return {
                ...existing,
                username: playerNamesById[id] ?? existing.username ?? `Player ${id}`,
            };
        }
        return {
            userId: id,
            username: playerNamesById[id] ?? `Player ${id}`,
            totalScore: null,
            roundScores: [] as Array<number | null>,
        };
    });
}, [finalScores, tablePlayerIds, playerNamesById]);

const canonicalCaboRevealOrderIds = useMemo(() => {
    const serverOrderedIds = Array.from(
        new Set(
            orderedPlayerIds.filter((id) => Number.isFinite(id))
        )
    );
    if (serverOrderedIds.length > 0) {
        return serverOrderedIds;
    }

    const fallbackIds = new Set<number>();
    Object.keys(playerCardsById)
        .map((key) => Number(key))
        .filter((id) => Number.isFinite(id))
        .forEach((id) => fallbackIds.add(id));
    finalScores.forEach((entry) => fallbackIds.add(entry.userId));
    tablePlayerIds
        .filter((id) => Number.isFinite(id))
        .forEach((id) => fallbackIds.add(id));

    return Array.from(fallbackIds).sort((a, b) => a - b);
}, [orderedPlayerIds, playerCardsById, finalScores, tablePlayerIds]);

const introPhasePlayers = useMemo(() => {
    const scoreByUserId = new Map<number, number | null>();
    const snapshotNameByUserId = new Map<number, string>();
    finalScores.forEach((entry) => {
        const parsedScore = Number(entry.totalScore);
        scoreByUserId.set(entry.userId, Number.isFinite(parsedScore) ? Math.trunc(parsedScore) : null);
        const snapshotName = String(entry.username ?? "").trim();
        if (!isPlaceholderPlayerName(snapshotName)) {
            snapshotNameByUserId.set(entry.userId, snapshotName);
        }
    });

      const combinedIds = [...tablePlayerIds];
      finalScores.forEach((entry) => {
          if (!combinedIds.includes(entry.userId)) {
              combinedIds.push(entry.userId);
          }
      });

      return combinedIds.map((id) => {
          const mappedName = String(playerNamesById[id] ?? "").trim();
          const username = !isPlaceholderPlayerName(mappedName)
              ? mappedName
              : (snapshotNameByUserId.get(id) ?? `Player ${id}`);
          const resolvedScore = scoreByUserId.get(id);
          return {
              userId: id,
              username,
              scoreText: formatPointsLabel(resolvedScore),
          };
      });
  }, [finalScores, tablePlayerIds, playerNamesById]);

const INTRO_TITLE_DURATION_MS = 2000;
const INTRO_PLAYER_REVEAL_INTERVAL_MS = 2000;
const INTRO_WAVE_FRAME_DURATION_MS = 200;
const CABO_REVEAL_OPENING_MS = 4000;
const CABO_REVEAL_PLAYER_NAME_AND_CARDS_MS = 2000;
const CABO_REVEAL_PLAYER_CARD_REVEAL_MS = 4000;
const CABO_REVEAL_PLAYER_POINTS_REVEAL_MS = 4000;
const CABO_REVEAL_PLAYER_NAME_TRANSITION_MS = 1000;
const CABO_REVEAL_OUTRO_NAME_EXIT_MS = 1000;
const CABO_REVEAL_WINNER_CELEBRATION_MS = 5000;
const CABO_REVEAL_OUTRO_BUFFER_MS = 1000;

const visibleIntroPlayersCount = useMemo(() => {
    if (introElapsedMs < INTRO_TITLE_DURATION_MS) {
        return 0;
    }
    const unlockedCount = 1 + Math.floor((introElapsedMs - INTRO_TITLE_DURATION_MS) / INTRO_PLAYER_REVEAL_INTERVAL_MS);
    return Math.max(0, Math.min(introPhasePlayers.length, unlockedCount));
}, [introElapsedMs, introPhasePlayers.length]);

const visibleIntroPlayers = useMemo(
    () => introPhasePlayers.slice(0, visibleIntroPlayersCount),
    [introPhasePlayers, visibleIntroPlayersCount],
);

const introRoundNumber = useMemo(() => {
    const roundsFromScores = finalScores.reduce((maxRounds, player) => {
        const playerRoundCount = Array.isArray(player.roundScores) ? player.roundScores.length : 0;
        return Math.max(maxRounds, playerRoundCount);
    }, 0);
    const parsedTotalRounds = Number(finalScoreTotalRounds);
    const roundsFromState = Number.isFinite(parsedTotalRounds) ? Math.max(0, Math.trunc(parsedTotalRounds)) : 0;
    const completedRounds = Math.max(roundsFromScores, roundsFromState);
    return completedRounds + 1;
}, [finalScoreTotalRounds, finalScores]);

const caboRevealPlayers = useMemo(() => {
    const byFinalScoreId = new Map(finalScores.map((entry) => [entry.userId, entry] as const));
    const orderedIds = [...canonicalCaboRevealOrderIds];

    const appendMissingId = (id: number) => {
        if (Number.isFinite(id) && !orderedIds.includes(id)) {
            orderedIds.push(id);
        }
    };

    Object.keys(playerCardsById)
        .map((key) => Number(key))
        .filter((id) => Number.isFinite(id))
        .sort((a, b) => a - b)
        .forEach(appendMissingId);

    finalScores.forEach((entry) => {
        appendMissingId(entry.userId);
    });

    return orderedIds.map((id) => {
        const scoreEntry = byFinalScoreId.get(id);
        const sourceCards = playerCardsById[id] ?? [];
        const cardsBySlot = new Map<number, SeatCardView>();
        sourceCards.forEach((card) => {
            const normalizedSlot = normalizeHandSlotIndex(card.position, HAND_SIZE);
            if (normalizedSlot != null) {
                cardsBySlot.set(normalizedSlot, card);
            }
        });
        const cards = Array.from({ length: HAND_SIZE }, (_, index) => (
            cardsBySlot.get(index) ?? { position: index, faceDown: true, value: undefined }
        ));

        const roundScores = Array.isArray(scoreEntry?.roundScores) ? scoreEntry.roundScores : [];
        const lastRoundScore = roundScores.length > 0
            ? toFiniteScore(roundScores[roundScores.length - 1])
            : null;
        const totalScore = toFiniteScore(scoreEntry?.totalScore);
        const hasEveryCardValue = cards.every((card) => Number.isFinite(Number(card.value)));
        const cardValueSum = hasEveryCardValue
            ? cards.reduce((sum, card) => sum + Number(card.value), 0)
            : null;
        // Displayed equation total should always follow visible card values when available.
        const displayRoundScore = cardValueSum ?? lastRoundScore ?? totalScore;
        // Winner selection still follows backend round-score resolution first (special rules).
        const pointsToReveal = lastRoundScore ?? cardValueSum ?? totalScore;
        const roundScoreText = displayRoundScore == null
            ? "-"
            : String(Math.trunc(displayRoundScore));

        const mappedName = String(playerNamesById[id] ?? "").trim();
        const snapshotName = String(scoreEntry?.username ?? "").trim();
        const username = !isPlaceholderPlayerName(mappedName)
            ? mappedName
            : (!isPlaceholderPlayerName(snapshotName) ? snapshotName : `Player ${id}`);

        return {
            userId: id,
            username,
            cards,
            pointsToReveal,
            roundScoreText,
            roundScoreLabel: formatPointsLabel(displayRoundScore),
            isSpecialWin: scoreEntry?.isSpecialWin === true,
        };
    });
}, [HAND_SIZE, canonicalCaboRevealOrderIds, finalScores, playerCardsById, playerNamesById]);

const caboRevealWinner = useMemo(() => {
    if (caboRevealPlayers.length === 0) {
        return null;
    }

    const contenders = caboRevealPlayers.filter((player) => player.pointsToReveal != null);
    if (contenders.length === 0) {
        const fallback = caboRevealPlayers[caboRevealPlayers.length - 1];
        return {
            winnerNamesLabel: fallback.username,
            winnerCards: [
                {
                    userId: fallback.userId,
                    username: fallback.username,
                    cards: fallback.cards,
                },
            ],
            tie: false,
        };
    }

    const minPoints = contenders.reduce((minimum, player) => (
        player.pointsToReveal != null && player.pointsToReveal < minimum
            ? player.pointsToReveal
            : minimum
    ), Number.POSITIVE_INFINITY);
    const winners = contenders.filter((player) => player.pointsToReveal === minPoints);
    return {
        winnerNamesLabel: winners.map((player) => player.username).join(" & "),
        winnerCards: winners.map((player) => ({
            userId: player.userId,
            username: player.username,
            cards: player.cards,
        })),
        tie: winners.length > 1,
    };
}, [caboRevealPlayers]);

const caboRevealTimeline = useMemo(() => {
    const playerCount = caboRevealPlayers.length;
    const plannedTotalMs =
        CABO_REVEAL_OPENING_MS +
        (playerCount * (
            CABO_REVEAL_PLAYER_NAME_AND_CARDS_MS +
            CABO_REVEAL_PLAYER_CARD_REVEAL_MS +
            CABO_REVEAL_PLAYER_POINTS_REVEAL_MS
        )) +
        CABO_REVEAL_OUTRO_NAME_EXIT_MS +
        CABO_REVEAL_WINNER_CELEBRATION_MS +
        CABO_REVEAL_OUTRO_BUFFER_MS;
    const availableMs = Math.max(1000, caboRevealDurationSeconds * 1000);
    const scale = plannedTotalMs > availableMs ? availableMs / plannedTotalMs : 1;

    const openingTitleMs = CABO_REVEAL_OPENING_MS * scale;
    const playerNameAndCardsMs = CABO_REVEAL_PLAYER_NAME_AND_CARDS_MS * scale;
    const playerCardRevealMs = CABO_REVEAL_PLAYER_CARD_REVEAL_MS * scale;
    const playerPointsRevealMs = CABO_REVEAL_PLAYER_POINTS_REVEAL_MS * scale;
    const playerNameTransitionMs = Math.min(
        playerNameAndCardsMs,
        CABO_REVEAL_PLAYER_NAME_TRANSITION_MS * scale,
    );
    const perPlayerTotalMs = playerNameAndCardsMs + playerCardRevealMs + playerPointsRevealMs;
    const outroNameExitMs = CABO_REVEAL_OUTRO_NAME_EXIT_MS * scale;
    const outroBufferMs = CABO_REVEAL_OUTRO_BUFFER_MS * scale;
    let winnerCelebrationMs = CABO_REVEAL_WINNER_CELEBRATION_MS * scale;

    const totalWithoutExtraMs =
        openingTitleMs +
        (playerCount * perPlayerTotalMs) +
        outroNameExitMs +
        winnerCelebrationMs +
        outroBufferMs;
    if (availableMs > totalWithoutExtraMs) {
        winnerCelebrationMs += availableMs - totalWithoutExtraMs;
    }

    const openingEndMs = openingTitleMs;
    const playersEndMs = openingEndMs + (playerCount * perPlayerTotalMs);
    const outroNameExitEndMs = playersEndMs + outroNameExitMs;
    const winnerEndMs = outroNameExitEndMs + winnerCelebrationMs;
    const timelineEndMs = winnerEndMs + outroBufferMs;

    return {
        playerCount,
        openingEndMs,
        playersEndMs,
        outroNameExitEndMs,
        winnerEndMs,
        timelineEndMs,
        perPlayerTotalMs,
        playerNameAndCardsMs,
        playerCardRevealMs,
        playerPointsRevealMs,
        playerNameTransitionMs,
        playerCardFlipStepMs: HAND_SIZE > 0 ? playerCardRevealMs / HAND_SIZE : 0,
    };
}, [HAND_SIZE, caboRevealDurationSeconds, caboRevealPlayers.length]);

const caboRevealElapsedClampedMs = Math.max(
    0,
    Math.min(caboRevealElapsedMs, caboRevealTimeline.timelineEndMs),
);
const caboRevealIsOpeningStage = caboRevealElapsedClampedMs < caboRevealTimeline.openingEndMs;
const caboRevealIsPlayerStage =
    !caboRevealIsOpeningStage &&
    caboRevealElapsedClampedMs < caboRevealTimeline.playersEndMs &&
    caboRevealTimeline.playerCount > 0;
const caboRevealIsOutroNameExitStage =
    caboRevealTimeline.playerCount > 0 &&
    caboRevealElapsedClampedMs >= caboRevealTimeline.playersEndMs &&
    caboRevealElapsedClampedMs < caboRevealTimeline.outroNameExitEndMs;
const caboRevealIsWinnerStage =
    !caboRevealIsOpeningStage &&
    !caboRevealIsPlayerStage &&
    !caboRevealIsOutroNameExitStage;

const caboRevealPlayerStageElapsedMs = Math.max(
    0,
    caboRevealElapsedClampedMs - caboRevealTimeline.openingEndMs,
);
const caboRevealActivePlayerIndex = caboRevealIsPlayerStage
    ? Math.min(
        caboRevealTimeline.playerCount - 1,
        Math.floor(caboRevealPlayerStageElapsedMs / caboRevealTimeline.perPlayerTotalMs),
    )
    : Math.max(0, caboRevealTimeline.playerCount - 1);
const caboRevealActivePlayerElapsedMs = caboRevealIsPlayerStage
    ? caboRevealPlayerStageElapsedMs - (caboRevealActivePlayerIndex * caboRevealTimeline.perPlayerTotalMs)
    : caboRevealTimeline.perPlayerTotalMs;
const caboRevealActivePlayer = caboRevealPlayers[caboRevealActivePlayerIndex] ?? null;
const caboRevealPreviousPlayer =
    caboRevealIsPlayerStage && caboRevealActivePlayerIndex > 0
        ? caboRevealPlayers[caboRevealActivePlayerIndex - 1]
        : null;
const caboRevealNameTransitionActive =
    caboRevealIsPlayerStage &&
    caboRevealActivePlayerElapsedMs < caboRevealTimeline.playerNameTransitionMs;

const caboRevealCardRevealElapsedMs = Math.max(
    0,
    caboRevealActivePlayerElapsedMs - caboRevealTimeline.playerNameAndCardsMs,
);
const caboRevealVisibleCardCount = caboRevealIsPlayerStage && caboRevealTimeline.playerCardFlipStepMs > 0
    ? Math.max(
        0,
        Math.min(
            HAND_SIZE,
            caboRevealCardRevealElapsedMs > 0
                ? Math.floor(caboRevealCardRevealElapsedMs / caboRevealTimeline.playerCardFlipStepMs) + 1
                : 0,
        ),
    )
    : 0;
const caboRevealPointsStageElapsedMs = Math.max(
    0,
    caboRevealActivePlayerElapsedMs -
        (caboRevealTimeline.playerNameAndCardsMs + caboRevealTimeline.playerCardRevealMs),
);
const caboRevealPointsFadeProgress = caboRevealTimeline.playerPointsRevealMs > 0
    ? Math.max(0, Math.min(1, caboRevealPointsStageElapsedMs / caboRevealTimeline.playerPointsRevealMs))
    : 0;
const caboRevealPlaceholderFrame = 1 + (Math.floor(caboRevealElapsedClampedMs / 110) % 9);

useEffect(() => {
    const isWinnerStageActive = isCaboRevealPhase && caboRevealIsWinnerStage;
    if (!previousCaboRevealWinnerStageRef.current && isWinnerStageActive) {
        playSharedCaboSoundEffect("applause");
    }
    previousCaboRevealWinnerStageRef.current = isWinnerStageActive;
}, [isCaboRevealPhase, caboRevealIsWinnerStage]);

// #36/#42: show scoreboard modal
const handleShowScores = () => {
    setIsScoresOpen(true);
};

const submitRematchChoice = (decision: "CONTINUE" | "FRESH" | "NONE") => {
    if (!isAwaitingRematchDecision || !gameId || !token || isSubmittingRematchDecision || myRematchDecision !== null) {
        return;
    }

    setIsSubmittingRematchDecision(true);
    void apiService.postWithAuth<void>(
        `/games/${gameId}/rematch/decision`,
        { decision },
        token
    ).then(() => {
        setMyRematchDecision(decision);
    }).catch((error) => {
        console.error("Failed to submit rematch decision:", error);
    }).finally(() => {
        setIsSubmittingRematchDecision(false);
    });
};

useEffect(() => {
    if (!drawnCard && !isDrawingFromPile && !isDrawingFromDiscardPile) {
        setSelectedDrawSource(null);
        setHasChosenDrawSourceThisTurn(false);
    }
}, [drawnCard, isDrawingFromPile, isDrawingFromDiscardPile]);

useEffect(() => {
    if (!canDragSelectedTurnCard) {
        setIsDraggingTurnCard(false);
        setIsDraggingDiscardPileSwapCard(false);
        setDragOverOwnCardIndex(null);
        setIsDragOverDiscardPile(false);
    }
}, [canDragSelectedTurnCard]);

useEffect(() => {
    return () => {
        clearFlyingCardTimer();
        clearDiscardRevealTimer();
        clearAbilityPeekHideTimer();
        clearDiscardTopOverrideTimer();
        pendingRemoteDrawAnimationRef.current = null;
    };
}, []);

const centerTurnActionLabel = useMemo(() => {
    if (!showCenterTurnCountdown) {
        return "";
    }

    const suffix = `(${displayedTurnTimeLeft}s)`;
    if (isDrawingFromPile || isDrawingFromDiscardPile) {
        return `Preparing action ${suffix}`;
    }

    if (isAbilityPending) {
        if (isAbilityChoicePending) {
            if (gameStatus === "ability_peek_self") {
                return `Peek ability: PEEK or End Turn ${suffix}`;
            }
            if (gameStatus === "ability_peek_opponent") {
                return `Spy ability: SPY or End Turn ${suffix}`;
            }
            if (gameStatus === "ability_swap") {
                return `Swap ability: SWAP or End Turn ${suffix}`;
            }
            return `Ability: USE or End Turn ${suffix}`;
        }
        if (gameStatus === "ability_peek_self") {
            return `Peek ability: Choose 1 of your own cards! ${suffix}`;
        }
        if (gameStatus === "ability_peek_opponent") {
            return `Spy ability: Choose 1 opponent card! ${suffix}`;
        }
        if (gameStatus === "ability_swap") {
            if (abilitySelectedOwnCardIndex == null) {
                return `Swap ability: Choose 1 of your own cards! ${suffix}`;
            }
            return `Swap ability: Choose 1 opponent card! ${suffix}`;
        }
    }

    if (canSwapDrawnCardWithHand && selectedDrawSource === "draw_pile") {
        return `Swap with hand or discard ${suffix}`;
    }

    if (canSwapDrawnCardWithHand && selectedDrawSource === "discard_pile") {
        return `Swap with your hand ${suffix}`;
    }

    if (canSwapDrawnCardWithHand && selectedDrawSource === "unknown") {
        return `Resume turn: swap with hand or discard ${suffix}`;
    }

    return `Draw from Draw Pile or Discard Pile ${suffix}`;
}, [
    showCenterTurnCountdown,
    displayedTurnTimeLeft,
    isDrawingFromPile,
    isDrawingFromDiscardPile,
    isAbilityPending,
    isAbilityChoicePending,
    gameStatus,
    abilitySelectedOwnCardIndex,
    canSwapDrawnCardWithHand,
    selectedDrawSource,
]);

if (isIntroPhase) {
    return (
        <div className="cabo-background cabo-background-game">
            <div className="inline-music-controller-hidden" aria-hidden="true">
                <InlineMusicPlayer controlsDisabled />
            </div>
            <div className="game-intro-screen" role="status" aria-live="polite">
                <h1 className="game-intro-title">
                    <span className="game-intro-title-main">ROUND {introRoundNumber}</span>
                </h1>
                <div className="game-intro-player-grid" aria-label="Intro players">
                    {visibleIntroPlayers.map((player, index) => {
                        const revealStartedAtMs = INTRO_TITLE_DURATION_MS + (index * INTRO_PLAYER_REVEAL_INTERVAL_MS);
                        const elapsedSinceRevealMs = Math.max(0, introElapsedMs - revealStartedAtMs);
                        const waveFrameMax = getCharacterWavingFrameMax(playerCharacterById[player.userId]);
                        const waveFrame = Math.min(
                            waveFrameMax,
                            1 + Math.floor(elapsedSinceRevealMs / INTRO_WAVE_FRAME_DURATION_MS),
                        );
                        return (
                            <div key={player.userId} className="game-intro-player-card">
                                <div className="game-intro-player-avatar" aria-hidden="true">
                                    <CharacterAvatar
                                        characterId={playerCharacterById[player.userId]}
                                        primaryColorId={playerPrimaryColorById[player.userId]}
                                        variant="waving"
                                        frame={waveFrame}
                                        alt=""
                                        width={160}
                                        height={160}
                                        className="game-intro-player-avatar-image"
                                    />
                                </div>
                                <p className="game-intro-player-name" title={player.username}>
                                    {player.username}
                                </p>
                                <p className="game-intro-player-score">{player.scoreText}</p>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

if (isCaboRevealPhase) {
    const shouldShowSpecialFireworks =
        caboRevealIsPlayerStage &&
        caboRevealActivePlayer?.isSpecialWin === true &&
        caboRevealPointsFadeProgress > 0;

    return (
        <div className="cabo-background cabo-background-game">
            <div className="inline-music-controller-hidden" aria-hidden="true">
                <InlineMusicPlayer controlsDisabled />
            </div>
            <div className="game-cabo-reveal-screen" role="status" aria-live="polite">
                {caboRevealIsOpeningStage && (
                    <div className="game-cabo-reveal-opening">
                        <h2 className="game-cabo-reveal-opening-title">Game Concluded</h2>
                        <p className="game-cabo-reveal-opening-subtitle">
                            Let&apos;s reveal the cards and count the points.
                        </p>
                        <p className="game-cabo-reveal-opening-countdown">
                            {displayedCaboRevealCountdown}s
                        </p>
                    </div>
                )}

                {caboRevealIsPlayerStage && caboRevealActivePlayer && (
                    <div className="game-cabo-reveal-player-stage">
                        <div className="game-cabo-reveal-player-name-lane" aria-live="polite">
                            {caboRevealPreviousPlayer && caboRevealNameTransitionActive && (
                                <p
                                    key={`prev-${caboRevealActivePlayer.userId}`}
                                    className="game-cabo-reveal-player-name game-cabo-reveal-player-name-exit-right"
                                >
                                    {caboRevealPreviousPlayer.username}
                                </p>
                            )}
                            <p
                                key={`current-${caboRevealActivePlayer.userId}`}
                                className={`game-cabo-reveal-player-name${
                                    caboRevealNameTransitionActive
                                        ? " game-cabo-reveal-player-name-enter-left"
                                        : " game-cabo-reveal-player-name-stable"
                                }`}
                            >
                                {caboRevealActivePlayer.username}
                            </p>
                        </div>

                        <div className="game-cabo-reveal-player-main">
                            <div className="game-cabo-reveal-placeholder-avatar game-cabo-reveal-animation-slot" aria-hidden="true">
                                <CharacterAvatar
                                    characterId="char01"
                                    primaryColorId="color01"
                                    variant="waving"
                                    frame={caboRevealPlaceholderFrame}
                                    alt=""
                                    width={200}
                                    height={200}
                                    className="game-cabo-reveal-placeholder-avatar-image"
                                />
                            </div>
                            <div className="game-cabo-reveal-cards-block">
                                <div className="game-cabo-reveal-cards-row" aria-label={`${caboRevealActivePlayer.username} cards`}>
                                    {caboRevealActivePlayer.cards.map((card, index) => (
                                        <div key={`${caboRevealActivePlayer.userId}-card-${index}`} className="game-cabo-reveal-card-wrap">
                                            <CardComponent
                                                hidden={index >= caboRevealVisibleCardCount}
                                                value={card.value}
                                                size="large"
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div
                                className={`game-cabo-reveal-points${
                                    caboRevealPointsFadeProgress > 0 ? " game-cabo-reveal-points-visible" : ""
                                }`}
                                style={{ opacity: caboRevealPointsFadeProgress }}
                            >
                                <p className="game-cabo-reveal-points-row" aria-label="Round score equation">
                                    {caboRevealActivePlayer.cards.map((card, index) => {
                                        const parsedValue = toFiniteScore(card.value);
                                        const cardLabel = parsedValue == null ? "?" : String(Math.trunc(parsedValue));
                                        return (
                                            <span key={`${caboRevealActivePlayer.userId}-eq-${index}`} className="game-cabo-reveal-points-term">
                                                {cardLabel}
                                            </span>
                                        );
                                    })}
                                    <span className="game-cabo-reveal-points-result">
                                        = {caboRevealActivePlayer.roundScoreText}
                                    </span>
                                </p>
                                {shouldShowSpecialFireworks && (
                                    <>
                                        <div className="game-cabo-reveal-fireworks" aria-hidden="true" />
                                        <p className="game-cabo-reveal-special-text">Special win!</p>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {caboRevealIsOutroNameExitStage && caboRevealActivePlayer && (
                    <div className="game-cabo-reveal-outro-shift-stage">
                        <div className="game-cabo-reveal-player-name-lane">
                            <p className="game-cabo-reveal-player-name game-cabo-reveal-player-name-exit-right">
                                {caboRevealActivePlayer.username}
                            </p>
                        </div>
                        <div className="game-cabo-reveal-player-main">
                            <div className="game-cabo-reveal-placeholder-avatar game-cabo-reveal-animation-slot" aria-hidden="true">
                                <CharacterAvatar
                                    characterId="char01"
                                    primaryColorId="color01"
                                    variant="waving"
                                    frame={caboRevealPlaceholderFrame}
                                    alt=""
                                    width={200}
                                    height={200}
                                    className="game-cabo-reveal-placeholder-avatar-image"
                                />
                            </div>
                            <div className="game-cabo-reveal-cards-block">
                                <div className="game-cabo-reveal-cards-row game-cabo-reveal-cards-row-placeholder" aria-hidden="true">
                                    {caboRevealActivePlayer.cards.map((_, index) => (
                                        <div key={`${caboRevealActivePlayer.userId}-placeholder-${index}`} className="game-cabo-reveal-card-placeholder" />
                                    ))}
                                </div>
                            </div>
                            <div className="game-cabo-reveal-points game-cabo-reveal-points-placeholder" aria-hidden="true" />
                        </div>
                    </div>
                )}

                {caboRevealIsWinnerStage && (
                    <div className="game-cabo-reveal-winner-stage">
                        <p className="game-cabo-reveal-winner-kicker">Round Winner</p>
                        <h2 className="game-cabo-reveal-winner-name">
                            {caboRevealWinner?.winnerNamesLabel ?? "Waiting for result"}
                        </h2>
                        <div className="game-cabo-reveal-placeholder-avatar game-cabo-reveal-winner-animation" aria-hidden="true">
                            <CharacterAvatar
                                characterId="char01"
                                primaryColorId="color01"
                                variant="waving"
                                frame={caboRevealPlaceholderFrame}
                                alt=""
                                width={300}
                                height={300}
                                className="game-cabo-reveal-placeholder-avatar-image"
                            />
                        </div>
                        {caboRevealWinner?.winnerCards && caboRevealWinner.winnerCards.length > 0 && (
                            <div className="game-cabo-reveal-winner-cards-list" aria-label="Winning hand cards">
                                {caboRevealWinner.winnerCards.map((winner) => (
                                    <div key={`winner-cards-${winner.userId}`} className="game-cabo-reveal-winner-cards-block">
                                        {caboRevealWinner.tie && (
                                            <p className="game-cabo-reveal-winner-cards-name">{winner.username}</p>
                                        )}
                                        <div className="game-cabo-reveal-winner-cards-row">
                                            {winner.cards.map((card, index) => (
                                                <div key={`winner-card-${winner.userId}-${index}`} className="game-cabo-reveal-card-wrap">
                                                    <CardComponent
                                                        hidden={!Number.isFinite(Number(card.value))}
                                                        value={card.value}
                                                        size="medium"
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
                <div className="game-cabo-reveal-global-countdown">
                    {displayedCaboRevealCountdown}s
                </div>
            </div>
        </div>
    );
}

const playerListRows = tablePlayerIds.map((id) => {
          const fallbackLabel = selfUserId != null && id === selfUserId ? "You" : `Player ${id}`;
          const label = playerNamesById[id] ?? fallbackLabel;
          const isActive = !isPeekPhase && currentTurnUserId != null && currentTurnUserId === id;
          const isTimedOut = timedOutPlayerIds.includes(id);
          return {
              id,
              label,
              isActive,
              isTimedOut,
          };
      });

      const showResyncOverlay =
          !socketSynced &&
          gameStatus !== "initial_peek" &&
          gameStatus !== "intro" &&
          gameStatus !== "cabo_reveal" &&
          gameStatus !== "round_awaiting_rematch" &&
          gameStatus !== "round_ended";

      return (
          <div className="cabo-background cabo-background-game">
              <div className="game-overlay">
                  {!isRematchScreenPhase && (
                      <div className="game-layout-zones" aria-label="Game layout zones">
                          <section className="game-layout-zone game-layout-zone-top-left" aria-label="Players">
                              <div className="game-player-list" aria-label="Players in game">
                                  {playerListRows.map((player) => (
                                      <div
                                          key={player.id}
                                          className={`game-player-list-item${player.isActive ? " active" : ""}${player.isTimedOut ? " timedout" : ""}`}
                                      >
                                          <span>{player.label}</span>
                                          {player.isActive && showTurnCountdown && (
                                              <span className="game-player-list-timer">{displayedTurnTimeLeft}s</span>
                                          )}
                                      </div>
                                  ))}
                              </div>
                          </section>
                          <section className="game-layout-zone game-layout-zone-top-right" aria-label="Game actions">
                              <div className="top-right-buttons">
                                  <Button
                                      onClick={() => {
                                          if (typeof window !== "undefined") {
                                              const defaultX = Math.max(
                                                  HOW_TO_PLAY_PANEL_MARGIN,
                                                  window.innerWidth - HOW_TO_PLAY_PANEL_DEFAULT_WIDTH - HOW_TO_PLAY_PANEL_MARGIN,
                                              );
                                              setHowToPlayPanelPosition({
                                                  x: defaultX,
                                                  y: HOW_TO_PLAY_PANEL_DEFAULT_TOP,
                                              });
                                          }
                                          setIsHowToPlayOpen(true);
                                      }}
                                  >
                                      How to Play
                                  </Button>
                                  <Button onClick={() => void handleShowScores()}>Scores</Button>
                                  <Button
                                      type="primary"
                                      className={`game-call-cabo-btn${isCaboCalledGlobal ? " game-cabo-called-btn" : ""}`}
                                      disabled={!canCallCabo}
                                      loading={isCallingCabo}
                                      onClick={callCabo}
                                  >
                                      {isCaboCalledGlobal
                                          ? (isCaboForcedByTimeoutGlobal
                                              ? "Cabo Called (AFK/DC) - Final Round!"
                                              : "Cabo Called - Final Round!")
                                          : "Call Cabo"}
                                  </Button>
                              </div>
                          </section>
                          <section className="game-layout-zone game-layout-zone-bottom-left" aria-label="Chat">
                              <div className="game-chat-zone-card">
                                  <CaboChatPanel
                                      sessionId={lobbySessionId}
                                      token={token}
                                      userId={userId}
                                      cooldownSeconds={chatCooldownSeconds}
                                      variant="game"
                                      className="game-corner-chat-panel"
                                  />
                              </div>
                          </section>
                          <section className="game-layout-zone game-layout-zone-bottom-right" aria-label="Audio controls">
                              <div className="game-audio-zone-card">
                                  <InlineMusicPlayer variant="game" controlsDisabled={isIntroPhase || isRematchScreenPhase} />
                              </div>
                          </section>
                      </div>
                  )}

                  {showResyncOverlay && (
                      <div className="game-rematch-overlay" role="status" aria-live="polite">
                          <div className="game-rematch-card">
                              <h2 className="game-rematch-title">Resyncing</h2>
                              <p className="game-rematch-text">
                                  Please wait until the current player&apos;s turn is finished.
                              </p>
                          </div>
                      </div>
                  )}

                  {showAfkWarning && !isRematchScreenPhase && (
                      <div className="game-rematch-overlay" role="status" aria-live="polite">
                          <div className="game-rematch-card">
                              <h2 className="game-rematch-title">AFK Warning</h2>
                              <p className="game-rematch-text">
                                  Inactivity timeout in{" "}
                                  <span className="game-rematch-countdown">{displayedAfkRemainingSeconds}s</span>
                              </p>
                              <p className="game-rematch-subtext">
                                  Move your mouse, press a key, or return focus to avoid auto timeout.
                              </p>
                          </div>
                      </div>
                  )}

                  {isPeekPhase && (
                      <div className="peek-phase-overlay" aria-hidden="true">
                          <div className="peek-phase-indicator">
                              Memorize 2 cards!
                          </div>
                      </div>
                  )}

                  {/* #17: PeekTimer overlay */}
                  {isPeekPhase && (
                      <PeekTimer
                        duration={initialPeekDurationSeconds}
                      />
                  )}
                  {/* #36/#42: Scores*/}
                  <Scores
                    isOpen={isScoresOpen}
                    onClose={() => setIsScoresOpen(false)}
                    players={scoreModalPlayers}
                    selfUserId={selfUserId}
                    totalRounds={finalScoreTotalRounds}
                  />
                  {isHowToPlayOpen && (
                      <div
                          ref={howToPlayPanelRef}
                          className="game-how-to-play-panel"
                          style={{
                              left: `${Math.round(howToPlayPanelPosition?.x ?? 0)}px`,
                              top: `${Math.round(howToPlayPanelPosition?.y ?? 0)}px`,
                          }}
                          role="dialog"
                          aria-label="How to Play"
                      >
                          <div
                              className="game-how-to-play-panel-header"
                              onPointerDown={handleHowToPlayDragStart}
                              title="Drag to move"
                          >
                              <span className="game-how-to-play-panel-title">How to Play</span>
                              <Button
                                  type="primary"
                                  size="small"
                                  onClick={() => setIsHowToPlayOpen(false)}
                              >
                                  Close
                              </Button>
                          </div>
                          <div className="game-how-to-play-panel-body">
                              <p>Goal: finish with the lowest total score after all rounds.</p>
                              <p>Turn flow: draw a card, then either swap it with one of your cards or discard it.</p>
                              <p>Ability cards: 7/8 peek your own card, 9/10 spy an opponent card, 11/12 swap.</p>
                              <p>Call Cabo when you think your hand is low. Others get one final turn.</p>
                          </div>
                      </div>
                  )}
                  {/* #34: Final Score Screen */}
                  <FinalScoreScreen
                      isOpen={isRematchScreenPhase}
                      players={finalScores}
                      selfUserId={selfUserId}
                      chatSessionId={lobbySessionId}
                      chatToken={token}
                      chatUserId={userId}
                      chatCooldownSeconds={chatCooldownSeconds}
                      totalRounds={finalScoreTotalRounds}
                      rematchCountdownSeconds={displayedRematchCountdown}
                      myRematchDecision={myRematchDecision}
                      isSubmittingRematchDecision={isSubmittingRematchDecision}
                      onChooseRematch={submitRematchChoice}
                  />
                  {isRematchScreenPhase && (
                      <div className="inline-music-controller-hidden" aria-hidden="true">
                          <InlineMusicPlayer controlsDisabled />
                      </div>
                  )}
                  {!isRematchScreenPhase && (
                      <>
                          {/* #32A banner or visual cue that stays on screen for everyone once Cabo is called (e.g., "Final Round!") */}
                          {isCaboCalledGlobal && gameStatus !== "round_ended" && gameStatus !== "round_awaiting_rematch" &&  gameStatus !== "cabo_reveal" &&(
                              <div style={{
                                  position: "fixed",
                                  bottom: "auto",
                                  top: "25%",
                                  left: "50%",
                                  transform: "translateX(-50%)",
                                  zIndex: 500,
                                  backgroundColor: isCaboForcedByTimeoutGlobal
                                    ? "rgba(150, 50, 50, 0.88)"
                                    : "rgba(200, 80, 50, 0.88)",
                                  color: "white",
                                  padding: "10px 28px",
                                  borderRadius: "12px",
                                  fontWeight: "bold",
                                  fontSize: "18px",
                                  textAlign: "center",
                                  boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
                                  backdropFilter: "blur(6px)",
                                  border: "2px solid rgba(255,255,255,0.25)",
                                  pointerEvents: "none",
                                  whiteSpace: "nowrap",
                              }}>
                                  {isCaboForcedByTimeoutGlobal
                                    ? "Cabo called! Final Round!"
                                    : "Cabo Called! Final Round!"}
                              </div>
                          )}


                          {/* TOP CENTER */}
                          {seatAssignments.topOpponentId != null && (
                              <div className="top-cards opponent-seat-top">
                                  <div className="game-opponent-seat-cards game-opponent-seat-cards-top">
                                      {topSeatDisplayCards.map((card, displayIndex) => {
                                          const slotIndex =
                                              normalizeHandSlotIndex(card.position, HAND_SIZE) ??
                                              (HAND_SIZE - 1 - displayIndex);
                                          const highlightedForAbility =
                                              canInteractWithAbilityTargets && (
                                                  gameStatus === "ability_peek_opponent" ||
                                                  (gameStatus === "ability_swap" && abilitySelectedOwnCardIndex !== null)
                                              );
                                          const readableSpyOrientation = shouldUseReadableSpyOrientation(card.faceDown);
                                          return (
                                              <div
                                                  key={`top-${slotIndex}`}
                                                  ref={(element) => {
                                                      topSeatCardRefs.current[slotIndex] = element;
                                                  }}
                                                  className={`game-opponent-card-anchor${
                                                      readableSpyOrientation ? " game-opponent-card-anchor-readable" : ""
                                                  }`}
                                              >
                                                  <CardComponent
                                                      hidden={isPostRoundPhase ? false : card.faceDown}
                                                      value={card.value}
                                                      size="small"
                                                      // #28: highlight opponent cards during ability phase
                                                      onClick={() => {
                                                          if (canInteractWithAbilityTargets && seatAssignments.topOpponentId != null) {
                                                              handleAbilityOpponentCardClick(seatAssignments.topOpponentId, slotIndex);
                                                          }
                                                      }}
                                                      disabled={
                                                          !highlightedForAbility
                                                      }
                                                      style={buildOpponentCardStyle(highlightedForAbility)}
                                                  />
                                              </div>
                                          );
                                      })}
                                  </div>
                                  <div
                                      className={`game-opponent-seat-name${
                                          currentTurnUserId === seatAssignments.topOpponentId ? " active" : ""
                                      }`}
                                      title={playerNamesById[seatAssignments.topOpponentId] ?? `Player ${seatAssignments.topOpponentId}`}
                                  >
                                      {playerNamesById[seatAssignments.topOpponentId] ?? `Player ${seatAssignments.topOpponentId}`}
                                  </div>
                              </div>
                          )}

                  {/* LEFT SIDE */}
                  {seatAssignments.leftOpponentId != null && (
                      <div className="left-cards opponent-seat-left">
                          <div className="game-opponent-seat-cards game-opponent-seat-cards-left">
                              {leftSeatCards.map((card, index) => {
                                  const slotIndex = normalizeHandSlotIndex(card.position, HAND_SIZE) ?? index;
                                  const highlightedForAbility =
                                      canInteractWithAbilityTargets && (
                                          gameStatus === "ability_peek_opponent" ||
                                          (gameStatus === "ability_swap" && abilitySelectedOwnCardIndex !== null)
                                      );
                                  const readableSpyOrientation = shouldUseReadableSpyOrientation(card.faceDown);
                                  return (
                                      <div
                                          key={`left-${slotIndex}`}
                                          ref={(element) => {
                                              leftSeatCardRefs.current[slotIndex] = element;
                                          }}
                                          className={`game-opponent-card-anchor${
                                              readableSpyOrientation ? " game-opponent-card-anchor-readable" : ""
                                          }`}
                                      >
                                          <CardComponent
                                              hidden={isPostRoundPhase ? false : card.faceDown}
                                              value={card.value}
                                              size="small"
                                              // #28: highlight opponent cards during ability phase
                                              onClick={() => {
                                                  if (canInteractWithAbilityTargets && seatAssignments.leftOpponentId != null) {
                                                      handleAbilityOpponentCardClick(seatAssignments.leftOpponentId, slotIndex);
                                                  }
                                              }}
                                              disabled={
                                                  !highlightedForAbility
                                              }
                                              style={buildOpponentCardStyle(highlightedForAbility)}
                                          />
                                      </div>
                                  );
                              })}
                          </div>
                          <div
                              className={`game-opponent-seat-name${
                                  currentTurnUserId === seatAssignments.leftOpponentId ? " active" : ""
                              }`}
                              title={playerNamesById[seatAssignments.leftOpponentId] ?? `Player ${seatAssignments.leftOpponentId}`}
                          >
                              {playerNamesById[seatAssignments.leftOpponentId] ?? `Player ${seatAssignments.leftOpponentId}`}
                          </div>
                      </div>
                  )}

                  {/* RIGHT SIDE */}
                  {seatAssignments.rightOpponentId != null && (
                      <div className="right-cards opponent-seat-right">
                          <div className="game-opponent-seat-cards game-opponent-seat-cards-right">
                              {rightSeatCards.map((card, index) => {
                                  const slotIndex = normalizeHandSlotIndex(card.position, HAND_SIZE) ?? index;
                                  const highlightedForAbility =
                                      canInteractWithAbilityTargets && (
                                          gameStatus === "ability_peek_opponent" ||
                                          (gameStatus === "ability_swap" && abilitySelectedOwnCardIndex !== null)
                                      );
                                  const readableSpyOrientation = shouldUseReadableSpyOrientation(card.faceDown);
                                  return (
                                      <div
                                          key={`right-${slotIndex}`}
                                          ref={(element) => {
                                              rightSeatCardRefs.current[slotIndex] = element;
                                          }}
                                          className={`game-opponent-card-anchor${
                                              readableSpyOrientation ? " game-opponent-card-anchor-readable" : ""
                                          }`}
                                      >
                                          <CardComponent
                                              hidden={isPostRoundPhase ? false : card.faceDown}
                                              value={card.value}
                                              size="small"
                                              // #28: highlight opponent cards during ability phase
                                              onClick={() => {
                                                  if (canInteractWithAbilityTargets && seatAssignments.rightOpponentId != null) {
                                                      handleAbilityOpponentCardClick(seatAssignments.rightOpponentId, slotIndex);
                                                  }
                                              }}
                                              disabled={
                                                  !highlightedForAbility
                                              }
                                              style={buildOpponentCardStyle(highlightedForAbility)}
                                          />
                                      </div>
                                  );
                              })}
                          </div>
                          <div
                              className={`game-opponent-seat-name${
                                  currentTurnUserId === seatAssignments.rightOpponentId ? " active" : ""
                              }`}
                              title={playerNamesById[seatAssignments.rightOpponentId] ?? `Player ${seatAssignments.rightOpponentId}`}
                          >
                              {playerNamesById[seatAssignments.rightOpponentId] ?? `Player ${seatAssignments.rightOpponentId}`}
                          </div>
                      </div>
                  )}

                  {/* CENTER */}
                  <div className="center-area">
                      <div className="pile">
                          <div ref={drawPileCardRef} className="game-pile-card-anchor">
                              <CardComponent
                                  hidden={!showDrawPileAsRevealedCard}
                                  value={showDrawPileAsRevealedCard ? drawnCard?.value : undefined}
                                  abilityLabel={drawPileAbilityLabel}
                                  size="medium"
                                  onClick={drawFromPile}
                                  draggable={isDrawPileSelectedForTurnAction && canDragSelectedTurnCard}
                                  onDragStart={handleTurnCardDragStart}
                                  onDragEnd={handleTurnCardDragEnd}
                                  disabled={!drawPileCardInteractive}
                                  style={isDrawPileSelectedForTurnAction ? selectedPileCardStyle : shouldHighlightPileChoice ? {
                                      outline: "3px solid #34e27a",
                                      outlineOffset: "2px",
                                      boxShadow: "0 0 0 2px rgba(52, 226, 122, 0.3)",
                                  } : undefined}
                              />
                          </div>
                          <p>Draw Pile</p>
                      </div>

                      <div className="pile">
                          <div ref={discardPileCardRef} className="game-pile-card-anchor">
                              <CardComponent
                                  hidden={isDiscardPileTemporarilyHidden}
                                  value={visibleDiscardPileCard?.value}
                                  size="medium"
                                  onClick={() => {
                                      if (canDiscardDrawnCard) {
                                          discardDrawnCard();
                                          return;
                                      }
                                      if (canDrawFromDiscardPile) {
                                          drawFromDiscardPile();
                                      }
                                  }}
                                  draggable={canDrawFromDiscardPile || (isDiscardPileSelectedForTurnAction && canDragSelectedTurnCard)}
                                  onDragStart={handleDiscardPileCardDragStart}
                                  onDragEnd={handleTurnCardDragEnd}
                                  onDragOver={handleDiscardPileDragOver}
                                  onDragEnter={handleDiscardPileDragOver}
                                  onDragLeave={handleDiscardPileDragLeave}
                                  onDrop={handleDiscardPileDrop}
                                  disabled={!discardPileCardInteractive}
                                  style={isDiscardPileSelectedForTurnAction ? selectedPileCardStyle : isDragOverDiscardPile ? {
                                      outline: "3px dashed #ffb14a",
                                      outlineOffset: "2px",
                                      boxShadow: "0 0 0 2px rgba(255, 177, 74, 0.45), 0 0 18px rgba(255, 177, 74, 0.78)",
                                  } : shouldHighlightDiscardPileAsAction ? {
                                      outline: "3px solid #34e27a",
                                      outlineOffset: "2px",
                                      boxShadow: "0 0 0 2px rgba(52, 226, 122, 0.3)",
                                  } : undefined}
                              />
                          </div>
                          <p>Discard Pile</p>
                      </div>
                  </div>
                  {showCenterTurnCountdown && (
                      <div className="game-center-turn-timer">
                          <div className="game-turn-progress-track">
                                  <div
                                      className="game-turn-progress-fill"
                                      style={{
                                          width: `${turnProgressPercent}%`,
                                      }}
                                  />
                              </div>
                          <p className="game-turn-progress-label">{centerTurnActionLabel}</p>
                          {canShowAbilityChoiceButtons && (
                              <div className="game-turn-action-buttons">
                                  <Button
                                      type="default"
                                      className={`game-turn-action-btn game-turn-action-btn-use${
                                          isUseAbilitySelected ? " game-turn-action-btn-use-selected" : ""
                                      }`}
                                      disabled={isSkippingAbilityChoice || isSubmittingAbility}
                                      onClick={chooseUseAbility}
                                  >
                                      {abilityPhaseLabel === "Ability" ? "Use Ability" : abilityPhaseLabel}
                                  </Button>
                                  <Button
                                      type="default"
                                      className="game-turn-action-btn game-turn-action-btn-skip"
                                      disabled={isSkippingAbilityChoice || isSubmittingAbility || isUseAbilitySelected}
                                      loading={isSkippingAbilityChoice}
                                      onClick={skipAbilityChoice}
                                  >
                                      End Turn
                                  </Button>
                              </div>
                          )}
                      </div>
                  )}

                  {/* Bottom cards are only itneractable when its users turn*/}
                  <div className={`bottom-cards${isMyTurnUi ? " game-current-player-highlight" : ""}`}>
                      {[...Array(HAND_SIZE)].map((_, i) => {
                          const card = myHand[i];
                          const isSelectedForSwap = abilitySelectedOwnCardIndex === i;
                          const isSwapChoosingOwnCard =
                              gameStatus === "ability_swap" && abilitySelectedOwnCardIndex == null;
                          // #28: highlight own cards during ability phase
                          const canClickOwnCardForAbility =
                              canInteractWithAbilityTargets && (
                                  gameStatus === "ability_peek_self" ||
                                  isSwapChoosingOwnCard
                              );
                          const isHighlightedForAbility =
                              canClickOwnCardForAbility ||
                              (canInteractWithAbilityTargets && gameStatus === "ability_swap" && isSelectedForSwap);
                          const isPeekCardSelected = isPeekPhase && peekVisibleCards[i];
                          const isPeekCardSelectable =
                            isPeekPhase &&
                            !isSubmittingInitialPeek &&
                            !isPeekCardSelected &&
                            revealedPeekCount < 2;
                          const isSwapDropTarget =
                              (isDraggingTurnCard || isDraggingDiscardPileSwapCard) &&
                              (canSwapDrawnCardWithHand || canDrawFromDiscardPile) &&
                              dragOverOwnCardIndex === i;

                          const cardStyle: React.CSSProperties | undefined = isPeekPhase
                              ? (isPeekCardSelected ? {
                                  outline: "3px solid #e8a87c",
                                  outlineOffset: "2px",
                                  boxShadow: "0 0 0 2px rgba(232, 168, 124, 0.35)",
                              } : isPeekCardSelectable ? {
                                  outline: "3px dashed rgba(52, 226, 122, 0.95)",
                                  outlineOffset: "2px",
                                  boxShadow: "0 0 0 2px rgba(52, 226, 122, 0.3)",
                              } : {
                                  outline: "2px solid rgba(255, 255, 255, 0.75)",
                                  outlineOffset: "2px",
                              })
                              : isHighlightedForAbility ? {
                              outline: (gameStatus === "ability_swap" && isSelectedForSwap)
                                  ? "3px solid #e8a87c"   // orange = selected for swap
                                  : "3px solid #a8b87a",  // green = clickable
                              outlineOffset: "2px",
                          } : shouldHighlightOwnCardsForTurnSwap ? {
                              outline: "3px solid #34e27a",
                              outlineOffset: "2px",
                              boxShadow: "0 0 0 2px rgba(52, 226, 122, 0.25)",
                          } : undefined;
                          const finalCardStyle: React.CSSProperties | undefined = isSwapDropTarget ? {
                              ...(cardStyle ?? {}),
                              outline: "3px dashed #ffb14a",
                              outlineOffset: "2px",
                              boxShadow: "0 0 0 2px rgba(255, 177, 74, 0.48), 0 0 14px rgba(255, 177, 74, 0.72)",
                          } : cardStyle;

                          return (
                              <div
                                  key={i}
                                  ref={(element) => {
                                      ownHandCardRefs.current[i] = element;
                                  }}
                                  className="game-own-card-anchor"
                              >
                                  <CardComponent
                                    hidden={isPostRoundPhase ? false : !peekVisibleCards[i]}  // #16 selected cards are face-up locally
                                    value={card?.value}
                                    size="large"
                                    onClick={() => {
                                        if (isPeekPhase) {
                                            handlePeekCardClick(i);
                                            return;
                                        }

                                        if (canClickOwnCardForAbility) {
                                            handleAbilityOwnCardClick(i);
                                            return;
                                        }

                                        if (canSwapDrawnCardWithHand) {
                                            swapDrawnCardWithHand(i);
                                            return;
                                        }
                                    }}
                                    disabled={isPeekPhase
                                        ? (isSubmittingInitialPeek || isPeekCardSelected || (!isPeekCardSelected && revealedPeekCount >= 2))
                                        : !(canClickOwnCardForAbility || isHighlightedForAbility || canSwapDrawnCardWithHand)}
                                    onDragOver={(event) => handleOwnCardDragOver(event, i)}
                                    onDragEnter={(event) => handleOwnCardDragOver(event, i)}
                                    onDragLeave={() => handleOwnCardDragLeave(i)}
                                    onDrop={(event) => handleOwnCardDrop(event, i)}
                                    style={finalCardStyle}
                                  />
                              </div>
                          );
                      })}
                  </div>

                          {flyingCardAnimations.length > 0 && (
                              <div className="game-flying-card-layer" aria-hidden="true">
                                  {flyingCardAnimations.map((animation) => (
                                      <div
                                          key={animation.id}
                                          className={`game-flying-card${
                                              animation.fadeMode === "late"
                                                  ? " game-flying-card-late-fade"
                                                  : ""
                                          }`}
                                          style={{
                                              left: `${animation.startX}px`,
                                              top: `${animation.startY}px`,
                                              width: `${animation.width}px`,
                                              height: `${animation.height}px`,
                                              ["--fly-delta-x" as string]: `${animation.deltaX}px`,
                                              ["--fly-delta-y" as string]: `${animation.deltaY}px`,
                                          } as React.CSSProperties}
                                      >
                                          <CardComponent
                                              hidden={animation.hidden}
                                              value={animation.value}
                                              size="medium"
                                              style={{
                                                  width: "100%",
                                                  height: "100%",
                                                  pointerEvents: "none",
                                              }}
                                          />
                                      </div>
                                  ))}
                              </div>
                          )}
                      </>
                  )}

              </div>
          </div>
      );
  };

  export default Game;
