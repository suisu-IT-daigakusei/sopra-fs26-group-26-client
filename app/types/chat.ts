export type LobbyChatMessage = {
  sequence?: number | null;
  sessionId?: string | null;
  userId?: number | string | null;
  username?: string | null;
  text?: string | null;
  sentAt?: string | null;
};
