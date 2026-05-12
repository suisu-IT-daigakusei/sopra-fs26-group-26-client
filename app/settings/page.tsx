"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useApi } from "@/hooks/useApi";
import useLocalStorage from "@/hooks/useLocalStorage";
import type { User } from "@/types/user";
import { Button, Card, Form, Input, Select, Slider, message } from "antd";

const BIO_MAX_LENGTH = 180;
const DEFAULT_BIO = "This player hasn't added a bio yet.";

const CHARACTER_OPTIONS = [
  { id: "char01", src: "/char01_profile.png", label: "Character 1" },
  { id: "char02", src: "/char02_profile.png", label: "Character 2" },
  { id: "char03", src: "/char03_waving_1.png", label: "Character 3" },
  { id: "char04", src: "/char04_profile.png", label: "Character 4" },
  { id: "char05", src: "/char05_profile.png", label: "Character 5" },
  { id: "char06", src: "/char06_profile.png", label: "Character 6" },
  { id: "char07", src: "/char07_profile.png", label: "Character 7" },
  { id: "char08", src: "/char08_profile.png", label: "Character 8" },
] as const;

const PRIORITY_COLOR_OPTIONS = ["black", "blue", "green", "orange"] as const;
const PRIORITY_LABELS = ["1st", "2nd", "3rd", "4th"] as const;

const MENU_BACKGROUND_OPTIONS = [
  { id: "menu-bg-1", src: "/background_01.png", label: "Current" },
  { id: "menu-bg-2", src: "/general_loading_00a.png", label: "Preview A" },
  { id: "menu-bg-3", src: "/general_loading_00b.png", label: "Preview B" },
  { id: "menu-bg-4", src: "/login_loading_01.png", label: "Preview C" },
] as const;

const GAME_BACKGROUND_OPTIONS = [
  { id: "game-bg-1", src: "/background_01.png", label: "Current" },
  { id: "game-bg-2", src: "/login_loading_02.png", label: "Preview A" },
  { id: "game-bg-3", src: "/login_loading_03.png", label: "Preview B" },
  { id: "game-bg-4", src: "/general_loading_01.png", label: "Preview C" },
] as const;

const PRIMARY_COLOR_OPTIONS = [
  { id: "slate", hex: "#6973a8", label: "Slate" },
  { id: "orange", hex: "#f2994a", label: "Orange" },
  { id: "graphite", hex: "#6c7077", label: "Graphite" },
  { id: "forest", hex: "#4f9f65", label: "Forest" },
  { id: "ocean", hex: "#4386d6", label: "Ocean" },
] as const;

const TEXT_COLOR_OPTIONS = [
  { id: "dark", hex: "#1e2329", label: "Dark" },
  { id: "white", hex: "#ffffff", label: "White" },
] as const;

const SOUND_SLIDER_MARKS: Record<number, string> = Array.from({ length: 11 }, (_, index) => index * 10)
  .reduce<Record<number, string>>((acc, value) => {
    acc[value] = String(value);
    return acc;
  }, {});

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

type GraphicsSelectionState = {
  selectedMenuBackground: string;
  selectedGameBackground: string;
  selectedPrimaryColor: string;
  selectedTextColor: string;
};

type SoundsSelectionState = {
  musicVolume: number;
  soundEffectsVolume: number;
  musicBlacklist: string[];
};

const SettingsPage = () => {
  const router = useRouter();
  const apiService = useApi();
  const [form] = Form.useForm();

  const [savingPassword, setSavingPassword] = useState(false);
  const [editingBio, setEditingBio] = useState(false);
  const [savingBio, setSavingBio] = useState(false);
  const [bioValue, setBioValue] = useState("");
  const [bioDraft, setBioDraft] = useState("");

  const [selectedCharacter, setSelectedCharacter] = useState<string>(CHARACTER_OPTIONS[0].id);
  const [savedCharacter, setSavedCharacter] = useState<string>(CHARACTER_OPTIONS[0].id);
  const [savingCharacter, setSavingCharacter] = useState(false);
  const [colorPriority, setColorPriority] = useState<string[]>(["black", "blue", "green", "orange"]);
  const [savedColorPriority, setSavedColorPriority] = useState<string[]>(["black", "blue", "green", "orange"]);
  const [savingPriority, setSavingPriority] = useState(false);

  const [selectedMenuBackground, setSelectedMenuBackground] = useState<string>(MENU_BACKGROUND_OPTIONS[0].id);
  const [selectedGameBackground, setSelectedGameBackground] = useState<string>(GAME_BACKGROUND_OPTIONS[0].id);
  const [selectedPrimaryColor, setSelectedPrimaryColor] = useState<string>(PRIMARY_COLOR_OPTIONS[0].id);
  const [selectedTextColor, setSelectedTextColor] = useState<string>(TEXT_COLOR_OPTIONS[0].id);
  const [savedGraphicsSelection, setSavedGraphicsSelection] = useState<GraphicsSelectionState>({
    selectedMenuBackground: MENU_BACKGROUND_OPTIONS[0].id,
    selectedGameBackground: GAME_BACKGROUND_OPTIONS[0].id,
    selectedPrimaryColor: PRIMARY_COLOR_OPTIONS[0].id,
    selectedTextColor: TEXT_COLOR_OPTIONS[0].id,
  });
  const [savingGraphics, setSavingGraphics] = useState(false);

  const [musicVolume, setMusicVolume] = useState(60);
  const [soundEffectsVolume, setSoundEffectsVolume] = useState(70);
  const [musicBlacklist, setMusicBlacklist] = useState<string[]>([]);
  const [savedSoundsSelection, setSavedSoundsSelection] = useState<SoundsSelectionState>({
    musicVolume: 60,
    soundEffectsVolume: 70,
    musicBlacklist: [] as string[],
  });
  const [savingSounds, setSavingSounds] = useState(false);

  const { value: userId, clear: clearUserId } = useLocalStorage<string>("userId", "");
  const { value: token, clear: clearToken } = useLocalStorage<string>("token", "");
  const skipUnsavedGuardRef = useRef(false);
  const passwordValue = Form.useWatch("password", form);
  const confirmPasswordValue = Form.useWatch("confirmPassword", form);

  useEffect(() => {
    if (!userId.trim()) {
      router.replace("/login");
    }
  }, [userId, router]);

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
      } catch {
        if (!active) {
          return;
        }
        setBioValue("");
        setBioDraft("");
      }
    };

    void loadUserProfile();

    return () => {
      active = false;
    };
  }, [apiService, token, userId]);

  const colorPriorityOptionsByIndex = useMemo(
    () => colorPriority.map((current, index) => (
      PRIORITY_COLOR_OPTIONS.map((colorOption) => ({
        value: colorOption,
        label: colorOption[0].toUpperCase() + colorOption.slice(1),
        disabled: colorPriority.some((picked, pickedIndex) => (
          pickedIndex !== index && picked === colorOption && current !== colorOption
        )),
      }))
    )),
    [colorPriority],
  );

  const shownBio = bioValue.trim().length > 0 ? bioValue : DEFAULT_BIO;
  const normalizedBioDraft = bioDraft.trim();
  const normalizedSavedBio = bioValue.trim();

  const characterDirty = selectedCharacter !== savedCharacter;
  const bioDirty = editingBio && normalizedBioDraft !== normalizedSavedBio;
  const colorPriorityDirty = !areStringArraysEqual(colorPriority, savedColorPriority);
  const graphicsDirty =
    selectedMenuBackground !== savedGraphicsSelection.selectedMenuBackground ||
    selectedGameBackground !== savedGraphicsSelection.selectedGameBackground ||
    selectedPrimaryColor !== savedGraphicsSelection.selectedPrimaryColor ||
    selectedTextColor !== savedGraphicsSelection.selectedTextColor;
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
  const passwordDirty = Boolean(
    String(passwordValue ?? "").trim().length > 0 ||
    String(confirmPasswordValue ?? "").trim().length > 0,
  );
  const hasUnsavedChanges =
    characterDirty ||
    bioDirty ||
    colorPriorityDirty ||
    graphicsDirty ||
    soundsDirty ||
    passwordDirty;

  const confirmLeaveWithUnsavedChanges = useCallback((): boolean => {
    if (!hasUnsavedChanges) {
      return true;
    }

    return window.confirm(
      "You have unsaved changes.\n\nLeave this page and discard them?\n\nOK: Yes, leave.\nCancel: No, return.",
    );
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

  const handleBioSave = async () => {
    const uid = userId.trim();
    if (!uid || savingBio) {
      return;
    }

    const normalizedDraft = bioDraft.trim();
    if (normalizedDraft.length > BIO_MAX_LENGTH) {
      message.error(`Bio can be max ${BIO_MAX_LENGTH} characters.`);
      return;
    }

    const authToken = token.trim();
    const nextBio = normalizedDraft.length > 0 ? normalizedDraft : "";

    setSavingBio(true);
    try {
      if (authToken) {
        await apiService.putWithAuth(`/users/${encodeURIComponent(uid)}`, { bio: nextBio }, authToken);
      } else {
        await apiService.put(`/users/${encodeURIComponent(uid)}`, { bio: nextBio });
      }
      setBioValue(nextBio);
      setBioDraft(nextBio);
      setEditingBio(false);
      message.success("Bio saved.");
    } catch (error) {
      if (error instanceof Error) {
        alert(`Could not save bio:\n${error.message}`);
      }
    } finally {
      setSavingBio(false);
    }
  };

  const handleBioCancel = () => {
    setBioDraft(bioValue);
    setEditingBio(false);
  };

  const handleColorPriorityChange = (index: number, nextColor: string) => {
    setColorPriority((prev) => {
      if (prev.some((picked, pickedIndex) => pickedIndex !== index && picked === nextColor)) {
        return prev;
      }
      const next = [...prev];
      next[index] = nextColor;
      return next;
    });
  };

  const handleColorPrioritySave = async () => {
    if (new Set(colorPriority).size !== PRIORITY_COLOR_OPTIONS.length) {
      message.error("Each preferred color must be unique.");
      return;
    }
    setSavingPriority(true);
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    setSavedColorPriority([...colorPriority]);
    setSavingPriority(false);
    message.success("Preferred color priorities saved.");
  };

  const handleCharacterSave = async () => {
    setSavingCharacter(true);
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    setSavedCharacter(selectedCharacter);
    setSavingCharacter(false);
    message.success("Profile picture selection saved.");
  };

  const handleGraphicsSave = async () => {
    setSavingGraphics(true);
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    setSavedGraphicsSelection({
      selectedMenuBackground,
      selectedGameBackground,
      selectedPrimaryColor,
      selectedTextColor,
    });
    setSavingGraphics(false);
    message.success("Graphics settings saved.");
  };

  const handleSoundsSave = async () => {
    setSavingSounds(true);
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    setSavedSoundsSelection({
      musicVolume,
      soundEffectsVolume,
      musicBlacklist: [...normalizedMusicBlacklist],
    });
    setSavingSounds(false);
    message.success("Sound settings saved.");
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

  const handleBack = () => {
    if (!confirmLeaveWithUnsavedChanges()) {
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
                  <Button
                    type="default"
                    className="settings-inline-action-btn"
                    loading={savingCharacter}
                    disabled={!characterDirty}
                    onClick={() => void handleCharacterSave()}
                  >
                    Save
                  </Button>
                </div>
                <div className="settings-character-scroll" role="listbox" aria-label="Choose profile character">
                  {CHARACTER_OPTIONS.map((character) => (
                    <button
                      key={character.id}
                      type="button"
                      className={`settings-character-tile${selectedCharacter === character.id ? " settings-character-tile-selected" : ""}`}
                      onClick={() => setSelectedCharacter(character.id)}
                      aria-label={character.label}
                      aria-selected={selectedCharacter === character.id}
                    >
                      <Image
                        src={character.src}
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
                      <>
                        <Button
                          type="primary"
                          className="settings-inline-action-btn"
                          loading={savingBio}
                          disabled={!bioDirty}
                          onClick={() => void handleBioSave()}
                        >
                          Save
                        </Button>
                        <Button
                          type="default"
                          className="settings-inline-action-btn"
                          disabled={savingBio}
                          onClick={handleBioCancel}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="default"
                        className="settings-inline-action-btn"
                        onClick={() => setEditingBio(true)}
                      >
                        Edit
                      </Button>
                    )}
                  </span>
                </div>
                {editingBio ? (
                  <Input.TextArea
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
                  <span className="settings-option-title">Preferred Color Priority</span>
                  <Button
                    type="default"
                    className="settings-inline-action-btn"
                    loading={savingPriority}
                    disabled={!colorPriorityDirty}
                    onClick={() => void handleColorPrioritySave()}
                  >
                    Save
                  </Button>
                </div>
                <div className="settings-priority-grid">
                  {PRIORITY_LABELS.map((priorityLabel, index) => (
                    <div key={priorityLabel} className="settings-priority-col">
                      <span className="settings-priority-label">{priorityLabel} choice</span>
                      <Select
                        value={colorPriority[index]}
                        options={colorPriorityOptionsByIndex[index]}
                        onChange={(value) => handleColorPriorityChange(index, value)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card>

          <Card
            className="dashboard-container"
            title={<div className="dashboard-section-title">Graphics</div>}
          >
            <div className="settings-panel">
              <div className="settings-option-block">
                <div className="settings-option-title">Menu Background</div>
                <div className="settings-background-scroll" role="listbox" aria-label="Select menu background">
                  {MENU_BACKGROUND_OPTIONS.map((backgroundOption) => (
                    <button
                      key={backgroundOption.id}
                      type="button"
                      className={`settings-background-tile${selectedMenuBackground === backgroundOption.id ? " settings-background-tile-selected" : ""}`}
                      onClick={() => setSelectedMenuBackground(backgroundOption.id)}
                      aria-label={backgroundOption.label}
                      aria-selected={selectedMenuBackground === backgroundOption.id}
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
                  {GAME_BACKGROUND_OPTIONS.map((backgroundOption) => (
                    <button
                      key={backgroundOption.id}
                      type="button"
                      className={`settings-background-tile${selectedGameBackground === backgroundOption.id ? " settings-background-tile-selected" : ""}`}
                      onClick={() => setSelectedGameBackground(backgroundOption.id)}
                      aria-label={backgroundOption.label}
                      aria-selected={selectedGameBackground === backgroundOption.id}
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
                <div className="settings-option-title">Primary Colors</div>
                <div className="settings-color-chip-row" role="listbox" aria-label="Select primary color">
                  {PRIMARY_COLOR_OPTIONS.map((colorOption) => (
                    <button
                      key={colorOption.id}
                      type="button"
                      className={`settings-color-chip${selectedPrimaryColor === colorOption.id ? " settings-color-chip-selected" : ""}`}
                      style={{ ["--settings-chip-color" as string]: colorOption.hex }}
                      onClick={() => setSelectedPrimaryColor(colorOption.id)}
                      aria-label={colorOption.label}
                      aria-selected={selectedPrimaryColor === colorOption.id}
                    />
                  ))}
                </div>
              </div>

              <div className="settings-option-block">
                <div className="settings-option-title">Text Colors</div>
                <div className="settings-color-chip-row" role="listbox" aria-label="Select text color">
                  {TEXT_COLOR_OPTIONS.map((colorOption) => (
                    <button
                      key={colorOption.id}
                      type="button"
                      className={`settings-color-chip settings-color-chip-text${selectedTextColor === colorOption.id ? " settings-color-chip-selected" : ""}`}
                      style={{ ["--settings-chip-color" as string]: colorOption.hex }}
                      onClick={() => setSelectedTextColor(colorOption.id)}
                      aria-label={colorOption.label}
                      aria-selected={selectedTextColor === colorOption.id}
                    />
                  ))}
                </div>
              </div>

              <div className="settings-card-actions">
                <Button
                  type="primary"
                  loading={savingGraphics}
                  disabled={!graphicsDirty}
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
                  className="settings-music-blacklist-select"
                  mode="tags"
                  value={musicBlacklist}
                  onChange={(values) => setMusicBlacklist(values.map((value) => String(value).trim()).filter((value) => value.length > 0))}
                  placeholder="Add tags like music_01"
                  tokenSeparators={[",", " "]}
                />
              </div>

              <div className="settings-card-actions">
                <Button
                  type="primary"
                  loading={savingSounds}
                  disabled={!soundsDirty}
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
                rules={[{ required: true, message: "Please enter your new password." }]}
              >
                <Input type="password" placeholder="Enter your new password" />
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
                <Input type="password" placeholder="Re-enter your new password" />
              </Form.Item>
              <div className="dashboard-button-stack">
                <Button
                  type="primary"
                  loading={savingPassword}
                  disabled={!passwordDirty}
                  onClick={() => void handlePasswordSave()}
                >
                  Save Password
                </Button>
              </div>
            </Form>
          </Card>

          <Card className="dashboard-container">
            <div className="dashboard-button-stack">
              <Button type="default" onClick={handleBack}>{"\u2190"} Back</Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
