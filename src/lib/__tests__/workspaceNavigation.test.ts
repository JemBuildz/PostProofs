import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveSelectedCampaignId, resolveWorkspaceTab } from '../workspaceState.ts';

describe('Workspace tab routing & campaign selection persistence', () => {
  it('keeps /app, /app/pending, /app/approved, /app/portals, /app/billing, and /app/settings synchronized with workspace tabs', () => {
    assert.equal(resolveWorkspaceTab('/app'), 'campaigns');
    assert.equal(resolveWorkspaceTab('/app/'), 'campaigns');
    assert.equal(resolveWorkspaceTab('/app/pending'), 'pending');
    assert.equal(resolveWorkspaceTab('/app/pending/'), 'pending');
    assert.equal(resolveWorkspaceTab('/app/approved'), 'approved');
    assert.equal(resolveWorkspaceTab('/app/approved/'), 'approved');
    assert.equal(resolveWorkspaceTab('/app/portals'), 'portals');
    assert.equal(resolveWorkspaceTab('/app/portals/'), 'portals');
    assert.equal(resolveWorkspaceTab('/app/billing'), 'billing');
    assert.equal(resolveWorkspaceTab('/app/billing/'), 'billing');
    assert.equal(resolveWorkspaceTab('/app/settings'), 'settings');
    assert.equal(resolveWorkspaceTab('/app/settings/'), 'settings');
  });

  it('preserves selected campaign across Back/Forward tab and review navigation', () => {
    const campaigns = [{ id: 'cmp_1' }, { id: 'cmp_2' }, { id: 'cmp_3' }];

    // Restores second campaign when returning from /app/billing or /review/:token
    assert.equal(resolveSelectedCampaignId('cmp_2', campaigns), 'cmp_2');

    // Falls back to first campaign when no prior selection or when deleted
    assert.equal(resolveSelectedCampaignId(null, campaigns), 'cmp_1');
    assert.equal(resolveSelectedCampaignId('cmp_deleted', campaigns), 'cmp_1');
    assert.equal(resolveSelectedCampaignId('cmp_2', []), null);
  });
});
