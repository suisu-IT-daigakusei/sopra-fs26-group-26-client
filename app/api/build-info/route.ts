import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

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

function readBuildInfoFromEnv(commitIdEnv: string, timestampEnv: string): BuildInfo {
  const commitId = String(process.env[commitIdEnv] ?? "").trim();
  if (!commitId) {
    return toUnknownBuildInfo();
  }

  const timestampRaw = String(process.env[timestampEnv] ?? "").trim();
  const { date, time } = formatBuildDateParts(timestampRaw);
  return {
    commitId,
    date,
    time,
  };
}

export async function GET() {
  const clientRepoPath = process.cwd();
  const defaultServerRepoPath = path.resolve(process.cwd(), "..", "sopra-fs26-group-26-server");
  const serverRepoPath = process.env.CABO_SERVER_REPO_PATH || defaultServerRepoPath;

  const clientFromEnv = readBuildInfoFromEnv(
    "CABO_CLIENT_BUILD_COMMIT_ID",
    "CABO_CLIENT_BUILD_COMMIT_TIMESTAMP",
  );
  const serverFromEnv = readBuildInfoFromEnv(
    "CABO_SERVER_BUILD_COMMIT_ID",
    "CABO_SERVER_BUILD_COMMIT_TIMESTAMP",
  );

  const [clientFromGit, serverFromGit] = await Promise.all([
    readBuildInfo(clientRepoPath),
    readBuildInfo(serverRepoPath),
  ]);

  const resolvedClient = isKnownBuildInfo(clientFromEnv) ? clientFromEnv : clientFromGit;
  const resolvedServer = isKnownBuildInfo(serverFromEnv) ? serverFromEnv : serverFromGit;

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
