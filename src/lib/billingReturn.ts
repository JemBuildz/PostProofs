export type StripeReturnOutcome = 'success' | 'canceled' | null;

export interface ParsedStripeReturn {
  plan: 'solo' | 'studio' | null;
  billing: StripeReturnOutcome;
  tab: 'billing' | null;
  sessionId: string | null;
  hasValidSessionId: boolean;
}

export interface CheckoutSessionCheckResult {
  verified: boolean;
  status?: string | null;
  paymentStatus?: string | null;
}

export interface VerifiedBillingSnapshot {
  subscriptionPlan: 'free' | 'solo' | 'studio';
  entitlements: {
    isPaidActive: boolean;
  };
}

/**
 * Validates that a Stripe Checkout return session_id is present, expanded,
 * and matches Stripe test-mode Checkout Session IDs (`cs_test_...`).
 */
export function isValidTestCheckoutSessionId(sessionId: string | null | undefined): boolean {
  if (!sessionId) return false;
  const trimmed = sessionId.trim();
  if (!trimmed || trimmed === '{CHECKOUT_SESSION_ID}') return false;
  return /^cs_test_[A-Za-z0-9_]+$/.test(trimmed);
}

/**
 * Extracts billing return query parameters without granting any entitlements.
 */
export function parseStripeReturnParams(search: string): ParsedStripeReturn {
  const params = new URLSearchParams(search);
  const rawPlan = params.get('plan');
  const rawBilling = params.get('billing');
  const rawTab = params.get('tab');
  const rawSessionId = params.get('session_id')?.trim() || null;

  return {
    plan: rawPlan === 'solo' || rawPlan === 'studio' ? rawPlan : null,
    billing: rawBilling === 'success' || rawBilling === 'canceled' ? rawBilling : null,
    tab: rawTab === 'billing' ? 'billing' : null,
    sessionId: rawSessionId,
    hasValidSessionId: isValidTestCheckoutSessionId(rawSessionId),
  };
}

/**
 * Produces an accurate, neutral initial notice before server verification completes.
 * Never claims payment succeeded solely from query parameters.
 */
export function getInitialStripeReturnNotice(parsed: ParsedStripeReturn): string {
  if (parsed.billing === 'canceled') {
    return 'Checkout was canceled. Your current plan has not changed.';
  }
  if (parsed.billing === 'success') {
    if (!parsed.hasValidSessionId) {
      return 'You’ve returned from Stripe, but no valid Checkout Session ID was provided to verify. We’re checking your subscription status; paid features will only be available after Stripe webhook confirmation.';
    }
    return 'You’ve returned from Stripe. We’re checking your subscription status; paid features will be available after confirmation.';
  }
  return '';
}

function formatPlanName(plan: VerifiedBillingSnapshot['subscriptionPlan']): string {
  if (plan === 'studio') return 'Studio';
  if (plan === 'solo') return 'Solo';
  return 'Free';
}

/**
 * Resolves the billing notice after consulting server-authoritative billing status
 * and optional read-only Checkout Session inspection.
 */
export function resolveStripeReturnNotice(params: {
  billing: StripeReturnOutcome;
  hasValidSessionId: boolean;
  billingStatus: VerifiedBillingSnapshot | null;
  sessionCheck?: CheckoutSessionCheckResult | null;
  verificationFailed?: boolean;
}): string {
  if (params.billing === 'canceled') {
    return 'Checkout was canceled. Your current plan has not changed.';
  }
  if (params.billing !== 'success') {
    return '';
  }

  if (params.verificationFailed) {
    return 'Unable to verify your subscription status right now. Sign in and click Refresh status once Stripe webhook confirmation completes.';
  }

  if (params.billingStatus?.entitlements.isPaidActive) {
    return `Subscription confirmed. Your ${formatPlanName(
      params.billingStatus.subscriptionPlan
    )} plan is active.`;
  }

  if (!params.hasValidSessionId) {
    return 'Unable to verify a Checkout Session because the session_id is missing or invalid. Paid features will only be available after a signed Stripe webhook confirms your subscription.';
  }

  if (params.sessionCheck) {
    if (!params.sessionCheck.verified) {
      return 'Unable to verify this Stripe Checkout Session yet. Paid features will only be available after signed Stripe webhook confirmation.';
    }
    if (
      params.sessionCheck.paymentStatus === 'paid' ||
      params.sessionCheck.status === 'complete'
    ) {
      return 'Stripe payment is awaiting final webhook confirmation on our server. Paid features will be available automatically once confirmed.';
    }
    return 'This Stripe Checkout Session has not been paid yet. Paid features remain inactive until payment is confirmed.';
  }

  return 'We’re still checking your subscription status; paid features will be available after Stripe webhook confirmation.';
}
