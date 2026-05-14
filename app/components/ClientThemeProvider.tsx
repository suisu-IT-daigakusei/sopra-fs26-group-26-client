"use client";

import { App as AntdApp, ConfigProvider, theme } from "antd";
import { useApi } from "@/hooks/useApi";
import useLocalStorage from "@/hooks/useLocalStorage";
import type { User } from "@/types/user";
import {
  USER_DEFAULT_APPEARANCE_MODE,
  USER_DEFAULT_PRIMARY_COLOR_ID,
  getAppearanceContainerBackgroundHex,
  getAppearanceTextColorHex,
  getPrimaryColorHex,
  normalizeAppearanceMode,
  normalizePrimaryColorId,
  resolveEffectiveAppearance,
} from "@/utils/userSettings";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

const PRIMARY_COLOR_STORAGE_KEY = "primaryColorId";
const APPEARANCE_STORAGE_KEY = "appearanceMode";

type ClientThemeProviderProps = {
  children: React.ReactNode;
};

const DEFAULT_PUBLIC_PRIMARY_COLOR_HEX = "#e8a87c";
const DEFAULT_PUBLIC_TEXT_COLOR_HEX = "#f2f2f2";

function darkenHexColor(hex: string, factor: number): string {
  const normalized = String(hex).trim().replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return hex;
  }
  const channel = (start: number) => parseInt(normalized.slice(start, start + 2), 16);
  const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
  const r = clamp(channel(0) * factor);
  const g = clamp(channel(2) * factor);
  const b = clamp(channel(4) * factor);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

export default function ClientThemeProvider({ children }: ClientThemeProviderProps) {
  const api = useApi();
  const pathname = usePathname();
  const { value: token } = useLocalStorage<string>("token", "");
  const { value: userId } = useLocalStorage<string>("userId", "");
  const { value: storedPrimaryColorId, set: setStoredPrimaryColorId } = useLocalStorage<string>(
    PRIMARY_COLOR_STORAGE_KEY,
    USER_DEFAULT_PRIMARY_COLOR_ID,
  );
  const { value: storedAppearanceMode, set: setStoredAppearanceMode } = useLocalStorage<string>(
    APPEARANCE_STORAGE_KEY,
    USER_DEFAULT_APPEARANCE_MODE,
  );
  const [prefersSystemDark, setPrefersSystemDark] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => setPrefersSystemDark(mediaQuery.matches);
    apply();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", apply);
      return () => mediaQuery.removeEventListener("change", apply);
    }

    mediaQuery.addListener(apply);
    return () => mediaQuery.removeListener(apply);
  }, []);

  useEffect(() => {
    const authToken = token.trim();
    const uid = userId.trim();

    if (!authToken || !uid) {
      return;
    }

    let active = true;
    const syncPrimaryColor = async () => {
      try {
        const fetchedUser = await api.getWithAuth<User>(
          `/users/${encodeURIComponent(uid)}`,
          authToken,
        );
        if (!active) {
          return;
        }
        setStoredPrimaryColorId(normalizePrimaryColorId(fetchedUser?.primaryColorId));
        setStoredAppearanceMode(normalizeAppearanceMode(fetchedUser?.appearanceMode));
      } catch {
        // keep current local values on transient fetch failures
      }
    };

    void syncPrimaryColor();

    return () => {
      active = false;
    };
  }, [api, setStoredAppearanceMode, setStoredPrimaryColorId, token, userId]);

  const isAuthenticated = token.trim().length > 0 && userId.trim().length > 0;
  const isAuthScreen = pathname === "/login";
  const normalizedPrimaryColorId = normalizePrimaryColorId(storedPrimaryColorId);
  const normalizedAppearanceMode = normalizeAppearanceMode(storedAppearanceMode);
  const useUserTheme = isAuthenticated && !isAuthScreen;
  const effectiveAppearance = resolveEffectiveAppearance(normalizedAppearanceMode, prefersSystemDark);
  const useLightAppearance = useUserTheme && effectiveAppearance === "light";
  const primaryColorHex = useUserTheme
    ? getPrimaryColorHex(normalizedPrimaryColorId)
    : DEFAULT_PUBLIC_PRIMARY_COLOR_HEX;
  const primaryHoverColorHex = darkenHexColor(primaryColorHex, 0.84);
  const textColorHex = useUserTheme
    ? getAppearanceTextColorHex(normalizedAppearanceMode, prefersSystemDark)
    : DEFAULT_PUBLIC_TEXT_COLOR_HEX;
  const containerBackgroundHex = useUserTheme
    ? getAppearanceContainerBackgroundHex(normalizedAppearanceMode, prefersSystemDark)
    : "#16181D";
  useEffect(() => {
    if (!useUserTheme || typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, normalizedAppearanceMode);
  }, [normalizedAppearanceMode, useUserTheme]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    document.documentElement.style.setProperty("--cabo-primary-color", primaryColorHex);
    document.documentElement.style.setProperty("--cabo-primary-hover-color", primaryHoverColorHex);
    document.documentElement.style.setProperty("--cabo-text-color", textColorHex);
    document.documentElement.classList.toggle("cabo-text-dark", useLightAppearance);
    document.documentElement.style.setProperty("--cabo-appearance-mode", useLightAppearance ? "light" : "dark");
    return () => {
      document.documentElement.classList.remove("cabo-text-dark");
    };
  }, [primaryColorHex, primaryHoverColorHex, textColorHex, useLightAppearance]);

  const antdTheme = useMemo(
    () => ({
      algorithm: theme.defaultAlgorithm,
      token: {
        colorPrimary: primaryColorHex,
        colorText: textColorHex,
        colorTextLightSolid: textColorHex,
        colorLink: primaryColorHex,
        colorTextHeading: primaryColorHex,
        borderRadius: 8,
        fontSize: 16,
        colorBgContainer: containerBackgroundHex,
      },
      components: {
        Button: {
          colorPrimary: primaryColorHex,
          primaryColor: textColorHex,
          algorithm: true,
          controlHeight: 38,
        },
        Input: {
          colorBorder: useLightAppearance ? "#a7afba" : "gray",
          colorBgContainer: containerBackgroundHex,
          colorTextPlaceholder: useLightAppearance ? "#616c7d" : "#888888",
          algorithm: false,
        },
        Form: {
          labelColor: textColorHex,
          algorithm: theme.defaultAlgorithm,
        },
        Card: {},
      },
    }),
    [containerBackgroundHex, primaryColorHex, textColorHex, useLightAppearance],
  );

  return (
    <ConfigProvider theme={antdTheme}>
      <AntdApp>{children}</AntdApp>
    </ConfigProvider>
  );
}
