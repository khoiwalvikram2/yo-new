import { describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { ConfirmDialog, type ConfirmDialogProps } from './ConfirmDialog'

function Harness(props: Omit<ConfirmDialogProps, 'open' | 'onOpenChange'>) {
  const [open, setOpen] = useState(true)
  return <ConfirmDialog {...props} open={open} onOpenChange={setOpen} />
}

describe('ConfirmDialog', () => {
  test('uses an alertdialog and puts initial focus on Cancel for danger', async () => {
    render(
      <Harness
        title="Delete API key?"
        description="Requests using this key will stop."
        tone="danger"
        confirmLabel="Delete"
        onConfirm={() => {}}
      />,
    )

    assert.ok(await screen.findByRole('alertdialog', { name: 'Delete API key?' }))
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    await waitFor(() => assert.ok(document.activeElement === cancel))
  })

  test('stays open and exposes a rejected async confirmation as an error', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('The provider rejected this action.'))
    render(
      <Harness
        title="Reject request?"
        description="The merchant will be notified."
        tone="danger"
        confirmLabel="Reject"
        onConfirm={onConfirm}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }))

    const error = await screen.findByRole('alert')
    assert.ok(error.textContent?.includes('The provider rejected this action.'))
    assert.ok(screen.getByRole('alertdialog', { name: 'Reject request?' }))
    assert.equal(onConfirm.mock.calls.length, 1)
  })

  test('closes after a successful confirmation', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    render(<Harness title="Approve request?" confirmLabel="Approve" onConfirm={onConfirm} />)

    const approve = await screen.findByRole('button', { name: 'Approve' })
    await act(async () => {
      fireEvent.click(approve)
      await onConfirm.mock.results[0]?.value
    })

    assert.equal(document.querySelector('[role="alertdialog"]'), null)
    assert.equal(onConfirm.mock.calls.length, 1)
  })

  test('Cancel closes without invoking the confirmation', async () => {
    const onConfirm = vi.fn()
    render(<Harness title="Continue?" onConfirm={onConfirm} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

    await waitFor(() => assert.equal(screen.queryByRole('alertdialog'), null))
    assert.equal(onConfirm.mock.calls.length, 0)
  })
})
