import { auth } from './firebase';

export type PostApprovalStatus = 'in_review' | 'approved' | 'changes_requested';
export type SubscriptionPlan = 'free' | 'solo' | 'studio';
export type SubscriptionStatus =
  | 'inactive'
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'unpaid';

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

export interface ApiComment {
  id: string;
  postId: string;
  authorName: string;
  authorRole: 'client' | 'creator';
  body: string;
  createdAt: string;
}

export interface ApiPost {
  id: string;
  campaignId: string;
  title: string;
  caption: string;
  channel: string;
  scheduledDate: string;
  imageUrl: string;
  imageId?: string;
  status: PostApprovalStatus;
  createdAt: string;
  updatedAt: string;
  comments: ApiComment[];
}

export interface CampaignSummary {
  total: number;
  approved: number;
  changesRequested: number;
  inReview: number;
}

export interface CreatorCampaign {
  id: string;
  name: string;
  clientName: string;
  reviewToken: string;
  reviewLinkRevoked: boolean;
  createdAt: string;
  summary: CampaignSummary;
  posts: ApiPost[];
}

export interface BillingStatusResponse {
  userId: string;
  subscriptionPlan: SubscriptionPlan;
  subscriptionStatus: SubscriptionStatus;
  currentPeriodEnd: string | null;
  hasStripeCustomer: boolean;
  entitlements: PlanEntitlements;
  usage: UsageCounts;
  strictBillingGate: boolean;
  stripeConfigured: boolean;
  pricesConfigured: {
    solo: boolean;
    studio: boolean;
  };
  webhookConfigured: boolean;
  mode: 'test';
}

export class ApiError extends Error {
  status: number;
  code?: string;
  upgradeRequired?: boolean;

  constructor(message: string, status: number, code?: string, upgradeRequired?: boolean) {
    super(message);
    this.status = status;
    this.code = code;
    this.upgradeRequired = upgradeRequired;
  }
}

async function getFirebaseBearerHeaders(initHeaders?: HeadersInit): Promise<Headers> {
  const headers = new Headers(initHeaders);
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new ApiError('Please sign in with your Firebase account first.', 401, 'AUTH_REQUIRED');
  }
  const idToken = await currentUser.getIdToken();
  headers.set('Authorization', `Bearer ${idToken}`);
  return headers;
}

async function requestAuthedJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = await getFirebaseBearerHeaders(init.headers);
  if (!(init.body instanceof FormData) && init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...init,
    headers,
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(
      typeof data.error === 'string' ? data.error : 'Request failed.',
      res.status,
      typeof data.code === 'string' ? data.code : undefined,
      Boolean(data.upgradeRequired)
    );
  }

  return data as T;
}

export const api = {
  createCampaign(payload: { name: string; clientName: string }) {
    return requestAuthedJson<{ campaign: CreatorCampaign }>('/api/campaigns', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateCampaign(campaignId: string, payload: { name?: string; clientName?: string }) {
    return requestAuthedJson<{ campaign: CreatorCampaign }>(
      `/api/campaigns/${encodeURIComponent(campaignId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    );
  },

  deleteCampaign(campaignId: string) {
    return requestAuthedJson<{ ok: boolean }>(`/api/campaigns/${encodeURIComponent(campaignId)}`, {
      method: 'DELETE',
    });
  },

  revokeReviewLink(campaignId: string) {
    return requestAuthedJson<{ campaign: CreatorCampaign }>(
      `/api/campaigns/${encodeURIComponent(campaignId)}/review-link/revoke`,
      { method: 'POST' }
    );
  },

  regenerateReviewLink(campaignId: string) {
    return requestAuthedJson<{ campaign: CreatorCampaign }>(
      `/api/campaigns/${encodeURIComponent(campaignId)}/review-link/regenerate`,
      { method: 'POST' }
    );
  },

  uploadCampaignImage(campaignId: string, file: File) {
    const formData = new FormData();
    formData.append('image', file);
    return requestAuthedJson<{ imageId: string; imageUrl: string }>(
      `/api/campaigns/${encodeURIComponent(campaignId)}/images`,
      {
        method: 'POST',
        body: formData,
      }
    );
  },

  createPost(
    campaignId: string,
    payload: {
      title?: string;
      caption: string;
      channel: string;
      scheduledDate: string;
      imageUrl?: string;
      imageId?: string;
      imageFile?: File | null;
    }
  ) {
    if (payload.imageFile) {
      const formData = new FormData();
      if (payload.title) formData.append('title', payload.title);
      formData.append('caption', payload.caption);
      formData.append('channel', payload.channel);
      formData.append('scheduledDate', payload.scheduledDate);
      formData.append('image', payload.imageFile);
      return requestAuthedJson<{ post: ApiPost }>(
        `/api/campaigns/${encodeURIComponent(campaignId)}/posts`,
        {
          method: 'POST',
          body: formData,
        }
      );
    }

    return requestAuthedJson<{ post: ApiPost }>(
      `/api/campaigns/${encodeURIComponent(campaignId)}/posts`,
      {
        method: 'POST',
        body: JSON.stringify({
          title: payload.title,
          caption: payload.caption,
          channel: payload.channel,
          scheduledDate: payload.scheduledDate,
          imageUrl: payload.imageUrl,
          imageId: payload.imageId,
        }),
      }
    );
  },

  updatePost(
    campaignId: string,
    postId: string,
    payload: {
      title?: string;
      caption?: string;
      channel?: string;
      scheduledDate?: string;
      status?: 'in_review';
    }
  ) {
    return requestAuthedJson<{ post: ApiPost }>(
      `/api/campaigns/${encodeURIComponent(campaignId)}/posts/${encodeURIComponent(postId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    );
  },

  resetPostToInReview(campaignId: string, postId: string) {
    return requestAuthedJson<{ post: ApiPost }>(
      `/api/campaigns/${encodeURIComponent(campaignId)}/posts/${encodeURIComponent(postId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status: 'in_review' }),
      }
    );
  },

  deletePost(campaignId: string, postId: string) {
    return requestAuthedJson<{ ok: boolean }>(
      `/api/campaigns/${encodeURIComponent(campaignId)}/posts/${encodeURIComponent(postId)}`,
      {
        method: 'DELETE',
      }
    );
  },

  addCreatorComment(campaignId: string, postId: string, body: string) {
    return requestAuthedJson<{ comment: ApiComment }>(
      `/api/campaigns/${encodeURIComponent(campaignId)}/posts/${encodeURIComponent(postId)}/comments`,
      {
        method: 'POST',
        body: JSON.stringify({ body }),
      }
    );
  },

  getBillingStatus() {
    return requestAuthedJson<BillingStatusResponse>('/api/billing/status');
  },

  checkCheckoutSession(sessionId: string) {
    return requestAuthedJson<{
      verified: boolean;
      sessionId?: string;
      status?: string | null;
      paymentStatus?: string | null;
    }>(`/api/billing/checkout-session?session_id=${encodeURIComponent(sessionId)}`);
  },

  createCheckoutSession(plan: 'solo' | 'studio') {
    return requestAuthedJson<{ url: string; sessionId: string }>('/api/billing/checkout-session', {
      method: 'POST',
      body: JSON.stringify({ plan }),
    });
  },

  createBillingPortalSession() {
    return requestAuthedJson<{ url: string }>('/api/billing/portal-session', {
      method: 'POST',
    });
  },

  deleteAccount(confirm: string) {
    return requestAuthedJson<{ ok: boolean }>('/api/account', {
      method: 'DELETE',
      body: JSON.stringify({ confirm }),
    });
  },

  async submitContactInquiry(payload: { email: string; message: string }) {
    const res = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new ApiError(
        typeof data.error === 'string' ? data.error : 'Unable to send your message.',
        res.status
      );
    }
    return data as { ok: boolean; id: string };
  },
};
