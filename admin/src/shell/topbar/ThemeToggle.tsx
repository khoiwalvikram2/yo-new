import { IconDeviceDesktop, IconMoon, IconSun } from '@tabler/icons-react'
import { IconButton } from '@/ui/components/IconButton'
import { useThemeStore, type ThemeMode } from '@/ui/theme/themeStore'

const THEME_LABEL: Record<ThemeMode, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
}

/** The icon names the CURRENT state, one glyph per state in the light -> dark -> system cycle. */
function themeIcon(mode: ThemeMode) {
  if (mode === 'light') return <IconSun size={18} stroke={1.6} />
  if (mode === 'dark') return <IconMoon size={18} stroke={1.6} />
  return <IconDeviceDesktop size={18} stroke={1.6} />
}

export function ThemeToggle() {
  const mode = useThemeStore((state) => state.mode)
  const toggle = useThemeStore((state) => state.toggle)

  return (
    <IconButton
      label={`Theme: ${THEME_LABEL[mode]}. Activate to change.`}
      icon={themeIcon(mode)}
      onClick={toggle}
    />
  )
}
