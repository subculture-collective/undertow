import { and, eq, lt, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { renderJob } from '../db/schema.js';
import { storage } from './storage.js';

let cleaning: Promise<void> | null = null;

/** A worker that hasn't reported for this long is presumed dead; its job is retried once, then failed. */
export const STALE_MS = 3 * 60_000;
const MAX_ATTEMPTS = 2;

/**
 * Requeues (or, after the last attempt, fails) running jobs whose worker went
 * quiet. Workers run it when they claim, and the API runs it every minute, so a
 * job isn't stuck as running when no worker is left to claim anything.
 */
export async function requeueStaleRenders() {
  const cutoff = new Date(Date.now() - STALE_MS);
  // Terminal files are removed by hourly reconciliation, which also retries failed deletions.
  await db.update(renderJob).set({ status: 'failed', error: 'The render stopped responding.', finishedAt: new Date(), tokenHash: null })
    .where(and(eq(renderJob.status, 'running'), lt(renderJob.heartbeatAt, cutoff), sql`${renderJob.attempts} >= ${MAX_ATTEMPTS}`));
  await db.update(renderJob).set({ status: 'queued', tokenHash: null, workerId: null })
    .where(and(eq(renderJob.status, 'running'), lt(renderJob.heartbeatAt, cutoff)));
}

/** Reconcile disk on each pass so interrupted or failed deletions get retried. */
async function reconcile() {
  await db.update(renderJob).set({ status: 'expired', outputBytes: null })
    .where(and(eq(renderJob.status, 'done'), lt(renderJob.expiresAt, new Date())));
  await db.update(renderJob).set({ status: 'cancelled', finishedAt: new Date(), tokenHash: null, error: 'Uploads were not completed within a day.' })
    .where(and(eq(renderJob.status, 'awaiting_upload'), lt(renderJob.createdAt, new Date(Date.now() - 86_400_000))));
  for (const id of await storage.jobIds()) {
    try {
      await db.transaction(async (tx) => {
        // File writers hold this same row lock. Never delete a current write.
        const [job] = await tx.select({ status: renderJob.status }).from(renderJob).where(eq(renderJob.id, id)).for('update');
        if (!job || ['failed', 'cancelled', 'expired'].includes(job.status)) await storage.removeJob(id);
        else if (job.status === 'done') await storage.removeInputs(id);
      });
    } catch (error) {
      console.error('Render cleanup failed', { jobId: id, error });
    }
  }
}

export function expireRenders() {
  if (!cleaning) cleaning = reconcile().finally(() => { cleaning = null; });
  return cleaning;
}
