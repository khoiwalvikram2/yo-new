/**
 * Button is the kit's native text button, and it is also a floating-layer trigger. Four behaviours matter:
 * - It must default to type="button". The native default is "submit", and unmigrated pages sit inside antd
 *   Forms, so a plain kit Button would submit them.
 * - A loading or aria-disabled button must swallow the click. It must not set native `disabled`: that drops
 *   focus to <body> and stops a Tooltip from opening on a button that looks disabled.
 * - The leading icon is decoration. The accessible name is the label alone.
 * - Tooltip, Popover and Menu inject a ref and aria/on* props into their trigger. If Button did not forward
 *   the ref and spread the rest, the layer would never position, with no type error to warn anyone.
 */
import { test, describe, vi } from 'vitest'
import assert from 'node:assert/strict'
import { render, screen, fireEvent } from '@testing-library/react'
import { createRef, type FormEvent } from 'react'
import { Button } from './Button'
import { buttonClassName } from './buttonClassName'
import styles from './Button.module.css'

describe('Button', () => {
  test('defaults to type="button"', () => {
    render(<Button>Save</Button>)

    const button = screen.getByRole('button', { name: 'Save' })
    assert.equal(button.getAttribute('type'), 'button')
    assert.equal(button.getAttribute('aria-busy'), null)
    assert.equal(button.getAttribute('aria-disabled'), null)
  })

  test('keeps an explicit type', () => {
    render(<Button type="submit">Send</Button>)

    assert.equal(screen.getByRole('button', { name: 'Send' }).getAttribute('type'), 'submit')
  })

  test('calls onClick when enabled', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Save</Button>)

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    assert.equal(onClick.mock.calls.length, 1)
  })

  test('loading sets aria-busy and aria-disabled, keeps the label, and swallows the click', () => {
    const onClick = vi.fn()
    render(
      <Button variant="primary" loading onClick={onClick}>
        Save
      </Button>,
    )

    const button = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
    assert.equal(button.getAttribute('aria-busy'), 'true')
    assert.equal(button.getAttribute('aria-disabled'), 'true')
    assert.equal(button.disabled, false)
    assert.equal(screen.queryByRole('img'), null)

    fireEvent.click(button)

    assert.equal(onClick.mock.calls.length, 0)
  })

  test('loading blocks form submission', () => {
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit" loading>
          Send
        </Button>
      </form>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    assert.equal(onSubmit.mock.calls.length, 0)
  })

  test('aria-disabled swallows the click without marking the button busy', () => {
    const onClick = vi.fn()
    render(
      <Button aria-disabled="true" onClick={onClick}>
        Save view
      </Button>,
    )

    const button = screen.getByRole('button', { name: 'Save view' }) as HTMLButtonElement
    assert.equal(button.getAttribute('aria-disabled'), 'true')
    assert.equal(button.getAttribute('aria-busy'), null)
    assert.equal(button.disabled, false)

    fireEvent.click(button)

    assert.equal(onClick.mock.calls.length, 0)
  })

  test('renders the leading icon hidden from assistive tech, and loading replaces it', () => {
    const { rerender } = render(<Button icon={<span data-testid="glyph">*</span>}>Export</Button>)

    screen.getByRole('button', { name: 'Export' })
    const glyph = screen.getByTestId('glyph')
    assert.notEqual(glyph.closest('[aria-hidden="true"]'), null)

    rerender(
      <Button icon={<span data-testid="glyph">*</span>} loading>
        Export
      </Button>,
    )

    assert.equal(screen.queryByTestId('glyph'), null)
    screen.getByRole('button', { name: 'Export' })
  })

  test('forwards its ref and spreads other props onto the native button', () => {
    const ref = createRef<HTMLButtonElement>()
    render(
      <Button ref={ref} aria-haspopup="menu" aria-expanded={false} data-state="closed">
        Options
      </Button>,
    )

    const button = screen.getByRole('button', { name: 'Options' })
    assert.equal(ref.current, button)
    assert.equal(button.tagName, 'BUTTON')
    assert.equal(button.getAttribute('aria-haspopup'), 'menu')
    assert.equal(button.getAttribute('aria-expanded'), 'false')
    assert.equal(button.getAttribute('data-state'), 'closed')
  })

  /* Page migration (C) W0: the looks and sizes the pages need beyond the shell's three. */
  test("carries each new variant and size as a class", () => {
    const { rerender } = render(<Button variant="pill" size="lg">Period</Button>)
    let button = screen.getByRole('button', { name: 'Period' })
    assert.ok(button.classList.contains(styles.pill))
    assert.ok(button.classList.contains(styles.lg))

    rerender(<Button variant="link" size="xs">View all</Button>)
    button = screen.getByRole('button', { name: 'View all' })
    assert.ok(button.classList.contains(styles.link))
    assert.ok(button.classList.contains(styles.xs))

    rerender(<Button variant="dangerSolid" block>Delete</Button>)
    button = screen.getByRole('button', { name: 'Delete' })
    assert.ok(button.classList.contains(styles.dangerSolid))
    assert.ok(button.classList.contains(styles.block))
  })

  test("a danger button still swallows clicks while it is aria-disabled", () => {
    let clicks = 0
    render(<Button variant="danger" aria-disabled onClick={() => { clicks += 1 }}>Void bet</Button>)
    screen.getByRole('button', { name: 'Void bet' }).click()
    assert.equal(clicks, 0)
  })

  test("buttonClassName gives a link the same classes as the button", () => {
    render(<Button variant="secondary" size="sm">Go to home</Button>)
    const button = screen.getByRole('button', { name: 'Go to home' })
    const linkClasses = buttonClassName({ variant: 'secondary', size: 'sm' })
    assert.deepEqual(linkClasses.split(' ').sort(), [...button.classList].sort())
  })
})
