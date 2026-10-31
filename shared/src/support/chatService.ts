import type { Pool, PoolClient } from 'pg'
import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import { z } from 'zod'
import type { SupportActor, ChatSettings, ChatConversation, ChatMessage, ChatAttachment, ChatStaff } from './contracts.js'
import { CHAT_TOPICS } from './contracts.js'

type Executor=Pick<Pool,'query'>
type Row=Record<string,any>
export class ChatError extends Error { constructor(public status:number,message:string){super(message)} }
export const chatDefaults:ChatSettings={enabled:false,title:'Live support',welcomeMessage:'Hello! How can we help you today?',offlineMessage:'Our team is away. Leave a message and we will reply here.',timezone:'Asia/Kolkata',openMinute:540,closeMinute:1260,days:[1,2,3,4,5,6]}
export const settingsSchema=z.object({enabled:z.boolean(),title:z.string().trim().min(1).max(80),welcomeMessage:z.string().trim().min(1).max(1000),offlineMessage:z.string().trim().min(1).max(1000),timezone:z.string().max(64).refine(zone=>DateTime.now().setZone(zone).isValid,'Invalid timezone'),openMinute:z.number().int().min(0).max(1439),closeMinute:z.number().int().min(1).max(1440),days:z.array(z.number().int().min(1).max(7)).min(1).max(7)}).refine(s=>s.openMinute!==s.closeMinute,'Open and close times must differ')
export const sendSchema=z.object({clientMessageId:z.string().uuid(),body:z.string().trim().max(4000).default(''),attachmentIds:z.array(z.string().uuid()).max(3).default([])}).refine(v=>Boolean(v.body)||v.attachmentIds.length>0,'Write a message or attach a screenshot')
export const uuid=(value:unknown)=>z.string().uuid().parse(value)
export const seq=(value:unknown)=>z.string().regex(/^\d{1,19}$/).refine(v=>BigInt(v)<=9223372036854775807n).parse(value)
const iso=(value:any)=>new Date(value).toISOString()

export function withinDeskHours(settings:ChatSettings,date=new Date()):boolean {
  const local=DateTime.fromJSDate(date,{zone:settings.timezone})
  if(!local.isValid)return false
  const minute=local.hour*60+local.minute
  if(settings.openMinute<settings.closeMinute)return settings.days.includes(local.weekday)&&minute>=settings.openMinute&&minute<settings.closeMinute
  return (minute>=settings.openMinute&&settings.days.includes(local.weekday))||(minute<settings.closeMinute&&settings.days.includes(local.minus({days:1}).weekday))
}

function access(actor:SupportActor,values:unknown[],alias='c'):string {
  values.push(actor.tenant)
  let where=`${alias}.tenant=$${values.length}`
  if(actor.kind==='player') {values.push(Number(actor.id));where+=` AND ${alias}.player_id=$${values.length}`}
  else if(actor.kind==='crm'&&!actor.viewAll) {
    values.push(actor.bookIds)
    where+=` AND EXISTS(SELECT 1 FROM crm_player_assignments a WHERE a.tenant=${alias}.tenant AND a.player_id=${alias}.player_id AND a.book_id=ANY($${values.length}::uuid[]))`
  }
  return where
}
function conversation(row:Row):ChatConversation {
  return {id:row.id,playerId:String(row.player_id),playerName:row.player_name,playerType:row.player_type,topic:row.topic,status:row.status,assignedKind:row.assigned_kind,assignedId:row.assigned_id,assignedName:row.assigned_name,lastSeq:String(row.last_seq),playerReadSeq:String(row.player_read_seq),staffReadSeq:String(row.staff_read_seq),playerDeliveredSeq:String(row.player_delivered_seq),staffDeliveredSeq:String(row.staff_delivered_seq),preview:row.last_message_preview,updatedAt:iso(row.last_message_at),unread:Number(row.unread??0)}
}
function message(row:Row):ChatMessage {return {id:row.id,seq:String(row.seq),body:row.body,senderKind:row.sender_kind,senderId:row.sender_id,senderName:row.sender_name,createdAt:iso(row.created_at),attachments:row.attachments??[]}}

export class SupportChatService {
  constructor(readonly pool:Pool,private readonly changed:(tenant:string,playerId:string,conversationId:string,event:string,message?:ChatMessage)=>Promise<void>=async()=>{}){}
  private async transaction<T>(fn:(client:PoolClient)=>Promise<T>):Promise<T> {
    const client=await this.pool.connect()
    try {await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result}
    catch(error:any){await client.query('ROLLBACK');if(error?.code==='23505'&&error?.constraint==='support_one_open_player')throw new ChatError(409,'This player already has an open conversation');throw error}finally{client.release()}
  }
  private write(actor:SupportActor){if(actor.readOnly)throw new ChatError(403,'This account has read-only support access')}
  private reply(actor:SupportActor,chat:Row){this.write(actor);if(actor.kind!=='player'&&!actor.canReply)throw new ChatError(403,'Reply permission is required');if(chat.status==='resolved')throw new ChatError(409,'This conversation is resolved. Start a new chat or reopen it.');if(actor.kind!=='player'&&chat.assigned_id&&(chat.assigned_id!==actor.id||chat.assigned_kind!==actor.kind)&&!actor.canAssign)throw new ChatError(403,'This conversation is assigned to another staff member')}
  private async notify(chat:Row,event='message',saved?:ChatMessage){try{await this.changed(chat.tenant,String(chat.player_id),chat.id,event,saved)}catch{/* Saved messages remain available if realtime delivery is interrupted. */}}
  async settings(tenant:string,executor:Executor=this.pool):Promise<ChatSettings>{
    const {rows}=await executor.query('SELECT * FROM support_chat_settings WHERE tenant=$1',[tenant])
    if(!rows[0])return {...chatDefaults,days:[...chatDefaults.days]}
    const r=rows[0];return {enabled:r.enabled,title:r.title,welcomeMessage:r.welcome_message,offlineMessage:r.offline_message,timezone:r.timezone,openMinute:r.open_minute,closeMinute:r.close_minute,days:r.days}
  }
  async saveSettings(actor:SupportActor,input:unknown){
    this.write(actor);if(actor.kind!=='admin'||!actor.canSettings)throw new ChatError(403,'Support settings permission is required')
    const s=settingsSchema.parse(input)
    await this.pool.query(`INSERT INTO support_chat_settings(tenant,enabled,title,welcome_message,offline_message,timezone,open_minute,close_minute,days) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT(tenant) DO UPDATE SET enabled=EXCLUDED.enabled,title=EXCLUDED.title,welcome_message=EXCLUDED.welcome_message,offline_message=EXCLUDED.offline_message,timezone=EXCLUDED.timezone,open_minute=EXCLUDED.open_minute,close_minute=EXCLUDED.close_minute,days=EXCLUDED.days,updated_at=now()`,[actor.tenant,s.enabled,s.title,s.welcomeMessage,s.offlineMessage,s.timezone,s.openMinute,s.closeMinute,[...new Set(s.days)]])
    return this.settings(actor.tenant)
  }
  async get(actor:SupportActor,id:string,executor:Executor=this.pool,lock=false):Promise<Row>{
    uuid(id);const values:unknown[]=[];const condition=access(actor,values);values.push(id)
    const unread=actor.kind==='player'?`m.sender_kind<>'player' AND m.seq>c.player_read_seq`:`m.sender_kind='player' AND m.seq>c.staff_read_seq`
    const {rows}=await executor.query(`SELECT c.*,COALESCE(u.username,u.name,'Player') player_name,u.player_type,(SELECT count(*) FROM support_messages m WHERE m.conversation_id=c.id AND ${unread}) unread FROM support_conversations c JOIN users u ON u.id=c.player_id AND u.tenant=c.tenant WHERE ${condition} AND c.id=$${values.length} ${lock?'FOR UPDATE OF c':''}`,values)
    if(!rows[0])throw new ChatError(404,'Conversation not found')
    return rows[0]
  }
  async list(actor:SupportActor,input:{status?:string;search?:string;cursor?:string}={}) {
    const values:unknown[]=[];let condition=access(actor,values)
    if(input.status&&input.status!=='all'){values.push(z.enum(['waiting','assigned','resolved']).parse(input.status));condition+=` AND c.status=$${values.length}`}
    if(input.search?.trim()){values.push('%'+input.search.trim().slice(0,120)+'%');condition+=` AND (u.username ILIKE $${values.length} OR u.name ILIKE $${values.length} OR c.topic ILIKE $${values.length})`}
    if(input.cursor){
      let cursor:any;try{cursor=JSON.parse(Buffer.from(input.cursor,'base64url').toString());z.string().datetime().parse(cursor.at);uuid(cursor.id)}catch{throw new ChatError(400,'Invalid inbox cursor')}
      values.push(cursor.at,cursor.id);condition+=` AND (c.last_message_at,c.id)<($${values.length-1}::timestamptz,$${values.length}::uuid)`
    }
    const unread=actor.kind==='player'?`m.sender_kind<>'player' AND m.seq>c.player_read_seq`:`m.sender_kind='player' AND m.seq>c.staff_read_seq`
    const {rows}=await this.pool.query(`SELECT c.*,COALESCE(u.username,u.name,'Player') player_name,u.player_type,(SELECT count(*) FROM support_messages m WHERE m.conversation_id=c.id AND ${unread}) unread
      FROM support_conversations c JOIN users u ON u.id=c.player_id AND u.tenant=c.tenant WHERE ${condition} ORDER BY c.last_message_at DESC,c.id DESC LIMIT 51`,values)
    const more=rows.length>50;const items=rows.slice(0,50),last=items[items.length-1]
    return {items:items.map(conversation),cursor:more?Buffer.from(JSON.stringify({at:iso(last.last_message_at),id:last.id})).toString('base64url'):null}
  }
  async start(actor:SupportActor,topic:unknown){
    if(actor.kind!=='player')throw new ChatError(403,'Only players can start support conversations')
    this.write(actor);const category=z.enum(CHAT_TOPICS).parse(topic)
    const chat=await this.transaction(async tx=>{
      if(!(await this.settings(actor.tenant,tx)).enabled)throw new ChatError(409,'Live chat is currently disabled')
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`support-player:${actor.tenant}:${actor.id}`])
      const existing=await tx.query(`SELECT * FROM support_conversations WHERE tenant=$1 AND player_id=$2 AND status<>'resolved'`,[actor.tenant,actor.id])
      if(existing.rows[0])return existing.rows[0]
      return (await tx.query('INSERT INTO support_conversations(tenant,player_id,topic) VALUES($1,$2,$3) RETURNING *',[actor.tenant,actor.id,category])).rows[0]
    })
    await this.notify(chat,'conversation');return conversation(await this.get(actor,chat.id))
  }
  async messages(actor:SupportActor,id:string,before?:string){
    const chat=await this.get(actor,id)
    const values:unknown[]=[actor.tenant,id];if(before)values.push(seq(before))
    const {rows}=await this.pool.query(`SELECT m.*,COALESCE((SELECT json_agg(json_build_object('id',a.id,'filename',a.filename,'mime',a.mime,'size',a.size) ORDER BY a.created_at) FROM support_attachments a WHERE a.message_seq=m.seq AND a.tenant=m.tenant),'[]') attachments
      FROM support_messages m WHERE m.tenant=$1 AND m.conversation_id=$2 ${before?'AND m.seq<$3::bigint':''} ORDER BY m.seq DESC LIMIT 51`,values)
    const more=rows.length>50,items=rows.slice(0,50).reverse()
    return {conversation:conversation(chat),items:items.map(message),before:more?String(items[0].seq):null}
  }
  async send(actor:SupportActor,id:string,input:unknown){
    const parsed=sendSchema.parse(input)
    const result=await this.transaction(async tx=>{
      const chat=await this.get(actor,id,tx,true)
      const existing=(await tx.query(`SELECT m.*,COALESCE((SELECT json_agg(json_build_object('id',a.id,'filename',a.filename,'mime',a.mime,'size',a.size)) FROM support_attachments a WHERE a.message_seq=m.seq),'[]') attachments FROM support_messages m WHERE m.conversation_id=$1 AND m.sender_kind=$2 AND m.sender_id=$3 AND m.client_message_id=$4`,[id,actor.kind,actor.id,parsed.clientMessageId])).rows[0]
      if(existing){
        if(existing.body!==parsed.body||JSON.stringify(existing.attachments.map((a:Row)=>a.id).sort())!==JSON.stringify([...parsed.attachmentIds].sort()))throw new ChatError(409,'This message identifier was already used for different content')
        return {chat,row:existing}
      }
      this.reply(actor,chat)
      if(actor.kind!=='player'&&chat.status==='waiting')await tx.query(`UPDATE support_conversations SET status='assigned',assigned_kind=$1,assigned_id=$2,assigned_name=$3 WHERE id=$4`,[actor.kind,actor.id,actor.name,id])
      if(actor.kind==='player'&&!(await this.settings(actor.tenant,tx)).enabled)throw new ChatError(409,'Live chat is currently disabled')
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`support-sender:${actor.tenant}:${actor.kind}:${actor.id}`])
      const rate=(await tx.query(`SELECT count(*)::int n FROM support_messages WHERE tenant=$1 AND sender_kind=$2 AND sender_id=$3 AND created_at>now()-interval '1 minute'`,[actor.tenant,actor.kind,actor.id])).rows[0]
      if(rate.n>=30)throw new ChatError(429,'Please wait before sending more messages')
      const ids=[...new Set(parsed.attachmentIds)]
      const files=ids.length?(await tx.query(`SELECT id,filename,mime,size FROM support_attachments WHERE id=ANY($1::uuid[]) AND tenant=$2 AND conversation_id=$3 AND sender_kind=$4 AND sender_id=$5 AND message_seq IS NULL FOR UPDATE`,[ids,actor.tenant,id,actor.kind,actor.id])).rows:[]
      if(files.length!==ids.length)throw new ChatError(400,'A screenshot is unavailable or belongs to another message')
      const row=(await tx.query(`INSERT INTO support_messages(conversation_id,tenant,sender_kind,sender_id,sender_name,client_message_id,body) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[id,actor.tenant,actor.kind,actor.id,actor.name.slice(0,120),parsed.clientMessageId,parsed.body])).rows[0]
      if(ids.length)await tx.query('UPDATE support_attachments SET message_seq=$1 WHERE id=ANY($2::uuid[])',[row.seq,ids])
      await tx.query('UPDATE support_conversations SET last_seq=$1,last_message_preview=$2,last_message_at=now() WHERE id=$3',[row.seq,(parsed.body||'Screenshot').slice(0,180),id])
      return {chat,row:{...row,attachments:files}}
    })
    const saved=message(result.row);await this.notify(result.chat,'message',saved);return saved
  }
  async receipt(actor:SupportActor,id:string,input:unknown){
    this.write(actor)
    const data=z.object({seq:z.string().transform(seq),read:z.boolean()}).parse(input)
    const result=await this.transaction(async tx=>{
      const chat=await this.get(actor,id,tx,true)
      if(BigInt(data.seq)>BigInt(chat.last_seq))throw new ChatError(400,'Receipt is beyond the latest message')
      const side=actor.kind==='player'?'player':'staff'
      const changed=BigInt(chat[`${side}_delivered_seq`])<BigInt(data.seq)||(data.read&&BigInt(chat[`${side}_read_seq`])<BigInt(data.seq))
      await tx.query(`UPDATE support_conversations SET ${side}_delivered_seq=GREATEST(${side}_delivered_seq,$1::bigint)${data.read?`,${side}_read_seq=GREATEST(${side}_read_seq,$1::bigint)`:''} WHERE id=$2`,[data.seq,id])
      return {chat,changed}
    })
    if(result.changed)await this.notify(result.chat,'receipt')
    return {ok:true}
  }
  async upload(actor:SupportActor,id:string,input:unknown):Promise<ChatAttachment>{
    const data=z.object({filename:z.string().min(1).max(120),base64:z.string().min(4).max(2796204)}).parse(input)
    if(!/^[A-Za-z0-9+/]+={0,2}$/.test(data.base64))throw new ChatError(400,'Invalid screenshot encoding')
    const buffer=Buffer.from(data.base64,'base64')
    if(buffer.length===0||buffer.length>2*1024*1024)throw new ChatError(400,'Screenshot must be at most 2 MB')
    const mime=buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':buffer[0]===255&&buffer[1]===216&&buffer[2]===255?'image/jpeg':buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP'?'image/webp':null
    if(!mime)throw new ChatError(400,'Use a PNG, JPEG or WebP screenshot')
    return this.transaction(async tx=>{
      const chat=await this.get(actor,id,tx,true);this.reply(actor,chat)
      if(actor.kind==='player'&&!(await this.settings(actor.tenant,tx)).enabled)throw new ChatError(409,'Live chat is currently disabled')
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`support-upload:${actor.tenant}:${actor.kind}:${actor.id}`])
      const rate=(await tx.query(`SELECT count(*)::int n FROM support_attachments WHERE tenant=$1 AND sender_kind=$2 AND sender_id=$3 AND created_at>now()-interval '1 hour'`,[actor.tenant,actor.kind,actor.id])).rows[0]
      if(rate.n>=30)throw new ChatError(429,'Screenshot upload limit reached. Please try later.')
      await tx.query(`DELETE FROM support_attachments WHERE tenant=$1 AND sender_kind=$2 AND sender_id=$3 AND message_seq IS NULL AND created_at<now()-interval '24 hours'`,[actor.tenant,actor.kind,actor.id])
      const filename=data.filename.replace(/[^a-zA-Z0-9._ -]/g,'_').slice(0,110)
      return (await tx.query(`INSERT INTO support_attachments(tenant,conversation_id,sender_kind,sender_id,filename,mime,size,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,filename,mime,size`,[actor.tenant,id,actor.kind,actor.id,filename,mime,buffer.length,buffer])).rows[0] as ChatAttachment
    })
  }
  async attachment(actor:SupportActor,id:string){
    uuid(id)
    const row=(await this.pool.query('SELECT * FROM support_attachments WHERE tenant=$1 AND id=$2',[actor.tenant,id])).rows[0]
    if(!row)throw new ChatError(404,'Screenshot not found')
    await this.get(actor,row.conversation_id)
    if(!row.message_seq&&(row.sender_kind!==actor.kind||row.sender_id!==actor.id))throw new ChatError(404,'Screenshot not found')
    return row
  }
  private async system(tx:Executor,chat:Row,actor:SupportActor,body:string){
    const row=(await tx.query(`INSERT INTO support_messages(conversation_id,tenant,sender_kind,sender_id,sender_name,client_message_id,body) VALUES($1,$2,'system',$3,$4,$5,$6) RETURNING seq`,[chat.id,actor.tenant,`${actor.kind}:${actor.id}`,actor.name,randomUUID(),body])).rows[0]
    await tx.query('UPDATE support_conversations SET last_seq=$1,last_message_preview=$2,last_message_at=now() WHERE id=$3',[row.seq,body.slice(0,180),chat.id])
  }
  async update(actor:SupportActor,id:string,input:unknown){
    if(actor.kind==='player')throw new ChatError(403,'Staff access is required')
    this.write(actor)
    const data=z.object({action:z.enum(['claim','transfer','resolve','reopen']),staffKind:z.enum(['admin','crm']).optional(),staffId:z.string().max(128).optional()}).parse(input)
    const result=await this.transaction(async tx=>{
      const chat=await this.get(actor,id,tx,true)
      if(data.action==='claim'){
        this.reply(actor,chat)
        if(chat.assigned_kind===actor.kind&&chat.assigned_id===actor.id)return chat
        await tx.query(`UPDATE support_conversations SET status='assigned',assigned_kind=$1,assigned_id=$2,assigned_name=$3 WHERE id=$4`,[actor.kind,actor.id,actor.name,id])
        await this.system(tx,chat,actor,`${actor.name} joined the conversation.`)
      }else if(data.action==='transfer'){
        if(!actor.canAssign)throw new ChatError(403,'Assignment permission is required')
        const target=(await this.staff(actor,id,tx)).find(s=>s.kind===data.staffKind&&s.id===data.staffId)
        if(!target)throw new ChatError(400,'Choose an eligible support staff member')
        if(chat.status==='resolved')throw new ChatError(409,'Reopen this conversation before transferring it')
        if(chat.assigned_kind===target.kind&&chat.assigned_id===target.id)return chat
        await tx.query(`UPDATE support_conversations SET status='assigned',assigned_kind=$1,assigned_id=$2,assigned_name=$3 WHERE id=$4`,[target.kind,target.id,target.name,id])
        await this.system(tx,chat,actor,`${actor.name} transferred the conversation to ${target.name}.`)
      }else{
        if(!actor.canAssign&&!actor.canReply)throw new ChatError(403,'Reply permission is required')
        if(chat.assigned_id&&(chat.assigned_id!==actor.id||chat.assigned_kind!==actor.kind)&&!actor.canAssign)throw new ChatError(403,'This conversation belongs to another staff member')
        const status=data.action==='resolve'?'resolved':'waiting'
        if(chat.status===status)return chat
        if(data.action==='reopen'&&chat.status!=='resolved')throw new ChatError(409,'Only resolved conversations can be reopened')
        if(status==='waiting'){
          const active=(await tx.query(`SELECT id FROM support_conversations WHERE tenant=$1 AND player_id=$2 AND status<>'resolved' AND id<>$3`,[actor.tenant,chat.player_id,id])).rows[0]
          if(active)throw new ChatError(409,'This player already has another open conversation')
        }
        await tx.query('UPDATE support_conversations SET status=$1,assigned_kind=$2,assigned_id=$3,assigned_name=$4 WHERE id=$5',[status,status==='waiting'?null:chat.assigned_kind,status==='waiting'?null:chat.assigned_id,status==='waiting'?null:chat.assigned_name,id])
        await this.system(tx,chat,actor,data.action==='resolve'?`${actor.name} resolved this conversation.`:`${actor.name} reopened this conversation.`)
      }
      return chat
    })
    await this.notify(result,'conversation');return conversation(await this.get(actor,id))
  }
  async staff(actor:SupportActor,id?:string,executor:Executor=this.pool):Promise<ChatStaff[]>{
    const playerId=id?(await this.get(actor,id,executor)).player_id:actor.kind==='player'?Number(actor.id):null
    const {rows}=await executor.query(`SELECT p.kind,p.staff_id id,p.name,(p.available AND p.last_seen_at>now()-interval '65 seconds') online FROM support_presence p
      WHERE p.tenant=$1 AND (
        (p.kind='crm' AND EXISTS(SELECT 1 FROM crm_users u JOIN crm_whitelabel_settings s ON s.tenant=u.tenant AND s.enabled WHERE u.tenant=p.tenant AND u.id::text=p.staff_id AND u.status='ACTIVE' AND NOT u.require_password_reset AND (u.out_of_office_until IS NULL OR u.out_of_office_until<now())
          AND EXISTS(SELECT 1 FROM crm_user_roles ur JOIN crm_role_permissions rp ON rp.role_id=ur.role_id WHERE ur.crm_user_id=u.id AND rp.domain='crm.chat' AND rp.action IN ('reply','*'))
          AND EXISTS(SELECT 1 FROM crm_user_roles ur JOIN crm_role_permissions rp ON rp.role_id=ur.role_id WHERE ur.crm_user_id=u.id AND rp.domain='crm.chat' AND rp.action IN ('view','*'))
          AND ($2::int IS NULL OR EXISTS(SELECT 1 FROM crm_user_roles ur JOIN crm_role_permissions rp ON rp.role_id=ur.role_id WHERE ur.crm_user_id=u.id AND rp.domain='crm.players' AND rp.action IN ('view_all','*')) OR EXISTS(SELECT 1 FROM crm_book_members bm JOIN crm_books b ON b.id=bm.book_id AND b.tenant=u.tenant JOIN crm_player_assignments a ON a.book_id=b.id AND a.tenant=b.tenant WHERE bm.crm_user_id=u.id AND a.player_id=$2))))
        OR (p.kind='admin' AND EXISTS(SELECT 1 FROM users u WHERE u.id::text=p.staff_id AND u.status='active' AND NOT u.require_password_reset
          AND (u.tenant=p.tenant OR EXISTS(SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id=ur.role_id AND rp.tenant=ur.tenant JOIN permissions x ON x.id=rp.permission_id AND x.tenant=rp.tenant WHERE ur.user_id=u.id AND ur.tenant=u.tenant AND x.domain='all' AND x.action='*'))
          AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id AND r.tenant=ur.tenant LEFT JOIN role_permissions rp ON rp.role_id=r.id AND rp.tenant=r.tenant LEFT JOIN permissions x ON x.id=rp.permission_id AND x.tenant=rp.tenant WHERE ur.user_id=u.id AND ur.tenant=u.tenant AND (r.is_whitelabel_admin OR (x.domain='all' AND x.action='*') OR (x.domain='support.chat' AND x.action IN ('view','*'))))
          AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id AND r.tenant=ur.tenant LEFT JOIN role_permissions rp ON rp.role_id=r.id AND rp.tenant=r.tenant LEFT JOIN permissions x ON x.id=rp.permission_id AND x.tenant=rp.tenant WHERE ur.user_id=u.id AND ur.tenant=u.tenant AND (r.is_whitelabel_admin OR (x.domain='all' AND x.action='*') OR (x.domain='support.chat' AND x.action IN ('reply','*')))))))
      ORDER BY online DESC,p.name LIMIT 100`,[actor.tenant,playerId])
    return rows
  }
  async bootstrap(actor:SupportActor){
    const settings=await this.settings(actor.tenant),withinHours=withinDeskHours(settings)
    const online=settings.enabled&&withinHours&&(await this.staff(actor)).some(s=>s.online)
    const presence=actor.kind==='player'?null:(await this.pool.query('SELECT available FROM support_presence WHERE tenant=$1 AND kind=$2 AND staff_id=$3',[actor.tenant,actor.kind,actor.id])).rows[0]
    return {actor,settings,online,withinHours,available:presence?.available??false,unreadTotal:await this.unreadCount(actor)}
  }
  async unreadCount(actor:SupportActor){
    const values:unknown[]=[],condition=access(actor,values)
    const unread=actor.kind==='player'?`m.sender_kind<>'player' AND m.seq>c.player_read_seq`:`m.sender_kind='player' AND m.seq>c.staff_read_seq`
    return Number((await this.pool.query(`SELECT count(*) n FROM support_messages m JOIN support_conversations c ON c.id=m.conversation_id WHERE ${condition} AND ${unread}`,values)).rows[0].n)
  }
  async snapshot(actor:SupportActor,id:string){return {conversation:conversation(await this.get(actor,id)),unreadTotal:await this.unreadCount(actor)}}
  async presence(actor:SupportActor,available:unknown){
    if(actor.kind==='player'||!actor.canReply)throw new ChatError(403,'Support reply permission is required')
    this.write(actor);const value=z.boolean().parse(available)
    const previous=(await this.pool.query('SELECT available,last_seen_at FROM support_presence WHERE tenant=$1 AND kind=$2 AND staff_id=$3',[actor.tenant,actor.kind,actor.id])).rows[0]
    await this.pool.query(`INSERT INTO support_presence(tenant,kind,staff_id,name,available,last_seen_at) VALUES($1,$2,$3,$4,$5,now()) ON CONFLICT(tenant,kind,staff_id) DO UPDATE SET name=EXCLUDED.name,available=EXCLUDED.available,last_seen_at=now()`,[actor.tenant,actor.kind,actor.id,actor.name,value])
    return {available:value,changed:!previous||previous.available!==value||(value&&Date.now()-new Date(previous.last_seen_at).getTime()>65000)}
  }
  async typing(actor:SupportActor,id:string){if(actor.kind==='player'&&!(await this.settings(actor.tenant)).enabled)throw new ChatError(403,'Live chat is currently unavailable');const chat=await this.get(actor,id);this.reply(actor,chat);return chat}
}
