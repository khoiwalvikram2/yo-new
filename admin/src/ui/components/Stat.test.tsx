import { afterEach, describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { createRef } from 'react'
import { cleanup, render } from '@testing-library/react'
import { IconCoins } from '@tabler/icons-react'
import { Stat } from './Stat'
import styles from './Stat.module.css'

afterEach(cleanup)

describe('Stat', () => {
  test('renders label before value and hides the decorative glyph', () => {
    const { container } = render(
      <Stat label="Gross turnover" value="₹4,37,10,300.00" icon={<IconCoins aria-label="Coins" />} />,
    )
    const root = container.firstElementChild
    assert.ok(root)
    assert.equal(root.children[0]?.getAttribute('aria-hidden'), 'true')
    assert.equal(root.textContent, 'Gross turnover₹4,37,10,300.00')
    assert.equal(root.querySelector('[aria-label="Coins"]')?.closest('[aria-hidden="true"]'), root.children[0])
  })

  test('states every delta direction in visible text instead of relying on colour or the glyph', () => {
    const { container, rerender } = render(
      <Stat label="Deposits" value="₹12,500" delta={{ value: '4.2%', dir: 'up', note: 'vs previous period' }} />,
    )
    let delta = container.querySelector(`.${styles.delta}`)
    assert.equal(delta?.textContent, 'Up 4.2%vs previous period')
    assert.ok(delta?.classList.contains(styles.up))
    assert.equal(delta?.querySelector('svg')?.closest('[aria-hidden="true"]') !== null, true)

    rerender(<Stat label="Deposits" value="₹12,500" delta={{ value: '2.0%', dir: 'down' }} />)
    delta = container.querySelector(`.${styles.delta}`)
    assert.equal(delta?.textContent, 'Down 2.0%')
    assert.ok(delta?.classList.contains(styles.down))

    rerender(<Stat label="Deposits" value="₹12,500" delta={{ value: '0.0%', dir: 'flat' }} />)
    delta = container.querySelector(`.${styles.delta}`)
    assert.equal(delta?.textContent, 'No change 0.0%')
    assert.ok(delta?.classList.contains(styles.flat))
  })

  test('renders supporting copy without inventing a comparison delta', () => {
    const { container, rerender } = render(
      <Stat label="Active players" value="42" note="Session Active" />,
    )

    const delta = container.querySelector(`.${styles.delta}`)
    assert.equal(delta?.textContent, 'Session Active')
    assert.ok(delta?.querySelector(`.${styles.note}`))
    assert.equal(delta?.querySelector(`.${styles.movement}`), null)
    assert.equal(delta?.querySelector('svg'), null)

    rerender(
      <Stat
        label="Active players"
        value="42"
        note="Ignored fallback"
        delta={{ value: '1.0%', dir: 'up' }}
      />,
    )
    assert.equal(container.querySelector(`.${styles.delta}`)?.textContent, 'Up 1.0%')
  })

  test('adds compact metrics without changing the default size contract', () => {
    const { container, rerender } = render(
      <Stat label="Turnover" value="â‚¹4,37,10,300.00" icon={<IconCoins />} />,
    )
    assert.equal(container.firstElementChild?.classList.contains(styles.compact), false)

    rerender(
      <Stat
        label="Turnover"
        value="â‚¹4,37,10,300.00"
        icon={<IconCoins />}
        size="compact"
        delta={{ value: '4.2%', dir: 'up', note: 'vs previous period' }}
      />,
    )
    const root = container.firstElementChild
    assert.ok(root?.classList.contains(styles.compact))
    assert.ok(root?.classList.contains(styles.card))
    assert.equal(root?.textContent, 'Turnoverâ‚¹4,37,10,300.00Up 4.2%vs previous period')
  })

  test('supports every decorative hue without changing the content', () => {
    const { container, rerender } = render(<Stat label="Requests" value={42} icon={<IconCoins />} />)
    for (const hue of ['ind', 'red', 'grn', 'vio', 'blu', 'amb'] as const) {
      rerender(<Stat label="Requests" value={42} icon={<IconCoins />} hue={hue} />)
      assert.ok(container.querySelector('[aria-hidden="true"]')?.classList.contains(styles[hue]))
      assert.equal(container.textContent, 'Requests42')
    }
  })

  test('card and bare variants are one figure root and bare paints no outer Card', () => {
    const { container, rerender } = render(<Stat label="Pending" value={7} />)
    let root = container.firstElementChild
    assert.ok(root?.classList.contains(styles.card))
    assert.equal(container.children.length, 1)
    assert.equal(root?.querySelector('section'), null)

    rerender(<Stat label="Pending" value={7} variant="bare" />)
    root = container.firstElementChild
    assert.ok(root?.classList.contains(styles.bare))
    assert.equal(root?.classList.contains(styles.card), false)
    assert.equal(container.children.length, 1)
  })

  test('tooltip figures are keyboard focusable while ordinary figures are not', () => {
    const { container, rerender } = render(<Stat label="NGR" value="₹850" />)
    assert.equal(container.firstElementChild?.getAttribute('tabindex'), null)

    rerender(<Stat label="NGR" value="₹850" tooltip="After commission and bonuses" />)
    assert.equal(container.firstElementChild?.getAttribute('tabindex'), '0')

    rerender(<Stat label="NGR" value="₹850" tooltip="Details" tabIndex={-1} />)
    assert.equal(container.firstElementChild?.getAttribute('tabindex'), '-1')
  })

  test('loading keeps the label and glyph and holds the value and note lines with placeholders', () => {
    const { container, rerender } = render(
      <Stat label="Total Agents" value="61" note="58 active, 3 suspended" icon={<IconCoins />} tooltip="Details" loading />,
    )
    const root = container.firstElementChild
    assert.equal(root?.getAttribute('aria-busy'), 'true')
    assert.equal(root?.getAttribute('tabindex'), null)
    assert.equal(root?.querySelector(`.${styles.value}`)?.textContent, 'Loading')
    assert.ok(root?.querySelector(`.${styles.tile}`))
    assert.ok(root?.querySelector(`.${styles.value} [aria-hidden="true"]`))
    // the note is laid out (hidden by .pendingLine) so it reserves its own height under the placeholder
    const line = root?.querySelector(`.${styles.delta}`)
    assert.ok(line?.classList.contains(styles.pendingLine))
    assert.ok(line?.querySelector(`.${styles.lineSkeleton}[aria-hidden="true"]`))
    assert.equal(line?.querySelector(`.${styles.note}`)?.textContent, '58 active, 3 suspended')

    rerender(<Stat label="Total Agents" value="61" loading />)
    assert.equal(container.querySelector(`.${styles.delta}`), null)

    rerender(<Stat label="Total Agents" value="61" note="58 active, 3 suspended" />)
    assert.equal(container.firstElementChild?.getAttribute('aria-busy'), null)
    assert.equal(container.firstElementChild?.textContent, 'Total Agents6158 active, 3 suspended')
  })

  test('forwards its ref, class and div attributes', () => {
    const ref = createRef<HTMLDivElement>()
    const { container } = render(
      <Stat ref={ref} label="Pending" value={7} id="pending-stat" className="grid-cell" data-kind="queue" />,
    )
    assert.equal(ref.current, container.firstElementChild)
    assert.equal(ref.current?.id, 'pending-stat')
    assert.ok(ref.current?.classList.contains('grid-cell'))
    assert.equal(ref.current?.dataset.kind, 'queue')
  })
})
