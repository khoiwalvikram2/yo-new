import { afterEach, describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, render, screen } from '@testing-library/react'
import { StatusPill, toneForStatus, type StatusPillTone } from './StatusPill'
import styles from './StatusPill.module.css'

afterEach(cleanup)

const STATUS_FAMILIES: ReadonlyArray<readonly [StatusPillTone, readonly string[]]> = [
  ['warn', ['pending']],
  [
    'ok',
    [
      'approved',
      'completed',
      'active',
      'live',
      'enabled',
      'settled',
      'ready',
      'visible',
      'matched',
      'verified',
      'paid',
    ],
  ],
  ['neg', ['rejected', 'failed', 'suspended', 'blocked']],
  ['info', ['processing', 'open', 'inplay', 'scheduled', 'test']],
  ['muted', ['cancelled', 'disabled', 'paused', 'ended', 'expired', 'draft', 'hidden', 'unmatched']],
]

describe('toneForStatus', () => {
  test.each(STATUS_FAMILIES)('maps the complete %s family', (tone, statuses) => {
    for (const status of statuses) assert.equal(toneForStatus(status), tone, status)
  })

  test('normalises API casing and separators', () => {
    assert.equal(toneForStatus('  APPROVED  '), 'ok')
    assert.equal(toneForStatus('IN_PLAY'), 'info')
    assert.equal(toneForStatus('in-play'), 'info')
  })

  test('keeps unknown and blank statuses neutral', () => {
    assert.equal(toneForStatus('awaiting-review'), 'neutral')
    assert.equal(toneForStatus(''), 'neutral')
  })
})

describe('StatusPill', () => {
  test.each(STATUS_FAMILIES)('applies the derived %s tone class', (tone, statuses) => {
    const label = statuses[0]
    render(<StatusPill status={label}>{label}</StatusPill>)
    assert.ok(screen.getByText(label).closest('span')?.parentElement?.classList.contains(styles[tone]))
  })

  test('uses the neutral tone when neither status nor tone is supplied', () => {
    render(<StatusPill>Unknown</StatusPill>)
    assert.ok(screen.getByText('Unknown').parentElement?.classList.contains(styles.neutral))
  })

  test('lets an explicit tone override the status-derived tone', () => {
    render(
      <StatusPill status="failed" tone="info">
        Retry queued
      </StatusPill>,
    )
    const pill = screen.getByText('Retry queued').parentElement
    assert.ok(pill?.classList.contains(styles.info))
    assert.equal(pill?.classList.contains(styles.neg), false)
  })

  test('keeps the status in visible text and hides its decorative icon', () => {
    const { container } = render(
      <StatusPill status="approved" icon={<svg data-testid="glyph" />}>
        Approved
      </StatusPill>,
    )

    assert.ok(screen.getByText('Approved'))
    const icon = container.querySelector(`.${styles.icon}`)
    assert.equal(icon?.getAttribute('aria-hidden'), 'true')
    assert.ok(icon?.querySelector('[data-testid="glyph"]'))
  })

  test('forwards span attributes and a caller class', () => {
    render(
      <StatusPill status="pending" className="queue-status" data-testid="status-pill">
        Pending
      </StatusPill>,
    )
    const pill = screen.getByTestId('status-pill')
    assert.equal(pill.tagName, 'SPAN')
    assert.ok(pill.classList.contains(styles.pill))
    assert.ok(pill.classList.contains('queue-status'))
  })
})
