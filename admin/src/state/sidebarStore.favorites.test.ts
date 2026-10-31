/**
 * Favourites (starred nav rows) are the one piece of sidebarStore state that must survive the
 * removal of the old sidebar's collapsedSections/recentPages fields in this task. This file
 * only exercises favorites and localStorage['sidebar-storage'], so it passes unmodified before
 * and after that edit.
 */
import { test, describe, beforeEach } from 'vitest'
import assert from 'node:assert/strict'
import { useSidebarStore } from './sidebarStore'

describe('sidebarStore favourites', () => {
  beforeEach(() => {
    useSidebarStore.setState({ favorites: [] })
  })

  test('addFavorite adds a path and persists it to localStorage', () => {
    const added = useSidebarStore.getState().addFavorite('/players', 'Players', '')
    assert.equal(added, true)
    const raw = window.localStorage.getItem('sidebar-storage')
    assert.ok(raw)
    assert.ok(raw.includes('"favorites":["/players"]'))
  })

  test('the eighth favorite is rejected once seven are stored', () => {
    const { addFavorite } = useSidebarStore.getState()
    for (let i = 0; i < 7; i++) {
      assert.equal(addFavorite(`/path-${i}`, 'Label', ''), true)
    }
    assert.equal(useSidebarStore.getState().favorites.length, 7)
    assert.equal(addFavorite('/path-7', 'Label', ''), false)
    assert.equal(useSidebarStore.getState().favorites.length, 7)
  })

  test('removeFavorite removes a stored path', () => {
    useSidebarStore.getState().addFavorite('/players', 'Players', '')
    useSidebarStore.getState().removeFavorite('/players')
    assert.deepEqual(useSidebarStore.getState().favorites, [])
  })

  test('rehydrate restores favorites from localStorage', async () => {
    window.localStorage.setItem(
      'sidebar-storage',
      JSON.stringify({ state: { favorites: ['/agents'] }, version: 0 })
    )
    await useSidebarStore.persist.rehydrate()
    assert.deepEqual(useSidebarStore.getState().favorites, ['/agents'])
  })
})
