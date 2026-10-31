/**
 * NavDrawer wires useNavDrawer's floating-ui context into markup. `role`
 * "dialog" is set on the drawer element whenever the viewport is in drawer
 * mode — it does not depend on open/closed, only the CSS class does that —
 * and each of the two ways of dismissing the drawer (Esc, scrim click) must
 * flip the burger back to aria-expanded="false".
 */
import { describe, test } from 'vitest'
import assert from 'node:assert/strict'
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { NavDrawer } from './NavDrawer'
import { useNavDrawer } from './useNavDrawer'
import styles from './NavDrawer.module.css'

function Harness({ isDrawer }: { isDrawer: boolean }) {
  const [navigationKey] = useState('nav-1')
  const drawer = useNavDrawer({ isDrawer, navigationKey })
  return (
    <div>
      <button ref={drawer.burgerRef} {...drawer.getBurgerProps()}>
        Menu
      </button>
      <NavDrawer drawer={drawer}>
        <button>Panel row</button>
      </NavDrawer>
    </div>
  )
}

describe('NavDrawer', () => {
  test('role="dialog" is set on the drawer only in drawer mode', () => {
    const wide = render(<Harness isDrawer={false} />)
    assert.equal(wide.container.querySelector('[role="dialog"]'), null)
    wide.unmount()

    const narrow = render(<Harness isDrawer />)
    assert.ok(narrow.container.querySelector('[role="dialog"]'))
  })

  test('Esc on the drawer closes it and returns the burger to aria-expanded="false"', () => {
    const { container } = render(<Harness isDrawer />)
    const burger = screen.getByRole('button', { name: 'Menu' })

    fireEvent.click(burger)
    assert.equal(burger.getAttribute('aria-expanded'), 'true')

    const dialog = container.querySelector('[role="dialog"]')
    assert.ok(dialog)
    fireEvent.keyDown(dialog as Element, { key: 'Escape' })

    assert.equal(burger.getAttribute('aria-expanded'), 'false')
  })

  test('a scrim click closes the drawer', () => {
    const { container } = render(<Harness isDrawer />)
    const burger = screen.getByRole('button', { name: 'Menu' })

    fireEvent.click(burger)
    assert.equal(burger.getAttribute('aria-expanded'), 'true')

    const scrim = container.getElementsByClassName(styles.scrim)[0]
    assert.ok(scrim, 'expected a scrim element while the drawer is open')
    fireEvent.click(scrim)

    assert.equal(burger.getAttribute('aria-expanded'), 'false')
  })
})
