/**
 * The legacy-named route-error frame inherits the same theme-safe tokens as the public region.
 */
import { test, describe } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'
import { LightRegion } from './LightRegion'

let previousTheme: string | null
beforeEach(() => { previousTheme = document.documentElement.getAttribute('data-theme'); document.documentElement.dataset.theme = 'dark' })
afterEach(() => { if (previousTheme === null) document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', previousTheme) })

describe('LightRegion', () => {
  test('renders children without forcing the active saved theme back to light', () => {
    render(
      <LightRegion>
        <p>Protected content</p>
      </LightRegion>
    )
    const child = screen.getByText('Protected content')
    const region = child.closest('[data-theme="light"]')
    assert.equal(Boolean(region), false)
    assert.equal(child.closest('[data-theme]')?.getAttribute('data-theme'), 'dark')
  })
})
