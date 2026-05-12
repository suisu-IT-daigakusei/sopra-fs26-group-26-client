"use client";

import Image, { type ImageProps } from "next/image";
import { useEffect, useMemo, useState } from "react";
import {
  getCharacterProfileImageSrc,
  getCharacterThumbsupImageSrc,
  getCharacterWavingImageSrc,
  getPrimaryColorHex,
  normalizeCharacterId,
  normalizePrimaryColorId,
} from "@/utils/userSettings";

type CharacterAvatarVariant = "profile" | "waving" | "thumbsup";

type CharacterAvatarProps = Omit<ImageProps, "src"> & {
  characterId: unknown;
  primaryColorId?: unknown;
  variant?: CharacterAvatarVariant;
  frame?: number;
};

const TINTED_SCARF_CHARACTER_ID = "char01";
const SCARF_REGION_START_Y_RATIO = 0.42;
const SCARF_HUE_MIN = 338;
const SCARF_HUE_MAX = 20;
const SCARF_MIN_SATURATION = 0.32;
const SCARF_MIN_LIGHTNESS = 0.12;
const SCARF_MAX_LIGHTNESS = 0.82;
const tintedSrcCache = new Map<string, string>();

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

function isScarfHue(hue: number): boolean {
  return hue >= SCARF_HUE_MIN || hue <= SCARF_HUE_MAX;
}

function tintScarfPixels(
  imageData: ImageData,
  targetHue: number,
  targetSaturation: number,
) {
  const { data, width, height } = imageData;
  const startY = Math.floor(height * SCARF_REGION_START_Y_RATIO);
  const mixedTargetSaturation = Math.min(1, Math.max(0, (targetSaturation * 0.72) + 0.2));

  for (let y = startY; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = ((y * width) + x) * 4;
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
        !isScarfHue(hue) ||
        saturation < SCARF_MIN_SATURATION ||
        lightness < SCARF_MIN_LIGHTNESS ||
        lightness > SCARF_MAX_LIGHTNESS
      ) {
        continue;
      }

      const blendedSaturation = Math.min(1, Math.max(0, (saturation * 0.45) + (mixedTargetSaturation * 0.65)));
      const [nextRed, nextGreen, nextBlue] = hslToRgb(targetHue, blendedSaturation, lightness);
      data[offset] = nextRed;
      data[offset + 1] = nextGreen;
      data[offset + 2] = nextBlue;
    }
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

async function createTintedScarfSrc(baseSrc: string, targetHex: string): Promise<string> {
  const cacheKey = `${baseSrc}::${targetHex}`;
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
  tintScarfPixels(imageData, targetHue, targetSaturation);
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
  unoptimized,
  alt,
  ...imageProps
}: CharacterAvatarProps) {
  const normalizedCharacterId = normalizeCharacterId(characterId);
  const normalizedPrimaryColorId = normalizePrimaryColorId(primaryColorId);
  const scarfColorHex = getPrimaryColorHex(normalizedPrimaryColorId);

  const baseSrc = useMemo(() => (
    variant === "waving"
      ? getCharacterWavingImageSrc(normalizedCharacterId, frame)
      : variant === "thumbsup"
        ? getCharacterThumbsupImageSrc(normalizedCharacterId, frame)
        : getCharacterProfileImageSrc(normalizedCharacterId)
  ), [frame, normalizedCharacterId, variant]);

  const shouldTintScarf = normalizedCharacterId === TINTED_SCARF_CHARACTER_ID;
  const [renderSrc, setRenderSrc] = useState<string>(baseSrc);

  useEffect(() => {
    let active = true;
    if (!shouldTintScarf) {
      setRenderSrc(baseSrc);
      return () => {
        active = false;
      };
    }

    const cacheKey = `${baseSrc}::${scarfColorHex}`;
    const cached = tintedSrcCache.get(cacheKey);
    if (cached) {
      setRenderSrc(cached);
      return () => {
        active = false;
      };
    }

    // Keep the previous tinted frame while the next tinted frame is generated.
    // This avoids a visible "color flicker" back to the untinted base scarf.
    void createTintedScarfSrc(baseSrc, scarfColorHex)
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
  }, [baseSrc, scarfColorHex, shouldTintScarf]);

  return (
    <Image
      {...imageProps}
      src={renderSrc}
      alt={alt ?? ""}
      unoptimized={Boolean(unoptimized || renderSrc.startsWith("data:image/"))}
    />
  );
}
