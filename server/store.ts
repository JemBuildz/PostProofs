import crypto from 'node:crypto';

export type SubscriptionPlan = 'free' | 'solo' | 'studio';
export type SubscriptionStatus =
  | 'inactive'
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'unpaid';
export type PostApprovalStatus = 'in_review' | 'approved' | 'changes_requested';
export type SocialChannel =
  | 'Instagram'
  | 'LinkedIn'
  | 'X'
  | 'TikTok'
  | 'Facebook'
  | 'Threads'
  | 'YouTube';

export const ALLOWED_CHANNELS = new Set<SocialChannel>([
  'Instagram',
  'LinkedIn',
  'X',
  'TikTok',
  'Facebook',
  'Threads',
  'YouTube',
]);

export interface BillingRecord {
  userId: string;
  email: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  currentPeriodEnd: string | null;
  updatedAt: string;
}

export interface PlanEntitlements {
  plan: SubscriptionPlan;
  isPaidActive: boolean;
  maxCampaigns: number;
  maxPostsTotal: number;
  maxStorageBytes: number;
}

export interface UsageCounts {
  campaignsCount: number;
  postsCount: number;
  storageBytesUsed: number;
}

export interface CommentRecord {
  id: string;
  campaignId: string;
  creatorId: string;
  reviewToken: string;
  postId: string;
  revoked: boolean;
  authorName: string;
  authorRole: 'client' | 'creator';
  body: string;
  createdAt: string;
}

export interface PostRecord {
  id: string;
  campaignId: string;
  creatorId: string;
  reviewToken: string;
  revoked: boolean;
  title: string;
  caption: string;
  channel: SocialChannel;
  scheduledDate: string;
  imageUrl: string;
  imageId?: string;
  status: PostApprovalStatus;
  createdAt: string;
  updatedAt: string;
  comments: CommentRecord[];
}

export interface CampaignRecord {
  id: string;
  creatorId: string;
  name: string;
  clientName: string;
  activeReviewToken: string;
  reviewLinkRevoked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewLinkRecord {
  token: string;
  campaignId: string;
  creatorId: string;
  campaignName: string;
  clientName: string;
  revoked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignImageRecord {
  id: string;
  campaignId: string;
  creatorId: string;
  storagePath: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface ImageBinaryResult {
  buffer: Buffer;
  contentType: string;
}

export interface ContactInquiryRecord {
  id: string;
  email: string;
  message: string;
  createdAt: string;
}

export class StorageUnavailableError extends Error {
  status = 503;
  code = 'STORAGE_UNAVAILABLE';

  constructor(message: string) {
    super(message);
    this.name = 'StorageUnavailableError';
  }
}

export function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(9).toString('hex')}`;
}

export function generateReviewToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

export function defaultBillingRecord(userId: string, email = ''): BillingRecord {
  return {
    userId,
    email,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    plan: 'free',
    status: 'inactive',
    currentPeriodEnd: null,
    updatedAt: new Date().toISOString(),
  };
}

const MB = 1024 * 1024;

export function getPlanEntitlements(
  billing: Pick<BillingRecord, 'plan' | 'status'>,
  strictBillingGate: boolean
): PlanEntitlements {
  const isPaidActive =
    (billing.status === 'active' || billing.status === 'trialing') &&
    (billing.plan === 'solo' || billing.plan === 'studio');

  if (isPaidActive && billing.plan === 'studio') {
    return {
      plan: 'studio',
      isPaidActive: true,
      maxCampaigns: 10,
      maxPostsTotal: 500,
      maxStorageBytes: 1024 * MB,
    };
  }

  if (isPaidActive && billing.plan === 'solo') {
    return {
      plan: 'solo',
      isPaidActive: true,
      maxCampaigns: 3,
      maxPostsTotal: 100,
      maxStorageBytes: 250 * MB,
    };
  }

  if (strictBillingGate) {
    return {
      plan: 'free',
      isPaidActive: false,
      maxCampaigns: 0,
      maxPostsTotal: 0,
      maxStorageBytes: 0,
    };
  }

  return {
    plan: 'free',
    isPaidActive: false,
    maxCampaigns: 1,
    maxPostsTotal: 5,
    maxStorageBytes: 25 * MB,
  };
}

export interface PostProofStore {
  // Billing & Stripe state (keyed by Firebase Auth UID)
  getBillingRecord(userId: string): Promise<BillingRecord | null>;
  upsertBillingRecord(
    userId: string,
    patch: Partial<Omit<BillingRecord, 'userId'>>
  ): Promise<BillingRecord>;
  findUserIdByStripeCustomer(stripeCustomerId: string): Promise<string | null>;
  findUserIdByStripeSubscription(stripeSubscriptionId: string): Promise<string | null>;
  hasProcessedStripeEvent(eventId: string): Promise<boolean>;
  recordStripeEvent(eventId: string, eventType: string): Promise<boolean>;

  // Usage counts for quota enforcement
  getCreatorUsage(creatorId: string): Promise<UsageCounts>;

  // Campaigns & review links
  listCreatorCampaigns(creatorId: string): Promise<CampaignRecord[]>;
  getCampaign(campaignId: string): Promise<CampaignRecord | null>;
  createCampaign(params: {
    creatorId: string;
    name: string;
    clientName: string;
  }): Promise<CampaignRecord>;
  updateCampaign(
    campaignId: string,
    patch: Partial<Pick<CampaignRecord, 'name' | 'clientName'>>
  ): Promise<CampaignRecord | null>;
  deleteCampaign(campaignId: string): Promise<void>;
  revokeReviewLink(campaignId: string): Promise<CampaignRecord>;
  rotateReviewLink(campaignId: string): Promise<CampaignRecord>;

  // Posts & comments
  listPostsForReviewToken(reviewToken: string): Promise<PostRecord[]>;
  getPost(reviewToken: string, postId: string): Promise<PostRecord | null>;
  createPost(params: {
    campaignId: string;
    creatorId: string;
    reviewToken: string;
    title: string;
    caption: string;
    channel: SocialChannel;
    scheduledDate: string;
    imageUrl: string;
    imageId?: string;
  }): Promise<PostRecord>;
  updatePost(
    reviewToken: string,
    postId: string,
    patch: Partial<Pick<PostRecord, 'title' | 'caption' | 'channel' | 'scheduledDate' | 'status'>>
  ): Promise<PostRecord | null>;
  deletePost(reviewToken: string, postId: string): Promise<boolean>;
  addComment(params: {
    campaignId: string;
    creatorId: string;
    reviewToken: string;
    postId: string;
    authorName: string;
    authorRole: 'client' | 'creator';
    body: string;
  }): Promise<CommentRecord>;

  // Client review link lookup
  getReviewLink(reviewToken: string): Promise<ReviewLinkRecord | null>;

  // Campaign-scoped image storage
  saveCampaignImage(params: {
    campaignId: string;
    creatorId: string;
    buffer: Buffer;
    contentType: string;
    extension: string;
  }): Promise<CampaignImageRecord>;
  getCampaignImage(campaignId: string, imageId: string): Promise<CampaignImageRecord | null>;
  readCampaignImageBinary(image: CampaignImageRecord): Promise<ImageBinaryResult | null>;
  deleteCampaignImage(campaignId: string, imageId: string): Promise<void>;

  // Contact inquiries & self-serve account cleanup
  saveContactInquiry(params: { email: string; message: string }): Promise<ContactInquiryRecord>;
  deleteCreatorAccountData(creatorId: string): Promise<void>;
}

/**
 * Deterministic in-memory implementation of PostProofStore used in automated tests.
 * Shares exact domain logic (token rotation image URL rewriting, quota counting,
 * idempotent Stripe events, campaign-scoped image isolation) with FirestorePostProofStore.
 */
export class InMemoryPostProofStore implements PostProofStore {
  billingByUser = new Map<string, BillingRecord>();
  customerToUser = new Map<string, string>();
  stripeEvents = new Map<string, { type: string; processedAt: string }>();
  campaigns = new Map<string, CampaignRecord>();
  reviewLinks = new Map<string, ReviewLinkRecord>();
  postsByToken = new Map<string, Map<string, PostRecord>>();
  imagesByCampaign = new Map<string, Map<string, CampaignImageRecord>>();
  imageBinaries = new Map<string, ImageBinaryResult>();
  contactInquiries: ContactInquiryRecord[] = [];

  async getBillingRecord(userId: string): Promise<BillingRecord | null> {
    const rec = this.billingByUser.get(userId);
    return rec ? { ...rec } : null;
  }

  async upsertBillingRecord(
    userId: string,
    patch: Partial<Omit<BillingRecord, 'userId'>>
  ): Promise<BillingRecord> {
    const prev = this.billingByUser.get(userId) ?? defaultBillingRecord(userId);
    const next: BillingRecord = {
      ...prev,
      ...patch,
      userId,
      updatedAt: new Date().toISOString(),
    };
    this.billingByUser.set(userId, next);
    if (next.stripeCustomerId) {
      this.customerToUser.set(next.stripeCustomerId, userId);
    }
    return { ...next };
  }

  async findUserIdByStripeCustomer(stripeCustomerId: string): Promise<string | null> {
    return this.customerToUser.get(stripeCustomerId) ?? null;
  }

  async findUserIdByStripeSubscription(stripeSubscriptionId: string): Promise<string | null> {
    for (const [uid, rec] of this.billingByUser.entries()) {
      if (rec.stripeSubscriptionId === stripeSubscriptionId) return uid;
    }
    return null;
  }

  async hasProcessedStripeEvent(eventId: string): Promise<boolean> {
    return this.stripeEvents.has(eventId);
  }

  async recordStripeEvent(eventId: string, eventType: string): Promise<boolean> {
    if (this.stripeEvents.has(eventId)) return false;
    this.stripeEvents.set(eventId, {
      type: eventType,
      processedAt: new Date().toISOString(),
    });
    return true;
  }

  async getCreatorUsage(creatorId: string): Promise<UsageCounts> {
    let campaignsCount = 0;
    let postsCount = 0;
    let storageBytesUsed = 0;
    for (const cmp of this.campaigns.values()) {
      if (cmp.creatorId === creatorId) {
        campaignsCount += 1;
        const posts = this.postsByToken.get(cmp.activeReviewToken);
        if (posts) {
          postsCount += posts.size;
        }
        const imgs = this.imagesByCampaign.get(cmp.id);
        if (imgs) {
          for (const img of imgs.values()) {
            storageBytesUsed += img.sizeBytes;
          }
        }
      }
    }
    return { campaignsCount, postsCount, storageBytesUsed };
  }

  async listCreatorCampaigns(creatorId: string): Promise<CampaignRecord[]> {
    const items = Array.from(this.campaigns.values())
      .filter((c) => c.creatorId === creatorId)
      .map((c) => ({ ...c }));
    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return items;
  }

  async getCampaign(campaignId: string): Promise<CampaignRecord | null> {
    const c = this.campaigns.get(campaignId);
    return c ? { ...c } : null;
  }

  async createCampaign(params: {
    creatorId: string;
    name: string;
    clientName: string;
  }): Promise<CampaignRecord> {
    const id = generateId('cmp');
    const token = generateReviewToken();
    const now = new Date().toISOString();

    const campaign: CampaignRecord = {
      id,
      creatorId: params.creatorId,
      name: params.name,
      clientName: params.clientName,
      activeReviewToken: token,
      reviewLinkRevoked: false,
      createdAt: now,
      updatedAt: now,
    };

    const reviewLink: ReviewLinkRecord = {
      token,
      campaignId: id,
      creatorId: params.creatorId,
      campaignName: params.name,
      clientName: params.clientName,
      revoked: false,
      createdAt: now,
      updatedAt: now,
    };

    this.campaigns.set(id, campaign);
    this.reviewLinks.set(token, reviewLink);
    this.postsByToken.set(token, new Map());
    return { ...campaign };
  }

  async updateCampaign(
    campaignId: string,
    patch: Partial<Pick<CampaignRecord, 'name' | 'clientName'>>
  ): Promise<CampaignRecord | null> {
    const cmp = this.campaigns.get(campaignId);
    if (!cmp) return null;
    const now = new Date().toISOString();
    if (patch.name !== undefined) cmp.name = patch.name;
    if (patch.clientName !== undefined) cmp.clientName = patch.clientName;
    cmp.updatedAt = now;

    const link = this.reviewLinks.get(cmp.activeReviewToken);
    if (link) {
      if (patch.name !== undefined) link.campaignName = patch.name;
      if (patch.clientName !== undefined) link.clientName = patch.clientName;
      link.updatedAt = now;
    }
    return { ...cmp };
  }

  async deleteCampaign(campaignId: string): Promise<void> {
    const cmp = this.campaigns.get(campaignId);
    if (!cmp) return;
    this.campaigns.delete(campaignId);

    for (const [token, link] of this.reviewLinks.entries()) {
      if (link.campaignId === campaignId) {
        this.reviewLinks.delete(token);
        this.postsByToken.delete(token);
      }
    }

    const imgs = this.imagesByCampaign.get(campaignId);
    if (imgs) {
      for (const img of imgs.values()) {
        this.imageBinaries.delete(img.storagePath);
      }
      this.imagesByCampaign.delete(campaignId);
    }
  }

  async revokeReviewLink(campaignId: string): Promise<CampaignRecord> {
    const cmp = this.campaigns.get(campaignId);
    if (!cmp) throw new Error('Campaign not found.');

    const now = new Date().toISOString();
    cmp.reviewLinkRevoked = true;
    cmp.updatedAt = now;

    const link = this.reviewLinks.get(cmp.activeReviewToken);
    if (link) {
      link.revoked = true;
      link.updatedAt = now;
    }

    const posts = this.postsByToken.get(cmp.activeReviewToken);
    if (posts) {
      for (const p of posts.values()) {
        p.revoked = true;
        p.updatedAt = now;
        for (const c of p.comments) {
          c.revoked = true;
        }
      }
    }

    return { ...cmp };
  }

  async rotateReviewLink(campaignId: string): Promise<CampaignRecord> {
    const cmp = this.campaigns.get(campaignId);
    if (!cmp) throw new Error('Campaign not found.');

    const oldToken = cmp.activeReviewToken;
    const newToken = generateReviewToken();
    const now = new Date().toISOString();

    const oldLink = this.reviewLinks.get(oldToken);
    if (oldLink) {
      oldLink.revoked = true;
      oldLink.updatedAt = now;
    }

    this.reviewLinks.set(newToken, {
      token: newToken,
      campaignId: cmp.id,
      creatorId: cmp.creatorId,
      campaignName: cmp.name,
      clientName: cmp.clientName,
      revoked: false,
      createdAt: now,
      updatedAt: now,
    });

    const newPosts = new Map<string, PostRecord>();
    const oldPosts = this.postsByToken.get(oldToken);
    if (oldPosts) {
      for (const p of oldPosts.values()) {
        p.revoked = true;
        p.updatedAt = now;
        for (const c of p.comments) {
          c.revoked = true;
        }

        const rewrittenImageUrl =
          p.imageId && p.imageUrl.startsWith(`/api/review/${oldToken}/images/`)
            ? `/api/review/${newToken}/images/${p.imageId}`
            : p.imageUrl;

        newPosts.set(p.id, {
          ...p,
          reviewToken: newToken,
          revoked: false,
          imageUrl: rewrittenImageUrl,
          updatedAt: now,
          comments: p.comments.map((c) => ({
            ...c,
            reviewToken: newToken,
            revoked: false,
          })),
        });
      }
    }

    this.postsByToken.set(newToken, newPosts);
    cmp.activeReviewToken = newToken;
    cmp.reviewLinkRevoked = false;
    cmp.updatedAt = now;
    return { ...cmp };
  }

  async listPostsForReviewToken(reviewToken: string): Promise<PostRecord[]> {
    const posts = this.postsByToken.get(reviewToken);
    if (!posts) return [];
    const list = Array.from(posts.values()).map((p) => ({
      ...p,
      comments: p.comments.map((c) => ({ ...c })),
    }));
    list.sort(
      (a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || a.createdAt.localeCompare(b.createdAt)
    );
    return list;
  }

  async getPost(reviewToken: string, postId: string): Promise<PostRecord | null> {
    const p = this.postsByToken.get(reviewToken)?.get(postId);
    if (!p) return null;
    return { ...p, comments: p.comments.map((c) => ({ ...c })) };
  }

  async createPost(params: {
    campaignId: string;
    creatorId: string;
    reviewToken: string;
    title: string;
    caption: string;
    channel: SocialChannel;
    scheduledDate: string;
    imageUrl: string;
    imageId?: string;
  }): Promise<PostRecord> {
    const now = new Date().toISOString();
    const id = generateId('pst');
    const post: PostRecord = {
      id,
      campaignId: params.campaignId,
      creatorId: params.creatorId,
      reviewToken: params.reviewToken,
      revoked: false,
      title: params.title,
      caption: params.caption,
      channel: params.channel,
      scheduledDate: params.scheduledDate,
      imageUrl: params.imageUrl,
      ...(params.imageId ? { imageId: params.imageId } : {}),
      status: 'in_review',
      createdAt: now,
      updatedAt: now,
      comments: [],
    };
    let bucket = this.postsByToken.get(params.reviewToken);
    if (!bucket) {
      bucket = new Map();
      this.postsByToken.set(params.reviewToken, bucket);
    }
    bucket.set(id, post);
    return { ...post, comments: [] };
  }

  async updatePost(
    reviewToken: string,
    postId: string,
    patch: Partial<Pick<PostRecord, 'title' | 'caption' | 'channel' | 'scheduledDate' | 'status'>>
  ): Promise<PostRecord | null> {
    const post = this.postsByToken.get(reviewToken)?.get(postId);
    if (!post) return null;
    Object.assign(post, patch, { updatedAt: new Date().toISOString() });
    return { ...post, comments: post.comments.map((c) => ({ ...c })) };
  }

  async deletePost(reviewToken: string, postId: string): Promise<boolean> {
    const bucket = this.postsByToken.get(reviewToken);
    if (!bucket) return false;
    const existing = bucket.get(postId);
    if (!existing) return false;
    bucket.delete(postId);

    if (existing.imageId) {
      const stillReferenced = Array.from(bucket.values()).some(
        (p) => p.imageId === existing.imageId
      );
      if (!stillReferenced) {
        await this.deleteCampaignImage(existing.campaignId, existing.imageId);
      }
    }
    return true;
  }

  async addComment(params: {
    campaignId: string;
    creatorId: string;
    reviewToken: string;
    postId: string;
    authorName: string;
    authorRole: 'client' | 'creator';
    body: string;
  }): Promise<CommentRecord> {
    const post = this.postsByToken.get(params.reviewToken)?.get(params.postId);
    if (!post) throw new Error('Post not found.');

    const comment: CommentRecord = {
      id: generateId('cmt'),
      campaignId: params.campaignId,
      creatorId: params.creatorId,
      reviewToken: params.reviewToken,
      postId: params.postId,
      revoked: false,
      authorName: params.authorName,
      authorRole: params.authorRole,
      body: params.body,
      createdAt: new Date().toISOString(),
    };
    post.comments.push(comment);
    return { ...comment };
  }

  async getReviewLink(reviewToken: string): Promise<ReviewLinkRecord | null> {
    const link = this.reviewLinks.get(reviewToken);
    return link ? { ...link } : null;
  }

  async saveCampaignImage(params: {
    campaignId: string;
    creatorId: string;
    buffer: Buffer;
    contentType: string;
    extension: string;
  }): Promise<CampaignImageRecord> {
    const id = generateId('img');
    const storagePath = `campaigns/${params.creatorId}/${params.campaignId}/${id}${params.extension}`;
    const record: CampaignImageRecord = {
      id,
      campaignId: params.campaignId,
      creatorId: params.creatorId,
      storagePath,
      contentType: params.contentType,
      sizeBytes: params.buffer.length,
      createdAt: new Date().toISOString(),
    };

    let bucket = this.imagesByCampaign.get(params.campaignId);
    if (!bucket) {
      bucket = new Map();
      this.imagesByCampaign.set(params.campaignId, bucket);
    }
    bucket.set(id, record);
    this.imageBinaries.set(storagePath, {
      buffer: Buffer.from(params.buffer),
      contentType: params.contentType,
    });
    return { ...record };
  }

  async getCampaignImage(campaignId: string, imageId: string): Promise<CampaignImageRecord | null> {
    const rec = this.imagesByCampaign.get(campaignId)?.get(imageId);
    return rec ? { ...rec } : null;
  }

  async readCampaignImageBinary(image: CampaignImageRecord): Promise<ImageBinaryResult | null> {
    const found = this.imageBinaries.get(image.storagePath);
    return found ? { buffer: Buffer.from(found.buffer), contentType: found.contentType } : null;
  }

  async deleteCampaignImage(campaignId: string, imageId: string): Promise<void> {
    const bucket = this.imagesByCampaign.get(campaignId);
    if (!bucket) return;
    const rec = bucket.get(imageId);
    if (!rec) return;
    bucket.delete(imageId);
    this.imageBinaries.delete(rec.storagePath);
  }

  async saveContactInquiry(params: {
    email: string;
    message: string;
  }): Promise<ContactInquiryRecord> {
    const record: ContactInquiryRecord = {
      id: generateId('cnt'),
      email: params.email,
      message: params.message,
      createdAt: new Date().toISOString(),
    };
    this.contactInquiries.push(record);
    return { ...record };
  }

  async deleteCreatorAccountData(creatorId: string): Promise<void> {
    const ownedIds = Array.from(this.campaigns.values())
      .filter((c) => c.creatorId === creatorId)
      .map((c) => c.id);
    for (const cmpId of ownedIds) {
      await this.deleteCampaign(cmpId);
    }
    const billing = this.billingByUser.get(creatorId);
    if (billing?.stripeCustomerId) {
      this.customerToUser.delete(billing.stripeCustomerId);
    }
    this.billingByUser.delete(creatorId);
  }
}
