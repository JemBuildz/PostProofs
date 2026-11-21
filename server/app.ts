import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';
import multer from 'multer';
import Stripe from 'stripe';
import { deleteFirebaseAuthUser, verifyFirebaseIdToken } from './firebaseAdmin.ts';
import type {
  DeleteAuthUserFn,
  VerifiedFirebaseUser,
  VerifyIdTokenFn,
} from './firebaseAdmin.ts';
import { FirestorePostProofStore } from './firestoreStore.ts';
import {
  ALLOWED_CHANNELS,
  defaultBillingRecord,
  getPlanEntitlements,
  StorageUnavailableError,
} from './store.ts';
import type {
  CampaignRecord,
  PostApprovalStatus,
  PostProofStore,
  PostRecord,
  SocialChannel,
} from './store.ts';
import {
  assertTestModeKey,
  createStripeClient,
  loadStripeConfig,
  processStripeWebhookEvent,
} from './stripe.ts';
import type { StripeConfig } from './stripe.ts';
import {
  detectImageFormat,
  ExternalImageError,
  fetchSafeExternalImage,
  MAX_IMAGE_BYTES,
} from './externalImage.ts';
import type { ExternalImageFetcher } from './externalImage.ts';

const ALLOWED_IMAGE_MIME = new Map<string, string>([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
]);

interface AuthenticatedRequest extends Request {
  firebaseUser?: VerifiedFirebaseUser;
}

export interface CreateAppOptions {
  store?: PostProofStore;
  verifyIdToken?: VerifyIdTokenFn;
  deleteAuthUser?: DeleteAuthUserFn;
  stripeConfig?: StripeConfig;
  stripeClient?: Stripe | null;
  strictBillingGate?: boolean;
  fetchExternalImage?: ExternalImageFetcher;
}

function getBaseUrl(req: Request, configuredAppUrl: string): string {
  if (configuredAppUrl && !configuredAppUrl.includes('MY_APP_URL')) {
    return configuredAppUrl.replace(/\/+$/, '');
  }
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
  const host = req.get('host') || 'localhost:3000';
  return `${proto}://${host}`;
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || typeof header !== 'string') return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

function formatStorageMb(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 100 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

function formatSummary(posts: PostRecord[]) {
  return {
    total: posts.length,
    approved: posts.filter((p) => p.status === 'approved').length,
    changesRequested: posts.filter((p) => p.status === 'changes_requested').length,
    inReview: posts.filter((p) => p.status === 'in_review').length,
  };
}

function formatCreatorCampaign(campaign: CampaignRecord, posts: PostRecord[]) {
  return {
    id: campaign.id,
    name: campaign.name,
    clientName: campaign.clientName,
    reviewToken: campaign.activeReviewToken,
    reviewLinkRevoked: campaign.reviewLinkRevoked,
    createdAt: campaign.createdAt,
    summary: formatSummary(posts),
    posts: posts.map((post) => ({
      id: post.id,
      campaignId: post.campaignId,
      title: post.title,
      caption: post.caption,
      channel: post.channel,
      scheduledDate: post.scheduledDate,
      imageUrl: post.imageUrl,
      ...(post.imageId ? { imageId: post.imageId } : {}),
      status: post.status,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      comments: post.comments.map((c) => ({
        id: c.id,
        postId: c.postId,
        authorName: c.authorName,
        authorRole: c.authorRole,
        body: c.body,
        createdAt: c.createdAt,
      })),
    })),
  };
}

function handleRouteError(res: Response, err: unknown, fallbackMessage: string): void {
  if (err instanceof ExternalImageError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof StorageUnavailableError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  const message = err instanceof Error ? err.message : fallbackMessage;
  res.status(500).json({ error: message || fallbackMessage });
}

export function createApp(options: CreateAppOptions = {}): {
  app: Express;
  store: PostProofStore;
} {
  const store = options.store ?? new FirestorePostProofStore();
  const verifyIdToken = options.verifyIdToken ?? verifyFirebaseIdToken;
  const deleteAuthUser = options.deleteAuthUser ?? deleteFirebaseAuthUser;
  const fetchExternalImage = options.fetchExternalImage ?? fetchSafeExternalImage;
  const stripeConfig = options.stripeConfig ?? loadStripeConfig(process.env);
  if (stripeConfig.secretKey) {
    assertTestModeKey(stripeConfig.secretKey);
  }
  const stripe =
    options.stripeClient !== undefined
      ? options.stripeClient
      : createStripeClient(stripeConfig);

  const strictBillingGate =
    options.strictBillingGate ?? process.env.BILLING_STRICT_GATE === 'true';

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    next();
  });

  // Stripe Webhook MUST receive raw JSON body BEFORE express.json()
  app.post(
    '/api/webhooks/stripe',
    express.raw({ type: 'application/json' }),
    async (req: Request, res: Response) => {
      if (!stripeConfig.webhookSecret) {
        res.status(503).json({
          error: 'STRIPE_WEBHOOK_SECRET is not configured on the server.',
        });
        return;
      }

      const signature = req.headers['stripe-signature'];
      if (!signature || typeof signature !== 'string') {
        res.status(400).json({ error: 'Missing Stripe-Signature header.' });
        return;
      }

      if (!Buffer.isBuffer(req.body)) {
        res.status(400).json({ error: 'Expected raw JSON payload for Stripe webhook.' });
        return;
      }

      let event: Stripe.Event;
      try {
        const verifier = stripe ?? new Stripe('sk_test_webhook_signature_verifier_placeholder');
        event = verifier.webhooks.constructEvent(
          req.body,
          signature,
          stripeConfig.webhookSecret
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Invalid Stripe webhook signature.';
        res.status(400).json({ error: message });
        return;
      }

      try {
        const result = await processStripeWebhookEvent(store, event, stripeConfig);
        res.status(200).json({ received: true, ...result });
      } catch (err) {
        handleRouteError(res, err, 'Failed to persist Stripe webhook event.');
      }
    }
  );

  app.use(express.json({ limit: '1mb' }));

  // In-memory multer buffer (never writes persistent images to ephemeral container disk)
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_BYTES },
    fileFilter: (_req, file, cb) => {
      if (ALLOWED_IMAGE_MIME.has(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Only PNG, JPEG, WEBP, and GIF images are supported.'));
      }
    },
  });

  app.get('/api/health', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true, status: 'healthy' });
  });

  // Explicitly block legacy unauthenticated upload endpoint (all methods)
  app.all('/api/uploads', (_req: Request, res: Response) => {
    res.status(410).json({
      error:
        'Unauthenticated /api/uploads has been removed. Upload campaign images via authenticated POST /api/campaigns/:id/images.',
      code: 'ENDPOINT_REMOVED',
    });
  });

  async function requireFirebaseAuth(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({
        error: 'Authentication required. Provide a valid Firebase ID token in the Authorization header.',
        code: 'AUTH_REQUIRED',
      });
      return;
    }

    try {
      req.firebaseUser = await verifyIdToken(token);
      next();
    } catch {
      res.status(401).json({
        error: 'Invalid or expired Firebase ID token. Please sign in again.',
        code: 'INVALID_FIREBASE_TOKEN',
      });
    }
  }

  function requireVerifiedEmail(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): void {
    if (!req.firebaseUser?.emailVerified) {
      res.status(403).json({
        error: 'A verified email address is required for this action.',
        code: 'EMAIL_NOT_VERIFIED',
      });
      return;
    }
    next();
  }

  // ==================== BILLING ROUTES (CANONICAL FIREBASE UID + STRIPE TEST MODE) ====================

  app.get(
    '/api/billing/status',
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const user = req.firebaseUser!;
      try {
        const billing =
          (await store.getBillingRecord(user.uid)) ?? defaultBillingRecord(user.uid, user.email);
        const entitlements = getPlanEntitlements(billing, strictBillingGate);
        const usage = await store.getCreatorUsage(user.uid);

        res.json({
          userId: user.uid,
          subscriptionPlan: billing.plan,
          subscriptionStatus: billing.status,
          currentPeriodEnd: billing.currentPeriodEnd,
          hasStripeCustomer: Boolean(billing.stripeCustomerId),
          entitlements,
          usage,
          strictBillingGate,
          stripeConfigured: Boolean(stripe),
          pricesConfigured: {
            solo: Boolean(stripeConfig.priceIdSolo),
            studio: Boolean(stripeConfig.priceIdStudio),
          },
          webhookConfigured: Boolean(stripeConfig.webhookSecret),
          mode: 'test',
        });
      } catch (err) {
        handleRouteError(res, err, 'Unable to load billing status.');
      }
    }
  );

  app.post(
    '/api/billing/checkout-session',
    requireFirebaseAuth,
    requireVerifiedEmail,
    async (req: AuthenticatedRequest, res: Response) => {
      const user = req.firebaseUser!;
      const plan = req.body?.plan === 'solo' || req.body?.plan === 'studio' ? req.body.plan : null;

      if (!plan) {
        res.status(400).json({ error: 'Choose either "solo" or "studio" plan.' });
        return;
      }

      if (!stripe) {
        res.status(503).json({
          error:
            'Stripe test mode is not configured yet. Add STRIPE_SECRET_KEY (sk_test_...) and test Price IDs to your environment variables.',
          code: 'STRIPE_NOT_CONFIGURED',
        });
        return;
      }

      const priceId = plan === 'solo' ? stripeConfig.priceIdSolo : stripeConfig.priceIdStudio;
      if (!priceId) {
        res.status(503).json({
          error: `Missing ${plan === 'solo' ? 'STRIPE_PRICE_ID_SOLO' : 'STRIPE_PRICE_ID_STUDIO'} environment variable.`,
          code: 'PRICE_NOT_CONFIGURED',
        });
        return;
      }

      try {
        const existingBilling = await store.getBillingRecord(user.uid);
        let customerId = existingBilling?.stripeCustomerId ?? null;

        if (!customerId) {
          const customer = await stripe.customers.create({
            email: user.email || undefined,
            name: user.name || undefined,
            metadata: { userId: user.uid },
          });
          customerId = customer.id;
          await store.upsertBillingRecord(user.uid, {
            email: user.email,
            stripeCustomerId: customerId,
          });
        }

        const baseUrl = getBaseUrl(req, stripeConfig.appUrl);
        const session = await stripe.checkout.sessions.create({
          mode: 'subscription',
          customer: customerId,
          client_reference_id: user.uid,
          line_items: [{ price: priceId, quantity: 1 }],
          allow_promotion_codes: true,
          metadata: { userId: user.uid, plan },
          subscription_data: {
            metadata: { userId: user.uid, plan },
          },
          success_url: `${baseUrl}/app?billing=success&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${baseUrl}/app?billing=canceled`,
        });

        res.json({ url: session.url, sessionId: session.id });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unable to start Stripe Checkout.';
        res.status(502).json({ error: message });
      }
    }
  );

  app.post(
    '/api/billing/portal-session',
    requireFirebaseAuth,
    requireVerifiedEmail,
    async (req: AuthenticatedRequest, res: Response) => {
      const user = req.firebaseUser!;
      if (!stripe) {
        res.status(503).json({
          error: 'Stripe test mode is not configured on the server.',
          code: 'STRIPE_NOT_CONFIGURED',
        });
        return;
      }

      try {
        const billing = await store.getBillingRecord(user.uid);
        if (!billing?.stripeCustomerId) {
          res.status(400).json({
            error: 'No Stripe billing profile exists yet. Subscribe to a plan first.',
          });
          return;
        }

        const baseUrl = getBaseUrl(req, stripeConfig.appUrl);
        const portal = await stripe.billingPortal.sessions.create({
          customer: billing.stripeCustomerId,
          return_url: `${baseUrl}/app`,
        });
        res.json({ url: portal.url });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unable to open billing portal.';
        res.status(502).json({ error: message });
      }
    }
  );

  // Read-only Checkout Session check: inspects a test-mode cs_test_* session owned by the
  // signed-in Firebase user without ever modifying subscription entitlements (webhooks remain
  // the sole source of truth for plan activation).
  app.get(
    '/api/billing/checkout-session',
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const user = req.firebaseUser!;
      const rawSessionId =
        typeof req.query.session_id === 'string' ? req.query.session_id.trim() : '';

      if (!rawSessionId || !/^cs_test_[A-Za-z0-9_]+$/.test(rawSessionId)) {
        res.status(400).json({
          verified: false,
          error: 'Missing or invalid test-mode Checkout Session ID.',
          code: 'INVALID_SESSION_ID',
        });
        return;
      }

      if (!stripe) {
        res.status(503).json({
          verified: false,
          error: 'Stripe test mode is not configured on the server.',
          code: 'STRIPE_NOT_CONFIGURED',
        });
        return;
      }

      try {
        const session = await stripe.checkout.sessions.retrieve(rawSessionId);
        const ownerUid = session.client_reference_id || session.metadata?.userId || null;
        if (!ownerUid || ownerUid !== user.uid) {
          res.status(403).json({
            verified: false,
            error: 'Checkout Session does not belong to the signed-in account.',
            code: 'SESSION_USER_MISMATCH',
          });
          return;
        }

        res.json({
          verified: true,
          sessionId: session.id,
          status: session.status ?? null,
          paymentStatus: session.payment_status ?? null,
        });
      } catch {
        res.status(404).json({
          verified: false,
          error: 'Unable to verify that Checkout Session with Stripe.',
          code: 'CHECKOUT_SESSION_NOT_FOUND',
        });
      }
    }
  );

  // ==================== CREATOR CAMPAIGN, IMAGE & POST ROUTES (SERVER-ENFORCED QUOTAS) ====================

  app.get(
    '/api/campaigns',
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const user = req.firebaseUser!;
      try {
        const rows = await store.listCreatorCampaigns(user.uid);
        const campaigns = await Promise.all(
          rows.map(async (row) => {
            const posts = await store.listPostsForReviewToken(row.activeReviewToken);
            return formatCreatorCampaign(row, posts);
          })
        );
        res.json({ campaigns });
      } catch (err) {
        handleRouteError(res, err, 'Unable to list campaigns.');
      }
    }
  );

  app.post(
    '/api/campaigns',
    requireFirebaseAuth,
    requireVerifiedEmail,
    async (req: AuthenticatedRequest, res: Response) => {
      const user = req.firebaseUser!;
      const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 120) : '';
      const clientName =
        typeof req.body?.clientName === 'string' ? req.body.clientName.trim().slice(0, 120) : '';

      if (!name || name.length < 2) {
        res.status(400).json({ error: 'Campaign name is required.' });
        return;
      }
      if (!clientName || clientName.length < 2) {
        res.status(400).json({ error: 'Client name is required.' });
        return;
      }

      try {
        const billing =
          (await store.getBillingRecord(user.uid)) ?? defaultBillingRecord(user.uid, user.email);
        const entitlements = getPlanEntitlements(billing, strictBillingGate);
        const usage = await store.getCreatorUsage(user.uid);

        if (usage.campaignsCount >= entitlements.maxCampaigns) {
          res.status(402).json({
            error:
              entitlements.maxCampaigns === 0
                ? 'An active Solo or Studio subscription is required to create campaigns.'
                : `Your ${entitlements.plan} plan allows up to ${entitlements.maxCampaigns} campaign${
                    entitlements.maxCampaigns === 1 ? '' : 's'
                  }. Upgrade to add more.`,
            code: entitlements.isPaidActive ? 'PLAN_LIMIT_REACHED' : 'SUBSCRIPTION_REQUIRED',
            upgradeRequired: true,
          });
          return;
        }

        const created = await store.createCampaign({
          creatorId: user.uid,
          name,
          clientName,
        });
        res.status(201).json({ campaign: formatCreatorCampaign(created, []) });
      } catch (err) {
        handleRouteError(res, err, 'Unable to create campaign.');
      }
    }
  );

  app.get(
    '/api/campaigns/:id',
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const user = req.firebaseUser!;
      try {
        const campaign = await store.getCampaign(req.params.id);
        if (!campaign) {
          res.status(404).json({ error: 'Campaign not found.' });
          return;
        }
        if (campaign.creatorId !== user.uid) {
          res.status(403).json({ error: 'You do not have permission to view this campaign.' });
          return;
        }
        const posts = await store.listPostsForReviewToken(campaign.activeReviewToken);
        res.json({ campaign: formatCreatorCampaign(campaign, posts) });
      } catch (err) {
        handleRouteError(res, err, 'Unable to fetch campaign.');
      }
    }
  );

  app.patch(
    '/api/campaigns/:id',
    requireFirebaseAuth,
    requireVerifiedEmail,
    async (req: AuthenticatedRequest, res: Response) => {
      const user = req.firebaseUser!;
      const rawName =
        typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 120) : undefined;
      const rawClientName =
        typeof req.body?.clientName === 'string'
          ? req.body.clientName.trim().slice(0, 120)
          : undefined;

      if (rawName === undefined && rawClientName === undefined) {
        res.status(400).json({ error: 'Provide a campaign name or client name to update.' });
        return;
      }
      if (rawName !== undefined && rawName.length < 2) {
        res.status(400).json({ error: 'Campaign name must be at least 2 characters.' });
        return;
      }
      if (rawClientName !== undefined && rawClientName.length < 2) {
        res.status(400).json({ error: 'Client name must be at least 2 characters.' });
        return;
      }

      try {
        const campaign = await store.getCampaign(req.params.id);
        if (!campaign) {
          res.status(404).json({ error: 'Campaign not found.' });
          return;
        }
        if (campaign.creatorId !== user.uid) {
          res.status(403).json({ error: 'You do not have permission to update this campaign.' });
          return;
        }

        const updated = await store.updateCampaign(campaign.id, {
          ...(rawName !== undefined ? { name: rawName } : {}),
          ...(rawClientName !== undefined ? { clientName: rawClientName } : {}),
        });
        const posts = await store.listPostsForReviewToken(updated!.activeReviewToken);
        res.json({ campaign: formatCreatorCampaign(updated!, posts) });
      } catch (err) {
        handleRouteError(res, err, 'Unable to update campaign.');
      }
    }
  );

  app.delete(
    '/api/campaigns/:id',
    requireFirebaseAuth,
    requireVerifiedEmail,
    async (req: AuthenticatedRequest, res: Response) => {
      const user = req.firebaseUser!;
      try {
        const campaign = await store.getCampaign(req.params.id);
        if (!campaign) {
          res.status(404).json({ error: 'Campaign not found.' });
          return;
        }
        if (campaign.creatorId !== user.uid) {
          res.status(403).json({ error: 'You do not have permission to delete this campaign.' });
          return;
        }
        await store.deleteCampaign(campaign.id);
        res.json({ ok: true });
      } catch (err) {
        handleRouteError(res, err, 'Unable to delete campaign.');
      }
    }
  );

  app.post(
    '/api/campaigns/:id/review-link/revoke',
    requireFirebaseAuth,
    requireVerifiedEmail,
    async (req: AuthenticatedRequest, res: Response) => {
      const user = req.firebaseUser!;
      try {
        const campaign = await store.getCampaign(req.params.id);
        if (!campaign) {
          res.status(404).json({ error: 'Campaign not found.' });
          return;
        }
        if (campaign.creatorId !== user.uid) {
          res.status(403).json({ error: 'You do not have permission to manage this review link.' });
          return;
        }
        const updated = await store.revokeReviewLink(campaign.id);
        const posts = await store.listPostsForReviewToken(updated.activeReviewToken);
        res.json({ campaign: formatCreatorCampaign(updated, posts) });
      } catch (err) {
        handleRouteError(res, err, 'Unable to revoke review link.');
      }
    }
  );

  app.post(
    '/api/campaigns/:id/review-link/regenerate',
    requireFirebaseAuth,
    requireVerifiedEmail,
    async (req: AuthenticatedRequest, res: Response) => {
      const user = req.firebaseUser!;
      try {
        const campaign = await store.getCampaign(req.params.id);
        if (!campaign) {
          res.status(404).json({ error: 'Campaign not found.' });
          return;
        }
        if (campaign.creatorId !== user.uid) {
          res.status(403).json({ error: 'You do not have permission to manage this review link.' });
          return;
        }
        const updated = await store.rotateReviewLink(campaign.id);
        const posts = await store.listPostsForReviewToken(updated.activeReviewToken);
        res.json({ campaign: formatCreatorCampaign(updated, posts) });
      } catch (err) {
        handleRouteError(res, err, 'Unable to rotate review link.');
      }
    }
  );

  // Authenticated, campaign-scoped image upload (stored in Firebase Storage via Admin SDK)
  app.post(
    '/api/campaigns/:id/images',
    requireFirebaseAuth,
    requireVerifiedEmail,
    (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      upload.single('image')(req, res, (err) => {
        if (err) {
          res
            .status(400)
            .json({ error: err instanceof Error ? err.message : 'Image upload failed.' });
          return;
        }
        next();
      });
    },
    async (req: AuthenticatedRequest, res: Response) => {
      const user = req.firebaseUser!;
      try {
        const campaign = await store.getCampaign(req.params.id);
        if (!campaign) {
          res.status(404).json({ error: 'Campaign not found.' });
          return;
        }
        if (campaign.creatorId !== user.uid) {
          res.status(403).json({ error: 'You do not have permission to upload images to this campaign.' });
          return;
        }
        if (campaign.reviewLinkRevoked) {
          res.status(409).json({
            error: 'Generate a new active review link before uploading images to this campaign.',
          });
          return;
        }
        if (!req.file) {
          res.status(400).json({ error: 'Please select a PNG, JPEG, WEBP, or GIF image to upload.' });
          return;
        }

        const detected = detectImageFormat(req.file.buffer);
        if (!detected) {
          res.status(400).json({
            error: 'Unsupported or invalid image file. Only PNG, JPEG, WEBP, and GIF images are allowed.',
            code: 'UNSUPPORTED_IMAGE_TYPE',
          });
          return;
        }

        const billing =
          (await store.getBillingRecord(user.uid)) ?? defaultBillingRecord(user.uid, user.email);
        const entitlements = getPlanEntitlements(billing, strictBillingGate);
        const usage = await store.getCreatorUsage(user.uid);
        if (usage.storageBytesUsed + req.file.buffer.length > entitlements.maxStorageBytes) {
          res.status(402).json({
            error:
              entitlements.maxStorageBytes === 0
                ? 'An active Solo or Studio subscription is required to store campaign images.'
                : `This upload exceeds your ${entitlements.plan} plan storage limit (${formatStorageMb(
                    entitlements.maxStorageBytes
                  )}). Delete unused posts/campaigns or upgrade your plan.`,
            code: 'STORAGE_LIMIT_REACHED',
            upgradeRequired: true,
          });
          return;
        }

        const saved = await store.saveCampaignImage({
          campaignId: campaign.id,
          creatorId: user.uid,
          buffer: req.file.buffer,
          contentType: detected.contentType,
          extension: detected.extension,
        });

        res.status(201).json({
          imageId: saved.id,
          imageUrl: `/api/review/${campaign.activeReviewToken}/images/${saved.id}`,
        });
      } catch (err) {
        handleRouteError(res, err, 'Unable to upload campaign image.');
      }
    }
  );

  // Server-enforced manual post creation (supports multipart image OR imageId OR https:// imageUrl)
  app.post(
    '/api/campaigns/:id/posts',
    requireFirebaseAuth,
    requireVerifiedEmail,
    (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      if (req.is('multipart/form-data')) {
        upload.single('image')(req, res, (err) => {
          if (err) {
            res
              .status(400)
              .json({ error: err instanceof Error ? err.message : 'Image upload failed.' });
            return;
          }
          next();
        });
      } else {
        next();
      }
    },
    async (req: AuthenticatedRequest, res: Response) => {
      const user = req.firebaseUser!;
      try {
        const campaign = await store.getCampaign(req.params.id);
        if (!campaign) {
          res.status(404).json({ error: 'Campaign not found.' });
          return;
        }
        if (campaign.creatorId !== user.uid) {
          res
            .status(403)
            .json({ error: 'You do not have permission to add posts to this campaign.' });
          return;
        }
        if (campaign.reviewLinkRevoked) {
          res.status(409).json({
            error: 'Generate a new active review link before adding posts to this campaign.',
          });
          return;
        }

        // Server-side post quota enforcement
        const billing =
          (await store.getBillingRecord(user.uid)) ?? defaultBillingRecord(user.uid, user.email);
        const entitlements = getPlanEntitlements(billing, strictBillingGate);
        const usage = await store.getCreatorUsage(user.uid);
        if (usage.postsCount >= entitlements.maxPostsTotal) {
          res.status(402).json({
            error: `Your ${entitlements.plan} plan allows up to ${entitlements.maxPostsTotal} posts. Upgrade to add more posts.`,
            code: entitlements.isPaidActive ? 'PLAN_LIMIT_REACHED' : 'SUBSCRIPTION_REQUIRED',
            upgradeRequired: true,
          });
          return;
        }

        const caption =
          typeof req.body?.caption === 'string' ? req.body.caption.trim().slice(0, 2200) : '';
        const channel = typeof req.body?.channel === 'string' ? req.body.channel.trim() : '';
        const scheduledDate =
          typeof req.body?.scheduledDate === 'string' ? req.body.scheduledDate.trim() : '';
        const rawTitle =
          typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 120) : '';
        const rawImageId = typeof req.body?.imageId === 'string' ? req.body.imageId.trim() : '';
        const rawImageUrl =
          typeof req.body?.imageUrl === 'string' ? req.body.imageUrl.trim().slice(0, 2000) : '';

        if (!caption) {
          res.status(400).json({ error: 'Post caption is required.' });
          return;
        }
        if (!ALLOWED_CHANNELS.has(channel as SocialChannel)) {
          res.status(400).json({ error: 'Select a valid social channel.' });
          return;
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
          res.status(400).json({ error: 'Provide a valid target date (YYYY-MM-DD).' });
          return;
        }

        let resolvedImageUrl = '';
        let resolvedImageId: string | undefined;
        let newlySavedImageId: string | undefined;

        if (req.file) {
          const detected = detectImageFormat(req.file.buffer);
          if (!detected) {
            res.status(400).json({
              error:
                'Unsupported or invalid image file. Only PNG, JPEG, WEBP, and GIF images are allowed.',
              code: 'UNSUPPORTED_IMAGE_TYPE',
            });
            return;
          }
          if (usage.storageBytesUsed + req.file.buffer.length > entitlements.maxStorageBytes) {
            res.status(402).json({
              error: `This upload exceeds your ${entitlements.plan} plan storage limit (${formatStorageMb(
                entitlements.maxStorageBytes
              )}). Delete unused posts/campaigns or upgrade your plan.`,
              code: 'STORAGE_LIMIT_REACHED',
              upgradeRequired: true,
            });
            return;
          }
          const saved = await store.saveCampaignImage({
            campaignId: campaign.id,
            creatorId: user.uid,
            buffer: req.file.buffer,
            contentType: detected.contentType,
            extension: detected.extension,
          });
          resolvedImageId = saved.id;
          newlySavedImageId = saved.id;
          resolvedImageUrl = `/api/review/${campaign.activeReviewToken}/images/${saved.id}`;
        } else if (rawImageId) {
          const existingImage = await store.getCampaignImage(campaign.id, rawImageId);
          if (!existingImage || existingImage.campaignId !== campaign.id) {
            res.status(400).json({
              error: 'The referenced image does not belong to this campaign.',
            });
            return;
          }
          resolvedImageId = existingImage.id;
          resolvedImageUrl = `/api/review/${campaign.activeReviewToken}/images/${existingImage.id}`;
        } else if (rawImageUrl) {
          // Download & validate external HTTPS image safely, store a private copy in Firebase Storage,
          // and expose ONLY the campaign-scoped review-image endpoint (never the original external URL).
          const imported = await fetchExternalImage(rawImageUrl);
          if (imported.buffer.length > MAX_IMAGE_BYTES) {
            res.status(413).json({
              error: 'Image exceeds the maximum allowed size of 5 MB.',
              code: 'IMAGE_TOO_LARGE',
            });
            return;
          }
          const detected = detectImageFormat(imported.buffer);
          if (!detected) {
            res.status(400).json({
              error:
                'Unsupported image file format. Only PNG, JPEG, WEBP, and GIF images are allowed.',
              code: 'UNSUPPORTED_IMAGE_TYPE',
            });
            return;
          }
          if (usage.storageBytesUsed + imported.buffer.length > entitlements.maxStorageBytes) {
            res.status(402).json({
              error: `Importing this image would exceed your ${entitlements.plan} plan storage limit (${formatStorageMb(
                entitlements.maxStorageBytes
              )}). Delete unused posts/campaigns or upgrade your plan.`,
              code: 'STORAGE_LIMIT_REACHED',
              upgradeRequired: true,
            });
            return;
          }
          const saved = await store.saveCampaignImage({
            campaignId: campaign.id,
            creatorId: user.uid,
            buffer: imported.buffer,
            contentType: detected.contentType,
            extension: detected.extension,
          });
          resolvedImageId = saved.id;
          newlySavedImageId = saved.id;
          resolvedImageUrl = `/api/review/${campaign.activeReviewToken}/images/${saved.id}`;
        } else {
          res.status(400).json({
            error: 'Upload an image file or provide a valid HTTPS image URL.',
          });
          return;
        }

        const title =
          rawTitle || (caption.length > 48 ? `${caption.slice(0, 48).trim()}…` : caption);

        try {
          const post = await store.createPost({
            campaignId: campaign.id,
            creatorId: user.uid,
            reviewToken: campaign.activeReviewToken,
            title,
            caption,
            channel: channel as SocialChannel,
            scheduledDate,
            imageUrl: resolvedImageUrl,
            imageId: resolvedImageId,
          });

          res.status(201).json({ post });
        } catch (createErr) {
          if (newlySavedImageId) {
            await store.deleteCampaignImage(campaign.id, newlySavedImageId).catch(() => {});
          }
          throw createErr;
        }
      } catch (err) {
        handleRouteError(res, err, 'Unable to create post.');
      }
    }
  );

  app.patch(
    '/api/campaigns/:id/posts/:postId',
    requireFirebaseAuth,
    requireVerifiedEmail,
    async (req: AuthenticatedRequest, res: Response) => {
      const user = req.firebaseUser!;
      try {
        const campaign = await store.getCampaign(req.params.id);
        if (!campaign) {
          res.status(404).json({ error: 'Campaign not found.' });
          return;
        }
        if (campaign.creatorId !== user.uid) {
          res.status(403).json({ error: 'Forbidden.' });
          return;
        }

        const existing = await store.getPost(campaign.activeReviewToken, req.params.postId);
        if (!existing || existing.campaignId !== campaign.id) {
          res.status(404).json({ error: 'Post not found in this campaign.' });
          return;
        }

        const patch: Partial<
          Pick<PostRecord, 'title' | 'caption' | 'channel' | 'scheduledDate' | 'status'>
        > = {};

        if (typeof req.body?.caption === 'string' && req.body.caption.trim()) {
          patch.caption = req.body.caption.trim().slice(0, 2200);
        }
        if (typeof req.body?.title === 'string' && req.body.title.trim()) {
          patch.title = req.body.title.trim().slice(0, 120);
        }
        if (
          typeof req.body?.channel === 'string' &&
          ALLOWED_CHANNELS.has(req.body.channel as SocialChannel)
        ) {
          patch.channel = req.body.channel as SocialChannel;
        }
        if (
          typeof req.body?.scheduledDate === 'string' &&
          /^\d{4}-\d{2}-\d{2}$/.test(req.body.scheduledDate)
        ) {
          patch.scheduledDate = req.body.scheduledDate;
        }
        if (req.body?.status === 'in_review') {
          patch.status = 'in_review' as PostApprovalStatus;
        }

        const updated = await store.updatePost(campaign.activeReviewToken, existing.id, patch);
        res.json({ post: updated });
      } catch (err) {
        handleRouteError(res, err, 'Unable to update post.');
      }
    }
  );

  app.delete(
    '/api/campaigns/:id/posts/:postId',
    requireFirebaseAuth,
    requireVerifiedEmail,
    async (req: AuthenticatedRequest, res: Response) => {
      const user = req.firebaseUser!;
      try {
        const campaign = await store.getCampaign(req.params.id);
        if (!campaign) {
          res.status(404).json({ error: 'Campaign not found.' });
          return;
        }
        if (campaign.creatorId !== user.uid) {
          res.status(403).json({ error: 'Forbidden.' });
          return;
        }

        const deleted = await store.deletePost(campaign.activeReviewToken, req.params.postId);
        if (!deleted) {
          res.status(404).json({ error: 'Post not found.' });
          return;
        }
        res.json({ ok: true });
      } catch (err) {
        handleRouteError(res, err, 'Unable to delete post.');
      }
    }
  );

  app.post(
    '/api/campaigns/:id/posts/:postId/comments',
    requireFirebaseAuth,
    requireVerifiedEmail,
    async (req: AuthenticatedRequest, res: Response) => {
      const user = req.firebaseUser!;
      try {
        const campaign = await store.getCampaign(req.params.id);
        if (!campaign) {
          res.status(404).json({ error: 'Campaign not found.' });
          return;
        }
        if (campaign.creatorId !== user.uid) {
          res.status(403).json({ error: 'Forbidden.' });
          return;
        }

        const post = await store.getPost(campaign.activeReviewToken, req.params.postId);
        if (!post || post.campaignId !== campaign.id) {
          res.status(404).json({ error: 'Post not found in this campaign.' });
          return;
        }

        const body = typeof req.body?.body === 'string' ? req.body.body.trim().slice(0, 1500) : '';
        if (!body) {
          res.status(400).json({ error: 'Comment text is required.' });
          return;
        }

        const comment = await store.addComment({
          campaignId: campaign.id,
          creatorId: user.uid,
          reviewToken: campaign.activeReviewToken,
          postId: post.id,
          authorName: user.name.slice(0, 80),
          authorRole: 'creator',
          body,
        });
        res.status(201).json({ comment });
      } catch (err) {
        handleRouteError(res, err, 'Unable to post creator reply.');
      }
    }
  );

  // ==================== CAMPAIGN-SCOPED CLIENT REVIEW & IMAGE ROUTES ====================

  app.get('/api/review/:token/images/:imageId', async (req: Request, res: Response) => {
    const token = req.params.token;
    const imageId = req.params.imageId;

    if (!token || token.length < 24 || !imageId) {
      res.status(404).json({ error: 'Image not found.' });
      return;
    }

    try {
      const reviewLink = await store.getReviewLink(token);
      if (!reviewLink) {
        res.status(404).json({ error: 'This review link is invalid or has been revoked.' });
        return;
      }

      if (reviewLink.revoked) {
        // Revoked link images are blocked for clients; allow only the authenticated campaign owner
        const bearer = extractBearerToken(req);
        let isOwner = false;
        if (bearer) {
          try {
            const verified = await verifyIdToken(bearer);
            isOwner = verified.uid === reviewLink.creatorId;
          } catch {
            isOwner = false;
          }
        }
        if (!isOwner) {
          res.status(404).json({ error: 'This review link is invalid or has been revoked.' });
          return;
        }
      }

      // Strictly enforce campaign scoping: image MUST belong to reviewLink.campaignId
      const image = await store.getCampaignImage(reviewLink.campaignId, imageId);
      if (!image || image.campaignId !== reviewLink.campaignId) {
        res.status(404).json({ error: 'Image not found in this campaign.' });
        return;
      }

      const binary = await store.readCampaignImageBinary(image);
      if (!binary) {
        res.status(404).json({ error: 'Image file not found.' });
        return;
      }

      res.setHeader('Content-Type', binary.contentType);
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(binary.buffer);
    } catch (err) {
      handleRouteError(res, err, 'Unable to load campaign image.');
    }
  });

  app.get('/api/review/:token', async (req: Request, res: Response) => {
    const token = req.params.token;
    if (!token || token.length < 24) {
      res.status(404).json({ error: 'This client review link is invalid or has been revoked.' });
      return;
    }

    try {
      const reviewLink = await store.getReviewLink(token);
      if (!reviewLink || reviewLink.revoked) {
        res.status(404).json({ error: 'This client review link is invalid or has been revoked.' });
        return;
      }

      const posts = await store.listPostsForReviewToken(token);
      res.json({
        campaign: {
          id: reviewLink.campaignId,
          name: reviewLink.campaignName,
          clientName: reviewLink.clientName,
          summary: formatSummary(posts),
          posts: posts.map((post) => ({
            id: post.id,
            campaignId: post.campaignId,
            title: post.title,
            caption: post.caption,
            channel: post.channel,
            scheduledDate: post.scheduledDate,
            imageUrl: post.imageUrl,
            status: post.status,
            createdAt: post.createdAt,
            updatedAt: post.updatedAt,
            comments: post.comments.map((c) => ({
              id: c.id,
              postId: c.postId,
              authorName: c.authorName,
              authorRole: c.authorRole,
              body: c.body,
              createdAt: c.createdAt,
            })),
          })),
        },
      });
    } catch (err) {
      handleRouteError(res, err, 'Unable to load client review.');
    }
  });

  app.post('/api/review/:token/posts/:postId/decision', async (req: Request, res: Response) => {
    const token = req.params.token;
    if (!token || token.length < 24) {
      res.status(404).json({ error: 'This client review link is invalid or has been revoked.' });
      return;
    }

    try {
      const reviewLink = await store.getReviewLink(token);
      if (!reviewLink || reviewLink.revoked) {
        res.status(404).json({ error: 'This client review link is invalid or has been revoked.' });
        return;
      }

      const post = await store.getPost(token, req.params.postId);
      if (!post || post.revoked || post.campaignId !== reviewLink.campaignId) {
        res.status(404).json({ error: 'Post not found in this review campaign.' });
        return;
      }

      const decision = req.body?.decision;
      if (decision !== 'approved' && decision !== 'changes_requested') {
        res.status(400).json({
          error: 'Decision must be either "approved" or "changes_requested".',
        });
        return;
      }

      const authorName =
        typeof req.body?.authorName === 'string' && req.body.authorName.trim()
          ? req.body.authorName.trim().slice(0, 80)
          : reviewLink.clientName;
      const note =
        typeof req.body?.comment === 'string' ? req.body.comment.trim().slice(0, 1500) : '';

      const updated = await store.updatePost(token, post.id, { status: decision });
      let createdComment = null;
      if (note) {
        createdComment = await store.addComment({
          campaignId: reviewLink.campaignId,
          creatorId: reviewLink.creatorId,
          reviewToken: token,
          postId: post.id,
          authorName,
          authorRole: 'client',
          body: note,
        });
      }

      res.json({
        post: {
          id: updated!.id,
          campaignId: updated!.campaignId,
          status: updated!.status,
          updatedAt: updated!.updatedAt,
        },
        comment: createdComment,
      });
    } catch (err) {
      handleRouteError(res, err, 'Unable to record approval decision.');
    }
  });

  app.post('/api/review/:token/posts/:postId/comments', async (req: Request, res: Response) => {
    const token = req.params.token;
    if (!token || token.length < 24) {
      res.status(404).json({ error: 'This client review link is invalid or has been revoked.' });
      return;
    }

    try {
      const reviewLink = await store.getReviewLink(token);
      if (!reviewLink || reviewLink.revoked) {
        res.status(404).json({ error: 'This client review link is invalid or has been revoked.' });
        return;
      }

      const post = await store.getPost(token, req.params.postId);
      if (!post || post.revoked || post.campaignId !== reviewLink.campaignId) {
        res.status(404).json({ error: 'Post not found in this review campaign.' });
        return;
      }

      const body = typeof req.body?.body === 'string' ? req.body.body.trim().slice(0, 1500) : '';
      if (!body) {
        res.status(400).json({ error: 'Comment text is required.' });
        return;
      }

      const authorName =
        typeof req.body?.authorName === 'string' && req.body.authorName.trim()
          ? req.body.authorName.trim().slice(0, 80)
          : reviewLink.clientName;

      const comment = await store.addComment({
        campaignId: reviewLink.campaignId,
        creatorId: reviewLink.creatorId,
        reviewToken: token,
        postId: post.id,
        authorName,
        authorRole: 'client',
        body,
      });

      res.status(201).json({ comment });
    } catch (err) {
      handleRouteError(res, err, 'Unable to add client comment.');
    }
  });

  // ==================== PUBLIC CONTACT & ACCOUNT CLEANUP ROUTES ====================

  const contactRateLimits = new Map<string, { count: number; resetAt: number }>();

  app.post('/api/contact', async (req: Request, res: Response) => {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const entry = contactRateLimits.get(ip);
    if (entry && entry.resetAt > now && entry.count >= 5) {
      res.status(429).json({ error: 'Too many contact requests. Please try again in a few minutes.' });
      return;
    }
    if (!entry || entry.resetAt <= now) {
      contactRateLimits.set(ip, { count: 1, resetAt: now + 10 * 60 * 1000 });
    } else {
      entry.count += 1;
    }

    const email = typeof req.body?.email === 'string' ? req.body.email.trim().slice(0, 160) : '';
    const message =
      typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 2000) : '';

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }
    if (!message || message.length < 3) {
      res.status(400).json({ error: 'Please include a short note about your workflow or question.' });
      return;
    }

    try {
      const saved = await store.saveContactInquiry({ email, message });
      res.status(201).json({ ok: true, id: saved.id });
    } catch (err) {
      handleRouteError(res, err, 'Unable to submit your message right now.');
    }
  });

  app.delete(
    '/api/account',
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const user = req.firebaseUser!;
      const confirm = typeof req.body?.confirm === 'string' ? req.body.confirm.trim() : '';
      if (confirm !== 'DELETE') {
        res.status(400).json({
          error: 'Type DELETE to permanently confirm account and workspace data removal.',
          code: 'CONFIRMATION_REQUIRED',
        });
        return;
      }

      try {
        await store.deleteCreatorAccountData(user.uid);
        await deleteAuthUser(user.uid);
        res.json({ ok: true });
      } catch (err) {
        handleRouteError(res, err, 'Unable to delete account data.');
      }
    }
  );

  // Return structured JSON 404 for any unmatched /api route instead of SPA HTML
  app.all(['/api', '/api/*'], (_req: Request, res: Response) => {
    res.status(404).json({
      error: 'API endpoint not found.',
      code: 'API_NOT_FOUND',
    });
  });

  return { app, store };
}
