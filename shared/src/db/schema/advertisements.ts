import { pgTable, serial, varchar, text, integer, timestamp, pgEnum, index } from 'drizzle-orm/pg-core'

export const advertisementTypeEnum = pgEnum('advertisement_type', ['BANNER', 'PROMOTIONAL', 'FEATURED'])
export const advertisementStatusEnum = pgEnum('advertisement_status', ['ACTIVE', 'INACTIVE'])
export const advertisementDeviceTypeEnum = pgEnum('advertisement_device_type', ['DESKTOP', 'MOBILE', 'BOTH'])

export type AdvertisementType = 'BANNER' | 'PROMOTIONAL' | 'FEATURED'
export type AdvertisementStatus = 'ACTIVE' | 'INACTIVE'
export type AdvertisementDeviceType = 'DESKTOP' | 'MOBILE' | 'BOTH'

export const advertisements = pgTable('advertisements', {
	id: serial('id').primaryKey(),
	whitelabelId: varchar('whitelabel_id', { length: 64 }).notNull(),
	title: varchar('title', { length: 255 }).notNull(),
	subtitle: varchar('subtitle', { length: 512 }),
	imageUrl: text('image_url'), // base64 data URI
	type: advertisementTypeEnum('type').notNull().default('BANNER'),
	url: varchar('url', { length: 1024 }),
	order: integer('order').notNull().default(0),
	status: advertisementStatusEnum('status').notNull().default('ACTIVE'),
	deviceType: advertisementDeviceTypeEnum('device_type').notNull().default('BOTH'),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
	index('advertisements_wl_idx').on(table.whitelabelId),
	index('advertisements_status_idx').on(table.status),
	index('advertisements_order_idx').on(table.order),
])

