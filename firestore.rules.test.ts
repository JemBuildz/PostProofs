import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
const blueprintPath = path.resolve(process.cwd(), 'firebase-blueprint.json');
const storageRulesPath = path.resolve(process.cwd(), 'storage.rules');

const rulesText = fs.readFileSync(rulesPath, 'utf8');
const storageRulesText = fs.readFileSync(storageRulesPath, 'utf8');
const blueprint = JSON.parse(fs.readFileSync(blueprintPath, 'utf8')) as {
  entities: Record<string, { required: string[]; properties: Record<string, { maxLength?: number }> }>;
  firestore: Record<string, unknown>;
};

describe('Firestore & Storage Security Rules Static Invariant Verification', () => {
  it('uses rules_version 2 and enforces default-deny catch-all first', () => {
    assert.match(rulesText, /^rules_version = '2';/);
    const catchAllIdx = rulesText.indexOf('match /{document=**}');
    const billingIdx = rulesText.indexOf('match /billing/{userId}');
    assert.ok(catchAllIdx > 0 && catchAllIdx < billingIdx);
    assert.match(rulesText, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;\s*\}/);
  });

  it('covers every collection declared in firebase-blueprint.json', () => {
    const expectedMatches = [
      'match /billing/{userId}',
      'match /stripeCustomers/{stripeCustomerId}',
      'match /stripeEvents/{eventId}',
      'match /campaigns/{campaignId}',
      'match /images/{imageId}',
      'match /reviewLinks/{reviewToken}',
      'match /posts/{postId}',
      'match /comments/{commentId}',
    ];
    for (const block of expectedMatches) {
      assert.ok(rulesText.includes(block), `Missing rule block: ${block}`);
    }
    assert.equal(Object.keys(blueprint.firestore).length, 8);
  });

  it('locks /billing/{userId} to owner-get-only and denies all client writes & listings', () => {
    assert.match(
      rulesText,
      /match \/billing\/\{userId\}[\s\S]*?allow get: if isSignedIn\(\) && isValidId\(userId\) && request\.auth\.uid == userId;/
    );
    assert.match(rulesText, /match \/billing\/\{userId\}[\s\S]*?allow list: if false;/);
    assert.match(
      rulesText,
      /match \/billing\/\{userId\}[\s\S]*?allow create, update, delete: if false;/
    );
  });

  it('denies all client access to server-only Stripe and CampaignImage metadata collections', () => {
    assert.match(
      rulesText,
      /match \/stripeCustomers\/\{stripeCustomerId\}\s*\{\s*allow read, write: if false;\s*\}/
    );
    assert.match(
      rulesText,
      /match \/stripeEvents\/\{eventId\}\s*\{\s*allow read, write: if false;\s*\}/
    );
    assert.match(rulesText, /match \/images\/\{imageId\}\s*\{\s*allow read, write: if false;\s*\}/);
  });

  it('prevents direct client quota bypass by denying create/delete on /campaigns, /reviewLinks, and /posts', () => {
    assert.match(
      rulesText,
      /match \/campaigns\/\{campaignId\}[\s\S]*?allow create, update, delete: if false;/
    );
    assert.match(
      rulesText,
      /match \/reviewLinks\/\{reviewToken\}[\s\S]*?allow create, update, delete: if false;/
    );
    assert.match(rulesText, /match \/posts\/\{postId\}[\s\S]*?allow create, delete: if false;/);
  });

  it('strictly blocks enumeration of private reviewLinks and delegates no list rules to bare isSignedIn()', () => {
    assert.match(rulesText, /match \/reviewLinks\/\{reviewToken\}[\s\S]*?allow list: if false;/);
    assert.doesNotMatch(rulesText, /allow list:\s*if\s*isSignedIn\(\)\s*;/);
    assert.match(
      rulesText,
      /match \/campaigns\/\{campaignId\}[\s\S]*?allow list: if isSignedIn\(\) && existing\(\)\.creatorId == request\.auth\.uid;/
    );
  });

  it('enforces Master Gate revocation and Tier 2 client-only status updates and comments', () => {
    assert.match(
      rulesText,
      /incoming\(\)\.diff\(existing\(\)\)\.affectedKeys\(\)\.hasOnly\(\['status', 'updatedAt'\]\)/
    );
    assert.match(rulesText, /incoming\(\)\.status in \['approved', 'changes_requested'\]/);
    assert.match(
      rulesText,
      /get\(\/databases\/\$\(database\)\/documents\/reviewLinks\/\$\(reviewToken\)\)\.data\.revoked == false/
    );
    assert.match(rulesText, /incoming\(\)\.authorRole == 'client'/);
  });

  it('synchronizes maxLength constraints from firebase-blueprint.json into Post and Comment validators', () => {
    assert.ok(rulesText.includes(`data.title.size() <= ${blueprint.entities.Post.properties.title.maxLength}`));
    assert.ok(rulesText.includes(`data.caption.size() <= ${blueprint.entities.Post.properties.caption.maxLength}`));
    assert.ok(rulesText.includes(`data.imageUrl.size() <= ${blueprint.entities.Post.properties.imageUrl.maxLength}`));
    assert.ok(rulesText.includes(`data.body.size() <= ${blueprint.entities.Comment.properties.body.maxLength}`));
  });

  it('locks storage.rules to default-deny so all image access is gated server-side by campaign', () => {
    assert.match(storageRulesText, /service firebase\.storage/);
    assert.match(storageRulesText, /allow read, write: if false;/);
  });
});
