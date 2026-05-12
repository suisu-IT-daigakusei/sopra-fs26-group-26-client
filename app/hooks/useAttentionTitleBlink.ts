"use client";

import { useEffect, useRef, useState } from "react";

type UseAttentionTitleBlinkOptions = {
  enabled: boolean;
  alertTitle: string;
  intervalMs?: number;
  blinkWhenVisible?: boolean;
};

export function useAttentionTitleBlink({
  enabled,
  alertTitle,
  intervalMs = 850,
  blinkWhenVisible = false,
}: UseAttentionTitleBlinkOptions): void {
  const originalTitleRef = useRef<string>("");
  const [shouldBlinkNow, setShouldBlinkNow] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    if (!originalTitleRef.current) {
      originalTitleRef.current = document.title;
    }

    return () => {
      if (originalTitleRef.current) {
        document.title = originalTitleRef.current;
      }
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const resolveBlinkState = () => {
      if (!enabled) {
        setShouldBlinkNow(false);
        return;
      }

      if (blinkWhenVisible) {
        setShouldBlinkNow(true);
        return;
      }

      const hidden = document.visibilityState === "hidden";
      const unfocused = typeof document.hasFocus === "function" ? !document.hasFocus() : hidden;
      setShouldBlinkNow(hidden || unfocused);
    };

    resolveBlinkState();
    document.addEventListener("visibilitychange", resolveBlinkState);
    window.addEventListener("focus", resolveBlinkState);
    window.addEventListener("blur", resolveBlinkState);

    return () => {
      document.removeEventListener("visibilitychange", resolveBlinkState);
      window.removeEventListener("focus", resolveBlinkState);
      window.removeEventListener("blur", resolveBlinkState);
    };
  }, [blinkWhenVisible, enabled]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const originalTitle = originalTitleRef.current || document.title;
    if (!enabled || !shouldBlinkNow) {
      document.title = originalTitle;
      return;
    }

    let showAlertTitle = true;
    const tick = () => {
      document.title = showAlertTitle ? alertTitle : originalTitle;
      showAlertTitle = !showAlertTitle;
    };

    tick();
    const intervalId = window.setInterval(tick, Math.max(300, intervalMs));

    return () => {
      window.clearInterval(intervalId);
      document.title = originalTitle;
    };
  }, [alertTitle, enabled, intervalMs, shouldBlinkNow]);
}

