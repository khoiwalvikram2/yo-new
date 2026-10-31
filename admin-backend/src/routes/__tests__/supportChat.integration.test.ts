import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
import jwt from 'jsonwebtoken'
import WebSocket from 'ws'
import pg from 'pg'
import { isolateDatabase,fixture,types,t,eq } from '../../../../tmp/domain-visibility-integration-fixtures.js'
import { chatDefaults,SupportChatService } from '@shared/support/chatService.js'

const guard=isolateDatabase()
process.env.JWT_SECRET='isolated-live-chat-test-secret-not-a-production-key'
const {db,pool}=await import('../../db/client.js')
await guard(pool)
const {registerAdminSupportChat}=await import('../supportChat.js')
const {registerPlayerSupportChat}=await import('../../../../user-backend/src/routes/supportChat.js')
const userDb=await import('../../../../user-backend/src/db/client.js')
const admin=Fastify({logger:false,bodyLimit:8*1024*1024}),playerApp=Fastify({logger:false,bodyLimit:8*1024*1024})
admin.log.error=((value:any)=>console.error('Isolated support error:',value?.err?.message)) as any
await registerAdminSupportChat(admin,[]);await registerPlayerSupportChat(playerApp,[])
let f:any,b:any,owner:any,players:any[]=[],staff:any,supervisor:any,book:any,secondBook:any,moneyBefore:any
const allDay={...chatDefaults,enabled:true,days:[1,2,3,4,5,6,7],openMinute:0,closeMinute:1440}
const token=(user:any,tenant:string,crm=false)=>jwt.sign(crm?{sub:user.id,type:'crm',tenant,v:0}:{sub:String(user.id),userId:user.id,tenant,v:0,roles:['Whitelabel Admin']},process.env.JWT_SECRET!,{expiresIn:'10m'})
const headers=(who:any)=>({'authorization':'Bearer '+who.token,'x-whitelabel-id':who.tenant,'content-type':'application/json'})
const request=async(who:any,method:any,url:string,body?:unknown)=>{
  const response=await (who.kind==='player'?playerApp:admin).inject({method,url,headers:headers(who),...(body===undefined?{}:{payload:JSON.stringify(body)})})
  return {status:response.statusCode,body:response.headers['content-type']?.startsWith('application/json')?response.json():response.body,raw:response}
}
const okay=(response:any)=>{assert.equal(response.status,200,JSON.stringify(response.body));return response.body}
const post=(who:any,id:string,body:string,extra={})=>request(who,'POST',`/support/conversations/${id}/messages`,{clientMessageId:randomUUID(),body,...extra})
const start=async(who:any)=>okay(await request(who,'POST','/support/conversations',{topic:'Payments'}))
let conversations:any[]=[]

test.before(async()=>{
  await db.transaction(async tx=>{
    f=await fixture(tx);b=await fixture(tx)
    owner=await f.player();const [role]=await tx.insert(t.roles).values({tenant:f.tenant,name:'Whitelabel Admin',isWhitelabelAdmin:true}).returning()
    await tx.insert(t.userRoles).values({tenant:f.tenant,userId:owner.id,roleId:role.id})
    owner={...owner,kind:'admin',tenant:f.tenant,token:token(owner,f.tenant)}
    for(const type of types){const agent=type.includes('AGENT')?await f.agent(type==='AGENT_CREDIT'?'CREDIT':type.startsWith('SHARING')?'SHARING':'COMMISSION'):undefined;const p=await f.player(type,agent);players.push({...p,kind:'player',tenant:f.tenant,token:token(p,f.tenant)})}
    const foreign=await b.player();b.player={...foreign,kind:'player',tenant:b.tenant,token:token(foreign,b.tenant)}
    await tx.insert(t.crmWhitelabelSettings).values({tenant:f.tenant,enabled:true,seatLimit:10})
    ;[book]=await tx.insert(t.crmBooks).values({tenant:f.tenant,name:'Own book'}).returning()
    ;[secondBook]=await tx.insert(t.crmBooks).values({tenant:f.tenant,name:'Other book'}).returning()
    async function crm(name:string,all=false){
      const [user]=await tx.insert(t.crmUsers).values({tenant:f.tenant,name,requirePasswordReset:false}).returning()
      const [role]=await tx.insert(t.crmRoles).values({tenant:f.tenant,name}).returning()
      await tx.insert(t.crmRolePermissions).values([{roleId:role.id,domain:'crm.chat',action:'view'},{roleId:role.id,domain:'crm.chat',action:'reply'},...(all?[{roleId:role.id,domain:'crm.chat',action:'assign'},{roleId:role.id,domain:'crm.players',action:'view_all'}]:[])])
      await tx.insert(t.crmUserRoles).values({crmUserId:user.id,roleId:role.id})
      return {...user,kind:'crm',tenant:f.tenant,token:token(user,f.tenant,true)}
    }
    staff=await crm('Book operator');supervisor=await crm('Supervisor',true)
    await tx.insert(t.crmBookMembers).values({bookId:book.id,crmUserId:staff.id})
    await tx.insert(t.crmPlayerAssignments).values(players.map((p,i)=>({tenant:f.tenant,playerId:p.id,bookId:i<3?book.id:secondBook.id})))
  })
  okay(await request(owner,'PUT','/support/settings',allDay))
  await pool.query(`INSERT INTO support_chat_settings(tenant,enabled) VALUES($1,true)`,[b.tenant])
  moneyBefore=(await pool.query('SELECT user_id,cash,bonus,exposure FROM wallets WHERE tenant=ANY($1::text[]) ORDER BY user_id',[[f.tenant,b.tenant]])).rows
})
test.after(async()=>{
  await admin.close();await playerApp.close()
  const after=(await pool.query('SELECT user_id,cash,bonus,exposure FROM wallets WHERE tenant=ANY($1::text[]) ORDER BY user_id',[[f.tenant,b.tenant]])).rows
  assert.deepEqual(after,moneyBefore,'Chat must not change any wallet')
  for(const tenant of [f.tenant,b.tenant]) {
    await pool.query('DELETE FROM support_conversations WHERE tenant=$1',[tenant]);await pool.query('DELETE FROM support_presence WHERE tenant=$1',[tenant]);await pool.query('DELETE FROM support_chat_settings WHERE tenant=$1',[tenant])
    await pool.query('DELETE FROM crm_player_assignments WHERE tenant=$1',[tenant]);await pool.query('DELETE FROM crm_users WHERE tenant=$1',[tenant]);await pool.query('DELETE FROM crm_books WHERE tenant=$1',[tenant]);await pool.query('DELETE FROM crm_roles WHERE tenant=$1',[tenant]);await pool.query('DELETE FROM crm_whitelabel_settings WHERE tenant=$1',[tenant])
    await pool.query('DELETE FROM user_roles WHERE tenant=$1',[tenant]);await pool.query('DELETE FROM role_permissions WHERE tenant=$1',[tenant]);await pool.query('DELETE FROM roles WHERE tenant=$1',[tenant]);await pool.query('DELETE FROM wallets WHERE tenant=$1',[tenant]);await pool.query('DELETE FROM users WHERE tenant=$1',[tenant]);await pool.query('DELETE FROM agent_hierarchy_closure WHERE ancestor_id IN(SELECT id FROM agents WHERE tenant_id=$1)',[tenant]);await pool.query('DELETE FROM agents WHERE tenant_id=$1',[tenant]);await db.delete(t.appConfigs).where(eq(t.appConfigs.whitelabelId,tenant));await pool.query('DELETE FROM whitelabels WHERE id=$1',[tenant])
  }
  await userDb.pool.end();await pool.end()
})

test('unsigned support requests and staff tokens replayed on the player API are refused',async()=>{
  assert.equal((await playerApp.inject({url:'/support/bootstrap'})).statusCode,401)
  assert.equal((await request(owner,'GET','/support/bootstrap')).status,200)
  assert.equal((await playerApp.inject({url:'/support/bootstrap',headers:headers(owner)})).statusCode,401)
})
for(const [index,type] of types.entries())test(`${type}: one active chat, persisted text, unread count and seen cursor`,async()=>{
  const p=players[index]
  const chats=await Promise.all([start(p),start(p)])
  assert.equal(chats[0].id,chats[1].id)
  const chat=chats[0];conversations[index]=chat
  const sent=okay(await post(p,chat.id,'Help with my account <script>literal text</script>'))
  assert.match(sent.body,/<script>/)
  let inbox=okay(await request(owner,'GET','/support/conversations'))
  assert.equal(inbox.items.find((c:any)=>c.id===chat.id).unread,1)
  okay(await request(owner,'POST',`/support/conversations/${chat.id}/receipt`,{seq:sent.seq,read:true}))
  inbox=okay(await request(owner,'GET','/support/conversations'))
  assert.equal(inbox.items.find((c:any)=>c.id===chat.id).unread,0)
  const reply=okay(await post(owner,chat.id,'We are checking this for you.'))
  const history=okay(await request(p,'GET',`/support/conversations/${chat.id}/messages`))
  assert.equal(history.conversation.status,'assigned');assert.equal(history.conversation.assignedId,String(owner.id))
  assert.equal(history.items.at(-1).id,reply.id)
  okay(await request(p,'POST',`/support/conversations/${chat.id}/receipt`,{seq:reply.seq,read:false}))
  let state=okay(await request(owner,'GET',`/support/conversations/${chat.id}/messages`)).conversation
  assert.equal(state.playerDeliveredSeq,reply.seq);assert.notEqual(state.playerReadSeq,reply.seq)
  okay(await request(p,'POST',`/support/conversations/${chat.id}/receipt`,{seq:reply.seq,read:true}))
  state=okay(await request(owner,'GET',`/support/conversations/${chat.id}/messages`)).conversation
  assert.equal(state.playerReadSeq,reply.seq)
})
test('concurrent retries persist one message, and reusing its ID for different text is rejected',async()=>{
  const body={clientMessageId:randomUUID(),body:'Retry-safe message'}
  const results=await Promise.all(Array.from({length:6},()=>request(players[0],'POST',`/support/conversations/${conversations[0].id}/messages`,body)))
  const ids=results.map(r=>okay(r).id);assert.equal(new Set(ids).size,1)
  assert.equal((await request(players[0],'POST',`/support/conversations/${conversations[0].id}/messages`,{...body,body:'Different'})).status,409)
})
test('another player, another tenant and a CRM operator outside the player book cannot read a thread',async()=>{
  const id=conversations[0].id
  assert.equal((await request(players[1],'GET',`/support/conversations/${id}/messages`)).status,404)
  assert.equal((await request(b.player,'GET',`/support/conversations/${id}/messages`)).status,404)
  assert.equal((await request(staff,'GET',`/support/conversations/${conversations[4].id}/messages`)).status,404)
  const own=okay(await request(staff,'GET','/support/conversations'))
  assert.equal(own.items.length,3)
  assert.equal(okay(await request(supervisor,'GET','/support/conversations')).items.length,5)
})
test('screenshots use private authorized retrieval and reject cross-message uploads and active content',async()=>{
  const id=conversations[0].id,p=players[0]
  const base64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII='
  const file=okay(await request(p,'POST',`/support/conversations/${id}/attachments`,{filename:'proof.png',base64}))
  assert.equal((await request(players[1],'GET',`/support/attachments/${file.id}`)).status,404)
  assert.equal((await request(owner,'GET',`/support/attachments/${file.id}`)).status,404,'Unsent upload stays private to its sender')
  okay(await post(p,id,'Screenshot attached',{attachmentIds:[file.id]}))
  const download=await request(owner,'GET',`/support/attachments/${file.id}`)
  assert.equal(download.status,200);assert.equal(download.raw.headers['content-type'],'image/png')
  assert.equal(download.raw.headers['cache-control'],'private, no-store')
  assert.equal((await request(staff,'GET',`/support/attachments/${file.id}`)).status,200)
  assert.equal((await post(p,id,'Attempt to reuse',{attachmentIds:[file.id]})).status,400)
  assert.equal((await request(p,'POST',`/support/conversations/${id}/attachments`,{filename:'x.png',base64:Buffer.from('<svg onload="alert(1)"/>').toString('base64')})).status,400)
})
test('staff availability respects working hours and offline messages still enter the queue',async()=>{
  assert.equal(okay(await request(players[0],'GET','/support/bootstrap')).online,false)
  okay(await request(owner,'POST','/support/presence',{available:true}))
  assert.equal(okay(await request(players[0],'GET','/support/bootstrap')).online,true)
  await pool.query("UPDATE support_presence SET last_seen_at=now()-interval '2 minutes' WHERE tenant=$1",[f.tenant])
  assert.equal(okay(await request(players[0],'GET','/support/bootstrap')).online,false)
  assert.equal((await post(players[0],conversations[0].id,'Offline request')).status,200)
})
test('transfer verifies target permission/book access; only assigned staff or supervisors can reply',async()=>{
  okay(await request(staff,'POST','/support/presence',{available:true}))
  const eligible=okay(await request(owner,'GET',`/support/conversations/${conversations[0].id}/staff`)).items
  assert.ok(eligible.some((s:any)=>s.id===staff.id))
  const transfer=()=>request(owner,'POST',`/support/conversations/${conversations[0].id}/action`,{action:'transfer',staffKind:'crm',staffId:staff.id})
  okay(await transfer())
  okay(await post(staff,conversations[0].id,'Assigned operator reply'))
  assert.equal((await post(staff,conversations[1].id,'Unassigned operator reply')).status,403)
  assert.equal((await request(owner,'POST',`/support/conversations/${conversations[4].id}/action`,{action:'transfer',staffKind:'crm',staffId:staff.id})).status,400)
})
test('resolve blocks further sends, a new chat is created and conflicting reopen is refused',async()=>{
  const id=conversations[0].id
  okay(await request(owner,'POST',`/support/conversations/${id}/action`,{action:'resolve'}))
  assert.equal((await post(players[0],id,'Late new message')).status,409)
  const next=await start(players[0]);assert.notEqual(next.id,id)
  assert.equal((await request(owner,'POST',`/support/conversations/${id}/action`,{action:'reopen'})).status,409)
})
test('revoked book access, inactive staff, disabled CRM and expired tokens are enforced on every request',async()=>{
  await pool.query('UPDATE crm_users SET status=$1 WHERE id=$2',['INACTIVE',staff.id])
  assert.equal((await request(staff,'GET','/support/conversations')).status,200)
  assert.equal((await post(staff,conversations[1].id,'No write')).status,403)
  assert.equal((await request(staff,'POST','/support/presence',{available:true})).status,403)
  await pool.query("UPDATE crm_users SET status='ACTIVE' WHERE id=$1",[staff.id])
  await pool.query('DELETE FROM crm_book_members WHERE crm_user_id=$1',[staff.id])
  assert.equal(okay(await request(staff,'GET','/support/conversations')).items.length,0)
  await pool.query('UPDATE crm_whitelabel_settings SET enabled=false WHERE tenant=$1',[f.tenant])
  assert.equal((await request(staff,'GET','/support/bootstrap')).status,401)
  await pool.query('UPDATE crm_whitelabel_settings SET enabled=true WHERE tenant=$1',[f.tenant])
  const expired={...players[0],token:jwt.sign({sub:String(players[0].id),tenant:f.tenant,v:0},process.env.JWT_SECRET!,{expiresIn:-1})}
  assert.equal((await request(expired,'GET','/support/bootstrap')).status,401)
})
test('message pagination is stable, forged read cursors fail and disabling chat preserves existing history',async()=>{
  const id=conversations[2].id,p=players[2]
  for(let i=0;i<55;i++)await pool.query(`INSERT INTO support_messages(conversation_id,tenant,sender_kind,sender_id,sender_name,client_message_id,body,created_at) VALUES($1,$2,'player',$3,'Fixture',$4,$5,now()-interval '2 minutes')`,[id,f.tenant,String(p.id),randomUUID(),'History '+i])
  await pool.query('UPDATE support_conversations SET last_seq=(SELECT max(seq) FROM support_messages WHERE conversation_id=$1) WHERE id=$1',[id])
  const latest=okay(await request(p,'GET',`/support/conversations/${id}/messages`));assert.equal(latest.items.length,50);assert.ok(latest.before)
  const older=okay(await request(p,'GET',`/support/conversations/${id}/messages?before=${latest.before}`))
  assert.equal(older.items.length,7);assert.equal(new Set([...older.items,...latest.items].map((m:any)=>m.seq)).size,57)
  assert.equal((await request(p,'POST',`/support/conversations/${id}/receipt`,{seq:'9223372036854775807',read:true})).status,400)
  okay(await request(owner,'PUT','/support/settings',{...allDay,enabled:false}))
  assert.equal((await post(p,id,'Disabled message')).status,409)
  assert.equal((await request(p,'GET',`/support/conversations/${id}/messages`)).status,200)
  okay(await request(owner,'PUT','/support/settings',allDay))
})
test('real player socket receives persisted staff replies across the two backend Redis connections',async()=>{
  await playerApp.listen({port:0,host:'127.0.0.1'})
  const address=playerApp.server.address() as any
  const socket=new WebSocket(`ws://127.0.0.1:${address.port}/support/live`)
  const events:any[]=[],waiters=new Set<()=>void>()
  socket.on('message',raw=>{events.push(JSON.parse(raw.toString()));for(const notify of waiters)notify()})
  const wait=(predicate:(e:any)=>boolean)=>new Promise<any>((resolve,reject)=>{
    const timer=setTimeout(()=>{waiters.delete(check);reject(new Error('Support socket event timed out'))},5000)
    const check=()=>{const event=events.find(predicate);if(event){clearTimeout(timer);waiters.delete(check);resolve(event)}};waiters.add(check);check()
  })
  try {
    await new Promise<void>(resolve=>socket.once('open',()=>resolve()))
    socket.send(JSON.stringify({type:'auth',headers:headers(players[1])}));await wait(e=>e.type==='ready')
    const reply=okay(await post(owner,conversations[1].id,'Realtime staff reply'))
    await wait(e=>e.type==='changed'&&e.conversationId===conversations[1].id)
    const history=okay(await request(players[1],'GET',`/support/conversations/${conversations[1].id}/messages`))
    assert.ok(history.items.some((m:any)=>m.id===reply.id))
  }finally{socket.terminate()}
})

test('WebSocket rejects unauthenticated frames, wrong tenants and disallowed browser origins',async()=>{
  const address=playerApp.server.address() as any
  for(const mode of ['unsigned','malformed','tenant','origin']){
    const socket=new WebSocket(`ws://127.0.0.1:${address.port}/support/live`,mode==='origin'?{origin:'https://untrusted.invalid'}:{})
    const ended=new Promise<number>((resolve,reject)=>{const timer=setTimeout(()=>{socket.terminate();reject(new Error('Security close timeout'))},3000);socket.once('close',code=>{clearTimeout(timer);resolve(code)})})
    socket.once('open',()=>{if(mode==='origin')return;socket.send(mode==='malformed'?'{':JSON.stringify(mode==='unsigned'?{type:'ping'}:{type:'auth',headers:{...headers(players[1]),'x-whitelabel-id':b.tenant}}))})
    assert.equal(await ended,1008,mode)
  }
})

test('CRM cannot edit tenant settings, and oversized screenshots are rejected before persistence',async()=>{
  assert.equal((await request(supervisor,'PUT','/support/settings',allDay)).status,403)
  const buffer=Buffer.alloc(2*1024*1024+1);Buffer.from([137,80,78,71,13,10,26,10]).copy(buffer)
  const count=(await pool.query('SELECT count(*)::int n FROM support_attachments WHERE tenant=$1',[f.tenant])).rows[0].n
  assert.equal((await request(players[1],'POST',`/support/conversations/${conversations[1].id}/attachments`,{filename:'large.png',base64:buffer.toString('base64')})).status,400)
  assert.equal((await pool.query('SELECT count(*)::int n FROM support_attachments WHERE tenant=$1',[f.tenant])).rows[0].n,count)
})

test('staff in password reset cannot appear available or receive a transfer',async()=>{
  okay(await request(owner,'POST','/support/presence',{available:true}))
  await pool.query('UPDATE users SET require_password_reset=true WHERE id=$1',[owner.id])
  try{
    const eligible=okay(await request(supervisor,'GET',`/support/conversations/${conversations[1].id}/staff`)).items
    assert.ok(!eligible.some((s:any)=>s.kind==='admin'&&s.id===String(owner.id)))
    assert.equal((await request(owner,'GET','/support/bootstrap')).status,403)
  }finally{await pool.query('UPDATE users SET require_password_reset=false WHERE id=$1',[owner.id])}
})

test('message rate limit is sender-wide and a rejected request does not persist a message',async()=>{
  const p=players[4],id=conversations[4].id
  for(let i=0;i<30;i++)await pool.query(`INSERT INTO support_messages(conversation_id,tenant,sender_kind,sender_id,sender_name,client_message_id,body) VALUES($1,$2,'player',$3,'Fixture',$4,'Rate fixture')`,[id,f.tenant,String(p.id),randomUUID()])
  const before=(await pool.query('SELECT count(*)::int n FROM support_messages WHERE conversation_id=$1',[id])).rows[0].n
  assert.equal((await post(p,id,'Beyond rate limit')).status,429)
  assert.equal((await pool.query('SELECT count(*)::int n FROM support_messages WHERE conversation_id=$1',[id])).rows[0].n,before)
})

test('transferring a conversation uses its transaction connection even with a one-connection pool',async()=>{
  okay(await request(supervisor,'POST','/support/presence',{available:true}))
  const actor=okay(await request(owner,'GET','/support/bootstrap')).actor
  const single=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:500})
  try{
    const service=new SupportChatService(single)
    const result=await service.update(actor,conversations[1].id,{action:'transfer',staffKind:'crm',staffId:supervisor.id})
    assert.equal(result.assignedId,supervisor.id)
  }finally{await single.end()}
})
