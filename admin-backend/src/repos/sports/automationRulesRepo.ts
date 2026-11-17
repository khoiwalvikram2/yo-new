import { db } from '@src/db/client.js'
import { automationRulesTable } from '@shared/db/schema.js'
import { eq, and, desc, or, isNull } from 'drizzle-orm'

export type AutomationRuleType = 
  | 'AUTO_VOID'
  | 'AUTO_SUSPEND'
  | 'MARKET_MAKER'

export interface AutomationRuleConfig {
  triggers?: {
    stakeThreshold?: number
    patternTypes?: string[]
    riskLevel?: string
    lossStreak?: number
    bookBalanceThreshold?: number
    [key: string]: any
  }
  actions?: Array<{
    type: string
    reason?: string
    limitType?: string
    value?: number
    message?: string
    [key: string]: any
  }>
  cooldown?: number
  notifications?: {
    enabled?: boolean
    channels?: string[]
  }
}

export interface AutomationRule {
  id: string
  tenant: string
  whitelabelId: string
  eventId: string | null
  ruleType: AutomationRuleType
  config: AutomationRuleConfig
  enabled: boolean
  priority: number
  createdAt: Date
  updatedAt: Date
}

export interface UpsertAutomationRuleInput {
  tenant?: string
  whitelabelId: string
  eventId?: string | null
  ruleType: AutomationRuleType
  config: AutomationRuleConfig
  enabled?: boolean
  priority?: number
}

/**
 * Get automation rules for an event (or global if eventId is null)
 */
export async function getAutomationRules(
  eventId: string | null | undefined,
  tenant: string = 'default',
  whitelabelId?: string
): Promise<AutomationRule[]> {
  const conditions = [eq(automationRulesTable.tenant, tenant)]
  
  if (whitelabelId) {
    conditions.push(eq(automationRulesTable.whitelabelId, whitelabelId))
  }
  
  // Get event-specific rules OR global rules (eventId is null)
  if (eventId) {
    const eventCondition = or(
      eq(automationRulesTable.eventId, eventId),
      isNull(automationRulesTable.eventId)
    )
    if (eventCondition) {
      conditions.push(eventCondition)
    }
  } else {
    // If no eventId specified, get only global rules
    conditions.push(isNull(automationRulesTable.eventId))
  }
  
  const rules = await db
    .select()
    .from(automationRulesTable)
    .where(and(...conditions))
    .orderBy(desc(automationRulesTable.priority), desc(automationRulesTable.createdAt))
  
  return rules.map(row => ({
    id: row.id,
    tenant: row.tenant,
    whitelabelId: row.whitelabelId,
    eventId: row.eventId,
    ruleType: row.ruleType as AutomationRuleType,
    config: (row.config as AutomationRuleConfig) || {},
    enabled: row.enabled,
    priority: row.priority,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }))
}

/**
 * Upsert automation rule
 */
export async function upsertAutomationRule(
  input: UpsertAutomationRuleInput
): Promise<AutomationRule> {
  const tenant = input.tenant || 'default'
  const now = new Date()
  
  // Check if rule exists (by eventId + ruleType + whitelabelId)
  const existingConditions = [
    eq(automationRulesTable.whitelabelId, input.whitelabelId),
    eq(automationRulesTable.ruleType, input.ruleType),
    eq(automationRulesTable.tenant, tenant),
  ]
  
  if (input.eventId) {
    existingConditions.push(eq(automationRulesTable.eventId, input.eventId))
  } else {
    existingConditions.push(isNull(automationRulesTable.eventId))
  }
  
  const existing = await db
    .select()
    .from(automationRulesTable)
    .where(and(...existingConditions))
    .limit(1)
  
  if (existing.length > 0) {
    // Update existing
    const [updated] = await db
      .update(automationRulesTable)
      .set({
        config: input.config,
        enabled: input.enabled !== undefined ? input.enabled : existing[0].enabled,
        priority: input.priority !== undefined ? input.priority : existing[0].priority,
        updatedAt: now,
      })
      .where(eq(automationRulesTable.id, existing[0].id))
      .returning()
    
    return {
      id: updated.id,
      tenant: updated.tenant,
      whitelabelId: updated.whitelabelId,
      eventId: updated.eventId,
      ruleType: updated.ruleType as AutomationRuleType,
      config: (updated.config as AutomationRuleConfig) || {},
      enabled: updated.enabled,
      priority: updated.priority,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    }
  } else {
    // Insert new
    const [inserted] = await db
      .insert(automationRulesTable)
      .values({
        tenant,
        whitelabelId: input.whitelabelId,
        eventId: input.eventId || null,
        ruleType: input.ruleType,
        config: input.config,
        enabled: input.enabled !== undefined ? input.enabled : true,
        priority: input.priority !== undefined ? input.priority : 0,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    
    return {
      id: inserted.id,
      tenant: inserted.tenant,
      whitelabelId: inserted.whitelabelId,
      eventId: inserted.eventId,
      ruleType: inserted.ruleType as AutomationRuleType,
      config: (inserted.config as AutomationRuleConfig) || {},
      enabled: inserted.enabled,
      priority: inserted.priority,
      createdAt: inserted.createdAt,
      updatedAt: inserted.updatedAt,
    }
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Delete automation rule
 *
 * Only a rule of the given tenant and whitelabel, the scope getAutomationRules
 * lists and upsertAutomationRule writes. Deleting by id alone let an admin of
 * one whitelabel remove another whitelabel's live rule, which user-backend then
 * silently stopped applying. A malformed id is not found rather than a SQL error.
 */
export async function deleteAutomationRule(
  ruleId: string,
  tenant: string,
  whitelabelId: string
): Promise<boolean> {
  if (!UUID_PATTERN.test(String(ruleId))) return false
  const result = await db
    .delete(automationRulesTable)
    .where(and(
      eq(automationRulesTable.id, ruleId),
      eq(automationRulesTable.tenant, tenant),
      eq(automationRulesTable.whitelabelId, whitelabelId),
    ))
    .returning()

  return result.length > 0
}

/**
 * Evaluate rules against a bet
 */
export async function evaluateRules(
  bet: any,
  context: {
    eventId: string
    tenant: string
    whitelabelId: string
    userRiskLevel?: string
    detectedPatterns?: string[]
    bookBalance?: number
  }
): Promise<AutomationRule[]> {
  const rules = await getAutomationRules(
    context.eventId,
    context.tenant,
    context.whitelabelId
  )
  
  // Filter to only enabled rules
  const enabledRules = rules.filter(r => r.enabled)
  
  // Return rules that match conditions (will be evaluated by service)
  return enabledRules
}

/**
 * Log automation action (for audit trail)
 */
export async function logAutomationAction(
  action: {
    ruleId: string
    betId: string
    actionType: string
    result: string
    timestamp: Date
    details?: Record<string, any>
  }
): Promise<void> {
  // This could be stored in an audit table or logging system
  // For now, we'll just log to console
  
  // TODO: Implement proper audit logging table if needed
}

