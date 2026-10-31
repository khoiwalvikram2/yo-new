import { pgTable, uuid, varchar, text, integer, bigserial, timestamp, jsonb, index, boolean } from 'drizzle-orm/pg-core'

/**
 * Storage for the admin portal's AI assistant.
 *
 * Everything here is tenant-scoped like the rest of the schema. The assistant
 * itself holds no privileges: tools run through the existing GraphQL resolvers
 * with the caller's own context, so these tables are a transcript and a
 * pending-action queue, not an authorization surface.
 */

export const aiConversations = pgTable('ai_conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  /** Admin user who owns the conversation. Conversations are never shared. */
  adminUserId: integer('admin_user_id').notNull(),
  title: varchar('title', { length: 200 }),
  /** Running total so a conversation can be cut off before it gets expensive. */
  tokensUsed: integer('tokens_used').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('ai_conversations_tenant_admin_idx').on(table.tenant, table.adminUserId),
  index('ai_conversations_updated_idx').on(table.updatedAt),
])

export const aiMessages = pgTable('ai_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  /**
   * Insert order. The transcript is replayed to the model every turn, and the
   * API rejects a tool message that does not directly follow the assistant
   * message that requested it — so ordering has to be total. Timestamps tie at
   * microsecond resolution and leave the order undefined; a single tie would
   * corrupt that conversation permanently, since the same history is replayed
   * on every subsequent turn.
   */
  seq: bigserial('seq', { mode: 'number' }).notNull(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  conversationId: uuid('conversation_id').notNull().references(() => aiConversations.id, { onDelete: 'cascade' }),
  /** system | user | assistant | tool */
  role: varchar('role', { length: 16 }).notNull(),
  content: text('content'),
  /** Tool calls requested by the model, or the result of one. */
  toolCalls: jsonb('tool_calls'),
  toolCallId: varchar('tool_call_id', { length: 128 }),
  toolName: varchar('tool_name', { length: 128 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('ai_messages_conversation_idx').on(table.conversationId, table.seq),
])

/**
 * A write the model has proposed but not performed.
 *
 * The model never mutates anything. It emits a proposal, an operator reads the
 * rendered description and confirms, and only then does the action run — with
 * the confirming operator's own auth context. The client sends back an id and
 * nothing else, so the payload cannot be altered between display and execution.
 */
export const aiActionProposals = pgTable('ai_action_proposals', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  conversationId: uuid('conversation_id').notNull().references(() => aiConversations.id, { onDelete: 'cascade' }),
  adminUserId: integer('admin_user_id').notNull(),
  /** Registry name of the write tool, e.g. 'set_whitelabel_limit'. */
  toolName: varchar('tool_name', { length: 128 }).notNull(),
  /** Arguments exactly as they will be executed. */
  args: jsonb('args').notNull(),
  /** Operator-facing sentence describing the change. */
  summary: text('summary').notNull(),
  /** pending | confirmed | rejected | expired | failed */
  status: varchar('status', { length: 16 }).notNull().default('pending'),
  /** Single-use: set the moment execution begins, so a double confirm is a no-op. */
  consumed: boolean('consumed').notNull().default(false),
  result: jsonb('result'),
  error: text('error'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
}, (table) => [
  index('ai_action_proposals_conversation_idx').on(table.conversationId),
  index('ai_action_proposals_status_idx').on(table.tenant, table.status),
])
