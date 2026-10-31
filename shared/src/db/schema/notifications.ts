import {
	pgTable,
	uuid,
	varchar,
	text,
	boolean,
	timestamp,
	jsonb,
	pgEnum,
	index,
	integer,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { agents } from './agents';
import { whitelabels } from './whitelabel';

// Notification type enum
export const notificationTypeEnum = pgEnum('notification_type', [
	'DEPOSIT',
	'WITHDRAWAL',
	'KYC',
	'SYSTEM',
	'AGENT',
	'PLAYER',
	'SETTLEMENT',
	'COMMISSION',
]);

// Notification category enum
export const notificationCategoryEnum = pgEnum('notification_category', [
	'general',
	'task',
]);

export const notifications = pgTable(
	'notifications',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
		userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
		agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'cascade' }),
		whitelabelId: varchar('whitelabel_id', { length: 64 }).references(() => whitelabels.id, { onDelete: 'cascade' }),
		type: notificationTypeEnum('type').notNull(),
		category: notificationCategoryEnum('category').notNull(),
		title: text('title').notNull(),
		message: text('message').notNull(),
		metadata: jsonb('metadata'), // Additional data (e.g., deposit amount, withdrawal ID)
		isRead: boolean('is_read').default(false).notNull(),
		actionUrl: text('action_url'), // URL to navigate on click
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('notifications_tenant_idx').on(table.tenant),
		index('notifications_user_id_idx').on(table.userId),
		index('notifications_agent_id_idx').on(table.agentId),
		index('notifications_whitelabel_id_idx').on(table.whitelabelId),
		index('notifications_is_read_idx').on(table.isRead),
		index('notifications_category_idx').on(table.category),
		index('notifications_created_at_idx').on(table.createdAt),
	]
);
