import assert from 'node:assert/strict'
import { afterEach, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DataTable } from './DataTable'
import { Pagination } from './Pagination'

afterEach(cleanup)

test('server pagination corrects the owner offset only after the new total finishes loading', () => {
  const onChange = vi.fn()
  const pager = (loading: boolean, total: number) => <Pagination current={8} pageSize={20} total={total} loading={loading} onChange={onChange} onPageSizeChange={vi.fn()} />
  const view = render(pager(true, 0))
  assert.equal(onChange.mock.calls.length, 0)
  view.rerender(pager(false, 25))
  assert.deepEqual(onChange.mock.calls, [[2]])
  view.rerender(pager(false, 180))
  assert.equal(onChange.mock.calls.length, 1)
})

test('a controlled table refetches a valid page after filtered totals shrink', () => {
  const onChange = vi.fn()
  const table = (state: 'loading' | 'ready', total: number) => <DataTable columns={[{key:'id',header:'ID',cell:(r:{id:string})=>r.id}]} rows={[]} rowKey={r=>r.id} label="Server results" state={state} pagination={{current:5,pageSize:20,total,onChange,onPageSizeChange:vi.fn()}} />
  const view = render(table('loading', 0))
  assert.equal(onChange.mock.calls.length, 0)
  view.rerender(table('ready', 0))
  assert.deepEqual(onChange.mock.calls, [[1]])
})

test('client table commits its clamped page so later growth does not resurrect an obsolete page', () => {
  const table = (count: number) => <DataTable columns={[{key:'id',header:'ID',cell:(r:{id:string})=>r.id}]} rows={Array.from({length:count},(_,i)=>({id:`row-${i}`}))} rowKey={r=>r.id} label="Client results" pagination="client" />
  const view = render(table(45))
  fireEvent.click(screen.getByRole('button',{name:'Next page'}))
  view.rerender(table(1))
  view.rerender(table(45))
  assert.equal(screen.getByRole('button',{name:'Page 1'}).getAttribute('aria-current'),'page')
})
