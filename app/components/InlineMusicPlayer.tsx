"use client";

import React, { useMemo, useState } from "react";
import { Button } from "antd";
import useLocalStorage from "@/hooks/useLocalStorage";
import { useApi } from "@/hooks/useApi";
import { useCaboMusicPlayer } from "@/hooks/useCaboMusicPlayer";
import { showTimedConfirmation } from "@/utils/timedConfirmation";

type InlineMusicPlayerProps = {
  className?: string;
  variant?: "compact" | "game";
  controlsDisabled?: boolean;
  autoPersistSettings?: boolean;
  persistDebounceMs?: number;
};

const BLACKLIST_SYMBOL = "\u2298";
const PREVIOUS_SYMBOL = "\u23EE";
const NEXT_SYMBOL = "\u23ED";
const PAUSE_SYMBOL = "\u23F8";
const PLAY_SYMBOL = "\u25B6";
const SPEAKER_SYMBOL = "\uD83D\uDD0A";

export default function InlineMusicPlayer({
  className,
  variant = "compact",
  controlsDisabled = false,
  autoPersistSettings = true,
  persistDebounceMs = 1000,
}: InlineMusicPlayerProps) {
  const apiService = useApi();
  const { value: token } = useLocalStorage<string>("token", "");
  const { value: userId } = useLocalStorage<string>("userId", "");
  const normalizedToken = token.trim();
  const normalizedUserId = userId.trim();

  const player = useCaboMusicPlayer({
    apiService,
    token: normalizedToken,
    userId: normalizedUserId,
    autoPlay: true,
    autoPersistSettings,
    persistDebounceMs,
  });

  const noTrackConfigured = !player.currentTrack;
  const interactionLocked = controlsDisabled || noTrackConfigured;

  const confirmBlacklistLabel = useMemo(
    () => player.currentTrackTitle,
    [player.currentTrackTitle],
  );
  const [isVolumePanelOpen, setIsVolumePanelOpen] = useState<boolean>(false);

  if (!normalizedToken || !normalizedUserId) {
    return null;
  }

  const handleBlacklistCurrentTrack = async () => {
    if (!player.currentTrack || controlsDisabled) {
      return;
    }
    const confirmed = await showTimedConfirmation({
      title: `Do you want to add ${confirmBlacklistLabel} to the blacklist so it is never played again?`,
      description: "You can change this in settings.",
      timeoutSeconds: 10,
    });
    if (!confirmed) {
      return;
    }
    player.addTrackToBlacklist(player.currentTrack);
  };

  const containerClassName = [
    "inline-music-player",
    variant === "game" ? "inline-music-player-game" : "inline-music-player-compact",
    className ?? "",
    controlsDisabled ? "inline-music-player-disabled" : "",
  ].join(" ").trim();

  return (
    <div className={containerClassName} aria-label="Music player">
      <div className="inline-music-row inline-music-title-row">
        <p className="inline-music-title" title={player.currentTrackTitle}>
          {player.currentTrackTitle}
        </p>
        <Button
          size="small"
          className="inline-music-blacklist-symbol-btn inline-music-blacklist-symbol-btn-title"
          onClick={() => void handleBlacklistCurrentTrack()}
          disabled={interactionLocked}
          aria-label="Blacklist track"
        >
          {BLACKLIST_SYMBOL}
        </Button>
      </div>

      <div className="inline-music-row inline-music-main-row">
        <input
          type="range"
          min={0}
          max={100}
          step={0.1}
          value={player.trackProgressPercent}
          onChange={(event) => player.seekToPercent(Number(event.target.value))}
          disabled={interactionLocked}
          aria-label="Track position"
        />
        <div className="inline-music-main-controls-row">
          <div className="inline-music-control-cluster">
            <Button
              size="small"
              className="inline-music-control-btn"
              onClick={player.playPreviousTrack}
              disabled={interactionLocked}
              aria-label="Previous track"
            >
              {PREVIOUS_SYMBOL}
            </Button>
            <Button
              size="small"
              className="inline-music-control-btn inline-music-control-btn-primary"
              onClick={() => void player.togglePlayback()}
              disabled={interactionLocked}
              aria-label="Play or pause track"
            >
              {player.isMusicPlaying ? PAUSE_SYMBOL : PLAY_SYMBOL}
            </Button>
            <Button
              size="small"
              className="inline-music-control-btn"
              onClick={player.playNextTrack}
              disabled={interactionLocked}
              aria-label="Next track"
            >
              {NEXT_SYMBOL}
            </Button>
          </div>
          <Button
            size="small"
            className="inline-music-blacklist-symbol-btn inline-music-blacklist-symbol-btn-main"
            onClick={() => void handleBlacklistCurrentTrack()}
            disabled={interactionLocked}
            aria-label="Blacklist track"
          >
            {BLACKLIST_SYMBOL}
          </Button>
          <Button
            size="small"
            className={`inline-music-speaker-symbol-btn${isVolumePanelOpen ? " inline-music-speaker-symbol-btn-open" : ""}`}
            onClick={() => setIsVolumePanelOpen((current) => !current)}
            disabled={controlsDisabled}
            aria-label="Toggle volume controls"
            aria-pressed={isVolumePanelOpen}
          >
            {SPEAKER_SYMBOL}
          </Button>
        </div>
      </div>

      {isVolumePanelOpen ? (
        <>
          <label className="inline-music-slider-row">
            <span>Music</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={player.musicVolume}
              onChange={(event) => player.setMusicVolume(Number(event.target.value))}
              disabled={controlsDisabled}
              aria-label="Music volume"
            />
            <span>{player.musicVolumeText}</span>
          </label>

          <label className="inline-music-slider-row">
            <span>SFX</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={player.soundEffectsVolume}
              onChange={(event) => player.setSoundEffectsVolume(Number(event.target.value))}
              disabled={controlsDisabled}
              aria-label="Sound effects volume"
            />
            <span>{player.soundEffectsVolumeText}</span>
          </label>
        </>
      ) : null}
    </div>
  );
}
