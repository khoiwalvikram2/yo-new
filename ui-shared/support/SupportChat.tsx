import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { SupportClient, ChatEvent } from './client'
import type { ChatBootstrap,ChatConversation,ChatMessage,ChatAttachment,ChatSettings,ChatStaff } from '../../shared/src/support/contracts'
import { CHAT_TOPICS } from '../../shared/src/support/contracts'
import { setSupportLauncherState } from './launcherState'
import './support-chat.css'

const labelStatus=(status:string)=>status==='waiting'?'Waiting':status==='assigned'?'Assigned':'Resolved'
const date=(value:string)=>new Intl.DateTimeFormat(undefined,{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(value))
const errorText=(error:unknown)=>error instanceof Error?error.message:'Something went wrong. Please retry.'
const merge=(a:ChatMessage[],b:ChatMessage[])=>[...new Map([...a,...b].map(m=>[m.seq,m])).values()].sort((a,b)=>BigInt(a.seq)<BigInt(b.seq)?-1:BigInt(a.seq)>BigInt(b.seq)?1:0)
function Glyph({name='chat'}:{name?:string}) {
  const paths:Record<string,string>={chat:'M21 11.5a8.4 8.4 0 0 1-.9 3.8A8.5 8.5 0 0 1 12.5 20a8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 8.7 3.9 8.4 8.4 0 0 1 12.5 3h.5a8.5 8.5 0 0 1 8 8v.5Z',close:'M6 6l12 12M6 18 18 6',back:'M15 5l-7 7 7 7',send:'m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13',attach:'m21 11-8 8a6 6 0 0 1-8-8l9-9a4 4 0 0 1 6 6l-9 9a2 2 0 0 1-3-3l8-8',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2',check:'m4 12 5 5L20 6'}
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]||paths.chat}/></svg>
}
function ErrorNotice({error,retry}:{error:string;retry?:()=>void}) {return error?<div className="gw-chat-error" role="alert">{error}{retry&&<button type="button" onClick={retry}>Retry</button>}</div>:null}

function useLiveChat(client:SupportClient,enabled:boolean,query='') {
  const [bootstrap,setBootstrap]=useState<ChatBootstrap|null>(null),[items,setItems]=useState<ChatConversation[]>([]),[cursor,setCursor]=useState<string|null>(null),[error,setError]=useState(''),[status,setStatus]=useState('Connecting'),[event,setEvent]=useState<ChatEvent|null>(null)
  const epoch=useRef(0),mounted=useRef(false),refreshRef=useRef<()=>Promise<void>>(async()=>{}),queryRef=useRef(query),bootstrapRef=useRef(bootstrap)
  queryRef.current=query
  bootstrapRef.current=bootstrap
  const refresh=useCallback(async()=>{
    if(!enabled)return
    const generation=++epoch.current
    try {
      const [boot,page]=await Promise.all([client.request<ChatBootstrap>('/bootstrap'),client.request<{items:ChatConversation[];cursor:string|null}>('/conversations'+query)])
      if(mounted.current&&generation===epoch.current){setBootstrap(boot);setItems(page.items);setCursor(page.cursor);setError('')}
    }catch(e){if(mounted.current&&generation===epoch.current){setError(errorText(e));if([401,403].includes(Number((e as {status?:number}).status))){setBootstrap(null);setItems([])}}}
  },[client,enabled,query])
  refreshRef.current=refresh
  useEffect(()=>{mounted.current=true;setBootstrap(null);setItems([]);setError('');return()=>{mounted.current=false}},[client,enabled])
  useEffect(()=>{void refresh()},[refresh])
  useEffect(()=>{
    if(!enabled)return
    let debounce:ReturnType<typeof setTimeout>|undefined
    const stop=client.connect(e=>{
      setEvent(e)
      if(e.type==='changed'&&e.conversation){
        if(bootstrapRef.current)epoch.current++
        else {if(debounce)clearTimeout(debounce);debounce=setTimeout(()=>void refreshRef.current(),100)}
        const chat=e.conversation
        const params=new URLSearchParams(queryRef.current)
        const filter=params.get('status')||'all',needle=(params.get('search')||'').toLowerCase()
        const matches=(filter==='all'||chat.status===filter)&&(!needle||(chat.playerName+' '+chat.topic).toLowerCase().includes(needle))
        setItems(current=>{const remaining=current.filter(c=>c.id!==chat.id);return (matches?[chat,...remaining]:remaining).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||b.id.localeCompare(a.id))})
        if(e.unreadTotal!==undefined)setBootstrap(current=>current?{...current,unreadTotal:e.unreadTotal!}:current)
      }else if(e.type==='ready'||e.type==='status'){if(debounce)clearTimeout(debounce);debounce=setTimeout(()=>void refreshRef.current(),100)}
    },setStatus)
    const interval=setInterval(()=>{if(document.visibilityState==='visible')void refreshRef.current()},30000)
    const visible=()=>{if(document.visibilityState==='visible')void refreshRef.current()}
    document.addEventListener('visibilitychange',visible)
    return()=>{stop();clearInterval(interval);if(debounce)clearTimeout(debounce);document.removeEventListener('visibilitychange',visible)}
  },[client,enabled])
  const more=async()=>{
    if(!cursor)return
    try{const page=await client.request<{items:ChatConversation[];cursor:string|null}>('/conversations'+query+(query?'&':'?')+'cursor='+encodeURIComponent(cursor));setItems(current=>[...new Map([...current,...page.items].map(c=>[c.id,c])).values()]);setCursor(page.cursor)}catch(e){setError(errorText(e))}
  }
  return {bootstrap,items,error,status,event,refresh,more,cursor}
}

function Attachment({file,client}:{file:ChatAttachment;client:SupportClient}) {
  const [url,setUrl]=useState(''),[error,setError]=useState(false),[visible,setVisible]=useState(false),element=useRef<HTMLDivElement>(null)
  useEffect(()=>{
    if(typeof IntersectionObserver==='undefined'){setVisible(true);return}
    const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);observer.disconnect()}},{rootMargin:'100px'})
    if(element.current)observer.observe(element.current)
    return()=>observer.disconnect()
  },[])
  useEffect(()=>{if(!visible)return;let active=true,value='';client.image(file.id).then(blob=>{value=URL.createObjectURL(blob);if(active)setUrl(value);else URL.revokeObjectURL(value)}).catch(()=>{if(active)setError(true)});return()=>{active=false;if(value)URL.revokeObjectURL(value)}},[client,file.id,visible])
  return <div ref={element} className="gw-chat-image">{url?<a href={url} target="_blank" rel="noopener noreferrer" aria-label={'Open '+file.filename}><img src={url} alt={file.filename}/><span>{file.filename} · {Math.ceil(file.size/1024)} KB ↗</span></a>:<span>{error?'Screenshot could not load':file.filename+' · Loading screenshot…'}</span>}</div>
}

type ThreadData={conversation:ChatConversation;items:ChatMessage[];before:string|null}
export function ChatThread({client,id,bootstrap,event,onChanged,onBack,visible=true}:{client:SupportClient;id:string;bootstrap:ChatBootstrap;event:ChatEvent|null;onChanged:()=>Promise<void>;onBack?:()=>void;visible?:boolean}) {
  const [thread,setThread]=useState<ThreadData|null>(null),[messages,setMessages]=useState<ChatMessage[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[body,setBody]=useState(''),[files,setFiles]=useState<ChatAttachment[]>([]),[busy,setBusy]=useState(false),[uploading,setUploading]=useState(false),[typing,setTyping]=useState(false),[transfer,setTransfer]=useState<ChatStaff[]|null>(null),[target,setTarget]=useState('')
  const feed=useRef<HTMLDivElement>(null),fileInput=useRef<HTMLInputElement>(null),active=useRef(true),stick=useRef(true),draft=useRef<{key:string;body:string;attachmentIds:string[]}|null>(null),typingTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),lastTyping=useRef(0),readKey=useRef(''),requestEpoch=useRef(0),remoteTypingTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined)
  const refresh=useCallback(async()=>{
    const current=++requestEpoch.current
    try{const data=await client.request<ThreadData>(`/conversations/${id}/messages`);if(active.current&&current===requestEpoch.current){setThread(data);setMessages(old=>merge(old,data.items));setError('')}}catch(e){if(active.current){setError(errorText(e));if([401,403,404].includes(Number((e as {status?:number}).status))){setThread(null);setMessages([])}}}finally{if(active.current)setLoading(false)}
  },[client,id])
  useEffect(()=>{active.current=true;void refresh();return()=>{active.current=false;if(typingTimer.current)clearTimeout(typingTimer.current)}},[refresh])
  useEffect(()=>{
    if(event?.type==='ready'){void refresh();return}
    if(event?.conversationId!==id)return
    if(event.type==='changed'){
      setTyping(false);if(remoteTypingTimer.current)clearTimeout(remoteTypingTimer.current)
      if(event.conversation)setThread(current=>current?{...current,conversation:event.conversation!}:current)
      if(event.message){setMessages(current=>merge(current,[event.message!]));setLoading(false)}
      else if(event.event==='conversation')void refresh()
    }
    if(event.type==='typing'&&(bootstrap.actor.kind==='player'?event.senderKind!=='player':event.senderKind==='player')){
      setTyping(Boolean(event.typing));if(remoteTypingTimer.current)clearTimeout(remoteTypingTimer.current)
      remoteTypingTimer.current=setTimeout(()=>setTyping(false),3500)
    }
  },[event,id,refresh,bootstrap.actor.kind])
  useEffect(()=>()=>{if(remoteTypingTimer.current)clearTimeout(remoteTypingTimer.current)},[])
  useEffect(()=>{const visible=()=>{if(document.visibilityState==='visible')void refresh()};const timer=setInterval(visible,30000);document.addEventListener('visibilitychange',visible);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',visible)}},[refresh])
  useLayoutEffect(()=>{if(visible&&stick.current&&feed.current)feed.current.scrollTop=feed.current.scrollHeight},[messages.length,typing,visible])
  const latest=messages.filter(message=>bootstrap.actor.kind==='player'?message.senderKind!=='player':message.senderKind==='player').at(-1)?.seq
  useEffect(()=>{
    if(!latest||!thread||bootstrap.actor.readOnly)return
    const read=visible&&document.visibilityState==='visible',prefix=bootstrap.actor.kind==='player'?'player':'staff'
    const previous=read?(prefix==='player'?thread.conversation.playerReadSeq:thread.conversation.staffReadSeq):(prefix==='player'?thread.conversation.playerDeliveredSeq:thread.conversation.staffDeliveredSeq)
    const key=id+':'+latest+':'+read
    if(BigInt(previous)>=BigInt(latest)||readKey.current===key)return
    readKey.current=key
    void client.request(`/conversations/${id}/receipt`,'POST',{seq:latest,read}).catch(()=>{readKey.current=''})
  },[client,id,latest,thread,bootstrap.actor.kind,bootstrap.actor.readOnly,visible])
  const staff=bootstrap.actor.kind!=='player',chat=thread?.conversation,assignedElsewhere=Boolean(staff&&chat?.assignedId&&(chat.assignedId!==bootstrap.actor.id||chat.assignedKind!==bootstrap.actor.kind)&&!bootstrap.actor.canAssign)
  const writable=Boolean(chat&&chat.status!=='resolved'&&!bootstrap.actor.readOnly&&(!staff||bootstrap.actor.canReply)&&!assignedElsewhere&&(staff||bootstrap.settings.enabled))
  const send=async()=>{
    if(busy||uploading||(!body.trim()&&!files.length))return
    const ids=files.map(f=>f.id)
    if(!draft.current||draft.current.body!==body.trim()||JSON.stringify(draft.current.attachmentIds)!==JSON.stringify(ids))draft.current={key:crypto.randomUUID(),body:body.trim(),attachmentIds:ids}
    setBusy(true);setError('');stick.current=true
    try{const saved=await client.request<ChatMessage>(`/conversations/${id}/messages`,'POST',{clientMessageId:draft.current.key,body:draft.current.body,attachmentIds:ids});if(!active.current)return;setMessages(current=>merge(current,[saved]));setBody('');setFiles([]);draft.current=null;client.typing(id,false);await refresh();await onChanged()}catch(e){if(active.current)setError(errorText(e))}finally{if(active.current)setBusy(false)}
  }
  const upload=async(event:ChangeEvent<HTMLInputElement>)=>{
    const picked=event.target.files?.[0];event.target.value='';if(!picked)return
    if(picked.size>2*1024*1024){setError('Choose a screenshot smaller than 2 MB.');return}
    if(files.length>=3){setError('Attach up to three screenshots per message.');return}
    setUploading(true);setError('')
    try{const bytes=new Uint8Array(await picked.arrayBuffer());let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));const file=await client.request<ChatAttachment>(`/conversations/${id}/attachments`,'POST',{filename:picked.name,base64:btoa(text)});if(active.current)setFiles(current=>[...current,file])}catch(e){if(active.current)setError(errorText(e))}finally{if(active.current)setUploading(false)}
  }
  const action=async(kind:string,extra={})=>{
    setBusy(true);setError('')
    try{await client.request(`/conversations/${id}/action`,'POST',{action:kind,...extra});setTransfer(null);await refresh();await onChanged()}catch(e){setError(errorText(e))}finally{setBusy(false)}
  }
  const older=async()=>{
    if(!thread?.before)return
    setBusy(true);const previous=feed.current?.scrollHeight||0,top=feed.current?.scrollTop||0;stick.current=false
    try{const data=await client.request<ThreadData>(`/conversations/${id}/messages?before=${thread.before}`);setMessages(current=>merge(data.items,current));setThread(current=>current?{...current,before:data.before}:current);requestAnimationFrame(()=>{if(feed.current)feed.current.scrollTop=top+feed.current.scrollHeight-previous})}catch(e){setError(errorText(e))}finally{setBusy(false)}
  }
  return <section className="gw-chat-thread" aria-label="Support conversation">
    <header className="gw-thread-header">{onBack&&<button type="button" className="gw-chat-icon gw-chat-back" aria-label="Back to conversations" onClick={onBack}><Glyph name="back"/></button>}<div><strong>{staff?chat?.playerName||'Conversation':chat?.topic||'Support conversation'}</strong><span>{chat?`${chat.topic} · ${labelStatus(chat.status)}`:'Loading conversation…'}{staff&&chat?' · '+chat.playerType.replaceAll('_',' '):''}</span></div>{chat&&<span className={'gw-chat-state '+chat.status}>{labelStatus(chat.status)}</span>}</header>
    {staff&&chat&&<div className="gw-chat-actions"><span>{chat.assignedName?'Assigned to '+chat.assignedName:'Waiting for a support staff member'}</span><div>{chat.status!=='resolved'&&bootstrap.actor.canReply&&!bootstrap.actor.readOnly&&<button disabled={busy||assignedElsewhere} onClick={()=>void action('claim')}>Join chat</button>}{bootstrap.actor.canAssign&&!bootstrap.actor.readOnly&&chat.status!=='resolved'&&<button disabled={busy} onClick={()=>{setError('');void client.request<{items:ChatStaff[]}>(`/conversations/${id}/staff`).then(data=>{setTransfer(data.items);setTarget('')}).catch(e=>setError(errorText(e)))}}>Transfer</button>}{!bootstrap.actor.readOnly&&(bootstrap.actor.canReply||bootstrap.actor.canAssign)&&<button disabled={busy||assignedElsewhere} onClick={()=>void action(chat.status==='resolved'?'reopen':'resolve')}>{chat.status==='resolved'?'Reopen':'Resolve'}</button>}</div></div>}
    {transfer&&<div className="gw-chat-transfer"><label>Transfer to<select aria-label="Transfer to support staff" value={target} onChange={e=>setTarget(e.target.value)}><option value="">Choose support staff</option>{transfer.map(s=><option key={s.kind+':'+s.id} value={s.kind+':'+s.id}>{s.name} · {s.online?'Online':'Offline'}</option>)}</select></label><button disabled={!target||busy} onClick={()=>{const [staffKind,...parts]=target.split(':');void action('transfer',{staffKind,staffId:parts.join(':')})}}>Transfer chat</button><button onClick={()=>setTransfer(null)}>Cancel</button></div>}
    <ErrorNotice error={error} retry={()=>void refresh()}/>
    <div ref={feed} className="gw-chat-feed" role="log" aria-label="Chat messages" aria-live="polite" onScroll={()=>{if(feed.current)stick.current=feed.current.scrollHeight-feed.current.scrollTop-feed.current.clientHeight<90}}>
      {loading&&<p className="gw-chat-placeholder" role="status">Loading messages…</p>}
      {thread?.before&&<button className="gw-chat-older" disabled={busy} onClick={()=>void older()}>Load earlier messages</button>}
      {!loading&&!messages.length&&<div className="gw-chat-welcome"><Glyph/><strong>{bootstrap.settings.welcomeMessage}</strong><span>Messages and screenshots stay in this conversation.</span></div>}
      {messages.map(m=>{
        const own=staff?(m.senderKind==='admin'||m.senderKind==='crm'):m.senderKind==='player'
        const recipientRead=chat?(staff?chat.playerReadSeq:chat.staffReadSeq):'0',recipientDelivered=chat?(staff?chat.playerDeliveredSeq:chat.staffDeliveredSeq):'0'
        const delivery=BigInt(m.seq)<=BigInt(recipientRead)?'Seen':BigInt(m.seq)<=BigInt(recipientDelivered)?'Delivered':'Sent'
        return m.senderKind==='system'?<p key={m.id} className="gw-chat-system">{m.body}<time>{date(m.createdAt)}</time></p>:<article key={m.id} className={'gw-chat-bubble '+(own?'own':'other')}><span className="gw-chat-author">{m.senderKind==='player'?(staff?m.senderName:'You'):m.senderName}</span>{m.body&&<p>{m.body}</p>}{m.attachments.map(file=><Attachment key={file.id} file={file} client={client}/>)}<footer><time>{date(m.createdAt)}</time>{own&&<span className={delivery==='Seen'?'seen':''}>{delivery==='Seen'?'✓✓ ':delivery==='Delivered'?'✓✓ ':'✓ '}{delivery}</span>}</footer></article>
      })}
      {typing&&<p className="gw-chat-typing" role="status">{staff?'Player':'Support'} is typing<span>…</span></p>}
    </div>
    {writable?<form className="gw-chat-composer" onSubmit={e=>{e.preventDefault();void send()}}>
      {files.length>0&&<div className="gw-chat-pending-files">{files.map(file=><span key={file.id}>{file.filename}<button type="button" aria-label={'Remove '+file.filename} disabled={busy} onClick={()=>setFiles(current=>current.filter(f=>f.id!==file.id))}>×</button></span>)}</div>}
      <label className="gw-chat-sr" htmlFor={'chat-message-'+id}>Message</label><textarea id={'chat-message-'+id} aria-label="Message" placeholder="Write your message…" value={body} maxLength={4000} disabled={busy} onChange={e=>{setBody(e.target.value);if(Date.now()-lastTyping.current>1500){client.typing(id,true);lastTyping.current=Date.now()}if(typingTimer.current)clearTimeout(typingTimer.current);typingTimer.current=setTimeout(()=>client.typing(id,false),1800)}} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send()}}}/>
      <div className="gw-chat-compose-footer"><input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="gw-chat-sr" aria-label="Attach screenshot" onChange={e=>void upload(e)}/><button type="button" className="gw-chat-icon" title="Attach a screenshot (PNG, JPEG, WebP; max 2 MB)" aria-label="Attach a screenshot" disabled={busy||uploading||files.length>=3} onClick={()=>fileInput.current?.click()}><Glyph name="attach"/></button><span>{uploading?'Uploading screenshot…':`${body.length}/4000 · Screenshots up to 2 MB`}</span><button type="submit" className="gw-chat-primary" disabled={busy||uploading||(!body.trim()&&!files.length)}><Glyph name="send"/>{busy?'Sending…':'Send'}</button></div>
    </form>:<div className="gw-chat-closed">{chat?.status==='resolved'?'This conversation is resolved.':assignedElsewhere?'Another staff member is handling this conversation.':bootstrap.actor.readOnly?'Your support account is read-only.':'Replies are currently unavailable.'}</div>}
  </section>
}

export function SupportInbox({client,onSettings}:{client:SupportClient;onSettings?:()=>void}) {
  const [filter,setFilter]=useState('all'),[search,setSearch]=useState(''),[query,setQuery]=useState(''),[selected,setSelected]=useState<string|null>(null),[error,setError]=useState('')
  useEffect(()=>{const timer=setTimeout(()=>setQuery(search.trim()),250);return()=>clearTimeout(timer)},[search])
  const params=useMemo(()=>'?'+new URLSearchParams({status:filter,...(query?{search:query}:{})}),[filter,query])
  const state=useLiveChat(client,true,params),boot=state.bootstrap
  const available=boot?.available,canReply=boot?.actor.canReply,readOnly=boot?.actor.readOnly
  useEffect(()=>{
    if(available===undefined||readOnly||!canReply)return
    const heartbeat=()=>{if(document.visibilityState==='visible')void client.request('/presence','POST',{available}).catch(()=>{})}
    heartbeat();const timer=setInterval(heartbeat,30000);return()=>clearInterval(timer)
  },[client,available,readOnly,canReply])
  const toggle=async()=>{if(!boot)return;try{await client.request('/presence','POST',{available:!boot.available});setError('');await state.refresh()}catch(e){setError(errorText(e))}}
  return <div className="gw-support gw-support-desk"><header className="gw-support-page-header" data-page-header="title-only"><div className="gw-chat-brand"><span><Glyph/></span><div><h1>Live Chat Inbox</h1></div></div><div className="gw-chat-desk-controls"><span className={'gw-chat-connection '+(state.status==='Connected'?'online':'')}>{state.status}</span>{boot?.actor.canReply&&!boot.actor.readOnly&&<button className={'gw-chat-availability '+(boot.available?'available':'')} aria-pressed={boot.available} onClick={()=>void toggle()}>{boot.available?'● Available':'○ Offline'}</button>}{onSettings&&boot?.actor.canSettings&&<button onClick={onSettings}><Glyph name="settings"/>Chat settings</button>}<button onClick={()=>void state.refresh()}>Refresh</button></div></header>
    <ErrorNotice error={error||state.error} retry={()=>void state.refresh()}/>
    {boot&&!boot.settings.enabled&&<div className="gw-chat-banner">Live chat is disabled for players. Existing conversations remain available to staff.{onSettings&&boot.actor.canSettings&&<button onClick={onSettings}>Enable in settings</button>}</div>}
    <div className="gw-chat-workspace" data-has-thread={Boolean(selected)}><aside className="gw-chat-inbox-list"><div className="gw-chat-inbox-filters"><label className="gw-chat-search"><span className="gw-chat-sr">Search conversations</span><input type="search" aria-label="Search conversations" placeholder="Search player or topic…" value={search} onChange={e=>setSearch(e.target.value)}/></label><div className="gw-chat-filters" role="group" aria-label="Conversation status">{['all','waiting','assigned','resolved'].map(value=><button key={value} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{value==='all'?'All':labelStatus(value)}</button>)}</div><p>{boot?.unreadTotal||0} unread messages</p></div><div className="gw-chat-conversation-scroll" aria-label="Conversations">
      {!boot&&!state.error&&<p className="gw-chat-placeholder">Loading support inbox…</p>}{boot&&!state.items.length&&<div className="gw-chat-empty"><Glyph/><strong>No conversations here</strong><p>{query?'Try another player name.':'Player messages will appear here.'}</p></div>}
      {state.items.map(chat=><button key={chat.id} className={'gw-chat-conversation '+(selected===chat.id?'selected':'')} onClick={()=>setSelected(chat.id)}><div><strong>{chat.playerName}</strong><time>{date(chat.updatedAt)}</time></div><div><span className="gw-chat-topic">{chat.topic}</span><span className={'gw-chat-state '+chat.status}>{labelStatus(chat.status)}</span>{chat.unread>0&&<b className="gw-chat-unread">{chat.unread>99?'99+':chat.unread}</b>}</div><p>{chat.preview||'New conversation'}</p><small>{chat.assignedName?'Assigned to '+chat.assignedName:'Unassigned'}</small></button>)}
      {state.cursor&&<button className="gw-chat-older" onClick={()=>void state.more()}>Load more conversations</button>}
    </div></aside><section className="gw-chat-inbox-main" aria-label="Selected conversation">{selected&&boot?<ChatThread key={selected} client={client} id={selected} bootstrap={boot} event={state.event} onChanged={state.refresh} onBack={()=>setSelected(null)}/>:<div className="gw-chat-empty gw-chat-empty-main"><Glyph/><h2>Your support workspace</h2><p>Select a conversation to view its history and reply.</p><span>Choose a waiting conversation or search for a player.</span></div>}</section></div></div>
}

export function SupportSettings({client,onBack}:{client:SupportClient;onBack:()=>void}) {
  const [settings,setSettings]=useState<ChatSettings|null>(null),[error,setError]=useState(''),[saved,setSaved]=useState(false),[busy,setBusy]=useState(false)
  useEffect(()=>{let active=true;client.request<ChatBootstrap>('/bootstrap').then(value=>{if(!value.actor.canSettings)throw new Error('Support settings permission is required');if(active)setSettings(value.settings)}).catch(e=>{if(active)setError(errorText(e))});return()=>{active=false}},[client])
  const change=(patch:Partial<ChatSettings>)=>{setSettings(value=>value?{...value,...patch}:value);setSaved(false)}
  const time=(minute:number)=>`${String(Math.floor(minute/60)%24).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`
  return <div className="gw-support gw-chat-settings"><header className="gw-support-page-header" data-page-header="title-only"><div className="gw-chat-title-row"><button type="button" className="gw-chat-page-back" aria-label="Back to inbox" title="Back to inbox" onClick={onBack}><Glyph name="back"/></button><h1>Live Chat Settings</h1></div></header><ErrorNotice error={error}/>{settings?<form onSubmit={e=>{e.preventDefault();setBusy(true);setError('');void client.request<ChatSettings>('/settings','PUT',settings).then(value=>{setSettings(value);setSaved(true)}).catch(e=>setError(errorText(e))).finally(()=>setBusy(false))}}>
    <section><h2>Chat availability</h2><label className="gw-chat-toggle"><input type="checkbox" checked={settings.enabled} onChange={e=>change({enabled:e.target.checked})}/>Enable live chat for this tenant</label><p>Players can leave a message while the team is offline.</p><label>Chat title<input value={settings.title} maxLength={80} required onChange={e=>change({title:e.target.value})}/></label><label>Welcome message<textarea value={settings.welcomeMessage} maxLength={1000} required onChange={e=>change({welcomeMessage:e.target.value})}/></label><label>Offline message<textarea value={settings.offlineMessage} maxLength={1000} required onChange={e=>change({offlineMessage:e.target.value})}/></label></section>
    <section><header><h2>Support hours</h2><button type="button" onClick={()=>change({openMinute:0,closeMinute:1440,days:[1,2,3,4,5,6,7]})}>Set 24/7</button></header><label>Timezone<input value={settings.timezone} required onChange={e=>change({timezone:e.target.value})}/></label><div className="gw-chat-time-fields"><label>Opens at<input type="time" value={time(settings.openMinute)} required onChange={e=>{const [h,m]=e.target.value.split(':').map(Number);change({openMinute:h*60+m})}}/></label><label>Closes at<input type="time" value={time(settings.closeMinute)} required onChange={e=>{const [h,m]=e.target.value.split(':').map(Number);change({closeMinute:h*60+m||1440})}}/></label></div><fieldset><legend>Working days</legend>{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((name,i)=><label key={name}><input type="checkbox" checked={settings.days.includes(i+1)} onChange={e=>change({days:e.target.checked?[...settings.days,i+1]:settings.days.filter(d=>d!==i+1)})}/>{name}</label>)}</fieldset><p>Availability also requires an eligible support staff member to be online.</p></section>
    <footer><button type="button" onClick={onBack}>Cancel</button>{saved&&<span role="status">Settings saved</span>}<button className="gw-chat-primary" type="submit" disabled={busy}>{busy?'Saving…':'Save settings'}</button></footer>
  </form>:!error&&<p role="status">Loading chat settings…</p>}</div>
}

export function PlayerChatWidget({client,authenticated,onLogin}:{client:SupportClient;authenticated:boolean;onLogin:()=>void}) {
  const [open,setOpen]=useState(false)
  const [desktop,setDesktop]=useState(()=>typeof window!=='undefined'&&Boolean(window.matchMedia?.('(min-width: 801px)').matches))
  const [selected,setSelected]=useState<string|null>(null)
  const [topic,setTopic]=useState('Account')
  const [publicSettings,setPublicSettings]=useState<ChatSettings|null>(null)
  const [error,setError]=useState('')
  const [starting,setStarting]=useState(false)
  const state=useLiveChat(client,authenticated)
  const dialog=useRef<HTMLDialogElement>(null)
  const launcher=useRef<HTMLButtonElement>(null)
  // A launcher outside the widget (the user panel's desktop rail) that opened the chat; focus goes back to it.
  const opener=useRef<HTMLElement|null>(null)
  const modalMode=useRef<boolean|null>(null)
  const returnFocus=useRef(true)
  const boot=state.bootstrap
  const {refresh,items}=state
  const dismiss=useCallback((restore=true)=>{returnFocus.current=restore;setOpen(false)},[])

  useEffect(()=>{
    const media=window.matchMedia('(min-width: 801px)')
    const changed=()=>setDesktop(media.matches)
    changed();media.addEventListener('change',changed)
    return()=>media.removeEventListener('change',changed)
  },[])
  useEffect(()=>{
    let active=true
    void client.publicStatus().then(data=>{if(active)setPublicSettings(data.settings)}).catch(()=>{})
    return()=>{active=false}
  },[client])
  const show=useCallback(()=>{
    if(!authenticated){onLogin();return}
    if(!selected){const current=items.find(c=>c.status!=='resolved');if(current)setSelected(current.id)}
    returnFocus.current=true
    window.dispatchEvent(new Event('support-chat:opening'))
    setOpen(true);void refresh()
  },[authenticated,onLogin,selected,items,refresh])
  useEffect(()=>{
    const close=()=>dismiss(false)
    const openFrom=(event:Event)=>{opener.current=(event as CustomEvent<{opener?:HTMLElement}|null>).detail?.opener??null;show()}
    window.addEventListener('support-chat:open',openFrom)
    window.addEventListener('support-chat:close',close)
    return()=>{window.removeEventListener('support-chat:open',openFrom);window.removeEventListener('support-chat:close',close)}
  },[show,dismiss])
  useEffect(()=>{if(!authenticated){dismiss(false);setSelected(null)}},[authenticated,dismiss])
  useEffect(()=>{
    const element=dialog.current,modal=!desktop
    if(!element)return
    if(open){
      // Crossing the rail breakpoint changes native dialog modality as well as placement.
      if(element.open&&modalMode.current!==modal)element.close()
      if(!element.open){if(modal)element.showModal();else element.show()}
      modalMode.current=modal
    }else if(element.open)element.close()
    if(!open||!modal)return
    const prior=document.body.style.overflow
    document.body.style.overflow='hidden'
    return()=>{document.body.style.overflow=prior}
  },[open,desktop])
  useEffect(()=>{
    if(!open||!desktop)return
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();dismiss()}}
    const outside=(event:PointerEvent)=>{
      const target=event.target as Node|null
      const element=target instanceof Element?target:target?.parentElement
      if(!target||dialog.current?.contains(target)||launcher.current?.contains(target)||element?.closest('[data-support-chat-launcher]'))return
      dismiss(false)
    }
    document.addEventListener('keydown',key)
    document.addEventListener('pointerdown',outside)
    return()=>{document.removeEventListener('keydown',key);document.removeEventListener('pointerdown',outside)}
  },[open,desktop,dismiss])
  const settings=boot?.settings||publicSettings
  const featureEnabled=settings?.enabled
  useEffect(()=>{if(featureEnabled===false)dismiss(false)},[featureEnabled,dismiss])
  const hidden=Boolean((settings&&!settings.enabled)||(!settings&&!state.error))
  const unread=boot?.unreadTotal||0
  // Outside launchers (launcherState.ts) follow whether chat is offered, its unread count and whether it is open.
  useEffect(()=>{setSupportLauncherState({available:!hidden,unread,open})},[hidden,unread,open])
  useEffect(()=>()=>setSupportLauncherState({available:false,unread:0,open:false}),[])
  if(hidden)return null

  return <div className="gw-support gw-support-widget">
    <button ref={launcher} className="gw-chat-launcher" aria-label="Open live chat" aria-haspopup="dialog" aria-expanded={open} onClick={()=>{opener.current=null;show()}}>
      {/* A filled bubble with two dots on a round brand button (owner 2026-11-02); the name stays for screen readers. */}
      <svg className="gw-chat-launcher-glyph" width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 4.5h11a3 3 0 0 1 3 3v7.5a3 3 0 0 1-3 3h-5.2L8 21.2v-3.2H6.5a3 3 0 0 1-3-3V7.5a3 3 0 0 1 3-3Z"/><circle cx="9.5" cy="11.3" r="1.35"/><circle cx="14.5" cy="11.3" r="1.35"/></svg>
      <span className="gw-chat-sr">Live Chat</span>{Boolean(boot?.unreadTotal)&&<b>{boot!.unreadTotal>99?'99+':boot!.unreadTotal}</b>}
    </button>
    <dialog ref={dialog} className="nova-panel nova-rail-panel gw-chat-dialog gw-support" data-ui-radius="square" aria-label="Live support chat" aria-modal={!desktop}
      onCancel={event=>{event.preventDefault();dismiss()}}
      onClose={event=>{if(!event.currentTarget.open){setOpen(false);if(returnFocus.current)(opener.current?.isConnected?opener.current:launcher.current)?.focus({preventScroll:true})}}}
      onClick={event=>{
        if(event.target!==event.currentTarget)return
        const box=event.currentTarget.getBoundingClientRect()
        if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)dismiss()
      }}>
      <header className="gw-widget-header">
        <span className="gw-widget-logo"><Glyph/></span>
        <div><strong>{settings?.title||'Live support'}</strong><span><i className={boot?.online?'online':''}/>{boot?.online?'Support is online':'Leave us a message'}</span></div>
        <button className="gw-chat-icon" aria-label="Close live chat" onClick={()=>dismiss()}><Glyph name="close"/></button>
      </header>
      <div className="gw-widget-connection">
        <span className={state.status==='Connected'?'is-connected':''}>{state.status==='Connected'?'Private conversation':state.status}</span>
        {selected?<button onClick={()=>setSelected(null)}>Chat history</button>:<span>Your support history</span>}
      </div>
      <ErrorNotice error={error||state.error} retry={()=>void refresh()}/>
      {selected&&boot?<ChatThread visible={open} key={selected} client={client} id={selected} bootstrap={boot} event={state.event} onChanged={refresh} onBack={()=>setSelected(null)}/>:<div className="gw-widget-home">
        <section className="gw-widget-start-section" aria-label="Start a support conversation">
          <div className="gw-widget-intro"><span><Glyph/></span><div><h2>How can we help?</h2><p>{boot?.online?settings?.welcomeMessage:settings?.offlineMessage||'Leave a message and our support team will reply here.'}</p></div></div>
          <label>Choose a topic<select aria-label="Chat topic" value={topic} onChange={event=>setTopic(event.target.value)}>{CHAT_TOPICS.map(value=><option key={value}>{value}</option>)}</select></label>
          <button className="gw-chat-primary gw-chat-start" disabled={starting||!boot} onClick={()=>{
            setStarting(true);setError('')
            void client.request<ChatConversation>('/conversations','POST',{topic}).then(async chat=>{setSelected(chat.id);await refresh()}).catch(e=>setError(errorText(e))).finally(()=>setStarting(false))
          }}><Glyph/>{starting?'Opening…':items.some(chat=>chat.status!=='resolved')?'Continue conversation':'Start conversation'}</button>
        </section>
        <section className="gw-widget-history-section" aria-label="Recent support conversations">
          <header><h3>Recent conversations</h3>{boot&&<span>{items.length}{state.cursor?'+':''}</span>}</header>
          {!boot&&!state.error&&<p className="gw-chat-placeholder" role="status">Loading support…</p>}
          {boot&&!items.length&&<div className="gw-widget-empty"><Glyph/><div><strong>No conversations yet</strong><p>Your support chats will appear here.</p></div></div>}
          {items.map(chat=><button key={chat.id} className="gw-chat-history" onClick={()=>setSelected(chat.id)}>
            <div><strong>{chat.topic}</strong><span className={'gw-chat-state '+chat.status}>{labelStatus(chat.status)}</span>{chat.unread>0&&<b className="gw-chat-unread">{chat.unread}</b>}</div>
            <p>{chat.preview||'New conversation'}</p><footer><time>{date(chat.updatedAt)}</time><span>View conversation &rarr;</span></footer>
          </button>)}
          {state.cursor&&<button className="gw-chat-older" onClick={()=>void state.more()}>Load more conversations</button>}
        </section>
      </div>}
      <footer className="gw-widget-footer">Private support &middot; Conversation history saved</footer>
    </dialog>
  </div>
}
