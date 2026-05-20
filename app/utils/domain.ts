import process from "process";
import { isProduction } from "@/utils/environment";
/**
 * Returns the API base URL based on the current environment.
 * In production it retrieves the URL from NEXT_PUBLIC_PROD_API_URL (or falls back to a hardcoded url).
 * In development, it returns "http://localhost:8080".
 */
export function getApiDomain(): string {
  const explicitUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (explicitUrl) {
    return explicitUrl;
  }

  // Local Docker / local browser testing should still use local backend by default.
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
      return "http://localhost:8080";
    }
  }

  const prodUrl = process.env.NEXT_PUBLIC_PROD_API_URL?.trim() ||
    "https://formal-platform-496911-n8.oa.r.appspot.com";
  const devUrl = "http://localhost:8080";
  return isProduction() ? prodUrl : devUrl;
}

// use STOMP endpoint with SockJS
export function getStompBrokerUrl(): string {
  return getApiDomain().replace(/\/+$/, "") + "/ws"; // SockJS uses http/https
}

/* -> uses raw endpoint
export function getStompBrokerUrl(): string {
  const base = getApiDomain().replace(/\/+$/, "");
  if (base.startsWith("https://")) {
    return `wss://${base.slice("https://".length)}/ws-stomp`;
  }
  if (base.startsWith("http://")) {
    return `ws://${base.slice("http://".length)}/ws-stomp`;
  }
  return `ws://${base}/ws-stomp`;
}
*/

export const LIVE_REFRESH_MS = 1000;
