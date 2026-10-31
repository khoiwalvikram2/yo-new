import { randomUUID } from 'crypto'
import { getStartOfDay } from '@src/shared/dateUtils.js'

export type VIPPerk = {
  name: string
  description: string
  icon?: string
}

export type VIPTier = {
  id: string
  tenant?: string
  name: string
  level: number
  minMonthlyDeposit: number
  color: string
  benefits: string[]
  perks: VIPPerk[]
  status: string
  createdAt: string
  updatedAt: string
}

export type VIPMemberStats = {
  totalDeposits: number
  totalWithdrawals: number
  totalBets: number
  totalWins: number
  netGGR: number
  avgBetSize: number
  sessionsCount: number
  currency: string
}

export type VIPMember = {
  id: string
  tenant?: string
  userId: string
  userName: string
  userEmail?: string
  tierId: string
  tierName: string
  tierLevel: number
  currentPoints: number
  lifetimePoints: number
  nextTierId?: string
  nextTierName?: string
  pointsToNextTier?: number
  joinedAt: string
  lastActivityAt?: string
  status: string
  stats?: VIPMemberStats
}

export type VIPTransaction = {
  id: string
  tenant?: string
  memberId: string
  type: string
  points: number
  description: string
  relatedEntityType?: string
  relatedEntityId?: string
  balanceBefore: number
  balanceAfter: number
  createdAt: string
}

export type VIPHistory = {
  id: string
  tenant?: string
  memberId: string
  fromTierId?: string
  fromTierName?: string
  toTierId: string
  toTierName: string
  reason: string
  pointsAtChange: number
  createdAt: string
}

// In-memory stores
const vipTiers = new Map<string, VIPTier>()
const vipMembers = new Map<string, VIPMember>()
const vipTransactions = new Map<string, VIPTransaction[]>()
const vipHistories = new Map<string, VIPHistory[]>()
type VIPTierSchedule = { id: string; tierId: string; toStatus: string; effectiveAt: string; createdAt: string }
type VIPAuditEvent = { id: string; action: string; tierId?: string; message: string; at: string; actor?: string }
type VIPValidationIssue = { code: string; message: string; tierId?: string }
type VIPTierVersion = { id: string; tierId: string; snapshot: VIPTier; createdAt: string; reason: string }
const vipSchedules = new Map<string, VIPTierSchedule>()
const vipAudit: VIPAuditEvent[] = []
const vipVersions = new Map<string, VIPTierVersion[]>()

// Initialize with default tiers
function initializeDefaultTiers() {
  const tiers: Omit<VIPTier, 'id' | 'createdAt' | 'updatedAt'>[] = [
    {
      name: 'Bronze',
      level: 1,
      minMonthlyDeposit: 0,
      color: '#CD7F32',
      benefits: ['5% cashback on losses', 'Birthday bonus', 'Email support'],
      perks: [
        { name: 'Cashback', description: '5% on all losses', icon: 'wallet' },
        { name: 'Birthday Bonus', description: 'Special bonus on your birthday', icon: 'gift' },
        { name: 'Priority Support', description: '24/7 email support', icon: 'mail' }
      ],
      status: 'active'
    },
    {
      name: 'Silver',
      level: 2,
      minMonthlyDeposit: 100,
      color: '#C0C0C0',
      benefits: ['10% cashback on losses', 'Birthday bonus', 'Priority email support', 'Weekly reload bonus'],
      perks: [
        { name: 'Cashback', description: '10% on all losses', icon: 'wallet' },
        { name: 'Birthday Bonus', description: 'Enhanced birthday bonus', icon: 'gift' },
        { name: 'Priority Support', description: 'Priority email support', icon: 'mail' },
        { name: 'Weekly Reload', description: '10% reload bonus weekly', icon: 'reload' }
      ],
      status: 'active'
    },
    {
      name: 'Gold',
      level: 3,
      minMonthlyDeposit: 500,
      color: '#FFD700',
      benefits: ['15% cashback on losses', 'Enhanced birthday bonus', 'Live chat support', 'Weekly reload bonus', 'Faster withdrawals'],
      perks: [
        { name: 'Cashback', description: '15% on all losses', icon: 'wallet' },
        { name: 'Birthday Bonus', description: 'Premium birthday bonus', icon: 'gift' },
        { name: 'Live Chat', description: '24/7 live chat support', icon: 'message' },
        { name: 'Weekly Reload', description: '15% reload bonus weekly', icon: 'reload' },
        { name: 'Fast Withdrawals', description: 'Priority processing', icon: 'rocket' }
      ],
      status: 'active'
    },
    {
      name: 'Platinum',
      level: 4,
      minMonthlyDeposit: 2000,
      color: '#E5E4E2',
      benefits: ['20% cashback on losses', 'Premium birthday bonus', 'Dedicated account manager', 'Daily reload bonus', 'Instant withdrawals', 'Exclusive promotions'],
      perks: [
        { name: 'Cashback', description: '20% on all losses', icon: 'wallet' },
        { name: 'Birthday Bonus', description: 'Premium birthday package', icon: 'gift' },
        { name: 'Account Manager', description: 'Personal account manager', icon: 'user' },
        { name: 'Daily Reload', description: '20% reload bonus daily', icon: 'reload' },
        { name: 'Instant Withdrawals', description: 'Instant processing', icon: 'lightning' },
        { name: 'Exclusive Promos', description: 'VIP-only promotions', icon: 'star' }
      ],
      status: 'active'
    },
    {
      name: 'Diamond',
      level: 5,
      minMonthlyDeposit: 10000,
      color: '#B9F2FF',
      benefits: ['25% cashback on losses', 'Luxury birthday package', 'Personal VIP concierge', 'Unlimited reload bonuses', 'Instant withdrawals', 'Exclusive events', 'Custom bonuses'],
      perks: [
        { name: 'Cashback', description: '25% on all losses', icon: 'wallet' },
        { name: 'Birthday Package', description: 'Luxury birthday experience', icon: 'gift' },
        { name: 'VIP Concierge', description: 'Personal VIP concierge service', icon: 'crown' },
        { name: 'Unlimited Reload', description: 'Unlimited reload bonuses', icon: 'reload' },
        { name: 'Instant Withdrawals', description: 'Priority instant processing', icon: 'lightning' },
        { name: 'VIP Events', description: 'Invitations to exclusive events', icon: 'calendar' },
        { name: 'Custom Bonuses', description: 'Tailored bonus packages', icon: 'star' }
      ],
      status: 'active'
    }
  ]

  tiers.forEach(tier => {
    const id = randomUUID()
    const now = new Date().toISOString()
    vipTiers.set(id, {
      id,
      ...tier,
      createdAt: now,
      updatedAt: now
    })
  })
}

// Initialize tiers on module load
initializeDefaultTiers()

// Mock members data
function initializeMockMembers() {
  const mockUsers = [
    { id: 'user1', name: 'Emily Chen', email: 'emily.chen@example.com', tierId: Array.from(vipTiers.values()).find(t => t.level === 5)?.id || '', points: 125000 },
    { id: 'user2', name: 'Michael Rodriguez', email: 'michael.r@example.com', tierId: Array.from(vipTiers.values()).find(t => t.level === 4)?.id || '', points: 35000 },
    { id: 'user3', name: 'Sarah Johnson', email: 'sarah.j@example.com', tierId: Array.from(vipTiers.values()).find(t => t.level === 4)?.id || '', points: 28000 },
    { id: 'user4', name: 'David Kumar', email: 'david.k@example.com', tierId: Array.from(vipTiers.values()).find(t => t.level === 3)?.id || '', points: 8500 },
    { id: 'user5', name: 'Jessica Martinez', email: 'jessica.m@example.com', tierId: Array.from(vipTiers.values()).find(t => t.level === 3)?.id || '', points: 7200 },
    { id: 'user6', name: 'James Wilson', email: 'james.w@example.com', tierId: Array.from(vipTiers.values()).find(t => t.level === 2)?.id || '', points: 2800 },
    { id: 'user7', name: 'Maria Garcia', email: 'maria.g@example.com', tierId: Array.from(vipTiers.values()).find(t => t.level === 2)?.id || '', points: 1500 },
    { id: 'user8', name: 'Robert Taylor', email: 'robert.t@example.com', tierId: Array.from(vipTiers.values()).find(t => t.level === 1)?.id || '', points: 450 },
    { id: 'user9', name: 'Lisa Anderson', email: 'lisa.a@example.com', tierId: Array.from(vipTiers.values()).find(t => t.level === 1)?.id || '', points: 320 },
    { id: 'user10', name: 'Thomas Brown', email: 'thomas.b@example.com', tierId: Array.from(vipTiers.values()).find(t => t.level === 1)?.id || '', points: 180 }
  ]

  mockUsers.forEach(user => {
    const tier = vipTiers.get(user.tierId)
    if (!tier) return

    const sortedTiers = Array.from(vipTiers.values()).sort((a, b) => a.level - b.level)
    const nextTier = sortedTiers.find(t => t.level > tier.level)

    const id = randomUUID()
    const member: VIPMember = {
      id,
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      tierId: tier.id,
      tierName: tier.name,
      tierLevel: tier.level,
      currentPoints: user.points,
      lifetimePoints: user.points + Math.floor(Math.random() * 50000),
      nextTierId: nextTier?.id,
      nextTierName: nextTier?.name,
      pointsToNextTier: nextTier ? Math.max(0, nextTier.minMonthlyDeposit - (user.points ?? 0)) : undefined,
      joinedAt: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000).toISOString(),
      lastActivityAt: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'active',
      stats: {
        totalDeposits: 10000 + Math.random() * 90000,
        totalWithdrawals: 5000 + Math.random() * 40000,
        totalBets: 50000 + Math.random() * 200000,
        totalWins: 30000 + Math.random() * 150000,
        netGGR: 5000 + Math.random() * 20000,
        avgBetSize: 10 + Math.random() * 90,
        sessionsCount: 50 + Math.floor(Math.random() * 500),
        currency: 'GBP'
      }
    }
    vipMembers.set(id, member)
  })
}

initializeMockMembers()

// Store functions
export function listTiers(): VIPTier[] {
  return Array.from(vipTiers.values()).sort((a, b) => a.level - b.level)
}

export function getTier(id: string): VIPTier | undefined {
  return vipTiers.get(id)
}

export function createTier(input: Omit<VIPTier, 'id' | 'createdAt' | 'updatedAt'>): VIPTier {
  const id = randomUUID()
  const now = new Date().toISOString()
  const tier: VIPTier = {
    id,
    ...input,
    createdAt: now,
    updatedAt: now
  }
  vipTiers.set(id, tier)
  return tier
}

export function updateTier(id: string, input: Partial<Omit<VIPTier, 'id' | 'createdAt' | 'updatedAt'>>): VIPTier | undefined {
  const tier = vipTiers.get(id)
  if (!tier) return undefined

  // Save version before update
  const versions = vipVersions.get(id) || []
  versions.push({ id: randomUUID(), tierId: id, snapshot: tier, createdAt: new Date().toISOString(), reason: 'update' })
  vipVersions.set(id, versions)

  const updated: VIPTier = {
    ...tier,
    ...input,
    updatedAt: new Date().toISOString()
  }
  vipTiers.set(id, updated)

  vipAudit.push({ id: randomUUID(), action: 'update', tierId: id, message: `Tier updated`, at: new Date().toISOString() })
  return updated
}

export function deleteTier(id: string): boolean {
  const ok = vipTiers.delete(id)
  if (ok) vipAudit.push({ id: randomUUID(), action: 'delete', tierId: id, message: `Tier deleted`, at: new Date().toISOString() })
  return ok
}

export function listMembers(filters?: { tierId?: string; status?: string; query?: string }): VIPMember[] {
  let members = Array.from(vipMembers.values())

  if (filters?.tierId) {
    members = members.filter(m => m.tierId === filters.tierId)
  }

  if (filters?.status) {
    members = members.filter(m => m.status === filters.status)
  }

  if (filters?.query) {
    const q = filters.query.toLowerCase()
    members = members.filter(m =>
      m.userName.toLowerCase().includes(q) ||
      m.userEmail?.toLowerCase().includes(q) ||
      m.userId.toLowerCase().includes(q)
    )
  }

  return members.sort((a, b) => b.currentPoints - a.currentPoints)
}

export function getMember(id: string): VIPMember | undefined {
  return vipMembers.get(id)
}

export function getMemberByUserId(userId: string): VIPMember | undefined {
  return Array.from(vipMembers.values()).find(m => m.userId === userId)
}

export function createMember(input: {
  userId: string
  userName: string
  userEmail?: string
  tierId: string
  initialPoints?: number
}): VIPMember | undefined {
  const tier = vipTiers.get(input.tierId)
  if (!tier) return undefined

  const sortedTiers = Array.from(vipTiers.values()).sort((a, b) => a.level - b.level)
  const nextTier = sortedTiers.find(t => t.level > tier.level)

  const id = randomUUID()
  const points = input.initialPoints || 0
  const member: VIPMember = {
    id,
    userId: input.userId,
    userName: input.userName,
    userEmail: input.userEmail,
    tierId: tier.id,
    tierName: tier.name,
    tierLevel: tier.level,
    currentPoints: points,
    lifetimePoints: points,
    nextTierId: nextTier?.id,
    nextTierName: nextTier?.name,
    pointsToNextTier: nextTier ? Math.max(0, nextTier.minMonthlyDeposit - points) : undefined,
    joinedAt: new Date().toISOString(),
    status: 'active'
  }

  vipMembers.set(id, member)

  // Create initial history entry
  const history: VIPHistory = {
    id: randomUUID(),
    memberId: id,
    toTierId: tier.id,
    toTierName: tier.name,
    reason: 'Initial enrollment',
    pointsAtChange: points,
    createdAt: new Date().toISOString()
  }
  vipHistories.set(id, [history])

  return member
}

export function updateMember(id: string, input: {
  tierId?: string
  points?: number
  status?: string
}): VIPMember | undefined {
  const member = vipMembers.get(id)
  if (!member) return undefined

  let updated = { ...member }

  if (input.tierId && input.tierId !== member.tierId) {
    const newTier = vipTiers.get(input.tierId)
    if (!newTier) return undefined

    const sortedTiers = Array.from(vipTiers.values()).sort((a, b) => a.level - b.level)
    const nextTier = sortedTiers.find(t => t.level > newTier.level)

    // Add history entry
    const history = vipHistories.get(id) || []
    history.push({
      id: randomUUID(),
      memberId: id,
      fromTierId: member.tierId,
      fromTierName: member.tierName,
      toTierId: newTier.id,
      toTierName: newTier.name,
      reason: 'Manual tier change',
      pointsAtChange: member.currentPoints,
      createdAt: new Date().toISOString()
    })
    vipHistories.set(id, history)

    updated = {
      ...updated,
      tierId: newTier.id,
      tierName: newTier.name,
      tierLevel: newTier.level,
      nextTierId: nextTier?.id,
      nextTierName: nextTier?.name,
      pointsToNextTier: nextTier ? Math.max(0, nextTier.minMonthlyDeposit - updated.currentPoints) : undefined
    }
  }

  if (input.points !== undefined) {
    updated.currentPoints = input.points
    updated.lifetimePoints = Math.max(updated.lifetimePoints, input.points)

    // Check for automatic tier upgrade/downgrade
    const sortedTiers = Array.from(vipTiers.values()).sort((a, b) => a.level - b.level)
    const eligibleTier = sortedTiers.reverse().find(t => input.points! >= t.minMonthlyDeposit)

    if (eligibleTier && eligibleTier.id !== updated.tierId) {
      const nextTier = sortedTiers.find(t => t.level > eligibleTier.level)

      // Add history entry
      const history = vipHistories.get(id) || []
      history.push({
        id: randomUUID(),
        memberId: id,
        fromTierId: updated.tierId,
        fromTierName: updated.tierName,
        toTierId: eligibleTier.id,
        toTierName: eligibleTier.name,
        reason: 'Automatic tier adjustment based on points',
        pointsAtChange: input.points,
        createdAt: new Date().toISOString()
      })
      vipHistories.set(id, history)

      updated = {
        ...updated,
        tierId: eligibleTier.id,
        tierName: eligibleTier.name,
        tierLevel: eligibleTier.level,
        nextTierId: nextTier?.id,
        nextTierName: nextTier?.name,
        pointsToNextTier: nextTier ? Math.max(0, nextTier.minMonthlyDeposit - input.points) : undefined
      }
    }
  }

  if (input.status) {
    updated.status = input.status
  }

  updated.lastActivityAt = new Date().toISOString()

  vipMembers.set(id, updated)
  return updated
}

export function addPoints(memberId: string, points: number, description: string, relatedEntityType?: string, relatedEntityId?: string): { member: VIPMember; transaction: VIPTransaction } | undefined {
  const member = vipMembers.get(memberId)
  if (!member) return undefined

  const transaction: VIPTransaction = {
    id: randomUUID(),
    memberId,
    type: 'credit',
    points,
    description,
    relatedEntityType,
    relatedEntityId,
    balanceBefore: member.currentPoints,
    balanceAfter: member.currentPoints + points,
    createdAt: new Date().toISOString()
  }

  const transactions = vipTransactions.get(memberId) || []
  transactions.push(transaction)
  vipTransactions.set(memberId, transactions)

  const updatedMember = updateMember(memberId, { points: member.currentPoints + points })
  if (!updatedMember) return undefined

  return { member: updatedMember, transaction }
}

export function removePoints(memberId: string, points: number, description: string, relatedEntityType?: string, relatedEntityId?: string): { member: VIPMember; transaction: VIPTransaction } | undefined {
  const member = vipMembers.get(memberId)
  if (!member) return undefined

  const transaction: VIPTransaction = {
    id: randomUUID(),
    memberId,
    type: 'debit',
    points,
    description,
    relatedEntityType,
    relatedEntityId,
    balanceBefore: member.currentPoints,
    balanceAfter: Math.max(0, member.currentPoints - points),
    createdAt: new Date().toISOString()
  }

  const transactions = vipTransactions.get(memberId) || []
  transactions.push(transaction)
  vipTransactions.set(memberId, transactions)

  const updatedMember = updateMember(memberId, { points: Math.max(0, member.currentPoints - points) })
  if (!updatedMember) return undefined

  return { member: updatedMember, transaction }
}

export function listTransactions(memberId: string, limit?: number): VIPTransaction[] {
  const transactions = vipTransactions.get(memberId) || []
  const sorted = transactions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  return limit ? sorted.slice(0, limit) : sorted
}

export function listHistory(memberId: string): VIPHistory[] {
  const history = vipHistories.get(memberId) || []
  return history.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

export function getStats(): {
  totalMembers: number
  activeMembers: number
  newMembersToday: number
  totalPointsAwarded: number
  tierDistribution: Array<{
    tierId: string
    tierName: string
    tierLevel: number
    memberCount: number
    percentage: number
  }>
  topMembers: VIPMember[]
} {
  const todayStart = getStartOfDay('Asia/Kolkata')
  const members = Array.from(vipMembers.values())
  const total = members.length
  const active = members.filter(m => m.status === 'active').length
  const newToday = members.filter(m => new Date(m.joinedAt) >= todayStart).length

  const totalPoints = members.reduce((sum, m) => sum + m.lifetimePoints, 0)

  const tierDistribution = Array.from(vipTiers.values()).map(tier => {
    const count = members.filter(m => m.tierId === tier.id).length
    return {
      tierId: tier.id,
      tierName: tier.name,
      tierLevel: tier.level,
      memberCount: count,
      percentage: total > 0 ? (count / total) * 100 : 0
    }
  }).sort((a, b) => b.tierLevel - a.tierLevel)

  const topMembers = members
    .filter(m => m.status === 'active')
    .sort((a, b) => b.currentPoints - a.currentPoints)
    .slice(0, 10)

  return {
    totalMembers: total,
    activeMembers: active,
    newMembersToday: newToday,
    totalPointsAwarded: totalPoints,
    tierDistribution,
    topMembers
  }
}

// Schedules
export function scheduleTierStatus(tierId: string, toStatus: string, effectiveAt: string) {
  const id = randomUUID()
  const rec = { id, tierId, toStatus, effectiveAt, createdAt: new Date().toISOString() }
  vipSchedules.set(id, rec)
  vipAudit.push({ id: randomUUID(), action: 'schedule', tierId, message: `Scheduled ${toStatus} at ${effectiveAt}`, at: new Date().toISOString() })
  return rec
}

export function listVIPSchedules() {
  return Array.from(vipSchedules.values()).sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt))
}

export function publishScheduled(id: string) {
  const rec = vipSchedules.get(id)
  if (!rec) return undefined
  const tier = updateTier(rec.tierId, { status: rec.toStatus })
  vipSchedules.delete(id)
  vipAudit.push({ id: randomUUID(), action: 'publish', tierId: rec.tierId, message: `Published scheduled change`, at: new Date().toISOString() })
  return tier
}

// Audit
export function listVIPAudit(limit?: number) {
  const list = vipAudit.slice().sort((a, b) => b.at.localeCompare(a.at))
  return limit ? list.slice(0, limit) : list
}

export function addVIPAudit(actor: string | undefined, action: string, tierId: string | undefined, message: string) {
  vipAudit.push({ id: randomUUID(), action, tierId, message, at: new Date().toISOString(), actor })
}

// Validation
export function validateTiers(): VIPValidationIssue[] {
  const issues: VIPValidationIssue[] = []
  const tiers = listTiers()
  const names = new Set<string>()
  const levels = new Set<number>()
  let lastDeposit = -Infinity
  for (const t of tiers) {
    if (names.has(t.name)) issues.push({ code: 'DUP_NAME', message: `Duplicate name ${t.name}`, tierId: t.id })
    names.add(t.name)
    if (levels.has(t.level)) issues.push({ code: 'DUP_LEVEL', message: `Duplicate level ${t.level}`, tierId: t.id })
    levels.add(t.level)
    if (t.minMonthlyDeposit < lastDeposit) issues.push({ code: 'ASC_DEPOSIT', message: `Min deposit should ascend`, tierId: t.id })
    lastDeposit = t.minMonthlyDeposit
  }
  return issues
}

// Versions
export function listVIPVersions(tierId: string) {
  return (vipVersions.get(tierId) || []).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function revertVIPVersion(versionId: string) {
  for (const [tierId, arr] of vipVersions.entries()) {
    const v = arr.find(x => x.id === versionId)
    if (v) {
      updateTier(tierId, { ...v.snapshot })
      vipAudit.push({ id: randomUUID(), action: 'revert', tierId, message: 'Reverted to version', at: new Date().toISOString() })
      return v.snapshot
    }
  }
  return undefined
}

// Import/Export
export function exportVIPTiers(): string {
  const payload = listTiers()
  return JSON.stringify(payload)
}

export function importVIPTiers(json: string): boolean {
  try {
    const arr: VIPTier[] = JSON.parse(json)
    for (const t of arr) {
      if (!t.name || !t.level || typeof t.minMonthlyDeposit !== 'number') return false
    }
    vipTiers.clear()
    for (const t of arr) {
      vipTiers.set(t.id || randomUUID(), { ...t, id: t.id || randomUUID(), updatedAt: new Date().toISOString(), createdAt: t.createdAt || new Date().toISOString() })
    }
    vipAudit.push({ id: randomUUID(), action: 'import', message: 'Imported tiers', at: new Date().toISOString() })
    return true
  } catch {
    return false
  }
}

