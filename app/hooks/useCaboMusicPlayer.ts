"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@/types/user";
import {
  normalizeMusicBlacklist,
  normalizeVolume,
  USER_DEFAULT_MUSIC_VOLUME,
  USER_DEFAULT_SOUND_EFFECTS_VOLUME,
} from "@/utils/userSettings";
import {
  fetchConfiguredMusicFilenames,
  filterTracksByBlacklist,
  formatVolumeLabel,
  GAME_MUSIC_TRACK_FILENAMES,
  getTrackBlacklistKeys,
  getTrackDisplayTitle,
  type MusicTrack,
  resolveAvailableMusicTracks,
} from "@/utils/musicPlayer";

type ApiServiceLike = {
  getWithAuth<T>(path: string, token: string): Promise<T>;
  putWithAuth<T>(path: string, body: unknown, token: string): Promise<T>;
};

type FadeDirection = "in" | "out";

type UseCaboMusicPlayerOptions = {
  apiService: ApiServiceLike;
  token: string;
  userId: string;
  autoPlay?: boolean;
  autoPersistSettings?: boolean;
  persistDebounceMs?: number;
};

export type CaboSoundEffectKind =
  | "cabo_call"
  | "players_ready"
  | "applause"
  | "game_start"
  | "afk_warning";
type LoopedCaboSoundEffectKind = "afk_warning";
const CABO_MUSIC_SETTINGS_SYNC_EVENT = "cabo:music-settings-sync";

function normalizeTrackPath(src: string): string {
  try {
    const parsed = new URL(src, window.location.origin);
    return parsed.pathname;
  } catch {
    return src;
  }
}

function clampVolumePercent(raw: number): number {
  if (!Number.isFinite(raw)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function clampPercent(raw: number): number {
  if (!Number.isFinite(raw)) {
    return 0;
  }
  return Math.max(0, Math.min(100, raw));
}

function pickRandomTrackId(tracks: MusicTrack[], exceptId?: string | null): string | null {
  if (tracks.length === 0) {
    return null;
  }
  const excluded = String(exceptId ?? "").trim();
  const pool = excluded
    ? tracks.filter((entry) => entry.id !== excluded)
    : tracks;
  const candidates = pool.length > 0 ? pool : tracks;
  const randomIndex = Math.floor(Math.random() * candidates.length);
  return candidates[randomIndex]?.id ?? tracks[0]?.id ?? null;
}

function shuffleTrackList(tracks: MusicTrack[]): MusicTrack[] {
  const next = [...tracks];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const buffer = next[index];
    next[index] = next[swapIndex];
    next[swapIndex] = buffer;
  }
  return next;
}

let sharedAudioElement: HTMLAudioElement | null = null;
let sharedResolvedTracks: MusicTrack[] | null = null;
let sharedCurrentTrackId: string | null = null;
let sharedMusicVolume = USER_DEFAULT_MUSIC_VOLUME;
let sharedSoundEffectsVolume = USER_DEFAULT_SOUND_EFFECTS_VOLUME;
let sharedMusicBlacklist: string[] = [];
let sharedIsMusicPlaying = false;
let sharedSettingsOwnerKey: string | null = null;
let sharedAutoplayPrimed = true;
let sharedSoundEffectAudioElements: HTMLAudioElement[] = [];
const sharedSoundEffectLastPlayedAtMs: Partial<Record<CaboSoundEffectKind, number>> = {};
const LOOPED_SOUND_EFFECT_KINDS: ReadonlySet<CaboSoundEffectKind> = new Set(["afk_warning"]);
const CABO_SOUND_EFFECT_CONFIG: Record<CaboSoundEffectKind, {
  source: string;
  gain: number;
  minIntervalMs: number;
}> = {
  cabo_call: {
    source: "/cabo_bell.mp3",
    gain: 0.46,
    minIntervalMs: 400,
  },
  players_ready: {
    source: "/players_ready.mp3",
    gain: 0.55,
    minIntervalMs: 8000,
  },
  applause: {
    source: "/applause.mp3",
    gain: 0.6,
    minIntervalMs: 2500,
  },
  game_start: {
    source: "/game_start.mp3",
    gain: 0.58,
    minIntervalMs: 2500,
  },
  afk_warning: {
    source: "/afk_warning.mp3",
    gain: 0.58,
    minIntervalMs: 0,
  },
};
const sharedLoopedSoundEffects: Partial<Record<LoopedCaboSoundEffectKind, HTMLAudioElement>> = {};
const sharedLoopedSoundEffectUsageCounts: Partial<Record<LoopedCaboSoundEffectKind, number>> = {};

function clampUnitVolume(raw: number): number {
  if (!Number.isFinite(raw)) {
    return 0;
  }
  return Math.max(0, Math.min(1, raw));
}

export function playSharedCaboSoundEffect(kind: CaboSoundEffectKind): void {
  if (typeof window === "undefined") {
    return;
  }

  const config = CABO_SOUND_EFFECT_CONFIG[kind];
  if (!config) {
    return;
  }
  if (LOOPED_SOUND_EFFECT_KINDS.has(kind)) {
    startSharedLoopedCaboSoundEffect(kind as LoopedCaboSoundEffectKind);
    return;
  }
  const source = config.source;

  const nowMs = Date.now();
  const minInterval = Math.max(0, config.minIntervalMs);
  const lastPlayedAt = sharedSoundEffectLastPlayedAtMs[kind] ?? 0;
  if (nowMs - lastPlayedAt < minInterval) {
    return;
  }
  sharedSoundEffectLastPlayedAtMs[kind] = nowMs;

  const masterVolume = clampUnitVolume(sharedSoundEffectsVolume / 100);
  if (masterVolume <= 0) {
    return;
  }
  const effectiveVolume = clampUnitVolume(masterVolume * config.gain);
  if (effectiveVolume <= 0) {
    return;
  }

  const reusableAudio = sharedSoundEffectAudioElements.find((entry) => (
    entry.paused && normalizeTrackPath(entry.src) === source
  ));
  const audio = reusableAudio ?? new Audio(source);
  if (!reusableAudio) {
    audio.preload = "auto";
    sharedSoundEffectAudioElements.push(audio);
    if (sharedSoundEffectAudioElements.length > 32) {
      sharedSoundEffectAudioElements = sharedSoundEffectAudioElements.slice(-32);
    }
  }

  audio.loop = false;
  audio.volume = effectiveVolume;
  try {
    audio.currentTime = 0;
  } catch {
    // Ignore non-seekable edge cases.
  }
  void audio.play().catch(() => {
    // Ignore autoplay/runtime audio errors.
  });
}

function syncSharedLoopedSoundEffectsVolume(): void {
  if (typeof window === "undefined") {
    return;
  }
  (Object.keys(sharedLoopedSoundEffectUsageCounts) as LoopedCaboSoundEffectKind[]).forEach((kind) => {
    if ((sharedLoopedSoundEffectUsageCounts[kind] ?? 0) <= 0) {
      return;
    }
    const config = CABO_SOUND_EFFECT_CONFIG[kind];
    if (!config) {
      return;
    }
    const masterVolume = clampUnitVolume(sharedSoundEffectsVolume / 100);
    const effectiveVolume = clampUnitVolume(masterVolume * config.gain);
    const existingAudio = sharedLoopedSoundEffects[kind];
    if (effectiveVolume <= 0) {
      if (existingAudio) {
        existingAudio.pause();
      }
      return;
    }
    const audio = existingAudio ?? new Audio(config.source);
    if (!existingAudio) {
      audio.preload = "auto";
      audio.loop = true;
      sharedLoopedSoundEffects[kind] = audio;
    }
    audio.volume = effectiveVolume;
    if (audio.paused) {
      void audio.play().catch(() => {
        // Ignore autoplay/runtime audio errors.
      });
    }
  });
}

export function startSharedLoopedCaboSoundEffect(kind: LoopedCaboSoundEffectKind): void {
  if (typeof window === "undefined") {
    return;
  }
  sharedLoopedSoundEffectUsageCounts[kind] = (sharedLoopedSoundEffectUsageCounts[kind] ?? 0) + 1;
  syncSharedLoopedSoundEffectsVolume();
}

export function stopSharedLoopedCaboSoundEffect(kind: LoopedCaboSoundEffectKind): void {
  const currentCount = sharedLoopedSoundEffectUsageCounts[kind] ?? 0;
  const nextCount = Math.max(0, currentCount - 1);
  sharedLoopedSoundEffectUsageCounts[kind] = nextCount;
  if (nextCount > 0) {
    return;
  }
  const audio = sharedLoopedSoundEffects[kind];
  if (!audio) {
    return;
  }
  audio.pause();
  try {
    audio.currentTime = 0;
  } catch {
    // Ignore non-seekable edge cases.
  }
}

export function pauseSharedCaboMusicPlayback(resetTime = false): void {
  if (!sharedAudioElement) {
    return;
  }
  sharedAudioElement.pause();
  if (resetTime) {
    sharedAudioElement.currentTime = 0;
  }
  sharedIsMusicPlaying = false;
}

export function primeSharedCaboMusicAutoplay(resetTrackSelection = false): void {
  sharedAutoplayPrimed = true;
  if (resetTrackSelection) {
    sharedCurrentTrackId = null;
  }
}

export function syncSharedCaboMusicSettings(settings: {
  musicVolume?: unknown;
  soundEffectsVolume?: unknown;
  musicBlacklist?: unknown;
}): void {
  const hasMusicVolume = settings.musicVolume != null;
  const hasSfxVolume = settings.soundEffectsVolume != null;
  const hasBlacklist = settings.musicBlacklist != null;

  const nextMusicVolume = hasMusicVolume
    ? clampVolumePercent(Number(settings.musicVolume))
    : sharedMusicVolume;
  const nextSoundEffectsVolume = hasSfxVolume
    ? clampVolumePercent(Number(settings.soundEffectsVolume))
    : sharedSoundEffectsVolume;
  const nextMusicBlacklist = hasBlacklist
    ? normalizeMusicBlacklist(settings.musicBlacklist)
    : [...sharedMusicBlacklist];

  sharedMusicVolume = nextMusicVolume;
  sharedSoundEffectsVolume = nextSoundEffectsVolume;
  sharedMusicBlacklist = [...nextMusicBlacklist];

  if (sharedAudioElement) {
    sharedAudioElement.volume = Math.max(0, Math.min(1, sharedMusicVolume / 100));
  }
  syncSharedLoopedSoundEffectsVolume();

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CABO_MUSIC_SETTINGS_SYNC_EVENT, {
      detail: {
        musicVolume: sharedMusicVolume,
        soundEffectsVolume: sharedSoundEffectsVolume,
        musicBlacklist: [...sharedMusicBlacklist],
      },
    }));
  }
}

export function useCaboMusicPlayer(options: UseCaboMusicPlayerOptions) {
  const {
    apiService,
    token,
    userId,
    autoPlay = true,
    autoPersistSettings = true,
    persistDebounceMs = 1000,
  } = options;
  const effectivePersistDebounceMs = Number.isFinite(persistDebounceMs)
    ? Math.max(1000, Math.floor(persistDebounceMs))
    : 1000;

  const [musicVolume, setMusicVolume] = useState<number>(() => sharedMusicVolume);
  const [soundEffectsVolume, setSoundEffectsVolume] = useState<number>(() => sharedSoundEffectsVolume);
  const [musicBlacklist, setMusicBlacklist] = useState<string[]>(() => [...sharedMusicBlacklist]);
  const [allTracks, setAllTracks] = useState<MusicTrack[]>(() => sharedResolvedTracks ?? []);
  const [tracksLoaded, setTracksLoaded] = useState<boolean>(() => sharedResolvedTracks !== null);
  const [currentTrackId, setCurrentTrackId] = useState<string | null>(() => sharedCurrentTrackId);
  const [isMusicPlaying, setIsMusicPlaying] = useState<boolean>(() => sharedIsMusicPlaying);
  const [trackPositionSeconds, setTrackPositionSeconds] = useState<number>(0);
  const [trackDurationSeconds, setTrackDurationSeconds] = useState<number>(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hasLoadedUserSettingsRef = useRef<boolean>(false);
  const settingsSaveTimeoutRef = useRef<number | null>(null);
  const persistedSettingsRef = useRef<{
    musicVolume: number;
    soundEffectsVolume: number;
    musicBlacklist: string[];
  } | null>(null);
  const preferRandomTrackSelectionRef = useRef<boolean>(false);
  const fadeRafRef = useRef<number | null>(null);
  const transitionTokenRef = useRef<number>(0);
  const forcePlayNextTrackRef = useRef<boolean>(false);

  const cancelFade = useCallback(() => {
    if (fadeRafRef.current != null) {
      window.cancelAnimationFrame(fadeRafRef.current);
      fadeRafRef.current = null;
    }
  }, []);

  const fadeAudio = useCallback((
    direction: FadeDirection,
    durationMs: number,
    targetVolume: number,
  ): Promise<void> => {
    const audio = audioRef.current;
    if (!audio) {
      return Promise.resolve();
    }
    cancelFade();
    const fromVolume = direction === "in" ? 0 : Math.max(0, Math.min(1, audio.volume));
    const toVolume = direction === "in" ? Math.max(0, Math.min(1, targetVolume)) : 0;
    if (durationMs <= 0 || Math.abs(toVolume - fromVolume) < 0.0001) {
      audio.volume = toVolume;
      return Promise.resolve();
    }
    audio.volume = fromVolume;
    const startedAt = performance.now();
    return new Promise((resolve) => {
      const tick = (now: number) => {
        const elapsed = now - startedAt;
        const progress = Math.max(0, Math.min(1, elapsed / durationMs));
        const eased = progress < 1 ? 1 - ((1 - progress) * (1 - progress)) : 1;
        audio.volume = fromVolume + ((toVolume - fromVolume) * eased);
        if (progress >= 1) {
          fadeRafRef.current = null;
          resolve();
          return;
        }
        fadeRafRef.current = window.requestAnimationFrame(tick);
      };
      fadeRafRef.current = window.requestAnimationFrame(tick);
    });
  }, [cancelFade]);

  const filteredTracks = useMemo(
    () => filterTracksByBlacklist(allTracks, musicBlacklist),
    [allTracks, musicBlacklist],
  );

  const currentTrack = useMemo(() => {
    if (filteredTracks.length === 0) {
      return null;
    }
    if (!currentTrackId) {
      return null;
    }
    return filteredTracks.find((entry) => entry.id === currentTrackId) ?? null;
  }, [filteredTracks, currentTrackId]);

  const musicVolumeText = useMemo(
    () => formatVolumeLabel(musicVolume),
    [musicVolume],
  );
  const soundEffectsVolumeText = useMemo(
    () => formatVolumeLabel(soundEffectsVolume),
    [soundEffectsVolume],
  );
  const currentTrackTitle = useMemo(
    () => (currentTrack ? getTrackDisplayTitle(currentTrack) : "No track configured"),
    [currentTrack],
  );
  const trackProgressPercent = useMemo(() => {
    if (!Number.isFinite(trackDurationSeconds) || trackDurationSeconds <= 0) {
      return 0;
    }
    return clampPercent((trackPositionSeconds / trackDurationSeconds) * 100);
  }, [trackDurationSeconds, trackPositionSeconds]);

  const syncAudioTrack = useCallback(async (
    track: MusicTrack,
    forcePlay: boolean,
  ) => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    const nextPath = normalizeTrackPath(track.src);
    const currentPath = normalizeTrackPath(audio.src);
    const alreadyLoaded = nextPath === currentPath;
    const targetVolume = Math.max(0, Math.min(1, musicVolume / 100));
    const wasPlaying = !audio.paused;
    const shouldPlay = forcePlay || wasPlaying || (autoPlay && sharedAutoplayPrimed);
    const transitionToken = transitionTokenRef.current + 1;
    transitionTokenRef.current = transitionToken;

    if (alreadyLoaded) {
      if (shouldPlay && audio.paused) {
        audio.volume = 0;
        try {
          await audio.play();
          await fadeAudio("in", 360, targetVolume);
        } catch {
          setIsMusicPlaying(false);
        }
      } else if (!shouldPlay) {
        audio.volume = targetVolume;
      }
      sharedAutoplayPrimed = false;
      return;
    }

    if (wasPlaying) {
      await fadeAudio("out", 260, targetVolume);
      if (transitionTokenRef.current !== transitionToken) {
        return;
      }
      audio.pause();
    }

    audio.src = track.src;
    audio.currentTime = 0;
    audio.load();

    if (!shouldPlay) {
      audio.volume = targetVolume;
      sharedAutoplayPrimed = false;
      return;
    }

    try {
      audio.volume = 0;
      await audio.play();
      if (transitionTokenRef.current !== transitionToken) {
        return;
      }
      await fadeAudio("in", 360, targetVolume);
    } catch {
      setIsMusicPlaying(false);
    } finally {
      sharedAutoplayPrimed = false;
    }
  }, [autoPlay, fadeAudio, musicVolume]);

  const switchToTrackByIndex = useCallback((index: number) => {
    if (filteredTracks.length === 0) {
      return;
    }
    const safeIndex = ((index % filteredTracks.length) + filteredTracks.length) % filteredTracks.length;
    const nextTrack = filteredTracks[safeIndex];
    if (!nextTrack) {
      return;
    }
    setCurrentTrackId(nextTrack.id);
  }, [filteredTracks]);

  const playNextTrack = useCallback(() => {
    if (filteredTracks.length === 0) {
      return;
    }
    const nextTrackId = pickRandomTrackId(filteredTracks, currentTrack?.id ?? null);
    if (!nextTrackId) {
      return;
    }
    setCurrentTrackId(nextTrackId);
  }, [currentTrack?.id, filteredTracks]);

  const playPreviousTrack = useCallback(() => {
    if (filteredTracks.length === 0) {
      return;
    }
    const currentIndex = Math.max(
      0,
      filteredTracks.findIndex((entry) => entry.id === (currentTrack?.id ?? "")),
    );
    switchToTrackByIndex(currentIndex - 1);
  }, [currentTrack?.id, filteredTracks, switchToTrackByIndex]);

  const togglePlayback = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) {
      return;
    }
    const targetVolume = Math.max(0, Math.min(1, musicVolume / 100));
    if (audio.paused) {
      try {
        audio.volume = 0;
        await audio.play();
        await fadeAudio("in", 340, targetVolume);
      } catch {
        setIsMusicPlaying(false);
      }
      return;
    }
    await fadeAudio("out", 240, targetVolume);
    audio.pause();
    audio.volume = targetVolume;
  }, [currentTrack, fadeAudio, musicVolume]);

  const addTrackToBlacklist = useCallback((track: MusicTrack) => {
    const normalizedId = track.id.trim();
    if (!normalizedId) {
      return;
    }
    const trackKeySet = new Set(
      getTrackBlacklistKeys(track).map((entry) => entry.trim().toLowerCase()).filter((entry) => entry.length > 0),
    );
    setMusicBlacklist((previous) => {
      const alreadyPresent = previous.some((entry) => trackKeySet.has(entry.trim().toLowerCase()));
      if (alreadyPresent) {
        return previous;
      }
      return [...previous, normalizedId];
    });
  }, []);

  const seekToPercent = useCallback((nextPercent: number) => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    const duration = Number.isFinite(audio.duration) && audio.duration > 0
      ? audio.duration
      : trackDurationSeconds;
    if (!Number.isFinite(duration) || duration <= 0) {
      return;
    }
    const clampedPercent = clampPercent(nextPercent);
    const nextPositionSeconds = duration * (clampedPercent / 100);
    try {
      audio.currentTime = nextPositionSeconds;
    } catch {
      // Ignore non-seekable source edge cases.
    }
    setTrackPositionSeconds(nextPositionSeconds);
  }, [trackDurationSeconds]);

  useEffect(() => {
    if (!sharedAudioElement) {
      sharedAudioElement = new Audio();
      sharedAudioElement.preload = "auto";
      sharedAudioElement.loop = false;
      sharedAudioElement.volume = Math.max(0, Math.min(1, sharedMusicVolume / 100));
    }
    const audio = sharedAudioElement;
    const handlePlay = () => {
      sharedIsMusicPlaying = true;
      setIsMusicPlaying(true);
    };
    const handlePause = () => {
      sharedIsMusicPlaying = false;
      setIsMusicPlaying(false);
    };
    const syncTimeline = () => {
      const duration = Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : 0;
      const position = Number.isFinite(audio.currentTime) && audio.currentTime >= 0
        ? Math.min(audio.currentTime, duration || audio.currentTime)
        : 0;
      setTrackDurationSeconds(duration);
      setTrackPositionSeconds(position);
    };
    const handleEnded = () => {
      if (filteredTracks.length === 0) {
        return;
      }
      if (filteredTracks.length === 1) {
        try {
          audio.currentTime = 0;
        } catch {
          // Ignore non-seekable source edge cases.
        }
        void audio.play().catch(() => {
          setIsMusicPlaying(false);
        });
        return;
      }
      forcePlayNextTrackRef.current = true;
      setCurrentTrackId((previousTrackId) => (
        pickRandomTrackId(filteredTracks, previousTrackId) ?? previousTrackId ?? null
      ));
    };
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("timeupdate", syncTimeline);
    audio.addEventListener("loadedmetadata", syncTimeline);
    audio.addEventListener("durationchange", syncTimeline);
    audio.addEventListener("seeked", syncTimeline);
    audio.addEventListener("ended", handleEnded);
    audioRef.current = audio;
    setIsMusicPlaying(!audio.paused);
    syncTimeline();
    return () => {
      cancelFade();
      transitionTokenRef.current += 1;
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("timeupdate", syncTimeline);
      audio.removeEventListener("loadedmetadata", syncTimeline);
      audio.removeEventListener("durationchange", syncTimeline);
      audio.removeEventListener("seeked", syncTimeline);
      audio.removeEventListener("ended", handleEnded);
      audioRef.current = null;
    };
  }, [cancelFade, filteredTracks]);

  useEffect(() => {
    if (sharedResolvedTracks !== null) {
      setAllTracks(sharedResolvedTracks);
      setTracksLoaded(true);
      return;
    }
    let active = true;
    const resolveTracks = async () => {
      const configuredFilenames = await fetchConfiguredMusicFilenames(GAME_MUSIC_TRACK_FILENAMES);
      const resolved = await resolveAvailableMusicTracks(configuredFilenames);
      if (!active) {
        return;
      }
      const shuffled = shuffleTrackList(resolved);
      sharedResolvedTracks = shuffled;
      setAllTracks(shuffled);
      setTracksLoaded(true);
    };
    setTracksLoaded(false);
    void resolveTracks();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (filteredTracks.length === 0) {
      if (currentTrackId !== null) {
        setCurrentTrackId(null);
      }
      sharedCurrentTrackId = null;
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
      }
      return;
    }
    const currentAudioPath = normalizeTrackPath(audioRef.current?.src ?? "");
    const hasCurrent = currentTrackId != null && filteredTracks.some((entry) => entry.id === currentTrackId);
    const hasShared = sharedCurrentTrackId != null && filteredTracks.some((entry) => entry.id === sharedCurrentTrackId);
    const audioTrackMatch = currentAudioPath
      ? filteredTracks.find((entry) => normalizeTrackPath(entry.src) === currentAudioPath)?.id ?? null
      : null;
    const shouldPickRandomFirst = preferRandomTrackSelectionRef.current;
    const resolvedTrackId = hasCurrent
      ? currentTrackId
      : hasShared
        ? sharedCurrentTrackId
        : shouldPickRandomFirst
          ? pickRandomTrackId(filteredTracks, audioTrackMatch)
          : audioTrackMatch
          ? audioTrackMatch
          : pickRandomTrackId(filteredTracks);
    if (resolvedTrackId !== currentTrackId) {
      setCurrentTrackId(resolvedTrackId);
    }
    if (resolvedTrackId != null) {
      preferRandomTrackSelectionRef.current = false;
    }
  }, [filteredTracks, currentTrackId]);

  useEffect(() => {
    sharedCurrentTrackId = currentTrackId;
  }, [currentTrackId]);

  useEffect(() => {
    if (!currentTrack) {
      setTrackDurationSeconds(0);
      setTrackPositionSeconds(0);
      return;
    }
    const forcePlay = forcePlayNextTrackRef.current;
    forcePlayNextTrackRef.current = false;
    void syncAudioTrack(currentTrack, forcePlay);
  }, [currentTrack, syncAudioTrack]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    const nextVolume = Math.max(0, Math.min(1, musicVolume / 100));
    if (audio.paused) {
      audio.volume = nextVolume;
      return;
    }
    if (fadeRafRef.current == null) {
      audio.volume = nextVolume;
    }
  }, [musicVolume]);

  useEffect(() => {
    sharedMusicVolume = musicVolume;
  }, [musicVolume]);

  useEffect(() => {
    sharedSoundEffectsVolume = soundEffectsVolume;
    syncSharedLoopedSoundEffectsVolume();
  }, [soundEffectsVolume]);

  useEffect(() => {
    sharedMusicBlacklist = [...musicBlacklist];
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("cabo:music-blacklist-changed", {
        detail: {
          musicBlacklist: [...sharedMusicBlacklist],
        },
      }));
    }
  }, [musicBlacklist]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleSettingsSync = (event: Event) => {
      const customEvent = event as CustomEvent<{
        musicVolume?: unknown;
        soundEffectsVolume?: unknown;
        musicBlacklist?: unknown;
      }>;
      const detail = customEvent.detail ?? {};

      if (detail.musicVolume != null) {
        const nextMusicVolume = clampVolumePercent(Number(detail.musicVolume));
        sharedMusicVolume = nextMusicVolume;
        setMusicVolume((previous) => (previous === nextMusicVolume ? previous : nextMusicVolume));
      }

      if (detail.soundEffectsVolume != null) {
        const nextSfxVolume = clampVolumePercent(Number(detail.soundEffectsVolume));
        sharedSoundEffectsVolume = nextSfxVolume;
        setSoundEffectsVolume((previous) => (previous === nextSfxVolume ? previous : nextSfxVolume));
      }

      if (detail.musicBlacklist != null) {
        const nextBlacklist = normalizeMusicBlacklist(detail.musicBlacklist);
        sharedMusicBlacklist = [...nextBlacklist];
        setMusicBlacklist((previous) => (
          normalizeMusicBlacklist(previous).join("\u0001") === nextBlacklist.join("\u0001")
            ? previous
            : nextBlacklist
        ));
      }
    };

    window.addEventListener(CABO_MUSIC_SETTINGS_SYNC_EVENT, handleSettingsSync);
    return () => {
      window.removeEventListener(CABO_MUSIC_SETTINGS_SYNC_EVENT, handleSettingsSync);
    };
  }, []);

  useEffect(() => {
    const authToken = token.trim();
    const normalizedUserId = userId.trim();
    const authContextKey = `${normalizedUserId}::${authToken}`;
    if (!authToken || !normalizedUserId) {
      hasLoadedUserSettingsRef.current = false;
      persistedSettingsRef.current = null;
      sharedSettingsOwnerKey = null;
      sharedCurrentTrackId = null;
      setCurrentTrackId(null);
      setMusicVolume(sharedMusicVolume);
      setSoundEffectsVolume(sharedSoundEffectsVolume);
      setMusicBlacklist([...sharedMusicBlacklist]);
      pauseSharedCaboMusicPlayback();
      return;
    }
    if (sharedSettingsOwnerKey === authContextKey) {
      setMusicVolume(sharedMusicVolume);
      setSoundEffectsVolume(sharedSoundEffectsVolume);
      setMusicBlacklist([...sharedMusicBlacklist]);
      hasLoadedUserSettingsRef.current = true;
      return;
    }
    let active = true;
    const loadUserSettings = async () => {
      try {
        const fetchedUser = await apiService.getWithAuth<User>(
          `/users/${encodeURIComponent(normalizedUserId)}`,
          authToken,
        );
        if (!active) {
          return;
        }
        const nextMusicVolume = normalizeVolume(fetchedUser?.musicVolume, USER_DEFAULT_MUSIC_VOLUME);
        const nextSfxVolume = normalizeVolume(
          fetchedUser?.soundEffectsVolume,
          USER_DEFAULT_SOUND_EFFECTS_VOLUME,
        );
        const nextBlacklist = normalizeMusicBlacklist(fetchedUser?.musicBlacklist);
        const reshuffledTracks = sharedResolvedTracks ? shuffleTrackList(sharedResolvedTracks) : null;
        if (reshuffledTracks) {
          sharedResolvedTracks = reshuffledTracks;
          setAllTracks(reshuffledTracks);
        }
        sharedCurrentTrackId = null;
        preferRandomTrackSelectionRef.current = true;
        setCurrentTrackId(null);
        sharedMusicVolume = nextMusicVolume;
        sharedSoundEffectsVolume = nextSfxVolume;
        sharedMusicBlacklist = [...nextBlacklist];
        sharedSettingsOwnerKey = authContextKey;
        setMusicVolume(nextMusicVolume);
        setSoundEffectsVolume(nextSfxVolume);
        setMusicBlacklist(nextBlacklist);
        persistedSettingsRef.current = {
          musicVolume: nextMusicVolume,
          soundEffectsVolume: nextSfxVolume,
          musicBlacklist: [...nextBlacklist],
        };
        hasLoadedUserSettingsRef.current = true;
      } catch {
        if (!active) {
          return;
        }
        sharedMusicVolume = USER_DEFAULT_MUSIC_VOLUME;
        sharedSoundEffectsVolume = USER_DEFAULT_SOUND_EFFECTS_VOLUME;
        sharedMusicBlacklist = [];
        const reshuffledTracks = sharedResolvedTracks ? shuffleTrackList(sharedResolvedTracks) : null;
        if (reshuffledTracks) {
          sharedResolvedTracks = reshuffledTracks;
          setAllTracks(reshuffledTracks);
        }
        sharedCurrentTrackId = null;
        preferRandomTrackSelectionRef.current = true;
        setCurrentTrackId(null);
        sharedSettingsOwnerKey = authContextKey;
        setMusicVolume(sharedMusicVolume);
        setSoundEffectsVolume(sharedSoundEffectsVolume);
        setMusicBlacklist([...sharedMusicBlacklist]);
        persistedSettingsRef.current = {
          musicVolume: sharedMusicVolume,
          soundEffectsVolume: sharedSoundEffectsVolume,
          musicBlacklist: [...sharedMusicBlacklist],
        };
        hasLoadedUserSettingsRef.current = true;
      }
    };
    void loadUserSettings();
    return () => {
      active = false;
    };
  }, [apiService, token, userId]);

  useEffect(() => {
    if (!autoPersistSettings) {
      return;
    }
    const authToken = token.trim();
    const normalizedUserId = userId.trim();
    if (!hasLoadedUserSettingsRef.current || !authToken || !normalizedUserId) {
      return;
    }
    const normalizedCurrentBlacklist = normalizeMusicBlacklist(musicBlacklist);
    const persisted = persistedSettingsRef.current;
    const hasPersistedValue = persisted != null;
    const hasChangedFromPersisted = !hasPersistedValue
      || persisted.musicVolume !== clampVolumePercent(musicVolume)
      || persisted.soundEffectsVolume !== clampVolumePercent(soundEffectsVolume)
      || normalizeMusicBlacklist(persisted.musicBlacklist).join("\u0001") !== normalizedCurrentBlacklist.join("\u0001");
    if (!hasChangedFromPersisted) {
      return;
    }
    if (settingsSaveTimeoutRef.current != null) {
      window.clearTimeout(settingsSaveTimeoutRef.current);
    }
    settingsSaveTimeoutRef.current = window.setTimeout(() => {
      const nextMusicVolume = clampVolumePercent(musicVolume);
      const nextSoundEffectsVolume = clampVolumePercent(soundEffectsVolume);
      const nextMusicBlacklist = normalizeMusicBlacklist(musicBlacklist);
      void apiService.putWithAuth<void>(
        `/users/${encodeURIComponent(normalizedUserId)}`,
        {
          musicVolume: nextMusicVolume,
          soundEffectsVolume: nextSoundEffectsVolume,
          musicBlacklist: nextMusicBlacklist,
        },
        authToken,
      ).then(() => {
        persistedSettingsRef.current = {
          musicVolume: nextMusicVolume,
          soundEffectsVolume: nextSoundEffectsVolume,
          musicBlacklist: [...nextMusicBlacklist],
        };
      }).catch(() => {
        // keep silent for transient save failures
      });
      settingsSaveTimeoutRef.current = null;
    }, effectivePersistDebounceMs);
    return () => {
      if (settingsSaveTimeoutRef.current != null) {
        window.clearTimeout(settingsSaveTimeoutRef.current);
        settingsSaveTimeoutRef.current = null;
      }
    };
  }, [
    apiService,
    autoPersistSettings,
    effectivePersistDebounceMs,
    musicBlacklist,
    musicVolume,
    soundEffectsVolume,
    token,
    userId,
  ]);

  return {
    tracksLoaded,
    allTracks,
    filteredTracks,
    currentTrack,
    currentTrackTitle,
    isMusicPlaying,
    musicVolume,
    soundEffectsVolume,
    musicBlacklist,
    musicVolumeText,
    soundEffectsVolumeText,
    trackProgressPercent,
    setMusicVolume: (value: number) => setMusicVolume(clampVolumePercent(value)),
    setSoundEffectsVolume: (value: number) => setSoundEffectsVolume(clampVolumePercent(value)),
    setMusicBlacklist: (values: string[]) => setMusicBlacklist(normalizeMusicBlacklist(values)),
    seekToPercent,
    togglePlayback,
    playNextTrack,
    playPreviousTrack,
    addTrackToBlacklist,
  };
}
