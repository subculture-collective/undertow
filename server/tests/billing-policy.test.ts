import { describe, expect, it } from 'vitest';
import { creatorAccess } from '../src/lib/billing-policy.js';

describe('Creator entitlements', () => {
  const now = new Date('2026-10-01T00:00:00Z');
  const paid = { status: 'active', periodEnd: new Date('2026-11-01T00:00:00Z'), paused: false };
  it('keeps paid access until the period ends, including scheduled cancellation', () => {
    expect(creatorAccess(paid, now)).toBe(true);
    expect(creatorAccess(paid, paid.periodEnd)).toBe(false);
  });
  it.each(['past_due', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused', 'trialing', 'none'])('denies %s subscriptions', (status) => {
    expect(creatorAccess({ ...paid, status }, now)).toBe(false);
  });
  it('denies paused collection and missing billing periods', () => {
    expect(creatorAccess({ ...paid, paused: true }, now)).toBe(false);
    expect(creatorAccess({ ...paid, periodEnd: null }, now)).toBe(false);
  });
});
