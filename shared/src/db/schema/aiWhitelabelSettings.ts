import { pgTable, uuid, varchar, integer, boolean, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

/**
 * Per-whitelabel control over the AI assistant, owned by Super Admin.
 *
 * Two independent gates. `enabled` says whether the whitelabel may use the
 * assistant at all; `chatLimit` caps how many messages it may send. Both start
 * closed: a row that does not exist, or exists with the defaults, means no
 * access. Assistant traffic costs real money per message, so the safe default
 * is off rather than on — a new whitelabel cannot spend anything until someone
 * deliberately grants it an allowance.
 */
export const aiWhitelabelSettings = pgTable(
  'ai_whitelabel_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant: varchar('tenant', { length: 128 }).notNull(),
    /** Off until Super Admin turns it on. */
    enabled: boolean('enabled').notNull().default(false),
    /** Messages allowed per period. 0 means none, which is the default. */
    chatLimit: integer('chat_limit').notNull().default(0),
    /**
     * How the allowance renews: 'monthly', 'daily', or 'total' for a one-off
     * grant that never resets. Stored rather than assumed because a trial
     * allowance and an ongoing budget are both reasonable readings of a number
     * like "5", and they behave very differently.
     */
    limitPeriod: varchar('limit_period', { length: 16 }).notNull().default('monthly'),
    /** Who last changed this, for the audit trail. */
    updatedBy: varchar('updated_by', { length: 128 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('ai_whitelabel_settings_tenant_key').on(table.tenant)]
)
