import { pgEnum, pgTable, serial, text, timestamp, boolean, integer } from 'drizzle-orm/pg-core'

export const otpProviderEnum = pgEnum('otp_provider', ['TWILIO', 'AWS_SNS', 'MSG91', 'TWO_FACTOR'])

export const otpProviders = pgTable('otp_providers', {
  id: serial('id').primaryKey(),
  tenant: text('tenant').notNull().default('default'),
  provider: otpProviderEnum('provider').notNull(),
  accountSid: text('account_sid'),
  authToken: text('auth_token'),
  accessKey: text('access_key'),
  secretKey: text('secret_key'),
  region: text('region'),
  senderId: text('sender_id'),
  templateId: text('template_id'),
  apiKey: text('api_key'),
  apiSecret: text('api_secret'),
  baseUrl: text('base_url'),
  active: boolean('active').notNull().default(false),
  priority: integer('priority').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

