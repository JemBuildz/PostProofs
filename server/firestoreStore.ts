import { Timestamp } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import type { Storage } from 'firebase-admin/storage';
import { getAdminFirestore, getAdminStorage, getFirebaseAdminConfig } from './firebaseAdmin.ts';
import {
  ALLOWED_CHANNELS,
  defaultBillingRecord,
  generateId,
  generateReviewToken,
  StorageUnavailableError,
} from './store.ts';
import type {
  BillingRecord,
  CampaignImageRecord,
  CampaignRecord,
  CommentRecord,
  ImageBinaryResult,
  PostApprovalStatus,
  PostProofStore,
  PostRecord,
  ReviewLinkRecord,
  SocialChannel,
  SubscriptionPlan,
  SubscriptionStatus,
  UsageCounts,
} from './store.ts';

function toIso(val: unknown): string {
  if (val instanceof Timestamp) {
    return val.toDate().toISOString();
  }
  if (val && typeof (val as { toDate?: () => Date }).toDate === 'function') {
    return (val as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof val === 'string') return val;
  return new Date().toISOString();
}

function normalizeChannel(val: unknown): SocialChannel {
  if (typeof val === 'string' && ALLOWED_CHANNELS.has(val as SocialChannel)) {
    return val as SocialChannel;
  }
  return 'Instagram';
}

export class FirestorePostProofStore implements PostProofStore {
  private readonly dbOverride?: Firestore;
  private readonly storageOverride?: Storage;

  constructor(opts?: { db?: Firestore; storage?: Storage }) {
    this.dbOverride = opts?.db;
    this.storageOverride = opts?.storage;
  }

  private db(): Firestore {
    return this.dbOverride ?? getAdminFirestore();
  }

  private storage(): Storage {
    return this.storageOverride ?? getAdminStorage();
  }

  async getBillingRecord(userId: string): Promise<BillingRecord | null> {
    const snap = await this.db().collection('billing').doc(userId).get();
    if (!snap.exists) return null;
    const d = snap.data() ?? {};
    return {
      userId,
      email: typeof d.email === 'string' ? d.email : '',
      stripeCustomerId: typeof d.stripeCustomerId === 'string' ? d.stripeCustomerId : null,
      stripeSubscriptionId:
        typeof d.stripeSubscriptionId === 'string' ? d.stripeSubscriptionId : null,
      plan: (d.plan as SubscriptionPlan) || 'free',
      status: (d.status as SubscriptionStatus) || 'inactive',
      currentPeriodEnd: typeof d.currentPeriodEnd === 'string' ? d.currentPeriodEnd : null,
      updatedAt: toIso(d.updatedAt),
    };
  }

  async upsertBillingRecord(
    userId: string,
    patch: Partial<Omit<BillingRecord, 'userId'>>
  ): Promise<BillingRecord> {
    const db = this.db();
    const ref = db.collection('billing').doc(userId);
    const prev = (await this.getBillingRecord(userId)) ?? defaultBillingRecord(userId);
    const nowTs = Timestamp.now();
    const nowIso = nowTs.toDate().toISOString();

    const next: BillingRecord = {
      ...prev,
      ...patch,
      userId,
      updatedAt: nowIso,
    };

    const batch = db.batch();
    batch.set(
      ref,
      {
        userId: next.userId,
        email: next.email,
        stripeCustomerId: next.stripeCustomerId,
        stripeSubscriptionId: next.stripeSubscriptionId,
        plan: next.plan,
        status: next.status,
        currentPeriodEnd: next.currentPeriodEnd,
        updatedAt: nowTs,
      },
      { merge: true }
    );

    if (next.stripeCustomerId) {
      batch.set(
        db.collection('stripeCustomers').doc(next.stripeCustomerId),
        {
          userId: next.userId,
          email: next.email,
          updatedAt: nowTs,
        },
        { merge: true }
      );
    }

    await batch.commit();
    return next;
  }

  async findUserIdByStripeCustomer(stripeCustomerId: string): Promise<string | null> {
    const snap = await this.db().collection('stripeCustomers').doc(stripeCustomerId).get();
    if (snap.exists) {
      const uid = snap.data()?.userId;
      if (typeof uid === 'string' && uid) return uid;
    }

    const fallback = await this.db()
      .collection('billing')
      .where('stripeCustomerId', '==', stripeCustomerId)
      .limit(1)
      .get();
    return fallback.empty ? null : fallback.docs[0].id;
  }

  async findUserIdByStripeSubscription(stripeSubscriptionId: string): Promise<string | null> {
    const snap = await this.db()
      .collection('billing')
      .where('stripeSubscriptionId', '==', stripeSubscriptionId)
      .limit(1)
      .get();
    return snap.empty ? null : snap.docs[0].id;
  }

  async hasProcessedStripeEvent(eventId: string): Promise<boolean> {
    const snap = await this.db().collection('stripeEvents').doc(eventId).get();
    return snap.exists;
  }

  async recordStripeEvent(eventId: string, eventType: string): Promise<boolean> {
    const ref = this.db().collection('stripeEvents').doc(eventId);
    try {
      await ref.create({
        eventId,
        type: eventType,
        processedAt: Timestamp.now(),
      });
      return true;
    } catch (err) {
      const code = (err as { code?: number | string })?.code;
      if (code === 6 || code === 'already-exists') {
        return false;
      }
      throw err;
    }
  }

  async getCreatorUsage(creatorId: string): Promise<UsageCounts> {
    const campaigns = await this.listCreatorCampaigns(creatorId);
    let postsCount = 0;
    let storageBytesUsed = 0;

    for (const cmp of campaigns) {
      if (cmp.activeReviewToken) {
        const snap = await this.db()
          .collection('reviewLinks')
          .doc(cmp.activeReviewToken)
          .collection('posts')
          .where('creatorId', '==', creatorId)
          .get();
        postsCount += snap.size;
      }

      const imagesSnap = await this.db()
        .collection('campaigns')
        .doc(cmp.id)
        .collection('images')
        .get();
      for (const imgDoc of imagesSnap.docs) {
        const sizeVal = imgDoc.data()?.sizeBytes;
        if (typeof sizeVal === 'number' && Number.isFinite(sizeVal) && sizeVal > 0) {
          storageBytesUsed += sizeVal;
        }
      }
    }

    return {
      campaignsCount: campaigns.length,
      postsCount,
      storageBytesUsed,
    };
  }

  async listCreatorCampaigns(creatorId: string): Promise<CampaignRecord[]> {
    const snap = await this.db()
      .collection('campaigns')
      .where('creatorId', '==', creatorId)
      .get();

    const items: CampaignRecord[] = snap.docs.map((docSnap) => {
      const d = docSnap.data();
      return {
        id: docSnap.id,
        creatorId: String(d.creatorId || ''),
        name: String(d.name || ''),
        clientName: String(d.clientName || ''),
        activeReviewToken: String(d.activeReviewToken || ''),
        reviewLinkRevoked: Boolean(d.reviewLinkRevoked),
        createdAt: toIso(d.createdAt),
        updatedAt: toIso(d.updatedAt),
      };
    });
    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return items;
  }

  async getCampaign(campaignId: string): Promise<CampaignRecord | null> {
    const snap = await this.db().collection('campaigns').doc(campaignId).get();
    if (!snap.exists) return null;
    const d = snap.data() ?? {};
    return {
      id: snap.id,
      creatorId: String(d.creatorId || ''),
      name: String(d.name || ''),
      clientName: String(d.clientName || ''),
      activeReviewToken: String(d.activeReviewToken || ''),
      reviewLinkRevoked: Boolean(d.reviewLinkRevoked),
      createdAt: toIso(d.createdAt),
      updatedAt: toIso(d.updatedAt),
    };
  }

  async createCampaign(params: {
    creatorId: string;
    name: string;
    clientName: string;
  }): Promise<CampaignRecord> {
    const db = this.db();
    const campaignId = generateId('cmp');
    const reviewToken = generateReviewToken();
    const nowTs = Timestamp.now();
    const nowIso = nowTs.toDate().toISOString();

    const batch = db.batch();
    batch.set(db.collection('campaigns').doc(campaignId), {
      creatorId: params.creatorId,
      name: params.name,
      clientName: params.clientName,
      activeReviewToken: reviewToken,
      reviewLinkRevoked: false,
      createdAt: nowTs,
      updatedAt: nowTs,
    });

    batch.set(db.collection('reviewLinks').doc(reviewToken), {
      campaignId,
      creatorId: params.creatorId,
      campaignName: params.name,
      clientName: params.clientName,
      revoked: false,
      createdAt: nowTs,
      updatedAt: nowTs,
    });

    await batch.commit();

    return {
      id: campaignId,
      creatorId: params.creatorId,
      name: params.name,
      clientName: params.clientName,
      activeReviewToken: reviewToken,
      reviewLinkRevoked: false,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  }

  async deleteCampaign(campaignId: string): Promise<void> {
    const db = this.db();
    const cmpRef = db.collection('campaigns').doc(campaignId);
    const cmpSnap = await cmpRef.get();
    if (!cmpSnap.exists) return;

    // Delete all review links belonging to this campaign (and their nested posts/comments)
    const linksSnap = await db
      .collection('reviewLinks')
      .where('campaignId', '==', campaignId)
      .get();

    for (const linkDoc of linksSnap.docs) {
      const postsSnap = await linkDoc.ref.collection('posts').get();
      for (const postDoc of postsSnap.docs) {
        const commentsSnap = await postDoc.ref.collection('comments').get();
        if (!commentsSnap.empty) {
          const cBatch = db.batch();
          for (const cDoc of commentsSnap.docs) {
            cBatch.delete(cDoc.ref);
          }
          await cBatch.commit();
        }
        await postDoc.ref.delete();
      }
      await linkDoc.ref.delete();
    }

    // Delete campaign image metadata & best-effort delete storage blobs
    const imagesSnap = await cmpRef.collection('images').get();
    const bucketName = getFirebaseAdminConfig().storageBucket;
    const bucket = bucketName ? this.storage().bucket(bucketName) : null;
    for (const imgDoc of imagesSnap.docs) {
      const storagePath = imgDoc.data()?.storagePath;
      if (bucket && typeof storagePath === 'string' && storagePath) {
        await bucket.file(storagePath).delete({ ignoreNotFound: true }).catch(() => {});
      }
      await imgDoc.ref.delete();
    }

    await cmpRef.delete();
  }

  async revokeReviewLink(campaignId: string): Promise<CampaignRecord> {
    const db = this.db();
    const campaign = await this.getCampaign(campaignId);
    if (!campaign) throw new Error('Campaign not found.');

    const token = campaign.activeReviewToken;
    const nowTs = Timestamp.now();

    const batch = db.batch();
    batch.update(db.collection('campaigns').doc(campaign.id), {
      reviewLinkRevoked: true,
      updatedAt: nowTs,
    });
    batch.update(db.collection('reviewLinks').doc(token), {
      revoked: true,
      updatedAt: nowTs,
    });

    const postsSnap = await db.collection('reviewLinks').doc(token).collection('posts').get();
    for (const postDoc of postsSnap.docs) {
      batch.update(postDoc.ref, { revoked: true, updatedAt: nowTs });
      const commentsSnap = await postDoc.ref.collection('comments').get();
      for (const cDoc of commentsSnap.docs) {
        batch.update(cDoc.ref, { revoked: true });
      }
    }

    await batch.commit();

    return {
      ...campaign,
      reviewLinkRevoked: true,
      updatedAt: nowTs.toDate().toISOString(),
    };
  }

  async rotateReviewLink(campaignId: string): Promise<CampaignRecord> {
    const db = this.db();
    const campaign = await this.getCampaign(campaignId);
    if (!campaign) throw new Error('Campaign not found.');

    const oldToken = campaign.activeReviewToken;
    const newToken = generateReviewToken();
    const nowTs = Timestamp.now();

    const oldLinkRef = db.collection('reviewLinks').doc(oldToken);
    const newLinkRef = db.collection('reviewLinks').doc(newToken);
    const oldPostsSnap = await oldLinkRef.collection('posts').get();

    const batch = db.batch();
    batch.set(
      oldLinkRef,
      { revoked: true, updatedAt: nowTs },
      { merge: true }
    );

    batch.set(newLinkRef, {
      campaignId: campaign.id,
      creatorId: campaign.creatorId,
      campaignName: campaign.name,
      clientName: campaign.clientName,
      revoked: false,
      createdAt: nowTs,
      updatedAt: nowTs,
    });

    for (const postDoc of oldPostsSnap.docs) {
      const pd = postDoc.data();
      batch.update(postDoc.ref, { revoked: true, updatedAt: nowTs });

      const rawImageUrl = String(pd.imageUrl || '');
      const imageId = typeof pd.imageId === 'string' && pd.imageId ? pd.imageId : undefined;
      const rewrittenImageUrl =
        imageId && rawImageUrl.startsWith(`/api/review/${oldToken}/images/`)
          ? `/api/review/${newToken}/images/${imageId}`
          : rawImageUrl;

      const newPostData: Record<string, unknown> = {
        campaignId: campaign.id,
        creatorId: campaign.creatorId,
        reviewToken: newToken,
        revoked: false,
        title: String(pd.title || ''),
        caption: String(pd.caption || ''),
        channel: normalizeChannel(pd.channel),
        scheduledDate: String(pd.scheduledDate || ''),
        imageUrl: rewrittenImageUrl,
        status: String(pd.status || 'in_review'),
        createdAt: pd.createdAt instanceof Timestamp ? pd.createdAt : nowTs,
        updatedAt: nowTs,
      };
      if (imageId) {
        newPostData.imageId = imageId;
      }

      const newPostRef = newLinkRef.collection('posts').doc(postDoc.id);
      batch.set(newPostRef, newPostData);

      const commentsSnap = await postDoc.ref.collection('comments').get();
      for (const cDoc of commentsSnap.docs) {
        const cd = cDoc.data();
        batch.update(cDoc.ref, { revoked: true });
        batch.set(newPostRef.collection('comments').doc(cDoc.id), {
          campaignId: campaign.id,
          creatorId: campaign.creatorId,
          reviewToken: newToken,
          postId: postDoc.id,
          revoked: false,
          authorName: String(cd.authorName || ''),
          authorRole: cd.authorRole === 'creator' ? 'creator' : 'client',
          body: String(cd.body || ''),
          createdAt: cd.createdAt instanceof Timestamp ? cd.createdAt : nowTs,
        });
      }
    }

    batch.update(db.collection('campaigns').doc(campaign.id), {
      activeReviewToken: newToken,
      reviewLinkRevoked: false,
      updatedAt: nowTs,
    });

    await batch.commit();

    return {
      ...campaign,
      activeReviewToken: newToken,
      reviewLinkRevoked: false,
      updatedAt: nowTs.toDate().toISOString(),
    };
  }

  async listPostsForReviewToken(reviewToken: string): Promise<PostRecord[]> {
    const postsSnap = await this.db()
      .collection('reviewLinks')
      .doc(reviewToken)
      .collection('posts')
      .get();

    const posts: PostRecord[] = [];
    for (const postDoc of postsSnap.docs) {
      const d = postDoc.data();
      const commentsSnap = await postDoc.ref.collection('comments').get();
      const comments: CommentRecord[] = commentsSnap.docs.map((cDoc) => {
        const cd = cDoc.data();
        return {
          id: cDoc.id,
          campaignId: String(cd.campaignId || ''),
          creatorId: String(cd.creatorId || ''),
          reviewToken: String(cd.reviewToken || reviewToken),
          postId: String(cd.postId || postDoc.id),
          revoked: Boolean(cd.revoked),
          authorName: String(cd.authorName || ''),
          authorRole: cd.authorRole === 'creator' ? 'creator' : 'client',
          body: String(cd.body || ''),
          createdAt: toIso(cd.createdAt),
        };
      });
      comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

      posts.push({
        id: postDoc.id,
        campaignId: String(d.campaignId || ''),
        creatorId: String(d.creatorId || ''),
        reviewToken: String(d.reviewToken || reviewToken),
        revoked: Boolean(d.revoked),
        title: String(d.title || ''),
        caption: String(d.caption || ''),
        channel: normalizeChannel(d.channel),
        scheduledDate: String(d.scheduledDate || ''),
        imageUrl: String(d.imageUrl || ''),
        ...(typeof d.imageId === 'string' && d.imageId ? { imageId: d.imageId } : {}),
        status: (d.status || 'in_review') as PostApprovalStatus,
        createdAt: toIso(d.createdAt),
        updatedAt: toIso(d.updatedAt),
        comments,
      });
    }

    posts.sort(
      (a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || a.createdAt.localeCompare(b.createdAt)
    );
    return posts;
  }

  async getPost(reviewToken: string, postId: string): Promise<PostRecord | null> {
    const postRef = this.db()
      .collection('reviewLinks')
      .doc(reviewToken)
      .collection('posts')
      .doc(postId);
    const snap = await postRef.get();
    if (!snap.exists) return null;
    const d = snap.data() ?? {};
    const commentsSnap = await postRef.collection('comments').get();
    const comments: CommentRecord[] = commentsSnap.docs.map((cDoc) => {
      const cd = cDoc.data();
      return {
        id: cDoc.id,
        campaignId: String(cd.campaignId || ''),
        creatorId: String(cd.creatorId || ''),
        reviewToken: String(cd.reviewToken || reviewToken),
        postId: String(cd.postId || postId),
        revoked: Boolean(cd.revoked),
        authorName: String(cd.authorName || ''),
        authorRole: cd.authorRole === 'creator' ? 'creator' : 'client',
        body: String(cd.body || ''),
        createdAt: toIso(cd.createdAt),
      };
    });
    comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    return {
      id: snap.id,
      campaignId: String(d.campaignId || ''),
      creatorId: String(d.creatorId || ''),
      reviewToken: String(d.reviewToken || reviewToken),
      revoked: Boolean(d.revoked),
      title: String(d.title || ''),
      caption: String(d.caption || ''),
      channel: normalizeChannel(d.channel),
      scheduledDate: String(d.scheduledDate || ''),
      imageUrl: String(d.imageUrl || ''),
      ...(typeof d.imageId === 'string' && d.imageId ? { imageId: d.imageId } : {}),
      status: (d.status || 'in_review') as PostApprovalStatus,
      createdAt: toIso(d.createdAt),
      updatedAt: toIso(d.updatedAt),
      comments,
    };
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
    const postId = generateId('pst');
    const nowTs = Timestamp.now();
    const nowIso = nowTs.toDate().toISOString();

    const docData: Record<string, unknown> = {
      campaignId: params.campaignId,
      creatorId: params.creatorId,
      reviewToken: params.reviewToken,
      revoked: false,
      title: params.title,
      caption: params.caption,
      channel: params.channel,
      scheduledDate: params.scheduledDate,
      imageUrl: params.imageUrl,
      status: 'in_review',
      createdAt: nowTs,
      updatedAt: nowTs,
    };
    if (params.imageId) {
      docData.imageId = params.imageId;
    }

    await this.db()
      .collection('reviewLinks')
      .doc(params.reviewToken)
      .collection('posts')
      .doc(postId)
      .set(docData);

    return {
      id: postId,
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
      createdAt: nowIso,
      updatedAt: nowIso,
      comments: [],
    };
  }

  async updatePost(
    reviewToken: string,
    postId: string,
    patch: Partial<Pick<PostRecord, 'title' | 'caption' | 'channel' | 'scheduledDate' | 'status'>>
  ): Promise<PostRecord | null> {
    const postRef = this.db()
      .collection('reviewLinks')
      .doc(reviewToken)
      .collection('posts')
      .doc(postId);
    const snap = await postRef.get();
    if (!snap.exists) return null;

    await postRef.update({
      ...patch,
      updatedAt: Timestamp.now(),
    });
    return this.getPost(reviewToken, postId);
  }

  async deletePost(reviewToken: string, postId: string): Promise<boolean> {
    const postsCollection = this.db()
      .collection('reviewLinks')
      .doc(reviewToken)
      .collection('posts');
    const postRef = postsCollection.doc(postId);
    const snap = await postRef.get();
    if (!snap.exists) return false;

    const postData = snap.data() ?? {};
    const campaignId = typeof postData.campaignId === 'string' ? postData.campaignId : '';
    const imageId = typeof postData.imageId === 'string' && postData.imageId ? postData.imageId : '';

    const commentsSnap = await postRef.collection('comments').get();
    if (!commentsSnap.empty) {
      const batch = this.db().batch();
      for (const cDoc of commentsSnap.docs) {
        batch.delete(cDoc.ref);
      }
      await batch.commit();
    }
    await postRef.delete();

    if (campaignId && imageId) {
      const otherRefs = await postsCollection.where('imageId', '==', imageId).limit(1).get();
      if (otherRefs.empty) {
        await this.deleteCampaignImage(campaignId, imageId).catch(() => {});
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
    const commentId = generateId('cmt');
    const nowTs = Timestamp.now();
    const nowIso = nowTs.toDate().toISOString();

    await this.db()
      .collection('reviewLinks')
      .doc(params.reviewToken)
      .collection('posts')
      .doc(params.postId)
      .collection('comments')
      .doc(commentId)
      .set({
        campaignId: params.campaignId,
        creatorId: params.creatorId,
        reviewToken: params.reviewToken,
        postId: params.postId,
        revoked: false,
        authorName: params.authorName,
        authorRole: params.authorRole,
        body: params.body,
        createdAt: nowTs,
      });

    return {
      id: commentId,
      campaignId: params.campaignId,
      creatorId: params.creatorId,
      reviewToken: params.reviewToken,
      postId: params.postId,
      revoked: false,
      authorName: params.authorName,
      authorRole: params.authorRole,
      body: params.body,
      createdAt: nowIso,
    };
  }

  async getReviewLink(reviewToken: string): Promise<ReviewLinkRecord | null> {
    const snap = await this.db().collection('reviewLinks').doc(reviewToken).get();
    if (!snap.exists) return null;
    const d = snap.data() ?? {};
    return {
      token: snap.id,
      campaignId: String(d.campaignId || ''),
      creatorId: String(d.creatorId || ''),
      campaignName: String(d.campaignName || ''),
      clientName: String(d.clientName || ''),
      revoked: Boolean(d.revoked),
      createdAt: toIso(d.createdAt),
      updatedAt: toIso(d.updatedAt),
    };
  }

  async saveCampaignImage(params: {
    campaignId: string;
    creatorId: string;
    buffer: Buffer;
    contentType: string;
    extension: string;
  }): Promise<CampaignImageRecord> {
    const bucketName = getFirebaseAdminConfig().storageBucket;
    if (!bucketName) {
      throw new StorageUnavailableError(
        'Firebase Storage bucket is not configured. Set storageBucket in firebase-applet-config.json or FIREBASE_STORAGE_BUCKET.'
      );
    }

    const imageId = generateId('img');
    const storagePath = `campaigns/${params.creatorId}/${params.campaignId}/${imageId}${params.extension}`;

    try {
      const bucket = this.storage().bucket(bucketName);
      const file = bucket.file(storagePath);
      await file.save(params.buffer, {
        resumable: false,
        contentType: params.contentType,
        metadata: {
          contentType: params.contentType,
          cacheControl: 'private, max-age=0, no-store',
        },
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Storage write failed';
      throw new StorageUnavailableError(
        `Unable to store image in Firebase Storage bucket (${bucketName}). Verify Firebase Storage is enabled and the server service account has roles/storage.objectAdmin. (${detail})`
      );
    }

    const nowTs = Timestamp.now();
    const sizeBytes = params.buffer.length;
    await this.db()
      .collection('campaigns')
      .doc(params.campaignId)
      .collection('images')
      .doc(imageId)
      .set({
        campaignId: params.campaignId,
        creatorId: params.creatorId,
        storagePath,
        contentType: params.contentType,
        sizeBytes,
        createdAt: nowTs,
      });

    return {
      id: imageId,
      campaignId: params.campaignId,
      creatorId: params.creatorId,
      storagePath,
      contentType: params.contentType,
      sizeBytes,
      createdAt: nowTs.toDate().toISOString(),
    };
  }

  async getCampaignImage(campaignId: string, imageId: string): Promise<CampaignImageRecord | null> {
    const snap = await this.db()
      .collection('campaigns')
      .doc(campaignId)
      .collection('images')
      .doc(imageId)
      .get();
    if (!snap.exists) return null;
    const d = snap.data() ?? {};
    return {
      id: snap.id,
      campaignId: String(d.campaignId || ''),
      creatorId: String(d.creatorId || ''),
      storagePath: String(d.storagePath || ''),
      contentType: String(d.contentType || 'application/octet-stream'),
      sizeBytes: typeof d.sizeBytes === 'number' && Number.isFinite(d.sizeBytes) ? d.sizeBytes : 0,
      createdAt: toIso(d.createdAt),
    };
  }

  async readCampaignImageBinary(image: CampaignImageRecord): Promise<ImageBinaryResult | null> {
    const bucketName = getFirebaseAdminConfig().storageBucket;
    if (!bucketName) {
      throw new StorageUnavailableError('Firebase Storage bucket is not configured.');
    }

    const bucket = this.storage().bucket(bucketName);
    const tokenResult = await bucket.storage.authClient.getAccessToken();
    const accessToken =
      typeof tokenResult === 'string'
        ? tokenResult
        : (tokenResult as { token?: string | null } | null)?.token ?? null;

    if (!accessToken) {
      throw new StorageUnavailableError('Unable to obtain Google Cloud Storage access token.');
    }

    const mediaUrl =
      `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucketName)}` +
      `/o/${encodeURIComponent(image.storagePath)}?alt=media`;

    const res = await fetch(mediaUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      throw new StorageUnavailableError(
        `Unable to read image from Firebase Storage (HTTP ${res.status}).`
      );
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    return {
      buffer,
      contentType: image.contentType,
    };
  }

  async deleteCampaignImage(campaignId: string, imageId: string): Promise<void> {
    const imgRef = this.db()
      .collection('campaigns')
      .doc(campaignId)
      .collection('images')
      .doc(imageId);
    const snap = await imgRef.get();
    if (!snap.exists) return;

    const storagePath = snap.data()?.storagePath;
    const bucketName = getFirebaseAdminConfig().storageBucket;
    if (bucketName && typeof storagePath === 'string' && storagePath) {
      const bucket = this.storage().bucket(bucketName);
      await bucket.file(storagePath).delete({ ignoreNotFound: true }).catch(() => {});
    }
    await imgRef.delete();
  }
}
