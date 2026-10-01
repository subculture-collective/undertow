/** Scheduled cancellation keeps access until the paid period ends. No unpaid grace period. */
export function creatorAccess(subscription: { status: string; periodEnd: Date | null; paused: boolean }, now = new Date()) {
  return subscription.status === 'active' && !subscription.paused
    && subscription.periodEnd !== null && subscription.periodEnd > now;
}
