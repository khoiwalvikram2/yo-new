import assert from 'node:assert/strict'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, test } from 'vitest'
import { ConfirmHost } from './ConfirmHost'
import { confirm, confirmQueue } from './confirm'

beforeEach(() => {
  let request = confirmQueue.current()
  while (request) {
    confirmQueue.settle(request.id, false)
    request = confirmQueue.current()
  }
})

describe('ConfirmHost chains', () => {
  test('returns final focus to the page origin after a queued chain', async () => {
    render(<><button type="button">Queue confirmations</button><ConfirmHost /></>)
    const origin = screen.getByRole('button', { name: 'Queue confirmations' })
    origin.focus()
    let first!: Promise<boolean>
    let second!: Promise<boolean>
    act(() => {
      first = confirm({ title: 'First focus request' })
      second = confirm({ title: 'Second focus request' })
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }))
    assert.equal(await first, true)
    assert.ok(await screen.findByRole('alertdialog', { name: 'Second focus request' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    assert.equal(await second, false)
    await waitFor(() => assert.ok(document.activeElement === origin))
  })

  test('supports an awaited nested confirmation without deadlocking its parent', async () => {
    render(<ConfirmHost />)
    let nestedResult: boolean | undefined
    let outer!: Promise<boolean>
    act(() => {
      outer = confirm({
        title: 'Outer action',
        onConfirm: async () => {
          nestedResult = await confirm({ title: 'Nested decision' })
        },
      })
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }))
    assert.ok(await screen.findByRole('alertdialog', { name: 'Nested decision' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
      await outer
    })

    assert.equal(await outer, true)
    assert.equal(nestedResult, true)
    assert.equal(document.querySelector('[role="alertdialog"]'), null)
  })
})
