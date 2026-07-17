import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  USER_BACKGROUND_PLACEHOLDER_FILE,
  USER_DEFAULT_BACKGROUND_FILE,
  type BackgroundOption,
} from "@/utils/userSettings";

const BACKGROUND_FILE_PATTERN = /^background_(\d+)\.jpe?g$/i;

export const dynamic = "force-static";
export const revalidate = false;

function toBackgroundLabel(fileName: string): string {
  const match = BACKGROUND_FILE_PATTERN.exec(fileName);
  if (!match) {
    return "Background";
  }
  return `Background ${match[1]}`;
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

  const numberedBackgroundFiles = entries
    .filter((fileName) => BACKGROUND_FILE_PATTERN.test(fileName))
    .sort((left, right) => {
      const leftMatch = BACKGROUND_FILE_PATTERN.exec(left);
      const rightMatch = BACKGROUND_FILE_PATTERN.exec(right);
      const leftNumber = leftMatch ? Number(leftMatch[1]) : 0;
      const rightNumber = rightMatch ? Number(rightMatch[1]) : 0;
      return leftNumber - rightNumber;
    });

  const options: BackgroundOption[] = numberedBackgroundFiles.map((fileName) => ({
    id: fileName.toLowerCase(),
    src: `/${fileName}`,
    label: toBackgroundLabel(fileName),
  }));

  const availableFiles = options.map((entry) => entry.id);

  const hasPlaceholder = entries.some(
    (fileName) => fileName.toLowerCase() === USER_BACKGROUND_PLACEHOLDER_FILE,
  );
  if (hasPlaceholder) {
    availableFiles.push(USER_BACKGROUND_PLACEHOLDER_FILE);
  }

  if (!options.length) {
    options.push({
      id: USER_DEFAULT_BACKGROUND_FILE,
      src: `/${USER_DEFAULT_BACKGROUND_FILE}`,
      label: "Background 01",
    });
    if (!availableFiles.includes(USER_DEFAULT_BACKGROUND_FILE)) {
      availableFiles.push(USER_DEFAULT_BACKGROUND_FILE);
    }
  }

  return NextResponse.json(
    { backgrounds: options, availableFiles },
    {
      headers: {
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      },
    },
  );
}
