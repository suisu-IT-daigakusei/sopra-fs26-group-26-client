import { ApiService } from "@/api/apiService";
import type { ApplicationError } from "@/types/error";
import { User } from "@/types/user";

export type UserListView = "directory" | "leaderboard";

export type UserListSort =
  | "username"
  | "roundsPlayed"
  | "averageScore"
  | "roundWinRate"
  | "gamesWinRate"
  | "status"
  | "rank";

export type UserListDirection = "asc" | "desc";

export type UserPageResponse = {
  items: User[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  hasNext: boolean;
};

export type UserPageRequest = {
  view?: UserListView;
  page?: number;
  size?: number;
  q?: string;
  friendsOnly?: boolean;
  sort?: UserListSort;
  direction?: UserListDirection;
  statuses?: string[];
  includeIds?: Array<string | number>;
  excludeIds?: Array<string | number>;
};

function appendValues(
  params: URLSearchParams,
  key: string,
  values: Array<string | number> | undefined,
): void {
  values?.forEach((value) => {
    const normalized = String(value ?? "").trim();
    if (normalized) {
      params.append(key, normalized);
    }
  });
}

export function buildUsersPageEndpoint(request: UserPageRequest = {}): string {
  const params = new URLSearchParams();
  params.set("view", request.view ?? "directory");
  params.set("page", String(Math.max(0, Math.trunc(request.page ?? 0))));
  params.set("size", String(Math.min(100, Math.max(1, Math.trunc(request.size ?? 20)))));

  const query = String(request.q ?? "").trim().slice(0, 64);
  if (query) {
    params.set("q", query);
  }
  if (request.friendsOnly) {
    params.set("friendsOnly", "true");
  }
  if (request.sort) {
    params.set("sort", request.sort);
  }
  if (request.direction) {
    params.set("direction", request.direction);
  }
  appendValues(params, "status", request.statuses);
  appendValues(params, "id", request.includeIds);
  appendValues(params, "excludeId", request.excludeIds);
  return `/users?${params.toString()}`;
}

export async function getUsersPage(
  api: ApiService,
  request: UserPageRequest = {},
  token?: string,
): Promise<UserPageResponse> {
  const endpoint = buildUsersPageEndpoint(request);
  const normalizedToken = String(token ?? "").trim();
  const payload = normalizedToken
    ? await api.getWithAuth<UserPageResponse | User[]>(endpoint, normalizedToken)
    : await api.get<UserPageResponse | User[]>(endpoint);

  // Transitional compatibility with a pre-pagination server. The new server
  // always returns an envelope, but accepting the old array avoids a broken UI
  // while the two containers are being replaced during a manual deployment.
  if (Array.isArray(payload)) {
    const page = Math.max(0, Math.trunc(request.page ?? 0));
    const size = Math.min(100, Math.max(1, Math.trunc(request.size ?? 20)));
    const start = page * size;
    return {
      items: payload.slice(start, start + size),
      page,
      size,
      totalElements: payload.length,
      totalPages: Math.ceil(payload.length / size),
      hasNext: start + size < payload.length,
    };
  }

  if (
    !payload
    || !Array.isArray(payload.items)
    || !Number.isInteger(payload.page)
    || !Number.isInteger(payload.size)
    || !Number.isInteger(payload.totalElements)
    || !Number.isInteger(payload.totalPages)
    || typeof payload.hasNext !== "boolean"
  ) {
    throw new Error("The server returned an invalid paginated user response.");
  }
  return payload;
}

const USER_PAGE_SPACING_MS = 250;
const USER_PAGE_MAX_RATE_LIMIT_RETRIES = 2;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function getUsersPageWithRateLimitRetry(
  api: ApiService,
  request: UserPageRequest,
  token?: string,
): Promise<UserPageResponse> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await getUsersPage(api, request, token);
    } catch (error) {
      const appError = error as Partial<ApplicationError>;
      if (appError?.status !== 429 || attempt >= USER_PAGE_MAX_RATE_LIMIT_RETRIES) {
        throw error;
      }
      await wait(Math.max(USER_PAGE_SPACING_MS, Number(appError.retryAfterMs) || 1000));
    }
  }
}

/**
 * Compatibility helper for small coordination screens that genuinely require
 * every matching user. Each server response remains bounded; the main user
 * directory uses getUsersPage directly and never walks the full result set.
 */
export async function getAllUsersPaged(
  api: ApiService,
  request: Omit<UserPageRequest, "page" | "size"> = {},
  token?: string,
  shouldContinue?: () => boolean,
): Promise<User[]> {
  const users: User[] = [];
  const seenKeys = new Set<string>();
  let page = 0;
  let hasNext = true;

  while (hasNext) {
    if (shouldContinue && !shouldContinue()) {
      break;
    }
    if (page > 0) {
      await wait(USER_PAGE_SPACING_MS);
      if (shouldContinue && !shouldContinue()) {
        break;
      }
    }
    const response = await getUsersPageWithRateLimitRetry(
      api,
      { ...request, page, size: 100 },
      token,
    );
    if (shouldContinue && !shouldContinue()) {
      break;
    }
    if (response.items.length === 0 && response.hasNext) {
      throw new Error("User pagination returned an empty page before completion.");
    }
    let added = 0;
    response.items.forEach((user, index) => {
      const id = String(user.id ?? "").trim();
      const username = String(user.username ?? user.name ?? "").trim().toLowerCase();
      const key = id ? `id:${id}` : username ? `username:${username}` : `page:${page}:row:${index}`;
      if (seenKeys.has(key)) {
        return;
      }
      seenKeys.add(key);
      users.push(user);
      added += 1;
    });
    if (response.hasNext && added === 0) {
      throw new Error("User pagination made no progress.");
    }
    hasNext = response.hasNext === true;
    page += 1;
    if (page > 10_000) {
      throw new Error("User pagination did not terminate.");
    }
  }
  return users;
}

/** Resolve arbitrarily many user IDs without exceeding the server's bounded
 * repeated-id filter or its hot-read pacing. */
export async function getUsersByIds(
  api: ApiService,
  ids: Array<string | number>,
  token?: string,
): Promise<User[]> {
  const uniqueIds = Array.from(new Set(
    ids.map((id) => String(id ?? "").trim()).filter((id) => id.length > 0),
  ));
  const users: User[] = [];
  for (let offset = 0; offset < uniqueIds.length; offset += 100) {
    if (offset > 0) {
      await wait(USER_PAGE_SPACING_MS);
    }
    const response = await getUsersPageWithRateLimitRetry(
      api,
      {
        view: "directory",
        page: 0,
        size: 100,
        includeIds: uniqueIds.slice(offset, offset + 100),
        sort: "username",
        direction: "asc",
      },
      token,
    );
    users.push(...response.items);
  }
  return users;
}
