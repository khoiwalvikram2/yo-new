// Theme management utilities for whitelabel support
import type { BrandTheme, ThemeName, ThemeMode } from '@/types'

const THEME_MODE_STORAGE_KEY = 'stakex_theme_mode'
const THEME_MODE_VERSION_KEY = 'stakex_theme_mode_version'
const THEME_MODE_VERSION = '2'

// NOVA's cobalt palette is the fallback; configured whitelabel branding still wins.
export const defaultTheme: BrandTheme = {
  '--brand-primary': '#2460EB',
  '--brand-primary-light': '#4D7DF0',
  '--brand-primary-dark': '#1848BC',
  '--brand-primary-shadow': 'rgba(36, 96, 235, 0.3)',
  '--brand-primary-shadow-light': 'rgba(36, 96, 235, 0.08)',

  '--brand-secondary': '#8B5CF6',
  '--brand-accent': '#3B82F6',
  '--brand-secondary-shadow': 'rgba(139, 92, 246, 0.08)',
  '--brand-accent-shadow': 'rgba(59, 130, 246, 0.08)',

  '--brand-neutral': '#121113',
  '--brand-neutral-light': 'rgba(40, 40, 50, 0.4)',
  '--brand-neutral-dark': 'rgba(15, 15, 20, 0.25)',
};

// Example blue theme for whitelabel
export const blueTheme: BrandTheme = {
  '--brand-primary': '#007AFF',
  '--brand-primary-light': '#4DA3FF',
  '--brand-primary-dark': '#0056CC',
  '--brand-primary-shadow': 'rgba(0, 122, 255, 0.3)',
  '--brand-primary-shadow-light': 'rgba(0, 122, 255, 0.08)',

  '--brand-secondary': '#5856D6',
  '--brand-accent': '#34C759',
  '--brand-secondary-shadow': 'rgba(88, 86, 214, 0.08)',
  '--brand-accent-shadow': 'rgba(52, 199, 89, 0.08)',

  '--brand-neutral': '#1C1C1E',
  '--brand-neutral-light': 'rgba(40, 40, 50, 0.4)',
  '--brand-neutral-dark': 'rgba(15, 15, 20, 0.25)',
};

// Example green theme for whitelabel
export const greenTheme: BrandTheme = {
  '--brand-primary': '#34C759',
  '--brand-primary-light': '#5AC85A',
  '--brand-primary-dark': '#248A3D',
  '--brand-primary-shadow': 'rgba(52, 199, 89, 0.3)',
  '--brand-primary-shadow-light': 'rgba(52, 199, 89, 0.08)',

  '--brand-secondary': '#FF9500',
  '--brand-accent': '#007AFF',
  '--brand-secondary-shadow': 'rgba(255, 149, 0, 0.08)',
  '--brand-accent-shadow': 'rgba(0, 122, 255, 0.08)',

  '--brand-neutral': '#1C1C1E',
  '--brand-neutral-light': 'rgba(40, 40, 50, 0.4)',
  '--brand-neutral-dark': 'rgba(15, 15, 20, 0.25)',
};

/**
 * Apply a brand theme to the application
 * @param theme - The brand theme to apply
 */
export function setBrandTheme(theme: Partial<BrandTheme>): void {
  if (typeof window === 'undefined') return;

  const root = document.documentElement;

  Object.entries(theme).forEach(([property, value]) => {
    if (value) {
      root.style.setProperty(property, value);
    }
  });
}

/**
 * Reset to default brand theme
 */
export function resetToDefaultTheme(): void {
  setBrandTheme(defaultTheme);
}

/**
 * Get current theme values
 */
export function getCurrentTheme(): BrandTheme {
  if (typeof window === 'undefined') return defaultTheme;

  const root = document.documentElement;
  const computedStyle = getComputedStyle(root);

  return {
    '--brand-primary': computedStyle.getPropertyValue('--brand-primary') || defaultTheme['--brand-primary'],
    '--brand-primary-light': computedStyle.getPropertyValue('--brand-primary-light') || defaultTheme['--brand-primary-light'],
    '--brand-primary-dark': computedStyle.getPropertyValue('--brand-primary-dark') || defaultTheme['--brand-primary-dark'],
    '--brand-primary-shadow': computedStyle.getPropertyValue('--brand-primary-shadow') || defaultTheme['--brand-primary-shadow'],
    '--brand-primary-shadow-light': computedStyle.getPropertyValue('--brand-primary-shadow-light') || defaultTheme['--brand-primary-shadow-light'],
    '--brand-secondary': computedStyle.getPropertyValue('--brand-secondary') || defaultTheme['--brand-secondary'],
    '--brand-accent': computedStyle.getPropertyValue('--brand-accent') || defaultTheme['--brand-accent'],
    '--brand-secondary-shadow': computedStyle.getPropertyValue('--brand-secondary-shadow') || defaultTheme['--brand-secondary-shadow'],
    '--brand-accent-shadow': computedStyle.getPropertyValue('--brand-accent-shadow') || defaultTheme['--brand-accent-shadow'],
    '--brand-neutral': computedStyle.getPropertyValue('--brand-neutral') || defaultTheme['--brand-neutral'],
    '--brand-neutral-light': computedStyle.getPropertyValue('--brand-neutral-light') || defaultTheme['--brand-neutral-light'],
    '--brand-neutral-dark': computedStyle.getPropertyValue('--brand-neutral-dark') || defaultTheme['--brand-neutral-dark'],
  };
}

/**
 * Save theme to localStorage
 */
export function saveTheme(theme: Partial<BrandTheme>): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('stakex_brand_theme', JSON.stringify(theme));
}

/**
 * Load theme from localStorage
 */
export function loadTheme(): Partial<BrandTheme> | null {
  if (typeof window === 'undefined') return null;

  try {
    const saved = localStorage.getItem('stakex_brand_theme');
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

/**
 * Initialize theme on app startup
 */
export function initializeTheme(): void {
  if (typeof window === 'undefined') return;

  const savedTheme = loadTheme();
  if (savedTheme) {
    setBrandTheme(savedTheme);
  } else {
    setBrandTheme(defaultTheme);
  }
}

// Legacy compatibility exports for existing ThemeSwitch component
 

export function applyTheme(themeName: ThemeName): void {
  if (typeof window === 'undefined') return;

  const body = document.body;

  if (themeName === 'modern') {
    setBrandTheme(defaultTheme);
    body.classList.add('theme-modern');
    body.classList.remove('theme-classic');
  } else {
    setBrandTheme(defaultTheme);
    body.classList.remove('theme-modern');
    body.classList.add('theme-classic');
  }
}

export function getThemeFromStorage(): ThemeName {
  if (typeof window === 'undefined') return 'modern';

  try {
    const saved = localStorage.getItem('stakex_theme');
    return (saved === 'classic' || saved === 'modern') ? saved : 'modern';
  } catch {
    return 'modern';
  }
}

export function setThemeToStorage(themeName: ThemeName): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('stakex_theme', themeName);
}

// Alias for initializeTheme - used at app startup
export function applyThemeAtStartup(): void {
  initializeTheme();
  initializeThemeMode();
}

// Light/Dark Theme Mode Support
 

// Light and dark theme color mappings
const lightThemeColors = {
  '--background': 'var(--background-light)',
  '--surface': 'var(--surface-light)',
  '--surface-2': 'var(--surface-2-light)',
  '--muted': 'var(--muted-light)',
  '--border': 'var(--border-light)',
  '--text': 'var(--text-light)',
  '--subtle': 'var(--subtle-light)',
  // Shadows for light theme
  '--shadow': 'var(--shadow-light)',
  '--shadow-md': 'var(--shadow-light-md)',
  '--shadow-lg': 'var(--shadow-light-lg)',
  '--shadow-xl': 'var(--shadow-light-xl)',
  // Backdrop for light theme
  '--backdrop-overlay': 'var(--backdrop-light)',
  // Toggle shadow for light theme
  '--toggle-shadow': 'var(--toggle-shadow-light)',
  // Newly added surfaces/borders/subtle tiers
  '--surface-3': 'var(--surface-3-light)',
  '--border-2': 'var(--border-2-light)',
  '--border-3': 'var(--border-3-light)',
  '--subtle-3': 'var(--subtle-3-light)',
};

const darkThemeColors = {
  '--background': 'var(--background-dark)',
  '--surface': 'var(--surface-dark)',
  '--surface-2': 'var(--surface-2-dark)',
  '--muted': 'var(--muted-dark)',
  '--border': 'var(--border-dark)',
  '--text': 'var(--text-dark)',
  '--subtle': 'var(--subtle-dark)',
  // Shadows for dark theme
  '--shadow': 'var(--shadow-dark)',
  '--shadow-md': 'var(--shadow-dark-md)',
  '--shadow-lg': 'var(--shadow-dark-lg)',
  '--shadow-xl': 'var(--shadow-dark-xl)',
  // Backdrop for dark theme
  '--backdrop-overlay': 'var(--backdrop-dark)',
  // Toggle shadow for dark theme
  '--toggle-shadow': 'var(--toggle-shadow-dark)',
  // Newly added surfaces/borders/subtle tiers
  '--surface-3': 'var(--surface-3-dark)',
  '--border-2': 'var(--border-2-dark)',
  '--border-3': 'var(--border-3-dark)',
  '--subtle-3': 'var(--subtle-3-dark)',
};

/**
 * Set light or dark theme mode
 * Apply the selected mode, including before the first React render.
 */
export function setThemeMode(mode: ThemeMode): void {
  if (typeof window === 'undefined') return;

  const root = document.documentElement;
  const body = document.body;

  Object.entries(mode === 'dark' ? darkThemeColors : lightThemeColors).forEach(([property, value]) => {
    root.style.setProperty(property, value);
  });

  root.classList.toggle('dark', mode === 'dark');
  root.classList.toggle('light', mode === 'light');
  root.style.colorScheme = mode;
  try {
    localStorage.setItem(THEME_MODE_STORAGE_KEY, mode);
    localStorage.setItem(THEME_MODE_VERSION_KEY, THEME_MODE_VERSION);
  } catch {
    // Storage may be blocked; switching this session must still work.
  }

  // Dispatch custom event for app-settings to listen
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('theme-mode-change', { detail: { mode } }))
  }

  // Always apply modern theme effects
  const currentModernTheme = getThemeFromStorage();
  const shouldApplyModern = currentModernTheme === 'modern' || currentModernTheme === 'classic' ? currentModernTheme === 'modern' : true;

  if (shouldApplyModern) {
    body.classList.add('theme-modern');
    body.classList.remove('theme-classic');
  } else {
    body.classList.remove('theme-modern');
    body.classList.add('theme-classic');
  }
}

/**
 * Get current theme mode from storage
 */
export function getThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  try {
    // Version 1 always persisted dark during startup, so it was not a real choice.
    // Only v2+ preferences came from the user's explicit light/dark toggle.
    if (localStorage.getItem(THEME_MODE_VERSION_KEY) !== THEME_MODE_VERSION) return 'light';
    const saved = localStorage.getItem(THEME_MODE_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // First visit and blocked storage both use the accessible light default.
  }

  return 'light';
}

/**
 * Toggle between light and dark themes
 */
export function toggleThemeMode(): void {
  const currentMode = typeof document !== 'undefined'
    ? document.documentElement.classList.contains('dark') ? 'dark' : 'light'
    : getThemeMode();
  const newMode: ThemeMode = currentMode === 'light' ? 'dark' : 'light';
  setThemeMode(newMode);
}

/**
 * Initialize theme mode on app startup
 */
export function initializeThemeMode(): void {
  const savedMode = getThemeMode();
  setThemeMode(savedMode);
}
