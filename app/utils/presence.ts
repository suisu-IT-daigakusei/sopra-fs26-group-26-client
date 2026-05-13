// added for lobby status, due to complexity
export type PresenceKey = "online" | "offline" | "lobby" | "playing" | "spectating" | "unknown";

// Strict parsing to avoid accidental format variants.
export function toPresenceKey(raw: unknown): PresenceKey {
  const status = String(raw ?? "").trim();

  switch (status) {
    case "ONLINE":
      return "online";
    case "OFFLINE":
      return "offline";
    case "LOBBY":
      return "lobby";
    case "PLAYING":
    case "IN_GAME": // REMOVE LATER, hopefully they all switch to PLAYING
      return "playing";
    case "SPECTATING":
      return "spectating";
    case "UNKNOWN":
      return "unknown";
    default:
      return "unknown";
  }
}

export function toPresenceLabel(presence: PresenceKey): string {
  switch (presence) {
    case "online":
      return "Online";
    case "offline":
      return "Offline";
    case "lobby":
      return "Lobby";
    case "playing":
      return "Playing";
    case "spectating":
      return "Spectating";
    default:
      return "Unknown";
  }
}
