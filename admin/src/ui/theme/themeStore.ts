import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export type ThemeMode = 'light' | 'dark' | 'system'
export const THEME_STORAGE_KEY = 'theme-mode'
export const DEFAULT_THEME_MODE: ThemeMode = 'light'

/** The query 'system' resolves through. The first-frame script in index.html reads the same one. */
export const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)'

export interface ThemeState {
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
  toggle: () => void
}

/** True only when the OS asks for dark. Safe where window/matchMedia is absent (jsdom, SSR). */
function prefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  try {
    return window.matchMedia(DARK_MEDIA_QUERY).matches
  } catch {
    return false
  }
}

/** Persisted JSON is untrusted; invalid/missing modes match index.html's first-frame light fallback. */
function normalizeThemeMode(mode: unknown): ThemeMode {
  return mode === 'light' || mode === 'dark' || mode === 'system' ? mode : DEFAULT_THEME_MODE
}

/** Resolves a valid mode to the concrete palette; only explicit 'system' follows the OS. */
export function resolveTheme(mode: unknown): 'light' | 'dark' {
  const validMode = normalizeThemeMode(mode)
  if (validMode === 'light' || validMode === 'dark') return validMode
  return prefersDark() ? 'dark' : 'light'
}

/** The three-state cycle the topbar toggle walks: light -> dark -> system -> light. */
function nextMode(mode: ThemeMode): ThemeMode {
  if (mode === 'light') return 'dark'
  if (mode === 'dark') return 'system'
  return 'light'
}

/** Sets <html data-theme> to the RESOLVED palette for the given mode. */
export function applyThemeMode(mode: ThemeMode): void {
  document.documentElement.dataset.theme = resolveTheme(mode)
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      mode: DEFAULT_THEME_MODE,
      setMode: (mode) => {
        set({ mode })
        applyThemeMode(mode)
      },
      toggle: () => {
        const next: ThemeMode = nextMode(get().mode)
        set({ mode: next })
        applyThemeMode(next)
      },
    }),
    {
      name: THEME_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ mode: state.mode }),
      merge: (persistedState, currentState) => {
        const savedMode = persistedState && typeof persistedState === 'object'
          ? (persistedState as { mode?: unknown }).mode
          : undefined
        // Restore only the preference; never replace store methods with keys from persisted JSON.
        return { ...currentState, mode: normalizeThemeMode(savedMode) }
      },
      onRehydrateStorage: (currentState) => (state, error) => {
        if (error) {
          // A corrupt JSON value skips merge entirely. Keep the store, label and first frame in sync.
          try { currentState.setMode(DEFAULT_THEME_MODE) }
          catch { applyThemeMode(DEFAULT_THEME_MODE) }
          return
        }
        applyThemeMode(state?.mode ?? DEFAULT_THEME_MODE)
      },
    }
  )
)

/**
 * Re-applies the palette when the OS preference flips, but only while the stored mode is
 * 'system' — an explicit 'light'/'dark' choice must never be overridden by the OS. Returns an
 * unsubscribe. No-ops where window/matchMedia is missing so importing this module stays safe.
 */
export function startSystemThemeSync(): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}

  let query: MediaQueryList
  try {
    query = window.matchMedia(DARK_MEDIA_QUERY)
  } catch {
    return () => {}
  }
  if (typeof query.addEventListener !== 'function') return () => {}

  const onChange = (): void => {
    if (useThemeStore.getState().mode === 'system') applyThemeMode('system')
  }
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

// Started once, by the store module itself — deliberately not a React effect in a component.
startSystemThemeSync()
