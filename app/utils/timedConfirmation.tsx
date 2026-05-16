"use client";

export const DEFAULT_CONFIRM_TIMEOUT_SECONDS = 10;

export type TimedConfirmationOptions = {
  title: string;
  description?: string;
  okText?: string;
  cancelText?: string;
  danger?: boolean;
  timeoutSeconds?: number;
  autoCancelLabel?: string;
};

type ConfirmationPalette = {
  overlay: string;
  surface: string;
  border: string;
  title: string;
  text: string;
  countdown: string;
  countdownValue: string;
  cancelText: string;
  cancelBorder: string;
  cancelBg: string;
};

let confirmationSerial = 0;

function toSafeTimeoutSeconds(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_CONFIRM_TIMEOUT_SECONDS;
  }
  return Math.max(1, Math.floor(parsed));
}

function toBooleanLightAppearance(root: HTMLElement): boolean {
  const computed = getComputedStyle(root);
  const appearanceModeVar = String(computed.getPropertyValue("--cabo-appearance-mode") ?? "")
    .trim()
    .toLowerCase();
  const appearanceAttr = String(root.getAttribute("data-cabo-appearance") ?? "")
    .trim()
    .toLowerCase();
  if (appearanceModeVar === "light" || appearanceAttr === "light") {
    return true;
  }
  if (appearanceModeVar === "dark" || appearanceAttr === "dark") {
    return false;
  }
  return root.classList.contains("cabo-text-dark");
}

function getPrimaryColor(root: HTMLElement): string {
  const color = String(getComputedStyle(root).getPropertyValue("--cabo-primary-color") ?? "").trim();
  return color || "#e8a87c";
}

function getPalette(isLightAppearance: boolean): ConfirmationPalette {
  if (isLightAppearance) {
    return {
      overlay: "rgba(12, 18, 30, 0.42)",
      surface: "rgba(250, 246, 236, 0.99)",
      border: "rgba(44, 52, 70, 0.24)",
      title: "#1e2b42",
      text: "rgba(30, 43, 66, 0.92)",
      countdown: "#8a521e",
      countdownValue: "#b14e12",
      cancelText: "#405066",
      cancelBorder: "rgba(64, 80, 102, 0.42)",
      cancelBg: "rgba(255, 255, 255, 0.92)",
    };
  }

  return {
    overlay: "rgba(0, 0, 0, 0.56)",
    surface: "rgba(8, 10, 14, 0.99)",
    border: "rgba(255, 255, 255, 0.24)",
    title: "#ffffff",
    text: "rgba(238, 243, 255, 0.96)",
    countdown: "#ffd8a1",
    countdownValue: "#ffb14a",
    cancelText: "#ffffff",
    cancelBorder: "rgba(255, 255, 255, 0.4)",
    cancelBg: "rgba(30, 36, 48, 0.95)",
  };
}

function createButton(label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  Object.assign(button.style, {
    borderRadius: "10px",
    borderWidth: "1px",
    borderStyle: "solid",
    minWidth: "96px",
    minHeight: "44px",
    padding: "10px 16px",
    fontSize: "18px",
    lineHeight: "1",
    fontWeight: "700",
    cursor: "pointer",
    transition: "filter 120ms ease-out, transform 120ms ease-out",
  } satisfies Partial<CSSStyleDeclaration>);
  button.addEventListener("mouseenter", () => {
    button.style.filter = "brightness(1.08)";
    button.style.transform = "translateY(-1px)";
  });
  button.addEventListener("mouseleave", () => {
    button.style.filter = "none";
    button.style.transform = "none";
  });
  return button;
}

export function resolveConfirmationTimeoutSeconds(
  preferredSeconds: number = DEFAULT_CONFIRM_TIMEOUT_SECONDS,
  remainingSeconds?: number | null,
): number {
  const safePreferred = toSafeTimeoutSeconds(preferredSeconds);
  const parsedRemaining = Number(remainingSeconds);
  if (!Number.isFinite(parsedRemaining) || parsedRemaining <= 0) {
    return safePreferred;
  }
  return Math.max(1, Math.min(safePreferred, Math.ceil(parsedRemaining)));
}

export function showTimedConfirmation(options: TimedConfirmationOptions): Promise<boolean> {
  const timeoutSeconds = toSafeTimeoutSeconds(options.timeoutSeconds);
  const autoCancelLabel = String(options.autoCancelLabel ?? "Auto-cancel in").trim() || "Auto-cancel in";

  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.resolve(false);
  }

  const root = document.documentElement;
  const isLightAppearance = toBooleanLightAppearance(root);
  const palette = getPalette(isLightAppearance);
  const primaryColor = getPrimaryColor(root);
  const serial = confirmationSerial;
  confirmationSerial += 1;
  const overlayZ = 22000 + (serial * 2);

  return new Promise<boolean>((resolve) => {
    let settled = false;
    let remainingSeconds = timeoutSeconds;
    let intervalId: number | null = null;
    let timeoutId: number | null = null;

    const overlay = document.createElement("div");
    overlay.setAttribute("role", "presentation");
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: String(overlayZ),
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "18px",
      background: palette.overlay,
      backdropFilter: "blur(2px)",
      pointerEvents: "auto",
    } satisfies Partial<CSSStyleDeclaration>);

    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", String(options.title ?? "Confirmation"));
    Object.assign(dialog.style, {
      width: "min(92vw, 740px)",
      maxWidth: "740px",
      minHeight: "200px",
      borderRadius: "14px",
      border: `1px solid ${palette.border}`,
      background: palette.surface,
      color: palette.text,
      boxShadow: "0 24px 52px rgba(0, 0, 0, 0.34)",
      padding: "22px 24px 18px",
      display: "grid",
      gridTemplateRows: "auto 1fr auto",
      rowGap: "14px",
    } satisfies Partial<CSSStyleDeclaration>);

    const title = document.createElement("p");
    title.textContent = String(options.title ?? "").trim();
    Object.assign(title.style, {
      margin: "0",
      color: palette.title,
      fontSize: "22px",
      lineHeight: "1.24",
      fontWeight: "800",
      whiteSpace: "normal",
      wordBreak: "break-word",
    } satisfies Partial<CSSStyleDeclaration>);

    const body = document.createElement("div");
    Object.assign(body.style, {
      display: "grid",
      rowGap: "10px",
      alignContent: "start",
    } satisfies Partial<CSSStyleDeclaration>);

    if (options.description) {
      const description = document.createElement("p");
      description.textContent = String(options.description);
      Object.assign(description.style, {
        margin: "0",
        color: palette.text,
        fontSize: "15px",
        lineHeight: "1.34",
        whiteSpace: "normal",
      } satisfies Partial<CSSStyleDeclaration>);
      body.appendChild(description);
    }

    const countdown = document.createElement("p");
    Object.assign(countdown.style, {
      margin: "0",
      color: palette.countdown,
      fontSize: "14px",
      lineHeight: "1.25",
      fontWeight: "700",
    } satisfies Partial<CSSStyleDeclaration>);
    const countdownPrefix = document.createElement("span");
    countdownPrefix.textContent = `${autoCancelLabel} `;
    const countdownValue = document.createElement("span");
    Object.assign(countdownValue.style, {
      color: palette.countdownValue,
      fontWeight: "800",
    } satisfies Partial<CSSStyleDeclaration>);
    countdown.append(countdownPrefix, countdownValue);
    body.appendChild(countdown);

    const actions = document.createElement("div");
    Object.assign(actions.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: "10px",
    } satisfies Partial<CSSStyleDeclaration>);

    const cancelButton = createButton(options.cancelText ?? "No");
    Object.assign(cancelButton.style, {
      color: palette.cancelText,
      borderColor: palette.cancelBorder,
      background: palette.cancelBg,
    } satisfies Partial<CSSStyleDeclaration>);

    const okButton = createButton(options.okText ?? "Yes");
    if (options.danger) {
      Object.assign(okButton.style, {
        color: "#ffffff",
        borderColor: "#9e2f24",
        background: "#c0392b",
      } satisfies Partial<CSSStyleDeclaration>);
    } else {
      Object.assign(okButton.style, {
        color: "#ffffff",
        borderColor: primaryColor,
        background: primaryColor,
      } satisfies Partial<CSSStyleDeclaration>);
    }

    actions.append(cancelButton, okButton);
    dialog.append(title, body, actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const updateCountdownText = () => {
      countdownValue.textContent = `${remainingSeconds}s`;
    };
    updateCountdownText();

    const clearTimers = () => {
      if (intervalId != null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const cleanup = () => {
      clearTimers();
      window.removeEventListener("keydown", handleKeyDown, true);
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    };

    const settle = (value: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      settle(false);
    };

    cancelButton.addEventListener("click", () => settle(false));
    okButton.addEventListener("click", () => settle(true));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        settle(false);
      }
    });
    window.addEventListener("keydown", handleKeyDown, true);

    intervalId = window.setInterval(() => {
      remainingSeconds = Math.max(0, remainingSeconds - 1);
      if (remainingSeconds <= 0) {
        return;
      }
      updateCountdownText();
    }, 1000);

    timeoutId = window.setTimeout(() => {
      settle(false);
    }, timeoutSeconds * 1000);
  });
}
