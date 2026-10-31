/**
 * The group and the strip look identical and behave differently on purpose. The group is what the
 * mockup renders for the dashboard's period control: every button is a tab stop and each applies its
 * own value. Its state is `aria-pressed`, and a value outside the options — a custom date range, say —
 * must leave every button unpressed rather than pressing the first.
 */
import { test, describe, afterEach } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, render, screen } from '@testing-library/react'
import { SegmentedControl } from './SegmentedControl'

afterEach(cleanup)

const OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: '7d', label: '7D' },
] as const

describe('SegmentedControl', () => {
  test('is a named group of buttons with one pressed', () => {
    render(<SegmentedControl value="yesterday" options={OPTIONS} onChange={() => {}} label="Period" />)
    const group = screen.getByRole('group', { name: 'Period' })
    assert.equal(group.querySelectorAll('button').length, 3)
    assert.equal(screen.getByRole('button', { name: 'Yesterday' }).getAttribute('aria-pressed'), 'true')
    assert.equal(screen.getByRole('button', { name: 'Today' }).getAttribute('aria-pressed'), 'false')
  })

  test('leaves every button unpressed when the value is outside the options', () => {
    render(<SegmentedControl value={'custom' as 'today'} options={OPTIONS} onChange={() => {}} label="Period" />)
    for (const name of ['Today', 'Yesterday', '7D']) {
      assert.equal(screen.getByRole('button', { name }).getAttribute('aria-pressed'), 'false')
    }
  })

  test('applies the value of the button that was pressed', () => {
    const picked: string[] = []
    render(<SegmentedControl value="today" options={OPTIONS} onChange={(v) => picked.push(v)} label="Period" />)
    screen.getByRole('button', { name: '7D' }).click()
    assert.deepEqual(picked, ['7d'])
  })

  test('every button is a tab stop, unlike a tablist', () => {
    render(<SegmentedControl value="today" options={OPTIONS} onChange={() => {}} label="Period" />)
    for (const name of ['Today', 'Yesterday', '7D']) {
      assert.equal(screen.getByRole('button', { name }).getAttribute('tabindex'), null)
    }
  })

  test('a disabled option cannot be applied and its glyph stays decorative', () => {
    const picked: string[] = []
    render(
      <SegmentedControl
        value="today"
        options={[
          { value: 'today', label: 'Today' },
          { value: '7d', label: '7D', disabled: true, icon: <svg data-testid="glyph" /> },
        ]}
        onChange={(v) => picked.push(v)}
        label="Period"
      />
    )
    const disabled = screen.getByRole('button', { name: '7D' })
    disabled.click()
    assert.deepEqual(picked, [])
    assert.equal(screen.getByTestId('glyph').parentElement?.getAttribute('aria-hidden'), 'true')
  })
})
