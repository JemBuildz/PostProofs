export type WorkspaceTab =
  | 'campaigns'
  | 'pending'
  | 'approved'
  | 'portals'
  | 'billing'
  | 'settings';

/**
 * Maps workspace pathnames to the active creator workspace tab.
 */
export function resolveWorkspaceTab(pathname: string): WorkspaceTab {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  if (normalized === '/app/pending') return 'pending';
  if (normalized === '/app/approved') return 'approved';
  if (normalized === '/app/portals') return 'portals';
  if (normalized === '/app/billing') return 'billing';
  if (normalized === '/app/settings') return 'settings';
  return 'campaigns';
}

/**
 * Preserves the creator's previously selected campaign when returning from
 * another tab or review preview, falling back to the first campaign only if
 * no previous selection exists or it was deleted.
 */
export function resolveSelectedCampaignId(
  previousId: string | null,
  campaigns: ReadonlyArray<{ id: string }>
): string | null {
  if (previousId && campaigns.some((c) => c.id === previousId)) {
    return previousId;
  }
  return campaigns[0]?.id ?? null;
}
