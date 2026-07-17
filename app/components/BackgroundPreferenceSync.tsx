"use client";

import { useApi } from "@/hooks/useApi";
import useLocalStorage from "@/hooks/useLocalStorage";
import type { User } from "@/types/user";
import {
  USER_DEFAULT_BACKGROUND_FILE,
  USER_DEFAULT_BACKGROUND_OPTIONS,
  backgroundFileToCssUrl,
  resolveBackgroundFile,
  type BackgroundOption,
} from "@/utils/userSettings";
import { useEffect, useMemo, useState } from "react";

type BackgroundOptionsResponse = {
  backgrounds?: BackgroundOption[];
  availableFiles?: string[];
};

const MENU_BACKGROUND_STORAGE_KEY = "menuBackgroundAsset";
const GAME_BACKGROUND_STORAGE_KEY = "gameBackgroundAsset";

function setCssBackgroundVariable(variableName: string, backgroundFile: string) {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.style.setProperty(variableName, backgroundFileToCssUrl(backgroundFile));
}

export default function BackgroundPreferenceSync() {
  const api = useApi();
  const { value: token } = useLocalStorage<string>("token", "");
  const { value: userId } = useLocalStorage<string>("userId", "");
  const [availableFiles, setAvailableFiles] = useState<string[]>(
    USER_DEFAULT_BACKGROUND_OPTIONS.map((entry) => entry.id),
  );

  const availableFilesSet = useMemo(() => new Set(availableFiles), [availableFiles]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const cachedMenu = window.localStorage.getItem(MENU_BACKGROUND_STORAGE_KEY) ?? USER_DEFAULT_BACKGROUND_FILE;
    const cachedGame = window.localStorage.getItem(GAME_BACKGROUND_STORAGE_KEY) ?? USER_DEFAULT_BACKGROUND_FILE;
    setCssBackgroundVariable("--cabo-menu-background-image", cachedMenu);
    setCssBackgroundVariable("--cabo-game-background-image", cachedGame);
  }, []);

  useEffect(() => {
    let active = true;
    const loadBackgroundOptions = async () => {
      try {
        const response = await fetch("/api/background-options", {
          method: "GET",
          cache: "force-cache",
        });
        if (!response.ok) {
          return;
        }
        const payload = await response.json() as BackgroundOptionsResponse;
        if (!active) {
          return;
        }
        const files = Array.isArray(payload.availableFiles)
          ? payload.availableFiles.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean)
          : [];
        if (files.length > 0) {
          setAvailableFiles(files);
        }
      } catch {
        // ignore and keep defaults
      }
    };

    void loadBackgroundOptions();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const normalizedToken = token.trim();
    const normalizedUserId = userId.trim();

    if (!normalizedToken || !normalizedUserId) {
      const fallback = resolveBackgroundFile(USER_DEFAULT_BACKGROUND_FILE, availableFilesSet);
      setCssBackgroundVariable("--cabo-menu-background-image", fallback);
      setCssBackgroundVariable("--cabo-game-background-image", fallback);
      return;
    }

    let active = true;
    const sync = async () => {
      try {
        const fetchedUser = await api.getWithAuth<User>(
          `/users/${encodeURIComponent(normalizedUserId)}`,
          normalizedToken,
        );
        if (!active) {
          return;
        }

        const resolvedMenuBackground = resolveBackgroundFile(
          fetchedUser?.menuBackgroundId,
          availableFilesSet,
        );
        const resolvedGameBackground = resolveBackgroundFile(
          fetchedUser?.gameBackgroundId,
          availableFilesSet,
        );

        if (typeof window !== "undefined") {
          window.localStorage.setItem(MENU_BACKGROUND_STORAGE_KEY, resolvedMenuBackground);
          window.localStorage.setItem(GAME_BACKGROUND_STORAGE_KEY, resolvedGameBackground);
        }
        setCssBackgroundVariable("--cabo-menu-background-image", resolvedMenuBackground);
        setCssBackgroundVariable("--cabo-game-background-image", resolvedGameBackground);
      } catch {
        const fallback = resolveBackgroundFile(USER_DEFAULT_BACKGROUND_FILE, availableFilesSet);
        setCssBackgroundVariable("--cabo-menu-background-image", fallback);
        setCssBackgroundVariable("--cabo-game-background-image", fallback);
      }
    };

    void sync();
    return () => {
      active = false;
    };
  }, [api, availableFilesSet, token, userId]);

  return null;
}
