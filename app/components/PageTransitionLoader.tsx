"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import GeneralLoadingAnimation from "./GeneralLoadingAnimation";
import {
  AUTH_ROUTE_TRANSITION_UPDATED_EVENT,
  isAuthRouteTransitionActive,
} from "./authRouteTransition";

const LOADER_MIN_VISIBLE_MS = 1100;

export default function PageTransitionLoader() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [visible, setVisible] = useState(false);
  const [authTransitionActive, setAuthTransitionActive] = useState(false);

  const routeKey = useMemo(
    () => `${pathname ?? ""}?${searchParams?.toString() ?? ""}`,
    [pathname, searchParams],
  );

  const previousRouteRef = useRef<string>(routeKey);
  const isFirstRenderRef = useRef(true);

  useEffect(() => {
    const syncAuthTransition = () => {
      setAuthTransitionActive(isAuthRouteTransitionActive());
    };

    syncAuthTransition();
    window.addEventListener(AUTH_ROUTE_TRANSITION_UPDATED_EVENT, syncAuthTransition);
    window.addEventListener("storage", syncAuthTransition);

    return () => {
      window.removeEventListener(AUTH_ROUTE_TRANSITION_UPDATED_EVENT, syncAuthTransition);
      window.removeEventListener("storage", syncAuthTransition);
    };
  }, []);

  useEffect(() => {
    if (authTransitionActive) {
      setVisible(false);
      previousRouteRef.current = routeKey;
      return;
    }

    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      previousRouteRef.current = routeKey;
      return;
    }

    if (previousRouteRef.current === routeKey) {
      return;
    }

    previousRouteRef.current = routeKey;
    setVisible(true);

    const timeoutId = window.setTimeout(() => {
      setVisible(false);
    }, LOADER_MIN_VISIBLE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [authTransitionActive, routeKey]);

  if (!visible || authTransitionActive) {
    return null;
  }

  return (
    <div className="page-transition-loader-overlay">
      <GeneralLoadingAnimation className="auth-route-loader-frame" />
    </div>
  );
}
