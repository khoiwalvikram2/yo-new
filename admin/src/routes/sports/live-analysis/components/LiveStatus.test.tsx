import { afterEach, describe, test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ErrorBoundary } from './ErrorBoundary'
import { EmptyState } from './EmptyState'
import { LoadingState } from './LoadingState'

const expectedRenderError = (event: ErrorEvent) => {
  if (event.message.includes('Feed rendering failed') || event.message.includes('Broken')) event.preventDefault()
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.removeEventListener('error', expectedRenderError) })

describe('shared live workspace status surfaces', () => {
  test('preserves spinner text and configurable skeleton rows without legacy surfaces', () => {
    const { rerender } = render(<LoadingState message="Fetching event data" />)
    assert.equal(screen.getByRole('status').textContent, 'Fetching event data')
    rerender(<LoadingState type="skeleton" message="Fetching markets" rows={3} />)
    const status = screen.getByRole('status', { name: 'Fetching markets' })
    assert.equal(status.getAttribute('aria-busy'), 'true')
    assert.equal(status.querySelectorAll(':scope > [aria-hidden="true"]').length, 3)
    rerender(<LoadingState type="skeleton" rows={0} />)
    assert.equal(screen.getByRole('status').children.length, 0)
  })
  test('preserves empty description and decorative custom image', () => {
    const { rerender } = render(<EmptyState />)
    assert.ok(screen.getByText('No data available'))
    rerender(<EmptyState description="No bets in this scope" image={<span data-testid="custom-icon">icon</span>} />)
    assert.ok(screen.getByText('No bets in this scope'))
    assert.equal(screen.getByTestId('custom-icon').parentElement?.getAttribute('aria-hidden'), 'true')
  })
  test('displays a real render error and retries children after the cause is resolved', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    window.addEventListener('error', expectedRenderError)
    let broken = true
    const Child = () => { if (broken) throw new Error('Feed rendering failed'); return <p>Recovered feed</p> }
    render(<ErrorBoundary><Child /></ErrorBoundary>)
    assert.ok(screen.getByRole('alert'))
    assert.ok(screen.getByText('Feed rendering failed'))
    broken = false
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }))
    assert.ok(screen.getByText('Recovered feed'))
    assert.equal(Boolean(screen.queryByRole('alert')), false)
  })
  test('continues to honor a caller supplied fallback', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    window.addEventListener('error', expectedRenderError)
    const Child = () => { throw new Error('Broken') }
    render(<ErrorBoundary fallback={<p>Caller fallback</p>}><Child /></ErrorBoundary>)
    assert.ok(screen.getByText('Caller fallback'))
    assert.equal(Boolean(screen.queryByRole('button', { name: 'Try Again' })), false)
  })
})
