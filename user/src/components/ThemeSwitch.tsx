import { Sun, Moon } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ThemeMode } from '@/types'
import { getThemeMode, setThemeMode } from '../lib/theme'
import './theme-switch.css'

/** `switch`: the sliding sun/moon switch (menu panel, Settings). `icon`: the header's one square button showing the mode it switches to. */
export default function ThemeSwitch({ variant = 'switch' }: { variant?: 'switch' | 'icon' } = {}) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => typeof document === 'undefined'
    ? getThemeMode() : document.documentElement.classList.contains('dark') ? 'dark' : 'light')

  useEffect(() => {
    const sync = () => setThemeModeState(document.documentElement.classList.contains('dark') ? 'dark' : 'light')
    const storage = (event: StorageEvent) => {
      if (event.key === 'stakex_theme_mode' || event.key === null) setThemeMode(getThemeMode())
    }
    window.addEventListener('theme-mode-change', sync)
    window.addEventListener('storage', storage)
    return () => {
      window.removeEventListener('theme-mode-change', sync)
      window.removeEventListener('storage', storage)
    }
  }, [])

  const handleToggle = () => {
    const newMode = themeMode === 'light' ? 'dark' : 'light'
    setThemeMode(newMode) // Apply theme mode
    setThemeModeState(newMode) // Update local state
  }

  return (
    <button
      type="button"
      aria-label={`Switch to ${themeMode === 'light' ? 'dark' : 'light'} theme`}
      aria-pressed={themeMode === 'dark'}
      title={`Switch to ${themeMode === 'light' ? 'dark' : 'light'} theme`}
      onClick={handleToggle}
      className={variant === 'icon' ? 'nova-theme-toggle nova-theme-icon' : 'nova-theme-toggle'}
    >
      {variant === 'icon'
        ? themeMode === 'light' ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />
        : /* A sliding switch: the knob sits on the sun in light mode and on the moon in dark mode. */
          <span className="nova-theme-track" aria-hidden="true">
            <Sun size={14} />
            <Moon size={14} />
            <span className="nova-theme-knob" />
          </span>}
    </button>
  )
}


