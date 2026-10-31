/**
 * The Toaster is the only thing that renders feedback now, so what matters is that a failure is
 * announced assertively while the rest are polite, that a toast leaves on its own, that an action
 * dismisses the toast it belongs to, and that hovering the stack does not let a toast disappear from
 * under the pointer.
 */
import { test, describe, beforeEach, afterEach, vi } from 'vitest'
import assert from 'node:assert/strict'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Toaster } from './Toaster'
import { toast, TOAST_DURATION_MS } from './toast'

beforeEach(() => {
  toast.clear()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
  toast.clear()
})

const raise = (options: Parameters<typeof toast>[0]) => {
  act(() => {
    toast(options)
  })
}

describe('Toaster', () => {
  test('mounts both live regions before anything is raised', () => {
    render(<Toaster />)
    assert.ok(screen.getByRole('status', { name: 'Notifications' }))
    assert.ok(screen.getByRole('alert', { name: 'Errors' }))
  })

  test('puts a failure in the assertive region and everything else in the polite one', () => {
    render(<Toaster />)
    raise({ message: 'Saved', tone: 'ok' })
    raise({ message: 'Could not save', tone: 'error' })

    const polite = screen.getByRole('status', { name: 'Notifications' })
    const assertive = screen.getByRole('alert', { name: 'Errors' })
    assert.ok(polite.textContent?.includes('Saved'))
    assert.equal(polite.textContent?.includes('Could not save'), false)
    assert.ok(assertive.textContent?.includes('Could not save'))
  })

  test('drops a toast when its time is up', () => {
    render(<Toaster />)
    raise({ message: 'Saved' })
    assert.ok(screen.getByText('Saved'))

    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS + 10)
    })
    assert.equal(screen.queryByText('Saved'), null)
  })

  test('keeps a toast while the pointer is in the stack, then lets it go', () => {
    const { container } = render(<Toaster />)
    raise({ message: 'Deleted' })
    const host = container.firstElementChild as HTMLElement

    fireEvent.mouseEnter(host)
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS * 2)
    })
    assert.ok(screen.getByText('Deleted'), 'a hovered toast must not vanish under the pointer')

    fireEvent.mouseLeave(host)
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS + 10)
    })
    assert.equal(screen.queryByText('Deleted'), null)
  })

  test('an action runs and dismisses its own toast', () => {
    render(<Toaster />)
    let undone = 0
    raise({ message: 'Bet voided', action: { label: 'Undo', onClick: () => { undone += 1 } } })

    act(() => {
      screen.getByRole('button', { name: 'Undo' }).click()
    })
    assert.equal(undone, 1)
    assert.equal(screen.queryByText('Bet voided'), null)
  })

  test('every toast has a named dismiss button that removes that toast alone', () => {
    render(<Toaster />)
    raise({ message: 'Saved', tone: 'ok' })
    raise({ message: 'Could not save', tone: 'error' })
    raise({ message: 'Exporting', busy: true })

    const buttons = screen.getAllByRole('button', { name: 'Dismiss notification' })
    assert.equal(buttons.length, 3)

    const failure = screen.getByText('Could not save').closest('li') as HTMLElement
    act(() => {
      (failure.querySelector('button') as HTMLButtonElement).click()
    })
    assert.equal(screen.queryByText('Could not save'), null)
    assert.ok(screen.getByText('Saved'))
    // a busy toast never times out, so the button is its only way out from the UI
    const busy = screen.getByText('Exporting').closest('li') as HTMLElement
    act(() => {
      (busy.querySelector('button') as HTMLButtonElement).click()
    })
    assert.equal(screen.queryByText('Exporting'), null)
    assert.equal(screen.getAllByRole('button', { name: 'Dismiss notification' }).length, 1)
  })

  test('the dismiss button sits after the action and does not run it', () => {
    render(<Toaster />)
    let undone = 0
    raise({ message: 'Bet voided', action: { label: 'Undo', onClick: () => { undone += 1 } } })

    const item = screen.getByText('Bet voided').closest('li') as HTMLElement
    const [action, dismiss] = Array.from(item.querySelectorAll('button'))
    assert.equal(action.textContent, 'Undo')
    assert.equal(dismiss.getAttribute('aria-label'), 'Dismiss notification')
    act(() => {
      dismiss.click()
    })
    assert.equal(undone, 0)
    assert.equal(screen.queryByText('Bet voided'), null)
  })

  test('work in progress stays until it is dismissed', () => {
    render(<Toaster />)
    let id = 0
    act(() => {
      id = toast({ message: 'Exporting', busy: true })
    })
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    assert.ok(screen.getByText('Exporting'))

    act(() => {
      toast.dismiss(id)
    })
    assert.equal(screen.queryByText('Exporting'), null)
  })
})
