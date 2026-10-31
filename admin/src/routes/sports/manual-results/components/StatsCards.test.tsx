import assert from 'node:assert/strict'
import { afterEach, describe, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { StatsCards } from './StatsCards'
const hooks=vi.hoisted(()=>({useQuery:vi.fn()}))
vi.mock('@apollo/client',async original=>({...await original<typeof import('@apollo/client')>(),useQuery:hooks.useQuery}))
afterEach(cleanup)
describe('complete manual result statistics',()=>{
  test('renders a total beyond the old 100-row repository cap and keeps active/rollback totals separate',()=>{
    hooks.useQuery.mockReturnValue({data:{sportsResultStats:{total:4559,today:10,exchange:4000,bookmaker:20,fancy:5,rolledBack:534}},loading:false})
    render(<StatsCards />)
    assert.ok(screen.getByText((4559).toLocaleString()))
    assert.ok(screen.getByText('10 today'))
    assert.ok(screen.getByText('5 fancy'))
    assert.ok(screen.getByText('534'))
    assert.equal(hooks.useQuery.mock.calls.at(-1)?.[0].definitions[0].name.value,'SportsResultStats')
  })
  test('retains prior figures while refreshing, and refreshes after a result action',()=>{
    const refetch=vi.fn().mockResolvedValue({})
    hooks.useQuery.mockReturnValue({data:{sportsResultStats:{total:4559,today:10,exchange:4000,bookmaker:20,fancy:5,rolledBack:534}},loading:true,refetch})
    const view=render(<StatsCards />)
    assert.ok(screen.getByText((4559).toLocaleString()))
    view.rerender(<StatsCards revision={1} />)
    assert.equal(refetch.mock.calls.length,1)
  })
  test('does not present zero totals on a failed read',()=>{
    hooks.useQuery.mockReturnValue({error:{message:'Read failed'},loading:false,refetch:vi.fn()})
    render(<StatsCards />)
    assert.ok(screen.getByText('Statistics unavailable'))
    assert.ok(screen.getByText('Retry stats'))
  })
})
