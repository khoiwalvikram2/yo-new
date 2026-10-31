import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CopyButton } from './CopyButton'

const writeText = vi.fn<(value: string) => Promise<void>>()

beforeEach(() => {
  writeText.mockReset()
  writeText.mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('CopyButton', () => {
  test('copies the exact value and politely announces success', async () => {
    const onCopied = vi.fn()
    render(
      <CopyButton
        value={'  {\n  "token": "a&b"\n}\n'}
        label="Copy request payload"
        onCopied={onCopied}
      />,
    )
    const button = screen.getByRole('button', { name: 'Copy request payload' })
    fireEvent.click(button)

    await waitFor(() => assert.equal(writeText.mock.calls.length, 1))
    assert.equal(writeText.mock.calls[0]?.[0], '  {\n  "token": "a&b"\n}\n')
    await waitFor(() => assert.equal(screen.getByRole('status').textContent, 'Copied'))
    assert.equal(screen.queryByRole('tooltip'), null)
    assert.equal(onCopied.mock.calls.length, 1)
    assert.equal(button.getAttribute('aria-label'), 'Copy request payload')
  })

  test('announces a rejected copy and reports the original error', async () => {
    const failure = new Error('Clipboard permission denied')
    const onCopyError = vi.fn()
    writeText.mockRejectedValueOnce(failure)
    render(<CopyButton value="secret" onCopyError={onCopyError} />)
    const button = screen.getByRole('button', { name: 'Copy to clipboard' })
    fireEvent.focus(button)
    await waitFor(() => assert.ok(screen.getByRole('tooltip')))

    fireEvent.click(button)

    await waitFor(() => assert.equal(screen.getByRole('status').textContent, 'Copy failed'))
    assert.equal(onCopyError.mock.calls[0]?.[0], failure)
  })

  test('normalises a missing API and a synchronous write failure through the error path', async () => {
    const onCopyError = vi.fn()
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    const view = render(<CopyButton value="secret" onCopyError={onCopyError} />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy to clipboard' }))
    await waitFor(() => assert.equal(screen.getByRole('status').textContent, 'Copy failed'))
    assert.match(String(onCopyError.mock.calls[0]?.[0]), /unavailable/i)

    const failure = new Error('Synchronous clipboard failure')
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => { throw failure } },
    })
    view.rerender(<CopyButton value="secret" onCopyError={onCopyError} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy to clipboard' }))
    await waitFor(() => assert.equal(onCopyError.mock.calls.length, 2))
    assert.equal(onCopyError.mock.calls[1]?.[0], failure)
  })

  test('ignores an older operation that resolves after a newer copy', async () => {
    let resolveFirst!: () => void
    let resolveSecond!: () => void
    const first = new Promise<void>((resolve) => { resolveFirst = resolve })
    const second = new Promise<void>((resolve) => { resolveSecond = resolve })
    writeText.mockReset()
    writeText.mockReturnValueOnce(first).mockReturnValueOnce(second)
    const onCopied = vi.fn()
    const view = render(<CopyButton value="first" onCopied={onCopied} />)
    const button = screen.getByRole('button', { name: 'Copy to clipboard' })

    fireEvent.click(button)
    view.rerender(<CopyButton value="second" onCopied={onCopied} />)
    fireEvent.click(button)
    await act(async () => resolveSecond())
    await waitFor(() => assert.equal(onCopied.mock.calls.length, 1))
    await act(async () => resolveFirst())

    assert.deepEqual(writeText.mock.calls.map((call) => call[0]), ['first', 'second'])
    assert.equal(onCopied.mock.calls.length, 1)
    assert.equal(screen.getByRole('status').textContent, 'Copied')
  })

  test('ignores a pending operation after unmount', async () => {
    let resolveCopy!: () => void
    writeText.mockReturnValueOnce(new Promise<void>((resolve) => { resolveCopy = resolve }))
    const onCopied = vi.fn()
    const view = render(<CopyButton value="late" onCopied={onCopied} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy to clipboard' }))

    view.unmount()
    await act(async () => resolveCopy())
    assert.equal(onCopied.mock.calls.length, 0)
  })

  test('honours native disabled behaviour', () => {
    render(<CopyButton value="not copied" disabled />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy to clipboard' }))
    assert.equal(writeText.mock.calls.length, 0)
  })
})
