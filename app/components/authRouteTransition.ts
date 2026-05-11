export type AuthRouteTransitionSource = "login" | "register";

export type AuthRouteTransition = {
  targetPath: string;
  startedAt: number;
  source: AuthRouteTransitionSource;
};

export const AUTH_ROUTE_TRANSITION_STORAGE_KEY = "authRouteTransition";
export const AUTH_ROUTE_TRANSITION_UPDATED_EVENT = "auth-route-transition-updated";

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed || trimmed === "/") {
    return "/";
  }
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function dispatchAuthRouteTransitionUpdate(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new Event(AUTH_ROUTE_TRANSITION_UPDATED_EVENT));
}

export function beginAuthRouteTransition(
  targetPath: string,
  source: AuthRouteTransitionSource,
): void {
  if (typeof window === "undefined") {
    return;
  }

  const payload: AuthRouteTransition = {
    targetPath: normalizePath(targetPath),
    startedAt: Date.now(),
    source,
  };
  try {
    window.sessionStorage.setItem(AUTH_ROUTE_TRANSITION_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    return;
  }
  dispatchAuthRouteTransitionUpdate();
}

export function readAuthRouteTransition(): AuthRouteTransition | null {
  if (typeof window === "undefined") {
    return null;
  }

  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(AUTH_ROUTE_TRANSITION_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<AuthRouteTransition> | null;
    const targetPath = typeof parsed?.targetPath === "string" ? normalizePath(parsed.targetPath) : "";
    const startedAt = Number(parsed?.startedAt);
    const source = parsed?.source;

    if (!targetPath || !Number.isFinite(startedAt) || (source !== "login" && source !== "register")) {
      try {
        window.sessionStorage.removeItem(AUTH_ROUTE_TRANSITION_STORAGE_KEY);
      } catch {
        return null;
      }
      dispatchAuthRouteTransitionUpdate();
      return null;
    }

    return { targetPath, startedAt, source };
  } catch {
    try {
      window.sessionStorage.removeItem(AUTH_ROUTE_TRANSITION_STORAGE_KEY);
    } catch {
      return null;
    }
    dispatchAuthRouteTransitionUpdate();
    return null;
  }
}

export function clearAuthRouteTransition(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.removeItem(AUTH_ROUTE_TRANSITION_STORAGE_KEY);
  } catch {
    return;
  }
  dispatchAuthRouteTransitionUpdate();
}

export function normalizeRoutePath(pathname: string | null | undefined): string {
  return normalizePath(pathname ?? "/");
}

export function isAuthRouteTransitionActive(): boolean {
  return readAuthRouteTransition() !== null;
}
