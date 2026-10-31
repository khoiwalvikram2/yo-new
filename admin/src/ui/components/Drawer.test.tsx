import { useRef, useState } from 'react'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, test } from 'vitest'
import { Button } from './Button'
import { Drawer, type DrawerSize } from './Drawer'
import { Menu, MenuItem } from './Menu'
import { Popover } from './Popover'

function DrawerHarness({ size = 'md' }: { size?: DrawerSize }) {
  const [open, setOpen] = useState(true)
  return (
    <Drawer
      open={open}
      onOpenChange={setOpen}
      title="Deposit request"
      sub="Player and payment details"
      size={size}
      footer={<Button>Approve</Button>}
    >
      <p>UTR 88341011</p>
    </Drawer>
  )
}

describe('Drawer', () => {
  test('uses Dialog semantics with subtitle, body, footer and controlled close', async () => {
    render(<DrawerHarness />)
    const drawer = await screen.findByRole('dialog', { name: 'Deposit request' })
    assert.ok(screen.getByText('Player and payment details'))
    assert.ok(screen.getByText('UTR 88341011'))
    assert.ok(screen.getByRole('button', { name: 'Approve' }))
    assert.ok([...drawer.classList].some((name) => name.includes('_drawer_')))

    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))
  })

  test('is square on all four corners: the surface, head, body and foot opt out of the 5px radius policy', async () => {
    render(<DrawerHarness />)
    const drawer = await screen.findByRole('dialog', { name: 'Deposit request' })
    assert.equal(drawer.getAttribute('data-ui-radius'), 'square')
    // The overlay clips its content, and the drawer's right corners are its corners.
    assert.equal(drawer.parentElement?.getAttribute('data-ui-radius'), 'square')
    assert.deepEqual([...drawer.children].map((part) => [part.tagName, part.getAttribute('data-ui-radius')]),
      [['HEADER', 'square'], ['DIV', 'square'], ['FOOTER', 'square']])
  })

  test.each<DrawerSize>(['sm', 'md', 'lg'])('applies its %s edge width', async (size) => {
    render(<DrawerHarness size={size} />)
    const drawer = await screen.findByRole('dialog', { name: 'Deposit request' })
    assert.ok([...drawer.classList].some((name) => name.includes(`_${size}_`)))
  })

  test('keeps nested Popover and Menu interactions inside the modal stack', async () => {
    function NestedDrawerHarness() {
      const [open, setOpen] = useState(false)
      const triggerRef = useRef<HTMLButtonElement>(null)
      return (
        <div data-theme="light">
          <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
            Open nested request
          </button>
          <Drawer
            open={open}
            onOpenChange={setOpen}
            title="Nested request"
            themeFrom={triggerRef}
          >
            <Popover
              label="Drawer filters"
              trigger={<Button>Open filters</Button>}
            >
              <button type="button">Apply nested filter</button>
            </Popover>
            <Menu trigger={<Button>Open actions</Button>}>
              <MenuItem>Retry request</MenuItem>
            </Menu>
          </Drawer>
        </div>
      )
    }

    render(<NestedDrawerHarness />)
    const opener = screen.getByRole('button', { name: 'Open nested request' })
    opener.focus()
    fireEvent.click(opener)
    const drawer = await screen.findByRole('dialog', { name: 'Nested request' })
    await waitFor(() => assert.equal(document.body.style.overflow, 'hidden'))

    fireEvent.click(screen.getByRole('button', { name: 'Open filters' }))
    const popover = await screen.findByRole('dialog', { name: 'Drawer filters' })
    assert.equal(popover.dataset.theme, 'light')
    fireEvent.keyDown(screen.getByRole('button', { name: 'Apply nested filter' }), { key: 'Escape' })
    await waitFor(() => assert.equal(screen.queryByRole('dialog', { name: 'Drawer filters' }), null))
    assert.ok(screen.getByRole('dialog', { name: 'Nested request' }))

    fireEvent.click(screen.getByRole('button', { name: 'Open actions' }))
    const menu = await screen.findByRole('menu')
    assert.equal(menu.dataset.theme, 'light')
    fireEvent.keyDown(menu, { key: 'Escape' })
    await waitFor(() => assert.equal(screen.queryByRole('menu'), null))
    assert.ok(screen.getByRole('dialog', { name: 'Nested request' }))
    assert.equal(document.body.style.overflow, 'hidden')

    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
    await waitFor(() => assert.equal(screen.queryByRole('dialog', { name: 'Nested request' }), null))
    await waitFor(() => assert.equal(document.body.style.overflow, ''))
    await waitFor(() => assert.ok(document.activeElement === opener))
    assert.ok(!drawer.isConnected)
  })
})
