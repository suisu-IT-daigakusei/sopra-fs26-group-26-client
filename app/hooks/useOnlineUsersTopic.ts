import { useApi } from "@/hooks/useApi";
import useLocalStorage from "@/hooks/useLocalStorage";
import { User } from "@/types/user";
import { getStompBrokerUrl } from "@/utils/domain";
import { toPresenceKey } from "@/utils/presence";
import { Client, IMessage } from "@stomp/stompjs";
import { useEffect, useState } from "react";
import SockJS from "sockjs-client";

const ONLINE_USERS_REFRESH_MS = 6000; // REST fallback poll (used when websocket is down)

function isOnlineStatus(raw: unknown): boolean {
  const presence = toPresenceKey(raw);
  return presence === "online" || presence === "lobby" || presence === "playing" || presence === "spectating";
}

function parseOnlineUsersJson(body: string): User[] {
  const arr = JSON.parse(body) as unknown[];
  if (!Array.isArray(arr)) return [];
  return arr.map((row) => {
    const o = row as Record<string, unknown>;
    return {
      id: o.id != null ? String(o.id) : null,
      name: (o.name as string) ?? null,
      username: (o.username as string) ?? null,
      token: null,
      status: (o.status as string) ?? null,
      bio: (o.bio as string) ?? null,
      creationDate: o.creationDate != null ? String(o.creationDate) : null,
      gamesWon: (o.gamesWon as number) ?? null,
      roundsWon: (o.roundsWon as number) ?? null,
      roundsPlayed: (o.roundsPlayed as number) ?? null,
      rounds: (o.rounds as number) ?? null,
      roundCount: (o.roundCount as number) ?? null,
      gamesPlayed: (o.gamesPlayed as number) ?? null,
      games: (o.games as number) ?? null,
      averageScorePerRound: (o.averageScorePerRound as number) ?? null,
      overallRank: (o.overallRank as number) ?? null,
      profileCharacterId: (o.profileCharacterId as string) ?? null,
      preferredColorPriority: Array.isArray(o.preferredColorPriority)
        ? o.preferredColorPriority.map((entry) => String(entry))
        : null,
      menuBackgroundId: (o.menuBackgroundId as string) ?? null,
      gameBackgroundId: (o.gameBackgroundId as string) ?? null,
      primaryColorId: (o.primaryColorId as string) ?? null,
      appearanceMode: (o.appearanceMode as string) ?? null,
      musicVolume: (o.musicVolume as number) ?? null,
      soundEffectsVolume: (o.soundEffectsVolume as number) ?? null,
      musicBlacklist: Array.isArray(o.musicBlacklist)
        ? o.musicBlacklist.map((entry) => String(entry))
        : null,
    };
  });
}

/**
 * First load from existing GET /users; live updates from existing /topic/users/online.
 */
export function useOnlineUsersTopic(): User[] {
  const api = useApi();
  const { value: token } = useLocalStorage<string>("token", "");
  const [onlineUsers, setOnlineUsers] = useState<User[]>([]);

  useEffect(() => {
    let cancelled = false;
    let wsConnected = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const refreshFromRest = async () => {
      if (wsConnected) {
        return;
      }
      try {
        const all = await api.get<User[]>("/users");
        if (!cancelled) {
          setOnlineUsers(all.filter((u) => isOnlineStatus(u.status)));
        }
      } catch {
        if (!cancelled) {
          setOnlineUsers([]);
        }
      }
    };

    void refreshFromRest();
    const scheduleFallbackPoll = () => {
      if (cancelled) return;
      if (pollTimer) {
        clearTimeout(pollTimer);
      }
      pollTimer = setTimeout(async () => {
        await refreshFromRest();
        scheduleFallbackPoll();
      }, ONLINE_USERS_REFRESH_MS);
    };
    scheduleFallbackPoll();
    const t = token.trim();

    // use SockJS instead of raw WebSocket
    let client: Client | null = null;
    if (t) {
      client = new Client({
        webSocketFactory: () => new SockJS(getStompBrokerUrl()),
        connectHeaders: { Authorization: t },
        reconnectDelay: 5000,
        onConnect: () => {
          wsConnected = true;
          client?.subscribe("/topic/users/online", (msg: IMessage) => {
            if (cancelled) return;
            try {
              if (msg.body) setOnlineUsers(parseOnlineUsersJson(msg.body));
            } catch {}
          });
        },
        onStompError: () => {
          wsConnected = false;
        },
        onWebSocketClose: () => {
          wsConnected = false;
        },
        onWebSocketError: () => {
          wsConnected = false;
        },
      });
      client.activate();
    }

    /* -> uses raw Websocket
    const client = new Client({
      brokerURL: getStompBrokerUrl(),
      reconnectDelay: 5000,
      onConnect: () => {
        client.subscribe("/topic/users/online", (msg: IMessage) => {
          if (cancelled) return;
          try {
            if (msg.body) {
              setOnlineUsers(parseOnlineUsersJson(msg.body));
            }
          } catch {
          }
        });
      },
    });
    client.activate();
    */

    return () => {
      cancelled = true;
      wsConnected = false;
      if (pollTimer) {
        clearTimeout(pollTimer);
      }
      if (client) {
        void client.deactivate();
      }
    };
  }, [api, token]);

  return onlineUsers;
}
