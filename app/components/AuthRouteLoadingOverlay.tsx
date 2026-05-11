"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AUTH_ROUTE_TRANSITION_UPDATED_EVENT,
  AuthRouteTransition,
  clearAuthRouteTransition,
  normalizeRoutePath,
  readAuthRouteTransition,
} from "./authRouteTransition";

type AuthLoaderStage = "hidden" | "loginOnce" | "generalIntro" | "generalLoop";

const LOGIN_FRAME_DURATION_MS = 120;
const GENERAL_INTRO_FRAME_DURATION_MS = 140;
const GENERAL_LOOP_FRAME_DURATION_MS = 110;
const AUTH_ROUTE_TRANSITION_FAILSAFE_MS = 30_000;

const LOGIN_FRAMES: string[] = [
  "/login_loading_01.png",
  "/login_loading_02.png",
  "/login_loading_03.png",
  "/login_loading_04.png",
  "/login_loading_05.png",
  "/login_loading_06.png",
  "/login_loading_07.png",
  "/login_loading_08.png",
  "/login_loading_09.png",
];

const GENERAL_INTRO_FRAMES: string[] = [
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

function preloadFrames(framePaths: string[]): void {
  for (const src of framePaths) {
    const image = new Image();
    image.src = src;
  }
}

export default function AuthRouteLoadingOverlay() {
  const pathname = usePathname();
  const [transition, setTransition] = useState<AuthRouteTransition | null>(null);
  const [stage, setStage] = useState<AuthLoaderStage>("hidden");
  const [loginFrameIndex, setLoginFrameIndex] = useState(0);
  const [generalIntroFrameIndex, setGeneralIntroFrameIndex] = useState(0);
  const [generalLoopFrameIndex, setGeneralLoopFrameIndex] = useState(0);

  const normalizedPath = useMemo(() => normalizeRoutePath(pathname), [pathname]);

  const transitionSatisfied = useMemo(() => {
    if (!transition) {
      return false;
    }
    if (normalizedPath === transition.targetPath) {
      return true;
    }
    return normalizedPath !== "/login" && normalizedPath !== "/register" && normalizedPath !== "/";
  }, [normalizedPath, transition]);

  const transitionKey = useMemo(() => {
    if (!transition) {
      return "";
    }
    return `${transition.targetPath}:${transition.startedAt}`;
  }, [transition]);

  const completeTransition = useCallback(() => {
    clearAuthRouteTransition();
    setTransition(null);
    setStage("hidden");
    setLoginFrameIndex(0);
    setGeneralIntroFrameIndex(0);
    setGeneralLoopFrameIndex(0);
  }, []);

  useEffect(() => {
    preloadFrames([...LOGIN_FRAMES, ...GENERAL_INTRO_FRAMES, ...GENERAL_LOOP_FRAMES]);

    const syncTransition = () => {
      setTransition((previous) => {
        const nextTransition = readAuthRouteTransition();
        if (!nextTransition) {
          return null;
        }
        if (
          previous
          && previous.startedAt === nextTransition.startedAt
          && previous.targetPath === nextTransition.targetPath
          && previous.source === nextTransition.source
        ) {
          return previous;
        }
        return nextTransition;
      });
    };

    syncTransition();
    window.addEventListener(AUTH_ROUTE_TRANSITION_UPDATED_EVENT, syncTransition);
    window.addEventListener("storage", syncTransition);

    return () => {
      window.removeEventListener(AUTH_ROUTE_TRANSITION_UPDATED_EVENT, syncTransition);
      window.removeEventListener("storage", syncTransition);
    };
  }, []);

  useEffect(() => {
    if (!transition) {
      setStage("hidden");
      setLoginFrameIndex(0);
      setGeneralIntroFrameIndex(0);
      setGeneralLoopFrameIndex(0);
      return;
    }

    setStage("loginOnce");
    setLoginFrameIndex(0);
    setGeneralIntroFrameIndex(0);
    setGeneralLoopFrameIndex(0);
  }, [transitionKey, transition]);

  useEffect(() => {
    if (!transition || stage === "hidden") {
      return;
    }

    const elapsedMs = Date.now() - transition.startedAt;
    const remainingMs = AUTH_ROUTE_TRANSITION_FAILSAFE_MS - elapsedMs;
    if (remainingMs <= 0) {
      completeTransition();
      return;
    }

    const timeoutId = window.setTimeout(() => {
      completeTransition();
    }, remainingMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [completeTransition, stage, transition]);

  useEffect(() => {
    if (!transition || stage === "hidden") {
      return;
    }

    if (stage === "loginOnce") {
      const isLastLoginFrame = loginFrameIndex >= LOGIN_FRAMES.length - 1;
      const timeoutId = window.setTimeout(() => {
        if (!isLastLoginFrame) {
          setLoginFrameIndex((current) => Math.min(current + 1, LOGIN_FRAMES.length - 1));
          return;
        }
        if (transitionSatisfied) {
          completeTransition();
          return;
        }
        setStage("generalIntro");
      }, LOGIN_FRAME_DURATION_MS);

      return () => {
        window.clearTimeout(timeoutId);
      };
    }

    if (stage === "generalIntro") {
      const isLastIntroFrame = generalIntroFrameIndex >= GENERAL_INTRO_FRAMES.length - 1;
      const timeoutId = window.setTimeout(() => {
        if (transitionSatisfied) {
          completeTransition();
          return;
        }

        if (!isLastIntroFrame) {
          setGeneralIntroFrameIndex((current) => Math.min(current + 1, GENERAL_INTRO_FRAMES.length - 1));
          return;
        }

        setStage("generalLoop");
      }, GENERAL_INTRO_FRAME_DURATION_MS);

      return () => {
        window.clearTimeout(timeoutId);
      };
    }

    if (transitionSatisfied) {
      completeTransition();
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setGeneralLoopFrameIndex((current) => (current + 1) % GENERAL_LOOP_FRAMES.length);
    }, GENERAL_LOOP_FRAME_DURATION_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    completeTransition,
    generalIntroFrameIndex,
    generalLoopFrameIndex,
    loginFrameIndex,
    stage,
    transition,
    transitionSatisfied,
  ]);

  const currentFrame = useMemo(() => {
    if (stage === "loginOnce") {
      return LOGIN_FRAMES[loginFrameIndex] ?? LOGIN_FRAMES[LOGIN_FRAMES.length - 1];
    }
    if (stage === "generalIntro") {
      return GENERAL_INTRO_FRAMES[generalIntroFrameIndex] ?? GENERAL_INTRO_FRAMES[GENERAL_INTRO_FRAMES.length - 1];
    }
    if (stage === "generalLoop") {
      return GENERAL_LOOP_FRAMES[generalLoopFrameIndex] ?? GENERAL_LOOP_FRAMES[0];
    }
    return null;
  }, [generalIntroFrameIndex, generalLoopFrameIndex, loginFrameIndex, stage]);

  if (!transition || stage === "hidden" || !currentFrame) {
    return null;
  }

  return (
    <div className="page-transition-loader-overlay auth-route-loader-overlay">
      <div className="auth-route-loader-content" role="status" aria-live="polite">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={currentFrame}
          alt="Loading"
          className="auth-route-loader-frame"
          draggable={false}
        />
      </div>
    </div>
  );
}
