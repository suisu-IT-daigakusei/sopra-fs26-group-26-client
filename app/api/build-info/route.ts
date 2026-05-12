import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
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

type BuildInfoResponse = {
  client: BuildInfo;
  server: BuildInfo;
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

function toBuildInfo(value: unknown): BuildInfo {
  if (!value || typeof value !== "object") {
    return toUnknownBuildInfo();
  }
  const record = value as Record<string, unknown>;
  return {
    commitId: String(record.commitId ?? "").trim() || "unknown",
    date: String(record.date ?? "").trim() || "--------",
    time: String(record.time ?? "").trim() || "--:--",
  };
}

function isKnownBuildInfo(buildInfo: BuildInfo): boolean {
  return buildInfo.commitId !== "unknown";
}

async function readBuildInfoFromFile(): Promise<BuildInfoResponse | null> {
  const filePath = path.join(process.cwd(), "public", "build-info.json");
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      client: toBuildInfo(parsed.client),
      server: toBuildInfo(parsed.server),
    };
  } catch {
    return null;
  }
}

export async function GET() {
  const fromFile = await readBuildInfoFromFile();
  if (
    fromFile &&
    (isKnownBuildInfo(fromFile.client) || isKnownBuildInfo(fromFile.server))
  ) {
    return NextResponse.json(
      fromFile,
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        },
      },
    );
  }

  const clientRepoPath = process.cwd();
  const defaultServerRepoPath = path.resolve(process.cwd(), "..", "sopra-fs26-group-26-server");
  const serverRepoPath = process.env.CABO_SERVER_REPO_PATH || defaultServerRepoPath;

  const [client, server] = await Promise.all([
    readBuildInfo(clientRepoPath),
    readBuildInfo(serverRepoPath),
  ]);

  return NextResponse.json(
    {
      client,
      server,
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      },
    },
  );
}
