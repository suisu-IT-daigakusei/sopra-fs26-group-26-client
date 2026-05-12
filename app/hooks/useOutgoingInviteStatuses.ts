import { useApi } from "@/hooks/useApi";
import { useCallback, useEffect, useRef, useState } from "react";

export type CaboInviteSentStatus = "PENDING" | "ACCEPTED" | "DECLINED";

export type CaboSentInviteEntry = {
  status: CaboInviteSentStatus;
  toUsername?: string;
};

const SENT_INVITES_POLL_MS = 3000;

type SentRow = {
  toUserId?: unknown;
  status?: unknown;
  toUsername?: unknown;
};

function normalizeStatus(v: unknown): CaboInviteSentStatus | null {
  const s = String(v ?? "").toUpperCase();
  if (s === "PENDING" || s === "ACCEPTED" || s === "DECLINED") return s;
  return null;
}

function rowsToEntries(rows: unknown): Record<string, CaboSentInviteEntry> {
  if (!Array.isArray(rows)) return {};
  const next: Record<string, CaboSentInviteEntry> = {};
  for (const row of rows) {
    const r = row as SentRow;
    const toId = typeof r.toUserId === "number" ? r.toUserId : Number(r.toUserId);
    const st = normalizeStatus(r.status);
    if (!Number.isFinite(toId) || !st) continue;
    const toUsername =
      typeof r.toUsername === "string" && r.toUsername.trim().length > 0
        ? r.toUsername.trim()
        : undefined;
    next[String(toId)] = { status: st, toUsername };
  }
  return next;
}

export function useOutgoingInviteStatuses(userId: string, token: string) {
  const api = useApi();
  const [sentEntries, setSentEntries] = useState<
    Record<string, CaboSentInviteEntry>
  >({});
  const hadCredentialsRef = useRef(false);

  const loadSent = useCallback(async () => {
    const t = token.trim();
    const uid = userId.trim();
    if (!t || !uid) {
      return;
    }
    try {
      const list = await api.getWithAuth<unknown>(
        `/users/${encodeURIComponent(uid)}/invites/sent`,
        t,
      );
      setSentEntries(rowsToEntries(list));
    } catch {
      setSentEntries({});
    }
  }, [api, token, userId]);

  useEffect(() => {
    const t = token.trim();
    const uid = userId.trim();
    if (!t || !uid) {
      if (hadCredentialsRef.current) {
        setSentEntries({});
      }
      return;
    }
    hadCredentialsRef.current = true;
    let active = true;
    const pollSent = async () => {
      if (!active) {
        return;
      }
      await loadSent();
    };

    void pollSent();
    const intervalId = window.setInterval(() => {
      void pollSent();
    }, SENT_INVITES_POLL_MS);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [loadSent, token, userId]);

  const markPending = useCallback((toUserId: number, toUsername?: string) => {
    const key = String(toUserId);
    setSentEntries((prev) => ({
      ...prev,
      [key]: {
        status: "PENDING",
        toUsername: toUsername ?? prev[key]?.toUsername,
      },
    }));
  }, []);

  return { sentEntries, loadSent, markPending };
}
