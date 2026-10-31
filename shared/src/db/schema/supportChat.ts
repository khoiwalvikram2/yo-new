import { pgTable, uuid, varchar, text, integer, boolean, timestamp, bigint, bigserial, smallint, index, uniqueIndex, primaryKey, customType, check } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { users } from './users.js'
import { whitelabels } from './whitelabel.js'

const bytes = customType<{data:Buffer}>({dataType:()=> 'bytea'})
export const supportChatSettings=pgTable('support_chat_settings',{
  tenant:varchar('tenant',{length:128}).primaryKey().references(()=>whitelabels.id,{onDelete:'cascade'}),
  enabled:boolean('enabled').notNull().default(false),
  title:varchar('title',{length:80}).notNull().default('Live support'),
  welcomeMessage:text('welcome_message').notNull().default('Hello! How can we help you today?'),
  offlineMessage:text('offline_message').notNull().default('Our team is away. Leave a message and we will reply here.'),
  timezone:varchar('timezone',{length:64}).notNull().default('Asia/Kolkata'),
  openMinute:integer('open_minute').notNull().default(540),closeMinute:integer('close_minute').notNull().default(1260),
  days:smallint('days').array().notNull().default(sql`'{1,2,3,4,5,6}'`),
  updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
})
export const supportConversations=pgTable('support_conversations',{
  id:uuid('id').primaryKey().defaultRandom(),tenant:varchar('tenant',{length:128}).notNull().references(()=>whitelabels.id,{onDelete:'cascade'}),
  playerId:integer('player_id').notNull().references(()=>users.id,{onDelete:'cascade'}),
  topic:varchar('topic',{length:24}).notNull().default('Account'),status:varchar('status',{length:16}).notNull().default('waiting'),
  assignedKind:varchar('assigned_kind',{length:8}),assignedId:varchar('assigned_id',{length:128}),assignedName:varchar('assigned_name',{length:120}),
  lastSeq:bigint('last_seq',{mode:'bigint'}).notNull().default(sql`0`),
  playerReadSeq:bigint('player_read_seq',{mode:'bigint'}).notNull().default(sql`0`),staffReadSeq:bigint('staff_read_seq',{mode:'bigint'}).notNull().default(sql`0`),
  playerDeliveredSeq:bigint('player_delivered_seq',{mode:'bigint'}).notNull().default(sql`0`),staffDeliveredSeq:bigint('staff_delivered_seq',{mode:'bigint'}).notNull().default(sql`0`),
  lastMessagePreview:varchar('last_message_preview',{length:180}).notNull().default(''),
  lastMessageAt:timestamp('last_message_at',{withTimezone:true}).notNull().defaultNow(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[
  uniqueIndex('support_one_open_player').on(t.tenant,t.playerId).where(sql`${t.status}<>'resolved'`),
  index('support_inbox_idx').on(t.tenant,t.status,t.lastMessageAt),index('support_player_idx').on(t.tenant,t.playerId,t.lastMessageAt),
  check('support_conversation_status',sql`${t.status} in ('waiting','assigned','resolved')`),
])
export const supportMessages=pgTable('support_messages',{
  seq:bigserial('seq',{mode:'bigint'}).primaryKey(),id:uuid('id').notNull().defaultRandom(),
  conversationId:uuid('conversation_id').notNull().references(()=>supportConversations.id,{onDelete:'cascade'}),
  tenant:varchar('tenant',{length:128}).notNull(),senderKind:varchar('sender_kind',{length:8}).notNull(),senderId:varchar('sender_id',{length:128}).notNull(),
  senderName:varchar('sender_name',{length:120}).notNull(),clientMessageId:uuid('client_message_id').notNull(),body:text('body').notNull().default(''),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[uniqueIndex('support_message_retry_key').on(t.conversationId,t.senderKind,t.senderId,t.clientMessageId),index('support_messages_page_idx').on(t.tenant,t.conversationId,t.seq),index('support_sender_rate_idx').on(t.tenant,t.senderKind,t.senderId,t.createdAt)])
export const supportAttachments=pgTable('support_attachments',{
  id:uuid('id').primaryKey().defaultRandom(),conversationId:uuid('conversation_id').notNull().references(()=>supportConversations.id,{onDelete:'cascade'}),
  tenant:varchar('tenant',{length:128}).notNull(),senderKind:varchar('sender_kind',{length:8}).notNull(),senderId:varchar('sender_id',{length:128}).notNull(),
  messageSeq:bigint('message_seq',{mode:'bigint'}).references(()=>supportMessages.seq,{onDelete:'cascade'}),
  filename:varchar('filename',{length:120}).notNull(),mime:varchar('mime',{length:32}).notNull(),size:integer('size').notNull(),data:bytes('data').notNull(),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[index('support_attachment_message_idx').on(t.messageSeq),index('support_attachment_owner_idx').on(t.tenant,t.senderKind,t.senderId,t.createdAt)])
export const supportPresence=pgTable('support_presence',{
  tenant:varchar('tenant',{length:128}).notNull().references(()=>whitelabels.id,{onDelete:'cascade'}),kind:varchar('kind',{length:8}).notNull(),staffId:varchar('staff_id',{length:128}).notNull(),
  name:varchar('name',{length:120}).notNull(),available:boolean('available').notNull().default(false),lastSeenAt:timestamp('last_seen_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[primaryKey({columns:[t.tenant,t.kind,t.staffId]}),index('support_presence_tenant_idx').on(t.tenant,t.lastSeenAt)])
