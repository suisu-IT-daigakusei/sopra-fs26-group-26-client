export const LOGIN_LOADING_FRAMES: readonly string[] = [
  "/login_loading_01.png",
  "/login_loading_02.png",
  "/login_loading_03.png",
  "/login_loading_04.png",
  "/login_loading_05.png",
  "/login_loading_06.png",
  "/login_loading_07.png",
  "/login_loading_08.png",
  "/login_loading_09.png",
];

export const GENERAL_LOADING_INTRO_FRAMES: readonly string[] = [
  "/general_loading_00a.png",
  "/general_loading_00b.png",
];

export const GENERAL_LOADING_LOOP_FRAMES: readonly string[] = [
  "/general_loading_01.png",
  "/general_loading_02.png",
  "/general_loading_03.png",
  "/general_loading_04.png",
  "/general_loading_05.png",
  "/general_loading_06.png",
  "/general_loading_07.png",
  "/general_loading_08.png",
];

let loginPreloadPromise: Promise<void> | null = null;
let generalPreloadPromise: Promise<void> | null = null;
const FRAME_PRELOAD_TIMEOUT_MS = 8_000;

function preloadFrames(framePaths: readonly string[]): Promise<void> {
  return Promise.all(
    framePaths.map((src) => new Promise<void>((resolve) => {
      const image = new window.Image();
      let settled = false;
      let timeoutId: number | null = null;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeoutId != null) {
          window.clearTimeout(timeoutId);
        }
        image.onload = null;
        image.onerror = null;
        resolve();
      };
      image.decoding = "async";
      image.onload = finish;
      image.onerror = finish;
      timeoutId = window.setTimeout(finish, FRAME_PRELOAD_TIMEOUT_MS);
      image.src = src;
      if (image.complete) {
        finish();
      }
    })),
  ).then(() => undefined);
}

/** Load the mandatory auth animation only once the user actually authenticates. */
export function preloadAuthRouteLoadingFrames(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }
  if (!loginPreloadPromise) {
    loginPreloadPromise = preloadFrames(LOGIN_LOADING_FRAMES);
  }
  return loginPreloadPromise;
}

export function preloadAuthRouteGeneralLoadingFrames(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }
  if (!generalPreloadPromise) {
    generalPreloadPromise = preloadFrames([
      ...GENERAL_LOADING_INTRO_FRAMES,
      ...GENERAL_LOADING_LOOP_FRAMES,
    ]);
  }
  return generalPreloadPromise;
}
