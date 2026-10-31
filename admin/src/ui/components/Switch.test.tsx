/**
 * Switch replaces the antd Switch in the Super Admin mode switcher (T46). Screen readers only know it is a
 * toggle, and whether it is on, through role="switch" and aria-checked, so those must be right. It is
 * controlled: a click asks the caller for the next state and never flips itself, or the pill beside it and
 * the store behind it would disagree. It can sit under a tooltip, so aria-disabled must block the toggle
 * while the button stays focusable, and its ref must reach the <button> for floating-ui.
 */
import { test, describe } from 'vitest'
import assert from 'node:assert/strict'
import { createRef } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { Switch } from './Switch'
import styles from './Switch.module.css'

function recordCalls(): { calls: boolean[]; onChange: (checked: boolean) => void } {
  const calls: boolean[] = []
  return {
    calls,
    onChange: (checked: boolean) => {
      calls.push(checked)
    },
  }
}

describe('Switch', () => {
  test('is a switch button named by its visible label, with aria-checked false when off', () => {
    const { onChange } = recordCalls()
    render(<Switch checked={false} onChange={onChange} label="Whitelabel mode" />)
    const toggle = screen.getByRole('switch', { name: 'Whitelabel mode' })
    assert.equal(toggle.tagName, 'BUTTON')
    assert.equal(toggle.getAttribute('type'), 'button')
    assert.equal(toggle.getAttribute('aria-checked'), 'false')
    assert.equal(toggle.getAttribute('aria-label'), null)
    assert.equal(toggle.textContent, 'Whitelabel mode')
  })

  test('reports aria-checked true when on', () => {
    const { onChange } = recordCalls()
    render(<Switch checked onChange={onChange} label="Whitelabel mode" />)
    assert.equal(screen.getByRole('switch', { name: 'Whitelabel mode' }).getAttribute('aria-checked'), 'true')
  })

  test('a click asks for the next state and leaves the checked state to the caller', () => {
    const { calls, onChange } = recordCalls()
    const { rerender } = render(<Switch checked={false} onChange={onChange} label="Whitelabel mode" />)
    const toggle = screen.getByRole('switch', { name: 'Whitelabel mode' })

    fireEvent.click(toggle)
    assert.deepEqual(calls, [true])
    assert.equal(toggle.getAttribute('aria-checked'), 'false')

    rerender(<Switch checked onChange={onChange} label="Whitelabel mode" />)
    assert.equal(toggle.getAttribute('aria-checked'), 'true')

    fireEvent.click(toggle)
    assert.deepEqual(calls, [true, false])
  })

  test('hideLabel names the switch with aria-label and renders no visible text', () => {
    const { onChange } = recordCalls()
    render(<Switch checked={false} onChange={onChange} label="Whitelabel mode" hideLabel />)
    const toggle = screen.getByRole('switch', { name: 'Whitelabel mode' })
    assert.equal(toggle.getAttribute('aria-label'), 'Whitelabel mode')
    assert.equal(toggle.textContent, '')
  })

  test('aria-disabled swallows the toggle, keeps the button focusable and still runs the caller onClick', () => {
    const { calls, onChange } = recordCalls()
    let clicks = 0
    render(
      <Switch
        checked={false}
        onChange={onChange}
        label="Whitelabel mode"
        aria-disabled="true"
        onClick={() => {
          clicks += 1
        }}
      />,
    )
    const toggle = screen.getByRole('switch', { name: 'Whitelabel mode' })
    assert.equal(toggle.getAttribute('aria-disabled'), 'true')
    assert.equal(toggle.hasAttribute('disabled'), false)

    fireEvent.click(toggle)
    assert.equal(clicks, 1)
    assert.deepEqual(calls, [])
  })

  test('a caller onClick that calls preventDefault cancels the toggle', () => {
    const { calls, onChange } = recordCalls()
    render(
      <Switch
        checked={false}
        onChange={onChange}
        label="Whitelabel mode"
        onClick={(event) => {
          event.preventDefault()
        }}
      />,
    )
    fireEvent.click(screen.getByRole('switch', { name: 'Whitelabel mode' }))
    assert.deepEqual(calls, [])
  })

  test('a natively disabled switch does not call onChange', () => {
    const { calls, onChange } = recordCalls()
    render(<Switch checked={false} onChange={onChange} label="Whitelabel mode" disabled />)
    fireEvent.click(screen.getByRole('switch', { name: 'Whitelabel mode' }))
    assert.deepEqual(calls, [])
  })

  test('forwards its ref to the button and passes other attributes through', () => {
    const { onChange } = recordCalls()
    const ref = createRef<HTMLButtonElement>()
    render(
      <Switch
        ref={ref}
        checked={false}
        onChange={onChange}
        label="Whitelabel mode"
        className="extra"
        id="mode-switch"
        title="Switch director mode"
      />,
    )
    const toggle = screen.getByRole('switch', { name: 'Whitelabel mode' })
    assert.equal(ref.current, toggle)
    assert.ok(toggle.classList.contains('extra'))
    assert.equal(toggle.id, 'mode-switch')
    assert.equal(toggle.getAttribute('title'), 'Switch director mode')
  })

  test('adds the approved small geometry without changing switch semantics', () => {
    const { calls, onChange } = recordCalls()
    render(<Switch checked={false} onChange={onChange} label="Compact mode" size="sm" />)
    const toggle = screen.getByRole('switch', { name: 'Compact mode' })
    assert.ok(toggle.classList.contains(styles.sm))
    assert.equal(toggle.getAttribute('aria-checked'), 'false')
    fireEvent.click(toggle)
    assert.deepEqual(calls, [true])
  })

  test('adds danger tone as a visual checked-state variant only', () => {
    const { onChange } = recordCalls()
    const { rerender } = render(<Switch checked onChange={onChange} label="Delete on expiry" tone="danger" />)
    const toggle = screen.getByRole('switch', { name: 'Delete on expiry' })
    assert.ok(toggle.classList.contains(styles.danger))
    assert.equal(toggle.getAttribute('aria-checked'), 'true')

    rerender(<Switch checked={false} onChange={onChange} label="Delete on expiry" />)
    assert.equal(toggle.classList.contains(styles.danger), false)
  })
})
