"use client";

import { useApi } from "@/hooks/useApi";
import type { ApplicationError } from "@/types/error";
import type { LobbyChatMessage } from "@/types/chat";
import {
  getChatMessageMaxLength,
  normalizeChatInputForDisplay,
  normalizeChatInputForTransport,
} from "@/utils/chat";
import { getPrimaryColorHex, normalizePrimaryColorId } from "@/utils/userSettings";
import { getApiDomain, getStompBrokerUrl } from "@/utils/domain";
import { Client, ReconnectionTimeMode, TickerStrategy } from "@stomp/stompjs";
import { SendOutlined } from "@ant-design/icons";
import { Button, Input } from "antd";
import SockJS from "sockjs-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type CaboChatPanelProps = {
  sessionId: string;
  token: string;
  userId: string | number;
  cooldownSeconds?: number;
  className?: string;
  variant?: "lobby" | "game";
  userPrimaryColorById?: Record<string, string>;
};

const QUICK_EMOTES: Array<{ token: string; label: string }> = [
  { token: ":)", label: "\uD83D\uDE42" },
  { token: "xD", label: "\uD83D\uDE04" },
  { token: ":(", label: "\uD83D\uDE41" },
  { token: ";)", label: "\uD83D\uDE09" },
  { token: ":P", label: "\uD83D\uDE1B" },
  { token: ":O", label: "\uD83D\uDE2E" },
  { token: "<3", label: "\u2764\uFE0F" },
  { token: ":thumbsup:", label: "\uD83D\uDC4D" },
  { token: ":thumbsdown:", label: "\uD83D\uDC4E" },
  { token: ":trophy:", label: "\uD83C\uDFC6" },
];

const CHAT_SESSION_NOT_FOUND_ERROR = "Chat session not found. Press Resync.";
const CHAT_SYNC_FAILED_ERROR = "Could not sync chat.";
const CHAT_SYNC_DELAYED_ERROR = "Chat syncing is delayed. Reconnecting...";

function isTransientSyncError(errorText: string): boolean {
  return errorText === CHAT_SYNC_FAILED_ERROR || errorText === CHAT_SYNC_DELAYED_ERROR;
}

function toNumericSequence(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toEpochMs(value: unknown): number {
  if (typeof value !== "string" || !value.trim()) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mergeMessages(existing: LobbyChatMessage[], incoming: LobbyChatMessage[]): LobbyChatMessage[] {
  const byKey = new Map<string, LobbyChatMessage>();

  const pushMessage = (message: LobbyChatMessage) => {
    const sequence = toNumericSequence(message.sequence);
    const sentAt = String(message.sentAt ?? "");
    const key = sequence > 0
      ? `seq:${sequence}`
      : `fallback:${String(message.userId ?? "")}:${sentAt}:${String(message.text ?? "")}`;
    byKey.set(key, message);
  };

  existing.forEach(pushMessage);
  incoming.forEach(pushMessage);

  return Array.from(byKey.values()).sort((a, b) => {
    const sequenceDiff = toNumericSequence(a.sequence) - toNumericSequence(b.sequence);
    if (sequenceDiff !== 0) {
      return sequenceDiff;
    }
    return toEpochMs(a.sentAt) - toEpochMs(b.sentAt);
  });
}

function areMessageListsEquivalent(a: LobbyChatMessage[], b: LobbyChatMessage[]): boolean {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (
      toNumericSequence(left?.sequence) !== toNumericSequence(right?.sequence) ||
      String(left?.userId ?? "") !== String(right?.userId ?? "") ||
      String(left?.username ?? "") !== String(right?.username ?? "") ||
      String(left?.text ?? "") !== String(right?.text ?? "") ||
      String(left?.sentAt ?? "") !== String(right?.sentAt ?? "")
    ) {
      return false;
    }
  }
  return true;
}

function clampCooldownSeconds(value: number): number {
  if (!Number.isFinite(value)) {
    return 3;
  }
  return Math.max(1, Math.min(60, Math.floor(value)));
}

function formatMessageClock(sentAt: string | null | undefined): string {
  const parsed = Date.parse(String(sentAt ?? ""));
  if (!Number.isFinite(parsed)) {
    return "--:--";
  }
  return new Date(parsed).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function CaboChatPanel({
  sessionId,
  token,
  userId,
  cooldownSeconds = 3,
  className = "",
  variant = "lobby",
  userPrimaryColorById,
}: CaboChatPanelProps) {
  const api = useApi();
  const normalizedSessionId = String(sessionId ?? "").trim();
  const normalizedToken = String(token ?? "").trim();
  const normalizedUserId = String(userId ?? "").trim();
  const messageMaxLength = getChatMessageMaxLength();
  const effectiveCooldownSeconds = clampCooldownSeconds(Number(cooldownSeconds));
  const [effectiveSessionId, setEffectiveSessionId] = useState(normalizedSessionId);
  const normalizedEffectiveSessionId = String(effectiveSessionId ?? "").trim();
  const isReady = normalizedEffectiveSessionId.length > 0 && normalizedToken.length > 0;

  const [messages, setMessages] = useState<LobbyChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [showEmotes, setShowEmotes] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isResyncing, setIsResyncing] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [error, setError] = useState("");
  const [cooldownUntilMs, setCooldownUntilMs] = useState(0);
  const [cooldownNowMs, setCooldownNowMs] = useState(Date.now());
  const chatWsReconnectDelayMsRef = useRef<number>(5000 + Math.floor(Math.random() * 4000));
  const historyFailureCountRef = useRef<number>(0);
  const messagesViewportRef = useRef<HTMLDivElement | null>(null);

  const clearTransientSyncError = useCallback(() => {
    setError((previous) => (isTransientSyncError(previous) ? "" : previous));
  }, []);

  const usernameColorHexByUserId = useMemo(() => {
    const entries = Object.entries(userPrimaryColorById ?? {});
    const next: Record<string, string> = {};
    for (const [rawUserId, rawColorId] of entries) {
      const normalizedUserId = String(rawUserId ?? "").trim();
      if (!normalizedUserId) {
        continue;
      }
      next[normalizedUserId] = getPrimaryColorHex(normalizePrimaryColorId(rawColorId));
    }
    return next;
  }, [userPrimaryColorById]);

  useEffect(() => {
    setEffectiveSessionId(normalizedSessionId);
    setDraft("");
    setMessages([]);
    setError("");
    setCooldownUntilMs(0);
    setWsConnected(false);
    historyFailureCountRef.current = 0;
  }, [normalizedSessionId]);

  useEffect(() => {
    if (cooldownUntilMs <= Date.now()) {
      return;
    }
    const intervalId = window.setInterval(() => {
      setCooldownNowMs(Date.now());
    }, 250);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [cooldownUntilMs]);

  const getSessionCandidates = useCallback((activeSession: string): string[] => {
    const normalizedActive = String(activeSession ?? "").trim();
    const candidates: string[] = [];
    const pushCandidate = (value: unknown) => {
      const normalized = String(value ?? "").trim();
      if (!normalized) {
        return;
      }
      if (candidates.includes(normalized)) {
        return;
      }
      candidates.push(normalized);
    };

    pushCandidate(normalizedActive);
    pushCandidate(normalizedSessionId);
    if (typeof window !== "undefined") {
      pushCandidate(window.localStorage.getItem("activeLobbySessionId"));
      pushCandidate(window.localStorage.getItem("activeSessionId"));
    }
    return candidates;
  }, [normalizedSessionId]);

  const fetchHistoryForSession = useCallback(async (targetSessionId: string) => {
    return api.getWithAuth<LobbyChatMessage[]>(
      `/lobbies/${encodeURIComponent(targetSessionId)}/chat/messages`,
      normalizedToken,
    );
  }, [api, normalizedToken]);

  const sendActivityHeartbeat = useCallback(() => {
    if (!normalizedToken) {
      return;
    }
    void fetch(`${getApiDomain()}/heartbeat`, {
      method: "POST",
      headers: { Authorization: normalizedToken },
    }).catch(() => {
      // best-effort only
    });
  }, [normalizedToken]);

  const fetchHistory = useCallback(async (showSpinner: boolean) => {
    if (!isReady) {
      return;
    }
    if (showSpinner) {
      setIsResyncing(true);
    }
    try {
      const history = await fetchHistoryForSession(normalizedEffectiveSessionId);
      setMessages((previous) => {
        const merged = mergeMessages(previous, Array.isArray(history) ? history : []);
        return areMessageListsEquivalent(previous, merged) ? previous : merged;
      });
      historyFailureCountRef.current = 0;
      clearTransientSyncError();
    } catch (fetchError) {
      const appError = fetchError as ApplicationError;
      const shouldTryRecovery = appError?.status === 403 || appError?.status === 404;
      if (shouldTryRecovery) {
        const sessionCandidates = getSessionCandidates(normalizedEffectiveSessionId);
        let recovered = false;
        for (const candidate of sessionCandidates) {
          if (candidate === normalizedEffectiveSessionId) {
            continue;
          }
          try {
            const history = await fetchHistoryForSession(candidate);
            setEffectiveSessionId(candidate);
            setMessages((previous) => {
              const merged = mergeMessages(previous, Array.isArray(history) ? history : []);
              return areMessageListsEquivalent(previous, merged) ? previous : merged;
            });
            historyFailureCountRef.current = 0;
            clearTransientSyncError();
            recovered = true;
            break;
          } catch {
            // try next candidate
          }
        }
        if (recovered) {
          return;
        }
      }
      if (appError?.status === 403 || appError?.status === 404) {
        setError(CHAT_SESSION_NOT_FOUND_ERROR);
      } else if (appError?.status === 429 || appError?.status >= 500 || appError?.status == null) {
        historyFailureCountRef.current += 1;
        if (showSpinner || historyFailureCountRef.current >= 2) {
          setError(CHAT_SYNC_DELAYED_ERROR);
        }
      } else {
        setError(CHAT_SYNC_FAILED_ERROR);
      }
    } finally {
      if (showSpinner) {
        setIsResyncing(false);
      }
    }
  }, [
    fetchHistoryForSession,
    getSessionCandidates,
    isReady,
    normalizedEffectiveSessionId,
    clearTransientSyncError,
  ]);

  useEffect(() => {
    if (!isReady) {
      return;
    }
    void fetchHistory(false);
  }, [fetchHistory, isReady]);

  useEffect(() => {
    if (!isReady || wsConnected) {
      return;
    }
    const pollHistory = () => {
      if (document.visibilityState === "visible") {
        void fetchHistory(false);
      }
    };
    const pollId = window.setInterval(() => {
      pollHistory();
    }, 20000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        pollHistory();
      }
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible, { passive: true });
    return () => {
      window.clearInterval(pollId);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
    };
  }, [fetchHistory, isReady, wsConnected]);

  useEffect(() => {
    if (!isReady) {
      return;
    }
    let active = true;
    const markDisconnected = () => {
      if (active) {
        setWsConnected(false);
      }
    };
    const wsClient = new Client({
      webSocketFactory: () => new SockJS(getStompBrokerUrl()),
      connectHeaders: { Authorization: normalizedToken },
      reconnectDelay: chatWsReconnectDelayMsRef.current,
      reconnectTimeMode: ReconnectionTimeMode.EXPONENTIAL,
      maxReconnectDelay: 30000,
      heartbeatIncoming: 20000,
      heartbeatOutgoing: 20000,
      heartbeatStrategy: TickerStrategy.Worker,
      onConnect: () => {
        if (!active) {
          return;
        }
        setWsConnected(true);
        historyFailureCountRef.current = 0;
        clearTransientSyncError();
        void fetchHistory(false);
        wsClient.subscribe(`/topic/lobby/session/${normalizedEffectiveSessionId}/chat`, (frame) => {
          if (!active) {
            return;
          }
          try {
            const payload = JSON.parse(String(frame.body ?? "{}")) as LobbyChatMessage;
            setMessages((previous) => {
              const merged = mergeMessages(previous, [payload]);
              return areMessageListsEquivalent(previous, merged) ? previous : merged;
            });
            historyFailureCountRef.current = 0;
            clearTransientSyncError();
          } catch {
            // ignore malformed frames
          }
        });
      },
      onStompError: markDisconnected,
      onWebSocketClose: markDisconnected,
      onWebSocketError: markDisconnected,
    });

    wsClient.activate();
    return () => {
      active = false;
      setWsConnected(false);
      void wsClient.deactivate();
    };
  }, [clearTransientSyncError, fetchHistory, isReady, normalizedEffectiveSessionId, normalizedToken]);

  useEffect(() => {
    if (!messagesViewportRef.current) {
      return;
    }
    messagesViewportRef.current.scrollTop = messagesViewportRef.current.scrollHeight;
  }, [messages]);

  const cooldownRemainingMs = Math.max(0, cooldownUntilMs - cooldownNowMs);
  const cooldownRemainingSeconds = Math.ceil(cooldownRemainingMs / 1000);
  const cooldownRatio = Math.max(
    0,
    Math.min(1, cooldownRemainingMs / (effectiveCooldownSeconds * 1000)),
  );
  const ringRadius = 8;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringDashOffset = ringCircumference * (1 - cooldownRatio);

  const trimmedDraft = draft.trim();
  const isCooldownActive = cooldownRemainingMs > 0;
  const canSend = isReady && !isSending && !isCooldownActive && trimmedDraft.length > 0;

  const handleDraftChange = (rawValue: string) => {
    const normalized = normalizeChatInputForTransport(rawValue);
    setDraft(normalized);
  };

  const insertEmote = (emoteToken: string) => {
    setDraft((previous) => normalizeChatInputForTransport(`${previous}${emoteToken}`));
  };

  const handleSend = useCallback(async () => {
    if (!canSend) {
      return;
    }
    const text = normalizeChatInputForTransport(trimmedDraft);
    sendActivityHeartbeat();
    setIsSending(true);
    setError("");
    try {
      const sent = await api.postWithAuth<LobbyChatMessage>(
        `/lobbies/${encodeURIComponent(normalizedEffectiveSessionId)}/chat/messages`,
        { message: text },
        normalizedToken,
      );
      setMessages((previous) => {
        const merged = mergeMessages(previous, [sent]);
        return areMessageListsEquivalent(previous, merged) ? previous : merged;
      });
      setDraft("");
      setCooldownUntilMs(Date.now() + (effectiveCooldownSeconds * 1000));
      setCooldownNowMs(Date.now());
    } catch (sendError) {
      const appError = sendError as ApplicationError;
      if (appError?.status === 429) {
        const errorText = String(appError.message ?? "");
        const remainingMatch = errorText.match(/(\d+)\s*s/i);
        const remainingSeconds = remainingMatch ? Number(remainingMatch[1]) : effectiveCooldownSeconds;
        setCooldownUntilMs(Date.now() + (Math.max(1, remainingSeconds) * 1000));
        setCooldownNowMs(Date.now());
        setError("Cooldown active.");
      } else if (appError?.status === 400) {
        setError("Message must be single-line ASCII and 1-50 chars.");
      } else if (appError?.status === 403 || appError?.status === 404) {
        const sessionCandidates = getSessionCandidates(normalizedEffectiveSessionId);
        for (const candidate of sessionCandidates) {
          if (candidate === normalizedEffectiveSessionId) {
            continue;
          }
          try {
            const retrySent = await api.postWithAuth<LobbyChatMessage>(
              `/lobbies/${encodeURIComponent(candidate)}/chat/messages`,
              { message: text },
              normalizedToken,
            );
            setEffectiveSessionId(candidate);
            setMessages((previous) => {
              const merged = mergeMessages(previous, [retrySent]);
              return areMessageListsEquivalent(previous, merged) ? previous : merged;
            });
            setDraft("");
            setCooldownUntilMs(Date.now() + (effectiveCooldownSeconds * 1000));
            setCooldownNowMs(Date.now());
            setError("");
            return;
          } catch {
            // try next fallback session
          }
        }
        setError(CHAT_SESSION_NOT_FOUND_ERROR);
      } else {
        setError("Could not send message.");
      }
    } finally {
      setIsSending(false);
    }
  }, [
    api,
    canSend,
    effectiveCooldownSeconds,
    getSessionCandidates,
    normalizedEffectiveSessionId,
    normalizedToken,
    sendActivityHeartbeat,
    trimmedDraft,
  ]);

  const messageRows = useMemo(() => (
    messages.map((message, index) => {
      const username = String(message.username ?? "Player").trim() || "Player";
      const text = normalizeChatInputForDisplay(String(message.text ?? ""));
      const ownMessage = normalizedUserId.length > 0 && String(message.userId ?? "") === normalizedUserId;
      const senderUserId = String(message.userId ?? "").trim();
      const senderUsernameColor = senderUserId ? usernameColorHexByUserId[senderUserId] : undefined;
      return (
        <div
          key={`chat-message-${String(message.sequence ?? "x")}-${index}`}
          className={`cabo-chat-message${ownMessage ? " cabo-chat-message-own" : ""}`}
        >
          <p className="cabo-chat-message-line">
            <span className="cabo-chat-message-meta">{formatMessageClock(message.sentAt)},</span>
            <span
              className="cabo-chat-message-username"
              style={senderUsernameColor ? { color: senderUsernameColor } : undefined}
            >
              {username}:
            </span>
            <span className="cabo-chat-message-text">{text}</span>
          </p>
        </div>
      );
    })
  ), [messages, normalizedUserId, usernameColorHexByUserId]);

  return (
    <div className={`cabo-chat-panel cabo-chat-panel-${variant} ${className}`.trim()}>
      <div ref={messagesViewportRef} className="cabo-chat-messages" role="log" aria-live="polite">
        {messageRows.length > 0 ? messageRows : (
          <p className="cabo-chat-empty">No messages yet.</p>
        )}
      </div>

      <div className="cabo-chat-controls">
        <div className="cabo-chat-compose-row">
          <div className="cabo-chat-input-row">
            <Input
              value={draft}
              maxLength={messageMaxLength}
              className="cabo-chat-input"
              placeholder="Type a message..."
              suffix={<span className="cabo-chat-counter">{draft.length}/{messageMaxLength}</span>}
              onChange={(event) => handleDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleSend();
                }
              }}
            />
          </div>
          <div className="cabo-chat-action-row">
            <Button
              type="text"
              size="small"
              className="cabo-chat-icon-btn cabo-chat-resync-icon-btn"
              disabled={!isReady || isResyncing}
              onClick={() => void fetchHistory(true)}
              title="Resync chat"
              aria-label="Resync chat"
            >
              <span className={isResyncing ? "cabo-chat-spinning" : ""}>{"\uD83D\uDDD8"}</span>
            </Button>
            <Button
              type="text"
              size="small"
              className="cabo-chat-icon-btn cabo-chat-emote-toggle-btn"
              onClick={() => setShowEmotes((previous) => !previous)}
              title="Emotes"
              aria-label="Toggle emotes"
            >
              {"\uD83D\uDE42"}
            </Button>
            <Button
              type="text"
              size="small"
              className="cabo-chat-send-btn"
              disabled={!canSend}
              loading={isSending}
              onClick={() => void handleSend()}
              title={isCooldownActive ? `Send (${cooldownRemainingSeconds}s)` : "Send message"}
              aria-label={isCooldownActive ? `Send on cooldown ${cooldownRemainingSeconds} seconds` : "Send message"}
            >
              <span className="cabo-chat-send-btn-inner">
                <SendOutlined className="cabo-chat-send-symbol" />
                {isCooldownActive && (
                  <span className="cabo-chat-send-cooldown-text">{cooldownRemainingSeconds}</span>
                )}
                {isCooldownActive && (
                  <svg
                    className="cabo-chat-send-cooldown-ring"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <circle
                      className="cabo-chat-send-cooldown-ring-track"
                      cx="12"
                      cy="12"
                      r={ringRadius}
                    />
                    <circle
                      className="cabo-chat-send-cooldown-ring-progress"
                      cx="12"
                      cy="12"
                      r={ringRadius}
                      strokeDasharray={ringCircumference}
                      strokeDashoffset={ringDashOffset}
                    />
                  </svg>
                )}
              </span>
            </Button>
          </div>
        </div>
        {showEmotes && (
          <div className="cabo-chat-emote-row">
            {QUICK_EMOTES.map((emote) => (
              <Button
                key={emote.token}
                type="default"
                size="small"
                className="cabo-chat-emote-btn"
                onClick={() => insertEmote(emote.token)}
                title={emote.token}
              >
                {emote.label}
              </Button>
            ))}
          </div>
        )}
        {error ? <p className="cabo-chat-error">{error}</p> : null}
      </div>
    </div>
  );
}
