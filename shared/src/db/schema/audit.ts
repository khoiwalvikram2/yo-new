import { pgTable, serial, timestamp, varchar, jsonb, index, uuid, integer, text } from 'drizzle-orm/pg-core'

export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  actorId: varchar('actor_id', { length: 64 }).notNull(),
  domain: varchar('domain', { length: 64 }).notNull(),
  action: varchar('action', { length: 64 }).notNull(),
  resourceType: varchar('resource_type', { length: 64 }).notNull(),
  resourceId: varchar('resource_id', { length: 128 }).notNull(),
  before: jsonb('before'),
  after: jsonb('after'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('audit_logs_tenant_idx').on(table.tenant),
])

// Audit export jobs (for tracking export jobs)
export const auditExportJobs = pgTable('audit_export_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  whitelabelId: varchar('whitelabel_id', { length: 64 }).notNull(),
  createdBy: integer('created_by').notNull(), // Admin user ID
  filtersJson: jsonb('filters_json').notNull(),
  exportFormat: varchar('export_format', { length: 16 }).notNull(), // CSV, JSON, XLSX
  status: varchar('status', { length: 24 }).notNull().default('pending'), // pending, processing, completed, failed
  fileUrl: varchar('file_url', { length: 512 }),
  fileData: text('file_data'), // base64 data URI of the generated export; populated in a later plan
  errorMessage: text('error_message'),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('audit_export_jobs_tenant_idx').on(table.tenant),
  index('audit_export_jobs_whitelabel_idx').on(table.whitelabelId),
  index('audit_export_jobs_created_by_idx').on(table.createdBy),
  index('audit_export_jobs_status_idx').on(table.status),
  index('audit_export_jobs_scheduled_idx').on(table.scheduledAt),
])

// Audit event annotations (notes added by admins)
export const auditAnnotations = pgTable('audit_annotations', {
  id: serial('id').primaryKey(),
  tenant: varchar('tenant', { length: 128 }).notNull().default('default'),
  auditEventId: integer('audit_event_id').notNull(),
  createdBy: integer('created_by').notNull(), // Admin user ID
  note: text('note').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
}, (table) => [
  index('audit_annotations_audit_event_id_idx').on(table.auditEventId),
  index('audit_annotations_tenant_idx').on(table.tenant),
  index('audit_annotations_created_by_idx').on(table.createdBy),
])

