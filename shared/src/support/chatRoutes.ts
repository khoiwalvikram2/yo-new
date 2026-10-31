import type { FastifyInstance } from 'fastify'
import websocket from '@fastify/websocket'
import mqemitter from 'mqemitter-redis'
import { z } from 'zod'
import type { Pool } from 'pg'
import type { SupportActor } from './contracts.js'
import { SupportChatService, ChatError, uuid, withinDeskHours } from './chatService.js'

export type ChatAuth=(request:any)=>Promise<SupportActor>
const topics=(tenant:string,playerId:string)=>[`SUPPORT_PLAYER:${tenant}:${playerId}`,`SUPPORT_STAFF:${tenant}`]
export async function registerSupportChat(app:FastifyInstance,options:{pool:Pool;authenticate:ChatAuth;publicTenant?:(request:any)=>Promise<string>;origins:string[]}) {
  const emitter:any=mqemitter({connectionString:process.env.REDIS_URL||'redis://localhost:6379',maxRetriesPerRequest:1,enableOfflineQueue:false})
  emitter.state.on('error',(error:Error)=>app.log.warn({message:error.message},'Support realtime connection unavailable'))
  const publish=async(tenant:string,playerId:string,payload:unknown)=>{
    await Promise.all(topics(tenant,playerId).map(topic=>new Promise<void>(resolve=>{
      const timer=setTimeout(resolve,500);timer.unref?.()
      emitter.emit({topic,payload},()=>{clearTimeout(timer);resolve()})
    })))
  }
  const service=new SupportChatService(options.pool,(tenant,player,id,event,message)=>publish(tenant,player,{type:'changed',conversationId:id,event,...(message?{message}:{})}))
  const statusChanged=(tenant:string)=>new Promise<void>(resolve=>{const timer=setTimeout(resolve,500);timer.unref?.();emitter.emit({topic:`SUPPORT_STATUS:${tenant}`,payload:{type:'status'}},()=>{clearTimeout(timer);resolve()})})
  const handler=(fn:(actor:SupportActor,request:any,reply:any)=>Promise<unknown>)=>async(request:any,reply:any)=>{
    try{return await fn(await options.authenticate(request),request,reply)}
    catch(error:any){
      const status=error instanceof ChatError?error.status:error instanceof z.ZodError?400:/unauthor|sign.in|expired/i.test(error?.message)?401:/Forbidden|permission|inactive|access denied/i.test(error?.message)?403:500
      if(status===500)app.log.error({err:error},'Support request failed')
      return reply.code(status).send({error:status===500?'Support is temporarily unavailable. Please retry.':error instanceof z.ZodError?'Check the message or uploaded screenshot.':error.message})
    }
  }
  if(options.publicTenant)app.get('/support/public',async(request,reply)=>{
    try{const settings=await service.settings(await options.publicTenant!(request));return {settings,withinHours:withinDeskHours(settings)}}
    catch{return reply.code(503).send({error:'Support is temporarily unavailable'})}
  })
  app.get('/support/bootstrap',handler(actor=>service.bootstrap(actor)))
  app.get('/support/conversations',handler((actor,request)=>service.list(actor,z.object({status:z.string().max(16).optional(),search:z.string().max(120).optional(),cursor:z.string().max(256).optional()}).parse(request.query))))
  app.post('/support/conversations',handler((actor,request)=>service.start(actor,request.body?.topic)))
  app.get('/support/conversations/:id/messages',handler((actor,request)=>service.messages(actor,uuid(request.params.id),request.query?.before)))
  app.post('/support/conversations/:id/messages',handler((actor,request)=>service.send(actor,uuid(request.params.id),request.body)))
  app.post('/support/conversations/:id/receipt',handler((actor,request)=>service.receipt(actor,uuid(request.params.id),request.body)))
  app.post('/support/conversations/:id/attachments',{bodyLimit:3*1024*1024},handler((actor,request)=>service.upload(actor,uuid(request.params.id),request.body)))
  app.get('/support/attachments/:id',handler(async(actor,request,reply)=>{
    const file=await service.attachment(actor,uuid(request.params.id))
    return reply.header('Content-Type',file.mime).header('Content-Disposition',`inline; filename="${file.filename.replace(/["\\]/g,'_')}"`).header('Cache-Control','private, no-store').header('X-Content-Type-Options','nosniff').send(file.data)
  }))
  app.post('/support/conversations/:id/action',handler((actor,request)=>service.update(actor,uuid(request.params.id),request.body)))
  app.get('/support/conversations/:id/staff',handler(async(actor,request)=>{
    if(actor.kind==='player'||!actor.canAssign)throw new ChatError(403,'Assignment permission is required')
    return {items:await service.staff(actor,uuid(request.params.id))}
  }))
  app.put('/support/settings',handler(async(actor,request)=>{const settings=await service.saveSettings(actor,request.body);await statusChanged(actor.tenant);return settings}))
  app.post('/support/presence',handler(async(actor,request)=>{const presence=await service.presence(actor,request.body?.available);if(presence.changed)await statusChanged(actor.tenant);return presence}))
  if(!(app as any).websocketServer)await app.register(websocket,{options:{maxPayload:1048576}})
  const sockets=new Set<any>()
  app.get('/support/live',{websocket:true},(socket:any,request:any)=>{
    sockets.add(socket)
    let actor:SupportActor|undefined,authHeaders:Record<string,string>|undefined,listener:any,topic:string|undefined,statusTopic:string|undefined,lastTyping=0,closed=false,chain=Promise.resolve(),lastPing=Date.now(),windowStart=Date.now(),frames=0,queuedFrames=0,queuedEvents=0
    const origin=String(request.headers.origin||'').replace(/\/$/,'')
    if(origin&&!options.origins.includes(origin)){sockets.delete(socket);socket.close(1008,'Origin not allowed');return}
    const send=(value:unknown)=>{if(!closed&&socket.readyState===1)socket.send(JSON.stringify(value))}
    const authenticate=()=>options.authenticate({...request,ip:request.ip,raw:request.raw,headers:{...request.headers,...authHeaders}})
    const authTimer=setTimeout(()=>{if(!actor)socket.close(1008,'Authentication required')},5000)
    const heartbeat=setInterval(()=>{if(Date.now()-lastPing>70000)socket.close(1001,'Connection timed out')},20000)
    socket.on('close',()=>{closed=true;clearTimeout(authTimer);clearInterval(heartbeat);if(listener&&topic)emitter.removeListener(topic,listener);if(listener&&statusTopic)emitter.removeListener(statusTopic,listener);sockets.delete(socket)})
    socket.on('error',()=>socket.close())
    socket.on('message',(raw:any,isBinary:boolean)=>{
      if(Date.now()-windowStart>10000){windowStart=Date.now();frames=0}
      if(++frames>30||queuedFrames>=10){socket.close(1008,'Too many chat events');return}
      queuedFrames++
      chain=chain.then(async()=>{
        if(closed)return
        if(isBinary||raw.length>8192){socket.close(1009,'Message too large');return}
        let data:any;try{data=JSON.parse(raw.toString())}catch{socket.close(1008,'Invalid message');return}
        if(!actor){
          if(data.type!=='auth'){socket.close(1008,'Authentication required');return}
          const supplied=z.record(z.string(),z.string().max(6000)).parse(data.headers)
          authHeaders={};for(const key of ['authorization','x-whitelabel-id','x-whitelabel','x-tenant','x-admin-mode','x-client-type'])if(supplied[key])authHeaders[key]=supplied[key]
          actor=await authenticate();clearTimeout(authTimer)
          topic=actor.kind==='player'?topics(actor.tenant,actor.id)[0]:topics(actor.tenant,'')[1]
          statusTopic=`SUPPORT_STATUS:${actor.tenant}`
          listener=(event:any,done:()=>void)=>{
            done()
            if(closed)return
            if(queuedEvents>=100){socket.close(1013,'Reconnect to refresh support');return}
            queuedEvents++
            chain=chain.then(async()=>{
              if(closed)return
              try{
                const fresh=await authenticate()
                if(fresh.tenant!==actor!.tenant||fresh.kind!==actor!.kind||fresh.id!==actor!.id){socket.close(1008,'Session changed');return}
                if(event.payload.type==='status'){send({type:'status'});return}
                const snapshot=await service.snapshot(fresh,uuid(event.payload.conversationId))
                send({...event.payload,...(event.payload.type==='changed'?snapshot:{})})
              }catch(error){if(!(error instanceof ChatError&&error.status===404))socket.close(1008,'Session ended')}
            }).catch(()=>socket.close(1008,'Session ended')).finally(()=>{queuedEvents--})
          }
          await Promise.all([topic,statusTopic].map(value=>new Promise<void>(resolve=>emitter.on(value,listener,resolve))));send({type:'ready'});return
        }
        if(data.type==='ping'){actor=await authenticate();lastPing=Date.now();send({type:'pong'});return}
        if(data.type==='typing'&&Date.now()-lastTyping>750){
          lastTyping=Date.now();actor=await authenticate()
          const chat=await service.typing(actor,uuid(data.conversationId))
          await publish(actor.tenant,String(chat.player_id),{type:'typing',conversationId:chat.id,senderKind:actor.kind,typing:data.typing===true})
        }
      }).catch(()=>socket.close(1008,'Session ended')).finally(()=>{queuedFrames--})
    })
  })
  app.addHook('onClose',async()=>{
    for(const socket of sockets)socket.terminate()
    await new Promise<void>(resolve=>{
      const timer=setTimeout(()=>{emitter.pubConn.disconnect();emitter.subConn.disconnect();resolve()},1500);timer.unref?.()
      emitter.close(()=>{clearTimeout(timer);resolve()})
    })
  })
  return service
}
