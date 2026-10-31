import { getDueSchedules, markScheduleExecuted, markScheduleFailed } from '@src/repos/matka/matkaResultSchedulesRepo.js'
import { createMatkaResult, buildMatkaResultContext } from '@src/repos/matka/matkaResultsRepo.js'
import { getEnv } from '@src/config/env.js'

/**
 * Poll and execute due scheduled results
 * This should be called periodically (e.g., via cron or interval)
 */
export async function processScheduledResults(tenant: string | null = 'default') {
  const dueSchedules = await getDueSchedules(tenant, 100) // Process up to 100 at a time
  
  const results = []
  
  for (const schedule of dueSchedules) {
    try {
      // Build context for system execution
      const ctx = {
        tenant: schedule.tenant,
        actorId: 'system',
        ip: undefined,
        userAgent: undefined,
      }
      
      // Create the result
      const created = await createMatkaResult(
        {
          matkaId: schedule.matkaId,
          date: schedule.date,
          type: schedule.type as 'open' | 'close',
          result: schedule.result,
          idempotencyKey: `scheduled:${schedule.id}`, 
        },
        ctx
      )
      
      // Mark schedule as executed
      await markScheduleExecuted(schedule.id, 'system', schedule.tenant)
      
      results.push({
        scheduleId: schedule.id,
        success: true,
        resultId: created.id,
      })
    } catch (error: any) {
      // Mark schedule as failed
      await markScheduleFailed(schedule.id, error.message || 'Execution failed', schedule.tenant)
      
      results.push({
        scheduleId: schedule.id,
        success: false,
        error: error.message || 'Execution failed',
      })
    }
  }
  
  return results
}

/**
 * Start the scheduler polling loop
 * This runs continuously, checking for due schedules every minute
 */
export function startSchedulerPolling(tenant: string | null = 'default', intervalMs = 60000) {
  let isRunning = false
  let intervalId: NodeJS.Timeout | null = null
  
  const poll = async () => {
    if (isRunning) return // Prevent concurrent executions
    isRunning = true
    
    try {
      await processScheduledResults(tenant)
    } catch (error) {
    } finally {
      isRunning = false
    }
  }
  
  // Initial poll
  poll()
  
  // Set up interval
  intervalId = setInterval(poll, intervalMs)
  
  return {
    stop: () => {
      if (intervalId) {
        clearInterval(intervalId)
        intervalId = null
      }
      isRunning = false
    },
  }
}

/**
 * Initialize scheduler for all tenants (if multi-tenant)
 * This should be called at application startup
 */
export async function initializeSchedulers() {
  // For now, just start for default tenant
  // In multi-tenant setup, you'd iterate over all tenants
  const scheduler = startSchedulerPolling(null, 60000) // Poll every minute
  
  // Return cleanup function
  return () => {
    scheduler.stop()
  }
}

