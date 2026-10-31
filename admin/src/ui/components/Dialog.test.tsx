import { useRef, useState } from 'react'
import assert from 'node:assert/strict'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, test } from 'vitest'
import { Button } from './Button'
import { Dialog, type DialogSize } from './Dialog'

function DialogHarness({
  size = 'md',
  dismissible = true,
  role = 'dialog',
}: {
  size?: DialogSize
  dismissible?: boolean
  role?: 'dialog' | 'alertdialog'
}) {
  const [open, setOpen] = useState(true)
  const initialFocus = useRef<HTMLButtonElement>(null)
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Approve request"
      description="Review this decision before continuing."
      size={size}
      role={role}
      dismissible={dismissible}
      initialFocus={initialFocus}
      footer={<Button ref={initialFocus}>Continue</Button>}
    >
      <p>Request #DEP-201</p>
    </Dialog>
  )
}

describe('Dialog', () => {
  test('wires its title and description, footer, initial focus and close control', async () => {
    render(<DialogHarness />)
    const dialog = await screen.findByRole('dialog', { name: 'Approve request' })

    assert.ok(dialog.getAttribute('aria-labelledby'))
    assert.ok(dialog.getAttribute('aria-describedby'))
    assert.equal(screen.getByText('Review this decision before continuing.').tagName, 'P')
    assert.ok(screen.getByText('Request #DEP-201'))
    await waitFor(() => assert.ok(document.activeElement === screen.getByRole('button', { name: 'Continue' })))

    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }))
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null))
  })

  test('keeps the rounded card: only a drawer is square', async () => {
    render(<DialogHarness />)
    const dialog = await screen.findByRole('dialog', { name: 'Approve request' })
    assert.equal(dialog.getAttribute('data-ui-radius'), null)
    assert.equal(dialog.parentElement?.getAttribute('data-ui-radius'), null)
    assert.deepEqual([...dialog.children].map((part) => part.getAttribute('data-ui-radius')), ['panel-head', null, null])
  })

  test.each<DialogSize>(['sm', 'md', 'lg', 'xl'])('applies the %s size contract', async (size) => {
    render(<DialogHarness size={size} />)
    const dialog = await screen.findByRole('dialog', { name: 'Approve request' })
    assert.ok([...dialog.classList].some((name) => name.includes(`_${size}_`)))
  })

  test('supports alertdialog and removes every dismiss affordance when non-dismissible', async () => {
    render(<DialogHarness role="alertdialog" dismissible={false} />)
    const dialog = await screen.findByRole('alertdialog', { name: 'Approve request' })
    assert.equal(screen.queryByRole('button', { name: 'Close dialog' }), null)

    fireEvent.keyDown(dialog, { key: 'Escape' })
    fireEvent.pointerDown(dialog.parentElement as HTMLElement)
    assert.ok(screen.getByRole('alertdialog', { name: 'Approve request' }))
  })
})
