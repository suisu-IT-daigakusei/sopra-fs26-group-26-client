"use client";

import { memo, useEffect, useState, type CSSProperties } from "react";

type TurnCountdownProps = {
  deadlineMs: number | null;
};

type TurnProgressProps = TurnCountdownProps & {
  durationMs: number;
};

function readRemainingSeconds(deadlineMs: number | null): number {
  if (deadlineMs == null) {
    return 0;
  }
  return Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000));
}

function useRemainingSeconds(deadlineMs: number | null): number {
  const [remainingSeconds, setRemainingSeconds] = useState(() => readRemainingSeconds(deadlineMs));

  useEffect(() => {
    const tick = () => {
      const next = readRemainingSeconds(deadlineMs);
      setRemainingSeconds((current) => (current === next ? current : next));
    };

    tick();
    if (deadlineMs == null) {
      return;
    }

    const intervalId = window.setInterval(tick, 250);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [deadlineMs]);

  return remainingSeconds;
}

export const GameTurnSeconds = memo(function GameTurnSeconds({
  deadlineMs,
}: TurnCountdownProps) {
  return <>{useRemainingSeconds(deadlineMs)}</>;
});

export const GameTurnProgress = memo(function GameTurnProgress({
  deadlineMs,
  durationMs,
}: TurnProgressProps) {
  const safeDurationMs = Math.max(1, durationMs);
  const remainingMs = deadlineMs == null ? 0 : Math.max(0, deadlineMs - Date.now());
  const startPercent = Math.max(0, Math.min(100, (remainingMs / safeDurationMs) * 100));
  const style = {
    "--game-turn-progress-start": `${startPercent}%`,
    animationDuration: `${remainingMs}ms`,
  } as CSSProperties;

  return (
    <div className="game-turn-progress-track">
      <div
        key={deadlineMs ?? "inactive"}
        className="game-turn-progress-fill"
        style={style}
      />
    </div>
  );
});
