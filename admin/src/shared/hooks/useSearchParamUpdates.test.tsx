/**
 * A list page seeds its search box from ?search= once; useSearchParamUpdates hands it the term of each later link
 * to the same, still-mounted page (the global search's "See all" while the list is open).
 */
import assert from 'node:assert/strict'
import { afterEach, describe, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { useSearchParamUpdates } from './useSearchParamUpdates'

afterEach(cleanup)

function List({ onTerm }: { onTerm: (term: string) => void }) {
  useSearchParamUpdates(onTerm)
  const navigate = useNavigate()
  return (
    <>
      <button type="button" onClick={() => navigate('/players/search?search=vfypsh')}>See all vfypsh</button>
      <button type="button" onClick={() => navigate('/players/search?search=other')}>See all other</button>
      <button type="button" onClick={() => navigate('/players/search?playerType=CREDIT')}>Own tab</button>
      <button type="button" onClick={() => navigate('/players/search?search=a%20b%26c')}>Encoded</button>
    </>
  )
}

function mount(path: string) {
  const onTerm = vi.fn<(term: string) => void>()
  render(<MemoryRouter initialEntries={[path]}><List onTerm={onTerm} /></MemoryRouter>)
  return onTerm
}

describe('useSearchParamUpdates', () => {
  test('the term the page opened with is left to its initial state', () => {
    const onTerm = mount('/players/search?search=vfypsh')
    assert.equal(onTerm.mock.calls.length, 0)
  })

  test('each later link with a term hands it over, even the same term again', () => {
    const onTerm = mount('/players/search')
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'See all vfypsh' })) })
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'See all other' })) })
    // The admin typed something else in between; asking for the same term again re-seeds it.
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'See all vfypsh' })) })
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Encoded' })) })
    assert.deepEqual(onTerm.mock.calls.map(([term]) => term), ['vfypsh', 'other', 'vfypsh', 'a b&c'])
  })

  test("a navigation without the parameter (the page's own tab write) leaves the box alone", () => {
    const onTerm = mount('/players/search?search=vfypsh')
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Own tab' })) })
    assert.equal(onTerm.mock.calls.length, 0)
  })
})
