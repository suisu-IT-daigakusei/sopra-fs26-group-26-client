"use client";

import { App as AntdApp, ConfigProvider, theme } from "antd";
import { useApi } from "@/hooks/useApi";
import useLocalStorage from "@/hooks/useLocalStorage";
import type { User } from "@/types/user";
import {
  USER_DEFAULT_PRIMARY_COLOR_ID,
  USER_DEFAULT_TEXT_COLOR_ID,
  getPrimaryColorHex,
  getTextColorHex,
  normalizePrimaryColorId,
  normalizeTextColorId,
} from "@/utils/userSettings";
import { usePathname } from "next/navigation";
import { useEffect, useMemo } from "react";

const PRIMARY_COLOR_STORAGE_KEY = "primaryColorId";
const TEXT_COLOR_STORAGE_KEY = "textColorId";

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
  const { value: storedTextColorId, set: setStoredTextColorId } = useLocalStorage<string>(
    TEXT_COLOR_STORAGE_KEY,
    USER_DEFAULT_TEXT_COLOR_ID,
  );

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
        setStoredTextColorId(normalizeTextColorId(fetchedUser?.textColorId));
      } catch {
        // keep current local values on transient fetch failures
      }
    };

    void syncPrimaryColor();

    return () => {
      active = false;
    };
  }, [api, setStoredPrimaryColorId, setStoredTextColorId, token, userId]);

  const isAuthenticated = token.trim().length > 0 && userId.trim().length > 0;
  const isAuthScreen = pathname === "/login" || pathname === "/register";
  const normalizedPrimaryColorId = normalizePrimaryColorId(storedPrimaryColorId);
  const normalizedTextColorId = normalizeTextColorId(storedTextColorId);
  const hasCustomTheme =
    normalizedPrimaryColorId !== USER_DEFAULT_PRIMARY_COLOR_ID ||
    normalizedTextColorId !== USER_DEFAULT_TEXT_COLOR_ID;
  const useUserTheme = isAuthenticated && !isAuthScreen && hasCustomTheme;
  const useDarkTextTheme = useUserTheme && normalizedTextColorId === "dark";
  const primaryColorHex = useUserTheme
    ? getPrimaryColorHex(normalizedPrimaryColorId)
    : DEFAULT_PUBLIC_PRIMARY_COLOR_HEX;
  const primaryHoverColorHex = darkenHexColor(primaryColorHex, 0.84);
  const textColorHex = useUserTheme
    ? getTextColorHex(normalizedTextColorId)
    : DEFAULT_PUBLIC_TEXT_COLOR_HEX;
  const containerBackgroundHex = useDarkTextTheme ? "#f7f8fa" : "#16181D";

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    document.documentElement.style.setProperty("--cabo-primary-color", primaryColorHex);
    document.documentElement.style.setProperty("--cabo-primary-hover-color", primaryHoverColorHex);
    document.documentElement.style.setProperty("--cabo-text-color", textColorHex);
    document.documentElement.classList.toggle("cabo-text-dark", useDarkTextTheme);
    return () => {
      document.documentElement.classList.remove("cabo-text-dark");
    };
  }, [primaryColorHex, primaryHoverColorHex, textColorHex, useDarkTextTheme]);

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
          colorBorder: useDarkTextTheme ? "#a7afba" : "gray",
          colorBgContainer: containerBackgroundHex,
          colorTextPlaceholder: useDarkTextTheme ? "#616c7d" : "#888888",
          algorithm: false,
        },
        Form: {
          labelColor: textColorHex,
          algorithm: theme.defaultAlgorithm,
        },
        Card: {},
      },
    }),
    [containerBackgroundHex, primaryColorHex, textColorHex, useDarkTextTheme],
  );

  return (
    <ConfigProvider theme={antdTheme}>
      <AntdApp>{children}</AntdApp>
    </ConfigProvider>
  );
}
