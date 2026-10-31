import type { ChatConversation,ChatMessage } from '../../shared/src/support/contracts'
export type ChatEvent={type:'ready'|'changed'|'typing'|'status';conversationId?:string;senderKind?:string;typing?:boolean;event?:string;conversation?:ChatConversation;unreadTotal?:number;message?:ChatMessage}
export type SupportClient=ReturnType<typeof createSupportClient>
export function supportEndpoint(graphql:string):string {
  const url=new URL(graphql,window.location.origin)
  url.pathname=url.pathname.replace(/\/graphql\/?$/,'')+'/support';url.search='';url.hash=''
  return url.toString().replace(/\/$/,'')
}
export function createSupportClient(base:string,getHeaders:()=>Record<string,string>,onUnauthorized?:()=>void) {
  base=new URL(base,window.location.origin).toString().replace(/\/$/,'')
  let socket:WebSocket|null=null
  async function response(path:string,method='GET',body?:unknown,publicRequest=false) {
    const headers=getHeaders()
    const result=await fetch(base+path,{method,headers:{...(publicRequest?Object.fromEntries(Object.entries(headers).filter(([key])=>['x-tenant','x-whitelabel-id','x-whitelabel'].includes(key.toLowerCase()))):headers),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(15000)})
    if(!result.ok){if(result.status===401)onUnauthorized?.();const data=await result.json().catch(()=>null);throw Object.assign(new Error(data?.error||'Support could not load. Please try again.'),{status:result.status})}
    return result
  }
  async function request<T>(path:string,method='GET',body?:unknown):Promise<T>{return (await response(path,method,body)).json()}
  function connect(onEvent:(event:ChatEvent)=>void,onStatus:(status:string)=>void) {
    let stopped=false,retry:ReturnType<typeof setTimeout>|undefined,ping:ReturnType<typeof setInterval>|undefined,attempt=0
    const open=()=>{
      if(stopped)return
      onStatus('Connecting')
      try {
        const url=new URL(base+'/live');url.protocol=url.protocol==='https:'?'wss:':'ws:'
        const current=new WebSocket(url);socket=current
        current.onopen=()=>{try{current.send(JSON.stringify({type:'auth',headers:getHeaders()}))}catch{current.close()}}
        current.onmessage=event=>{
          let data:ChatEvent;try{data=JSON.parse(event.data)}catch{return}
          if(data.type==='ready'){attempt=0;onStatus('Connected');ping=setInterval(()=>{if(current.readyState===1)current.send(JSON.stringify({type:'ping'}))},20000)}
          if(['ready','changed','typing','status'].includes(data.type))onEvent(data)
        }
        current.onerror=()=>current.close()
        current.onclose=()=>{if(ping)clearInterval(ping);if(socket===current)socket=null;if(!stopped){onStatus('Reconnecting');retry=setTimeout(open,Math.min(15000,1000*2**Math.min(attempt++,4)))}}
      }catch{onStatus('Reconnecting');retry=setTimeout(open,5000)}
    }
    open()
    return ()=>{stopped=true;if(retry)clearTimeout(retry);if(ping)clearInterval(ping);socket?.close();socket=null}
  }
  return {base,request,publicStatus:async()=> (await response('/public','GET',undefined,true)).json(),image:async(id:string)=> (await response('/attachments/'+encodeURIComponent(id))).blob(),connect,
    typing:(conversationId:string,typing:boolean)=>{if(socket?.readyState===1)socket.send(JSON.stringify({type:'typing',conversationId,typing}))}}
}
