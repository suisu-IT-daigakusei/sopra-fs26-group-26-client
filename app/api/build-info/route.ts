import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { getApiDomain } from "@/utils/domain";

const execFileAsync = promisify(execFile);
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

type BuildInfo = {
  commitId: string;
  date: string;
  time: string;
};

function toUnknownBuildInfo(): BuildInfo {
  return {
    commitId: "unknown",
    date: "--------",
    time: "--:--",
  };
}

function formatBuildDateParts(timestampIso: string): Pick<BuildInfo, "date" | "time"> {
  const parsed = new Date(timestampIso);
  if (Number.isNaN(parsed.getTime())) {
    return { date: "--------", time: "--:--" };
  }

  const day = String(parsed.getDate()).padStart(2, "0");
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const year = String(parsed.getFullYear());
  const hour = String(parsed.getHours()).padStart(2, "0");
  const minute = String(parsed.getMinutes()).padStart(2, "0");

  return {
    date: `${day}${month}${year}`,
    time: `${hour}:${minute}`,
  };
}

async function readBuildInfo(repoPath: string): Promise<BuildInfo> {
  try {
    const [{ stdout: commitStdout }, { stdout: timestampStdout }] = await Promise.all([
      execFileAsync("git", ["rev-parse", "--short", "HEAD"], { cwd: repoPath }),
      execFileAsync("git", ["show", "-s", "--format=%cI", "HEAD"], { cwd: repoPath }),
    ]);

    const commitId = String(commitStdout ?? "").trim();
    const timestampIso = String(timestampStdout ?? "").trim();
    if (!commitId) {
      return toUnknownBuildInfo();
    }

    const formatted = formatBuildDateParts(timestampIso);
    return {
      commitId,
      date: formatted.date,
      time: formatted.time,
    };
  } catch {
    return toUnknownBuildInfo();
  }
}

function isKnownBuildInfo(buildInfo: BuildInfo): boolean {
  return buildInfo.commitId !== "unknown";
}

function readBuildInfoFromEnvCandidates(
  commitEnvCandidates: string[],
  timestampEnvCandidates: string[],
): BuildInfo {
  const commitId = commitEnvCandidates
    .map((key) => String(process.env[key] ?? "").trim())
    .find((value) => value.length > 0);
  if (!commitId) {
    return toUnknownBuildInfo();
  }

  const timestampRaw = timestampEnvCandidates
    .map((key) => String(process.env[key] ?? "").trim())
    .find((value) => value.length > 0) ?? "";
  const { date, time } = formatBuildDateParts(timestampRaw);

  return { commitId, date, time };
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function getBackendApiBaseUrl(): string {
  return normalizeBaseUrl(getApiDomain());
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function toBuildInfo(value: unknown): BuildInfo {
  const record = asRecord(value);
  if (!record) {
    return toUnknownBuildInfo();
  }

  const commitId = String(record.commitId ?? "").trim();
  if (!commitId) {
    return toUnknownBuildInfo();
  }

  const date = String(record.date ?? "").trim() || "--------";
  const time = String(record.time ?? "").trim() || "--:--";
  return { commitId, date, time };
}

function extractServerBuildInfoPayload(payload: unknown): unknown {
  const record = asRecord(payload);
  if (!record) {
    return null;
  }

  if ("commitId" in record || "date" in record || "time" in record) {
    return record;
  }

  if ("server" in record) {
    return record.server;
  }

  return null;
}

async function readServerBuildInfoFromBackend(apiBaseUrl: string): Promise<BuildInfo> {
  const endpointCandidates = [
    `${apiBaseUrl}/build-info`,
    `${apiBaseUrl}/api/build-info`,
  ];

  for (const endpointUrl of endpointCandidates) {
    const timeoutController = new AbortController();
    const timeoutHandle = setTimeout(() => timeoutController.abort(), 2000);

    try {
      const response = await fetch(endpointUrl, {
        method: "GET",
        cache: "no-store",
        headers: {
          Accept: "application/json",
        },
        signal: timeoutController.signal,
      });
      if (!response.ok) {
        continue;
      }

      const payload = await response.json() as unknown;
      const buildInfo = toBuildInfo(extractServerBuildInfoPayload(payload));
      if (isKnownBuildInfo(buildInfo)) {
        return buildInfo;
      }
    } catch {
      // try next endpoint fallback
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  return toUnknownBuildInfo();
}

export async function GET() {
  const clientRepoPath = process.cwd();
  const defaultServerRepoPath = path.resolve(process.cwd(), "..", "sopra-fs26-group-26-server");
  const serverRepoPath = process.env.CABO_SERVER_REPO_PATH || defaultServerRepoPath;
  const backendApiBaseUrl = getBackendApiBaseUrl();

  const clientFromEnv = readBuildInfoFromEnvCandidates(
    [
      "CABO_CLIENT_BUILD_COMMIT_ID",
      "GITHUB_SHA",
      "CI_COMMIT_SHA",
    ],
    [
      "CABO_CLIENT_BUILD_COMMIT_TIMESTAMP",
      "GITHUB_EVENT_HEAD_COMMIT_TIMESTAMP",
      "CI_COMMIT_TIMESTAMP",
    ],
  );
  const serverFromEnv = readBuildInfoFromEnvCandidates(
    [
      "CABO_SERVER_BUILD_COMMIT_ID",
      "CABO_SERVER_GIT_COMMIT_SHA",
    ],
    [
      "CABO_SERVER_BUILD_COMMIT_TIMESTAMP",
      "CABO_SERVER_GIT_COMMIT_TIMESTAMP",
    ],
  );
  const [clientFromGit, serverFromGit, serverFromBackend] = await Promise.all([
    readBuildInfo(clientRepoPath),
    readBuildInfo(serverRepoPath),
    readServerBuildInfoFromBackend(backendApiBaseUrl),
  ]);

  const resolvedClient = isKnownBuildInfo(clientFromEnv) ? clientFromEnv : clientFromGit;
  const resolvedServer = isKnownBuildInfo(serverFromEnv)
    ? serverFromEnv
    : isKnownBuildInfo(serverFromBackend)
      ? serverFromBackend
      : serverFromGit;

  if (isKnownBuildInfo(resolvedClient) || isKnownBuildInfo(resolvedServer)) {
    return NextResponse.json(
      {
        client: resolvedClient,
        server: resolvedServer,
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        },
      },
    );
  }

  return NextResponse.json(
    {
      client: toUnknownBuildInfo(),
      server: toUnknownBuildInfo(),
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      },
    },
  );
}
