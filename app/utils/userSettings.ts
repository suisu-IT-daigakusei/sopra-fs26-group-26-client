export type BackgroundOption = {
  id: string;
  src: string;
  label: string;
};

export const USER_PROFILE_CHARACTER_OPTIONS = [
  { id: "char01", src: "/char01_profile.png", label: "Character 1" },
  { id: "char02", src: "/char02_profile.png", label: "Character 2" },
  { id: "char03", src: "/char03_waving_1.png", label: "Character 3" },
  { id: "char04", src: "/char04_profile.png", label: "Character 4" },
  { id: "char05", src: "/char05_profile.png", label: "Character 5" },
  { id: "char06", src: "/char06_profile.png", label: "Character 6" },
  { id: "char07", src: "/char07_profile.png", label: "Character 7" },
  { id: "char08", src: "/char08_profile.png", label: "Character 8" },
] as const;

export const USER_PRIORITY_COLOR_OPTIONS = [
  "navy_blue",
  "light_blue",
  "dark_green",
  "light_green",
  "yellow",
  "orange",
  "red",
  "pink",
  "purple",
] as const;
export const USER_PRIORITY_LABELS = ["1st", "2nd", "3rd", "4th"] as const;
export const USER_DEFAULT_PRIORITY_COLORS = USER_PRIORITY_COLOR_OPTIONS.slice(0, USER_PRIORITY_LABELS.length);

export const USER_PRIMARY_COLOR_OPTIONS = [
  { id: "navy_blue", hex: "#3f69b8", label: "Blue" },
  { id: "light_blue", hex: "#4ea8ea", label: "Light Blue" },
  { id: "dark_green", hex: "#2f7f49", label: "Dark Green" },
  { id: "light_green", hex: "#78c75c", label: "Light Green" },
  { id: "yellow", hex: "#e0c13b", label: "Yellow" },
  { id: "orange", hex: "#e8a87c", label: "Orange" },
  { id: "red", hex: "#d75e5e", label: "Red" },
  { id: "pink", hex: "#e06aa8", label: "Pink" },
  { id: "purple", hex: "#8a5fc8", label: "Purple" },
] as const;

export const USER_APPEARANCE_OPTIONS = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
] as const;
export type UserAppearanceMode = (typeof USER_APPEARANCE_OPTIONS)[number]["id"];

export const USER_BACKGROUND_PLACEHOLDER_FILE = "background_placeholder.png";
export const USER_DEFAULT_BACKGROUND_FILE = "background_01.jpg";
export const USER_DEFAULT_BACKGROUND_OPTIONS: BackgroundOption[] = [
  { id: USER_DEFAULT_BACKGROUND_FILE, src: `/${USER_DEFAULT_BACKGROUND_FILE}`, label: "Background 01" },
];

export const USER_DEFAULT_CHARACTER_ID = USER_PROFILE_CHARACTER_OPTIONS[0].id;
export const USER_DEFAULT_MENU_BACKGROUND_ID = USER_DEFAULT_BACKGROUND_FILE;
export const USER_DEFAULT_GAME_BACKGROUND_ID = USER_DEFAULT_BACKGROUND_FILE;
export const USER_DEFAULT_PRIMARY_COLOR_ID = "orange";
export const USER_DEFAULT_APPEARANCE_MODE: UserAppearanceMode = "system";
export const USER_DEFAULT_MUSIC_VOLUME = 60;
export const USER_DEFAULT_SOUND_EFFECTS_VOLUME = 70;

const CHARACTER_IDS = new Set<string>(USER_PROFILE_CHARACTER_OPTIONS.map((entry) => entry.id));
const PRIMARY_COLOR_IDS = new Set<string>(USER_PRIMARY_COLOR_OPTIONS.map((entry) => entry.id));
const PRIORITY_COLOR_IDS = new Set<string>(USER_PRIORITY_COLOR_OPTIONS);
const LEGACY_COLOR_ALIASES: Record<string, string> = {
  black: "navy_blue",
  blue: "navy_blue",
  green: "light_green",
  default: "orange",
  slate: "navy_blue",
  graphite: "dark_green",
  forest: "dark_green",
  ocean: "light_blue",
  teal: "light_blue",
  coral: "red",
  indigo: "navy_blue",
  plum: "purple",
  amber: "yellow",
};

function normalizeValue(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase();
}

export function normalizeCharacterId(raw: unknown): string {
  const normalized = normalizeValue(raw);
  return CHARACTER_IDS.has(normalized) ? normalized : USER_DEFAULT_CHARACTER_ID;
}

function toBackgroundFile(raw: unknown): string {
  const normalized = normalizeValue(raw).replace(/^\/+/, "");
  if (!normalized) {
    return "";
  }
  if (normalized.startsWith("background_") && /\.(?:png|jpe?g)$/.test(normalized)) {
    return normalized;
  }
  if (normalized.startsWith("background_")) {
    return `${normalized}.jpg`;
  }
  const legacyMatch = /^(?:menu|game)-bg-(\d+)$/.exec(normalized);
  if (legacyMatch) {
    const numeric = Number(legacyMatch[1]);
    if (Number.isFinite(numeric)) {
      return `background_${String(numeric).padStart(2, "0")}.jpg`;
    }
  }
  return normalized;
}

export function resolveBackgroundFile(raw: unknown, availableFiles?: Iterable<string>): string {
  const normalizedAvailable = new Set<string>(
    availableFiles ? Array.from(availableFiles, (entry) => normalizeValue(entry)) : [],
  );
  const preferred = toBackgroundFile(raw);
  if (!normalizedAvailable.size) {
    return preferred || USER_DEFAULT_BACKGROUND_FILE;
  }
  if (preferred && normalizedAvailable.has(preferred)) {
    return preferred;
  }
  const preferredBaseMatch = /^background_(\d+)\.(?:png|jpe?g)$/.exec(preferred);
  if (preferredBaseMatch) {
    const preferredBase = `background_${preferredBaseMatch[1]}`;
    for (const extension of ["jpg", "jpeg", "png"]) {
      const candidate = `${preferredBase}.${extension}`;
      if (normalizedAvailable.has(candidate)) {
        return candidate;
      }
    }
  }
  if (normalizedAvailable.has(USER_BACKGROUND_PLACEHOLDER_FILE)) {
    return USER_BACKGROUND_PLACEHOLDER_FILE;
  }
  if (normalizedAvailable.has(USER_DEFAULT_BACKGROUND_FILE)) {
    return USER_DEFAULT_BACKGROUND_FILE;
  }
  return normalizedAvailable.values().next().value ?? USER_DEFAULT_BACKGROUND_FILE;
}

export function backgroundFileToCssUrl(backgroundFile: string): string {
  const normalized = toBackgroundFile(backgroundFile) || USER_DEFAULT_BACKGROUND_FILE;
  return `url('/${normalized}')`;
}

export function normalizePrimaryColorId(raw: unknown): string {
  let normalized = normalizeValue(raw);
  if (LEGACY_COLOR_ALIASES[normalized]) {
    normalized = LEGACY_COLOR_ALIASES[normalized];
  }
  return PRIMARY_COLOR_IDS.has(normalized) ? normalized : USER_DEFAULT_PRIMARY_COLOR_ID;
}

export function getPrimaryColorHex(primaryColorId: unknown): string {
  const normalized = normalizePrimaryColorId(primaryColorId);
  const match = USER_PRIMARY_COLOR_OPTIONS.find((entry) => entry.id === normalized);
  return match?.hex ?? USER_PRIMARY_COLOR_OPTIONS[0].hex;
}

export function normalizeAppearanceMode(raw: unknown): UserAppearanceMode {
  const normalized = normalizeValue(raw);
  if (normalized === "light" || normalized === "dark" || normalized === "system") {
    return normalized;
  }
  return USER_DEFAULT_APPEARANCE_MODE;
}

export function appearanceModeToStorageValue(mode: unknown): string {
  return normalizeAppearanceMode(mode);
}

export function resolveEffectiveAppearance(
  mode: unknown,
  prefersDark: boolean,
): "light" | "dark" {
  const normalizedMode = normalizeAppearanceMode(mode);
  if (normalizedMode === "system") {
    return prefersDark ? "dark" : "light";
  }
  return normalizedMode;
}

export function getAppearanceTextColorHex(mode: unknown, prefersDark: boolean): string {
  const effective = resolveEffectiveAppearance(mode, prefersDark);
  return effective === "light" ? "#1e2329" : "#f2f2f2";
}

export function getAppearanceContainerBackgroundHex(mode: unknown, prefersDark: boolean): string {
  const effective = resolveEffectiveAppearance(mode, prefersDark);
  return effective === "light" ? "#f7f8fa" : "#16181d";
}

export function normalizeVolume(raw: unknown, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.min(100, Math.floor(parsed)));
}

export function normalizeMusicBlacklist(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<string>();
  const next: string[] = [];
  for (const entry of raw) {
    const normalized = String(entry ?? "").trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) {
      continue;
    }
    seen.add(key);
    next.push(normalized);
  }
  return next;
}

export function normalizePreferredColorPriority(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [...USER_DEFAULT_PRIORITY_COLORS];
  }

  const usedColors = new Set<string>();
  const normalizedChoices: string[] = [];

  for (const entry of raw) {
    if (normalizedChoices.length >= USER_PRIORITY_LABELS.length) {
      break;
    }
    let normalized = normalizeValue(entry);
    if (LEGACY_COLOR_ALIASES[normalized]) {
      normalized = LEGACY_COLOR_ALIASES[normalized];
    }
    if (!PRIORITY_COLOR_IDS.has(normalized) || usedColors.has(normalized)) {
      continue;
    }
    usedColors.add(normalized);
    normalizedChoices.push(normalized);
  }

  while (normalizedChoices.length < USER_PRIORITY_LABELS.length) {
    const fallback = USER_PRIORITY_COLOR_OPTIONS.find((option) => !usedColors.has(option));
    if (!fallback) {
      break;
    }
    normalizedChoices.push(fallback);
    usedColors.add(fallback);
  }
  return normalizedChoices.slice(0, USER_PRIORITY_LABELS.length);
}

export function hasDuplicatePriorityColors(choices: string[]): boolean {
  const seen = new Set<string>();
  for (const choice of choices) {
    if (seen.has(choice)) {
      return true;
    }
    seen.add(choice);
  }
  return false;
}

export function resolveCharacterColorId(
  preferredColorPriority: unknown,
  fallbackPrimaryColorId: unknown,
): string {
  const normalizedPreferred = normalizePreferredColorPriority(preferredColorPriority);
  if (normalizedPreferred.length > 0) {
    return normalizedPreferred[0];
  }
  return normalizePrimaryColorId(fallbackPrimaryColorId);
}

export function getCharacterProfileImageSrc(characterId: unknown): string {
  const normalized = normalizeCharacterId(characterId);
  if (normalized === "char03") {
    return "/char03_waving_1.png";
  }
  return `/${normalized}_profile.png`;
}

export function getCharacterWavingImageSrc(characterId: unknown, frame: number): string {
  const normalized = normalizeCharacterId(characterId);
  const clampedFrame = Math.max(1, Math.min(getCharacterWavingFrameMax(normalized), Math.floor(frame)));
  return `/${normalized}_waving_${clampedFrame}.png`;
}

export function getCharacterWavingFrameMax(characterId: unknown): number {
  const normalized = normalizeCharacterId(characterId);
  if (normalized === "char01") {
    return 9;
  }
  return 5;
}

export function getCharacterThumbsupImageSrc(characterId: unknown, frame: number): string {
  const normalized = normalizeCharacterId(characterId);
  if (normalized !== "char01") {
    return getCharacterProfileImageSrc(normalized);
  }

  const rounded = Math.floor(Number(frame));
  const normalizedFrame = rounded === 9 ? 9 : Math.max(1, Math.min(3, rounded));
  return `/char01_thumbsup_${normalizedFrame}.png`;
}
