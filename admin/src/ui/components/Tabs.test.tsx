/**
 * A tab strip has to behave as a tablist, not as a row of buttons: one tab stop for the whole strip,
 * arrows moving selection and focus together, and `aria-controls` only on the selected tab, because
 * the other panels are not in the DOM. This is the model the dashboard's strip proved; the kit now
 * owns it.
 */
import { test, describe, afterEach } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Tabs } from './Tabs'
import { tabId, tabPanelId } from './tabIds'

afterEach(cleanup)

const ITEMS = [
  { value: 'overview', label: 'Overview' },
  { value: 'players', label: 'Players' },
  { value: 'financial', label: 'Financial' },
] as const

describe('Tabs', () => {
  test('is a named tablist whose selected tab points at its panel', () => {
    render(<Tabs value="players" items={ITEMS} onChange={() => {}} label="Dashboard tabs" idPrefix="ov" />)
    assert.ok(screen.getByRole('tablist', { name: 'Dashboard tabs' }))

    const selected = screen.getByRole('tab', { name: 'Players' })
    assert.equal(selected.getAttribute('aria-selected'), 'true')
    assert.equal(selected.id, tabId('ov', 'players'))
    assert.equal(selected.getAttribute('aria-controls'), tabPanelId('ov', 'players'))

    // an unselected tab has no panel to point at: it is not mounted
    assert.equal(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-controls'), null)
  })

  test('has exactly one tab stop, on the selected tab', () => {
    render(<Tabs value="financial" items={ITEMS} onChange={() => {}} label="Dashboard tabs" idPrefix="ov" />)
    const stops = screen.getAllByRole('tab').filter((tab) => tab.getAttribute('tabindex') === '0')
    assert.equal(stops.length, 1)
    assert.equal(stops[0].textContent, 'Financial')
  })

  test('falls back to one tab stop when the value matches no tab', () => {
    render(<Tabs value={'time' as 'overview'} items={ITEMS} onChange={() => {}} label="Dashboard tabs" idPrefix="ov" />)
    const stops = screen.getAllByRole('tab').filter((tab) => tab.getAttribute('tabindex') === '0')
    assert.equal(stops.length, 1)
    assert.equal(stops[0].textContent, 'Overview')
  })

  test('arrows move selection and wrap, Home and End jump to the ends', () => {
    const picked: string[] = []
    render(
      <Tabs value="overview" items={ITEMS} onChange={(v) => picked.push(v)} label="Dashboard tabs" idPrefix="ov" />
    )
    const first = screen.getByRole('tab', { name: 'Overview' })
    fireEvent.keyDown(first, { key: 'ArrowRight' })
    fireEvent.keyDown(first, { key: 'ArrowLeft' })
    fireEvent.keyDown(first, { key: 'End' })
    fireEvent.keyDown(first, { key: 'Home' })
    assert.deepEqual(picked, ['players', 'financial', 'financial', 'overview'])
  })

  test('a count shows after the label and joins the tab name with a pause', () => {
    render(
      <Tabs
        value="pending"
        items={[
          { value: 'pending', label: 'Pending', count: 18 },
          { value: 'done', label: 'Done', count: 0 },
          { value: 'all', label: 'All' },
        ]}
        onChange={() => {}}
        label="Request tabs"
        idPrefix="rq"
      />,
    )
    const pending = screen.getByRole('tab', { name: 'Pending, 18' })
    assert.equal(pending.textContent, 'Pending18')
    assert.equal(pending.lastElementChild?.textContent, '18')
    // zero is a count, not an absent one
    assert.ok(screen.getByRole('tab', { name: 'Done, 0' }))
    // a tab without one keeps its plain name and markup
    const all = screen.getByRole('tab', { name: 'All' })
    assert.equal(all.getAttribute('aria-label'), null)
    assert.equal(all.children.length, 1)
  })

  test('leaves other keys to the browser', () => {
    const picked: string[] = []
    render(<Tabs value="overview" items={ITEMS} onChange={(v) => picked.push(v)} label="Dashboard tabs" idPrefix="ov" />)
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Overview' }), { key: 'ArrowDown' })
    assert.deepEqual(picked, [])
  })

  test('vertical settings navigation uses Up/Down, wraps, and keeps a single focus stop', () => {
    const picked: string[] = []
    render(<Tabs value="overview" items={ITEMS} onChange={value => picked.push(value)} label="Settings sections" idPrefix="settings" orientation="vertical" />)
    assert.equal(screen.getByRole('tablist').getAttribute('aria-orientation'), 'vertical')
    const first = screen.getByRole('tab', { name: 'Overview' })
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    assert.equal(document.activeElement, screen.getByRole('tab', { name: 'Players' }))
    fireEvent.keyDown(first, { key: 'ArrowUp' })
    assert.equal(document.activeElement, screen.getByRole('tab', { name: 'Financial' }))
    fireEvent.keyDown(first, { key: 'Home' })
    fireEvent.keyDown(first, { key: 'End' })
    fireEvent.keyDown(first, { key: 'ArrowRight' })
    assert.deepEqual(picked, ['players', 'financial', 'overview', 'financial'])
    assert.equal(screen.getAllByRole('tab').filter(tab => tab.tabIndex === 0).length, 1)
  })

  test('the line variant keeps the tablist model; its group dividers are hidden and are not tabs', () => {
    const picked: string[] = []
    const { container } = render(
      <Tabs
        value="overview"
        items={[
          { value: 'overview', label: 'Overview', divider: true },
          { value: 'players', label: 'Players', count: 1200, divider: true },
          { value: 'log', label: 'Activity Log', divider: true },
        ]}
        onChange={(v) => picked.push(v)}
        label="Profile tabs"
        idPrefix="pf"
        variant="line"
      />,
    )
    assert.equal(screen.getAllByRole('tab').length, 3)
    assert.ok(screen.getByRole('tab', { name: 'Players, 1,200' }))
    // no divider before the first tab: one before each later tab that asks for it
    const tablist = screen.getByRole('tablist', { name: 'Profile tabs' })
    assert.equal(container.querySelectorAll('[aria-hidden="true"]').length, 2)
    assert.equal(tablist.firstElementChild?.getAttribute('role'), 'tab')
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Overview' }), { key: 'ArrowRight' })
    assert.deepEqual(picked, ['players'])
    assert.equal(document.activeElement, screen.getByRole('tab', { name: 'Players, 1,200' }))
  })
})
