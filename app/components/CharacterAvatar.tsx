"use client";

import Image, { type ImageProps } from "next/image";
import { useEffect, useMemo, useState } from "react";
import {
  getCharacterCelebrationImageSrc,
  getCharacterProfileBlinkImageSrc,
  getCharacterProfileImageSrc,
  getCharacterThumbsupImageSrc,
  getCharacterWavingImageSrc,
  getPrimaryColorHex,
  normalizeCharacterId,
  normalizePrimaryColorId,
} from "@/utils/userSettings";

type CharacterAvatarVariant = "profile" | "profile_blink" | "waving" | "thumbsup" | "celebration";

type CharacterAvatarProps = Omit<ImageProps, "src"> & {
  characterId: unknown;
  primaryColorId?: unknown;
  variant?: CharacterAvatarVariant;
  frame?: number;
  autoBlink?: boolean;
};

type HueRange = readonly [number, number];

type CharacterTintProfile = {
  hueRanges: readonly HueRange[];
  minSaturation: number;
  maxSaturation?: number;
  minLightness: number;
  maxLightness: number;
  startYRatio?: number;
  endYRatio?: number;
  minXRatio?: number;
  maxXRatio?: number;
  minComponentPixels?: number;
  minComponentMinYRatio?: number;
  maxComponentMinYRatio?: number;
  minComponentMaxYRatio?: number;
  maxComponentMaxYRatio?: number;
  minComponentMinXRatio?: number;
  maxComponentMinXRatio?: number;
  minComponentMaxXRatio?: number;
  maxComponentMaxXRatio?: number;
  minOutputSaturation?: number;
  sourceSaturationMix?: number;
  targetSaturationMix?: number;
  targetSaturationBoost?: number;
  lightnessScale?: number;
  minOutputLightness?: number;
  maxOutputLightness?: number;
};

const CHARACTER_TINT_PROFILES: Partial<Record<string, CharacterTintProfile>> = {
  char01: {
    hueRanges: [[338, 360], [0, 20]],
    minSaturation: 0.32,
    minLightness: 0.12,
    maxLightness: 0.82,
    startYRatio: 0.42,
    minComponentPixels: 120,
    minComponentMaxYRatio: 0.62,
    minOutputSaturation: 0.5,
    lightnessScale: 0.95,
    maxOutputLightness: 0.8,
  },
  char02: {
    hueRanges: [[185, 240]],
    minSaturation: 0.14,
    minLightness: 0.18,
    maxLightness: 0.88,
    startYRatio: 0.32,
    minComponentPixels: 70,
    minOutputSaturation: 0.72,
    targetSaturationBoost: 1.18,
    lightnessScale: 0.78,
    maxOutputLightness: 0.7,
  },
  char03: {
    hueRanges: [[185, 240]],
    minSaturation: 0.16,
    minLightness: 0.2,
    maxLightness: 0.9,
    startYRatio: 0.02,
    minComponentPixels: 70,
    minOutputSaturation: 0.68,
    targetSaturationBoost: 1.12,
    lightnessScale: 0.83,
    maxOutputLightness: 0.74,
  },
  char04: {
    hueRanges: [[38, 67]],
    minSaturation: 0.3,
    minLightness: 0.18,
    maxLightness: 0.9,
    startYRatio: 0.18,
    minComponentPixels: 70,
    minComponentMaxYRatio: 0.5,
    minOutputSaturation: 0.54,
    lightnessScale: 0.92,
    maxOutputLightness: 0.8,
  },
  char05: {
    hueRanges: [[314, 346]],
    minSaturation: 0.16,
    minLightness: 0.34,
    maxLightness: 0.92,
    startYRatio: 0.08,
    endYRatio: 0.52,
    minComponentPixels: 24,
    maxComponentMaxYRatio: 0.52,
    minOutputSaturation: 0.64,
    targetSaturationBoost: 1.08,
    lightnessScale: 0.86,
    maxOutputLightness: 0.76,
  },
  char06: {
    hueRanges: [[23, 48]],
    minSaturation: 0.2,
    minLightness: 0.2,
    maxLightness: 0.78,
    startYRatio: 0.38,
    endYRatio: 0.84,
    maxXRatio: 0.58,
    minComponentPixels: 45,
    maxComponentMaxXRatio: 0.58,
    minOutputSaturation: 0.52,
    lightnessScale: 0.9,
    maxOutputLightness: 0.78,
  },
  char07: {
    hueRanges: [[185, 240]],
    minSaturation: 0.15,
    minLightness: 0.2,
    maxLightness: 0.9,
    startYRatio: 0.42,
    endYRatio: 0.9,
    maxXRatio: 0.64,
    minComponentPixels: 60,
    minComponentMaxYRatio: 0.58,
    maxComponentMaxXRatio: 0.64,
    minOutputSaturation: 0.72,
    targetSaturationBoost: 1.14,
    lightnessScale: 0.8,
    maxOutputLightness: 0.68,
  },
  char08: {
    hueRanges: [[8, 75]],
    minSaturation: 0.02,
    maxSaturation: 0.75,
    minLightness: 0.34,
    maxLightness: 0.96,
    startYRatio: 0.58,
    endYRatio: 0.92,
    minXRatio: 0.04,
    maxXRatio: 0.72,
    minComponentPixels: 10,
    maxComponentMaxXRatio: 0.72,
    minOutputSaturation: 0.78,
    targetSaturationBoost: 1.18,
    lightnessScale: 0.76,
    maxOutputLightness: 0.64,
  },
};

const tintedSrcCache = new Map<string, string>();
const PROFILE_BLINK_MIN_DELAY_MS = 2600;
const PROFILE_BLINK_MAX_DELAY_MS = 6800;
const PROFILE_BLINK_CLOSED_MS = 130;
const CHARACTER_WEARABLE_HEX_BY_COLOR_ID: Record<string, string> = {
  navy_blue: "#1f4ea8",
  light_blue: "#00a7ff",
  dark_green: "#1f8a43",
  light_green: "#59d73c",
  yellow: "#d3ad00",
  orange: "#ef7d1f",
  red: "#da3b34",
  pink: "#e64aa5",
  purple: "#7048d9",
};
const CHARACTER_WEARABLE_LIGHTNESS_MULTIPLIER_BY_COLOR_ID: Partial<Record<string, number>> = {
  dark_green: 0.58,
};

function getTintProfileForVariant(
  characterId: string,
  variant: CharacterAvatarVariant,
): CharacterTintProfile | null {
  const baseProfile = CHARACTER_TINT_PROFILES[characterId];
  if (!baseProfile) {
    return null;
  }
  if (variant === "celebration") {
    return {
      ...baseProfile,
      // Celebration poses jump/shift more than profile sprites; relax spatial filters
      // so the wearable stays tinted while preserving hue-based masking.
      startYRatio: Math.max(0, (baseProfile.startYRatio ?? 0) - 0.18),
      endYRatio: 1,
      minXRatio: Math.max(0, (baseProfile.minXRatio ?? 0) - 0.16),
      maxXRatio: Math.min(1, (baseProfile.maxXRatio ?? 1) + 0.16),
      minComponentPixels: Math.max(1, Math.min(baseProfile.minComponentPixels ?? 1, 30)),
      minComponentMinYRatio: undefined,
      maxComponentMinYRatio: undefined,
      minComponentMaxYRatio: undefined,
      maxComponentMaxYRatio: undefined,
      minComponentMinXRatio: undefined,
      maxComponentMinXRatio: undefined,
      minComponentMaxXRatio: undefined,
      maxComponentMaxXRatio: undefined,
    };
  }
  if (variant !== "thumbsup") {
    return baseProfile;
  }
  return {
    ...baseProfile,
    startYRatio: Math.max(0, (baseProfile.startYRatio ?? 0) - 0.12),
    endYRatio: 1,
    minXRatio: baseProfile.minXRatio ?? 0,
    maxXRatio: baseProfile.maxXRatio ?? 1,
    minComponentPixels: Math.max(1, Math.min(baseProfile.minComponentPixels ?? 1, 40)),
    minComponentMinYRatio: undefined,
    maxComponentMinYRatio: undefined,
    minComponentMaxYRatio: undefined,
    maxComponentMaxYRatio: undefined,
    minComponentMinXRatio: undefined,
    maxComponentMinXRatio: undefined,
    minComponentMaxXRatio: undefined,
    maxComponentMaxXRatio: undefined,
    minOutputSaturation: Math.max(baseProfile.minOutputSaturation ?? 0.55, 0.74),
    sourceSaturationMix: Math.min(baseProfile.sourceSaturationMix ?? 0.2, 0.16),
    targetSaturationMix: Math.max(baseProfile.targetSaturationMix ?? 0.94, 0.98),
    targetSaturationBoost: (baseProfile.targetSaturationBoost ?? 1) * 1.12,
    lightnessScale: Math.min(baseProfile.lightnessScale ?? 0.9, 0.82),
    maxOutputLightness: Math.min(baseProfile.maxOutputLightness ?? 0.82, 0.72),
  };
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function getCharacterWearableHex(primaryColorId: string): string {
  return CHARACTER_WEARABLE_HEX_BY_COLOR_ID[primaryColorId] ?? getPrimaryColorHex(primaryColorId);
}

function getCharacterWearableLightnessMultiplier(primaryColorId: string): number {
  return CHARACTER_WEARABLE_LIGHTNESS_MULTIPLIER_BY_COLOR_ID[primaryColorId] ?? 1;
}

function hexToRgb(hex: string): [number, number, number] | null {
  const normalized = String(hex ?? "").trim().replace(/^#/, "");
  if (!/^[\da-f]{6}$/i.test(normalized)) {
    return null;
  }
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

function rgbToHsl(red: number, green: number, blue: number): [number, number, number] {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;

  if (delta === 0) {
    return [0, 0, lightness];
  }

  const saturation = lightness > 0.5
    ? delta / (2 - max - min)
    : delta / (max + min);

  let hue = 0;
  if (max === r) {
    hue = ((g - b) / delta) + (g < b ? 6 : 0);
  } else if (max === g) {
    hue = ((b - r) / delta) + 2;
  } else {
    hue = ((r - g) / delta) + 4;
  }

  hue /= 6;
  return [hue * 360, saturation, lightness];
}

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const normalizedHue = ((hue % 360) + 360) % 360;
  const h = normalizedHue / 360;

  if (saturation <= 0) {
    const value = Math.round(lightness * 255);
    return [value, value, value];
  }

  const q = lightness < 0.5
    ? lightness * (1 + saturation)
    : lightness + saturation - (lightness * saturation);
  const p = (2 * lightness) - q;

  const toChannel = (offset: number) => {
    let t = h + offset;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + ((q - p) * 6 * t);
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + ((q - p) * (2 / 3 - t) * 6);
    return p;
  };

  return [
    Math.round(toChannel(1 / 3) * 255),
    Math.round(toChannel(0) * 255),
    Math.round(toChannel(-1 / 3) * 255),
  ];
}

function isHueInRange(hue: number, range: HueRange): boolean {
  const [rangeMin, rangeMax] = range;
  if (rangeMin <= rangeMax) {
    return hue >= rangeMin && hue <= rangeMax;
  }
  return hue >= rangeMin || hue <= rangeMax;
}

function isHueInAnyRange(hue: number, ranges: readonly HueRange[]): boolean {
  return ranges.some((range) => isHueInRange(hue, range));
}

function buildWearableTintMask(
  imageData: ImageData,
  tintProfile: CharacterTintProfile,
): Uint8Array {
  const { data, width, height } = imageData;
  const pixelCount = width * height;
  const candidateMask = new Uint8Array(pixelCount);
  const visitedMask = new Uint8Array(pixelCount);
  const tintMask = new Uint8Array(pixelCount);
  const startY = Math.max(0, Math.floor(height * (tintProfile.startYRatio ?? 0)));
  const endY = Math.max(startY + 1, Math.min(height, Math.ceil(height * (tintProfile.endYRatio ?? 1))));
  const minX = Math.max(0, Math.floor(width * (tintProfile.minXRatio ?? 0)));
  const maxX = Math.min(width - 1, Math.ceil((width - 1) * (tintProfile.maxXRatio ?? 1)));
  const minComponentPixels = Math.max(1, tintProfile.minComponentPixels ?? 1);

  for (let y = startY; y < endY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const pixelIndex = (y * width) + x;
      const offset = pixelIndex * 4;
      const alpha = data[offset + 3];
      if (alpha === 0) {
        continue;
      }

      const [hue, saturation, lightness] = rgbToHsl(
        data[offset],
        data[offset + 1],
        data[offset + 2],
      );

      if (
        isHueInAnyRange(hue, tintProfile.hueRanges) &&
        saturation >= tintProfile.minSaturation &&
        saturation <= (tintProfile.maxSaturation ?? 1) &&
        lightness >= tintProfile.minLightness &&
        lightness <= tintProfile.maxLightness
      ) {
        candidateMask[pixelIndex] = 1;
      }
    }
  }

  const stack: number[] = [];
  const componentPixels: number[] = [];

  for (let y = startY; y < endY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const seedPixelIndex = (y * width) + x;
      if (candidateMask[seedPixelIndex] === 0 || visitedMask[seedPixelIndex] === 1) {
        continue;
      }

      stack.push(seedPixelIndex);
      visitedMask[seedPixelIndex] = 1;
      componentPixels.length = 0;
      let componentMinX = x;
      let componentMaxX = x;
      let componentMinY = y;
      let componentMaxY = y;

      while (stack.length > 0) {
        const currentPixelIndex = stack.pop() as number;
        componentPixels.push(currentPixelIndex);

        const currentY = Math.floor(currentPixelIndex / width);
        const currentX = currentPixelIndex - (currentY * width);
        if (currentX < componentMinX) {
          componentMinX = currentX;
        }
        if (currentX > componentMaxX) {
          componentMaxX = currentX;
        }
        if (currentY < componentMinY) {
          componentMinY = currentY;
        }
        if (currentY > componentMaxY) {
          componentMaxY = currentY;
        }

        if (currentX > 0) {
          const left = currentPixelIndex - 1;
          if (candidateMask[left] === 1 && visitedMask[left] === 0) {
            visitedMask[left] = 1;
            stack.push(left);
          }
        }

        if (currentX < width - 1) {
          const right = currentPixelIndex + 1;
          if (candidateMask[right] === 1 && visitedMask[right] === 0) {
            visitedMask[right] = 1;
            stack.push(right);
          }
        }

        if (currentY > startY) {
          const up = currentPixelIndex - width;
          if (candidateMask[up] === 1 && visitedMask[up] === 0) {
            visitedMask[up] = 1;
            stack.push(up);
          }
        }

        if (currentY < endY - 1) {
          const down = currentPixelIndex + width;
          if (candidateMask[down] === 1 && visitedMask[down] === 0) {
            visitedMask[down] = 1;
            stack.push(down);
          }
        }
      }

      const componentMinXRatio = componentMinX / width;
      const componentMaxXRatio = componentMaxX / width;
      const componentMinYRatio = componentMinY / height;
      const componentMaxYRatio = componentMaxY / height;

      if (
        componentPixels.length < minComponentPixels ||
        (tintProfile.minComponentMinYRatio != null && componentMinYRatio < tintProfile.minComponentMinYRatio) ||
        (tintProfile.maxComponentMinYRatio != null && componentMinYRatio > tintProfile.maxComponentMinYRatio) ||
        (tintProfile.minComponentMaxYRatio != null && componentMaxYRatio < tintProfile.minComponentMaxYRatio) ||
        (tintProfile.maxComponentMaxYRatio != null && componentMaxYRatio > tintProfile.maxComponentMaxYRatio) ||
        (tintProfile.minComponentMinXRatio != null && componentMinXRatio < tintProfile.minComponentMinXRatio) ||
        (tintProfile.maxComponentMinXRatio != null && componentMinXRatio > tintProfile.maxComponentMinXRatio) ||
        (tintProfile.minComponentMaxXRatio != null && componentMaxXRatio < tintProfile.minComponentMaxXRatio) ||
        (tintProfile.maxComponentMaxXRatio != null && componentMaxXRatio > tintProfile.maxComponentMaxXRatio)
      ) {
        continue;
      }

      for (const componentPixelIndex of componentPixels) {
        tintMask[componentPixelIndex] = 1;
      }
    }
  }

  return tintMask;
}

function tintScarfPixels(
  imageData: ImageData,
  targetHue: number,
  targetSaturation: number,
  tintProfile: CharacterTintProfile,
  lightnessMultiplier: number,
) {
  const { data } = imageData;
  const tintMask = buildWearableTintMask(imageData, tintProfile);
  const mixedTargetSaturation = clampUnit((targetSaturation * 0.78) + 0.18);
  const sourceSaturationMix = tintProfile.sourceSaturationMix ?? 0.2;
  const targetSaturationMix = tintProfile.targetSaturationMix ?? 0.94;
  const targetSaturationBoost = tintProfile.targetSaturationBoost ?? 1;
  const minOutputSaturation = tintProfile.minOutputSaturation ?? 0.55;
  const lightnessScale = tintProfile.lightnessScale ?? 0.9;
  const minOutputLightness = tintProfile.minOutputLightness ?? 0.06;
  const maxOutputLightness = tintProfile.maxOutputLightness ?? 0.82;
  const boostedTargetSaturation = clampUnit(mixedTargetSaturation * targetSaturationBoost);

  for (let pixelIndex = 0; pixelIndex < tintMask.length; pixelIndex += 1) {
    if (tintMask[pixelIndex] === 0) {
      continue;
    }

    const offset = pixelIndex * 4;
    const [, saturation, lightness] = rgbToHsl(
      data[offset],
      data[offset + 1],
      data[offset + 2],
    );

    const blendedSaturation = clampUnit(
      Math.max(
        minOutputSaturation,
        (saturation * sourceSaturationMix) + (boostedTargetSaturation * targetSaturationMix),
      ),
    );
    const blendedLightness = clampUnit(
      Math.min(
        maxOutputLightness,
        Math.max(minOutputLightness, lightness * lightnessScale * lightnessMultiplier),
      ),
    );
    const [nextRed, nextGreen, nextBlue] = hslToRgb(targetHue, blendedSaturation, blendedLightness);
    data[offset] = nextRed;
    data[offset + 1] = nextGreen;
    data[offset + 2] = nextBlue;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load character image for tinting."));
    image.src = src;
  });
}

async function createTintedWearableSrc(
  baseSrc: string,
  targetHex: string,
  tintProfile: CharacterTintProfile,
  lightnessMultiplier: number,
): Promise<string> {
  const cacheKey = `${baseSrc}::${targetHex}::${lightnessMultiplier.toFixed(3)}`;
  const cached = tintedSrcCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const targetRgb = hexToRgb(targetHex);
  if (!targetRgb) {
    return baseSrc;
  }

  const image = await loadImage(baseSrc);
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (!width || !height) {
    return baseSrc;
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return baseSrc;
  }

  context.drawImage(image, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);
  const [targetHue, targetSaturation] = rgbToHsl(targetRgb[0], targetRgb[1], targetRgb[2]);
  tintScarfPixels(imageData, targetHue, targetSaturation, tintProfile, lightnessMultiplier);
  context.putImageData(imageData, 0, 0);

  const tintedSrc = canvas.toDataURL("image/png");
  tintedSrcCache.set(cacheKey, tintedSrc);
  return tintedSrc;
}

export default function CharacterAvatar({
  characterId,
  primaryColorId,
  variant = "profile",
  frame = 1,
  autoBlink = false,
  unoptimized,
  alt,
  ...imageProps
}: CharacterAvatarProps) {
  const normalizedCharacterId = normalizeCharacterId(characterId);
  const normalizedPrimaryColorId = normalizePrimaryColorId(primaryColorId);
  const characterWearableColorHex = getCharacterWearableHex(normalizedPrimaryColorId);
  const characterWearableLightnessMultiplier = getCharacterWearableLightnessMultiplier(normalizedPrimaryColorId);
  const [blinkClosed, setBlinkClosed] = useState<boolean>(false);

  useEffect(() => {
    if (!autoBlink || variant !== "profile") {
      setBlinkClosed(false);
      return;
    }

    let active = true;
    let openBlinkTimeoutId: number | null = null;
    let closeBlinkTimeoutId: number | null = null;

    const nextBlinkDelayMs = () => Math.floor(
      PROFILE_BLINK_MIN_DELAY_MS +
      (Math.random() * (PROFILE_BLINK_MAX_DELAY_MS - PROFILE_BLINK_MIN_DELAY_MS)),
    );

    const scheduleNextBlink = () => {
      openBlinkTimeoutId = window.setTimeout(() => {
        if (!active) {
          return;
        }
        setBlinkClosed(true);
        closeBlinkTimeoutId = window.setTimeout(() => {
          if (!active) {
            return;
          }
          setBlinkClosed(false);
          scheduleNextBlink();
        }, PROFILE_BLINK_CLOSED_MS);
      }, nextBlinkDelayMs());
    };

    scheduleNextBlink();
    return () => {
      active = false;
      if (openBlinkTimeoutId != null) {
        window.clearTimeout(openBlinkTimeoutId);
      }
      if (closeBlinkTimeoutId != null) {
        window.clearTimeout(closeBlinkTimeoutId);
      }
      setBlinkClosed(false);
    };
  }, [autoBlink, variant]);

  const effectiveVariant: CharacterAvatarVariant = (
    variant === "profile" && autoBlink && blinkClosed
      ? "profile_blink"
      : variant
  );

  const baseSrc = useMemo(() => (
    effectiveVariant === "waving"
      ? getCharacterWavingImageSrc(normalizedCharacterId, frame)
      : effectiveVariant === "thumbsup"
        ? getCharacterThumbsupImageSrc(normalizedCharacterId, frame)
        : effectiveVariant === "celebration"
          ? getCharacterCelebrationImageSrc(normalizedCharacterId, frame)
        : effectiveVariant === "profile_blink"
          ? getCharacterProfileBlinkImageSrc(normalizedCharacterId)
        : getCharacterProfileImageSrc(normalizedCharacterId)
  ), [effectiveVariant, frame, normalizedCharacterId]);

  const tintProfile = useMemo(
    () => getTintProfileForVariant(normalizedCharacterId, effectiveVariant),
    [effectiveVariant, normalizedCharacterId],
  );
  const shouldTintWearable = tintProfile != null;
  const [renderSrc, setRenderSrc] = useState<string>(baseSrc);

  useEffect(() => {
    let active = true;
    if (!shouldTintWearable || !tintProfile) {
      setRenderSrc(baseSrc);
      return () => {
        active = false;
      };
    }

    const cacheKey = `${baseSrc}::${characterWearableColorHex}::${characterWearableLightnessMultiplier.toFixed(3)}`;
    const cached = tintedSrcCache.get(cacheKey);
    if (cached) {
      setRenderSrc(cached);
      return () => {
        active = false;
      };
    }

    // Keep the previous tinted frame while the next tinted frame is generated.
    // This avoids a visible color flicker back to the untinted base sprite.
    void createTintedWearableSrc(
      baseSrc,
      characterWearableColorHex,
      tintProfile,
      characterWearableLightnessMultiplier,
    )
      .then((nextSrc) => {
        if (active) {
          setRenderSrc(nextSrc);
        }
      })
      .catch(() => {
        if (active) {
          setRenderSrc((previous) => previous || baseSrc);
        }
      });

    return () => {
      active = false;
    };
  }, [
    baseSrc,
    characterWearableColorHex,
    characterWearableLightnessMultiplier,
    shouldTintWearable,
    tintProfile,
  ]);

  return (
    <Image
      {...imageProps}
      src={renderSrc}
      alt={alt ?? ""}
      unoptimized={Boolean(unoptimized || renderSrc.startsWith("data:image/"))}
    />
  );
}
