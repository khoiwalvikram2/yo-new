/**
 * FavoriteStar toggles a saved view in sidebarStore and, once seven are saved, disables itself with an
 * accessible tooltip instead of the old antd toast (R1 §d.1) so keyboard and screen-reader users get the
 * same explanation a mouse user gets from hovering the disabled star.
 */
import { test, describe, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useSidebarStore } from '@/state/sidebarStore'
import { FavoriteStar } from './FavoriteStar'
import { SAVED_VIEWS_LIMIT_MESSAGE } from './savedViews'

beforeEach(() => {
  useSidebarStore.setState({ favorites: [], maxFavorites: 7 })
})

describe('FavoriteStar', () => {
  test('adds then removes a favourite', () => {
    render(<FavoriteStar path="/players" label="Players" />)
    fireEvent.click(screen.getByRole('button', { name: 'Save view: Players' }))
    assert.deepEqual(useSidebarStore.getState().favorites, ['/players'])
    fireEvent.click(screen.getByRole('button', { name: 'Remove saved view: Players' }))
    assert.deepEqual(useSidebarStore.getState().favorites, [])
  })

  test('disables with a limit tooltip once seven views are saved', async () => {
    useSidebarStore.setState({
      favorites: ['/a', '/b', '/c', '/d', '/e', '/f', '/g'],
      maxFavorites: 7,
    })
    render(<FavoriteStar path="/players" label="Players" />)
    const button = screen.getByRole('button', { name: 'Save view: Players' })
    assert.equal(button.getAttribute('aria-disabled'), 'true')

    fireEvent.click(button)
    assert.deepEqual(useSidebarStore.getState().favorites, ['/a', '/b', '/c', '/d', '/e', '/f', '/g'])

    fireEvent.keyDown(document.body, { key: 'Tab' })
    act(() => {
      button.focus()
    })
    await waitFor(() => assert.ok(screen.getByRole('tooltip')))
    assert.equal(screen.getByRole('tooltip').textContent, SAVED_VIEWS_LIMIT_MESSAGE)
  })

  test('removing an already-saved view is never blocked, even at the limit', () => {
    useSidebarStore.setState({
      favorites: ['/players', '/a', '/b', '/c', '/d', '/e', '/f'],
      maxFavorites: 7,
    })
    render(<FavoriteStar path="/players" label="Players" />)
    const button = screen.getByRole('button', { name: 'Remove saved view: Players' })
    assert.equal(button.getAttribute('aria-disabled'), null)
    fireEvent.click(button)
    assert.deepEqual(useSidebarStore.getState().favorites, ['/a', '/b', '/c', '/d', '/e', '/f'])
  })
})
