"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

const CELEBRATION_FRAME_COUNT = 46;
const CELEBRATION_PLAYBACK_MS = 2_300;
const CELEBRATION_FRAME_DURATION_MS = CELEBRATION_PLAYBACK_MS / CELEBRATION_FRAME_COUNT;
const REDUCED_MOTION_FRAME = 19;

const CELEBRATION_FRAME_PATHS = Array.from(
  { length: CELEBRATION_FRAME_COUNT },
  (_, index) => `/celebration_${String(index + 1).padStart(2, "0")}.png`,
);

type CaboZeroComboCelebrationProps = {
  active: boolean;
  opacity: number;
};

type CelebrationFrameProps = {
  frame: number;
};

function usePrefersReducedMotion(): boolean | null {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean | null>(null);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(query.matches);

    updatePreference();
    query.addEventListener("change", updatePreference);
    return () => query.removeEventListener("change", updatePreference);
  }, []);

  return prefersReducedMotion;
}

function CelebrationFrame({ frame }: CelebrationFrameProps) {
  const frameSrc = CELEBRATION_FRAME_PATHS[frame - 1];

  return (
    <Image
      src={frameSrc}
      alt=""
      width={1920}
      height={1080}
      sizes="100vw"
      unoptimized
      draggable={false}
      className="game-cabo-reveal-zero-combo-celebration-image"
    />
  );
}

function AnimatedCelebrationFrames() {
  const [frame, setFrame] = useState(1);

  useEffect(() => {
    let animationFrameId: number | null = null;
    let currentFrame = 1;
    let nextFrameAtMs = window.performance.now() + CELEBRATION_FRAME_DURATION_MS;

    const advanceFrame = (nowMs: number) => {
      if (nowMs >= nextFrameAtMs && currentFrame < CELEBRATION_FRAME_COUNT) {
        currentFrame += 1;
        nextFrameAtMs += CELEBRATION_FRAME_DURATION_MS;
        setFrame(currentFrame);
      }

      if (currentFrame < CELEBRATION_FRAME_COUNT) {
        animationFrameId = window.requestAnimationFrame(advanceFrame);
      }
    };

    animationFrameId = window.requestAnimationFrame(advanceFrame);
    return () => {
      if (animationFrameId != null) {
        window.cancelAnimationFrame(animationFrameId);
      }
    };
  }, []);

  return <CelebrationFrame frame={frame} />;
}

export default function CaboZeroComboCelebration({
  active,
  opacity,
}: CaboZeroComboCelebrationProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const preloadedFramesRef = useRef<HTMLImageElement[]>([]);

  useEffect(() => {
    if (prefersReducedMotion == null) {
      return;
    }

    const pathsToPreload = prefersReducedMotion
      ? [CELEBRATION_FRAME_PATHS[REDUCED_MOTION_FRAME - 1]]
      : CELEBRATION_FRAME_PATHS;
    const images = pathsToPreload.map((src) => {
      const image = new window.Image();
      image.decoding = "async";
      image.fetchPriority = "low";
      image.src = src;
      return image;
    });

    preloadedFramesRef.current = images;
    return () => {
      preloadedFramesRef.current = [];
    };
  }, [prefersReducedMotion]);

  if (!active) {
    return null;
  }

  const safeOpacity = Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 1;

  return (
    <div
      className="game-cabo-reveal-zero-combo-celebration"
      style={{ opacity: safeOpacity }}
      aria-hidden="true"
    >
      {prefersReducedMotion !== false
        ? <CelebrationFrame frame={REDUCED_MOTION_FRAME} />
        : <AnimatedCelebrationFrames />}
    </div>
  );
}
