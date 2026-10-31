import { beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ConfirmHost } from './ConfirmHost'
import { confirm, confirmQueue } from './confirm'

beforeEach(() => {
  let request = confirmQueue.current()
  while (request) {
    confirmQueue.settle(request.id, false)
    request = confirmQueue.current()
  }
})

describe('ConfirmHost', () => {
  test('resolves true after confirmation and false after cancellation', async () => {
    render(<ConfirmHost />)

    let confirmed!: Promise<boolean>
    act(() => {
      confirmed = confirm({ title: 'Publish changes?', description: 'Customers will see them.' })
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }))
    assert.equal(await confirmed, true)

    let cancelled!: Promise<boolean>
    act(() => {
      cancelled = confirm({ title: 'Leave this page?' })
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    assert.equal(await cancelled, false)
  })

  test('shows concurrent requests in FIFO order', async () => {
    render(<ConfirmHost />)

    let first!: Promise<boolean>
    let second!: Promise<boolean>
    act(() => {
      first = confirm({ title: 'First request' })
      second = confirm({ title: 'Second request' })
    })

    assert.ok(await screen.findByRole('alertdialog', { name: 'First request' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    assert.equal(await first, true)

    assert.ok(await screen.findByRole('alertdialog', { name: 'Second request' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    assert.equal(await second, false)
  })

  test('does not settle a request when its async action rejects, and allows a retry', async () => {
    const onConfirm = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('Approval is no longer valid.'))
      .mockResolvedValueOnce(undefined)
    render(<ConfirmHost />)

    let result!: Promise<boolean>
    act(() => {
      result = confirm({ title: 'Approve?', confirmLabel: 'Approve', onConfirm })
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    assert.ok(await screen.findByText('Approval is no longer valid.'))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
      await result
    })
    assert.equal(await result, true)
    assert.equal(document.querySelector('[role="alertdialog"]'), null)
  })

  test('settles all queued promises false if the host is permanently unmounted', async () => {
    const view = render(<ConfirmHost />)
    let first!: Promise<boolean>
    let second!: Promise<boolean>
    act(() => {
      first = confirm({ title: 'First abandoned request' })
      second = confirm({ title: 'Second abandoned request' })
    })

    view.unmount()

    assert.equal(await first, false)
    assert.equal(await second, false)
  })

})
