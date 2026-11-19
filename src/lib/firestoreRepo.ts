import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';

export type PostApprovalStatus = 'in_review' | 'approved' | 'changes_requested';
export type SocialChannel =
  | 'Instagram'
  | 'LinkedIn'
  | 'X'
  | 'TikTok'
  | 'Facebook'
  | 'Threads'
  | 'YouTube';

export const ALLOWED_CHANNELS: SocialChannel[] = [
  'Instagram',
  'LinkedIn',
  'X',
  'TikTok',
  'Facebook',
  'Threads',
  'YouTube',
];

export interface FirebaseComment {
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

export interface FirebasePost {
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
  comments: FirebaseComment[];
}

export interface FirebaseCampaign {
  id: string;
  creatorId: string;
  name: string;
  clientName: string;
  activeReviewToken: string;
  reviewLinkRevoked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FirebaseReviewLink {
  token: string;
  campaignId: string;
  creatorId: string;
  campaignName: string;
  clientName: string;
  revoked: boolean;
}

export interface FirebaseBillingSnapshot {
  plan: 'free' | 'solo' | 'studio';
  status: 'inactive' | 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid';
  currentPeriodEnd: string | null;
  hasStripeCustomer: boolean;
  updatedAt: string;
}

const URL_SAFE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

function randomToken(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += URL_SAFE_CHARS[bytes[i] % URL_SAFE_CHARS.length];
  }
  return out;
}

function makeDocId(prefix: string): string {
  return `${prefix}_${randomToken(14)}`;
}

function timestampToIso(val: unknown): string {
  if (val instanceof Timestamp) {
    return val.toDate().toISOString();
  }
  if (typeof val === 'string') return val;
  return new Date().toISOString();
}

function clampString(val: string, maxLength: number): string {
  return val.trim().slice(0, maxLength);
}

// ==================== CREATOR REAL-TIME READ SUBSCRIPTIONS ====================
// Note: Creator mutations (create campaign/post, revoke/rotate link, upload images)
// are routed through Express + Firebase Admin SDK (/api/campaigns/*) so plan quotas
// and campaign-scoped storage are enforced server-side.

export function subscribeCreatorBilling(
  userId: string,
  onData: (billing: FirebaseBillingSnapshot | null) => void,
  onError?: (err: Error) => void
): () => void {
  const path = `billing/${userId}`;
  return onSnapshot(
    doc(db, 'billing', userId),
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      const d = snap.data();
      onData({
        plan: (d.plan as FirebaseBillingSnapshot['plan']) || 'free',
        status: (d.status as FirebaseBillingSnapshot['status']) || 'inactive',
        currentPeriodEnd: typeof d.currentPeriodEnd === 'string' ? d.currentPeriodEnd : null,
        hasStripeCustomer: Boolean(d.stripeCustomerId),
        updatedAt: timestampToIso(d.updatedAt),
      });
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) onError(wrapped);
      }
    }
  );
}

export function subscribeCreatorCampaigns(
  creatorId: string,
  onData: (campaigns: FirebaseCampaign[]) => void,
  onError?: (err: Error) => void
): () => void {
  const path = 'campaigns';
  const q = query(collection(db, path), where('creatorId', '==', creatorId));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: FirebaseCampaign[] = snapshot.docs.map((snap) => {
        const d = snap.data();
        return {
          id: snap.id,
          creatorId: String(d.creatorId || ''),
          name: String(d.name || ''),
          clientName: String(d.clientName || ''),
          activeReviewToken: String(d.activeReviewToken || ''),
          reviewLinkRevoked: Boolean(d.reviewLinkRevoked),
          createdAt: timestampToIso(d.createdAt),
          updatedAt: timestampToIso(d.updatedAt),
        };
      });
      items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) onError(wrapped);
      }
    }
  );
}

export function subscribeCreatorCampaignPosts(
  creatorId: string,
  reviewToken: string,
  onData: (posts: FirebasePost[]) => void,
  onError?: (err: Error) => void
): () => void {
  const postsPath = `reviewLinks/${reviewToken}/posts`;
  const q = query(collection(db, postsPath), where('creatorId', '==', creatorId));

  let active = true;
  let commentUnsubs: Array<() => void> = [];
  const commentsByPost = new Map<string, FirebaseComment[]>();
  let latestPosts: Omit<FirebasePost, 'comments'>[] = [];

  const emitMerged = () => {
    if (!active) return;
    const merged: FirebasePost[] = latestPosts.map((post) => ({
      ...post,
      comments: commentsByPost.get(post.id) ?? [],
    }));
    merged.sort(
      (a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || a.createdAt.localeCompare(b.createdAt)
    );
    onData(merged);
  };

  const unsubPosts = onSnapshot(
    q,
    (snapshot) => {
      commentUnsubs.forEach((fn) => fn());
      commentUnsubs = [];

      latestPosts = snapshot.docs.map((snap) => {
        const d = snap.data();
        return {
          id: snap.id,
          campaignId: String(d.campaignId || ''),
          creatorId: String(d.creatorId || ''),
          reviewToken: String(d.reviewToken || ''),
          revoked: Boolean(d.revoked),
          title: String(d.title || ''),
          caption: String(d.caption || ''),
          channel: (ALLOWED_CHANNELS.includes(d.channel as SocialChannel)
            ? d.channel
            : 'Instagram') as SocialChannel,
          scheduledDate: String(d.scheduledDate || ''),
          imageUrl: String(d.imageUrl || ''),
          ...(typeof d.imageId === 'string' && d.imageId ? { imageId: d.imageId } : {}),
          status: (d.status || 'in_review') as PostApprovalStatus,
          createdAt: timestampToIso(d.createdAt),
          updatedAt: timestampToIso(d.updatedAt),
        };
      });

      emitMerged();

      for (const post of latestPosts) {
        const commentsPath = `reviewLinks/${reviewToken}/posts/${post.id}/comments`;
        const cq = query(collection(db, commentsPath), where('creatorId', '==', creatorId));
        const unsubC = onSnapshot(
          cq,
          (cSnap) => {
            const list: FirebaseComment[] = cSnap.docs.map((cs) => {
              const cd = cs.data();
              return {
                id: cs.id,
                campaignId: String(cd.campaignId || ''),
                creatorId: String(cd.creatorId || ''),
                reviewToken: String(cd.reviewToken || ''),
                postId: String(cd.postId || post.id),
                revoked: Boolean(cd.revoked),
                authorName: String(cd.authorName || ''),
                authorRole: cd.authorRole === 'creator' ? 'creator' : 'client',
                body: String(cd.body || ''),
                createdAt: timestampToIso(cd.createdAt),
              };
            });
            list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
            commentsByPost.set(post.id, list);
            emitMerged();
          },
          (error) => {
            try {
              handleFirestoreError(error, OperationType.LIST, commentsPath);
            } catch (wrapped) {
              if (onError && wrapped instanceof Error) onError(wrapped);
            }
          }
        );
        commentUnsubs.push(unsubC);
      }
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, postsPath);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) onError(wrapped);
      }
    }
  );

  return () => {
    active = false;
    unsubPosts();
    commentUnsubs.forEach((fn) => fn());
  };
}

// ==================== PRIVATE CLIENT REVIEW OPERATIONS (TOKEN-SCOPED) ====================

export async function fetchClientReviewLink(token: string): Promise<FirebaseReviewLink | null> {
  if (!token || token.length < 24 || !/^[a-zA-Z0-9_-]+$/.test(token)) {
    return null;
  }
  try {
    const snap = await getDoc(doc(db, 'reviewLinks', token));
    if (!snap.exists()) return null;
    const d = snap.data();
    if (d.revoked === true) return null;
    return {
      token: snap.id,
      campaignId: String(d.campaignId || ''),
      creatorId: String(d.creatorId || ''),
      campaignName: String(d.campaignName || ''),
      clientName: String(d.clientName || ''),
      revoked: Boolean(d.revoked),
    };
  } catch {
    return null;
  }
}

export function subscribeClientReviewLink(
  token: string,
  onLink: (link: FirebaseReviewLink) => void,
  onRevokedOrMissing: () => void
): () => void {
  if (!token || token.length < 24 || !/^[a-zA-Z0-9_-]+$/.test(token)) {
    onRevokedOrMissing();
    return () => {};
  }

  return onSnapshot(
    doc(db, 'reviewLinks', token),
    (snap) => {
      if (!snap.exists()) {
        onRevokedOrMissing();
        return;
      }
      const d = snap.data();
      if (d.revoked === true) {
        onRevokedOrMissing();
        return;
      }
      onLink({
        token: snap.id,
        campaignId: String(d.campaignId || ''),
        creatorId: String(d.creatorId || ''),
        campaignName: String(d.campaignName || ''),
        clientName: String(d.clientName || ''),
        revoked: false,
      });
    },
    () => {
      onRevokedOrMissing();
    }
  );
}

export function subscribeClientReviewPosts(
  token: string,
  onData: (posts: FirebasePost[]) => void,
  onRevokedOrDenied: () => void
): () => void {
  const postsPath = `reviewLinks/${token}/posts`;
  const q = query(
    collection(db, postsPath),
    where('reviewToken', '==', token),
    where('revoked', '==', false)
  );

  let active = true;
  let commentUnsubs: Array<() => void> = [];
  const commentsByPost = new Map<string, FirebaseComment[]>();
  let latestPosts: Omit<FirebasePost, 'comments'>[] = [];

  const emitMerged = () => {
    if (!active) return;
    const merged: FirebasePost[] = latestPosts.map((post) => ({
      ...post,
      comments: commentsByPost.get(post.id) ?? [],
    }));
    merged.sort(
      (a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || a.createdAt.localeCompare(b.createdAt)
    );
    onData(merged);
  };

  const unsubPosts = onSnapshot(
    q,
    (snapshot) => {
      commentUnsubs.forEach((fn) => fn());
      commentUnsubs = [];

      latestPosts = snapshot.docs.map((snap) => {
        const d = snap.data();
        return {
          id: snap.id,
          campaignId: String(d.campaignId || ''),
          creatorId: String(d.creatorId || ''),
          reviewToken: String(d.reviewToken || ''),
          revoked: Boolean(d.revoked),
          title: String(d.title || ''),
          caption: String(d.caption || ''),
          channel: (ALLOWED_CHANNELS.includes(d.channel as SocialChannel)
            ? d.channel
            : 'Instagram') as SocialChannel,
          scheduledDate: String(d.scheduledDate || ''),
          imageUrl: String(d.imageUrl || ''),
          ...(typeof d.imageId === 'string' && d.imageId ? { imageId: d.imageId } : {}),
          status: (d.status || 'in_review') as PostApprovalStatus,
          createdAt: timestampToIso(d.createdAt),
          updatedAt: timestampToIso(d.updatedAt),
        };
      });

      emitMerged();

      for (const post of latestPosts) {
        const commentsPath = `reviewLinks/${token}/posts/${post.id}/comments`;
        const cq = query(
          collection(db, commentsPath),
          where('reviewToken', '==', token),
          where('revoked', '==', false)
        );
        const unsubC = onSnapshot(
          cq,
          (cSnap) => {
            const list: FirebaseComment[] = cSnap.docs.map((cs) => {
              const cd = cs.data();
              return {
                id: cs.id,
                campaignId: String(cd.campaignId || ''),
                creatorId: String(cd.creatorId || ''),
                reviewToken: String(cd.reviewToken || ''),
                postId: String(cd.postId || post.id),
                revoked: Boolean(cd.revoked),
                authorName: String(cd.authorName || ''),
                authorRole: cd.authorRole === 'creator' ? 'creator' : 'client',
                body: String(cd.body || ''),
                createdAt: timestampToIso(cd.createdAt),
              };
            });
            list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
            commentsByPost.set(post.id, list);
            emitMerged();
          },
          () => {
            onRevokedOrDenied();
          }
        );
        commentUnsubs.push(unsubC);
      }
    },
    () => {
      onRevokedOrDenied();
    }
  );

  return () => {
    active = false;
    unsubPosts();
    commentUnsubs.forEach((fn) => fn());
  };
}

export async function submitClientPostDecision(params: {
  reviewLink: FirebaseReviewLink;
  postId: string;
  decision: 'approved' | 'changes_requested';
  authorName?: string;
  comment?: string;
}): Promise<void> {
  const postPath = `reviewLinks/${params.reviewLink.token}/posts/${params.postId}`;
  const note = clampString(params.comment || '', 1500);
  const authorName = clampString(params.authorName || params.reviewLink.clientName || 'Client', 80);

  const batch = writeBatch(db);
  batch.update(doc(db, 'reviewLinks', params.reviewLink.token, 'posts', params.postId), {
    status: params.decision,
    updatedAt: serverTimestamp(),
  });

  if (note) {
    const commentId = makeDocId('cmt');
    batch.set(
      doc(db, 'reviewLinks', params.reviewLink.token, 'posts', params.postId, 'comments', commentId),
      {
        campaignId: params.reviewLink.campaignId,
        creatorId: params.reviewLink.creatorId,
        reviewToken: params.reviewLink.token,
        postId: params.postId,
        revoked: false,
        authorName,
        authorRole: 'client',
        body: note,
        createdAt: serverTimestamp(),
      }
    );
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, postPath);
  }
}

export async function addClientPostComment(params: {
  reviewLink: FirebaseReviewLink;
  postId: string;
  authorName?: string;
  body: string;
}): Promise<void> {
  const body = clampString(params.body, 1500);
  if (!body) throw new Error('Comment text is required.');
  const authorName = clampString(params.authorName || params.reviewLink.clientName || 'Client', 80);
  const commentId = makeDocId('cmt');
  const path = `reviewLinks/${params.reviewLink.token}/posts/${params.postId}/comments/${commentId}`;

  try {
    await setDoc(
      doc(db, 'reviewLinks', params.reviewLink.token, 'posts', params.postId, 'comments', commentId),
      {
        campaignId: params.reviewLink.campaignId,
        creatorId: params.reviewLink.creatorId,
        reviewToken: params.reviewLink.token,
        postId: params.postId,
        revoked: false,
        authorName,
        authorRole: 'client',
        body,
        createdAt: serverTimestamp(),
      }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}
