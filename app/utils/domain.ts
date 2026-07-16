/**
 * Returns the configured API base URL. Local development uses the backend on
 * port 8080 by default; hosted builds must set NEXT_PUBLIC_API_URL explicitly.
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

  return "http://localhost:8080";
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
