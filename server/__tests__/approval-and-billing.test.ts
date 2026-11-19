import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import Stripe from 'stripe';
import { createApp } from '../app.ts';
import {
  detectImageFormat,
  ExternalImageError,
  fetchSafeExternalImage,
  isPrivateOrReservedIp,
  MAX_IMAGE_BYTES,
  parseAndValidateExternalUrl,
} from '../externalImage.ts';
import type { VerifiedFirebaseUser } from '../firebaseAdmin.ts';
import { InMemoryPostProofStore } from '../store.ts';
import { assertTestModeKey } from '../stripe.ts';

const WEBHOOK_SECRET = 'whsec_test_postproof_firebase_secret_12345';
const SOLO_PRICE_ID = 'price_test_solo_12';
const STUDIO_PRICE_ID = 'price_test_studio_29';

const TOKENS: Record<string, VerifiedFirebaseUser> = {
  'token-creator-a': {
    uid: 'uid_creator_a',
    email: 'creator-a@example.com',
    name: 'Creator A',
    emailVerified: true,
  },
  'token-creator-b': {
    uid: 'uid_creator_b',
    email: 'creator-b@example.com',
    name: 'Creator B',
    emailVerified: true,
  },
  'token-unverified': {
    uid: 'uid_unverified',
    email: 'unverified@example.com',
    name: 'Unverified User',
    emailVerified: false,
  },
};

async function mockVerifyIdToken(token: string): Promise<VerifiedFirebaseUser> {
  const user = TOKENS[token];
  if (!user) {
    throw new Error('Firebase ID token verification failed.');
  }
  return user;
}

function buildMockStripeClient() {
  const captured = {
    customersCreated: [] as Array<Record<string, unknown>>,
    checkoutSessionsCreated: [] as Array<Record<string, unknown>>,
    portalSessionsCreated: [] as Array<Record<string, unknown>>,
  };

  let customerSeq = 1;
  const realStripeForWebhooks = new Stripe('sk_test_webhook_helper_only');

  const client = {
    webhooks: realStripeForWebhooks.webhooks,
    customers: {
      create: async (params: Record<string, unknown>) => {
        captured.customersCreated.push(params);
        return { id: `cus_test_${customerSeq++}`, ...params };
      },
    },
    checkout: {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          captured.checkoutSessionsCreated.push(params);
          return {
            id: `cs_test_${captured.checkoutSessionsCreated.length}`,
            url: `https://checkout.stripe.com/c/pay/cs_test_${captured.checkoutSessionsCreated.length}`,
          };
        },
      },
    },
    billingPortal: {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          captured.portalSessionsCreated.push(params);
          return {
            id: `bps_test_${captured.portalSessionsCreated.length}`,
            url: `https://billing.stripe.com/p/session/test_${captured.portalSessionsCreated.length}`,
          };
        },
      },
    },
  } as unknown as Stripe;

  return { client, captured, realStripeForWebhooks };
}

function makeSignedWebhook(
  stripeHelper: Stripe,
  payloadObj: Record<string, unknown>
): { rawBody: string; signature: string } {
  const rawBody = JSON.stringify(payloadObj);
  const signature = stripeHelper.webhooks.generateTestHeaderString({
    payload: rawBody,
    secret: WEBHOOK_SECRET,
  });
  return { rawBody, signature };
}

async function jsonRequest(
  baseUrl: string,
  path: string,
  opts: { method?: string; token?: string; body?: unknown } = {}
) {
  const headers: Record<string, string> = {};
  if (opts.token) {
    headers.Authorization = `Bearer ${opts.token}`;
  }
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${baseUrl}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, data, headers: res.headers };
}

// 1x1 transparent PNG bytes
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

describe('PostProof Firebase-Unified Billing, Quotas, Review Links & Image Isolation', () => {
  let baseUrl = '';
  let closeServer: () => Promise<void>;
  let store: InMemoryPostProofStore;
  let stripeMock: ReturnType<typeof buildMockStripeClient>;

  before(async () => {
    store = new InMemoryPostProofStore();
    stripeMock = buildMockStripeClient();

    const { app } = createApp({
      store,
      verifyIdToken: mockVerifyIdToken,
      stripeClient: stripeMock.client,
      stripeConfig: {
        secretKey: 'sk_test_mock_only',
        webhookSecret: WEBHOOK_SECRET,
        priceIdSolo: SOLO_PRICE_ID,
        priceIdStudio: STUDIO_PRICE_ID,
        appUrl: 'http://localhost:3000',
      },
      strictBillingGate: false,
      fetchExternalImage: async (rawUrl: string) => {
        const parsed = parseAndValidateExternalUrl(rawUrl);
        if (parsed.hostname === 'images.example.com') {
          if (parsed.pathname.includes('oversized')) {
            throw new ExternalImageError('Image exceeds the maximum allowed size of 5 MB.', 413, 'IMAGE_TOO_LARGE');
          }
          if (parsed.pathname.includes('html')) {
            throw new ExternalImageError(
              'Unsupported image file format. Only PNG, JPEG, WEBP, and GIF images are allowed.',
              400,
              'UNSUPPORTED_IMAGE_TYPE'
            );
          }
          if (parsed.pathname.includes('broken')) {
            throw new ExternalImageError(
              'Could not download the image from that URL (remote server returned an error). Try uploading the image file directly.',
              422,
              'IMAGE_DOWNLOAD_FAILED'
            );
          }
          return {
            buffer: TINY_PNG,
            contentType: 'image/png',
            extension: '.png',
          };
        }
        return fetchSafeExternalImage(rawUrl);
      },
    });

    const server = await new Promise<import('node:http').Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
    closeServer = () =>
      new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  after(async () => {
    await closeServer();
  });

  it('rejects live Stripe secret keys immediately', () => {
    assert.throws(() => assertTestModeKey('sk_live_1234567890'), /Live Stripe keys are blocked/);
    assert.throws(() => assertTestModeKey('rk_live_1234567890'), /Live Stripe keys are blocked/);
    assert.doesNotThrow(() => assertTestModeKey('sk_test_1234567890'));
  });

  it('rejects missing, invalid, and unverified Firebase ID tokens across billing and creator routes', async () => {
    // Missing token -> 401
    const noAuthBilling = await jsonRequest(baseUrl, '/api/billing/status');
    assert.equal(noAuthBilling.status, 401);
    assert.equal(noAuthBilling.data.code, 'AUTH_REQUIRED');

    const noAuthCampaign = await jsonRequest(baseUrl, '/api/campaigns', {
      method: 'POST',
      body: { name: 'Should fail', clientName: 'Nobody' },
    });
    assert.equal(noAuthCampaign.status, 401);

    // Invalid token -> 401
    const badTokenBilling = await jsonRequest(baseUrl, '/api/billing/checkout-session', {
      method: 'POST',
      token: 'forged-invalid-jwt',
      body: { plan: 'solo' },
    });
    assert.equal(badTokenBilling.status, 401);
    assert.equal(badTokenBilling.data.code, 'INVALID_FIREBASE_TOKEN');

    // Unverified email -> 403 on mutations
    const unverifiedCreate = await jsonRequest(baseUrl, '/api/campaigns', {
      method: 'POST',
      token: 'token-unverified',
      body: { name: 'Unverified campaign', clientName: 'Acme' },
    });
    assert.equal(unverifiedCreate.status, 403);
    assert.equal(unverifiedCreate.data.code, 'EMAIL_NOT_VERIFIED');

    const unverifiedCheckout = await jsonRequest(baseUrl, '/api/billing/checkout-session', {
      method: 'POST',
      token: 'token-unverified',
      body: { plan: 'solo' },
    });
    assert.equal(unverifiedCheckout.status, 403);

    // Legacy unauthenticated /api/uploads must remain removed (410) for all HTTP methods
    const legacyUploadPost = await jsonRequest(baseUrl, '/api/uploads', { method: 'POST' });
    assert.equal(legacyUploadPost.status, 410);
    const legacyUploadGet = await jsonRequest(baseUrl, '/api/uploads', { method: 'GET' });
    assert.equal(legacyUploadGet.status, 410);

    // Unknown /api/* routes must return JSON 404 (never fall through to SPA HTML)
    const unknownApiGet = await jsonRequest(baseUrl, '/api/does-not-exist');
    assert.equal(unknownApiGet.status, 404);
    assert.equal(unknownApiGet.data.code, 'API_NOT_FOUND');
    assert.match(unknownApiGet.headers.get('content-type') || '', /application\/json/);

    const unknownApiPost = await jsonRequest(baseUrl, '/api/does-not-exist', { method: 'POST' });
    assert.equal(unknownApiPost.status, 404);
    assert.equal(unknownApiPost.data.code, 'API_NOT_FOUND');
  });

  it('enforces cross-account isolation and campaign-scoped image access + revocation/rotation', async () => {
    // Creator A creates Campaign A
    const createA = await jsonRequest(baseUrl, '/api/campaigns', {
      method: 'POST',
      token: 'token-creator-a',
      body: { name: 'Autumn Launch', clientName: 'Solstice Home' },
    });
    assert.equal(createA.status, 201);
    const campaignA = createA.data.campaign as { id: string; reviewToken: string };

    // Creator B creates Campaign B
    const createB = await jsonRequest(baseUrl, '/api/campaigns', {
      method: 'POST',
      token: 'token-creator-b',
      body: { name: 'Winter Promo', clientName: 'Northstar Co' },
    });
    assert.equal(createB.status, 201);
    const campaignB = createB.data.campaign as { id: string; reviewToken: string };

    // Cross-account checks: Creator B cannot read, revoke, rotate, upload to, or delete Campaign A
    assert.equal(
      (await jsonRequest(baseUrl, `/api/campaigns/${campaignA.id}`, { token: 'token-creator-b' })).status,
      403
    );
    assert.equal(
      (
        await jsonRequest(baseUrl, `/api/campaigns/${campaignA.id}/review-link/revoke`, {
          method: 'POST',
          token: 'token-creator-b',
        })
      ).status,
      403
    );
    assert.equal(
      (
        await jsonRequest(baseUrl, `/api/campaigns/${campaignA.id}`, {
          method: 'DELETE',
          token: 'token-creator-b',
        })
      ).status,
      403
    );

    const crossUploadForm = new FormData();
    crossUploadForm.append('image', new Blob([TINY_PNG], { type: 'image/png' }), 'steal.png');
    const crossUploadRes = await fetch(`${baseUrl}/api/campaigns/${campaignA.id}/images`, {
      method: 'POST',
      headers: { Authorization: 'Bearer token-creator-b' },
      body: crossUploadForm,
    });
    assert.equal(crossUploadRes.status, 403);

    // Creator A uploads a PNG image to Campaign A
    const uploadForm = new FormData();
    uploadForm.append('image', new Blob([TINY_PNG], { type: 'image/png' }), 'hero.png');
    const uploadRes = await fetch(`${baseUrl}/api/campaigns/${campaignA.id}/images`, {
      method: 'POST',
      headers: { Authorization: 'Bearer token-creator-a' },
      body: uploadForm,
    });
    assert.equal(uploadRes.status, 201);
    const uploadJson = (await uploadRes.json()) as { imageId: string; imageUrl: string };
    assert.ok(uploadJson.imageId.startsWith('img_'));
    assert.equal(
      uploadJson.imageUrl,
      `/api/review/${campaignA.reviewToken}/images/${uploadJson.imageId}`
    );

    // Creator A creates Post 1 referencing that imageId
    const post1Res = await jsonRequest(baseUrl, `/api/campaigns/${campaignA.id}/posts`, {
      method: 'POST',
      token: 'token-creator-a',
      body: {
        title: 'Teaser Reel',
        caption: 'First look at our autumn ceramic line.',
        channel: 'Instagram',
        scheduledDate: '2026-10-15',
        imageId: uploadJson.imageId,
      },
    });
    assert.equal(post1Res.status, 201);
    const post1 = post1Res.data.post as { id: string; imageUrl: string };

    // Creator B CANNOT reference Campaign A's imageId when creating a post in Campaign B
    const crossImagePost = await jsonRequest(baseUrl, `/api/campaigns/${campaignB.id}/posts`, {
      method: 'POST',
      token: 'token-creator-b',
      body: {
        title: 'Stolen image post',
        caption: 'Trying to reuse Campaign A image.',
        channel: 'Instagram',
        scheduledDate: '2026-10-16',
        imageId: uploadJson.imageId,
      },
    });
    assert.equal(crossImagePost.status, 400);

    // Shared client with Campaign A's active token CAN view Campaign A's image
    const activeImgRes = await fetch(`${baseUrl}${post1.imageUrl}`);
    assert.equal(activeImgRes.status, 200);
    assert.equal(activeImgRes.headers.get('content-type'), 'image/png');
    assert.equal(activeImgRes.headers.get('cache-control'), 'private, no-store');

    // Shared client holding Campaign B's active token CANNOT fetch Campaign A's image!
    const crossCampaignImgRes = await fetch(
      `${baseUrl}/api/review/${campaignB.reviewToken}/images/${uploadJson.imageId}`
    );
    assert.equal(crossCampaignImgRes.status, 404);

    // Client approves Post 1 with a comment via active review link
    const decisionRes = await jsonRequest(
      baseUrl,
      `/api/review/${campaignA.reviewToken}/posts/${post1.id}/decision`,
      {
        method: 'POST',
        body: {
          decision: 'approved',
          authorName: 'Maya (Solstice)',
          comment: 'Looks great, approved!',
        },
      }
    );
    assert.equal(decisionRes.status, 200);
    assert.equal((decisionRes.data.post as { status: string }).status, 'approved');

    // Revoke Campaign A's review link -> client IMMEDIATELY loses access to campaign, approvals, and image
    const revokeRes = await jsonRequest(
      baseUrl,
      `/api/campaigns/${campaignA.id}/review-link/revoke`,
      { method: 'POST', token: 'token-creator-a' }
    );
    assert.equal(revokeRes.status, 200);

    assert.equal((await jsonRequest(baseUrl, `/api/review/${campaignA.reviewToken}`)).status, 404);
    assert.equal((await fetch(`${baseUrl}${post1.imageUrl}`)).status, 404);
    assert.equal(
      (
        await jsonRequest(
          baseUrl,
          `/api/review/${campaignA.reviewToken}/posts/${post1.id}/decision`,
          { method: 'POST', body: { decision: 'changes_requested' } }
        )
      ).status,
      404
    );

    // Rotate Campaign A's link -> new token works and rewrites post imageUrl, old token remains 404
    const rotateRes = await jsonRequest(
      baseUrl,
      `/api/campaigns/${campaignA.id}/review-link/regenerate`,
      { method: 'POST', token: 'token-creator-a' }
    );
    assert.equal(rotateRes.status, 200);
    const rotatedCampaign = rotateRes.data.campaign as {
      reviewToken: string;
      posts: Array<{ id: string; imageUrl: string; status: string }>;
    };
    assert.notEqual(rotatedCampaign.reviewToken, campaignA.reviewToken);
    assert.equal(
      rotatedCampaign.posts[0].imageUrl,
      `/api/review/${rotatedCampaign.reviewToken}/images/${uploadJson.imageId}`
    );
    assert.equal(rotatedCampaign.posts[0].status, 'approved');

    // New image URL serves 200; old image URL stays 404
    assert.equal((await fetch(`${baseUrl}${rotatedCampaign.posts[0].imageUrl}`)).status, 200);
    assert.equal((await fetch(`${baseUrl}${post1.imageUrl}`)).status, 404);
  });

  it('enforces free-tier quotas, links Stripe Checkout to Firebase UID, syncs signed webhooks idempotently, and handles upgrades & cancellation', async () => {
    // Creator A already has 1 campaign & 1 post from previous test.
    // Free tier allows max 1 campaign -> 2nd campaign must fail with 402!
    const blockedCampaign = await jsonRequest(baseUrl, '/api/campaigns', {
      method: 'POST',
      token: 'token-creator-a',
      body: { name: 'Second Campaign Blocked', clientName: 'Brand 2' },
    });
    assert.equal(blockedCampaign.status, 402);
    assert.equal(blockedCampaign.data.upgradeRequired, true);

    // Fill remaining 4 posts in Campaign A (total = 5, maxPostsTotal for free = 5)
    const listA = await jsonRequest(baseUrl, '/api/campaigns', { token: 'token-creator-a' });
    const cmpA = (listA.data.campaigns as Array<{ id: string }>)[0];
    for (let i = 2; i <= 5; i++) {
      const res = await jsonRequest(baseUrl, `/api/campaigns/${cmpA.id}/posts`, {
        method: 'POST',
        token: 'token-creator-a',
        body: {
          title: `Post ${i}`,
          caption: `Caption ${i}`,
          channel: 'LinkedIn',
          scheduledDate: `2026-10-1${i}`,
          imageUrl: `https://images.example.com/post-${i}.jpg`,
        },
      });
      assert.equal(res.status, 201);
    }

    // 6th post on free plan must fail with 402!
    const blockedPost = await jsonRequest(baseUrl, `/api/campaigns/${cmpA.id}/posts`, {
      method: 'POST',
      token: 'token-creator-a',
      body: {
        title: 'Post 6 Blocked',
        caption: 'Over free post limit',
        channel: 'Instagram',
        scheduledDate: '2026-10-20',
        imageUrl: 'https://images.example.com/post-6.jpg',
      },
    });
    assert.equal(blockedPost.status, 402);

    // Portal session before any Stripe customer -> 400
    const noPortalYet = await jsonRequest(baseUrl, '/api/billing/portal-session', {
      method: 'POST',
      token: 'token-creator-a',
    });
    assert.equal(noPortalYet.status, 400);

    // Create Stripe Test Checkout session -> associates customer with Firebase UID
    const checkoutRes = await jsonRequest(baseUrl, '/api/billing/checkout-session', {
      method: 'POST',
      token: 'token-creator-a',
      body: { plan: 'solo' },
    });
    assert.equal(checkoutRes.status, 200);
    assert.match(String(checkoutRes.data.url), /^https:\/\/checkout\.stripe\.com\//);
    assert.equal(
      (stripeMock.captured.customersCreated[0].metadata as { userId: string }).userId,
      'uid_creator_a'
    );
    assert.equal(
      stripeMock.captured.checkoutSessionsCreated[0].client_reference_id,
      'uid_creator_a'
    );

    // Creating a Checkout session does NOT upgrade the user until a signed webhook arrives!
    const preWebhookStatus = await jsonRequest(baseUrl, '/api/billing/status', {
      token: 'token-creator-a',
    });
    assert.equal(preWebhookStatus.data.subscriptionPlan, 'free');
    assert.equal(preWebhookStatus.data.subscriptionStatus, 'inactive');
    assert.equal(preWebhookStatus.data.hasStripeCustomer, true);

    // Billing Portal session now succeeds for uid_creator_a
    const portalRes = await jsonRequest(baseUrl, '/api/billing/portal-session', {
      method: 'POST',
      token: 'token-creator-a',
    });
    assert.equal(portalRes.status, 200);
    assert.match(String(portalRes.data.url), /^https:\/\/billing\.stripe\.com\//);

    // Unsigned / forged webhook must be rejected with 400
    const unsignedRes = await fetch(`${baseUrl}/api/webhooks/stripe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': 't=123,v1=forged_signature',
      },
      body: JSON.stringify({ id: 'evt_forged', type: 'checkout.session.completed' }),
    });
    assert.equal(unsignedRes.status, 400);

    // Valid signed checkout.session.completed webhook syncs Solo plan to uid_creator_a
    const checkoutEventPayload = {
      id: 'evt_test_checkout_solo_1',
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_1',
          customer: 'cus_test_1',
          subscription: 'sub_test_1',
          client_reference_id: 'uid_creator_a',
          payment_status: 'paid',
          status: 'complete',
          metadata: { userId: 'uid_creator_a', plan: 'solo' },
        },
      },
    };
    const signedCheckout = makeSignedWebhook(
      stripeMock.realStripeForWebhooks,
      checkoutEventPayload
    );
    const webhookRes1 = await fetch(`${baseUrl}/api/webhooks/stripe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': signedCheckout.signature,
      },
      body: signedCheckout.rawBody,
    });
    assert.equal(webhookRes1.status, 200);
    const webhookJson1 = (await webhookRes1.json()) as { handled: boolean; duplicate: boolean };
    assert.equal(webhookJson1.handled, true);
    assert.equal(webhookJson1.duplicate, false);

    // Duplicate delivery of exact same event ID is ignored idempotently
    const webhookDup = await fetch(`${baseUrl}/api/webhooks/stripe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': signedCheckout.signature,
      },
      body: signedCheckout.rawBody,
    });
    assert.equal(webhookDup.status, 200);
    const webhookDupJson = (await webhookDup.json()) as { handled: boolean; duplicate: boolean };
    assert.equal(webhookDupJson.handled, false);
    assert.equal(webhookDupJson.duplicate, true);

    // Verify billing status now reflects Solo active & quota unlocked!
    const soloStatus = await jsonRequest(baseUrl, '/api/billing/status', {
      token: 'token-creator-a',
    });
    assert.equal(soloStatus.data.subscriptionPlan, 'solo');
    assert.equal(soloStatus.data.subscriptionStatus, 'active');
    assert.equal((soloStatus.data.entitlements as { maxCampaigns: number }).maxCampaigns, 3);

    // 2nd campaign now succeeds!
    const secondCampaign = await jsonRequest(baseUrl, '/api/campaigns', {
      method: 'POST',
      token: 'token-creator-a',
      body: { name: 'Unlocked Campaign 2', clientName: 'Brand 2' },
    });
    assert.equal(secondCampaign.status, 201);

    // 6th post now succeeds!
    const sixthPost = await jsonRequest(baseUrl, `/api/campaigns/${cmpA.id}/posts`, {
      method: 'POST',
      token: 'token-creator-a',
      body: {
        title: 'Post 6 Unlocked',
        caption: 'Solo plan unlocks 100 posts',
        channel: 'Instagram',
        scheduledDate: '2026-10-21',
        imageUrl: 'https://images.example.com/post-6.jpg',
      },
    });
    assert.equal(sixthPost.status, 201);

    // Upgrade via customer.subscription.updated (matched solely via customerId -> stripeCustomers map)
    const upgradeEvent = makeSignedWebhook(stripeMock.realStripeForWebhooks, {
      id: 'evt_test_sub_upgrade_studio',
      object: 'event',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_test_1',
          customer: 'cus_test_1',
          status: 'active',
          items: {
            data: [
              {
                price: { id: STUDIO_PRICE_ID },
                current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30,
              },
            ],
          },
          metadata: {},
        },
      },
    });
    const upgradeRes = await fetch(`${baseUrl}/api/webhooks/stripe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': upgradeEvent.signature,
      },
      body: upgradeEvent.rawBody,
    });
    assert.equal(upgradeRes.status, 200);

    const studioStatus = await jsonRequest(baseUrl, '/api/billing/status', {
      token: 'token-creator-a',
    });
    assert.equal(studioStatus.data.subscriptionPlan, 'studio');
    assert.equal((studioStatus.data.entitlements as { maxCampaigns: number }).maxCampaigns, 10);
    assert.equal((studioStatus.data.entitlements as { maxPostsTotal: number }).maxPostsTotal, 500);

    // Cancellation via customer.subscription.deleted downgrades back to free/canceled and blocks new campaigns
    const cancelEvent = makeSignedWebhook(stripeMock.realStripeForWebhooks, {
      id: 'evt_test_sub_canceled',
      object: 'event',
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_test_1',
          customer: 'cus_test_1',
          status: 'canceled',
          items: { data: [{ price: { id: STUDIO_PRICE_ID } }] },
          metadata: {},
        },
      },
    });
    const cancelRes = await fetch(`${baseUrl}/api/webhooks/stripe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': cancelEvent.signature,
      },
      body: cancelEvent.rawBody,
    });
    assert.equal(cancelRes.status, 200);

    const canceledStatus = await jsonRequest(baseUrl, '/api/billing/status', {
      token: 'token-creator-a',
    });
    assert.equal(canceledStatus.data.subscriptionPlan, 'free');
    assert.equal(canceledStatus.data.subscriptionStatus, 'canceled');
    assert.equal((canceledStatus.data.entitlements as { maxCampaigns: number }).maxCampaigns, 1);

    // Because Creator A now has 2 campaigns and maxCampaigns dropped to 1, creating a 3rd campaign returns 402
    const postCancelBlocked = await jsonRequest(baseUrl, '/api/campaigns', {
      method: 'POST',
      token: 'token-creator-a',
      body: { name: 'Blocked After Cancel', clientName: 'Brand 3' },
    });
    assert.equal(postCancelBlocked.status, 402);
  });

  it('blocks even the first campaign when strictBillingGate is enabled and user has no paid plan', async () => {
    const strictStore = new InMemoryPostProofStore();
    const { app } = createApp({
      store: strictStore,
      verifyIdToken: mockVerifyIdToken,
      stripeClient: null,
      strictBillingGate: true,
    });
    const srv = await new Promise<import('node:http').Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const addr = srv.address() as AddressInfo;
    const strictUrl = `http://127.0.0.1:${addr.port}`;

    try {
      const res = await jsonRequest(strictUrl, '/api/campaigns', {
        method: 'POST',
        token: 'token-creator-a',
        body: { name: 'First Campaign Under Strict Gate', clientName: 'Acme' },
      });
      assert.equal(res.status, 402);
      assert.equal(res.data.code, 'SUBSCRIPTION_REQUIRED');
    } finally {
      await new Promise<void>((resolve, reject) => srv.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it('safely imports external HTTPS images into campaign storage without exposing original URL, preserves revocation/rotation, and cleans up on deletion', async () => {
    const extStore = new InMemoryPostProofStore();
    const LARGE_VALID_PNG = Buffer.concat([
      TINY_PNG,
      Buffer.alloc(4 * 1024 * 1024, 0x00), // 4 MB valid PNG header
    ]);

    const { app } = createApp({
      store: extStore,
      verifyIdToken: mockVerifyIdToken,
      stripeClient: null,
      strictBillingGate: false,
      fetchExternalImage: async (rawUrl: string) => {
        const parsed = parseAndValidateExternalUrl(rawUrl);
        if (parsed.hostname === 'cdn.partner.example') {
          if (parsed.pathname === '/large.png') {
            return { buffer: LARGE_VALID_PNG, contentType: 'image/png', extension: '.png' };
          }
          if (parsed.pathname === '/too-big.png') {
            throw new ExternalImageError(
              'Image exceeds the maximum allowed size of 5 MB.',
              413,
              'IMAGE_TOO_LARGE'
            );
          }
          if (parsed.pathname === '/not-an-image.html') {
            throw new ExternalImageError(
              'Unsupported image file format. Only PNG, JPEG, WEBP, and GIF images are allowed.',
              400,
              'UNSUPPORTED_IMAGE_TYPE'
            );
          }
          if (parsed.pathname === '/unreachable.png') {
            throw new ExternalImageError(
              'Unable to connect to the external image host. Check the URL or upload the image file directly.',
              422,
              'IMAGE_DOWNLOAD_FAILED'
            );
          }
          if (parsed.pathname === '/spoofed-bytes.png') {
            // Even if fetcher returned non-image bytes, route magic-byte check must reject it
            return {
              buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
              contentType: 'image/png',
              extension: '.png',
            };
          }
          return { buffer: TINY_PNG, contentType: 'image/png', extension: '.png' };
        }
        return fetchSafeExternalImage(rawUrl);
      },
    });

    const srv = await new Promise<import('node:http').Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const addr = srv.address() as AddressInfo;
    const extUrl = `http://127.0.0.1:${addr.port}`;

    try {
      const createRes = await jsonRequest(extUrl, '/api/campaigns', {
        method: 'POST',
        token: 'token-creator-a',
        body: { name: 'External Import Campaign', clientName: 'Brand Z' },
      });
      assert.equal(createRes.status, 201);
      const cmp = createRes.data.campaign as { id: string; reviewToken: string };

      // 1. Valid external HTTPS image URL is downloaded, stored, and rewritten to campaign-scoped endpoint
      const secretSourceUrl = 'https://cdn.partner.example/private-token-123/hero.png';
      const postRes = await jsonRequest(extUrl, `/api/campaigns/${cmp.id}/posts`, {
        method: 'POST',
        token: 'token-creator-a',
        body: {
          title: 'Imported Post',
          caption: 'Imported safely',
          channel: 'Instagram',
          scheduledDate: '2026-11-01',
          imageUrl: secretSourceUrl,
        },
      });
      assert.equal(postRes.status, 201);
      const post = postRes.data.post as { id: string; imageUrl: string; imageId: string };
      assert.ok(post.imageId, 'Expected stored campaign imageId');
      assert.equal(post.imageUrl, `/api/review/${cmp.reviewToken}/images/${post.imageId}`);
      assert.ok(!post.imageUrl.includes('cdn.partner.example'));

      // Client review payload must NEVER contain the original external URL
      const clientReviewRes = await jsonRequest(extUrl, `/api/review/${cmp.reviewToken}`);
      assert.equal(clientReviewRes.status, 200);
      assert.ok(!JSON.stringify(clientReviewRes.data).includes('cdn.partner.example'));

      // Stored copy is served via campaign-scoped endpoint with private headers
      const imgFetch = await fetch(`${extUrl}${post.imageUrl}`);
      assert.equal(imgFetch.status, 200);
      assert.equal(imgFetch.headers.get('content-type'), 'image/png');
      assert.equal(imgFetch.headers.get('cache-control'), 'private, no-store');
      assert.deepEqual(Buffer.from(await imgFetch.arrayBuffer()), TINY_PNG);

      // 2. Rejects SSRF, non-HTTPS, invalid types, oversized files, and failed downloads cleanly
      const blockedCases: Array<[string, number]> = [
        ['http://cdn.partner.example/hero.png', 400],
        ['https://127.0.0.1/secret.png', 400],
        ['https://169.254.169.254/latest/meta-data/', 400],
        ['https://localhost/admin.png', 400],
        ['https://metadata.google.internal/computeMetadata/v1/', 400],
        ['https://cdn.partner.example:8443/hero.png', 400],
        ['https://user:pass@cdn.partner.example/hero.png', 400],
        ['https://cdn.partner.example/not-an-image.html', 400],
        ['https://cdn.partner.example/spoofed-bytes.png', 400],
        ['https://cdn.partner.example/too-big.png', 413],
        ['https://cdn.partner.example/unreachable.png', 422],
      ];
      for (const [badUrl, expectedStatus] of blockedCases) {
        const res = await jsonRequest(extUrl, `/api/campaigns/${cmp.id}/posts`, {
          method: 'POST',
          token: 'token-creator-a',
          body: {
            title: 'Bad URL test',
            caption: 'Should fail safely',
            channel: 'Instagram',
            scheduledDate: '2026-11-02',
            imageUrl: badUrl,
          },
        });
        assert.equal(res.status, expectedStatus, `Expected ${expectedStatus} for ${badUrl}, got ${res.status}`);
      }

      // 3. Revoking review link immediately blocks imported image for clients
      await jsonRequest(extUrl, `/api/campaigns/${cmp.id}/review-link/revoke`, {
        method: 'POST',
        token: 'token-creator-a',
      });
      assert.equal((await fetch(`${extUrl}${post.imageUrl}`)).status, 404);

      // 4. Rotating review link rewrites imported post imageUrl to new token & keeps old URL blocked
      const rotatedRes = await jsonRequest(extUrl, `/api/campaigns/${cmp.id}/review-link/regenerate`, {
        method: 'POST',
        token: 'token-creator-a',
      });
      assert.equal(rotatedRes.status, 200);
      const rotatedCmp = rotatedRes.data.campaign as {
        reviewToken: string;
        posts: Array<{ id: string; imageUrl: string }>;
      };
      const newImageUrl = rotatedCmp.posts[0].imageUrl;
      assert.equal(newImageUrl, `/api/review/${rotatedCmp.reviewToken}/images/${post.imageId}`);
      assert.equal((await fetch(`${extUrl}${newImageUrl}`)).status, 200);
      assert.equal((await fetch(`${extUrl}${post.imageUrl}`)).status, 404);

      // 5. Deleting a post cleans up its stored image copy and reclaims storage usage
      const delPostRes = await jsonRequest(extUrl, `/api/campaigns/${cmp.id}/posts/${post.id}`, {
        method: 'DELETE',
        token: 'token-creator-a',
      });
      assert.equal(delPostRes.status, 200);
      assert.equal((await fetch(`${extUrl}${newImageUrl}`)).status, 404);
      assert.equal((await extStore.getCreatorUsage('uid_creator_a')).storageBytesUsed, 0);

      // 6. Enforces per-plan storage limit (25 MB on free) and cleans up all blobs on campaign deletion
      // Upload 6 x 4 MB = 24 MB via /images (succeeds), 7th x 4 MB = 28 MB (> 25 MB) must fail with 402!
      const formForLarge = () => {
        const form = new FormData();
        form.append('image', new Blob([LARGE_VALID_PNG], { type: 'image/png' }), 'big.png');
        return form;
      };
      for (let i = 0; i < 6; i += 1) {
        const upRes = await fetch(`${extUrl}/api/campaigns/${cmp.id}/images`, {
          method: 'POST',
          headers: { Authorization: 'Bearer token-creator-a' },
          body: formForLarge(),
        });
        assert.equal(upRes.status, 201, `Upload ${i + 1} should succeed within 25 MB limit`);
      }

      // 7th 4 MB import pushes total to 28 MB > 25 MB -> blocked with 402 STORAGE_LIMIT_REACHED
      const overQuotaImport = await jsonRequest(extUrl, `/api/campaigns/${cmp.id}/posts`, {
        method: 'POST',
        token: 'token-creator-a',
        body: {
          title: 'Over storage limit',
          caption: 'Should hit 25 MB free storage cap',
          channel: 'Instagram',
          scheduledDate: '2026-11-03',
          imageUrl: 'https://cdn.partner.example/large.png',
        },
      });
      assert.equal(overQuotaImport.status, 402);
      assert.equal(overQuotaImport.data.code, 'STORAGE_LIMIT_REACHED');

      // Deleting the campaign removes all stored images and drops storage usage back to 0
      const delCmpRes = await jsonRequest(extUrl, `/api/campaigns/${cmp.id}`, {
        method: 'DELETE',
        token: 'token-creator-a',
      });
      assert.equal(delCmpRes.status, 200);
      assert.equal((await extStore.getCreatorUsage('uid_creator_a')).storageBytesUsed, 0);
      assert.equal(extStore.imageBinaries.size, 0);
    } finally {
      await new Promise<void>((resolve, reject) => srv.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it('blocks private IP ranges, DNS-to-private-IP SSRF, and non-image magic bytes directly in externalImage helpers', async () => {
    // IP blocklist unit checks
    assert.equal(isPrivateOrReservedIp('127.0.0.1'), true);
    assert.equal(isPrivateOrReservedIp('10.0.0.5'), true);
    assert.equal(isPrivateOrReservedIp('169.254.169.254'), true);
    assert.equal(isPrivateOrReservedIp('172.16.0.1'), true);
    assert.equal(isPrivateOrReservedIp('192.168.1.10'), true);
    assert.equal(isPrivateOrReservedIp('100.64.0.1'), true);
    assert.equal(isPrivateOrReservedIp('::1'), true);
    assert.equal(isPrivateOrReservedIp('::ffff:127.0.0.1'), true);
    assert.equal(isPrivateOrReservedIp('::ffff:169.254.169.254'), true);
    assert.equal(isPrivateOrReservedIp('fc00::1'), true);
    assert.equal(isPrivateOrReservedIp('fe80::1'), true);
    assert.equal(isPrivateOrReservedIp('93.184.216.34'), false);
    assert.equal(isPrivateOrReservedIp('2606:2800:220:1:248:1893:25c8:1946'), false);

    // DNS resolving to a private IP is blocked before any socket opens
    await assert.rejects(
      () =>
        fetchSafeExternalImage('https://rebind.example.com/pic.png', {
          lookupAll: async () => [{ address: '169.254.169.254', family: 4 }],
        }),
      (err: unknown) => err instanceof ExternalImageError && err.code === 'BLOCKED_IMAGE_HOST'
    );

    // Magic-byte format detection checks
    assert.deepEqual(detectImageFormat(TINY_PNG), { contentType: 'image/png', extension: '.png' });
    assert.deepEqual(
      detectImageFormat(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])),
      { contentType: 'image/jpeg', extension: '.jpg' }
    );
    assert.deepEqual(
      detectImageFormat(Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00')),
      { contentType: 'image/gif', extension: '.gif' }
    );
    assert.deepEqual(
      detectImageFormat(Buffer.from('RIFF\x00\x00\x00\x00WEBP')),
      { contentType: 'image/webp', extension: '.webp' }
    );
    assert.equal(detectImageFormat(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
    assert.equal(detectImageFormat(Buffer.from('<html><body>hello</body></html>')), null);
    assert.equal(MAX_IMAGE_BYTES, 5 * 1024 * 1024);
  });
});
