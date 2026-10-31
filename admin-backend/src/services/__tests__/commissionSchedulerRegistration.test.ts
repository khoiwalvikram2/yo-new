/**
 * The commission accrual is registered as a pg-boss cron schedule (IST), and its
 * worker never enqueues the next run itself. The old worker re-sent the next run
 * with a singletonKey from inside the running job; pg-boss 9 dropped that insert
 * (ON CONFLICT DO NOTHING while the same singleton job was active), so accrual ran
 * once per server start. No database: the boss is a fake that records calls.
 *
 * Run: node --env-file-if-exists=.env --test --import tsx src/services/__tests__/commissionSchedulerRegistration.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerCommissionAccrualJob,
  buildCommissionAccrualCron,
  COMMISSION_ACCRUAL_JOB,
} from '../commissionScheduler.js';

function fakeBoss() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  let handler: ((...a: unknown[]) => Promise<unknown>) | null = null;
  const boss = {
    schedule: async (...args: unknown[]) => {
      calls.push({ method: 'schedule', args });
    },
    work: async (name: string, fn: (...a: unknown[]) => Promise<unknown>) => {
      calls.push({ method: 'work', args: [name] });
      handler = fn;
      return 'worker-id';
    },
    send: async (...args: unknown[]) => {
      calls.push({ method: 'send', args });
      return null;
    },
    publish: async (...args: unknown[]) => {
      calls.push({ method: 'publish', args });
      return [];
    },
  };
  return { boss, calls, run: () => handler!({ id: 'job-1', name: COMMISSION_ACCRUAL_JOB, data: {} }) };
}

describe('commission accrual scheduling', () => {
  it('registers a cron schedule in Asia/Kolkata and a worker for the same job', async () => {
    const { boss, calls } = fakeBoss();
    await registerCommissionAccrualJob(boss as any, async () => {});
    const schedule = calls.find((c) => c.method === 'schedule');
    assert.ok(schedule, 'boss.schedule must be called');
    const [name, cron, data, opts] = schedule!.args as [string, string, object, { tz?: string }];
    assert.equal(name, COMMISSION_ACCRUAL_JOB);
    assert.equal(cron, buildCommissionAccrualCron());
    assert.deepEqual(data, {});
    assert.equal(opts?.tz, process.env.COMMISSION_SCHEDULER_TZ || 'Asia/Kolkata');
    assert.deepEqual(calls.find((c) => c.method === 'work')?.args, [COMMISSION_ACCRUAL_JOB]);
    assert.equal(calls.filter((c) => c.method === 'send' || c.method === 'publish').length, 0);
  });

  it('the worker runs the accrual and does not send or publish the next run', async () => {
    const { boss, calls, run } = fakeBoss();
    let runs = 0;
    await registerCommissionAccrualJob(boss as any, async () => {
      runs++;
    });
    await run();
    await run();
    assert.equal(runs, 2);
    assert.equal(calls.filter((c) => c.method === 'send' || c.method === 'publish').length, 0);
  });

  it('a failing run is logged and swallowed (the next cron tick runs again)', async () => {
    const { boss, run } = fakeBoss();
    const originalError = console.error;
    console.error = () => {};
    try {
      await registerCommissionAccrualJob(boss as any, async () => {
        throw new Error('boom');
      });
      await assert.doesNotReject(run());
    } finally {
      console.error = originalError;
    }
  });

  it('HH:mm becomes a daily cron', () => {
    assert.equal(buildCommissionAccrualCron('00:30'), '30 0 * * *');
    assert.equal(buildCommissionAccrualCron('23:05'), '5 23 * * *');
    assert.equal(buildCommissionAccrualCron('bad'), '0 0 * * *');
  });
});
