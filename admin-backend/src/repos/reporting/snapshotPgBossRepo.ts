import { pool } from '@/db/client.js';

export type PgBossJobCountRow = { name: string; state: string; count: number };

export type PgBossScheduleRow = { name: string; cron: string | null; timezone: string | null };

/**
 * Read-only snapshot of pg-boss queue rows for reporting snapshot job names.
 * Fails soft if schema `pgboss` is missing or version differs.
 */
export async function listPgBossSnapshotJobCounts(): Promise<{
  rows: PgBossJobCountRow[];
  error: string | null;
}> {
  try {
    const res = await pool.query<{
      name: string;
      state: string;
      c: string;
    }>(
      `select name, state, count(*)::text as c
       from pgboss.job
       where name like 'reporting/snapshot%'
       group by name, state
       order by name, state`,
    );
    return {
      rows: res.rows.map((r) => ({ name: r.name, state: r.state, count: Number(r.c) || 0 })),
      error: null,
    };
  } catch (e) {
    return {
      rows: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function listPgBossSnapshotSchedules(): Promise<{
  rows: PgBossScheduleRow[];
  error: string | null;
}> {
  try {
    const res = await pool.query<{
      name: string;
      cron: string | null;
      timezone: string | null;
    }>(
      `select name, cron, timezone
       from pgboss.schedule
       where name like 'reporting/snapshot%'
       order by name`,
    );
    return { rows: res.rows, error: null };
  } catch (e1) {
    try {
      const res = await pool.query<{
        name: string;
        cron: string | null;
        timezone: string | null;
      }>(
        `select name, cron, tz as timezone
         from pgboss.schedule
         where name like 'reporting/snapshot%'
         order by name`,
      );
      return { rows: res.rows, error: null };
    } catch (e2) {
      const a = e1 instanceof Error ? e1.message : String(e1);
      const b = e2 instanceof Error ? e2.message : String(e2);
      return {
        rows: [],
        error: `${a} | fallback: ${b}`,
      };
    }
  }
}
