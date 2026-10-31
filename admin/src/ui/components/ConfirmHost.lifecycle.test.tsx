import { StrictMode } from 'react'
import assert from 'node:assert/strict'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, test, vi } from 'vitest'
import { ConfirmHost } from './ConfirmHost'
import { confirm, confirmQueue } from './confirm'

beforeEach(() => {
  let request = confirmQueue.current()
  while (request) {
    confirmQueue.settle(request.id, false)
    request = confirmQueue.current()
  }
})

describe('ConfirmHost lifecycle', () => {
  test('elects one owner when more than one host is mounted and runs the action once', async () => {
    const onConfirm = vi.fn()
    render(<><ConfirmHost /><ConfirmHost /></>)
    let result!: Promise<boolean>
    act(() => { result = confirm({ title: 'Singleton request', onConfirm }) })

    assert.equal((await screen.findAllByRole('alertdialog', { name: 'Singleton request' })).length, 1)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    assert.equal(await result, true)
    assert.equal(onConfirm.mock.calls.length, 1)
  })

  test('keeps an in-flight result authoritative across host unmount and remount', async () => {
    let finish!: () => void
    const action = new Promise<void>((resolve) => { finish = resolve })
    const firstHost = render(<ConfirmHost />)
    let settled = false
    let result!: Promise<boolean>
    act(() => {
      result = confirm({ title: 'Long action', onConfirm: () => action })
      void result.then(() => { settled = true })
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }))
    await waitFor(() => assert.equal(screen.getByRole('button', { name: 'Confirm' }).getAttribute('aria-busy'), 'true'))

    firstHost.unmount()
    await act(async () => Promise.resolve())
    assert.equal(settled, false)

    const secondHost = render(<ConfirmHost />)
    assert.ok(await screen.findByRole('alertdialog', { name: 'Long action' }))
    assert.equal(screen.getByRole('button', { name: 'Confirm' }).getAttribute('aria-busy'), 'true')

    await act(async () => finish())
    assert.equal(await result, true)
    secondHost.unmount()
  })

  test('retains a visible rejection when ownership moves to a replacement host', async () => {
    const firstHost = render(<ConfirmHost />)
    let result!: Promise<boolean>
    act(() => {
      result = confirm({
        title: 'Retryable action',
        onConfirm: () => Promise.reject(new Error('Provider refused the request.')),
      })
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }))
    assert.ok(await screen.findByText('Provider refused the request.'))

    firstHost.unmount()
    render(<ConfirmHost />)
    assert.ok(await screen.findByRole('alertdialog', { name: 'Retryable action' }))
    assert.ok(screen.getByText('Provider refused the request.'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    assert.equal(await result, false)
  })

  test('survives React StrictMode and resolves a request raised after permanent teardown', async () => {
    const view = render(<StrictMode><ConfirmHost /></StrictMode>)
    let normal!: Promise<boolean>
    act(() => { normal = confirm({ title: 'Strict request' }) })
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    assert.equal(await normal, false)

    view.unmount()
    await act(async () => Promise.resolve())
    let late!: Promise<boolean>
    act(() => { late = confirm({ title: 'Late orphan' }) })
    assert.equal(await late, false)
  })
})
