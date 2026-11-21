import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getInitialStripeReturnNotice,
  isValidTestCheckoutSessionId,
  parseStripeReturnParams,
  resolveStripeReturnNotice,
} from '../billingReturn.ts';

describe('Stripe Checkout return message handling', () => {
  it('validates test-mode Checkout Session IDs and rejects missing/live/placeholder IDs', () => {
    assert.equal(isValidTestCheckoutSessionId('cs_test_a1B2c3D4'), true);
    assert.equal(isValidTestCheckoutSessionId(''), false);
    assert.equal(isValidTestCheckoutSessionId(null), false);
    assert.equal(isValidTestCheckoutSessionId(undefined), false);
    assert.equal(isValidTestCheckoutSessionId('{CHECKOUT_SESSION_ID}'), false);
    assert.equal(isValidTestCheckoutSessionId('cs_live_123456'), false);
  });

  it('shows neutral pending wording for ?billing=success with valid session_id and never claims payment completed', () => {
    const parsed = parseStripeReturnParams('?billing=success&session_id=cs_test_abc123');
    assert.equal(parsed.billing, 'success');
    assert.equal(parsed.hasValidSessionId, true);

    const initial = getInitialStripeReturnNotice(parsed);
    assert.match(initial, /returned from Stripe/i);
    assert.match(initial, /checking your subscription status/i);
    assert.doesNotMatch(initial, /Checkout completed in Stripe/i);
    assert.doesNotMatch(initial, /payment completed/i);
  });

  it('shows unable-to-verify wording when ?billing=success is missing session_id', () => {
    const parsedMissing = parseStripeReturnParams('?billing=success');
    assert.equal(parsedMissing.hasValidSessionId, false);

    const initial = getInitialStripeReturnNotice(parsedMissing);
    assert.match(initial, /no valid Checkout Session ID/i);
    assert.doesNotMatch(initial, /Checkout completed in Stripe/i);

    const resolvedMissing = resolveStripeReturnNotice({
      billing: 'success',
      hasValidSessionId: false,
      billingStatus: { subscriptionPlan: 'free', entitlements: { isPaidActive: false } },
    });
    assert.match(resolvedMissing, /Unable to verify a Checkout Session/i);
    assert.match(resolvedMissing, /session_id is missing/i);
  });

  it('keeps access tied to server-verified active subscription and shows accurate pending/failed notices otherwise', () => {
    // Verification call failed / signed out
    const failedNotice = resolveStripeReturnNotice({
      billing: 'success',
      hasValidSessionId: true,
      billingStatus: null,
      verificationFailed: true,
    });
    assert.match(failedNotice, /Unable to verify your subscription status/i);

    // Session could not be verified with Stripe yet
    const unverifiedSession = resolveStripeReturnNotice({
      billing: 'success',
      hasValidSessionId: true,
      billingStatus: { subscriptionPlan: 'free', entitlements: { isPaidActive: false } },
      sessionCheck: { verified: false },
    });
    assert.match(unverifiedSession, /Unable to verify this Stripe Checkout Session/i);

    // Session retrieved as unpaid/open
    const unpaidSession = resolveStripeReturnNotice({
      billing: 'success',
      hasValidSessionId: true,
      billingStatus: { subscriptionPlan: 'free', entitlements: { isPaidActive: false } },
      sessionCheck: { verified: true, status: 'open', paymentStatus: 'unpaid' },
    });
    assert.match(unpaidSession, /has not been paid yet/i);

    // Paid session retrieved, still waiting for webhook sync -> still pending webhook
    const awaitingWebhook = resolveStripeReturnNotice({
      billing: 'success',
      hasValidSessionId: true,
      billingStatus: { subscriptionPlan: 'free', entitlements: { isPaidActive: false } },
      sessionCheck: { verified: true, status: 'complete', paymentStatus: 'paid' },
    });
    assert.match(awaitingWebhook, /awaiting final webhook confirmation/i);

    // Server-verified paid plan active after webhook
    const confirmed = resolveStripeReturnNotice({
      billing: 'success',
      hasValidSessionId: true,
      billingStatus: { subscriptionPlan: 'solo', entitlements: { isPaidActive: true } },
    });
    assert.equal(confirmed, 'Subscription confirmed. Your Solo plan is active.');
  });

  it('reports checkout cancellation accurately', () => {
    const parsed = parseStripeReturnParams('?billing=canceled');
    assert.equal(
      getInitialStripeReturnNotice(parsed),
      'Checkout was canceled. Your current plan has not changed.'
    );
  });
});
