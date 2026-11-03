import Stripe from 'stripe';
import { randomBytes } from 'node:crypto';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { billingCustomer, billingEvent, profile } from '../db/schema.js';
import { user } from '../db/auth-schema.js';
import { env } from '../env.js';
import { creatorAccess } from './billing-policy.js';
import { fail } from './problem.js';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Customer = typeof billingCustomer.$inferSelect;
type Owner = typeof user.$inferSelect;
type State = Pick<Customer, 'subscriptionId' | 'status' | 'periodEnd' | 'cancelAtPeriodEnd' | 'paused'>;
const terminal = new Set(['canceled', 'incomplete_expired']);
const integrationIdentifier = `undertow_${Array.from(randomBytes(8), (b) => String.fromCharCode(97 + b % 26)).join('')}`;
/** Longer than the Stripe calls one billing action makes (10 s timeout, 2 retries each). */
const LEASE_SECONDS = 120;
const LEASE_WAIT_MS = 20_000;
/** Account deletion runs right after its billing check; a flag older than this means it failed. */
const DELETION_WINDOW_MS = 15 * 60_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class Billing {
  constructor(readonly stripe: Stripe, readonly config: {
    priceId: string; portalConfigurationId: string; webhookSecret: string; liveMode: boolean; publicUrl: string;
  }) {}

  async price() {
    const price = await this.stripe.prices.retrieve(this.config.priceId);
    if (!price.active || price.livemode !== this.config.liveMode || price.type !== 'recurring'
      || price.recurring?.interval !== 'month' || price.recurring.interval_count !== 1 || price.unit_amount === null) {
      fail(503, 'Creator billing is not configured with an active monthly price for this environment.');
    }
    return price;
  }

  /**
   * Serializes Checkout, reconciliation and account deletion for one owner without holding a database
   * connection during Stripe calls: a lease row (token and expiry) is taken with one short UPDATE and
   * released afterwards. A holder that dies leaves the lease to expire after LEASE_SECONDS.
   */
  private async withLease<T>(userId: string, fn: (lease: { owner: Owner; row: Customer; token: string }) => Promise<T>): Promise<T> {
    const owner = await db.query.user.findFirst({ where: eq(user.id, userId) });
    if (!owner) fail(404);
    await db.insert(billingCustomer).values({ userId }).onConflictDoNothing();
    const token = randomBytes(12).toString('hex');
    const deadline = Date.now() + LEASE_WAIT_MS;
    for (;;) {
      const [row] = await db.update(billingCustomer)
        .set({ leaseToken: token, leaseUntil: sql`now() + make_interval(secs => ${LEASE_SECONDS})` })
        .where(and(eq(billingCustomer.userId, userId), or(isNull(billingCustomer.leaseUntil), lt(billingCustomer.leaseUntil, sql`now()`))))
        .returning();
      if (row) {
        try {
          return await fn({ owner, row, token });
        } finally {
          await db.update(billingCustomer).set({ leaseToken: null, leaseUntil: null })
            .where(and(eq(billingCustomer.userId, userId), eq(billingCustomer.leaseToken, token)))
            .catch((error) => console.error('billing lease release failed', { userId, error }));
        }
      }
      if (Date.now() > deadline) fail(503, 'Billing is busy for this account. Try again in a moment.');
      await sleep(50 + Math.random() * 150);
    }
  }

  /** Writes inside a short transaction, only while this request still holds the lease. */
  private async write<T>(userId: string, token: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
      const [held] = await tx.select({ userId: billingCustomer.userId }).from(billingCustomer)
        .where(and(eq(billingCustomer.userId, userId), eq(billingCustomer.leaseToken, token))).for('update');
      if (!held) fail(503, 'Billing took too long for this account. Try again.');
      return fn(tx);
    });
  }

  /** Current subscription state from Stripe, so delayed or replayed events can't restore stale access. */
  private async fetchState(customerId: string): Promise<State> {
    const subscriptions: Stripe.Subscription[] = [];
    for await (const sub of this.stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100, expand: ['data.latest_invoice'] })) {
      if (sub.livemode !== this.config.liveMode) fail(503, 'Stripe environment mismatch.');
      subscriptions.push(sub);
    }
    subscriptions.sort((a, b) => Number(terminal.has(a.status)) - Number(terminal.has(b.status)) || b.created - a.created);
    const sub = subscriptions[0];
    const item = sub?.items.data.find((i) => i.price.id === this.config.priceId && i.quantity === 1);
    const invoice = sub?.latest_invoice;
    const paid = typeof invoice === 'object' && invoice !== null && invoice.status === 'paid';
    return {
      subscriptionId: sub?.id ?? null, status: sub?.status ?? 'none',
      periodEnd: item ? new Date(Math.min(item.current_period_end, sub?.cancel_at ?? Infinity) * 1000) : null,
      cancelAtPeriodEnd: !!sub && (sub.cancel_at_period_end || sub.cancel_at != null),
      paused: !!sub?.pause_collection || !!sub && (!paid || !item || sub.items.data.length !== 1),
    };
  }

  private async saveState(tx: Transaction, userId: string, state: State) {
    const [updated] = await tx.update(billingCustomer).set({ ...state, updatedAt: new Date() }).where(eq(billingCustomer.userId, userId)).returning();
    await tx.update(profile).set({ plan: creatorAccess(state) ? 'creator' : 'free', updatedAt: new Date() }).where(eq(profile.userId, userId));
    return updated;
  }

  /** Reads Stripe (no transaction open), then stores the result under the lease. */
  private async synchronize(row: Customer, token: string): Promise<Customer> {
    if (!row.customerId) return row;
    const state = await this.fetchState(row.customerId);
    return this.write(row.userId, token, (tx) => this.saveState(tx, row.userId, state));
  }

  async status(userId: string) {
    const price = await this.price();
    const row = await this.withLease(userId, ({ row, token }) => this.synchronize(row, token));
    return { enabled: true, sandbox: !this.config.liveMode, amount: price.unit_amount!, currency: price.currency,
      status: row.status, subscribed: !!row.subscriptionId && !terminal.has(row.status),
      creator: creatorAccess(row), periodEnd: row.periodEnd?.toISOString() ?? null, cancelAtPeriodEnd: row.cancelAtPeriodEnd };
  }

  async checkout(userId: string) {
    await this.price();
    return this.withLease(userId, async ({ owner, row, token }) => {
      if (row.deletingAt && Date.now() - row.deletingAt.getTime() < DELETION_WINDOW_MS) fail(409, 'Account deletion is pending.');
      if (!owner.emailVerified) fail(403, 'Confirm your email before subscribing.');
      let customerId = row.customerId;
      if (!customerId) {
        const customer = await this.stripe.customers.create({ email: owner.email, name: owner.name,
          metadata: { app: 'undertow', userId } }, { idempotencyKey: `undertow-customer-${userId}` });
        if (customer.livemode !== this.config.liveMode) fail(503, 'Stripe environment mismatch.');
        customerId = customer.id;
        await this.write(userId, token, (tx) => tx.update(billingCustomer).set({ customerId }).where(eq(billingCustomer.userId, userId)));
      }
      const current = await this.synchronize({ ...row, customerId }, token);
      if (current.subscriptionId && !terminal.has(current.status)) fail(409, 'You already have a subscription. Manage it in billing settings.');
      // Also recovers a session created at Stripe before a previous request failed to finish.
      for await (const session of this.stripe.checkout.sessions.list({ customer: customerId, status: 'open', limit: 100 })) {
        if (session.metadata?.app === 'undertow' && session.metadata.priceId === this.config.priceId && session.url) return session.url;
      }
      const session = await this.stripe.checkout.sessions.create({
        mode: 'subscription', customer: customerId, client_reference_id: userId,
        managed_payments: { enabled: false },
        line_items: [{ price: this.config.priceId, quantity: 1 }],
        subscription_data: { metadata: { app: 'undertow', userId }, billing_mode: { type: 'flexible' } },
        metadata: { app: 'undertow', userId, priceId: this.config.priceId },
        success_url: `${this.config.publicUrl}/?account=billing&checkout=success`,
        cancel_url: `${this.config.publicUrl}/?account=billing&checkout=cancelled`,
        integration_identifier: integrationIdentifier,
      });
      if (!session.url) fail(503, 'Stripe did not return a Checkout URL.');
      return session.url;
    });
  }

  async portal(userId: string) {
    const row = await db.query.billingCustomer.findFirst({ where: eq(billingCustomer.userId, userId) });
    if (!row?.customerId) fail(409, 'No billing account yet.');
    return (await this.stripe.billingPortal.sessions.create({ customer: row.customerId,
      configuration: this.config.portalConfigurationId, return_url: `${this.config.publicUrl}/?account=billing` })).url;
  }

  async webhook(body: string, signature: string) {
    let event: Stripe.Event;
    try { event = this.stripe.webhooks.constructEvent(body, signature, this.config.webhookSecret); }
    catch { fail(400, 'Invalid Stripe webhook signature.'); }
    if (event.livemode !== this.config.liveMode || event.account) fail(400, 'Unexpected Stripe event environment or account.');
    if (!/^(customer\.subscription\.|checkout\.session\.|invoice\.)/.test(event.type)) return;
    const object = event.data.object;
    const customer = 'customer' in object ? object.customer : null;
    const customerId = typeof customer === 'string' ? customer : customer?.id;
    if (!customerId) return;
    const found = await db.query.billingCustomer.findFirst({ where: eq(billingCustomer.customerId, customerId) });
    if (!found) return; // Unrelated sandbox app or a previously deleted owner.
    await this.withLease(found.userId, async ({ row, token }) => {
      if (await db.query.billingEvent.findFirst({ where: eq(billingEvent.id, event.id) })) return;
      if (!row.customerId) return;
      const state = await this.fetchState(row.customerId);
      // The event is recorded only together with the state it produced, so a failure leaves it retryable.
      await this.write(row.userId, token, async (tx) => {
        await this.saveState(tx, row.userId, state);
        await tx.insert(billingEvent).values({ id: event.id }).onConflictDoNothing();
      });
    });
  }

  async beforeDelete(userId: string) {
    await this.withLease(userId, async ({ row, token }) => {
      const current = await this.synchronize(row, token);
      if (current.subscriptionId && !terminal.has(current.status)) fail(409, 'Cancel your subscription and wait for it to end before deleting your account.');
      if (row.customerId) {
        // An open checkout could become a subscription after the account disappears.
        for await (const session of this.stripe.checkout.sessions.list({ customer: row.customerId, status: 'open', limit: 100 })) {
          if (session.metadata?.app === 'undertow') await this.stripe.checkout.sessions.expire(session.id);
        }
      }
      await this.write(userId, token, (tx) => tx.update(billingCustomer).set({ deletingAt: new Date() }).where(eq(billingCustomer.userId, userId)));
    });
  }
}

export const billing = env.STRIPE_API_KEY && env.STRIPE_CREATOR_PRICE_ID && env.STRIPE_WEBHOOK_SECRET && env.STRIPE_PORTAL_CONFIGURATION_ID
  ? new Billing(new Stripe(env.STRIPE_API_KEY, { maxNetworkRetries: 2, timeout: 10_000 }), {
    priceId: env.STRIPE_CREATOR_PRICE_ID, portalConfigurationId: env.STRIPE_PORTAL_CONFIGURATION_ID,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET, liveMode: env.STRIPE_LIVE_MODE, publicUrl: env.PUBLIC_URL,
  }) : null;
