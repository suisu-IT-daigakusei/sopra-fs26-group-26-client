import { useCallback, useEffect, useRef, useState } from "react";

const LOCAL_STORAGE_SYNC_EVENT = "local-storage-sync";

function dispatchLocalStorageSync(key: string): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<string>(LOCAL_STORAGE_SYNC_EVENT, { detail: key }),
  );
}

interface LocalStorage<T> {
  value: T;
  set: (newVal: T) => void;
  clear: () => void;
}

/**
 * This custom function/hook safely handles SSR by checking
 * for the window before accessing browser localStorage.
 * IMPORTANT: It has a local react state AND a localStorage state.
 * When initializing the state with a default value,
 * clearing will revert to this default value for the state and
 * the corresponding token gets deleted in the localStorage.
 *
 * @param key - The key from localStorage, generic type T.
 * @param defaultValue - The default value if nothing is in localStorage yet.
 * @returns An object containing:
 *  - value: The current value (synced with localStorage).
 *  - set: Updates both react state & localStorage.
 *  - clear: Resets state to defaultValue and deletes localStorage key.
 */
export default function useLocalStorage<T>(
  key: string,
  defaultValue: T,
): LocalStorage<T> {
  // Keep the initial default stable so callers can safely pass literals like [] or {}.
  const defaultValueRef = useRef<T>(defaultValue);

  const readStoredValue = useCallback((): T => {
    if (typeof window === "undefined") {
      return defaultValueRef.current;
    }

    try {
      const stored = globalThis.localStorage.getItem(key);
      if (!stored) {
        return defaultValueRef.current;
      }

      try {
        return JSON.parse(stored) as T;
      } catch {
        // fallback for legacy plain-string values that were not JSON-stringified
        return stored as T;
      }
    } catch (error) {
      console.error(`Error reading localStorage key "${key}":`, error);
      return defaultValueRef.current;
    }
  }, [key]);

  const [value, setValue] = useState<T>(readStoredValue);

  // On mount, try to read the stored value
  useEffect(() => {
    setValue(readStoredValue());
  }, [readStoredValue]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const syncFromStorage = () => {
      setValue(readStoredValue());
    };

    const onStorageEvent = (event: StorageEvent) => {
      if (event.key === null || event.key === key) {
        syncFromStorage();
      }
    };

    const onCustomSync = (event: Event) => {
      const custom = event as CustomEvent<string>;
      if (typeof custom.detail !== "string" || custom.detail === key) {
        syncFromStorage();
      }
    };

    window.addEventListener("storage", onStorageEvent);
    window.addEventListener(LOCAL_STORAGE_SYNC_EVENT, onCustomSync as EventListener);

    return () => {
      window.removeEventListener("storage", onStorageEvent);
      window.removeEventListener(LOCAL_STORAGE_SYNC_EVENT, onCustomSync as EventListener);
    };
  }, [key, readStoredValue]);

  // Simple setter updating state & localStorage
  const set = useCallback((newVal: T) => {
    setValue(newVal);
    if (typeof window !== "undefined") {
      globalThis.localStorage.setItem(key, JSON.stringify(newVal));
      dispatchLocalStorageSync(key);
    }
  }, [key]);

  // Removes key from localStorage and resets state
  const clear = useCallback(() => {
    setValue(defaultValueRef.current);
    if (typeof window !== "undefined") {
      globalThis.localStorage.removeItem(key);
      dispatchLocalStorageSync(key);
    }
  }, [key]);

  return { value, set, clear };
}
