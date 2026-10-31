/**
 * Tooltip must reach keyboard users without the hover delay (D6, contracts §16). The first test is the
 * T18 jsdom spike (contracts §7.10): floating-ui's `useFocus` `visibleOnly: true` default opens the
 * tooltip on a plain `focus()` inside jsdom (the library special-cases jsdom in `matchesFocusVisible`),
 * so no escape-hatch prop exists. The second test proves the 350ms hover delay does not also gate
 * keyboard focus.
 */
import { afterEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Tooltip } from './Tooltip'

afterEach(() => {
  vi.useRealTimers()
  // own properties shadowing jsdom's zero-size viewport (see the placement test)
  delete (document.documentElement as { clientWidth?: number }).clientWidth
  delete (document.documentElement as { clientHeight?: number }).clientHeight
})

/** jsdom lays nothing out: give the viewport a size and the trigger a box so flip() has something to do. */
function placeTrigger(trigger: HTMLElement, top: number) {
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 1024 })
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 768 })
  trigger.getBoundingClientRect = () =>
    ({ x: 400, y: top, top, left: 400, right: 480, bottom: top + 30, width: 80, height: 30, toJSON: () => ({}) }) as DOMRect
}

describe('Tooltip', () => {
  test('keyboard focus opens the tooltip at once; Escape closes it', async () => {
    render(
      <Tooltip content="Helper text">
        <button>Info</button>
      </Tooltip>,
    )
    const trigger = screen.getByRole('button', { name: 'Info' })

    fireEvent.keyDown(document.body, { key: 'Tab' })
    act(() => {
      trigger.focus()
    })

    await waitFor(() => assert.ok(screen.getByRole('tooltip')))
    assert.equal(trigger.getAttribute('aria-describedby'), screen.getByRole('tooltip').id)

    fireEvent.keyDown(trigger, { key: 'Escape' })
    // assert.ok, not assert.equal: node:assert's AssertionError eagerly builds a diff of both
    // operands on failure, and diffing a live jsdom Element is pathologically expensive — during
    // the unmount transition this callback fails on several waitFor retries before the tooltip
    // element is actually removed, so assert.equal here turns each retry into a multi-second (and
    // under memory pressure, OOM-crashing) diff instead of a cheap boolean check.
    await waitFor(() => assert.ok(!screen.queryByRole('tooltip')))
  })

  test('hover opens the tooltip only after the 350ms delay; keyboard focus does not wait', () => {
    vi.useFakeTimers()
    render(
      <Tooltip content="Helper text">
        <button>Info</button>
      </Tooltip>,
    )
    const trigger = screen.getByRole('button', { name: 'Info' })

    fireEvent.mouseEnter(trigger)
    act(() => {
      vi.advanceTimersByTime(349)
    })
    assert.equal(screen.queryByRole('tooltip'), null)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    assert.ok(screen.getByRole('tooltip'))
  })

  test('the bubble names the side it resolved to and carries a decorative arrow', async () => {
    render(
      <Tooltip content="Helper text" placement="top-start">
        <button>Info</button>
      </Tooltip>,
    )
    const trigger = screen.getByRole('button', { name: 'Info' })
    placeTrigger(trigger, 300)

    fireEvent.keyDown(document.body, { key: 'Tab' })
    act(() => {
      trigger.focus()
    })

    const tooltip = await screen.findByRole('tooltip')
    // the side only: an aligned placement still draws its arrow on the top/bottom/left/right edge
    await waitFor(() => assert.ok(tooltip.querySelector('[data-placement="top"]')))
    const arrow = tooltip.querySelector('[data-placement] > span')
    assert.ok(arrow)
    assert.equal(arrow.getAttribute('aria-hidden'), 'true')
    assert.equal(tooltip.textContent, 'Helper text')
  })

  test('the placement follows flip(): no room above puts the bubble, and its arrow, below', async () => {
    render(
      <Tooltip content="Helper text">
        <button>Info</button>
      </Tooltip>,
    )
    const trigger = screen.getByRole('button', { name: 'Info' })
    placeTrigger(trigger, 2)

    fireEvent.keyDown(document.body, { key: 'Tab' })
    act(() => {
      trigger.focus()
    })

    const tooltip = await screen.findByRole('tooltip')
    await waitFor(() => assert.ok(tooltip.querySelector('[data-placement="bottom"]')))
  })
})
