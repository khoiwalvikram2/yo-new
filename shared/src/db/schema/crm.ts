import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  primaryKey,
  check,
  numeric,
  smallint,
  bigserial,
  jsonb,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

/**
 * CRM — a separate application at crm.<whitelabel-domain>, with its own users,
 * its own roles, and its own login.
 *
 * Two ideas carry the isolation here and neither may be weakened:
 *
 *   1. Every row is tenant-scoped, and every query filters on the tenant taken
 *      from the caller's token — never on a tenant the caller supplied.
 *   2. Inside a tenant, a CRM user reaches players through *books*. Tenant
 *      scoping answers "can brand A see brand B"; it does not answer "should
 *      this agent see all 40,000 players". Books answer that.
 */

// ---------------------------------------------------------------------------
// Super Admin's gate
// ---------------------------------------------------------------------------

/**
 * Per-whitelabel control over the CRM, owned by Super Admin. Follows the same
 * shape as `ai_whitelabel_settings`: both gates start closed, and a whitelabel
 * with no row here has no CRM at all — its crm.<domain> refuses every login.
 *
 * `seatLimit` is a grant, not a hint. It is claimed under a row lock when a CRM
 * user is created, because a check-then-write count lets concurrent creates
 * exceed it.
 */
export const crmWhitelabelSettings = pgTable(
  'crm_whitelabel_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant: varchar('tenant', { length: 128 }).notNull(),
    /** Off until Super Admin turns it on. */
    enabled: boolean('enabled').notNull().default(false),
    /** How many CRM users this whitelabel may have. 0 means none. */
    seatLimit: integer('seat_limit').notNull().default(0),
    /** Minutes of inactivity before a CRM session is refused. */
    sessionIdleMinutes: integer('session_idle_minutes').notNull().default(60),
    /** When set, a CRM user may only sign in from an address in crm_ip_allowlist. */
    enforceIpAllowlist: boolean('enforce_ip_allowlist').notNull().default(false),
    /**
     * The desk's working calendar. Task deadlines are computed against it and
     * the escalation ladder does not advance outside it — waking a supervisor
     * at 02:00 for a callback nobody could have made is how an alert becomes
     * something people mute.
     */
    timezone: varchar('timezone', { length: 64 }).notNull().default('Asia/Kolkata'),
    deskOpenMinute: integer('desk_open_minute').notNull().default(540),
    deskCloseMinute: integer('desk_close_minute').notNull().default(1260),
    /** ISO weekdays the desk works, 1 = Monday. Default Monday to Saturday. */
    deskDays: smallint('desk_days').array().notNull().default(sql`'{1,2,3,4,5,6}'`),
    updatedBy: varchar('updated_by', { length: 128 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('crm_whitelabel_settings_tenant_key').on(t.tenant)]
)

// ---------------------------------------------------------------------------
// CRM users — their own principal, not admin users
// ---------------------------------------------------------------------------

export const crmUsers = pgTable(
  'crm_users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant: varchar('tenant', { length: 128 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    email: varchar('email', { length: 160 }),
    phone: varchar('phone', { length: 32 }),
    /** ACTIVE | INACTIVE | SUSPENDED. INACTIVE is view-only; SUSPENDED cannot sign in. */
    status: varchar('status', { length: 24 }).notNull().default('ACTIVE'),
    /**
     * Bumped on password change and on suspension. A token whose `v` does not
     * match is refused, so revoking access takes effect on the next request
     * rather than whenever the JWT happens to expire.
     */
    tokenVersion: integer('token_version').notNull().default(0),
    /** Set for a user created by an administrator; cleared once they choose their own. */
    requirePasswordReset: boolean('require_password_reset').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    /**
     * Escalating to someone on leave is the same as escalating to nobody, so
     * the ladder skips them and follows `delegateTo` one hop. One hop, not a
     * chain: delegation cycles are a way to make work disappear silently.
     */
    outOfOfficeUntil: timestamp('out_of_office_until', { withTimezone: true }),
    // A deleted delegate used to leave this pointing at nothing, which the
    // escalation sweep discovered only when its insert hit a foreign-key
    // violation and aborted the rest of that claim batch. Cleared instead.
    delegateTo: uuid('delegate_to').references((): AnyPgColumn => crmUsers.id, { onDelete: 'set null' }),
    /** The admin user id, or CRM user id, that created this one. */
    createdBy: varchar('created_by', { length: 128 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('crm_users_tenant_idx').on(t.tenant),
    index('crm_users_tenant_status_idx').on(t.tenant, t.status),
    index('crm_users_delegate_idx').on(t.delegateTo),
    check('crm_users_no_self_delegate', sql`${t.delegateTo} is null or ${t.delegateTo} <> ${t.id}`),
  ]
)

export const crmUserCredentials = pgTable(
  'crm_user_credentials',
  {
    crmUserId: uuid('crm_user_id')
      .primaryKey()
      .references(() => crmUsers.id, { onDelete: 'cascade' }),
    /** Mirrors the owning user's tenant so uniqueness can be enforced per tenant. */
    tenant: varchar('tenant', { length: 128 }).notNull(),
    username: varchar('username', { length: 120 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
    /** Consecutive failures; reset on success. Drives lockout. */
    failedAttempts: integer('failed_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Two whitelabels may each have a "rohit". Uniqueness is per tenant, and
    // case-insensitive because the app lowercases before comparing.
    uniqueIndex('crm_user_credentials_tenant_username_key').on(t.tenant, sql`lower(${t.username})`),
  ]
)

// ---------------------------------------------------------------------------
// Roles and permissions — owned by the whitelabel, not by Super Admin
// ---------------------------------------------------------------------------

export const crmRoles = pgTable(
  'crm_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant: varchar('tenant', { length: 128 }).notNull(),
    name: varchar('name', { length: 80 }).notNull(),
    description: varchar('description', { length: 255 }),
    /**
     * Seeded roles a whitelabel gets on enablement. They can be edited, but not
     * deleted, so a tenant can never end up with no way to administer itself.
     */
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('crm_roles_tenant_name_key').on(t.tenant, sql`lower(${t.name})`)]
)

export const crmRolePermissions = pgTable(
  'crm_role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => crmRoles.id, { onDelete: 'cascade' }),
    /** e.g. 'crm.players' */
    domain: varchar('domain', { length: 64 }).notNull(),
    /** e.g. 'view' | 'view_all' | 'manage' */
    action: varchar('action', { length: 40 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.domain, t.action] }),
    index('crm_role_permissions_role_idx').on(t.roleId),
  ]
)

export const crmUserRoles = pgTable(
  'crm_user_roles',
  {
    crmUserId: uuid('crm_user_id')
      .notNull()
      .references(() => crmUsers.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => crmRoles.id, { onDelete: 'cascade' }),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.crmUserId, t.roleId] }),
    index('crm_user_roles_user_idx').on(t.crmUserId),
    index('crm_user_roles_role_idx').on(t.roleId),
  ]
)

// ---------------------------------------------------------------------------
// Books — who works which players
// ---------------------------------------------------------------------------

export const crmBooks = pgTable(
  'crm_books',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant: varchar('tenant', { length: 128 }).notNull(),
    name: varchar('name', { length: 80 }).notNull(),
    description: varchar('description', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('crm_books_tenant_name_key').on(t.tenant, sql`lower(${t.name})`)]
)

export const crmBookMembers = pgTable(
  'crm_book_members',
  {
    bookId: uuid('book_id')
      .notNull()
      .references(() => crmBooks.id, { onDelete: 'cascade' }),
    crmUserId: uuid('crm_user_id')
      .notNull()
      .references(() => crmUsers.id, { onDelete: 'cascade' }),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.bookId, t.crmUserId] }),
    index('crm_book_members_book_idx').on(t.bookId),
    index('crm_book_members_user_idx').on(t.crmUserId),
  ]
)

/**
 * A player belongs to at most one book, which is what makes ownership
 * meaningful: exactly one desk is accountable for them. Reassignment moves the
 * row rather than adding a second.
 *
 * `playerId` is `users.id` (integer). Deliberately no foreign key to `users` —
 * that table is written by the whole platform, and a CRM-side cascade must
 * never be able to reach it. Orphans are swept, not cascaded.
 */
export const crmPlayerAssignments = pgTable(
  'crm_player_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant: varchar('tenant', { length: 128 }).notNull(),
    playerId: integer('player_id').notNull(),
    bookId: uuid('book_id')
      .notNull()
      .references(() => crmBooks.id, { onDelete: 'cascade' }),
    /** Optional named owner within the book. */
    ownerId: uuid('owner_id').references(() => crmUsers.id, { onDelete: 'set null' }),
    assignedBy: varchar('assigned_by', { length: 128 }),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('crm_player_assignments_tenant_player_key').on(t.tenant, t.playerId),
    index('crm_player_assignments_book_idx').on(t.bookId),
    index('crm_player_assignments_owner_idx').on(t.ownerId),
    index('crm_player_assignments_tenant_idx').on(t.tenant),
  ]
)

// ---------------------------------------------------------------------------
// Session security
// ---------------------------------------------------------------------------

/**
 * Per-CRM-user address allowlist. Separate from `admin_ip_allowlist` because
 * that table keys on an integer admin user id and these users are uuids —
 * sharing it would put two id spaces in one column.
 *
 * Enforced only when the tenant has `enforceIpAllowlist` on and the user has at
 * least one entry, so the default stays open rather than locking a tenant out
 * of its own CRM.
 */
export const crmIpAllowlist = pgTable(
  'crm_ip_allowlist',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant: varchar('tenant', { length: 128 }).notNull(),
    crmUserId: uuid('crm_user_id')
      .notNull()
      .references(() => crmUsers.id, { onDelete: 'cascade' }),
    /** A single address or a CIDR range, e.g. "203.0.113.7" or "203.0.113.0/24". */
    cidr: varchar('cidr', { length: 64 }).notNull(),
    label: varchar('label', { length: 120 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('crm_ip_allowlist_user_cidr_key').on(t.crmUserId, t.cidr),
    index('crm_ip_allowlist_tenant_idx').on(t.tenant),
  ]
)

/**
 * Every sign-in attempt, successful or not. A CRM desk holds player identity
 * and financial data, so who reached it and from where belongs in the record
 * rather than being reconstructed from application logs.
 */
export const crmLoginAttempts = pgTable(
  'crm_login_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant: varchar('tenant', { length: 128 }).notNull(),
    /** Null when the username matched nothing — the attempt still matters. */
    crmUserId: uuid('crm_user_id').references(() => crmUsers.id, { onDelete: 'set null' }),
    username: varchar('username', { length: 120 }).notNull(),
    success: boolean('success').notNull(),
    /** bad_password | unknown_user | suspended | locked | ip_blocked | crm_disabled */
    reason: varchar('reason', { length: 40 }),
    ipAddress: varchar('ip_address', { length: 64 }),
    userAgent: varchar('user_agent', { length: 512 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('crm_login_attempts_tenant_created_idx').on(t.tenant, t.createdAt),
    index('crm_login_attempts_user_idx').on(t.crmUserId),
  ]
)

// ---------------------------------------------------------------------------
// Read auditing
// ---------------------------------------------------------------------------

/**
 * A CRM user opening a player reads their phone number, deposit history and
 * identity documents. Auditing writes alone cannot answer the question an
 * investigation actually asks — *who looked at this player* — so reads of
 * personal data are recorded too.
 *
 * Written on the read path, so it is fire-and-forget: a failure here must never
 * fail the query the user asked for.
 */
export const crmPiiAccessLog = pgTable(
  'crm_pii_access_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant: varchar('tenant', { length: 128 }).notNull(),
    crmUserId: uuid('crm_user_id').references(() => crmUsers.id, { onDelete: 'set null' }),
    /** 'player' today; 'export' and 'document' follow in later phases. */
    resourceType: varchar('resource_type', { length: 40 }).notNull(),
    resourceId: varchar('resource_id', { length: 128 }).notNull(),
    /** view | search | export */
    action: varchar('action', { length: 24 }).notNull(),
    /** Which sensitive fields the response actually carried. */
    fields: text('fields').array(),
    ipAddress: varchar('ip_address', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('crm_pii_access_log_tenant_created_idx').on(t.tenant, t.createdAt),
    index('crm_pii_access_log_user_idx').on(t.crmUserId),
    index('crm_pii_access_log_resource_idx').on(t.tenant, t.resourceType, t.resourceId),
  ]
)

// ===========================================================================
// Phase 2
//
// Notes, tags, consent, responsible gambling, tasks and the desk's own inbox.
//
// Three conventions carry over from Phase 1 and are not restated per table:
// `player_id` is `users.id` as a bare integer with no foreign key, every row
// carries `tenant`, and every foreign key has a leading index.
// ===========================================================================

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

/**
 * What operators write about a player.
 *
 * This fills a contract that already exists: `PlayerNote` and `addPlayerNote`
 * are declared in the admin schema and the admin panel's Notes tab was built
 * against them, but the query has returned an empty list and the mutation has
 * thrown since CRM v1 was removed. One store, two surfaces — and deliberately
 * two resolvers, because the scope check differs: the CRM reaches a player
 * through books, the admin panel through its own permissions. A single resolver
 * would have to guess which caller it had, and would guess wrong.
 *
 * `labels` is the free-text array the shipped `PlayerNote` contract carries —
 * labels on a *note* ("callback", "chased"). It is not `crm_tags`, which labels
 * a *player*. Conflating them would lose both.
 */
export const crmPlayerNotes = pgTable(
  'crm_player_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant: varchar('tenant', { length: 128 }).notNull(),
    playerId: integer('player_id').notNull(),
    body: text('body').notNull(),
    category: varchar('category', { length: 32 }),
    labels: text('labels').array().notNull().default(sql`'{}'`),
    isPinned: boolean('is_pinned').notNull().default(false),
    /**
     * Who may read it. An operator recording "suspected bonus abuse, do not
     * disclose" needs somewhere to put it that the other surface cannot see.
     */
    visibility: varchar('visibility', { length: 16 }).notNull().default('all'),
    /**
     * Typed author columns rather than one polymorphic varchar: the two
     * applications keep their users in different tables with different key
     * types, and exactly one applies. This mirrors what `notifications` already
     * does with user_id / agent_id / whitelabel_id.
     */
    authorCrmUserId: uuid('author_crm_user_id').references(() => crmUsers.id, {
      onDelete: 'set null',
    }),
    authorAdminUserId: integer('author_admin_user_id'),
    /** Snapshotted, so a note still says who wrote it after that account is gone. */
    authorName: varchar('author_name', { length: 120 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Soft delete. There is no edit path in Phase 2, so a note cannot be quietly rewritten. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: varchar('deleted_by', { length: 64 }),
  },
  (t) => [
    /**
     * At most one author column, not exactly one.
     *
     * `author_crm_user_id` is `ON DELETE SET NULL` so that a note survives the
     * account that wrote it — `author_name` is snapshotted for exactly that
     * case. Demanding `= 1` made those two decisions contradict each other:
     * deleting any CRM user who had ever written a note raised
     * `crm_player_notes_one_author` and the delete failed outright. Measured —
     * `crmDeleteUser` was unusable for essentially every real desk user.
     *
     * Both columns set is still refused; that is the ambiguity the check exists
     * to prevent. Both null means the CRM author's account is gone, and
     * `authorKind` reads it that way because an admin author is a plain integer
     * with no foreign key and is therefore never nulled.
     */
    check('crm_player_notes_one_author', sql`num_nonnulls(${t.authorCrmUserId}, ${t.authorAdminUserId}) <= 1`),
    check('crm_player_notes_visibility', sql`${t.visibility} in ('all','crm_only','admin_only')`),
    index('crm_player_notes_player_idx')
      .on(t.tenant, t.playerId, t.isPinned.desc(), t.createdAt.desc())
      .where(sql`deleted_at is null`),
    index('crm_player_notes_author_idx').on(t.authorCrmUserId),
  ]
)

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

/**
 * The whitelabel's own vocabulary for labelling players.
 *
 * A vocabulary rather than free text, because the point of a tag is that two
 * agents pick the same one. The platform's nearest existing thing is an input
 * box whose placeholder reads "e.g., SUSPICIOUS, HIGH_RISK", which is how you
 * end up with SUSPICIOUS, Suspicious and suspicous.
 *
 * Tags are archived and merged rather than deleted: six months in, a desk has
 * near-duplicates, and the only safe way to tidy them is to point one at
 * another and keep both readable.
 */
export const crmTags = pgTable(
  'crm_tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant: varchar('tenant', { length: 128 }).notNull(),
    name: varchar('name', { length: 60 }).notNull(),
    colour: varchar('colour', { length: 7 }).notNull().default('#6b7280'),
    description: varchar('description', { length: 255 }),
    createdBy: varchar('created_by', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    mergedIntoId: uuid('merged_into_id'),
  },
  (t) => [
    check('crm_tags_colour_hex', sql`${t.colour} ~ '^#[0-9a-fA-F]{6}$'`),
    uniqueIndex('crm_tags_tenant_name_key').on(t.tenant, sql`lower(${t.name})`),
    index('crm_tags_live_idx').on(t.tenant).where(sql`archived_at is null`),
    index('crm_tags_merged_into_idx').on(t.mergedIntoId),
  ]
)

/**
 * Which players carry which tags.
 *
 * Keyed on (player, tag) so applying a tag twice is a no-op. The second index
 * leads with `tag_id` because the query that matters at scale is "the players
 * carrying this tag" — a filter must be able to drive from here and join
 * `users`, not scan 40,000 players asking each one.
 */
export const crmPlayerTags = pgTable(
  'crm_player_tags',
  {
    tenant: varchar('tenant', { length: 128 }).notNull(),
    playerId: integer('player_id').notNull(),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => crmTags.id, { onDelete: 'cascade' }),
    taggedBy: varchar('tagged_by', { length: 64 }).notNull(),
    taggedAt: timestamp('tagged_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.playerId, t.tagId] }),
    index('crm_player_tags_tag_idx').on(t.tagId, t.playerId),
    index('crm_player_tags_tenant_idx').on(t.tenant),
  ]
)

// ---------------------------------------------------------------------------
// Responsible gambling
// ---------------------------------------------------------------------------

/**
 * One row per *episode*, not one row per player.
 *
 * A player can self-exclude, be reinstated, and self-exclude again. A
 * current-state table would UPDATE over the first episode and lose when it
 * started, who raised it and who lifted it — and "how many times has this
 * player self-excluded" is the question a regulator actually asks. The partial
 * unique below is what keeps only one episode of a kind active at a time, and
 * it also makes a concurrent double-raise fail loudly with 23505 rather than
 * silently overwriting.
 *
 * Enforcement does **not** live here. `users.rg_blocked_until` carries it, for
 * reasons written on that column. Only `SELF_EXCLUSION` and `COOLING_OFF` set
 * `blocks_play`; the rest are annotations that create work, not controls.
 */
export const crmPlayerRgFlags = pgTable(
  'crm_player_rg_flags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant: varchar('tenant', { length: 128 }).notNull(),
    playerId: integer('player_id').notNull(),
    flagType: varchar('flag_type', { length: 32 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('ACTIVE'),
    /** Whether the player asked, or the operator decided. They are not the same act. */
    initiatedBy: varchar('initiated_by', { length: 16 }).notNull(),
    blocksPlay: boolean('blocks_play').notNull().default(false),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull().defaultNow(),
    /** The earliest a self-exclusion may be lifted. Required for SELF_EXCLUSION. */
    minTermEndsAt: timestamp('min_term_ends_at', { withTimezone: true }),
    /** Null means indefinite. For COOLING_OFF this is when the block lapses by itself. */
    endsAt: timestamp('ends_at', { withTimezone: true }),
    /**
     * Reinstatement is two steps on purpose. Reaching `ends_at` does nothing to
     * a self-exclusion: the player asks, a waiting period runs, and only then
     * does it take effect.
     */
    reinstatementRequestedAt: timestamp('reinstatement_requested_at', { withTimezone: true }),
    reinstatementEffectiveAt: timestamp('reinstatement_effective_at', { withTimezone: true }),
    /** What the player was holding when they were blocked, so nobody has to reconstruct it. */
    balanceAtBlock: numeric('balance_at_block', { precision: 18, scale: 2 }),
    reason: text('reason'),
    /** 'crm:<uuid>' | 'admin:<int>' | 'player' */
    raisedBy: varchar('raised_by', { length: 64 }).notNull(),
    raisedAt: timestamp('raised_at', { withTimezone: true }).notNull().defaultNow(),
    liftedBy: varchar('lifted_by', { length: 64 }),
    liftedAt: timestamp('lifted_at', { withTimezone: true }),
    liftReason: text('lift_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'crm_rg_flag_type',
      sql`${t.flagType} in ('SELF_EXCLUSION','COOLING_OFF','DEPOSIT_ESCALATION','LOSS_CHASING','SESSION_LENGTH','AFFORDABILITY_CONCERN')`
    ),
    check('crm_rg_status', sql`${t.status} in ('ACTIVE','LIFTED','EXPIRED')`),
    check('crm_rg_initiated_by', sql`${t.initiatedBy} in ('player','operator')`),
    // A LIFTED episode without a lift time, or a lift time without LIFTED, is a
    // half-written transaction; neither should be representable.
    check('crm_rg_lifted_consistency', sql`(${t.status} = 'LIFTED') = (${t.liftedAt} is not null)`),
    check(
      'crm_rg_self_exclusion_min_term',
      sql`${t.flagType} <> 'SELF_EXCLUSION' or ${t.minTermEndsAt} is not null`
    ),
    uniqueIndex('crm_player_rg_flags_active_key')
      .on(t.tenant, t.playerId, t.flagType)
      .where(sql`status = 'ACTIVE'`),
    index('crm_player_rg_flags_player_idx').on(t.tenant, t.playerId, t.startsAt.desc()),
    index('crm_player_rg_flags_expiry_idx')
      .on(t.endsAt)
      .where(sql`status = 'ACTIVE' and ends_at is not null`),
    index('crm_player_rg_flags_type_idx')
      .on(t.tenant, t.flagType, t.startsAt.desc())
      .where(sql`status = 'ACTIVE'`),
  ]
)

/**
 * Identifiers that must not be able to open a second account.
 *
 * An exclusion attached only to an account id is evaded by registering again
 * with the same phone. The identifier is stored hashed with a per-tenant salt
 * so the register itself is not a list of excluded people's phone numbers.
 */
export const crmExclusionRegister = pgTable(
  'crm_exclusion_register',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant: varchar('tenant', { length: 128 }).notNull(),
    identifierKind: varchar('identifier_kind', { length: 16 }).notNull(),
    /** sha256(normalised value + per-tenant salt). */
    identifierHash: varchar('identifier_hash', { length: 64 }).notNull(),
    sourceFlagId: uuid('source_flag_id')
      .notNull()
      .references(() => crmPlayerRgFlags.id, { onDelete: 'restrict' }),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('crm_exclusion_identifier_kind', sql`${t.identifierKind} in ('phone','email')`),
    uniqueIndex('crm_exclusion_register_live_key')
      .on(t.tenant, t.identifierKind, t.identifierHash)
      .where(sql`released_at is null`),
    index('crm_exclusion_register_flag_idx').on(t.sourceFlagId),
  ]
)

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

/**
 * Current permission to contact a player, per channel and per purpose.
 *
 * Purpose is in the key because SMS carries one-time codes, service notices and
 * marketing, and a single row per channel would force the sender into a
 * decision the data cannot support — withdraw marketing and you would also stop
 * the login code.
 *
 * There is no NEVER_ASKED state. The absence of a row is that, and a state
 * meaning "no state" invites an upsert path that can overwrite a WITHDRAWN
 * suppression, which is the one row that must never be lost.
 */
export const crmPlayerConsents = pgTable(
  'crm_player_consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant: varchar('tenant', { length: 128 }).notNull(),
    playerId: integer('player_id').notNull(),
    channel: varchar('channel', { length: 16 }).notNull(),
    purpose: varchar('purpose', { length: 16 }).notNull(),
    state: varchar('state', { length: 16 }).notNull(),
    stateSince: timestamp('state_since', { withTimezone: true }).notNull().defaultNow(),
    grantedAt: timestamp('granted_at', { withTimezone: true }),
    lastAskedAt: timestamp('last_asked_at', { withTimezone: true }),
    source: varchar('source', { length: 24 }).notNull(),
    /** Which wording they agreed to, so "what did they consent to" is answerable. */
    consentTextVersion: varchar('consent_text_version', { length: 40 }),
    evidenceRef: varchar('evidence_ref', { length: 200 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('crm_consent_channel', sql`${t.channel} in ('SMS','WHATSAPP','EMAIL','PUSH','CALL')`),
    check('crm_consent_purpose', sql`${t.purpose} in ('MARKETING','SERVICE')`),
    check('crm_consent_state', sql`${t.state} in ('GRANTED','WITHDRAWN','REFUSED')`),
    check(
      'crm_consent_source',
      sql`${t.source} in ('SIGNUP_FORM','PLAYER_PORTAL','AGENT_VERBAL','IMPORT','ADMIN','RG_AUTO')`
    ),
    uniqueIndex('crm_player_consents_key').on(t.tenant, t.playerId, t.channel, t.purpose),
    index('crm_player_consents_granted_idx')
      .on(t.tenant, t.purpose, t.channel, t.playerId)
      .where(sql`state = 'GRANTED'`),
  ]
)

/**
 * Every transition, append-only.
 *
 * The state row above is derived from these, never upserted independently:
 * insert the event and set the state in one transaction, so the two can never
 * disagree. Nothing deletes from here — a withdrawal that vanishes is
 * indistinguishable from one that never happened.
 */
export const crmConsentEvents = pgTable(
  'crm_consent_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant: varchar('tenant', { length: 128 }).notNull(),
    playerId: integer('player_id').notNull(),
    channel: varchar('channel', { length: 16 }).notNull(),
    purpose: varchar('purpose', { length: 16 }).notNull(),
    /** Null on the first record for this (channel, purpose). */
    fromState: varchar('from_state', { length: 16 }),
    toState: varchar('to_state', { length: 16 }).notNull(),
    source: varchar('source', { length: 24 }).notNull(),
    consentTextVersion: varchar('consent_text_version', { length: 40 }),
    evidenceRef: varchar('evidence_ref', { length: 200 }),
    ipAddress: varchar('ip_address', { length: 64 }),
    userAgent: varchar('user_agent', { length: 512 }),
    actorKind: varchar('actor_kind', { length: 16 }).notNull(),
    actorId: varchar('actor_id', { length: 64 }),
    reason: varchar('reason', { length: 200 }),
    /**
     * `clock_timestamp()`, not `now()`.
     *
     * `now()` is the *transaction* start time, and this table is written from
     * inside long transactions — `raiseRgFlag` withdraws marketing consent on
     * five channels partway through a dozen other statements. Two events could
     * therefore be stamped in the opposite order to the one they actually took
     * effect in, while the state row they derive follows commit order. That
     * disagreement is exactly what `findConsentDisagreements` exists to catch,
     * so it must not be able to manufacture one.
     */
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    /**
     * Insertion order, so "the newest event" is a total order rather than a
     * timestamp with a random-uuid tiebreak.
     */
    seq: bigserial('seq', { mode: 'number' }).notNull(),
  },
  (t) => [
    check('crm_consent_event_actor_kind', sql`${t.actorKind} in ('crm','admin','player','system')`),
    // A verbal grant or a bulk import is a claim about something that happened
    // off-system. Without a pointer to the recording or the file, it is
    // unfalsifiable, so the database refuses it.
    check(
      'crm_consent_event_evidence',
      sql`${t.source} not in ('AGENT_VERBAL','IMPORT') or ${t.evidenceRef} is not null`
    ),
    index('crm_consent_events_player_idx').on(t.tenant, t.playerId, t.createdAt.desc()),
    index('crm_consent_events_channel_idx').on(t.tenant, t.channel, t.createdAt.desc()),
    index('crm_consent_events_seq_idx').on(t.tenant, t.playerId, t.channel, t.purpose, t.seq.desc()),
  ]
)

// ---------------------------------------------------------------------------
// Tasks and the queue
// ---------------------------------------------------------------------------

/**
 * The work a desk owes a player.
 *
 * `book_id` is NOT NULL and kept current: a task belongs to whichever desk owns
 * the player now, so reassigning a player moves their open work with them
 * rather than stranding it with whoever used to hold them. The reference is
 * `restrict` for the same reason a book with players cannot be deleted.
 *
 * `breach_at` is generated rather than written, so no code path can create a
 * task whose deadline disagrees with its SLA, and the sweep can index it.
 */
export const crmTasks = pgTable(
  'crm_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant: varchar('tenant', { length: 128 }).notNull(),
    /** Null for work that is about the desk rather than a player. */
    playerId: integer('player_id'),
    bookId: uuid('book_id')
      .notNull()
      .references(() => crmBooks.id, { onDelete: 'restrict' }),
    assigneeId: uuid('assignee_id').references(() => crmUsers.id, { onDelete: 'set null' }),
    createdBy: varchar('created_by', { length: 64 }).notNull(),
    /** manual | rg_flag | payout | rule:<name> */
    source: varchar('source', { length: 32 }).notNull().default('manual'),
    /**
     * Stops an automatic source raising the same task every sweep. Unique only
     * among tasks that are still open, so the same condition recurring after a
     * task was closed legitimately raises a new one.
     */
    dedupeKey: varchar('dedupe_key', { length: 120 }),
    title: varchar('title', { length: 160 }).notNull(),
    body: text('body'),
    priority: varchar('priority', { length: 8 }).notNull().default('NORMAL'),
    status: varchar('status', { length: 16 }).notNull().default('OPEN'),
    /** What actually happened. A task closed with no outcome tells the next person nothing. */
    outcome: varchar('outcome', { length: 24 }),
    /** Computed against the whitelabel's desk calendar when the task is created. */
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    slaMinutes: integer('sla_minutes').notNull(),
    /**
     * When the SLA is missed. Written by the caller, but constrained below so a
     * wrong value is impossible.
     *
     * This wanted to be a generated column and cannot be: Postgres requires a
     * generation expression to be immutable, and `timestamptz + interval` is
     * only stable — interval arithmetic can depend on the session timezone. A
     * CHECK accepts the same expression and enforces the same invariant, which
     * is what was actually wanted: no code path can create a task whose breach
     * time disagrees with its deadline and SLA.
     */
    breachAt: timestamp('breach_at', { withTimezone: true }).notNull(),
    escalationLevel: integer('escalation_level').notNull().default(0),
    nextEscalationAt: timestamp('next_escalation_at', { withTimezone: true }),
    /** Acknowledgement stops the ladder. Escalating forever is noise, not urgency. */
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    acknowledgedBy: uuid('acknowledged_by').references(() => crmUsers.id, { onDelete: 'set null' }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('crm_tasks_priority', sql`${t.priority} in ('LOW','NORMAL','HIGH','URGENT')`),
    check('crm_tasks_status', sql`${t.status} in ('OPEN','IN_PROGRESS','BLOCKED','DONE','CANCELLED')`),
    check(
      'crm_tasks_outcome',
      sql`${t.outcome} is null or ${t.outcome} in ('contacted','no_answer','wrong_number','refused','resolved','not_required')`
    ),
    check('crm_tasks_sla_min', sql`${t.slaMinutes} >= 5`),
    check('crm_tasks_done_consistency', sql`(${t.status} = 'DONE') = (${t.completedAt} is not null)`),
    check('crm_tasks_done_outcome', sql`${t.status} <> 'DONE' or ${t.outcome} is not null`),
    check(
      'crm_tasks_breach_at_derived',
      sql`${t.breachAt} = ${t.dueAt} + make_interval(mins => ${t.slaMinutes})`
    ),
    uniqueIndex('crm_tasks_dedupe_key')
      .on(t.tenant, t.dedupeKey)
      .where(sql`dedupe_key is not null and status in ('OPEN','IN_PROGRESS','BLOCKED')`),
    index('crm_tasks_assignee_open_idx')
      .on(t.assigneeId, t.dueAt)
      .where(sql`status in ('OPEN','IN_PROGRESS')`),
    index('crm_tasks_book_open_idx')
      .on(t.bookId, t.dueAt)
      .where(sql`status in ('OPEN','IN_PROGRESS')`),
    index('crm_tasks_player_idx')
      .on(t.tenant, t.playerId, t.createdAt.desc())
      .where(sql`player_id is not null`),
    // The sweep's own index: unacknowledged work whose next escalation is due.
    index('crm_tasks_sweep_idx')
      .on(t.nextEscalationAt)
      .where(sql`acknowledged_at is null and status in ('OPEN','IN_PROGRESS')`),
    index('crm_tasks_breach_idx')
      .on(t.breachAt)
      .where(sql`escalation_level = 0 and status in ('OPEN','IN_PROGRESS')`),
    index('crm_tasks_acknowledged_by_idx').on(t.acknowledgedBy),
  ]
)

/** Everything that happened to a task. Reassignment and status changes matter on a desk. */
export const crmTaskEvents = pgTable(
  'crm_task_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant: varchar('tenant', { length: 128 }).notNull(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => crmTasks.id, { onDelete: 'cascade' }),
    /** created | assigned | status | book_moved | escalated | escalation_failed | acknowledged */
    kind: varchar('kind', { length: 32 }).notNull(),
    actor: varchar('actor', { length: 64 }),
    fromValue: varchar('from_value', { length: 64 }),
    toValue: varchar('to_value', { length: 64 }),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('crm_task_events_task_idx').on(t.taskId, t.createdAt)]
)

/**
 * Who was told about a breaching task, at which rung.
 *
 * Recorded rather than inferred so "successfully escalated to nobody" is not a
 * representable state: an empty recipient set writes an `escalation_failed`
 * event instead and leaves the task breaching for the next sweep.
 */
export const crmTaskEscalations = pgTable(
  'crm_task_escalations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant: varchar('tenant', { length: 128 }).notNull(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => crmTasks.id, { onDelete: 'cascade' }),
    level: integer('level').notNull(),
    crmUserId: uuid('crm_user_id').references(() => crmUsers.id, { onDelete: 'set null' }),
    notifiedAt: timestamp('notified_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('crm_task_escalations_key').on(t.taskId, t.level, t.crmUserId),
    index('crm_task_escalations_user_idx').on(t.crmUserId, t.notifiedAt.desc()),
  ]
)

/**
 * Every time someone tried to reach a player.
 *
 * This is what `playerCommLog` was always meant to show — it has been a stub
 * returning an empty list. It is a record of attempts, not of sends: the
 * platform has no player-messaging path from this process, and an agent picking
 * up the phone is the contact that actually happens today.
 */
export const crmContactAttempts = pgTable(
  'crm_contact_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant: varchar('tenant', { length: 128 }).notNull(),
    playerId: integer('player_id').notNull(),
    taskId: uuid('task_id').references(() => crmTasks.id, { onDelete: 'set null' }),
    channel: varchar('channel', { length: 16 }).notNull(),
    direction: varchar('direction', { length: 8 }).notNull().default('out'),
    outcome: varchar('outcome', { length: 24 }).notNull(),
    notes: varchar('notes', { length: 500 }),
    byCrmUserId: uuid('by_crm_user_id').references(() => crmUsers.id, { onDelete: 'set null' }),
    byName: varchar('by_name', { length: 120 }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('crm_contact_direction', sql`${t.direction} in ('out','in')`),
    check(
      'crm_contact_outcome',
      sql`${t.outcome} in ('connected','no_answer','wrong_number','refused','voicemail','busy')`
    ),
    index('crm_contact_attempts_player_idx').on(t.tenant, t.playerId, t.occurredAt.desc()),
    index('crm_contact_attempts_task_idx').on(t.taskId),
    index('crm_contact_attempts_user_idx').on(t.byCrmUserId),
  ]
)

// ---------------------------------------------------------------------------
// The desk's own inbox
// ---------------------------------------------------------------------------

/**
 * Notifications addressed to a CRM user.
 *
 * The platform's `notifications` table keys on player, agent and whitelabel —
 * it has no way to address a CRM user, and teaching it one would mean every
 * existing reader learning to ignore rows it does not understand. A separate
 * table costs less and cannot break what already works.
 *
 * The read query never takes a user argument: it uses the caller's own id, so
 * reading someone else's inbox is not expressible rather than merely refused.
 */
export const crmNotifications = pgTable(
  'crm_notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant: varchar('tenant', { length: 128 }).notNull(),
    crmUserId: uuid('crm_user_id')
      .notNull()
      .references(() => crmUsers.id, { onDelete: 'cascade' }),
    /** task_assigned | task_escalated | rg_flag | consent_withdrawn | system */
    kind: varchar('kind', { length: 32 }).notNull(),
    title: varchar('title', { length: 160 }).notNull(),
    body: varchar('body', { length: 500 }),
    resourceType: varchar('resource_type', { length: 24 }),
    resourceId: varchar('resource_id', { length: 64 }),
    /** Stops an hourly sweep telling the same person the same thing forty times. */
    dedupeKey: varchar('dedupe_key', { length: 120 }),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('crm_notifications_dedupe_key')
      .on(t.crmUserId, t.dedupeKey)
      .where(sql`dedupe_key is not null`),
    index('crm_notifications_unread_idx')
      .on(t.crmUserId, t.createdAt.desc())
      .where(sql`read_at is null`),
    index('crm_notifications_tenant_idx').on(t.tenant, t.createdAt),
  ]
)

// ---------------------------------------------------------------------------
// Saved segments
// ---------------------------------------------------------------------------

/**
 * A saved player filter.
 *
 * **This stores a filter, not a set of players.** That is the property the
 * whole feature rests on: the rows a segment yields are still resolved through
 * `bookScopeCondition` at read time, so two people opening the same shared
 * segment see different players, and sharing one discloses nothing. Storing
 * resolved player ids instead would turn every share into a data leak and every
 * saved segment into a snapshot that silently goes stale.
 *
 * `filter` holds a `CrmPlayerFilterInput` as it was saved. It is validated
 * against the known filter keys before being stored, so a segment cannot smuggle
 * a field the player query does not expect.
 *
 * `ownerId` is `set null` rather than `cascade`: a shared segment is a
 * statement about the desk's work and must outlive the person who wrote it. A
 * personal segment whose owner is gone is visible to nobody, and
 * `deleteCrmUser` removes those explicitly rather than leaving them behind.
 */
export const crmSegments = pgTable(
  'crm_segments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant: varchar('tenant', { length: 128 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    description: varchar('description', { length: 500 }),
    /** A CrmPlayerFilterInput, as saved. Never a list of player ids. */
    filter: jsonb('filter').notNull(),
    ownerId: uuid('owner_id').references(() => crmUsers.id, { onDelete: 'set null' }),
    /** Shared segments are offered to the whole whitelabel; scoping still applies per reader. */
    isShared: boolean('is_shared').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One person cannot have two of their own by the same name. Two people may:
    // "My chases" means something different to each of them.
    uniqueIndex('crm_segments_owner_name_key').on(t.tenant, t.ownerId, t.name),
    index('crm_segments_tenant_shared_idx').on(t.tenant, t.isShared),
    index('crm_segments_owner_idx').on(t.ownerId),
  ]
)
