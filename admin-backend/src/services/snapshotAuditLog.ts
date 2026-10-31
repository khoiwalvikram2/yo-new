import {
  insertSnapshotEvent,
  type InsertSnapshotEventInput,
} from '@/repos/reporting/snapshotAuditRepo.js';

export function truncateDetailForAudit(err: unknown, maxLen = 4000): Record<string, unknown> {
  const msg = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error && err.stack ? err.stack.slice(0, maxLen) : undefined;
  return { message: msg.slice(0, 2000), stack };
}

export async function logSnapshotEvent(input: InsertSnapshotEventInput): Promise<void> {
  try {
    await insertSnapshotEvent(input);
  } catch {
    // Never break snapshot pipeline on audit failure
  }
}
