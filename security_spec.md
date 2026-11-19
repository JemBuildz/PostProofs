# PostProof Firestore & Storage Security Specification

## 1. Data & Access Invariants
1. **Server-Written Billing Entitlements (`/billing/{userId}`)**: Only the Express backend (via Firebase Admin SDK after verifying signed Stripe webhooks) may create or update `/billing/{userId}`, `/stripeCustomers/{customerId}`, and `/stripeEvents/{eventId}`. Creators may only `get` their own `/billing/{uid}` document; all client writes are unconditionally denied.
2. **Server-Enforced Campaign & Post Quotas**: Direct client `create`, `update`, and `delete` on `/campaigns/{campaignId}` and direct client `create` and `delete` on `/reviewLinks/{reviewToken}/posts/{postId}` are set to `if false;` in `firestore.rules`. Creators MUST go through Express routes authenticated with `verifyIdToken(token)`, which read `/billing/{uid}` and enforce campaign and post limits atomically before writing via Admin SDK.
3. **Private Non-Enumerable Review Links**: `/reviewLinks` strictly denies `list`. Clients can only `get` `/reviewLinks/{reviewToken}` when they possess the exact 24–64 char random token AND `revoked == false`.
4. **Tiered Client Approvals & Comments**: Clients holding an active, non-revoked review token can ONLY:
   - Read posts & comments belonging to that exact `{reviewToken}` while `revoked == false`.
   - Update `['status', 'updatedAt']` on posts (`status in ['approved', 'changes_requested']`, `updatedAt == request.time`).
   - Append comments with `authorRole == 'client'` and `createdAt == request.time`.
5. **Campaign-Scoped Image Isolation**: Firebase Storage (`storage.rules`) denies all unauthenticated/public client reads and writes. Uploads require a verified creator Firebase ID token + campaign ownership check on `POST /api/campaigns/:id/images`, and image delivery (`GET /api/review/:token/images/:imageId`) verifies the review token is active (or caller is the owning creator) AND that `image.campaignId === reviewLink.campaignId`.

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Client Billing Forgery**: Authenticated creator attempts `setDoc` or `updateDoc` on `/billing/{uid}` with `{ plan: "studio", status: "active" }`.
2. **Cross-Account Billing Read**: Creator B attempts `getDoc` on `/billing/{creatorA_uid}` or `list` on `/billing`.
3. **Quota Bypass via Direct Campaign Create**: Creator A bypasses Express and attempts direct `setDoc` on `/campaigns/cmp_bypass`.
4. **Quota Bypass via Direct Post Create**: Creator A bypasses Express and attempts direct `setDoc` on `/reviewLinks/{token}/posts/pst_bypass`.
5. **Stripe Event / Customer Tampering**: Any client attempts read or write on `/stripeEvents/{id}` or `/stripeCustomers/{id}`.
6. **Review Link Enumeration**: Any user attempts `list` on `/reviewLinks`.
7. **Cross-Creator Campaign Scraping**: Creator B attempts `get` on Creator A's `/campaigns/{campaignId}` or `list` without `creatorId == uidB`.
8. **Revoked Link Read / Approval**: Client attempts `get`, `list`, or post `update` using a revoked `reviewToken`.
9. **Client Caption / Field Tampering**: Client with active token attempts post `update` changing `['status', 'caption', 'updatedAt']` or adding a ghost field (`isVerified: true`).
10. **Client Invalid Status Value**: Client attempts post `update` setting `status: "in_review"` or `status: "published"`.
11. **Client Spoofing Creator Role in Comments**: Client attempts comment `create` with `authorRole: "creator"`.
12. **Cross-Campaign Image Access / Unauthenticated Upload**: Unauthenticated caller attempts `POST /api/campaigns/:id/images`, or client with Campaign A's token requests Campaign B's `imageId` at `GET /api/review/{tokenA}/images/{imageIdB}`.
