/**
 * The topbar theme toggle is a single IconButton driven by themeStore: its label and icon
 * name the CURRENT theme, and clicking it advances the light -> dark -> system cycle,
 * flipping <html data-theme> via themeStore.toggle() (contracts §10.3, §4.1).
 */
import { test, describe, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeToggle } from './ThemeToggle'
import { useThemeStore } from '@/ui/theme/themeStore'

beforeEach(() => {
  useThemeStore.setState({ mode: 'light' })
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

describe('ThemeToggle', () => {
  test('an unknown persisted mode renders a valid Light label, never undefined, and can still toggle', async () => {
    localStorage.setItem('theme-mode', '{"state":{"mode":"sepia","toggle":"not a function"},"version":0}')
    await useThemeStore.persist.rehydrate()
    render(<ThemeToggle />)
    const button = screen.getByRole('button', { name: 'Theme: Light. Activate to change.' })
    assert.equal(screen.queryByRole('button', { name: /undefined/ }), null)
    fireEvent.click(button)
    assert.ok(screen.getByRole('button', { name: 'Theme: Dark. Activate to change.' }))
  })

  test('in light mode the button names the current theme, and one click advances to dark', () => {
    render(<ThemeToggle />)

    const button = screen.getByRole('button', { name: 'Theme: Light. Activate to change.' })
    fireEvent.click(button)

    assert.equal(document.documentElement.dataset.theme, 'dark')
    assert.ok(screen.getByRole('button', { name: 'Theme: Dark. Activate to change.' }))
  })

  test('when themeStore is already dark, the button names Dark rather than the theme a click leads to', () => {
    useThemeStore.setState({ mode: 'dark' })

    render(<ThemeToggle />)

    assert.ok(screen.getByRole('button', { name: 'Theme: Dark. Activate to change.' }))
    assert.ok(!screen.queryByRole('button', { name: 'Theme: Light. Activate to change.' }))
  })

  test('in system mode the button names System, and clicking it completes the cycle back to light', () => {
    useThemeStore.setState({ mode: 'system' })

    render(<ThemeToggle />)

    fireEvent.click(screen.getByRole('button', { name: 'Theme: System. Activate to change.' }))

    // vitest.setup.ts's matchMedia stub reports matches: false, so the OS reads as light here.
    assert.equal(document.documentElement.dataset.theme, 'light')
    assert.ok(screen.getByRole('button', { name: 'Theme: Light. Activate to change.' }))
  })
})
