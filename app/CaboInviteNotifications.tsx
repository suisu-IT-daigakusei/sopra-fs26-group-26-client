"use client";

import { useApi } from "@/hooks/useApi";
import useLocalStorage from "@/hooks/useLocalStorage";
import type { ApplicationError } from "@/types/error";
import type { User } from "@/types/user";
import { showTimedConfirmation } from "@/utils/timedConfirmation";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { Button, Space } from "antd";
import { useCallback, useEffect, useState } from "react";

type CaboInvitePending = {
  id: number;
  fromUsername: string;
};

function normalizePendingRows(raw: unknown): CaboInvitePending[] {
  if (!Array.isArray(raw)) return [];
  const out: CaboInvitePending[] = [];
  for (const row of raw) {
    const o = row as Record<string, unknown>;
    const rawId = o.id ?? o.inviteId;
    const id = typeof rawId === "number" ? rawId : Number(rawId);
    const fromUserId =
      typeof o.fromUserId === "number" ? o.fromUserId : Number(o.fromUserId);
    const fromUsername = o.fromUsername;
    if (!Number.isFinite(id) || !Number.isFinite(fromUserId)) continue;
    if (typeof fromUsername !== "string") continue;
    out.push({ id, fromUsername });
  }
  return out;
}

type InviteRespondBody = { waitingLobbySessionId?: string | null };
const INVITES_POLL_MS = 3000;

export default function CaboInviteNotifications() {
  const router = useRouter();
  const pathname = usePathname();
  const api = useApi();
  const { value: token } = useLocalStorage<string>("token", "");
  const { value: userId } = useLocalStorage<string>("userId", "");
  const [pending, setPending] = useState<CaboInvitePending[]>([]);
  const [responding, setResponding] = useState(false);

  const isAuthRoute =
    pathname === "/" || pathname === "/login";

  const loadPending = useCallback(async () => {
    const t = token.trim();
    const uid = String(userId).trim();
    if (isAuthRoute || !t || !uid) {
      setPending([]);
      return;
    }
    try {
      const list = await api.getWithAuth<unknown>(
        `/users/${encodeURIComponent(uid)}/invites`,
        t,
      );
      setPending(normalizePendingRows(list));
    } catch {
      setPending([]);
    }
  }, [api, token, userId, isAuthRoute]);

  useEffect(() => {
    const t = token.trim();
    const uid = String(userId).trim();
    if (isAuthRoute || !t || !uid || typeof window === "undefined") {
      setPending([]);
      return;
    }

    let active = true;
    const pollInvites = async () => {
      if (!active) {
        return;
      }
      await loadPending();
    };

    void pollInvites();
    const intervalId = window.setInterval(() => {
      void pollInvites();
    }, INVITES_POLL_MS);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [isAuthRoute, loadPending, token, userId]);

  const current = pending[0];
  const [requestAttentionFrame, setRequestAttentionFrame] = useState(1);
  useEffect(() => {
    if (!current) return;
    const interval = setInterval(() => {
      setRequestAttentionFrame((prev) => (prev >= 3 ? 1 : prev + 1));
    }, 400);
    return () => clearInterval(interval);
  }, [current]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const inviteActive = Boolean(!isAuthRoute && current);
    document.body.classList.toggle("cabo-invite-active", inviteActive);
    return () => {
      document.body.classList.remove("cabo-invite-active");
    };
  }, [current, isAuthRoute]);

  const confirmLobbySwitchIfNeeded = useCallback(async (): Promise<boolean> => {
    const t = token.trim();
    const uid = String(userId).trim();
    if (!t || !uid || typeof window === "undefined") {
      return true;
    }

    try {
      const me = await api.getWithAuth<User>(`/users/${encodeURIComponent(uid)}`, t);
      const status = String(me?.status ?? "").trim().toUpperCase();
      if (status !== "LOBBY") {
        return true;
      }
      return showTimedConfirmation({
        title: "You are already in a lobby. Accepting this invite will leave your current lobby. Continue?",
        timeoutSeconds: 10,
      });
    } catch {
      return true;
    }
  }, [api, token, userId]);

  const onDecision = async (decision: "ACCEPT" | "DECLINE") => {
    const t = token.trim();
    const uid = String(userId).trim();
    if (!t || !current || !uid) return;
    if (decision === "ACCEPT") {
      const confirmed = await confirmLobbySwitchIfNeeded();
      if (!confirmed) {
        return;
      }
    }
    setResponding(true);
    try {
      const body = await api.patchWithAuth<InviteRespondBody>(
        `/users/${encodeURIComponent(uid)}/invites/${current.id}`,
        { decision },
        t,
      );
      await loadPending();
      if (
        decision === "ACCEPT" &&
        body?.waitingLobbySessionId &&
        String(body.waitingLobbySessionId).length > 0
      ) {
        router.push(
          `/lobby/${encodeURIComponent(String(body.waitingLobbySessionId))}`,
        );
      }
    } catch (error: unknown) {
      const status = (error as ApplicationError)?.status;
      if (decision === "ACCEPT" && status === 409) {
        alert("Lobby full. This lobby already has 4 players.");
      } else if (decision === "ACCEPT" && status === 404) {
        alert("Lobby not found anymore.");
      }
    } finally {
      setResponding(false);
    }
  };

  if (isAuthRoute || !current) return null;

  return (
    <div className="cabo-invite-corner" role="status" aria-live="polite">
      <div className="cabo-invite-corner-main">
        <Image
          src={`/request_attention${requestAttentionFrame}.png`}
          alt="Cabo Guy"
          width={96}
          height={96}
          className="cabo-invite-corner-guy"
        />
        <p className="cabo-invite-corner-text">
          <strong>{current.fromUsername}</strong> has invited you to play Cabo!
        </p>
      </div>
      <div className="cabo-invite-corner-actions">
        <Space>
          <Button
            type="primary"
            loading={responding}
            onClick={() => void onDecision("ACCEPT")}
          >
            Accept
          </Button>
          <Button disabled={responding} onClick={() => void onDecision("DECLINE")}>
            Decline
          </Button>
        </Space>
      </div>
    </div>
  );
}
