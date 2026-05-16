"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useApi } from "@/hooks/useApi";
import useLocalStorage from "@/hooks/useLocalStorage";
import type { User } from "@/types/user";
import CharacterAvatar from "@/components/CharacterAvatar";
import InlineMusicPlayer from "@/components/InlineMusicPlayer";
import { syncSharedCaboMusicSettings } from "@/hooks/useCaboMusicPlayer";
import {
  type BackgroundOption,
  USER_DEFAULT_BACKGROUND_OPTIONS,
  USER_DEFAULT_CHARACTER_ID,
  USER_DEFAULT_GAME_BACKGROUND_ID,
  USER_DEFAULT_MENU_BACKGROUND_ID,
  USER_DEFAULT_MUSIC_VOLUME,
  USER_DEFAULT_APPEARANCE_MODE,
  USER_DEFAULT_PRIMARY_COLOR_ID,
  USER_DEFAULT_SOUND_EFFECTS_VOLUME,
  USER_APPEARANCE_OPTIONS,
  USER_PRIMARY_COLOR_OPTIONS,
  USER_PRIORITY_COLOR_OPTIONS,
  USER_PRIORITY_LABELS,
  USER_PROFILE_CHARACTER_OPTIONS,
  appearanceModeToStorageValue,
  backgroundFileToCssUrl,
  hasDuplicatePriorityColors,
  normalizeCharacterId,
  normalizeAppearanceMode,
  normalizeMusicBlacklist,
  normalizePreferredColorPriority,
  normalizePrimaryColorId,
  normalizeVolume,
  resolveEffectiveAppearance,
  resolveBackgroundFile,
} from "@/utils/userSettings";
import { Button, Card, Form, Input, Select, Slider, Switch, message } from "antd";
import {
  type AuthValidationRules,
  fetchAuthValidationRules,
  getFallbackAuthValidationRules,
  sanitizePasswordInput,
  validatePassword,
} from "@/utils/authValidation";
import { showTimedConfirmation } from "@/utils/timedConfirmation";
import {
  fetchConfiguredMusicFilenames,
  type MusicTrack,
  GAME_MUSIC_TRACK_FILENAMES,
  getTrackBlacklistKeys,
  getTrackDisplayTitle,
  resolveAvailableMusicTracks,
} from "@/utils/musicPlayer";

const BIO_MAX_LENGTH = 180;
const DEFAULT_BIO = "This player hasn't added a bio yet.";
const SETTINGS_PASSWORD_HINT = "Password must be 8-32 characters, include at least one uppercase letter and one special symbol and use only A-Z, a-z, 0-9 and !\"#$%&'()*+,-./:;<=>?@[\\\\]^_`{|}~.";

const SOUND_SLIDER_MARKS: Record<number, string> = Array.from({ length: 11 }, (_, index) => index * 10)
  .reduce<Record<number, string>>((acc, value) => {
    acc[value] = String(value);
    return acc;
  }, {});
const SOUND_SLIDER_TOOLTIP = { open: false } as const;

function areStringArraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }

  return true;
}

function normalizeTagList(values: string[]): string[] {
  return values
    .map((value) => String(value).trim())
    .filter((value) => value.length > 0)
    .sort((left, right) => left.localeCompare(right));
}

function normalizeBlacklistKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function resolveBlacklistValueToTrackId(
  rawValue: string,
  tracks: MusicTrack[],
): string {
  const normalizedRawValue = normalizeBlacklistKey(rawValue);
  if (!normalizedRawValue) {
    return "";
  }

  for (const track of tracks) {
    const keys = getTrackBlacklistKeys(track);
    if (keys.some((key) => normalizeBlacklistKey(key) === normalizedRawValue)) {
      return track.id;
    }
  }

  return rawValue.trim();
}

function canonicalizeMusicBlacklistValues(
  rawValues: unknown,
  tracks: MusicTrack[],
): string[] {
  const normalizedValues = normalizeMusicBlacklist(rawValues);
  if (normalizedValues.length === 0) {
    return [];
  }

  const uniqueValues = new Set<string>();
  const canonical: string[] = [];
  for (const value of normalizedValues) {
    const mappedValue = resolveBlacklistValueToTrackId(value, tracks);
    const normalizedMappedValue = normalizeBlacklistKey(mappedValue);
    if (!normalizedMappedValue || uniqueValues.has(normalizedMappedValue)) {
      continue;
    }
    uniqueValues.add(normalizedMappedValue);
    canonical.push(mappedValue);
  }
  return canonical;
}

type GraphicsSelectionState = {
  tutorialsEnabled: boolean;
  selectedAppearance: string;
  selectedPrimaryColor: string;
  selectedMenuBackground: string;
  selectedGameBackground: string;
};

type SoundsSelectionState = {
  musicVolume: number;
  soundEffectsVolume: number;
  musicBlacklist: string[];
};

type BackgroundOptionsResponse = {
  backgrounds?: BackgroundOption[];
  availableFiles?: string[];
};

const MENU_BACKGROUND_STORAGE_KEY = "menuBackgroundAsset";
const GAME_BACKGROUND_STORAGE_KEY = "gameBackgroundAsset";
const PRIMARY_COLOR_STORAGE_KEY = "primaryColorId";
const APPEARANCE_STORAGE_KEY = "appearanceMode";

const SettingsPage = () => {
  const router = useRouter();
  const apiService = useApi();
  const [form] = Form.useForm();
  const [authRules, setAuthRules] = useState<AuthValidationRules>(getFallbackAuthValidationRules());

  const [savingPassword, setSavingPassword] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [editingBio, setEditingBio] = useState(false);
  const [bioValue, setBioValue] = useState("");
  const [bioDraft, setBioDraft] = useState("");

  const [selectedCharacter, setSelectedCharacter] = useState<string>(USER_DEFAULT_CHARACTER_ID);
  const [savedCharacter, setSavedCharacter] = useState<string>(USER_DEFAULT_CHARACTER_ID);
  const [colorPriority, setColorPriority] = useState<string[]>(normalizePreferredColorPriority(null));
  const [savedColorPriority, setSavedColorPriority] = useState<string[]>(normalizePreferredColorPriority(null));
  const [backgroundOptions, setBackgroundOptions] = useState<BackgroundOption[]>(USER_DEFAULT_BACKGROUND_OPTIONS);
  const [availableBackgroundFiles, setAvailableBackgroundFiles] = useState<string[]>(
    USER_DEFAULT_BACKGROUND_OPTIONS
      .map((option) => String(option.id ?? "").trim().toLowerCase())
      .filter((value, index, allValues) => value.length > 0 && allValues.indexOf(value) === index),
  );

  const [selectedMenuBackground, setSelectedMenuBackground] = useState<string>(USER_DEFAULT_MENU_BACKGROUND_ID);
  const [selectedGameBackground, setSelectedGameBackground] = useState<string>(USER_DEFAULT_GAME_BACKGROUND_ID);
  const [selectedPrimaryColor, setSelectedPrimaryColor] = useState<string>(USER_DEFAULT_PRIMARY_COLOR_ID);
  const [selectedAppearance, setSelectedAppearance] = useState<string>(USER_DEFAULT_APPEARANCE_MODE);
  const [tutorialsEnabled, setTutorialsEnabled] = useState(true);
  const [savedGraphicsSelection, setSavedGraphicsSelection] = useState<GraphicsSelectionState>({
    tutorialsEnabled: true,
    selectedAppearance: USER_DEFAULT_APPEARANCE_MODE,
    selectedPrimaryColor: USER_DEFAULT_PRIMARY_COLOR_ID,
    selectedMenuBackground: USER_DEFAULT_MENU_BACKGROUND_ID,
    selectedGameBackground: USER_DEFAULT_GAME_BACKGROUND_ID,
  });
  const [savingGraphics, setSavingGraphics] = useState(false);
  const [prefersSystemDark, setPrefersSystemDark] = useState(true);

  const [musicVolume, setMusicVolume] = useState(USER_DEFAULT_MUSIC_VOLUME);
  const [soundEffectsVolume, setSoundEffectsVolume] = useState(USER_DEFAULT_SOUND_EFFECTS_VOLUME);
  const [musicBlacklist, setMusicBlacklist] = useState<string[]>([]);
  const [availableMusicTracks, setAvailableMusicTracks] = useState<MusicTrack[]>([]);
  const [savedSoundsSelection, setSavedSoundsSelection] = useState<SoundsSelectionState>({
    musicVolume: USER_DEFAULT_MUSIC_VOLUME,
    soundEffectsVolume: USER_DEFAULT_SOUND_EFFECTS_VOLUME,
    musicBlacklist: [] as string[],
  });
  const [savingSounds, setSavingSounds] = useState(false);

  const { value: userId, clear: clearUserId } = useLocalStorage<string>("userId", "");
  const { value: token, clear: clearToken } = useLocalStorage<string>("token", "");
  const { set: setStoredPrimaryColorId } = useLocalStorage<string>(
    PRIMARY_COLOR_STORAGE_KEY,
    USER_DEFAULT_PRIMARY_COLOR_ID,
  );
  const { set: setStoredAppearanceMode } = useLocalStorage<string>(
    APPEARANCE_STORAGE_KEY,
    USER_DEFAULT_APPEARANCE_MODE,
  );
  const skipUnsavedGuardRef = useRef(false);
  const passwordValue = Form.useWatch("password", form);
  const confirmPasswordValue = Form.useWatch("confirmPassword", form);
  const availableBackgroundFilesSet = useMemo(
    () => new Set<string>(availableBackgroundFiles),
    [availableBackgroundFiles],
  );

  useEffect(() => {
    if (!userId.trim()) {
      router.replace("/login");
    }
  }, [userId, router]);

  useEffect(() => {
    let active = true;
    void fetchAuthValidationRules(apiService).then((rules) => {
      if (!active) {
        return;
      }
      setAuthRules(rules);
    });
    return () => {
      active = false;
    };
  }, [apiService]);

  useEffect(() => {
    let active = true;

    const loadBackgroundOptions = async () => {
      try {
        const response = await fetch("/api/background-options", {
          method: "GET",
          cache: "no-store",
        });
        if (!response.ok) {
          return;
        }
        const payload = await response.json() as BackgroundOptionsResponse;
        if (!active || !Array.isArray(payload.backgrounds)) {
          return;
        }

        const seenIds = new Set<string>();
        const nextOptions: BackgroundOption[] = [];
        for (const option of payload.backgrounds) {
          const id = String(option?.id ?? "").trim().toLowerCase();
          const src = String(option?.src ?? "").trim();
          const label = String(option?.label ?? "").trim();
          if (!id || !src || seenIds.has(id)) {
            continue;
          }
          seenIds.add(id);
          nextOptions.push({
            id,
            src,
            label: label || id,
          });
        }

        if (nextOptions.length > 0) {
          setBackgroundOptions(nextOptions);
        }

        const payloadAvailableFiles = Array.isArray(payload.availableFiles)
          ? payload.availableFiles
            .map((value) => String(value ?? "").trim().toLowerCase())
            .filter((value, index, allValues) => value.length > 0 && allValues.indexOf(value) === index)
          : [];
        if (payloadAvailableFiles.length > 0) {
          setAvailableBackgroundFiles(payloadAvailableFiles);
        } else if (nextOptions.length > 0) {
          setAvailableBackgroundFiles(nextOptions.map((entry) => entry.id));
        }
      } catch {
        // keep default local background options
      }
    };

    void loadBackgroundOptions();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadAvailableMusicTracks = async () => {
      try {
        const configuredFilenames = await fetchConfiguredMusicFilenames(GAME_MUSIC_TRACK_FILENAMES);
        const tracks = await resolveAvailableMusicTracks(configuredFilenames);
        if (!active) {
          return;
        }
        setAvailableMusicTracks(tracks);
      } catch {
        if (active) {
          setAvailableMusicTracks([]);
        }
      }
    };
    void loadAvailableMusicTracks();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const uid = userId.trim();
    if (!uid) {
      return;
    }

    let active = true;

    const loadUserProfile = async () => {
      try {
        const authToken = token.trim();
        const fetchedUser = authToken
          ? await apiService.getWithAuth<User>(`/users/${encodeURIComponent(uid)}`, authToken)
          : await apiService.get<User>(`/users/${encodeURIComponent(uid)}`);

        if (!active) {
          return;
        }

        const nextBio = String(fetchedUser?.bio ?? "").trim();
        setBioValue(nextBio);
        setBioDraft(nextBio);

        const nextCharacter = normalizeCharacterId(fetchedUser?.profileCharacterId);
        setSelectedCharacter(nextCharacter);
        setSavedCharacter(nextCharacter);

        const nextPriority = normalizePreferredColorPriority(fetchedUser?.preferredColorPriority);
        setColorPriority(nextPriority);
        setSavedColorPriority(nextPriority);

        const nextMenuBackgroundId = resolveBackgroundFile(
          fetchedUser?.menuBackgroundId,
          availableBackgroundFilesSet,
        );
        const nextGameBackgroundId = resolveBackgroundFile(
          fetchedUser?.gameBackgroundId,
          availableBackgroundFilesSet,
        );
        const nextPrimaryColorId = normalizePrimaryColorId(fetchedUser?.primaryColorId);
        const nextAppearanceMode = normalizeAppearanceMode(fetchedUser?.appearanceMode);
        const nextTutorialsEnabled = fetchedUser?.tutorialsEnabled !== false;
        setTutorialsEnabled(nextTutorialsEnabled);
        setSelectedAppearance(nextAppearanceMode);
        setSelectedMenuBackground(nextMenuBackgroundId);
        setSelectedGameBackground(nextGameBackgroundId);
        setSelectedPrimaryColor(nextPrimaryColorId);
        setStoredPrimaryColorId(nextPrimaryColorId);
        setStoredAppearanceMode(nextAppearanceMode);
        setSavedGraphicsSelection({
          tutorialsEnabled: nextTutorialsEnabled,
          selectedAppearance: nextAppearanceMode,
          selectedPrimaryColor: nextPrimaryColorId,
          selectedMenuBackground: nextMenuBackgroundId,
          selectedGameBackground: nextGameBackgroundId,
        });

        const nextMusicVolume = normalizeVolume(fetchedUser?.musicVolume, USER_DEFAULT_MUSIC_VOLUME);
        const nextEffectsVolume = normalizeVolume(fetchedUser?.soundEffectsVolume, USER_DEFAULT_SOUND_EFFECTS_VOLUME);
        const nextMusicBlacklist = canonicalizeMusicBlacklistValues(
          fetchedUser?.musicBlacklist,
          availableMusicTracks,
        );
        setMusicVolume(nextMusicVolume);
        setSoundEffectsVolume(nextEffectsVolume);
        setMusicBlacklist(nextMusicBlacklist);
        setSavedSoundsSelection({
          musicVolume: nextMusicVolume,
          soundEffectsVolume: nextEffectsVolume,
          musicBlacklist: nextMusicBlacklist,
        });
      } catch {
        if (!active) {
          return;
        }
        setBioValue("");
        setBioDraft("");
        setSelectedCharacter(USER_DEFAULT_CHARACTER_ID);
        setSavedCharacter(USER_DEFAULT_CHARACTER_ID);
        setColorPriority(normalizePreferredColorPriority(null));
        setSavedColorPriority(normalizePreferredColorPriority(null));
        const fallbackMenuBackground = resolveBackgroundFile(
          USER_DEFAULT_MENU_BACKGROUND_ID,
          availableBackgroundFilesSet,
        );
        const fallbackGameBackground = resolveBackgroundFile(
          USER_DEFAULT_GAME_BACKGROUND_ID,
          availableBackgroundFilesSet,
        );
        setSelectedMenuBackground(fallbackMenuBackground);
        setSelectedGameBackground(fallbackGameBackground);
        setSelectedPrimaryColor(USER_DEFAULT_PRIMARY_COLOR_ID);
        setStoredPrimaryColorId(USER_DEFAULT_PRIMARY_COLOR_ID);
        setSelectedAppearance(USER_DEFAULT_APPEARANCE_MODE);
        setStoredAppearanceMode(USER_DEFAULT_APPEARANCE_MODE);
        setTutorialsEnabled(true);
        setSavedGraphicsSelection({
          tutorialsEnabled: true,
          selectedAppearance: USER_DEFAULT_APPEARANCE_MODE,
          selectedPrimaryColor: USER_DEFAULT_PRIMARY_COLOR_ID,
          selectedMenuBackground: fallbackMenuBackground,
          selectedGameBackground: fallbackGameBackground,
        });
        setMusicVolume(USER_DEFAULT_MUSIC_VOLUME);
        setSoundEffectsVolume(USER_DEFAULT_SOUND_EFFECTS_VOLUME);
        setMusicBlacklist([]);
        setSavedSoundsSelection({
          musicVolume: USER_DEFAULT_MUSIC_VOLUME,
          soundEffectsVolume: USER_DEFAULT_SOUND_EFFECTS_VOLUME,
          musicBlacklist: [],
        });
      }
    };

    void loadUserProfile();

    return () => {
      active = false;
    };
  }, [
    apiService,
    availableBackgroundFilesSet,
    availableMusicTracks,
    setStoredAppearanceMode,
    setStoredPrimaryColorId,
    token,
    userId,
  ]);

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
    if (typeof window === "undefined") {
      return;
    }
    const handleBlacklistChanged = (event: Event) => {
      const customEvent = event as CustomEvent<{ musicBlacklist?: unknown }>;
      const nextValues = canonicalizeMusicBlacklistValues(
        customEvent.detail?.musicBlacklist ?? [],
        availableMusicTracks,
      );
      setMusicBlacklist(nextValues);
      setSavedSoundsSelection((previous) => ({
        ...previous,
        musicBlacklist: [...nextValues],
      }));
    };
    window.addEventListener("cabo:music-blacklist-changed", handleBlacklistChanged);
    return () => {
      window.removeEventListener("cabo:music-blacklist-changed", handleBlacklistChanged);
    };
  }, [availableMusicTracks]);

  useEffect(() => {
    if (availableMusicTracks.length === 0) {
      return;
    }
    setMusicBlacklist((previous) => {
      const canonical = canonicalizeMusicBlacklistValues(previous, availableMusicTracks);
      if (areStringArraysEqual(previous, canonical)) {
        return previous;
      }
      return canonical;
    });
    setSavedSoundsSelection((previous) => {
      const canonicalSaved = canonicalizeMusicBlacklistValues(
        previous.musicBlacklist,
        availableMusicTracks,
      );
      if (areStringArraysEqual(previous.musicBlacklist, canonicalSaved)) {
        return previous;
      }
      return {
        ...previous,
        musicBlacklist: canonicalSaved,
      };
    });
  }, [availableMusicTracks]);

  const colorPriorityOptionsByIndex = useMemo(
    () => {
      const colorOptionById = new Map<string, { label: string; hex: string }>(
        USER_PRIMARY_COLOR_OPTIONS.map((entry) => [entry.id, { label: entry.label, hex: entry.hex }]),
      );

      const renderPriorityOptionLabel = (colorId: string) => {
        const option = colorOptionById.get(colorId);
        return (
          <span className="settings-priority-option-label">
            <span className="settings-priority-option-dot" style={{ ["--settings-priority-dot-color" as string]: option?.hex ?? "#7a7f87" }} />
            <span>{option?.label ?? colorId}</span>
          </span>
        );
      };

      return colorPriority.map(() => (
        USER_PRIORITY_COLOR_OPTIONS.map((colorOption) => ({
          value: colorOption,
          label: renderPriorityOptionLabel(colorOption),
          disabled: false,
        }))
      ));
    },
    [colorPriority],
  );

  const shownBio = bioValue.trim().length > 0 ? bioValue : DEFAULT_BIO;
  const normalizedBioDraft = bioDraft.trim();
  const normalizedSavedBio = bioValue.trim();

  const characterDirty = selectedCharacter !== savedCharacter;
  const bioDirty = normalizedBioDraft !== normalizedSavedBio;
  const colorPriorityDirty = !areStringArraysEqual(colorPriority, savedColorPriority);
  const profileDirty = characterDirty || bioDirty || colorPriorityDirty;
  const graphicsDirty =
    tutorialsEnabled !== savedGraphicsSelection.tutorialsEnabled ||
    selectedAppearance !== savedGraphicsSelection.selectedAppearance ||
    selectedPrimaryColor !== savedGraphicsSelection.selectedPrimaryColor ||
    selectedMenuBackground !== savedGraphicsSelection.selectedMenuBackground ||
    selectedGameBackground !== savedGraphicsSelection.selectedGameBackground;
  const normalizedMusicBlacklist = useMemo(
    () => normalizeTagList(musicBlacklist),
    [musicBlacklist],
  );
  const normalizedSavedMusicBlacklist = useMemo(
    () => normalizeTagList(savedSoundsSelection.musicBlacklist),
    [savedSoundsSelection.musicBlacklist],
  );
  const soundsDirty =
    musicVolume !== savedSoundsSelection.musicVolume ||
    soundEffectsVolume !== savedSoundsSelection.soundEffectsVolume ||
    !areStringArraysEqual(normalizedMusicBlacklist, normalizedSavedMusicBlacklist);
  const musicBlacklistSelectOptions = useMemo(() => {
    const options = availableMusicTracks.map((track) => {
      const title = getTrackDisplayTitle(track);
      const label = `${title} (${track.filename})`;
      return {
        value: track.id,
        label,
        searchText: `${title} ${track.filename} ${track.id}`.toLowerCase(),
      };
    });

    const knownValues = new Set(options.map((option) => option.value));
    const unmappedCurrentValues = musicBlacklist
      .map((value) => String(value).trim())
      .filter((value) => value.length > 0 && !knownValues.has(value));
    for (const value of unmappedCurrentValues) {
      options.push({
        value,
        label: value,
        searchText: value.toLowerCase(),
      });
      knownValues.add(value);
    }

    options.sort((left, right) => String(left.label).localeCompare(String(right.label)));
    return options;
  }, [availableMusicTracks, musicBlacklist]);

  const passwordDirty = Boolean(
    String(passwordValue ?? "").trim().length > 0 ||
    String(confirmPasswordValue ?? "").trim().length > 0,
  );
  const passwordDraft = String(passwordValue ?? "");
  const confirmPasswordDraft = String(confirmPasswordValue ?? "");
  const trimmedPasswordDraft = passwordDraft.trim();
  const trimmedConfirmPasswordDraft = confirmPasswordDraft.trim();
  const passwordValidationError = trimmedPasswordDraft.length > 0
    ? validatePassword(passwordDraft, authRules)
    : null;
  const passwordRuleError = Boolean(passwordValidationError);
  const passwordMatches = passwordDraft === confirmPasswordDraft;
  const canSaveProfile =
    profileDirty &&
    !savingProfile &&
    normalizedBioDraft.length <= BIO_MAX_LENGTH &&
    !hasDuplicatePriorityColors(colorPriority);
  const canSaveGraphics = graphicsDirty && !savingGraphics;
  const canSaveSounds = soundsDirty && !savingSounds;
  const canSavePassword =
    passwordDirty &&
    !savingPassword &&
    trimmedPasswordDraft.length > 0 &&
    trimmedConfirmPasswordDraft.length > 0 &&
    !passwordValidationError &&
    passwordMatches;
  const hasUnsavedChanges =
    profileDirty ||
    graphicsDirty ||
    soundsDirty ||
    passwordDirty;

  const confirmLeaveWithUnsavedChanges = useCallback(async (): Promise<boolean> => {
    if (!hasUnsavedChanges) {
      return true;
    }

    return showTimedConfirmation({
      title: "You have unsaved changes. Leave this page and discard them?",
      timeoutSeconds: 10,
      danger: true,
    });
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (skipUnsavedGuardRef.current || !hasUnsavedChanges) {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [hasUnsavedChanges]);

  const handleBioCancel = () => {
    setBioDraft(bioValue);
    setEditingBio(false);
  };

  const updateUserSettings = useCallback(async (payload: Record<string, unknown>) => {
    const uid = userId.trim();
    if (!uid) {
      router.replace("/login");
      return;
    }

    const authToken = token.trim();
    if (authToken) {
      await apiService.putWithAuth<void>(`/users/${encodeURIComponent(uid)}`, payload, authToken);
      return;
    }
    await apiService.put<void>(`/users/${encodeURIComponent(uid)}`, payload);
  }, [apiService, router, token, userId]);

  const handleColorPriorityChange = (index: number, nextColor: string) => {
    setColorPriority((prev) => {
      const next = [...prev];
      const swapIndex = next.findIndex((picked, pickedIndex) => pickedIndex !== index && picked === nextColor);
      if (swapIndex >= 0) {
        const current = next[index];
        next[index] = nextColor;
        next[swapIndex] = current;
      } else {
        next[index] = nextColor;
      }
      return next;
    });
  };

  const handleProfileSave = async () => {
    if (savingProfile) {
      return;
    }

    const nextBio = bioDraft.trim();
    if (nextBio.length > BIO_MAX_LENGTH) {
      message.error(`Bio can be max ${BIO_MAX_LENGTH} characters.`);
      return;
    }

    if (hasDuplicatePriorityColors(colorPriority)) {
      message.error("Each selected preferred color must be unique.");
      return;
    }

    setSavingProfile(true);
    try {
      await updateUserSettings({
        profileCharacterId: selectedCharacter,
        preferredColorPriority: colorPriority,
        bio: nextBio,
      });
      setSavedCharacter(selectedCharacter);
      setSavedColorPriority([...colorPriority]);
      setBioValue(nextBio);
      setBioDraft(nextBio);
      setEditingBio(false);
      message.success("Profile settings saved.");
    } catch (error) {
      if (error instanceof Error) {
        alert(`Could not save profile settings:\n${error.message}`);
      }
    } finally {
      setSavingProfile(false);
    }
  };

  const handleGraphicsSave = async () => {
    if (savingGraphics) {
      return;
    }
    setSavingGraphics(true);
    try {
      await updateUserSettings({
        tutorialsEnabled,
        appearanceMode: appearanceModeToStorageValue(selectedAppearance),
        primaryColorId: selectedPrimaryColor,
        menuBackgroundId: selectedMenuBackground,
        gameBackgroundId: selectedGameBackground,
      });
      setSavedGraphicsSelection({
        tutorialsEnabled,
        selectedAppearance,
        selectedPrimaryColor,
        selectedMenuBackground,
        selectedGameBackground,
      });
      if (typeof window !== "undefined") {
        window.localStorage.setItem(MENU_BACKGROUND_STORAGE_KEY, selectedMenuBackground);
        window.localStorage.setItem(GAME_BACKGROUND_STORAGE_KEY, selectedGameBackground);
      }
      setStoredPrimaryColorId(selectedPrimaryColor);
      setStoredAppearanceMode(selectedAppearance);
      if (typeof document !== "undefined") {
        document.documentElement.style.setProperty(
          "--cabo-menu-background-image",
          backgroundFileToCssUrl(selectedMenuBackground),
        );
        document.documentElement.style.setProperty(
          "--cabo-game-background-image",
          backgroundFileToCssUrl(selectedGameBackground),
        );
      }
      message.success("Graphics settings saved.");
    } catch (error) {
      if (error instanceof Error) {
        alert(`Could not save graphics settings:\n${error.message}`);
      }
    } finally {
      setSavingGraphics(false);
    }
  };

  const effectiveAppearance = resolveEffectiveAppearance(selectedAppearance, prefersSystemDark);
  const isLightAppearance = effectiveAppearance === "light";
  const selectSurfaceClass = isLightAppearance
    ? "settings-select-surface-light"
    : "settings-select-surface-dark";
  const selectDropdownClass = isLightAppearance
    ? "settings-select-dropdown-light"
    : "settings-select-dropdown-dark";

  const handleSoundsSave = async () => {
    if (savingSounds) {
      return;
    }
    setSavingSounds(true);
    try {
      await updateUserSettings({
        musicVolume,
        soundEffectsVolume,
        musicBlacklist: normalizedMusicBlacklist,
      });
      setSavedSoundsSelection({
        musicVolume,
        soundEffectsVolume,
        musicBlacklist: [...normalizedMusicBlacklist],
      });
      syncSharedCaboMusicSettings({
        musicVolume,
        soundEffectsVolume,
        musicBlacklist: normalizedMusicBlacklist,
      });
      message.success("Sound settings saved.");
    } catch (error) {
      if (error instanceof Error) {
        alert(`Could not save sound settings:\n${error.message}`);
      }
    } finally {
      setSavingSounds(false);
    }
  };

  const handlePasswordSave = async () => {
    const uid = userId.trim();
    const password = String(form.getFieldValue("password") ?? "");
    const confirmPassword = String(form.getFieldValue("confirmPassword") ?? "");

    if (!uid) {
      router.replace("/login");
      return;
    }

    if (!password.trim() || !confirmPassword.trim()) {
      message.warning("Please fill in both password fields.");
      return;
    }

    const passwordValidationError = validatePassword(password, authRules);
    if (passwordValidationError) {
      return;
    }

    if (password !== confirmPassword) {
      message.error("Passwords do not match.");
      return;
    }

    setSavingPassword(true);
    try {
      await apiService.put(`/users/${encodeURIComponent(uid)}`, { password });
      message.success("Password updated. Please log in again.");
      clearToken();
      clearUserId();
      skipUnsavedGuardRef.current = true;
      window.location.assign("/login");
    } catch (error) {
      if (error instanceof Error) {
        alert(`Could not save password:\n${error.message}`);
      }
    } finally {
      setSavingPassword(false);
    }
  };

  const handleBack = async () => {
    if (!(await confirmLeaveWithUnsavedChanges())) {
      return;
    }

    skipUnsavedGuardRef.current = true;
    window.setTimeout(() => {
      skipUnsavedGuardRef.current = false;
    }, 1200);
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/dashboard");
  };

  return (
    <div className="cabo-background">
      <div className="login-container">
        <div className="create-lobby-stack dashboard-stack">
          <Card
            className="dashboard-container"
            title={<div className="dashboard-section-title">User Profile</div>}
          >
            <div className="settings-panel">
              <div className="settings-option-block">
                <div className="settings-inline-header">
                  <span className="settings-option-title">Change Profile Picture</span>
                </div>
                <div className="settings-character-scroll" role="listbox" aria-label="Choose profile character">
                  {USER_PROFILE_CHARACTER_OPTIONS.map((character) => (
                    <button
                      key={character.id}
                      type="button"
                      className={`settings-character-tile${selectedCharacter === character.id ? " settings-character-tile-selected" : ""}`}
                      onClick={() => setSelectedCharacter(character.id)}
                      aria-label={character.label}
                    >
                      <CharacterAvatar
                        characterId={character.id}
                        primaryColorId={colorPriority[0]}
                        alt={character.label}
                        fill
                        sizes="84px"
                        className="settings-character-image"
                      />
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-option-block">
                <div className="settings-inline-header">
                  <span className="settings-option-title">
                    Edit Bio <span className="settings-placeholder-note">(max. {BIO_MAX_LENGTH} characters)</span>
                  </span>
                  <span className="settings-inline-actions">
                    {editingBio ? (
                      <Button
                        type="default"
                        className="settings-inline-action-btn"
                        disabled={savingProfile}
                        onClick={handleBioCancel}
                      >
                        Cancel
                      </Button>
                    ) : (
                      <Button
                        type="default"
                        className="settings-inline-action-btn"
                        disabled={savingProfile}
                        onClick={() => setEditingBio(true)}
                      >
                        Edit
                      </Button>
                    )}
                  </span>
                </div>
                {editingBio ? (
                  <Input.TextArea
                    className={`settings-bio-input ${isLightAppearance ? "settings-input-surface-light" : "settings-input-surface-dark"}`}
                    rows={4}
                    value={bioDraft}
                    onChange={(event) => setBioDraft(event.target.value)}
                    maxLength={BIO_MAX_LENGTH}
                    showCount
                    placeholder="Write a short bio"
                  />
                ) : (
                  <p className={`settings-bio-display${shownBio === DEFAULT_BIO ? " settings-bio-display-placeholder" : ""}`}>
                    {shownBio}
                  </p>
                )}
              </div>

              <div className="settings-option-block">
                <div className="settings-inline-header">
                  <span className="settings-option-title">Preferred Character Colors</span>
                </div>
                <p className="settings-preference-note">
                  Your 1st choice sets your character wearable color (scarf, hoodie, etc.), and in lobbies, the color
                  will fall back to your next choices if a color is already taken.
                </p>
                <div className="settings-priority-grid">
                  {USER_PRIORITY_LABELS.map((priorityLabel, index) => (
                    <div key={priorityLabel} className="settings-priority-col">
                      <span className="settings-priority-label">{priorityLabel} choice</span>
                      <Select
                        className={`settings-priority-select ${selectSurfaceClass}`}
                        popupClassName={`settings-priority-dropdown ${selectDropdownClass}`}
                        classNames={{ popup: { root: `settings-priority-dropdown ${selectDropdownClass}` } }}
                        value={colorPriority[index]}
                        options={colorPriorityOptionsByIndex[index]}
                        onChange={(value) => handleColorPriorityChange(index, value)}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="settings-card-actions">
                <Button
                  type="primary"
                  className="settings-save-btn"
                  loading={savingProfile}
                  disabled={!canSaveProfile}
                  onClick={() => void handleProfileSave()}
                >
                  Save Profile
                </Button>
              </div>
            </div>
          </Card>

          <Card
            className="dashboard-container"
            title={<div className="dashboard-section-title">Graphics</div>}
          >
            <div className="settings-panel">
              <div className="settings-option-block">
                <div className="settings-toggle-row settings-toggle-row-disabled">
                  <span className="settings-option-title settings-option-title-disabled">
                    Tutorials <span className="settings-placeholder-note">(coming soon)</span>
                  </span>
                  <Switch
                    className="lobby-private-switch"
                    checked={tutorialsEnabled}
                    onChange={setTutorialsEnabled}
                    disabled
                    checkedChildren="Yes"
                    unCheckedChildren="No"
                  />
                </div>
              </div>

              <div className="settings-option-block">
                <div className="settings-option-title">Appearance</div>
                <div className="settings-appearance-selector" role="radiogroup" aria-label="Select appearance">
                  {USER_APPEARANCE_OPTIONS.map((appearanceOption) => (
                    <button
                      key={appearanceOption.id}
                      type="button"
                      role="radio"
                      aria-checked={selectedAppearance === appearanceOption.id}
                      className={`settings-appearance-dot-btn settings-appearance-dot-btn-${appearanceOption.id}${selectedAppearance === appearanceOption.id ? " settings-appearance-dot-btn-selected" : ""}`}
                      onClick={() => setSelectedAppearance(appearanceOption.id)}
                    >
                      <span className="settings-appearance-dot" aria-hidden="true" />
                      <span>{appearanceOption.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-option-block">
                <div className="settings-option-title">Primary Color</div>
                <div className="settings-color-chip-row" role="listbox" aria-label="Select primary color">
                  {USER_PRIMARY_COLOR_OPTIONS.map((colorOption) => (
                    <button
                      key={colorOption.id}
                      type="button"
                      className={`settings-color-chip${selectedPrimaryColor === colorOption.id ? " settings-color-chip-selected" : ""}`}
                      style={{ ["--settings-chip-color" as string]: colorOption.hex }}
                      onClick={() => setSelectedPrimaryColor(colorOption.id)}
                      aria-label={colorOption.label}
                    />
                  ))}
                </div>
              </div>

              <div className="settings-option-block">
                <div className="settings-option-title">Menu Background</div>
                <div className="settings-background-scroll" role="listbox" aria-label="Select menu background">
                  {backgroundOptions.map((backgroundOption) => (
                    <button
                      key={backgroundOption.id}
                      type="button"
                      className={`settings-background-tile${selectedMenuBackground === backgroundOption.id ? " settings-background-tile-selected" : ""}`}
                      onClick={() => setSelectedMenuBackground(backgroundOption.id)}
                      aria-label={backgroundOption.label}
                    >
                      <Image
                        src={backgroundOption.src}
                        alt={backgroundOption.label}
                        fill
                        sizes="112px"
                        className="settings-background-image"
                      />
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-option-block">
                <div className="settings-option-title">Game Background</div>
                <div className="settings-background-scroll" role="listbox" aria-label="Select game background">
                  {backgroundOptions.map((backgroundOption) => (
                    <button
                      key={backgroundOption.id}
                      type="button"
                      className={`settings-background-tile${selectedGameBackground === backgroundOption.id ? " settings-background-tile-selected" : ""}`}
                      onClick={() => setSelectedGameBackground(backgroundOption.id)}
                      aria-label={backgroundOption.label}
                    >
                      <Image
                        src={backgroundOption.src}
                        alt={backgroundOption.label}
                        fill
                        sizes="112px"
                        className="settings-background-image"
                      />
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-card-actions">
                <Button
                  type="primary"
                  className="settings-save-btn"
                  loading={savingGraphics}
                  disabled={!canSaveGraphics}
                  onClick={() => void handleGraphicsSave()}
                >
                  Save Graphics
                </Button>
              </div>
            </div>
          </Card>

          <Card
            className="dashboard-container"
            title={<div className="dashboard-section-title">Sounds</div>}
          >
            <div className="settings-panel">
              <div className="settings-option-block">
                <div className="settings-option-title">Music Volume</div>
                <div className="settings-slider-row">
                  <Slider
                    min={0}
                    max={100}
                    step={1}
                    marks={SOUND_SLIDER_MARKS}
                    tooltip={SOUND_SLIDER_TOOLTIP}
                    value={musicVolume}
                    onChange={(nextValue) => {
                      const numeric = Array.isArray(nextValue) ? nextValue[0] : nextValue;
                      setMusicVolume(Number(numeric));
                    }}
                  />
                  <span className="settings-slider-value">{musicVolume}</span>
                </div>
              </div>

              <div className="settings-option-block">
                <div className="settings-option-title">Sound Effects Volume</div>
                <div className="settings-slider-row">
                  <Slider
                    min={0}
                    max={100}
                    step={1}
                    marks={SOUND_SLIDER_MARKS}
                    tooltip={SOUND_SLIDER_TOOLTIP}
                    value={soundEffectsVolume}
                    onChange={(nextValue) => {
                      const numeric = Array.isArray(nextValue) ? nextValue[0] : nextValue;
                      setSoundEffectsVolume(Number(numeric));
                    }}
                  />
                  <span className="settings-slider-value">{soundEffectsVolume}</span>
                </div>
              </div>

              <div className="settings-option-block">
                <div className="settings-option-title">Music Blacklist</div>
                <Select
                  className={`settings-music-blacklist-select ${selectSurfaceClass}`}
                  popupClassName={`settings-music-blacklist-dropdown ${selectDropdownClass}`}
                  classNames={{ popup: { root: `settings-music-blacklist-dropdown ${selectDropdownClass}` } }}
                  mode="multiple"
                  showSearch
                  allowClear
                  optionFilterProp="searchText"
                  options={musicBlacklistSelectOptions}
                  value={musicBlacklist}
                  onChange={(values) =>
                    setMusicBlacklist(canonicalizeMusicBlacklistValues(values, availableMusicTracks))
                  }
                  filterOption={(inputValue, option) => {
                    const searchText = String(option?.searchText ?? "").toLowerCase();
                    return searchText.includes(inputValue.trim().toLowerCase());
                  }}
                  placeholder="Search music title or filename"
                />
              </div>

              <div className="settings-card-actions">
                <Button
                  type="primary"
                  className="settings-save-btn"
                  loading={savingSounds}
                  disabled={!canSaveSounds}
                  onClick={() => void handleSoundsSave()}
                >
                  Save Sounds
                </Button>
              </div>
            </div>
          </Card>

          <Card
            className="dashboard-container"
            title={<div className="dashboard-section-title">Password</div>}
          >
            <Form form={form} layout="vertical" className="settings-form" requiredMark={false}>
              <Form.Item
                name="password"
                label={(
                  <span className="form-label-required">
                    New Password
                    <span className="form-label-required-star">*</span>
                  </span>
                )}
                validateStatus={passwordRuleError ? "error" : undefined}
                help={(
                  <span className={`auth-input-hint${passwordRuleError ? " auth-input-hint-error" : ""}`}>
                    {SETTINGS_PASSWORD_HINT}
                  </span>
                )}
                rules={[
                  { required: true, message: "Please enter your new password." },
                  {
                    validator: async (_, value: string | undefined) => {
                      const normalized = String(value ?? "");
                      if (!normalized) {
                        return;
                      }
                      const error = validatePassword(normalized, authRules);
                      if (!error) {
                        return;
                      }
                      throw new Error(" ");
                    },
                  },
                ]}
              >
                <Input
                  type="password"
                  placeholder="Enter your new password"
                  maxLength={authRules.password.maxLength}
                  onChange={(event) => {
                    const sanitized = sanitizePasswordInput(event.target.value, authRules);
                    if (sanitized !== event.target.value) {
                      form.setFieldValue("password", sanitized);
                    }
                  }}
                />
              </Form.Item>
              <Form.Item
                name="confirmPassword"
                label={(
                  <span className="form-label-required">
                    Confirm New Password
                    <span className="form-label-required-star">*</span>
                  </span>
                )}
                dependencies={["password"]}
                rules={[
                  { required: true, message: "Please confirm your new password." },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || getFieldValue("password") === value) {
                        return Promise.resolve();
                      }
                      return Promise.reject(new Error("Passwords do not match."));
                    },
                  }),
                ]}
              >
                <Input
                  type="password"
                  placeholder="Re-enter your new password"
                  maxLength={authRules.password.maxLength}
                  onChange={(event) => {
                    const sanitized = sanitizePasswordInput(event.target.value, authRules);
                    if (sanitized !== event.target.value) {
                      form.setFieldValue("confirmPassword", sanitized);
                    }
                  }}
                />
              </Form.Item>
              <div className="dashboard-button-stack">
                <Button
                  type="primary"
                  className="settings-save-btn"
                  loading={savingPassword}
                  disabled={!canSavePassword}
                  onClick={() => void handlePasswordSave()}
                >
                  Save Password
                </Button>
              </div>
            </Form>
          </Card>

          <Card className="dashboard-container">
            <div className="dashboard-button-stack">
              <Button type="default" onClick={() => void handleBack()}>{"\u2190"} Back</Button>
            </div>
          </Card>

          <Card className="dashboard-container dashboard-music-card">
            <InlineMusicPlayer
              className="dashboard-inline-music-player"
              autoPersistSettings={false}
            />
          </Card>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
