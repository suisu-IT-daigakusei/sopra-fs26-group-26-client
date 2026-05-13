"use client";

import { useApi } from "@/hooks/useApi";
import useLocalStorage from "@/hooks/useLocalStorage";
import { Button, Space } from "antd";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type IncomingFriendRequest = {
  requesterUserId: number;
  requesterUsername: string;
};

const FRIEND_REQUESTS_POLL_MS = 4000;

function normalizePendingRequests(raw: unknown): IncomingFriendRequest[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: IncomingFriendRequest[] = [];
  for (const row of raw) {
    const request = row as Record<string, unknown>;
    const requesterUserIdRaw = request.requesterUserId;
    const requesterUsernameRaw = request.requesterUsername;
    const requesterUserId =
      typeof requesterUserIdRaw === "number" ? requesterUserIdRaw : Number(requesterUserIdRaw);
    if (!Number.isFinite(requesterUserId)) {
      continue;
    }
    if (typeof requesterUsernameRaw !== "string" || requesterUsernameRaw.trim().length === 0) {
      continue;
    }
    out.push({
      requesterUserId,
      requesterUsername: requesterUsernameRaw.trim(),
    });
  }
  return out;
}

export default function FriendRequestNotifications() {
  const pathname = usePathname();
  const api = useApi();
  const { value: token } = useLocalStorage<string>("token", "");
  const [pending, setPending] = useState<IncomingFriendRequest[]>([]);
  const [processing, setProcessing] = useState(false);
  const [caboGuyFrame, setCaboGuyFrame] = useState(1);

  const isAuthRoute =
    pathname === "/" || pathname === "/login" || pathname === "/register";

  const loadIncoming = useCallback(async () => {
    const authToken = token.trim();
    if (isAuthRoute || !authToken) {
      setPending([]);
      return;
    }
    try {
      const payload = await api.getWithAuth<unknown>(
        "/users/me/friends/requests/incoming",
        authToken,
      );
      setPending(normalizePendingRequests(payload));
    } catch {
      setPending([]);
    }
  }, [api, isAuthRoute, token]);

  useEffect(() => {
    const authToken = token.trim();
    if (isAuthRoute || !authToken || typeof window === "undefined") {
      setPending([]);
      return;
    }

    let active = true;
    const pollIncoming = async () => {
      if (!active) {
        return;
      }
      await loadIncoming();
    };

    void pollIncoming();
    const intervalId = window.setInterval(() => {
      void pollIncoming();
    }, FRIEND_REQUESTS_POLL_MS);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [isAuthRoute, loadIncoming, token]);

  const current = pending[0];

  useEffect(() => {
    if (!current) {
      return;
    }
    const interval = setInterval(() => {
      setCaboGuyFrame((prev) => (prev >= 3 ? 1 : prev + 1));
    }, 400);
    return () => clearInterval(interval);
  }, [current]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const requestActive = Boolean(!isAuthRoute && current);
    document.body.classList.toggle("cabo-friend-request-active", requestActive);
    return () => {
      document.body.classList.remove("cabo-friend-request-active");
    };
  }, [current, isAuthRoute]);

  const handleDecision = useCallback(
    async (decision: "ACCEPT" | "DECLINE") => {
      const authToken = token.trim();
      if (!authToken || !current) {
        return;
      }

      setProcessing(true);
      try {
        const requesterPathId = encodeURIComponent(String(current.requesterUserId));
        if (decision === "ACCEPT") {
          await api.postWithAuth<void>(
            `/users/me/friends/requests/${requesterPathId}/accept`,
            {},
            authToken,
          );
        } else {
          await api.deleteWithAuth<void>(
            `/users/me/friends/requests/${requesterPathId}`,
            authToken,
          );
        }
        await loadIncoming();
      } catch (error) {
        if (error instanceof Error) {
          alert(`Could not process friend request:\n${error.message}`);
        } else {
          alert("Could not process friend request.");
        }
      } finally {
        setProcessing(false);
      }
    },
    [api, current, loadIncoming, token],
  );

  if (isAuthRoute || !current) {
    return null;
  }

  return (
    <div className="cabo-friend-request-corner" role="status" aria-live="polite">
      <div className="cabo-friend-request-corner-main">
        <Image
          src={`/caboguy${caboGuyFrame}.png`}
          alt="Cabo Guy"
          width={96}
          height={96}
          className="cabo-friend-request-corner-guy"
        />
        <div className="cabo-friend-request-corner-copy">
          <p className="cabo-friend-request-corner-title">Friend Request</p>
          <p className="cabo-friend-request-corner-text">
            <strong>{current.requesterUsername}</strong> wants to add you as a friend.
          </p>
        </div>
      </div>
      <div className="cabo-friend-request-corner-actions">
        <Space>
          <Button
            type="primary"
            loading={processing}
            onClick={() => void handleDecision("ACCEPT")}
          >
            Accept
          </Button>
          <Button
            danger
            disabled={processing}
            onClick={() => void handleDecision("DECLINE")}
          >
            Decline
          </Button>
        </Space>
      </div>
    </div>
  );
}
