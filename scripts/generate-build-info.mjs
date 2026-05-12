import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const unknownBuildInfo = {
  commitId: "unknown",
  date: "--------",
  time: "--:--",
};

function formatDateParts(timestampIso) {
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

function readGitBuildInfo(repoPath) {
  if (!existsSync(path.join(repoPath, ".git"))) {
    return null;
  }

  try {
    const commitId = String(
      execFileSync("git", ["rev-parse", "--short", "HEAD"], {
        cwd: repoPath,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    ).trim();
    const timestampIso = String(
      execFileSync("git", ["show", "-s", "--format=%cI", "HEAD"], {
        cwd: repoPath,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    ).trim();
    if (!commitId) {
      return null;
    }
    const { date, time } = formatDateParts(timestampIso);
    return { commitId, date, time };
  } catch {
    return null;
  }
}

function readExistingBuildInfo(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return {
      client: parsed?.client ?? unknownBuildInfo,
      server: parsed?.server ?? unknownBuildInfo,
    };
  } catch {
    return null;
  }
}

function isKnownBuildInfo(value) {
  return value && typeof value === "object" && String(value.commitId ?? "").trim() !== "unknown";
}

function main() {
  const clientRepoPath = process.cwd();
  const serverRepoPath = process.env.CABO_SERVER_REPO_PATH || path.resolve(process.cwd(), "..", "sopra-fs26-group-26-server");
  const outputPath = path.join(process.cwd(), "public", "build-info.json");

  const existing = readExistingBuildInfo(outputPath);
  const clientFromGit = readGitBuildInfo(clientRepoPath);
  const serverFromGit = readGitBuildInfo(serverRepoPath);

  const client = clientFromGit
    ?? (isKnownBuildInfo(existing?.client) ? existing.client : unknownBuildInfo);
  const server = serverFromGit
    ?? (isKnownBuildInfo(existing?.server) ? existing.server : unknownBuildInfo);

  const payload = {
    client,
    server,
    generatedAt: new Date().toISOString(),
  };

  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(`[build-info] wrote ${outputPath}`);
  console.log(`[build-info] client: ${client.commitId} ${client.date} ${client.time}`);
  console.log(`[build-info] server: ${server.commitId} ${server.date} ${server.time}`);
}

main();
