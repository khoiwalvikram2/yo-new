/**
 * The CRM permission catalogue.
 *
 * A whitelabel builds its own roles out of these pairs, so this list is the
 * whole vocabulary its role editor can offer. It contains only permissions that
 * something actually enforces today — declaring `campaigns:send` before
 * campaigns exist would let a whitelabel grant an authority that nothing
 * checks, which reads as protection and is not.
 *
 * Each phase adds its own entries as the features that honour them land.
 */

export type CrmPermission = {
  domain: string
  action: string
  /** Shown in the whitelabel's role editor. */
  label: string
  description: string
}

export type CrmPermissionGroup = {
  domain: string
  label: string
  description: string
  actions: CrmPermission[]
}

export const CRM_PERMISSIONS: CrmPermissionGroup[] = [
  { domain:'crm.chat',label:'Live chat',description:'Support conversations for players in your CRM books',actions:[
    {domain:'crm.chat',action:'view',label:'Open support inbox',description:'Read chats within your existing player book access'},
    {domain:'crm.chat',action:'reply',label:'Reply to players',description:'Join and answer support conversations'},
    {domain:'crm.chat',action:'assign',label:'Manage conversations',description:'Transfer, resolve and reopen accessible conversations'},
  ]},
  {
    domain: 'crm.players',
    label: 'Players',
    description: 'Access to player records and their history',
    actions: [
      {
        domain: 'crm.players',
        action: 'view',
        label: 'View players',
        description: 'Open players in the books this user belongs to',
      },
      {
        domain: 'crm.players',
        action: 'view_all',
        label: 'View all players',
        description:
          'Reach every player in the whitelabel, ignoring book membership. Intended for supervisors.',
      },
      {
        domain: 'crm.players',
        action: 'export',
        label: 'Export players',
        description: 'Download player lists. Every export is recorded against this user.',
      },
    ],
  },
  {
    domain: 'crm.notes',
    label: 'Notes',
    description: 'What the desk records about a player',
    actions: [
      {
        domain: 'crm.notes',
        action: 'view',
        label: 'Read notes',
        description: 'See the notes on players this user can already reach',
      },
      {
        domain: 'crm.notes',
        action: 'create',
        label: 'Write notes',
        description: 'Add a note. Notes cannot be edited afterwards, only removed.',
      },
      {
        domain: 'crm.notes',
        action: 'delete',
        label: 'Remove notes',
        description:
          'Take a note out of the list. It stays in the record, so who wrote what is never lost.',
      },
    ],
  },
  {
    domain: 'crm.tags',
    label: 'Tags',
    description: 'How players are labelled',
    actions: [
      {
        domain: 'crm.tags',
        action: 'apply',
        label: 'Tag players',
        description: 'Put existing tags on players, and take them off again',
      },
      {
        domain: 'crm.tags',
        action: 'manage',
        label: 'Manage the tag list',
        description:
          'Create, rename, recolour, archive and merge tags. This changes what every filter and report is built on.',
      },
    ],
  },
  {
    domain: 'crm.rg',
    label: 'Responsible gambling',
    description: 'Flags that record — and enforce — a player\'s protection',
    actions: [
      {
        domain: 'crm.rg',
        action: 'view',
        label: 'See flags',
        description: 'Read a player\'s responsible gambling history',
      },
      {
        domain: 'crm.rg',
        action: 'flag',
        label: 'Raise a flag',
        description:
          'Record a concern, a cooling-off period or a self-exclusion. Blocking flags stop staking and deposits immediately.',
      },
      {
        domain: 'crm.rg',
        action: 'lift',
        label: 'Lift a flag',
        description:
          'End a block. Deliberately separate: it cannot be done by whoever raised it, nor before a minimum term.',
      },
    ],
  },
  {
    domain: 'crm.consent',
    label: 'Contact permission',
    description: 'Whether a player agreed to be contacted, and on what',
    actions: [
      {
        domain: 'crm.consent',
        action: 'view',
        label: 'See consent',
        description: 'Read what a player has agreed to and when',
      },
      {
        domain: 'crm.consent',
        action: 'record',
        label: 'Record a withdrawal',
        description:
          'Mark a player as withdrawn or refused. Never blocked — a player asking to be left alone always succeeds.',
      },
      {
        domain: 'crm.consent',
        action: 'restore',
        label: 'Record a grant',
        description:
          'Mark a player as consenting again. Separate because this is the direction that lets them be contacted.',
      },
    ],
  },
  {
    domain: 'crm.tasks',
    label: 'Tasks',
    description: 'The work the desk owes players, and what happens when it is late',
    actions: [
      {
        domain: 'crm.tasks',
        action: 'view',
        label: 'See the queue',
        description: 'Read tasks in the books this user works',
      },
      {
        domain: 'crm.tasks',
        action: 'manage',
        label: 'Work tasks',
        description: 'Create, assign, progress and close tasks',
      },
      {
        domain: 'crm.tasks',
        action: 'escalate',
        label: 'Receive escalations',
        description:
          'Be told when a task in your books breaches its deadline, and acknowledge it so the ladder stops.',
      },
    ],
  },
  {
    domain: 'crm.books',
    label: 'Books',
    description: 'How players are divided between desks',
    actions: [
      { domain: 'crm.books', action: 'view', label: 'View books', description: 'See books and their members' },
      {
        domain: 'crm.books',
        action: 'manage',
        label: 'Manage books',
        description: 'Create books, change their membership, and move players between them',
      },
    ],
  },
  {
    domain: 'crm.users',
    label: 'CRM users',
    description: 'Who may sign in to this CRM',
    actions: [
      { domain: 'crm.users', action: 'view', label: 'View CRM users', description: 'See the user list' },
      {
        domain: 'crm.users',
        action: 'manage',
        label: 'Manage CRM users',
        description: 'Create users, reset passwords, and suspend access',
      },
    ],
  },
  {
    domain: 'crm.roles',
    label: 'Roles',
    description: 'What each role is allowed to do',
    actions: [
      { domain: 'crm.roles', action: 'view', label: 'View roles', description: 'See roles and their permissions' },
      {
        domain: 'crm.roles',
        action: 'manage',
        label: 'Manage roles',
        description: 'Create roles and change what they grant',
      },
    ],
  },
  {
    domain: 'crm.dsar',
    label: 'Data requests',
    description: 'A player’s right to a copy of their data, and to the removal of what was written about them',
    actions: [
      {
        domain: 'crm.dsar',
        action: 'export',
        label: 'Export a player’s data',
        description:
          'Produce everything the CRM holds on one player as a single document. Reaches any player of the whitelabel, and every export is recorded.',
      },
      {
        domain: 'crm.dsar',
        action: 'erase',
        label: 'Erase free text about a player',
        description:
          'Redact the prose staff wrote about a player — notes, contact notes, task text. Never touches the exclusion register, responsible-gambling history or consent records, which the law requires kept.',
      },
    ],
  },
  {
    domain: 'crm.reports',
    label: 'Reports',
    description: 'How the desk performed over a period',
    actions: [
      {
        domain: 'crm.reports',
        action: 'view',
        label: 'See desk reports',
        description:
          'Throughput, deadlines, contact outcomes and per-person activity for the books this user works. A separate grant from seeing the queue: the queue is your own work, a report is everybody’s.',
      },
    ],
  },
  {
    domain: 'crm.settings',
    label: 'Desk settings',
    description: 'When the desk works, which every deadline is computed against',
    actions: [
      {
        domain: 'crm.settings',
        action: 'view',
        label: 'See desk settings',
        description:
          'Read the working calendar. A supervisor reading Desk health needs to know which hours its breach numbers were measured against.',
      },
      {
        domain: 'crm.settings',
        action: 'manage',
        label: 'Change desk settings',
        description:
          'Set the timezone, opening hours and working days. This moves the deadline on every task created afterwards.',
      },
    ],
  },
  {
    domain: 'crm.security',
    label: 'Security',
    description: 'Sign-in history and access records',
    actions: [
      {
        domain: 'crm.security',
        action: 'view',
        label: 'View security log',
        description: 'See sign-in attempts and who opened which player',
      },
      {
        domain: 'crm.security',
        action: 'manage',
        label: 'Manage access rules',
        description: "Change a user's address allowlist",
      },
    ],
  },
]

/** Flat set of every valid "domain:action", used to reject anything invented. */
export const CRM_PERMISSION_KEYS: ReadonlySet<string> = new Set(
  CRM_PERMISSIONS.flatMap((g) => g.actions.map((a) => `${a.domain}:${a.action}`))
)

export function isValidCrmPermission(domain: string, action: string): boolean {
  return CRM_PERMISSION_KEYS.has(`${domain}:${action}`)
}

/**
 * Roles a whitelabel starts with when Super Admin turns its CRM on.
 *
 * `CRM Administrator` exists so the whitelabel is never locked out of its own
 * CRM: it is created with the full catalogue and marked as a system role, which
 * makes it uneditable-to-empty and undeletable. The other two are ordinary
 * starting points and may be changed or removed freely.
 */
export const CRM_SYSTEM_ROLES: Array<{
  name: string
  description: string
  isSystem: boolean
  permissions: Array<{ domain: string; action: string }>
}> = [
  {
    name: 'CRM Administrator',
    description: 'Full access, including users and roles',
    isSystem: true,
    permissions: CRM_PERMISSIONS.flatMap((g) => g.actions.map((a) => ({ domain: a.domain, action: a.action }))),
  },
  {
    name: 'Supervisor',
    description: 'Sees every player and manages books',
    isSystem: false,
    permissions: [
      { domain: 'crm.players', action: 'view' },
      { domain: 'crm.players', action: 'view_all' },
      { domain: 'crm.players', action: 'export' },
      { domain: 'crm.books', action: 'view' },
      { domain: 'crm.books', action: 'manage' },
      { domain: 'crm.users', action: 'view' },
      { domain: 'crm.security', action: 'view' },
      // Read-only. The hours a supervisor's breach numbers were computed
      // against are part of reading them; changing them is an administrator's.
      { domain: 'crm.settings', action: 'view' },
      { domain: 'crm.reports', action: 'view' },
      { domain: 'crm.notes', action: 'view' },
      { domain: 'crm.notes', action: 'create' },
      { domain: 'crm.tags', action: 'apply' },
      { domain: 'crm.tags', action: 'manage' },
      { domain: 'crm.rg', action: 'view' },
      { domain: 'crm.rg', action: 'flag' },
      { domain: 'crm.consent', action: 'view' },
      { domain: 'crm.consent', action: 'record' },
      { domain: 'crm.tasks', action: 'view' },
      { domain: 'crm.tasks', action: 'manage' },
      { domain: 'crm.tasks', action: 'escalate' },
    ],
  },
  {
    name: 'Agent',
    description: 'Works the players in their own books',
    isSystem: false,
    permissions: [
      { domain: 'crm.players', action: 'view' },
      { domain: 'crm.books', action: 'view' },
      { domain: 'crm.notes', action: 'view' },
      { domain: 'crm.notes', action: 'create' },
      { domain: 'crm.tags', action: 'apply' },
      { domain: 'crm.rg', action: 'view' },
      { domain: 'crm.consent', action: 'view' },
      { domain: 'crm.consent', action: 'record' },
      { domain: 'crm.tasks', action: 'view' },
      { domain: 'crm.tasks', action: 'manage' },
    ],
  },
]
