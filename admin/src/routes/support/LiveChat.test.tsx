import { describe,test,vi } from 'vitest'
import assert from 'node:assert/strict'
import { act,fireEvent,render,screen,waitFor } from '@testing-library/react'
import { ChatThread,SupportInbox } from '../../../../ui-shared/support/SupportChat'
import { createSupportClient } from '../../../../ui-shared/support/client'
import type { ChatEvent,SupportClient } from '../../../../ui-shared/support/client'
import type { ChatBootstrap,ChatConversation,ChatMessage } from '../../../../shared/src/support/contracts'

const conversation:ChatConversation={id:'chat-1',playerId:'7',playerName:'Player One',playerType:'REGULAR',topic:'Account',status:'waiting',assignedKind:null,assignedId:null,assignedName:null,lastSeq:'2',playerReadSeq:'0',staffReadSeq:'0',playerDeliveredSeq:'0',staffDeliveredSeq:'0',preview:'Need help',updatedAt:'2026-10-26T10:00:00Z',unread:1}
const boot:ChatBootstrap={actor:{tenant:'qa',kind:'player',id:'7',name:'Player One',readOnly:false,canReply:true,canAssign:false,canSettings:false,viewAll:false,bookIds:[]},settings:{enabled:true,title:'Support',welcomeMessage:'Welcome',offlineMessage:'Leave a message',timezone:'Asia/Kolkata',openMinute:0,closeMinute:1440,days:[1,2,3,4,5,6,7]},online:false,withinHours:true,available:false,unreadTotal:1}
const incoming:ChatMessage={id:'message-2',seq:'2',body:'Support reply',senderKind:'admin',senderId:'10',senderName:'Support',createdAt:'2026-10-26T10:00:00Z',attachments:[]}
function fakeClient(handler?:(path:string,method?:string,body?:unknown)=>unknown){
 const request=vi.fn(async(path:string,method?:string,body?:unknown)=>handler?handler(path,method,body):path.endsWith('/messages')?{conversation,items:[incoming],before:null}:{})
 const client={base:'/support',request,typing:vi.fn(),connect:vi.fn(()=>()=>{}),image:vi.fn(),publicStatus:vi.fn()} as unknown as SupportClient
 return {client,request}
}
describe('Live support behavior',()=>{
 test('same-origin support endpoint overrides resolve to an absolute socket-compatible URL',()=>{
  const client=createSupportClient('/support/',()=>({}))
  assert.equal(client.base,window.location.origin+'/support')
 })
 test('minimized chat acknowledges delivery, and reopening acknowledges reading',async()=>{
  const {client,request}=fakeClient(),props={client,id:conversation.id,bootstrap:boot,event:null,onChanged:async()=>{}}
  const view=render(<ChatThread {...props} visible={false}/>)
  await screen.findByText('Support reply')
  await waitFor(()=>assert.ok(request.mock.calls.some(([url,,body])=>url.endsWith('/receipt')&&(body as {read:boolean}).read===false)))
  assert.ok(!request.mock.calls.some(([url,,body])=>url.endsWith('/receipt')&&(body as {read:boolean}).read===true))
  view.rerender(<ChatThread {...props} visible/>)
  await waitFor(()=>assert.ok(request.mock.calls.some(([url,,body])=>url.endsWith('/receipt')&&(body as {read:boolean}).read===true)))
 })
 test('unknown send outcome retains the draft and the same idempotency key for retry',async()=>{
  let attempts=0
  const {client,request}=fakeClient((url,method,body)=>{
   if(url.endsWith('/messages')&&method==='POST'){if(++attempts===1)throw new Error('Connection lost after saving');return {...incoming,id:'saved',seq:'3',body:(body as {body:string}).body,senderKind:'player'}}
   return url.endsWith('/messages')?{conversation,items:[],before:null}:{}
  })
  render(<ChatThread client={client} id={conversation.id} bootstrap={boot} event={null} onChanged={async()=>{}}/>)
  const input=await screen.findByRole('textbox',{name:'Message'})
  fireEvent.change(input,{target:{value:'Please check my result'}});fireEvent.click(screen.getByRole('button',{name:'Send'}))
  await screen.findByText('Connection lost after saving')
  assert.equal((input as HTMLTextAreaElement).value,'Please check my result')
  fireEvent.click(screen.getByRole('button',{name:'Send'}))
  await waitFor(()=>assert.equal((input as HTMLTextAreaElement).value,''))
  const sends=request.mock.calls.filter(([url,method])=>url.endsWith('/messages')&&method==='POST')
  assert.equal(sends.length,2);assert.deepEqual(sends[0][2],sends[1][2])
 })
 test('read-only staff can read history but cannot send or take workflow actions',async()=>{
  const {client}=fakeClient()
  render(<ChatThread client={client} id={conversation.id} bootstrap={{...boot,actor:{...boot.actor,kind:'crm',readOnly:true,canAssign:true}}} event={null} onChanged={async()=>{}}/>)
  await screen.findByText('Support reply');assert.equal(screen.queryByRole('textbox',{name:'Message'}),null)
  assert.equal(screen.queryByRole('button',{name:'Resolve'}),null);assert.equal(screen.queryByRole('button',{name:'Transfer'}),null)
 })
 test('repeated realtime delivery of the same persisted message renders one copy',async()=>{
  const {client}=fakeClient(),props={client,id:conversation.id,bootstrap:boot,onChanged:async()=>{}}
  const view=render(<ChatThread {...props} event={null}/>);await screen.findByText('Support reply')
  view.rerender(<ChatThread {...props} event={{type:'changed',conversationId:conversation.id,message:incoming,conversation}}/>)
  await waitFor(()=>assert.equal(screen.getAllByText('Support reply').length,1))
 })
 test('socket reconnection refreshes a thread that was resolved while disconnected',async()=>{
  let resolved=false
  const {client}=fakeClient(url=>url.endsWith('/messages')?{conversation:{...conversation,status:resolved?'resolved':'assigned'},items:[incoming],before:null}:{})
  const props={client,id:conversation.id,bootstrap:boot,onChanged:async()=>{}}
  const view=render(<ChatThread {...props} event={null}/>);await screen.findByRole('textbox',{name:'Message'})
  resolved=true;view.rerender(<ChatThread {...props} event={{type:'ready'}}/>)
  await screen.findByText('This conversation is resolved.');assert.equal(screen.queryByRole('textbox',{name:'Message'}),null)
 })
 test('an event arriving before initial bootstrap cannot leave the inbox loading forever',async()=>{
  let listener:(event:ChatEvent)=>void=()=>{}
  let resolveBootstrap!:(value:ChatBootstrap)=>void
  const deferred=new Promise<ChatBootstrap>(resolve=>resolveBootstrap=resolve)
  const {client}=fakeClient(url=>url==='/bootstrap'?deferred:{items:[conversation],cursor:null})
  client.connect=(fn)=>{listener=fn;return ()=>{}}
  render(<SupportInbox client={client}/>)
  act(()=>listener({type:'changed',conversationId:conversation.id,conversation,unreadTotal:1}))
  await act(async()=>resolveBootstrap({...boot,actor:{...boot.actor,kind:'admin',canReply:false}}))
  await screen.findByText('Player One');await waitFor(()=>assert.ok(screen.queryByText('Loading support inbox…') === null))
 })
 test('a revoked inbox permission clears cached conversation details',async()=>{
  let listener:(event:ChatEvent)=>void=()=>{},revoked=false
  const {client}=fakeClient(url=>{if(revoked)throw Object.assign(new Error('Permission revoked'),{status:403});return url==='/bootstrap'?{...boot,actor:{...boot.actor,kind:'admin',canReply:false}}:{items:[conversation],cursor:null}})
  client.connect=(fn)=>{listener=fn;return ()=>{}}
  render(<SupportInbox client={client}/>);await screen.findByText('Player One')
  revoked=true;act(()=>listener({type:'ready'}));await screen.findByText('Permission revoked')
  await waitFor(()=>assert.ok(screen.queryByText('Player One') === null))
 })
 test('public status omits credentials while private requests retain authorization and no-store',async()=>{
  const fetchMock=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('{}',{status:200,headers:{'content-type':'application/json'}}))
  const client=createSupportClient('http://localhost/support',()=>({authorization:'Bearer private-token','x-whitelabel-id':'qa','x-client-type':'crm'}))
  await client.publicStatus()
  assert.deepEqual(fetchMock.mock.calls[0][1]?.headers,{'x-whitelabel-id':'qa'})
  fetchMock.mockResolvedValue(new Response('{}',{status:200,headers:{'content-type':'application/json'}}))
  await client.request('/bootstrap');assert.equal((fetchMock.mock.calls[1][1]?.headers as Record<string,string>).authorization,'Bearer private-token')
  assert.equal(fetchMock.mock.calls[1][1]?.cache,'no-store');assert.equal(fetchMock.mock.calls[1][1]?.credentials,'omit')
 })
})
