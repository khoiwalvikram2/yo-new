import { gql } from '@apollo/client'

const ME_FIELDS = `
  id
  name
  email
  status
  requirePasswordReset
  tenant
  whitelabelName
  permissions { domain actions }
  bookIds
  canViewAllPlayers
  sessionIdleMinutes
  outOfOfficeUntil
  delegateTo
`

export const LOGIN = gql`
  mutation CrmLogin($username: String!, $password: String!) {
    crmLogin(username: $username, password: $password) {
      ok
      token
      error
      me { ${ME_FIELDS} }
    }
  }
`

export const ME = gql`
  query CrmMe {
    crmMe { ${ME_FIELDS} }
  }
`

export const CHANGE_OWN_PASSWORD = gql`
  mutation CrmChangeOwnPassword($currentPassword: String!, $newPassword: String!) {
    crmChangeOwnPassword(currentPassword: $currentPassword, newPassword: $newPassword) {
      ok
      error
    }
  }
`

export const PLAYERS = gql`
  query CrmPlayers($filter: CrmPlayerFilterInput, $limit: Int, $offset: Int) {
    crmPlayers(filter: $filter, limit: $limit, offset: $offset) {
      total
      items {
        id
        name
        username
        phone
        email
        status
        playerType
        createdAt
        lastLoginAt
        cash
        bonus
        exposure
        bookId
        bookName
        ownerName
        tags { id name colour }
        noteCount
      }
    }
  }
`

export const PLAYER = gql`
  query CrmPlayer($id: ID!) {
    crmPlayer(id: $id) {
      id
      name
      username
      phone
      email
      status
      playerType
      createdAt
      lastLoginAt
      cash
      bonus
      exposure
      referralBalance
      bookId
      bookName
      ownerName
      riskType
      remark
      withdrawalLock
      bonusAllowed
      sportsBetAllowed
      casinoBetAllowed
      matkaBetAllowed
      creditLimit
      creditUsed
      totalDeposits
      depositCount
      totalWithdrawals
      withdrawalCount
      totalStake
      betCount
      firstBetAt
      lastBetAt
    }
  }
`

export const PLAYER_TIMELINE = gql`
  query CrmPlayerTimeline($playerId: ID!, $limit: Int, $cursor: String, $sources: [String!]) {
    crmPlayerTimeline(playerId: $playerId, limit: $limit, cursor: $cursor, sources: $sources) {
      nextCursor
      entries { key source occurredAt title status amount detail }
    }
  }
`

export const BOOKS = gql`
  query CrmBooks {
    crmBooks { id name description memberCount playerCount createdAt }
  }
`

export const BOOK_MEMBERS = gql`
  query CrmBookMembers($bookId: ID!) {
    crmBookMembers(bookId: $bookId) { id name status }
  }
`

export const CREATE_BOOK = gql`
  mutation CrmCreateBook($name: String!, $description: String) {
    crmCreateBook(name: $name, description: $description) { ok error }
  }
`

export const UPDATE_BOOK = gql`
  mutation CrmUpdateBook($id: ID!, $name: String, $description: String) {
    crmUpdateBook(id: $id, name: $name, description: $description) { ok error }
  }
`

export const DELETE_BOOK = gql`
  mutation CrmDeleteBook($id: ID!) {
    crmDeleteBook(id: $id) { ok error }
  }
`

export const SET_BOOK_MEMBERS = gql`
  mutation CrmSetBookMembers($bookId: ID!, $crmUserIds: [ID!]!) {
    crmSetBookMembers(bookId: $bookId, crmUserIds: $crmUserIds) { ok error }
  }
`

export const ASSIGN_PLAYERS = gql`
  mutation CrmAssignPlayers($playerIds: [ID!]!, $bookId: ID!, $ownerId: ID) {
    crmAssignPlayers(playerIds: $playerIds, bookId: $bookId, ownerId: $ownerId) { ok error }
  }
`

export const UNASSIGN_PLAYERS = gql`
  mutation CrmUnassignPlayers($playerIds: [ID!]!) {
    crmUnassignPlayers(playerIds: $playerIds) { ok error }
  }
`

export const USERS = gql`
  query CrmUsers {
    crmUsers {
      id name username email phone status requirePasswordReset
      lastLoginAt lastSeenAt createdAt roleNames roleIds
    }
  }
`

export const CREATE_USER = gql`
  mutation CrmCreateUser($input: CrmCreateUserInput!) {
    crmCreateUser(input: $input) { ok error }
  }
`

export const UPDATE_USER = gql`
  mutation CrmUpdateUser($input: CrmUpdateUserInput!) {
    crmUpdateUser(input: $input) { ok error }
  }
`

export const SET_USER_STATUS = gql`
  mutation CrmSetUserStatus($id: ID!, $status: String!) {
    crmSetUserStatus(id: $id, status: $status) { ok error }
  }
`

export const RESET_USER_PASSWORD = gql`
  mutation CrmResetUserPassword($id: ID!, $newPassword: String!) {
    crmResetUserPassword(id: $id, newPassword: $newPassword) { ok error }
  }
`

export const SET_USER_ROLES = gql`
  mutation CrmSetUserRoles($id: ID!, $roleIds: [ID!]!) {
    crmSetUserRoles(id: $id, roleIds: $roleIds) { ok error }
  }
`

export const DELETE_USER = gql`
  mutation CrmDeleteUser($id: ID!) {
    crmDeleteUser(id: $id) { ok error }
  }
`

export const ROLES = gql`
  query CrmRoles {
    crmRoles {
      id name description isSystem userCount
      permissions { domain action label description }
    }
  }
`

export const PERMISSION_CATALOG = gql`
  query CrmPermissionCatalog {
    crmPermissionCatalog {
      domain label description
      actions { domain action label description }
    }
  }
`

export const CREATE_ROLE = gql`
  mutation CrmCreateRole($name: String!, $description: String, $permissions: [CrmPermissionInput!]!) {
    crmCreateRole(name: $name, description: $description, permissions: $permissions) { ok error }
  }
`

export const UPDATE_ROLE = gql`
  mutation CrmUpdateRole($id: ID!, $name: String, $description: String, $permissions: [CrmPermissionInput!]) {
    crmUpdateRole(id: $id, name: $name, description: $description, permissions: $permissions) { ok error }
  }
`

export const DELETE_ROLE = gql`
  mutation CrmDeleteRole($id: ID!) {
    crmDeleteRole(id: $id) { ok error }
  }
`

export const LOGIN_ATTEMPTS = gql`
  query CrmLoginAttempts($limit: Int) {
    crmLoginAttempts(limit: $limit) {
      id username userName success reason ipAddress userAgent createdAt
    }
  }
`

export const PII_ACCESS_LOG = gql`
  query CrmPiiAccessLog($limit: Int, $resourceId: String) {
    crmPiiAccessLog(limit: $limit, resourceId: $resourceId) {
      id userName resourceType resourceId action fields ipAddress createdAt
    }
  }
`

// ---------------------------------------------------------------------------
// Phase 2
// ---------------------------------------------------------------------------

export const PLAYER_NOTES = gql`
  query CrmPlayerNotes($playerId: ID!) {
    crmPlayerNotes(playerId: $playerId) {
      id
      content
      category
      labels
      isPinned
      visibility
      authorKind
      createdBy
      createdAt
    }
  }
`

export const ADD_NOTE = gql`
  mutation CrmAddPlayerNote($input: CrmAddPlayerNoteInput!) {
    crmAddPlayerNote(input: $input) {
      ok
      error
    }
  }
`

export const DELETE_NOTE = gql`
  mutation CrmDeletePlayerNote($id: ID!) {
    crmDeletePlayerNote(id: $id) { ok error }
  }
`

export const SET_NOTE_PINNED = gql`
  mutation CrmSetNotePinned($id: ID!, $isPinned: Boolean!) {
    crmSetNotePinned(id: $id, isPinned: $isPinned) { ok error }
  }
`

export const TAGS = gql`
  query CrmTags($includeArchived: Boolean) {
    crmTags(includeArchived: $includeArchived) {
      id
      name
      colour
      description
      isArchived
      playerCount
    }
  }
`

export const TAG_LIMIT = gql`
  query CrmTagLimit {
    crmTagLimit { used limit }
  }
`

export const CREATE_TAG = gql`
  mutation CrmCreateTag($name: String!, $colour: String, $description: String) {
    crmCreateTag(name: $name, colour: $colour, description: $description) { ok error }
  }
`

export const ARCHIVE_TAG = gql`
  mutation CrmArchiveTag($id: ID!, $archived: Boolean!) {
    crmArchiveTag(id: $id, archived: $archived) { ok error }
  }
`

export const MERGE_TAGS = gql`
  mutation CrmMergeTags($fromId: ID!, $intoId: ID!) {
    crmMergeTags(fromId: $fromId, intoId: $intoId) { ok error }
  }
`

export const APPLY_TAGS = gql`
  mutation CrmApplyTags($playerIds: [ID!]!, $tagIds: [ID!]!) {
    crmApplyTags(playerIds: $playerIds, tagIds: $tagIds) { ok error }
  }
`

export const REMOVE_TAGS = gql`
  mutation CrmRemoveTags($playerIds: [ID!]!, $tagIds: [ID!]!) {
    crmRemoveTags(playerIds: $playerIds, tagIds: $tagIds) { ok error }
  }
`

export const RG_FLAGS = gql`
  query CrmPlayerRgFlags($playerId: ID!) {
    crmPlayerRgFlags(playerId: $playerId) {
      id
      flagType
      status
      initiatedBy
      blocksPlay
      startsAt
      minTermEndsAt
      endsAt
      balanceAtBlock
      reason
      raisedBy
      raisedAt
      liftedBy
      liftedAt
      liftReason
    }
  }
`

export const RG_FLAG_TYPES = gql`
  query CrmRgFlagTypes {
    crmRgFlagTypes { value blocksPlay }
  }
`

export const RAISE_RG_FLAG = gql`
  mutation CrmRaiseRgFlag(
    $playerId: ID!
    $flagType: String!
    $initiatedBy: String!
    $reason: String
    $endsAt: String
    $minTermMonths: Int
  ) {
    crmRaiseRgFlag(
      playerId: $playerId
      flagType: $flagType
      initiatedBy: $initiatedBy
      reason: $reason
      endsAt: $endsAt
      minTermMonths: $minTermMonths
    ) { ok error }
  }
`

export const LIFT_RG_FLAG = gql`
  mutation CrmLiftRgFlag($flagId: ID!, $reason: String!) {
    crmLiftRgFlag(flagId: $flagId, reason: $reason) { ok error }
  }
`

export const CONSENTS = gql`
  query CrmPlayerConsents($playerId: ID!) {
    crmPlayerConsents(playerId: $playerId) {
      channel
      purpose
      state
      stateSince
      grantedAt
      source
      evidenceRef
    }
  }
`

export const RECORD_CONSENT = gql`
  mutation CrmRecordConsent(
    $playerId: ID!
    $channel: String!
    $purpose: String!
    $state: String!
    $source: String!
    $evidenceRef: String
    $reason: String
  ) {
    crmRecordConsent(
      playerId: $playerId
      channel: $channel
      purpose: $purpose
      state: $state
      source: $source
      evidenceRef: $evidenceRef
      reason: $reason
    ) { ok error }
  }
`

export const TASKS = gql`
  query CrmTasks($filter: CrmTaskFilterInput) {
    crmTasks(filter: $filter) {
      id
      playerId
      bookId
      bookName
      assigneeId
      assigneeName
      title
      body
      priority
      status
      outcome
      source
      dueAt
      breachAt
      isBreaching
      escalationLevel
      acknowledgedAt
      createdAt
    }
  }
`

export const CREATE_TASK = gql`
  mutation CrmCreateTask(
    $bookId: ID!
    $title: String!
    $slaMinutes: Int!
    $playerId: ID
    $assigneeId: ID
    $body: String
    $priority: String
  ) {
    crmCreateTask(
      bookId: $bookId
      title: $title
      slaMinutes: $slaMinutes
      playerId: $playerId
      assigneeId: $assigneeId
      body: $body
      priority: $priority
    ) { ok error }
  }
`

export const SET_TASK_STATUS = gql`
  mutation CrmSetTaskStatus($taskId: ID!, $status: String!, $outcome: String) {
    crmSetTaskStatus(taskId: $taskId, status: $status, outcome: $outcome) { ok error }
  }
`

export const ASSIGN_TASK = gql`
  mutation CrmAssignTask($taskId: ID!, $assigneeId: ID) {
    crmAssignTask(taskId: $taskId, assigneeId: $assigneeId) { ok error }
  }
`

export const ACKNOWLEDGE_TASK = gql`
  mutation CrmAcknowledgeTask($taskId: ID!) {
    crmAcknowledgeTask(taskId: $taskId) { ok error }
  }
`

export const MY_NOTIFICATIONS = gql`
  query CrmMyNotifications($unreadOnly: Boolean) {
    crmMyNotifications(unreadOnly: $unreadOnly) {
      id
      kind
      title
      body
      resourceType
      resourceId
      readAt
      createdAt
    }
  }
`

export const MARK_READ = gql`
  mutation CrmMarkNotificationsRead($ids: [ID!]) {
    crmMarkNotificationsRead(ids: $ids) { ok error }
  }
`

export const CONTACT_ATTEMPTS = gql`
  query CrmContactAttempts($playerId: ID!) {
    crmContactAttempts(playerId: $playerId) {
      id
      channel
      direction
      outcome
      notes
      byName
      occurredAt
    }
  }
`

export const RECORD_CONTACT = gql`
  mutation CrmRecordContactAttempt(
    $playerId: ID!
    $channel: String!
    $outcome: String!
    $direction: String
    $notes: String
  ) {
    crmRecordContactAttempt(
      playerId: $playerId
      channel: $channel
      outcome: $outcome
      direction: $direction
      notes: $notes
    ) { ok error }
  }
`

export const SET_AVAILABILITY = gql`
  mutation CrmSetMyAvailability($outOfOfficeUntil: String, $delegateTo: ID) {
    crmSetMyAvailability(outOfOfficeUntil: $outOfOfficeUntil, delegateTo: $delegateTo) { ok error }
  }
`

export const IP_ALLOWLIST = gql`
  query CrmIpAllowlist($crmUserId: ID!) {
    crmIpAllowlist(crmUserId: $crmUserId) { id cidr label createdAt }
  }
`

export const ADD_IP_ALLOWLIST = gql`
  mutation CrmAddIpAllowlistEntry($crmUserId: ID!, $cidr: String!, $label: String) {
    crmAddIpAllowlistEntry(crmUserId: $crmUserId, cidr: $cidr, label: $label) { ok error }
  }
`

export const REMOVE_IP_ALLOWLIST = gql`
  mutation CrmRemoveIpAllowlistEntry($id: ID!) {
    crmRemoveIpAllowlistEntry(id: $id) { ok error }
  }
`

export const CONSENT_HISTORY = gql`
  query CrmPlayerConsentHistory($playerId: ID!, $limit: Int) {
    crmPlayerConsentHistory(playerId: $playerId, limit: $limit) {
      id channel purpose fromState toState source evidenceRef actorKind reason createdAt
    }
  }
`

export const TASK_EVENTS = gql`
  query CrmTaskEvents($taskId: ID!) {
    crmTaskEvents(taskId: $taskId) { id kind actor fromValue toValue note createdAt }
  }
`

export const UPDATE_TAG = gql`
  mutation CrmUpdateTag($id: ID!, $name: String, $colour: String, $description: String) {
    crmUpdateTag(id: $id, name: $name, colour: $colour, description: $description) { ok error }
  }
`

/**
 * What is falling through on the desk right now.
 *
 * One query rather than six: the scope is resolved once on the server, which is
 * where every scope bug in this product has come from being written twice.
 */
export const DESK_HEALTH = gql`
  query CrmDeskHealth {
    crmDeskHealth {
      allClear
      reachedNobody {
        total
        rows { id title bookName playerId assigneeName minutesOverdue failedAttempts firstFailedAt }
      }
      uncoveredBooks {
        total
        rows { bookId bookName openTasks }
      }
      ladderExhausted {
        total
        rows { id title bookName playerId assigneeName minutesOverdue escalationLevel }
      }
      breaching {
        total
        rows { id title bookName playerId assigneeName minutesOverdue }
      }
      unassigned {
        total
        rows { id title bookName playerId minutesOverdue }
      }
      neverReached {
        total
        rows { playerId playerName attempts lastAttemptAt lastOutcome }
      }
    }
  }
`

/**
 * The player list as a CSV.
 *
 * A separate permission from reading the list on screen, and recorded in the
 * personal-data access log as an export rather than a view — reading a page and
 * walking out with the book are different acts.
 */
export const EXPORT_PLAYERS = gql`
  query CrmExportPlayers($filter: CrmPlayerFilterInput) {
    crmExportPlayers(filter: $filter) {
      filename
      csv
      rowCount
      total
      truncated
    }
  }
`

/** Everything the CRM holds on one player, for a data subject request. */
export const DSAR_EXPORT = gql`
  query CrmDsarExport($playerId: ID!) {
    crmDsarExport(playerId: $playerId) {
      playerId
      generatedAt
      filename
      json
    }
  }
`

export const DSAR_ERASE = gql`
  mutation CrmDsarErase($playerId: ID!, $reason: String!) {
    crmDsarErase(playerId: $playerId, reason: $reason) {
      ok
      error
      notesRedacted
      contactNotesCleared
      tasksRedacted
    }
  }
`

/**
 * The desk's numbers over a period.
 *
 * One query for the whole page, like desk health: the scope is resolved once on
 * the server rather than once per section.
 */
export const DESK_REPORT = gql`
  query CrmDeskReport($from: String!, $to: String!) {
    crmDeskReport(from: $from, to: $to) {
      from
      to
      tasks {
        created
        completed
        breached
        openNow
        avgMinutesToClose
        avgMinutesToAcknowledge
        byDay { date created completed }
      }
      contacts {
        attempts
        connected
        byChannel { channel attempts connected }
      }
      agents {
        crmUserId
        name
        tasksCompleted
        tasksBreached
        contactAttempts
        contactsConnected
        notesWritten
      }
      rg {
        flagsRaised
        flagsLifted
        blocksActiveNow
      }
    }
  }
`

/**
 * The hours the desk works.
 *
 * `isOpenNow` is answered by the server rather than computed here, because it
 * depends on the desk's timezone and not on the clock of whoever is looking.
 */
export const DESK_CALENDAR = gql`
  query CrmDeskCalendar {
    crmDeskCalendar {
      timezone
      openMinute
      closeMinute
      days
      isOpenNow
    }
  }
`

/**
 * Saved player filters.
 *
 * `filter` comes back in the same shape `crmPlayers` takes, so loading a segment
 * is assignment rather than translation.
 */
export const SEGMENTS = gql`
  query CrmSegments {
    crmSegments {
      id
      name
      description
      isShared
      ownerName
      isMine
      filter {
        search
        status
        bookId
        assignment
        tagIds
        tagMatch
        hasNotes
      }
    }
  }
`

export const CREATE_SEGMENT = gql`
  mutation CrmCreateSegment(
    $name: String!
    $description: String
    $filter: CrmPlayerFilterInput
    $isShared: Boolean
  ) {
    crmCreateSegment(name: $name, description: $description, filter: $filter, isShared: $isShared) {
      ok
      error
    }
  }
`

export const UPDATE_SEGMENT = gql`
  mutation CrmUpdateSegment(
    $id: ID!
    $name: String
    $description: String
    $filter: CrmPlayerFilterInput
    $isShared: Boolean
  ) {
    crmUpdateSegment(
      id: $id
      name: $name
      description: $description
      filter: $filter
      isShared: $isShared
    ) {
      ok
      error
    }
  }
`

export const DELETE_SEGMENT = gql`
  mutation CrmDeleteSegment($id: ID!) {
    crmDeleteSegment(id: $id) {
      ok
      error
    }
  }
`

/**
 * One task for many players.
 *
 * Returns counts rather than a boolean: a batch where some players already had
 * the task open has to be able to say so.
 */
export const CREATE_TASKS_FOR_PLAYERS = gql`
  mutation CrmCreateTasksForPlayers(
    $playerIds: [ID!]!
    $bookId: ID!
    $title: String!
    $slaMinutes: Int!
    $assigneeId: ID
    $body: String
    $priority: String
  ) {
    crmCreateTasksForPlayers(
      playerIds: $playerIds
      bookId: $bookId
      title: $title
      slaMinutes: $slaMinutes
      assigneeId: $assigneeId
      body: $body
      priority: $priority
    ) {
      ok
      error
      created
      skippedDuplicate
      skippedUnreachable
    }
  }
`

export const SET_DESK_CALENDAR = gql`
  mutation CrmSetDeskCalendar(
    $timezone: String!
    $openMinute: Int!
    $closeMinute: Int!
    $days: [Int!]!
  ) {
    crmSetDeskCalendar(
      timezone: $timezone
      openMinute: $openMinute
      closeMinute: $closeMinute
      days: $days
    ) {
      ok
      error
    }
  }
`
