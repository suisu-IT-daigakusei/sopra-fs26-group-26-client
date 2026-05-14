"use client"; //reworked page, too many changes to annotate

import React, { useCallback, useEffect, useState } from "react";
import { Button, Card, Input, Table } from "antd";
import type { TableProps } from "antd";
import { useRouter } from "next/navigation";
import { useApi } from "@/hooks/useApi";
import { useApiConnectionStatus } from "@/hooks/useApiConnectionStatus";
import useLocalStorage from "@/hooks/useLocalStorage";
import InlineMusicPlayer from "@/components/InlineMusicPlayer";
import type { ApplicationError } from "@/types/error";
import type { User } from "@/types/user";

type LobbyGetDTO = {
    sessionId?: string | null;
    playerIds?: Array<number | string> | null;
    currentPlayers?: number | null;
    isPublic?: boolean | null;
    sessionHostUserId?: number | string | null;
};

type OpenLobbyRow = {
    key: string;
    hostLabel: string;
    sessionId: string;
    currentPlayers: number;
    canJoin: boolean;
    isEmptyState?: boolean;
};

const OPEN_LOBBIES_POLL_MS = 4000; // refresh rate for lobby list, don't do too low or performance eater
const OPEN_LOBBIES_PAGE_SIZE = 10; // I wouldn't do more, or user has to scroll

// visual fake row when there are no open lobbies
const EMPTY_OPEN_LOBBY_ROW: OpenLobbyRow = {
    key: "__NO_OPEN_LOBBIES__",
    hostLabel: "",
    sessionId: "__NO_OPEN_LOBBIES__",
    currentPlayers: 0,
    canJoin: false,
    isEmptyState: true,
};

function extractLobbyList(raw: unknown): LobbyGetDTO[] {
    const rows = Array.isArray(raw) ? raw : [];
    return rows.map((item) => item as LobbyGetDTO);
}

function toOpenLobbyRows(
    raw: unknown,
    hostUsernamesById: Record<string, string> = {},
): OpenLobbyRow[] {
    const rows = extractLobbyList(raw);

    return rows
        .map((lobby) => {
            const sessionId = String(lobby?.sessionId ?? "").trim();
            const currentPlayersFromIds = Array.isArray(lobby?.playerIds)
                ? lobby.playerIds.length
                : undefined;
            const currentPlayers = Number(
                lobby?.currentPlayers ?? currentPlayersFromIds ?? 0,
            );
            const hostUserId = String(lobby?.sessionHostUserId ?? "").trim();
            const hostUsernameFromUsers = hostUserId ? String(hostUsernamesById[hostUserId] ?? "").trim() : "";
            return {
                sessionId,
                hostLabel:
                    hostUsernameFromUsers ||
                    (hostUserId ? `User ${hostUserId}` : "Host"),
                currentPlayers: Number.isFinite(currentPlayers) ? currentPlayers : 0,
                isPublic: lobby?.isPublic !== false,
            };
        })
        .filter((lobby) => lobby.sessionId.length > 0)
        .filter((lobby) => lobby.isPublic)
        .map(({ hostLabel, sessionId, currentPlayers }) => ({
            key: sessionId,
            hostLabel,
            sessionId,
            currentPlayers,
            canJoin: currentPlayers < 4,
        }))
        .sort((a, b) => a.sessionId.localeCompare(b.sessionId));
}

function toUsernameMap(users: User[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const user of users) {
        const id = String(user?.id ?? "").trim();
        const username = String(user?.username ?? "").trim();
        if (id && username) {
            out[id] = username;
        }
    }
    return out;
}

function extractHostIds(raw: unknown): string[] {
    const ids = new Set<string>();
    for (const lobby of extractLobbyList(raw)) {
        const hostId = String(lobby?.sessionHostUserId ?? "").trim();
        if (hostId) {
            ids.add(hostId);
        }
    }
    return Array.from(ids);
}

function hasMissingHostUsername(
    hostIds: string[],
    hostUsernamesById: Record<string, string>,
): boolean {
    return hostIds.some((id) => !String(hostUsernamesById[id] ?? "").trim());
}

const openLobbyColumns: TableProps<OpenLobbyRow>["columns"] = [
    {
        title: "Host",
        dataIndex: "hostLabel",
        key: "hostLabel",
        ellipsis: false,
        render: (value: string, row) => (
            <span className="users-username-cell" title={row.isEmptyState ? "" : value}>
                {row.isEmptyState ? "" : value}
            </span>
        ),
    },
    {
        title: "Lobby Code",
        dataIndex: "sessionId",
        key: "sessionId",
        ellipsis: true,
        render: (value: string, row) => (
            <span className="table-ellipsis-text" title={row.isEmptyState ? "" : value}>
                {row.isEmptyState ? "" : value}
            </span>
        ),
    },
    {
        title: "Players",
        dataIndex: "currentPlayers",
        key: "currentPlayers",
        align: "right",
        render: (value: number, row) => (row.isEmptyState ? "0/0" : `${value}/4`),
    },
    {
        title: "Status",
        key: "status",
        align: "right",
        render: (_, row) =>
            row.isEmptyState ? (
                <span className="table-ellipsis-text" title="No Open Lobbies">No Open Lobbies</span>
            ) : (
                <span
                    className={`users-status-pill ${row.canJoin ? "users-status-online" : "users-status-offline"}`}
                >
                    {row.canJoin ? "Open" : "Full"}
                </span>
            ),
    },
];

const LobbyJoin = () => {
    const router = useRouter();
    const api = useApi();
    const { value: token } = useLocalStorage<string>("token", "");
    const { value: userId } = useLocalStorage<string>("userId", "");

    const [code, setCode] = useState("");
    const [loadingCode, setLoadingCode] = useState(false);
    const [openLobbies, setOpenLobbies] = useState<OpenLobbyRow[]>([]);
    const [loadingOpenLobbies, setLoadingOpenLobbies] = useState(false);
    const [joiningSessionId, setJoiningSessionId] = useState<string>("");
    const [selectedOpenLobbySessionId, setSelectedOpenLobbySessionId] = useState<string>("");
    const [hostUsernamesById, setHostUsernamesById] = useState<Record<string, string>>({});

    const authToken = token.trim();
    const normalizedUserId = String(userId).trim();
    const liveConnected = useApiConnectionStatus(normalizedUserId, authToken);

    const loadOpenLobbies = useCallback(async () => {
        if (!authToken) {
            setOpenLobbies([EMPTY_OPEN_LOBBY_ROW]);
            return;
        }
        setLoadingOpenLobbies(true);
        try {
            const response = await api.getWithAuth<unknown>("/lobbies", authToken);
            const hostIds = extractHostIds(response);
            let nextHostUsernamesById = hostUsernamesById;
            if (hostIds.length > 0 && hasMissingHostUsername(hostIds, hostUsernamesById)) {
                try {
                    const users = await api.get<User[]>("/users");
                    const fetchedMap = toUsernameMap(users);
                    nextHostUsernamesById = { ...hostUsernamesById, ...fetchedMap };
                    setHostUsernamesById(nextHostUsernamesById);
                } catch {
                    // keep fallback host labels when user lookup is unavailable
                }
            }
            const rows = toOpenLobbyRows(response, nextHostUsernamesById);
            setOpenLobbies(rows.length > 0 ? rows : [EMPTY_OPEN_LOBBY_ROW]);
        } catch {
            setOpenLobbies([EMPTY_OPEN_LOBBY_ROW]);
        } finally {
            setLoadingOpenLobbies(false);
        }
    }, [api, authToken, hostUsernamesById]);

    useEffect(() => {
        void loadOpenLobbies();
        const pollId = setInterval(() => {
            void loadOpenLobbies();
        }, OPEN_LOBBIES_POLL_MS);
        return () => clearInterval(pollId);
    }, [loadOpenLobbies]);

    const handleBack = () => {
        if (typeof window !== "undefined" && window.history.length > 1) {
            router.back();
            return;
        }
        router.push("/dashboard");
    };

    const confirmLobbySwitchIfNeeded = useCallback(async (targetSessionId: string): Promise<boolean> => {
        if (!authToken || !normalizedUserId || typeof window === "undefined") {
            return true;
        }

        try {
            const me = await api.getWithAuth<User>(
                `/users/${encodeURIComponent(normalizedUserId)}`,
                authToken,
            );
            const status = String(me?.status ?? "").trim().toUpperCase();
            if (status !== "LOBBY") {
                return true;
            }

            // Avoid prompting if user is simply re-entering their own waiting lobby.
            try {
                const mine = await api.getWithAuth<LobbyGetDTO>("/lobbies/my/waiting", authToken);
                const mineSessionId = String(mine?.sessionId ?? "").trim().toUpperCase();
                const target = String(targetSessionId ?? "").trim().toUpperCase();
                if (mineSessionId && target && mineSessionId === target) {
                    return true;
                }
            } catch {
                // User is likely not host; keep generic confirmation.
            }

            return window.confirm(
                "You are already in a lobby. Joining another lobby will leave your current lobby. Continue?",
            );
        } catch {
            // If we cannot determine status, do not block join flow.
            return true;
        }
    }, [api, authToken, normalizedUserId]);

    const handleJoinLobby = async (
        sessionId: string,
        loadingSetter?: (loading: boolean) => void,
    ) => {
        if (!sessionId.trim() || !authToken) return;
        const confirmed = await confirmLobbySwitchIfNeeded(sessionId.trim());
        if (!confirmed) {
            return;
        }
        loadingSetter?.(true);
        setJoiningSessionId(sessionId);
        try {
            await api.postWithAuth(
                `/lobbies/${encodeURIComponent(sessionId.trim())}/players`,
                {},
                authToken,
            );
            router.push(`/lobby/${encodeURIComponent(sessionId.trim())}`);
        } catch (error) {
            const status = (error as ApplicationError)?.status;
            const message = error instanceof Error ? error.message : "";
            if (status === 404) {
                alert("Lobby not found. No lobby exists with this code. Please check and try again.");
            } else if (status === 403) {
                alert("You were kicked from this lobby. You can only rejoin if the host invites you again.");
            } else if (status === 409) {
                if (message.includes("Already in lobby")) {
                    router.push(`/lobby/${encodeURIComponent(sessionId.trim())}`);
                } else {
                    alert("Lobby full. This lobby already has 4 players. Please try another lobby.");
                }
            } else {
                alert("Could not join lobby. Something went wrong. Please try again.");
            }
        } finally {
            loadingSetter?.(false);
            setJoiningSessionId("");
            void loadOpenLobbies();
        }
    };

    const selectedOpenLobby =
        openLobbies.find((lobby) => lobby.sessionId === selectedOpenLobbySessionId) ?? null;
    const canJoinSelectedLobby =
        Boolean(selectedOpenLobby) &&
        !Boolean(selectedOpenLobby?.isEmptyState) &&
        Boolean(selectedOpenLobby?.canJoin) &&
        !Boolean(joiningSessionId);

    const handleJoinSelectedLobby = async () => {
        if (!selectedOpenLobby || !canJoinSelectedLobby) {
            return;
        }
        await handleJoinLobby(selectedOpenLobby.sessionId);
    };

    const handleSpectateSelectedLobby = () => {
        if (!selectedOpenLobby || selectedOpenLobby.isEmptyState) {
            return;
        }
        router.push(`/spectator?sessionId=${encodeURIComponent(selectedOpenLobby.sessionId)}`);
    };

    // join via code eingabe
    const handleJoinByCode = async () => {
        if (!code.trim()) return;
        await handleJoinLobby(code.trim(), setLoadingCode);
    };

    useEffect(() => {
        if (!selectedOpenLobbySessionId) {
            return;
        }
        const stillExists = openLobbies.some(
            (lobby) => lobby.sessionId === selectedOpenLobbySessionId,
        );
        if (!stillExists) {
            setSelectedOpenLobbySessionId("");
        }
    }, [openLobbies, selectedOpenLobbySessionId]);

    useEffect(() => {
        if (!selectedOpenLobbySessionId && openLobbies.length > 0) {
            setSelectedOpenLobbySessionId(openLobbies[0].sessionId);
        }
    }, [openLobbies, selectedOpenLobbySessionId]);

    return (
        <div className="cabo-background">
            <div className="login-container">
                <div className="create-lobby-stack">

                    {/* JOIN VIA CODE */}
                    <Card
                        title={
                            <div className="join-card-title-left">
                                Join a Private Game via a Lobby Code
                            </div>
                        }
                        className="dashboard-container"
                    >
                        <div className="create-lobby-actions">
                            <Input
                                placeholder="Enter game code here"
                                value={code}
                                onChange={(e) => setCode(e.target.value.toUpperCase())}
                                onPressEnter={() => void handleJoinByCode()}
                                style={{ marginBottom: 12 }}
                            />
                            <div className="join-by-code-actions-row">
                                <Button
                                    type="primary"
                                    loading={loadingCode}
                                    onClick={() => void handleJoinByCode()}
                                    disabled={!code.trim()}
                                >
                                    Join as a Player
                                </Button>
                                <Button
                                    type="default"
                                    disabled={!code.trim()}
                                    onClick={() => router.push(`/spectator?sessionId=${code.trim()}`)}
                                >
                                    Join as a Spectator
                                </Button>
                            </div>
                        </div>
                    </Card>

                    {/* JOIN OPEN LOBBIES */}
                    <Card
                        title={
                            <div className="lobby-section-title-row">
                                <span className="join-card-title-left">Join an Open Game Lobby</span>
                                <span
                                    className={`live-connection-symbol ${liveConnected ? "connected" : "disconnected"}`}
                                    title={liveConnected ? "Connected" : "Disconnected"}
                                >
                                    <span className="connection-symbol-dot" aria-hidden="true">{"\u25CF"}</span>
                                </span>
                            </div>
                        }
                        className="dashboard-container"
                    >
                        <Table<OpenLobbyRow>
                            className="users-overview-table responsive-list-table open-lobbies-table"
                            loading={loadingOpenLobbies}
                            columns={openLobbyColumns}
                            dataSource={openLobbies}
                            rowKey="sessionId"
                            size="small"
                            tableLayout="fixed"
                            pagination={{
                                pageSize: OPEN_LOBBIES_PAGE_SIZE,
                                showSizeChanger: false,
                                hideOnSinglePage: false,
                                responsive: true,
                                position: ["bottomCenter"],
                            }}
                            rowSelection={{
                                type: "radio",
                                selectedRowKeys: selectedOpenLobbySessionId
                                    ? [selectedOpenLobbySessionId]
                                    : [],
                                onChange: (selectedKeys) => {
                                    const key = String(selectedKeys[0] ?? "");
                                    setSelectedOpenLobbySessionId(key);
                                },
                            }}
                            locale={{
                                emptyText: "No open lobbies available right now.",
                            }}
                        />
                        <div className="join-by-code-actions-row">
                            <Button
                                type="primary"
                                disabled={!canJoinSelectedLobby}
                                loading={selectedOpenLobby ? joiningSessionId === selectedOpenLobby.sessionId : false}
                                onClick={() => void handleJoinSelectedLobby()}
                            >
                                Join as Player
                            </Button>
                            <Button
                                type="default"
                                disabled={!selectedOpenLobby || Boolean(selectedOpenLobby?.isEmptyState) || Boolean(joiningSessionId)}
                                onClick={handleSpectateSelectedLobby}
                            >
                                Join as Spectator
                            </Button>
                        </div>
                    </Card>
                    
                    <Card className="dashboard-container">
                        <div className="create-lobby-actions">
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

export default LobbyJoin;
