import assert from 'node:assert/strict'
import { useState } from 'react'
import { afterEach, describe, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { DocumentNode, OperationDefinitionNode } from 'graphql'
import { BundleGamesSelector } from './BundleGamesSelector'
type Input = { page?: number; pageSize?: number }
type Row = { id: string; name: string }
type TableProps = { rows: Row[]; selection: { selected: ReadonlySet<string>; onChange: (ids: Set<string>) => void }; pagination: { onChange: (page: number) => void } }
const api=vi.hoisted(()=>({queries:[] as Array<{ name: string; variables: { input: Input } }>}))
vi.mock('@apollo/client',async original=>({...await original<typeof import('@apollo/client')>(),useQuery:(doc:DocumentNode,options:{ variables?: { input?: Input } })=>{
  const name=doc.definitions.find((def): def is OperationDefinitionNode => def.kind === 'OperationDefinition')?.name?.value ?? '';api.queries.push({name,variables:{input:options.variables?.input??{}}})
  const page=options.variables?.input?.page
  return{loading:false,data:name==='CasinoSelectionGames'?{casinoSelectionGames:{total:12520,items:[{id:page===1?'1':'2',name:page===1?'First game':'Second game'}]}}:name==='CasinoApiProviders'?{casinoApiProviders:[]}:name==='CasinoVendors'?{casinoVendors:[]}:{matkas:{items:[]}}}
}}))
vi.mock('@/ui/components/DataTable',()=>({DataTable:({rows,selection,pagination}:TableProps)=><div>{rows.map(r=><button key={r.id} onClick={()=>selection.onChange(new Set([...selection.selected,r.id]))}>{r.name}</button>)}<button onClick={()=>pagination.onChange(2)}>Next games</button></div>}))
afterEach(()=>{cleanup();api.queries.length=0})
describe('bundle game pagination',()=>{
  test('keeps picked IDs across pages and displays the full catalog total without fetching it',()=>{
    function Form(){const[ids,setIds]=useState<string[]>([]);return <BundleGamesSelector domain="casino" selectedGameIds={ids} onSelectionChange={setIds}/>}
    render(<Form/>);fireEvent.click(screen.getByText('First game'));fireEvent.click(screen.getByText('Next games'));fireEvent.click(screen.getByText('Second game'))
    assert.ok(screen.getAllByRole('status').some(node=>node.textContent?.includes('2 selected')))
    const reads=api.queries.filter(q=>q.name==='CasinoSelectionGames')
    assert.equal(reads.at(-1)!.variables.input.page,2)
    assert(reads.every(q=>q.variables.input.pageSize===50))
    assert(!api.queries.some(q=>q.name==='CasinoGames'))
  })
})
