"use client";

import { normalizeMusicBlacklist } from "@/utils/userSettings";

export type MusicTrack = {
  id: string;
  src: string;
  filename: string;
  fallbackTitle: string;
  metadataTitle: string | null;
};

const MUSIC_FILENAME_PATTERN = /^music_(\d{2})\.mp3$/i;

export const GAME_MUSIC_TRACK_FILENAMES = Array.from(
  { length: 30 },
  (_, index) => `music_${String(index + 1).padStart(2, "0")}.mp3`,
);

let configuredMusicFilenamesPromise: Promise<string[]> | null = null;
const availableMusicTracksPromiseByKey = new Map<string, Promise<MusicTrack[]>>();

function toPositiveInteger(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) {
    return 0;
  }
  return Math.floor(raw);
}

function decodeSynchsafeInt(bytes: Uint8Array, start: number): number {
  return (
    ((bytes[start] & 0x7f) << 21) |
    ((bytes[start + 1] & 0x7f) << 14) |
    ((bytes[start + 2] & 0x7f) << 7) |
    (bytes[start + 3] & 0x7f)
  );
}

function decodeBigEndianInt(bytes: Uint8Array, start: number): number {
  return (
    (bytes[start] << 24) |
    (bytes[start + 1] << 16) |
    (bytes[start + 2] << 8) |
    bytes[start + 3]
  ) >>> 0;
}

function trimDecodedText(raw: string): string {
  return raw.replace(/\u0000+/g, "").trim();
}

function decodeLatin1(bytes: Uint8Array): string {
  try {
    return new TextDecoder("latin1").decode(bytes);
  } catch {
    let output = "";
    for (const entry of bytes) {
      output += String.fromCharCode(entry);
    }
    return output;
  }
}

function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string {
  const evenLength = bytes.length - (bytes.length % 2);
  const view = bytes.subarray(0, evenLength);
  if (view.length === 0) {
    return "";
  }
  try {
    const encoding = littleEndian ? "utf-16le" : "utf-16be";
    return new TextDecoder(encoding).decode(view);
  } catch {
    try {
      return new TextDecoder("utf-16").decode(view);
    } catch {
      return "";
    }
  }
}

function decodeId3TextPayload(payload: Uint8Array): string {
  if (payload.length === 0) {
    return "";
  }
  const encodingByte = payload[0];
  const body = payload.subarray(1);
  if (body.length === 0) {
    return "";
  }
  switch (encodingByte) {
    case 0:
      return decodeLatin1(body);
    case 1: {
      if (body.length >= 2) {
        const bom0 = body[0];
        const bom1 = body[1];
        if (bom0 === 0xff && bom1 === 0xfe) {
          return decodeUtf16(body.subarray(2), true);
        }
        if (bom0 === 0xfe && bom1 === 0xff) {
          return decodeUtf16(body.subarray(2), false);
        }
      }
      return decodeUtf16(body, true);
    }
    case 2:
      return decodeUtf16(body, false);
    case 3:
      try {
        return new TextDecoder("utf-8").decode(body);
      } catch {
        return "";
      }
    default:
      return decodeLatin1(body);
  }
}

function readId3v2Title(bytes: Uint8Array): string | null {
  if (bytes.length < 10) {
    return null;
  }
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) {
    return null;
  }
  const majorVersion = bytes[3];
  if (majorVersion !== 3 && majorVersion !== 4) {
    return null;
  }
  const tagSize = decodeSynchsafeInt(bytes, 6);
  const tagEnd = Math.min(bytes.length, 10 + toPositiveInteger(tagSize));
  let offset = 10;
  while (offset + 10 <= tagEnd) {
    const frameId = String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3],
    );
    if (!/^[A-Z0-9]{4}$/.test(frameId)) {
      break;
    }
    const frameSize = majorVersion === 4
      ? decodeSynchsafeInt(bytes, offset + 4)
      : decodeBigEndianInt(bytes, offset + 4);
    const safeFrameSize = toPositiveInteger(frameSize);
    if (safeFrameSize <= 0) {
      break;
    }
    const frameDataStart = offset + 10;
    const frameDataEnd = frameDataStart + safeFrameSize;
    if (frameDataEnd > tagEnd) {
      break;
    }
    if (frameId === "TIT2") {
      const payload = bytes.subarray(frameDataStart, frameDataEnd);
      const decoded = trimDecodedText(decodeId3TextPayload(payload));
      return decoded || null;
    }
    offset = frameDataEnd;
  }
  return null;
}

function toTrackId(filename: string, index: number): string {
  const parsed = MUSIC_FILENAME_PATTERN.exec(filename);
  if (parsed) {
    return `music_${parsed[1]}`;
  }
  return `music_${String(index + 1).padStart(2, "0")}`;
}

function normalizeConfiguredMusicFilenames(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const unique = new Set<string>();
  const normalized: string[] = [];
  for (const entry of raw) {
    const filename = String(entry ?? "").trim().toLowerCase();
    if (!filename || !MUSIC_FILENAME_PATTERN.test(filename) || unique.has(filename)) {
      continue;
    }
    unique.add(filename);
    normalized.push(filename);
  }
  normalized.sort((left, right) => {
    const leftMatch = MUSIC_FILENAME_PATTERN.exec(left);
    const rightMatch = MUSIC_FILENAME_PATTERN.exec(right);
    const leftNumber = leftMatch ? Number(leftMatch[1]) : 0;
    const rightNumber = rightMatch ? Number(rightMatch[1]) : 0;
    return leftNumber - rightNumber;
  });
  return normalized;
}

export async function fetchConfiguredMusicFilenames(
  fallbackFilenames: string[] = GAME_MUSIC_TRACK_FILENAMES,
): Promise<string[]> {
  if (!configuredMusicFilenamesPromise) {
    configuredMusicFilenamesPromise = (async () => {
      try {
        const response = await fetch("/api/music-options", {
          method: "GET",
          cache: "force-cache",
        });
        if (!response.ok) {
          return [...fallbackFilenames];
        }
        const payload = await response.json() as { filenames?: unknown };
        const normalized = normalizeConfiguredMusicFilenames(payload?.filenames);
        if (normalized.length > 0) {
          return normalized;
        }
      } catch {
        // fallback to static candidates below
      }
      return [...fallbackFilenames];
    })();
  }
  try {
    return [...await configuredMusicFilenamesPromise];
  } catch {
    configuredMusicFilenamesPromise = null;
    return [...fallbackFilenames];
  }
}

function toFallbackTitle(filename: string, index: number): string {
  const trimmed = filename.trim();
  if (trimmed.length > 0) {
    return trimmed;
  }
  return `Music ${String(index + 1).padStart(2, "0")}`;
}

function stripFilenameExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) {
    return filename;
  }
  return filename.slice(0, dot);
}

export function getTrackDisplayTitle(track: MusicTrack): string {
  const fromMetadata = String(track.metadataTitle ?? "").trim();
  if (fromMetadata) {
    return fromMetadata;
  }
  return track.fallbackTitle;
}

export function getTrackBlacklistKeys(track: MusicTrack): string[] {
  const displayTitle = getTrackDisplayTitle(track).toLowerCase();
  const filename = track.filename.toLowerCase();
  const noExtFilename = stripFilenameExtension(filename);
  const normalizedId = track.id.toLowerCase();
  const rawMetadata = String(track.metadataTitle ?? "").trim().toLowerCase();
  return [normalizedId, filename, noExtFilename, displayTitle, rawMetadata].filter((entry) => entry.length > 0);
}

export function formatVolumeLabel(value: number): string {
  const normalized = Math.max(0, Math.min(100, Math.round(value)));
  return normalized === 0 ? "Off" : `${normalized}`;
}

export async function readMusicTrackMetadataTitle(src: string): Promise<string | null> {
  try {
    const response = await fetch(src, {
      method: "GET",
      cache: "force-cache",
      headers: {
        Range: "bytes=0-65535",
      },
    });
    if (!response.ok && response.status !== 206) {
      return null;
    }
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    return readId3v2Title(bytes);
  } catch {
    return null;
  }
}

export async function resolveAvailableMusicTracks(
  filenames: string[] = GAME_MUSIC_TRACK_FILENAMES,
): Promise<MusicTrack[]> {
  const normalizedFilenames = normalizeConfiguredMusicFilenames(filenames);
  const cacheKey = normalizedFilenames.join("|");
  const cached = availableMusicTracksPromiseByKey.get(cacheKey);
  if (cached) {
    return [...await cached];
  }

  const pending = Promise.all(
    normalizedFilenames.map(async (filename, index) => {
      const src = `/${filename}`;
      const metadataTitle = await readMusicTrackMetadataTitle(src);
      return {
        id: toTrackId(filename, index),
        src,
        filename,
        fallbackTitle: toFallbackTitle(filename, index),
        metadataTitle,
      } as MusicTrack;
    }),
  );
  availableMusicTracksPromiseByKey.set(cacheKey, pending);
  while (availableMusicTracksPromiseByKey.size > 4) {
    const oldestKey = availableMusicTracksPromiseByKey.keys().next().value as string | undefined;
    if (!oldestKey) break;
    availableMusicTracksPromiseByKey.delete(oldestKey);
  }

  try {
    return [...await pending];
  } catch (error) {
    availableMusicTracksPromiseByKey.delete(cacheKey);
    throw error;
  }
}

export function filterTracksByBlacklist(tracks: MusicTrack[], rawBlacklist: unknown): MusicTrack[] {
  const normalizedBlacklist = new Set(
    normalizeMusicBlacklist(rawBlacklist).map((entry) => entry.trim().toLowerCase()).filter((entry) => entry.length > 0),
  );
  if (normalizedBlacklist.size === 0) {
    return [...tracks];
  }
  return tracks.filter((track) => {
    const keys = getTrackBlacklistKeys(track);
    return !keys.some((entry) => normalizedBlacklist.has(entry));
  });
}
