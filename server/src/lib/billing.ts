import Stripe from 'stripe';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { billingCustomer, billingEvent, profile } from '../db/schema.js';
import { user } from '../db/auth-schema.js';
import { env } from '../env.js';
import { creatorAccess } from './billing-policy.js';
import { fail } from './problem.js';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Customer = typeof billingCustomer.$inferSelect;
const terminal = new Set(['canceled', 'incomplete_expired']);
const integrationIdentifier = `undertow_${Array.from(randomBytes(8), (b) => String.fromCharCode(97 + b % 26)).join('')}`;

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

  private async lock(tx: Transaction, userId: string) {
    // Serializes Checkout, reconciliation and account deletion for this owner.
    const [owner] = await tx.select().from(user).where(eq(user.id, userId)).for('update');
    if (!owner) fail(404);
    await tx.insert(billingCustomer).values({ userId }).onConflictDoNothing();
    const [row] = await tx.select().from(billingCustomer).where(eq(billingCustomer.userId, userId)).for('update');
    return { owner, row };
  }

  private async synchronize(tx: Transaction, row: Customer) {
    if (!row.customerId) return row;
    const subscriptions: Stripe.Subscription[] = [];
    for await (const sub of this.stripe.subscriptions.list({ customer: row.customerId, status: 'all', limit: 100, expand: ['data.latest_invoice'] })) {
      if (sub.livemode !== this.config.liveMode) fail(503, 'Stripe environment mismatch.');
      subscriptions.push(sub);
    }
    // Read current state from Stripe under the owner lock, so delayed events cannot restore stale access.
    subscriptions.sort((a, b) => Number(terminal.has(a.status)) - Number(terminal.has(b.status)) || b.created - a.created);
    const sub = subscriptions[0];
    const item = sub?.items.data.find((i) => i.price.id === this.config.priceId && i.quantity === 1);
    const invoice = sub?.latest_invoice;
    const paid = typeof invoice === 'object' && invoice !== null && invoice.status === 'paid';
    const state = {
      subscriptionId: sub?.id ?? null, status: sub?.status ?? 'none',
      periodEnd: item ? new Date(item.current_period_end * 1000) : null,
      cancelAtPeriodEnd: sub?.cancel_at_period_end ?? false,
      paused: !!sub?.pause_collection || !!sub && (!paid || !item || sub.items.data.length !== 1), updatedAt: new Date(),
    };
    const [updated] = await tx.update(billingCustomer).set(state).where(eq(billingCustomer.userId, row.userId)).returning();
    await tx.update(profile).set({ plan: creatorAccess(state) ? 'creator' : 'free', updatedAt: new Date() }).where(eq(profile.userId, row.userId));
    return updated;
  }

  async status(userId: string) {
    const price = await this.price();
    const row = await db.transaction(async (tx) => {
      const { row } = await this.lock(tx, userId);
      return this.synchronize(tx, row);
    });
    return { enabled: true, sandbox: !this.config.liveMode, amount: price.unit_amount!, currency: price.currency,
      status: row.status, subscribed: !!row.subscriptionId && !terminal.has(row.status),
      creator: creatorAccess(row), periodEnd: row.periodEnd?.toISOString() ?? null, cancelAtPeriodEnd: row.cancelAtPeriodEnd };
  }

  async checkout(userId: string) {
    await this.price();
    return db.transaction(async (tx) => {
      const { owner, row } = await this.lock(tx, userId);
      if (row.deleting) fail(409, 'Account deletion is pending.');
      if (!owner.emailVerified) fail(403, 'Confirm your email before subscribing.');
      let customerId = row.customerId;
      if (!customerId) {
        const customer = await this.stripe.customers.create({ email: owner.email, name: owner.name,
          metadata: { app: 'undertow', userId } }, { idempotencyKey: `undertow-customer-${userId}` });
        if (customer.livemode !== this.config.liveMode) fail(503, 'Stripe environment mismatch.');
        customerId = customer.id;
        await tx.update(billingCustomer).set({ customerId }).where(eq(billingCustomer.userId, userId));
      }
      const current = await this.synchronize(tx, { ...row, customerId });
      if (current.subscriptionId && !terminal.has(current.status)) fail(409, 'You already have a subscription. Manage it in billing settings.');
      // Also recovers a session created at Stripe before a previous database transaction failed.
      for await (const session of this.stripe.checkout.sessions.list({ customer: customerId, status: 'open', limit: 100 })) {
        if (session.metadata?.app === 'undertow' && session.metadata.priceId === this.config.priceId && session.url) return session.url;
      }
      const session = await this.stripe.checkout.sessions.create({
        mode: 'subscription', customer: customerId, client_reference_id: userId,
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
    return db.transaction(async (tx) => {
      const { row } = await this.lock(tx, userId);
      if (!row.customerId) fail(409, 'No billing account yet.');
      return (await this.stripe.billingPortal.sessions.create({ customer: row.customerId,
        configuration: this.config.portalConfigurationId, return_url: `${this.config.publicUrl}/?account=billing` })).url;
    });
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
    await db.transaction(async (tx) => {
      const [row] = await tx.select().from(billingCustomer).where(eq(billingCustomer.customerId, customerId));
      if (!row) return; // Unrelated sandbox app or a previously deleted owner.
      const { row: locked } = await this.lock(tx, row.userId);
      if ((await tx.select().from(billingEvent).where(eq(billingEvent.id, event.id))).length) return;
      await this.synchronize(tx, locked);
      await tx.insert(billingEvent).values({ id: event.id }).onConflictDoNothing();
    });
  }

  async beforeDelete(userId: string) {
    await db.transaction(async (tx) => {
      const { row } = await this.lock(tx, userId);
      const current = await this.synchronize(tx, row);
      if (current.subscriptionId && !terminal.has(current.status)) fail(409, 'Cancel your subscription and wait for it to end before deleting your account.');
      if (row.customerId) {
        // An open checkout could become a subscription after the account disappears.
        for await (const session of this.stripe.checkout.sessions.list({ customer: row.customerId, status: 'open', limit: 100 })) {
          if (session.metadata?.app === 'undertow') await this.stripe.checkout.sessions.expire(session.id);
        }
      }
      await tx.update(billingCustomer).set({ deleting: true }).where(eq(billingCustomer.userId, userId));
    });
  }
}

export const billing = env.STRIPE_API_KEY && env.STRIPE_CREATOR_PRICE_ID && env.STRIPE_WEBHOOK_SECRET && env.STRIPE_PORTAL_CONFIGURATION_ID
  ? new Billing(new Stripe(env.STRIPE_API_KEY, { maxNetworkRetries: 2, timeout: 10_000 }), {
    priceId: env.STRIPE_CREATOR_PRICE_ID, portalConfigurationId: env.STRIPE_PORTAL_CONFIGURATION_ID,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET, liveMode: env.STRIPE_LIVE_MODE, publicUrl: env.PUBLIC_URL,
  }) : null;
