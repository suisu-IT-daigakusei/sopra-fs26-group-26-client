"use client";

import { useEffect } from "react";
import useLocalStorage from "@/hooks/useLocalStorage";
import { getApiDomain } from "@/utils/domain";

const HEARTBEAT_MIN_INTERVAL_MS = 10000;

export default function DisconnectHandler() {
    const { value: token } = useLocalStorage<string>("token", "");

    useEffect(() => {
        const t = token.trim();
        if (!t) return;

        const isActiveTab = () => document.visibilityState === "visible" && document.hasFocus();
        let lastHeartbeatMs = 0;
        let heartbeatInFlight = false;
        let heartbeatController: AbortController | null = null;
        let heartbeatTimeoutId: number | null = null;

        const sendHeartbeat = (force: boolean = false) => {
            if (!force && !isActiveTab()) {
                return;
            }

            const now = Date.now();
            if (heartbeatInFlight || (!force && now - lastHeartbeatMs < HEARTBEAT_MIN_INTERVAL_MS)) {
                return;
            }

            heartbeatInFlight = true;
            lastHeartbeatMs = now;
            const controller = new AbortController();
            heartbeatController = controller;
            heartbeatTimeoutId = window.setTimeout(() => controller.abort(), 10000);
            void fetch(`${getApiDomain()}/heartbeat`, {
                    method: "POST",
                    headers: { Authorization: t },
                    signal: controller.signal,
                })
                .catch(() => {
                    // ignore errors; server might be temporarily unreachable
                })
                .finally(() => {
                    if (heartbeatTimeoutId != null) {
                        window.clearTimeout(heartbeatTimeoutId);
                        heartbeatTimeoutId = null;
                    }
                    if (heartbeatController === controller) {
                        heartbeatController = null;
                    }
                    heartbeatInFlight = false;
                });
        };

        const onActivity = () => {
            sendHeartbeat();
        };
        const onTabActive = () => {
            if (isActiveTab()) {
                sendHeartbeat(true);
            }
        };

        if (isActiveTab()) {
            sendHeartbeat(true);
        }

        window.addEventListener("pointerdown", onActivity, { passive: true });
        window.addEventListener("pointermove", onActivity, { passive: true });
        window.addEventListener("keydown", onActivity, { passive: true });
        window.addEventListener("wheel", onActivity, { passive: true });
        window.addEventListener("touchstart", onActivity, { passive: true });
        window.addEventListener("focus", onTabActive, { passive: true });
        document.addEventListener("visibilitychange", onTabActive);

        return () => {
            heartbeatController?.abort();
            if (heartbeatTimeoutId != null) {
                window.clearTimeout(heartbeatTimeoutId);
            }
            window.removeEventListener("pointerdown", onActivity);
            window.removeEventListener("pointermove", onActivity);
            window.removeEventListener("keydown", onActivity);
            window.removeEventListener("wheel", onActivity);
            window.removeEventListener("touchstart", onActivity);
            window.removeEventListener("focus", onTabActive);
            document.removeEventListener("visibilitychange", onTabActive);
        };
    }, [token]);

    return null;
}
