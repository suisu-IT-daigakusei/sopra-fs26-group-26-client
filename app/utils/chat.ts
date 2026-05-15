const MAX_CHAT_MESSAGE_LENGTH = 50;

const UNICODE_TO_EMOTE_MAP: Array<[RegExp, string]> = [
  [/(?:\u{1F600}|\u{1F603}|\u{1F604}|\u{1F601}|\u{1F606}|\u{1F642}|\u{1F60A})/gu, ":)"],
  [/(?:\u{1F602}|\u{1F923})/gu, "xD"],
  [/(?:\u{1F641}|\u2639\uFE0F|\u2639|\u{1F61E}|\u{1F61F}|\u{1F622}|\u{1F62D})/gu, ":("],
  [/(?:\u{1F609})/gu, ";)"],
  [/(?:\u{1F61B}|\u{1F61C})/gu, ":P"],
  [/(?:\u{1F62E}|\u{1F62F})/gu, ":O"],
  [/(?:\u2764\uFE0F|\u2764)/gu, "<3"],
  [/(?:\u{1F44D}\uFE0F?)/gu, ":thumbsup:"],
  [/(?:\u{1F44E}\uFE0F?)/gu, ":thumbsdown:"],
  [/(?:\u{1F3C6}\uFE0F?)/gu, ":trophy:"],
];

const EMOTE_TO_UNICODE_MAP: Array<[RegExp, string]> = [
  [/<3/g, "\u2764\uFE0F"],
  [/:thumbsup:/gi, "\uD83D\uDC4D"],
  [/:thumbsdown:/gi, "\uD83D\uDC4E"],
  [/:trophy:/gi, "\uD83C\uDFC6"],
  [/(^|[\s])(xD|XD)(?=$|[\s])/g, "$1\uD83D\uDE04"],
  [/(^|[\s])(:-?\))(?=$|[\s])/g, "$1\uD83D\uDE42"],
  [/(^|[\s])(:-?\()(?=$|[\s])/g, "$1\uD83D\uDE41"],
  [/(^|[\s])(:-?[Pp])(?=$|[\s])/g, "$1\uD83D\uDE1B"],
  [/(^|[\s])(:-?[Oo])(?=$|[\s])/g, "$1\uD83D\uDE2E"],
  [/(^|[\s])(;-?\))(?=$|[\s])/g, "$1\uD83D\uDE09"],
];

export function getChatMessageMaxLength(): number {
  return MAX_CHAT_MESSAGE_LENGTH;
}

export function normalizeChatInputForTransport(raw: string): string {
  let text = String(raw ?? "");
  text = text.replace(/\r\n|\r|\n/g, " ");
  for (const [pattern, replacement] of UNICODE_TO_EMOTE_MAP) {
    text = text.replace(pattern, replacement);
  }
  text = text.replace(/[^\x20-\x7E]/g, "");
  return text.slice(0, MAX_CHAT_MESSAGE_LENGTH);
}

export function normalizeChatInputForDisplay(raw: string): string {
  let text = String(raw ?? "");
  for (const [pattern, replacement] of EMOTE_TO_UNICODE_MAP) {
    text = text.replace(pattern, replacement);
  }
  return text;
}
