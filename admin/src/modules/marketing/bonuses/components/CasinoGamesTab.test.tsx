import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { DocumentNode, OperationDefinitionNode } from 'graphql'
import { CasinoGamesTab } from './CasinoGamesTab'
type Input = { page?: number; pageSize?: number; includeGameIds?: string[] }
type Row = { id: string; name: string }
type TableProps = { rows: Row[]; columns: Array<{ header: ReactNode; cell: (row: Row) => ReactNode }>; pagination: { onChange: (page: number) => void } }
type PickerProps = { label: string; value: string | null; options: Array<{ value: string; label: string }>; onChange: (value: string | null) => void }
const api=vi.hoisted(()=>({queries:[] as Array<{ name: string; variables: { input: Input } }>,save:vi.fn()}))
vi.mock('@apollo/client',async original=>({...await original<typeof import('@apollo/client')>(),useQuery:(doc:DocumentNode,options:{ variables?: { input?: Input } })=>{
  const name=doc.definitions.find((def): def is OperationDefinitionNode => def.kind === 'OperationDefinition')?.name?.value ?? ''
  api.queries.push({name,variables:{input:options.variables?.input??{}}})
  const input=options.variables?.input ?? {}
  const data=name==='CasinoSelectionGames'?{casinoSelectionGames:{total:100,items:input.includeGameIds?[{id:'10090',name:'Far added game'}]:[{id:input.page===1?'1':'2',name:input.page===1?'Game One':'Game Two'}]}}
    :name==='CasinoApiProviders'?{casinoApiProviders:[{id:'1',name:'Provider'}]}
    :name==='CasinoVendors'?{casinoVendors:[]}
    :name==='CasinoGameBundles'?{casinoGameBundles:[]}
    :{casinoSelectionGameIds:[]}
  return {data,loading:false}
},useMutation:()=>[api.save,{loading:false}]}))
vi.mock('@/ui/components/Combobox',()=>({Combobox:({label,value,options,onChange}:PickerProps)=><select aria-label={label} value={value??''} onChange={e=>onChange(e.target.value||null)}><option value="">All</option>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>}))
vi.mock('@/ui/components/DataTable',()=>({DataTable:({rows,columns,pagination}:TableProps)=><div>{columns[0].header}{rows.map(r=><div key={r.id}>{r.name}{columns[0].cell(r)}</div>)}<button onClick={()=>pagination.onChange(2)}>Next page</button></div>}))
beforeEach(()=>{api.queries.length=0;api.save.mockReset().mockResolvedValue({data:{saveBonusCampaignGames:{success:true}}})})
afterEach(cleanup)
describe('paged campaign casino games',()=>{
  test('retains selections across server pages and saves them with existing assignments',async()=>{
    render(<CasinoGamesTab campaignId="7" currentGameIds={['10090']} currentGameWeights={{'10090':2}} onUpdate={()=>{}} />)
    fireEvent.click(screen.getByRole('checkbox',{name:'Select Game One'}))
    fireEvent.click(screen.getByText('Next page'))
    fireEvent.click(screen.getByRole('checkbox',{name:'Select Game Two'}))
    fireEvent.click(screen.getByRole('button',{name:'Add Selected (2)'}))
    await waitFor(()=>assert.equal(api.save.mock.calls.length,1))
    assert.deepEqual(api.save.mock.calls[0][0].variables,{campaignId:'7',gameIds:['10090','1','2'],gameWeights:{'10090':2,'1':1,'2':1}})
    assert(api.queries.filter(q=>q.name==='CasinoSelectionGames').every(q=>q.variables.input.pageSize===20))
    assert(!api.queries.some(q=>q.name==='CasinoGames'))
  })
  test('loads added games by their actual IDs even beyond the first catalog window',()=>{
    render(<CasinoGamesTab campaignId="7" currentGameIds={['10090']} currentGameWeights={null} onUpdate={()=>{}} />)
    fireEvent.click(screen.getByRole('tab',{name:'Added Games (1)'}))
    assert.ok(screen.getByText('Far added game'))
    assert.deepEqual(api.queries.filter(q=>q.name==='CasinoSelectionGames').at(-1)!.variables.input.includeGameIds,['10090'])
  })
})
