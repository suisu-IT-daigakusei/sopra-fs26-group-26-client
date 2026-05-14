import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";

const MUSIC_FILE_PATTERN = /^music_(\d{2})\.mp3$/i;

function toTrackNumber(fileName: string): number {
  const match = MUSIC_FILE_PATTERN.exec(fileName);
  return match ? Number(match[1]) : 0;
}

export async function GET() {
  const publicDir = path.join(process.cwd(), "public");
  let entries: string[] = [];
  try {
    const dirents = await fs.readdir(publicDir, { withFileTypes: true });
    entries = dirents
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  } catch {
    entries = [];
  }

  const filenames = entries
    .filter((fileName) => MUSIC_FILE_PATTERN.test(fileName))
    .sort((left, right) => toTrackNumber(left) - toTrackNumber(right))
    .map((fileName) => fileName.toLowerCase());

  return NextResponse.json({ filenames });
}
