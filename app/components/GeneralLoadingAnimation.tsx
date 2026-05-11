"use client";

import { useEffect, useMemo, useState } from "react";

type GeneralLoadingAnimationProps = {
  className?: string;
  alt?: string;
};

const GENERAL_INTRO_FRAMES: string[] = [
  "/general_loading_00a.png",
  "/general_loading_00b.png",
];

const GENERAL_LOOP_FRAMES: string[] = [
  "/general_loading_01.png",
  "/general_loading_02.png",
  "/general_loading_03.png",
  "/general_loading_04.png",
  "/general_loading_05.png",
  "/general_loading_06.png",
  "/general_loading_07.png",
  "/general_loading_08.png",
];

const GENERAL_INTRO_FRAME_DURATION_MS = 140;
const GENERAL_LOOP_FRAME_DURATION_MS = 110;

function preloadFrames(framePaths: string[]): void {
  for (const src of framePaths) {
    const image = new Image();
    image.src = src;
  }
}

export default function GeneralLoadingAnimation({
  className,
  alt = "Loading",
}: GeneralLoadingAnimationProps) {
  const [stage, setStage] = useState<"intro" | "loop">("intro");
  const [introFrameIndex, setIntroFrameIndex] = useState(0);
  const [loopFrameIndex, setLoopFrameIndex] = useState(0);

  useEffect(() => {
    preloadFrames([...GENERAL_INTRO_FRAMES, ...GENERAL_LOOP_FRAMES]);
  }, []);

  useEffect(() => {
    if (stage === "intro") {
      const isLastIntroFrame = introFrameIndex >= GENERAL_INTRO_FRAMES.length - 1;
      const timeoutId = window.setTimeout(() => {
        if (!isLastIntroFrame) {
          setIntroFrameIndex((current) => Math.min(current + 1, GENERAL_INTRO_FRAMES.length - 1));
          return;
        }
        setStage("loop");
      }, GENERAL_INTRO_FRAME_DURATION_MS);

      return () => {
        window.clearTimeout(timeoutId);
      };
    }

    const timeoutId = window.setTimeout(() => {
      setLoopFrameIndex((current) => (current + 1) % GENERAL_LOOP_FRAMES.length);
    }, GENERAL_LOOP_FRAME_DURATION_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [introFrameIndex, loopFrameIndex, stage]);

  const currentFrame = useMemo(() => {
    if (stage === "intro") {
      return GENERAL_INTRO_FRAMES[introFrameIndex] ?? GENERAL_INTRO_FRAMES[GENERAL_INTRO_FRAMES.length - 1];
    }
    return GENERAL_LOOP_FRAMES[loopFrameIndex] ?? GENERAL_LOOP_FRAMES[0];
  }, [introFrameIndex, loopFrameIndex, stage]);

  return (
    <div className="general-loading-animation-content" role="status" aria-live="polite">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={currentFrame} alt={alt} className={className ?? "general-loading-animation-frame"} draggable={false} />
    </div>
  );
}
