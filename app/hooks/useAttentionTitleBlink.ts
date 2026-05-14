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
    originalTitleRef.current = document.title;

    return;
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const resolveBlinkState = () => {
      if (!enabled) {
        originalTitleRef.current = document.title;
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
      // Do not force-set document.title here; page-level title manager controls the baseline title.
      originalTitleRef.current = document.title;
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
    };
  }, [alertTitle, enabled, intervalMs, shouldBlinkNow]);
}
