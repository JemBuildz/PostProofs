import Stripe from 'stripe';
import type { PostProofStore, SubscriptionPlan, SubscriptionStatus } from './store.ts';

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  priceIdSolo: string;
  priceIdStudio: string;
  appUrl: string;
}

export function loadStripeConfig(env: NodeJS.ProcessEnv = process.env): StripeConfig {
  return {
    secretKey: (env.STRIPE_SECRET_KEY || '').trim(),
    webhookSecret: (env.STRIPE_WEBHOOK_SECRET || '').trim(),
    priceIdSolo: (env.STRIPE_PRICE_ID_SOLO || '').trim(),
    priceIdStudio: (env.STRIPE_PRICE_ID_STUDIO || '').trim(),
    appUrl: (env.APP_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  };
}

export function assertTestModeKey(secretKey: string): void {
  if (!secretKey) return;
  if (secretKey.startsWith('sk_live_') || secretKey.startsWith('rk_live_')) {
    throw new Error(
      'Live Stripe keys are blocked in this build. Provide a Stripe TEST mode secret key (sk_test_...).'
    );
  }
  if (!secretKey.startsWith('sk_test_') && !secretKey.startsWith('rk_test_')) {
    throw new Error(
      'Invalid STRIPE_SECRET_KEY format. Expected a Stripe test secret key starting with sk_test_.'
    );
  }
}

export function createStripeClient(config: StripeConfig): Stripe | null {
  if (!config.secretKey) return null;
  assertTestModeKey(config.secretKey);
  return new Stripe(config.secretKey);
}

export function mapPriceIdToPlan(
  priceId: string | null | undefined,
  config: StripeConfig,
  metadataPlan?: string | null
): SubscriptionPlan {
  if (priceId && config.priceIdStudio && priceId === config.priceIdStudio) {
    return 'studio';
  }
  if (priceId && config.priceIdSolo && priceId === config.priceIdSolo) {
    return 'solo';
  }
  if (metadataPlan === 'studio' || metadataPlan === 'solo') {
    return metadataPlan;
  }
  return 'free';
}

export function normalizeStripeStatus(status: string | null | undefined): SubscriptionStatus {
  switch (status) {
    case 'active':
      return 'active';
    case 'trialing':
      return 'trialing';
    case 'past_due':
      return 'past_due';
    case 'canceled':
      return 'canceled';
    case 'unpaid':
      return 'unpaid';
    default:
      return 'inactive';
  }
}

async function resolveFirebaseUid(
  store: PostProofStore,
  opts: { userId?: string | null; customerId?: string | null; subscriptionId?: string | null }
): Promise<string | null> {
  if (opts.userId && opts.userId.trim()) {
    return opts.userId.trim();
  }
  if (opts.customerId) {
    const byCustomer = await store.findUserIdByStripeCustomer(opts.customerId);
    if (byCustomer) return byCustomer;
  }
  if (opts.subscriptionId) {
    const bySub = await store.findUserIdByStripeSubscription(opts.subscriptionId);
    if (bySub) return bySub;
  }
  return null;
}

export async function processStripeWebhookEvent(
  store: PostProofStore,
  event: Stripe.Event,
  config: StripeConfig
): Promise<{ handled: boolean; duplicate: boolean }> {
  // Idempotency check before applying any state transitions
  if (await store.hasProcessedStripeEvent(event.id)) {
    return { handled: false, duplicate: true };
  }

  // Reserve the event ID atomically so concurrent duplicate deliveries cannot double-apply
  const claimed = await store.recordStripeEvent(event.id, event.type);
  if (!claimed) {
    return { handled: false, duplicate: true };
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const rawUid = session.client_reference_id || session.metadata?.userId || null;
    const customerId =
      typeof session.customer === 'string' ? session.customer : session.customer?.id || null;
    const subscriptionId =
      typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription?.id || null;
    const metaPlan = session.metadata?.plan || null;
    const customerEmail = session.customer_details?.email || session.customer_email || undefined;

    const uid = await resolveFirebaseUid(store, {
      userId: rawUid,
      customerId,
      subscriptionId,
    });

    if (uid) {
      const existing = await store.getBillingRecord(uid);
      const nextPlan: SubscriptionPlan =
        metaPlan === 'solo' || metaPlan === 'studio'
          ? metaPlan
          : existing?.plan ?? 'free';
      const nextStatus: SubscriptionStatus =
        session.payment_status === 'paid' || session.status === 'complete'
          ? 'active'
          : existing?.status ?? 'inactive';

      await store.upsertBillingRecord(uid, {
        ...(customerEmail ? { email: customerEmail } : {}),
        ...(customerId ? { stripeCustomerId: customerId } : {}),
        ...(subscriptionId ? { stripeSubscriptionId: subscriptionId } : {}),
        plan: nextPlan,
        status: nextStatus,
      });
    }
  } else if (
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    const sub = event.data.object as Stripe.Subscription;
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id || null;
    const rawUid = sub.metadata?.userId || null;
    const firstItem = sub.items?.data?.[0];
    const priceId = firstItem?.price?.id || null;

    const uid = await resolveFirebaseUid(store, {
      userId: rawUid,
      customerId,
      subscriptionId: sub.id,
    });

    if (uid) {
      const isDeleted = event.type === 'customer.subscription.deleted' || sub.status === 'canceled';
      const mappedStatus: SubscriptionStatus = isDeleted
        ? 'canceled'
        : normalizeStripeStatus(sub.status);
      const mappedPlan: SubscriptionPlan = isDeleted
        ? 'free'
        : mapPriceIdToPlan(priceId, config, sub.metadata?.plan);

      const periodEndUnix =
        (firstItem as { current_period_end?: number } | undefined)?.current_period_end ??
        (sub as unknown as { current_period_end?: number }).current_period_end ??
        null;
      const periodEndIso =
        typeof periodEndUnix === 'number' ? new Date(periodEndUnix * 1000).toISOString() : null;

      await store.upsertBillingRecord(uid, {
        ...(customerId ? { stripeCustomerId: customerId } : {}),
        stripeSubscriptionId: sub.id,
        plan: mappedPlan,
        status: mappedStatus,
        currentPeriodEnd: periodEndIso,
      });
    }
  } else if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as Stripe.Invoice;
    const customerId =
      typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id || null;
    const uid = await resolveFirebaseUid(store, { customerId });
    if (uid) {
      await store.upsertBillingRecord(uid, { status: 'past_due' });
    }
  } else if (event.type === 'invoice.paid') {
    const invoice = event.data.object as Stripe.Invoice;
    const customerId =
      typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id || null;
    const uid = await resolveFirebaseUid(store, { customerId });
    if (uid) {
      const existing = await store.getBillingRecord(uid);
      if (existing && (existing.plan === 'solo' || existing.plan === 'studio')) {
        await store.upsertBillingRecord(uid, { status: 'active' });
      }
    }
  }

  return { handled: true, duplicate: false };
}
