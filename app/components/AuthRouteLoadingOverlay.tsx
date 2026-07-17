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
import {
  GENERAL_LOADING_INTRO_FRAMES,
  GENERAL_LOADING_LOOP_FRAMES,
  LOGIN_LOADING_FRAMES,
  preloadAuthRouteGeneralLoadingFrames,
  preloadAuthRouteLoadingFrames,
} from "./authRouteLoadingFrames";

type AuthLoaderStage = "hidden" | "loginOnce" | "generalIntro" | "generalLoop";

const LOGIN_FRAME_DURATION_MS = 120;
const GENERAL_INTRO_FRAME_DURATION_MS = 140;
const GENERAL_LOOP_FRAME_DURATION_MS = 110;
const AUTH_ROUTE_TRANSITION_FAILSAFE_MS = 30_000;

export default function AuthRouteLoadingOverlay() {
  const pathname = usePathname();
  const [transition, setTransition] = useState<AuthRouteTransition | null>(null);
  const [stage, setStage] = useState<AuthLoaderStage>("hidden");
  const [loginFrameIndex, setLoginFrameIndex] = useState(0);
  const [generalIntroFrameIndex, setGeneralIntroFrameIndex] = useState(0);
  const [generalLoopFrameIndex, setGeneralLoopFrameIndex] = useState(0);
  const [loginFramesReady, setLoginFramesReady] = useState(false);

  const normalizedPath = useMemo(() => normalizeRoutePath(pathname), [pathname]);

  const transitionSatisfied = useMemo(() => {
    if (!transition) {
      return false;
    }
    if (normalizedPath === transition.targetPath) {
      return true;
    }
    return normalizedPath !== "/login" && normalizedPath !== "/";
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
      setLoginFramesReady(false);
      return;
    }

    let active = true;
    setLoginFramesReady(false);
    void preloadAuthRouteLoadingFrames().then(() => {
      if (active) {
        setLoginFramesReady(true);
      }
    });
    return () => {
      active = false;
    };
  }, [transitionKey, transition]);

  useEffect(() => {
    if (stage === "generalIntro" || stage === "generalLoop") {
      void preloadAuthRouteGeneralLoadingFrames();
    }
  }, [stage]);

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
      if (!loginFramesReady) {
        return;
      }
      const isLastLoginFrame = loginFrameIndex >= LOGIN_LOADING_FRAMES.length - 1;
      const timeoutId = window.setTimeout(() => {
        if (!isLastLoginFrame) {
          setLoginFrameIndex((current) => Math.min(current + 1, LOGIN_LOADING_FRAMES.length - 1));
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
      const isLastIntroFrame = generalIntroFrameIndex >= GENERAL_LOADING_INTRO_FRAMES.length - 1;
      const timeoutId = window.setTimeout(() => {
        if (!isLastIntroFrame) {
          setGeneralIntroFrameIndex((current) => Math.min(current + 1, GENERAL_LOADING_INTRO_FRAMES.length - 1));
          return;
        }

        if (transitionSatisfied) {
          completeTransition();
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
      setGeneralLoopFrameIndex((current) => (current + 1) % GENERAL_LOADING_LOOP_FRAMES.length);
    }, GENERAL_LOOP_FRAME_DURATION_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    completeTransition,
    generalIntroFrameIndex,
    generalLoopFrameIndex,
    loginFrameIndex,
    loginFramesReady,
    stage,
    transition,
    transitionSatisfied,
  ]);

  const currentFrame = useMemo(() => {
    if (stage === "loginOnce") {
      return LOGIN_LOADING_FRAMES[loginFrameIndex] ?? LOGIN_LOADING_FRAMES[LOGIN_LOADING_FRAMES.length - 1];
    }
    if (stage === "generalIntro") {
      return GENERAL_LOADING_INTRO_FRAMES[generalIntroFrameIndex] ?? GENERAL_LOADING_INTRO_FRAMES[GENERAL_LOADING_INTRO_FRAMES.length - 1];
    }
    if (stage === "generalLoop") {
      return GENERAL_LOADING_LOOP_FRAMES[generalLoopFrameIndex] ?? GENERAL_LOADING_LOOP_FRAMES[0];
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
