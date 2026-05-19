import { useApi } from "@/hooks/useApi";
import { useEffect, useState } from "react";

const MIN_CONNECTION_STATUS_POLL_MS = 60_000;

export function useApiConnectionStatus(
  userId: string,
  token: string,
  pollMs: number = MIN_CONNECTION_STATUS_POLL_MS,
): boolean {
  const api = useApi();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const authToken = String(token ?? "").trim();
    const normalizedUserId = String(userId ?? "").trim();
    const intervalMs = Math.max(
      MIN_CONNECTION_STATUS_POLL_MS,
      Number.isFinite(Number(pollMs)) ? Math.floor(Number(pollMs)) : MIN_CONNECTION_STATUS_POLL_MS,
    );

    if (!authToken || !normalizedUserId) {
      setConnected(false);
      return;
    }

    let active = true;
    let pollingInFlight = false;
    const checkConnection = async () => {
      if (pollingInFlight) {
        return;
      }
      pollingInFlight = true;
      try {
        await api.getWithAuth<unknown>(
          `/users/${encodeURIComponent(normalizedUserId)}`,
          authToken,
        );
        if (active) {
          setConnected(true);
        }
      } catch {
        if (active) {
          setConnected(false);
        }
      } finally {
        pollingInFlight = false;
      }
    };

    void checkConnection();
    const intervalId = window.setInterval(() => {
      void checkConnection();
    }, intervalMs);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [api, pollMs, token, userId]);

  return connected;
}
