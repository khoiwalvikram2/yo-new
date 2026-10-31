import { pgTable, serial, varchar, timestamp, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core'

export type CMSStatus = 'DRAFT' | 'PUBLISHED'

export const cmsPages = pgTable('cms_pages', {
	id: serial('id').primaryKey(),
	whitelabelId: varchar('whitelabel_id', { length: 64 }).notNull(),
	slug: varchar('slug', { length: 255 }).notNull(),
	title: varchar('title', { length: 255 }).notNull(),
	locale: varchar('locale', { length: 16 }).notNull().default('en'),
	status: varchar('status', { length: 16 }).notNull().default('DRAFT'),
	body: varchar('body', { length: 200000 }), // store large HTML/markdown text
	seoTitle: varchar('seo_title', { length: 180 }),
	seoDescription: varchar('seo_description', { length: 512 }),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex('cms_pages_wl_slug_locale_unique').on(table.whitelabelId, table.slug, table.locale),
])

