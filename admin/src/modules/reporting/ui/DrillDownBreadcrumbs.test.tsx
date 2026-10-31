import { describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { DrillDownBreadcrumbs, type BreadcrumbLevel } from './DrillDownBreadcrumbs'

const level = (label: string, key: string, value?: string): BreadcrumbLevel => ({ label, key, value, onClick: vi.fn() })

function crumbs(): string[] {
  const nav = screen.getByRole('navigation', { name: 'Drill-down path' })
  return within(nav).getAllByRole('listitem').map((item) => item.textContent ?? '')
}

/** The page side of the contract: a click on crumb i keeps levels 0..i, -1 clears them. */
function Harness({ onLevelClick }: { onLevelClick: (index: number) => void }) {
  const [levels, setLevels] = useState([level('Cricket', 'sport', 's1'), level('IPL', 'league', 'l1'), level('MI v CSK', 'event', 'e1')])
  return (
    <DrillDownBreadcrumbs
      levels={levels}
      currentLevel="event"
      domain="sports"
      onLevelClick={(index) => {
        onLevelClick(index)
        setLevels((current) => current.slice(0, index + 1))
      }}
    />
  )
}

describe('DrillDownBreadcrumbs', () => {
  test('at the root it shows the domain as the current location, with nothing to press', () => {
    render(<DrillDownBreadcrumbs levels={[]} currentLevel="all" domain="casino" onLevelClick={vi.fn()} />)
    assert.deepEqual(crumbs(), ['All Casino'])
    const current = screen.getByText('All Casino').closest('[aria-current]')
    assert.equal(current?.getAttribute('aria-current'), 'location')
    assert.equal(screen.queryAllByRole('button').length, 0)
  })

  test('drilled in, the root and middle levels are buttons and the last level is current', () => {
    render(
      <DrillDownBreadcrumbs
        levels={[level('Cricket', 'sport', 's1'), level('IPL', 'league', 'l1')]}
        currentLevel="league"
        domain="sports"
        onLevelClick={vi.fn()}
      />,
    )
    assert.deepEqual(crumbs(), ['All Sports', 'Cricket', 'IPL'])
    assert.deepEqual(
      screen.getAllByRole('button').map((button) => button.textContent),
      ['All Sports', 'Cricket'],
    )
    assert.equal(screen.getByText('IPL').closest('[aria-current]')?.getAttribute('aria-current'), 'location')
  })

  test('crumbs report their index (-1 for the root), never the level onClick', () => {
    const onLevelClick = vi.fn()
    const levels = [level('Cricket', 'sport', 's1'), level('IPL', 'league', 'l1')]
    render(<DrillDownBreadcrumbs levels={levels} currentLevel="league" domain="sports" onLevelClick={onLevelClick} />)
    fireEvent.click(screen.getByRole('button', { name: 'All Sports' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cricket' }))
    assert.deepEqual(onLevelClick.mock.calls, [[-1], [0]])
    assert.equal((levels[0].onClick as ReturnType<typeof vi.fn>).mock.calls.length, 0)
  })

  test('focus lands on the new current crumb when the pressed one stops being a button', () => {
    const onLevelClick = vi.fn()
    render(<Harness onLevelClick={onLevelClick} />)
    const ipl = screen.getByRole('button', { name: 'IPL' })
    ipl.focus()
    fireEvent.click(ipl)
    assert.deepEqual(crumbs(), ['All Sports', 'Cricket', 'IPL'])
    const current = screen.getByText('IPL').closest('[aria-current]')
    assert.equal(document.activeElement, current)

    const root = screen.getByRole('button', { name: 'All Sports' })
    root.focus()
    fireEvent.click(root)
    assert.deepEqual(crumbs(), ['All Sports'])
    assert.equal(document.activeElement, screen.getByText('All Sports').closest('[aria-current]'))
    assert.deepEqual(onLevelClick.mock.calls, [[1], [-1]])
  })

  test('glyphs and separators are hidden from assistive tech', () => {
    const { container } = render(
      <DrillDownBreadcrumbs levels={[level('Cricket', 'sport')]} currentLevel="sport" domain="sports" onLevelClick={vi.fn()} />,
    )
    for (const svg of container.querySelectorAll('svg')) assert.ok(svg.closest('[aria-hidden="true"]'))
  })
})
