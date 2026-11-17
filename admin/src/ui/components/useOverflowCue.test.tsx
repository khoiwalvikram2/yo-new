import { useState } from 'react'
import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { VIEW_WIDTH_PROPERTY, useOverflowCue } from './useOverflowCue'

const OriginalResizeObserver = globalThis.ResizeObserver

class ResizeObserverHarness implements ResizeObserver {
  static instances: ResizeObserverHarness[] = []

  readonly targets: Element[] = []
  private readonly callback: ResizeObserverCallback

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    ResizeObserverHarness.instances.push(this)
  }

  observe(target: Element): void {
    this.targets.push(target)
  }

  unobserve(target: Element): void {
    const index = this.targets.indexOf(target)
    if (index >= 0) this.targets.splice(index, 1)
  }

  disconnect(): void {
    this.targets.length = 0
  }

  takeRecords(): ResizeObserverEntry[] {
    return []
  }

  notify(): void {
    this.callback([], this)
  }
}

function setMetric(element: HTMLElement, name: 'scrollWidth' | 'clientWidth' | 'scrollLeft', value: number): void {
  Object.defineProperty(element, name, { configurable: true, writable: true, value })
}

function Probe({ revision = 0 }: { revision?: number }) {
  const { ref, cue, sync } = useOverflowCue<HTMLDivElement>([revision])
  const [syncs, setSyncs] = useState(0)

  return (
    <div>
      <div
        ref={ref}
        data-testid="scroller"
        data-over={String(cue.over)}
        data-start={String(cue.atStart)}
        data-end={String(cue.atEnd)}
      >
        <div data-testid="content" />
      </div>
      <button
        type="button"
        onClick={() => {
          sync()
          setSyncs((count) => count + 1)
        }}
      >
        Sync {syncs}
      </button>
    </div>
  )
}

afterEach(() => {
  globalThis.ResizeObserver = OriginalResizeObserver
  ResizeObserverHarness.instances.length = 0
})

describe('useOverflowCue', () => {
  test('reports no overflow as resting at both edges', () => {
    render(<Probe />)
    const scroller = screen.getByTestId('scroller')
    assert.equal(scroller.dataset.over, 'false')
    assert.equal(scroller.dataset.start, 'true')
    assert.equal(scroller.dataset.end, 'true')
  })

  test('reacts to scroll events and tolerates fractional pixels at both edges', () => {
    render(<Probe />)
    const scroller = screen.getByTestId('scroller')
    setMetric(scroller, 'scrollWidth', 900)
    setMetric(scroller, 'clientWidth', 500)
    setMetric(scroller, 'scrollLeft', 0.6)

    fireEvent.scroll(scroller)
    assert.equal(scroller.dataset.over, 'true')
    assert.equal(scroller.dataset.start, 'true')
    assert.equal(scroller.dataset.end, 'false')

    setMetric(scroller, 'scrollLeft', 200.25)
    fireEvent.scroll(scroller)
    assert.equal(scroller.dataset.start, 'false')
    assert.equal(scroller.dataset.end, 'false')

    setMetric(scroller, 'scrollLeft', 399.4)
    fireEvent.scroll(scroller)
    assert.equal(scroller.dataset.start, 'false')
    assert.equal(scroller.dataset.end, 'true')
  })

  test('normalises a negative RTL scroll offset', () => {
    render(<Probe />)
    const scroller = screen.getByTestId('scroller')
    setMetric(scroller, 'scrollWidth', 900)
    setMetric(scroller, 'clientWidth', 500)
    setMetric(scroller, 'scrollLeft', -400)
    fireEvent.scroll(scroller)

    assert.equal(scroller.dataset.over, 'true')
    assert.equal(scroller.dataset.start, 'false')
    assert.equal(scroller.dataset.end, 'true')
  })

  test('observes both the scroll box and its content, then recomputes on ResizeObserver delivery', () => {
    globalThis.ResizeObserver = ResizeObserverHarness
    render(<Probe />)

    const scroller = screen.getByTestId('scroller')
    const content = screen.getByTestId('content')
    const observer = ResizeObserverHarness.instances.at(-1)
    assert.ok(observer)
    assert.deepEqual(observer.targets, [scroller, content])

    setMetric(scroller, 'scrollWidth', 720)
    setMetric(scroller, 'clientWidth', 400)
    setMetric(scroller, 'scrollLeft', 0)
    act(() => observer.notify())
    assert.equal(scroller.dataset.over, 'true')

    setMetric(scroller, 'scrollWidth', 400)
    act(() => observer.notify())
    assert.equal(scroller.dataset.over, 'false')
    assert.equal(scroller.dataset.start, 'true')
    assert.equal(scroller.dataset.end, 'true')
  })

  test('recomputes on window resize, explicit sync and dependency changes', () => {
    const { rerender } = render(<Probe revision={0} />)
    const scroller = screen.getByTestId('scroller')
    setMetric(scroller, 'scrollWidth', 800)
    setMetric(scroller, 'clientWidth', 500)
    setMetric(scroller, 'scrollLeft', 0)

    fireEvent(window, new Event('resize'))
    assert.equal(scroller.dataset.over, 'true')

    setMetric(scroller, 'clientWidth', 800)
    fireEvent.click(screen.getByRole('button', { name: 'Sync 0' }))
    assert.equal(scroller.dataset.over, 'false')

    setMetric(scroller, 'clientWidth', 500)
    rerender(<Probe revision={1} />)
    assert.equal(scroller.dataset.over, 'true')
  })

  test('publishes the visible width on the scroller, for content pinned to the visible part', () => {
    globalThis.ResizeObserver = ResizeObserverHarness
    render(<Probe />)
    const scroller = screen.getByTestId('scroller')
    const observer = ResizeObserverHarness.instances.at(-1)
    assert.ok(observer)

    setMetric(scroller, 'scrollWidth', 1385)
    setMetric(scroller, 'clientWidth', 774)
    act(() => observer.notify())
    assert.equal(scroller.style.getPropertyValue(VIEW_WIDTH_PROPERTY), '774px')

    // A narrower viewport (a phone) re-measures it.
    setMetric(scroller, 'clientWidth', 336)
    fireEvent(window, new Event('resize'))
    assert.equal(scroller.style.getPropertyValue(VIEW_WIDTH_PROPERTY), '336px')

    // Hidden (a tab not shown) it measures 0: no width to pin to, so readers fall back to their own.
    setMetric(scroller, 'clientWidth', 0)
    setMetric(scroller, 'scrollWidth', 0)
    act(() => observer.notify())
    assert.equal(scroller.style.getPropertyValue(VIEW_WIDTH_PROPERTY), '')
  })

  test('disconnects its ResizeObserver on unmount', () => {
    globalThis.ResizeObserver = ResizeObserverHarness
    const { unmount } = render(<Probe />)
    const observer = ResizeObserverHarness.instances.at(-1)
    assert.ok(observer)
    assert.equal(observer.targets.length, 2)
    unmount()
    assert.equal(observer.targets.length, 0)
  })
})
