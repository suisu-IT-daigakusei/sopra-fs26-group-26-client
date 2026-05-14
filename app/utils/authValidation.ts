import type { ApiService } from "@/api/apiService";

export type UsernameValidationRules = {
  minLength: number;
  maxLength: number;
  pattern: string;
  allowedCharactersPattern: string;
  hint: string;
};

export type PasswordValidationRules = {
  minLength: number;
  maxLength: number;
  pattern: string;
  allowedCharactersPattern: string;
  hint: string;
  requiresUppercase: boolean;
  requiresSpecialSymbol: boolean;
  asciiOnly: boolean;
};

export type AuthValidationRules = {
  username: UsernameValidationRules;
  password: PasswordValidationRules;
};

const FALLBACK_AUTH_RULES: AuthValidationRules = {
  username: {
    minLength: 1,
    maxLength: 16,
    pattern: "^[A-Za-z0-9]+$",
    allowedCharactersPattern: "[A-Za-z0-9]",
    hint: "Use 1-16 characters: ASCII letters (A-Z, a-z) and digits (0-9) only.",
  },
  password: {
    minLength: 8,
    maxLength: 32,
    pattern: "^(?=.*[A-Z])(?=.*[^A-Za-z0-9])[\\x21-\\x7E]{8,32}$",
    allowedCharactersPattern: "[\\x21-\\x7E]",
    hint: "Use 8-32 characters, ASCII only (no spaces), with at least 1 uppercase letter and 1 special symbol.",
    requiresUppercase: true,
    requiresSpecialSymbol: true,
    asciiOnly: true,
  },
};

function toSafeNumber(value: unknown, fallback: number, min = 1): number {
  const asNumber = Number(value);
  if (!Number.isFinite(asNumber)) {
    return fallback;
  }
  const asInteger = Math.trunc(asNumber);
  return asInteger >= min ? asInteger : fallback;
}

function toSafeString(value: unknown, fallback: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : fallback;
}

function toSafeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function toRegex(pattern: string, fallback: RegExp): RegExp {
  try {
    return new RegExp(pattern);
  } catch {
    return fallback;
  }
}

function trimToMaxLength(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function filterByAllowedCharacters(value: string, allowedCharacterPattern: string, fallback: RegExp): string {
  const singleCharacterRegex = toRegex(allowedCharacterPattern, fallback);
  let filtered = "";
  for (const nextChar of value) {
    if (singleCharacterRegex.test(nextChar)) {
      filtered += nextChar;
    }
  }
  return filtered;
}

export function normalizeAuthValidationRules(rules: unknown): AuthValidationRules {
  const source = typeof rules === "object" && rules !== null ? rules as Partial<AuthValidationRules> : {};
  const username = (source.username ?? {}) as Partial<UsernameValidationRules>;
  const password = (source.password ?? {}) as Partial<PasswordValidationRules>;
  const usernameMin = toSafeNumber(username.minLength, FALLBACK_AUTH_RULES.username.minLength);
  const usernameMaxRaw = toSafeNumber(username.maxLength, FALLBACK_AUTH_RULES.username.maxLength);
  const usernameMax = usernameMaxRaw >= usernameMin ? usernameMaxRaw : FALLBACK_AUTH_RULES.username.maxLength;
  const passwordMin = toSafeNumber(password.minLength, FALLBACK_AUTH_RULES.password.minLength);
  const passwordMaxRaw = toSafeNumber(password.maxLength, FALLBACK_AUTH_RULES.password.maxLength);
  const passwordMax = passwordMaxRaw >= passwordMin ? passwordMaxRaw : FALLBACK_AUTH_RULES.password.maxLength;

  return {
    username: {
      minLength: usernameMin,
      maxLength: usernameMax,
      pattern: toSafeString(username.pattern, FALLBACK_AUTH_RULES.username.pattern),
      allowedCharactersPattern: toSafeString(
        username.allowedCharactersPattern,
        FALLBACK_AUTH_RULES.username.allowedCharactersPattern,
      ),
      hint: toSafeString(username.hint, FALLBACK_AUTH_RULES.username.hint),
    },
    password: {
      minLength: passwordMin,
      maxLength: passwordMax,
      pattern: toSafeString(password.pattern, FALLBACK_AUTH_RULES.password.pattern),
      allowedCharactersPattern: toSafeString(
        password.allowedCharactersPattern,
        FALLBACK_AUTH_RULES.password.allowedCharactersPattern,
      ),
      hint: toSafeString(password.hint, FALLBACK_AUTH_RULES.password.hint),
      requiresUppercase: toSafeBoolean(password.requiresUppercase, FALLBACK_AUTH_RULES.password.requiresUppercase),
      requiresSpecialSymbol: toSafeBoolean(password.requiresSpecialSymbol, FALLBACK_AUTH_RULES.password.requiresSpecialSymbol),
      asciiOnly: toSafeBoolean(password.asciiOnly, FALLBACK_AUTH_RULES.password.asciiOnly),
    },
  };
}

export async function fetchAuthValidationRules(apiService: ApiService): Promise<AuthValidationRules> {
  try {
    const rulesFromBackend = await apiService.get<AuthValidationRules>("/auth/rules");
    return normalizeAuthValidationRules(rulesFromBackend);
  } catch {
    return FALLBACK_AUTH_RULES;
  }
}

export function getFallbackAuthValidationRules(): AuthValidationRules {
  return FALLBACK_AUTH_RULES;
}

export function sanitizeUsernameInput(value: string, rules: AuthValidationRules): string {
  const filtered = filterByAllowedCharacters(
    value,
    rules.username.allowedCharactersPattern,
    /[A-Za-z0-9]/,
  );
  return trimToMaxLength(filtered, rules.username.maxLength);
}

export function sanitizePasswordInput(value: string, rules: AuthValidationRules): string {
  const filtered = filterByAllowedCharacters(
    value,
    rules.password.allowedCharactersPattern,
    /[\x21-\x7E]/,
  );
  return trimToMaxLength(filtered, rules.password.maxLength);
}

export function validateUsername(value: string, rules: AuthValidationRules): string | null {
  if (value.length < rules.username.minLength || value.length > rules.username.maxLength) {
    return rules.username.hint;
  }
  const validator = toRegex(rules.username.pattern, /^[A-Za-z0-9]+$/);
  if (!validator.test(value)) {
    return rules.username.hint;
  }
  return null;
}

export function validatePassword(value: string, rules: AuthValidationRules): string | null {
  if (value.length < rules.password.minLength || value.length > rules.password.maxLength) {
    return rules.password.hint;
  }
  const validator = toRegex(
    rules.password.pattern,
    /^(?=.*[A-Z])(?=.*[^A-Za-z0-9])[\x21-\x7E]{8,32}$/,
  );
  if (!validator.test(value)) {
    return rules.password.hint;
  }
  return null;
}
