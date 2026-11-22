import React, { useMemo, useState } from 'react';
import {
  Check,
  CheckSquare,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  FolderOpen,
  Mail,
  MessageSquare,
  RotateCcw,
  Square,
} from 'lucide-react';
import type { FirebaseCampaign, FirebasePost } from '../lib/firestoreRepo';
import { PostStatusBadge, ProofImage } from './SocialPostMockup';

export interface PendingApprovalsHubProps {
  readonly campaigns: ReadonlyArray<FirebaseCampaign>;
  readonly postsByCampaignId: Readonly<Record<string, FirebasePost[]>>;
  readonly onOpenCampaign: (campaignId: string) => void;
  readonly onInspectPost: (campaign: FirebaseCampaign, post: FirebasePost) => void;
  readonly onResetToInReview: (campaignId: string, postId: string) => Promise<void>;
}

type PendingStatusFilter = 'actionable' | 'in_review' | 'changes_requested';

export const PendingApprovalsHub: React.FC<PendingApprovalsHubProps> = ({
  campaigns,
  postsByCampaignId,
  onOpenCampaign,
  onInspectPost,
  onResetToInReview,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [campaignFilter, setCampaignFilter] = useState('all');
  const [channelFilter, setChannelFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState<PendingStatusFilter>('actionable');
  const [selectedIds, setSelectedIds] = useState<Record<string, { campaignId: string; status: string }>>({});
  const [copiedCampaignId, setCopiedCampaignId] = useState<string | null>(null);
  const [copiedNudgeCampaignId, setCopiedNudgeCampaignId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const metrics = useMemo(() => {
    let totalPosts = 0;
    let inReview = 0;
    let changesRequested = 0;
    let approved = 0;
    let campaignsWithPending = 0;

    for (const c of campaigns) {
      const list = postsByCampaignId[c.id] ?? [];
      totalPosts += list.length;
      let campPending = 0;
      for (const p of list) {
        if (p.status === 'in_review') {
          inReview += 1;
          campPending += 1;
        } else if (p.status === 'changes_requested') {
          changesRequested += 1;
          campPending += 1;
        } else if (p.status === 'approved') {
          approved += 1;
        }
      }
      if (campPending > 0) campaignsWithPending += 1;
    }

    const approvedRate = totalPosts > 0 ? Math.round((approved / totalPosts) * 100) : 0;
    return { totalPosts, inReview, changesRequested, approved, campaignsWithPending, approvedRate };
  }, [campaigns, postsByCampaignId]);

  const availableChannels = useMemo(() => {
    const set = new Set<string>();
    for (const c of campaigns) {
      for (const p of postsByCampaignId[c.id] ?? []) {
        set.add(p.channel);
      }
    }
    return ['All', ...Array.from(set)];
  }, [campaigns, postsByCampaignId]);

  const groupedCampaigns = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return campaigns
      .filter((c) => campaignFilter === 'all' || c.id === campaignFilter)
      .map((campaign) => {
        const allPosts = postsByCampaignId[campaign.id] ?? [];
        const filtered = allPosts.filter((post) => {
          if (statusFilter === 'actionable') {
            if (post.status !== 'in_review' && post.status !== 'changes_requested') return false;
          } else if (post.status !== statusFilter) {
            return false;
          }
          if (channelFilter !== 'All' && post.channel !== channelFilter) return false;
          if (!query) return true;
          return (
            post.title.toLowerCase().includes(query) ||
            post.caption.toLowerCase().includes(query) ||
            campaign.name.toLowerCase().includes(query) ||
            campaign.clientName.toLowerCase().includes(query)
          );
        });
        return { campaign, posts: filtered };
      })
      .filter((group) => group.posts.length > 0);
  }, [campaigns, postsByCampaignId, campaignFilter, channelFilter, statusFilter, searchQuery]);

  const selectedEntries = Object.entries(selectedIds);

  const togglePostSelection = (post: FirebasePost) => {
    setSelectedIds((prev) => {
      if (prev[post.id]) {
        const next = { ...prev };
        delete next[post.id];
        return next;
      }
      return { ...prev, [post.id]: { campaignId: post.campaignId, status: post.status } };
    });
  };

  const handleCopyReviewUrl = async (campaign: FirebaseCampaign) => {
    const url = `${window.location.origin}/review/${campaign.activeReviewToken}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedCampaignId(campaign.id);
      window.setTimeout(
        () => setCopiedCampaignId((cur) => (cur === campaign.id ? null : cur)),
        2000
      );
    } catch {
      // Ignore clipboard failures in restricted browser environments
    }
  };

  const buildNudgeText = (campaign: FirebaseCampaign, pendingPosts: ReadonlyArray<FirebasePost>) => {
    const url = `${window.location.origin}/review/${campaign.activeReviewToken}`;
    const titles = pendingPosts.slice(0, 4).map((p) => `- ${p.title} (${p.channel}, ${p.scheduledDate})`);
    const extra = pendingPosts.length > 4 ? `\n- ...and ${pendingPosts.length - 4} more` : '';
    return `Hi ${campaign.clientName} team,\n\nWe have ${pendingPosts.length} post proof${
      pendingPosts.length === 1 ? '' : 's'
    } ready for your sign-off in "${campaign.name}":\n${titles.join('\n')}${extra}\n\nReview and approve here:\n${url}\n`;
  };

  const handleCopyNudgeMessage = async (
    campaign: FirebaseCampaign,
    pendingPosts: ReadonlyArray<FirebasePost>
  ) => {
    try {
      await navigator.clipboard.writeText(buildNudgeText(campaign, pendingPosts));
      setCopiedNudgeCampaignId(campaign.id);
      window.setTimeout(
        () => setCopiedNudgeCampaignId((cur) => (cur === campaign.id ? null : cur)),
        2500
      );
    } catch {
      // Ignore clipboard failures
    }
  };

  const handleBulkResetToReview = async () => {
    const revisions = selectedEntries.filter(([, meta]) => meta.status === 'changes_requested');
    if (revisions.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    try {
      for (const [postId, meta] of revisions) {
        await onResetToInReview(meta.campaignId, postId);
      }
      setSelectedIds({});
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-[#5B42DC]">Cross-campaign triage</p>
          <h1 className="mt-1 text-3xl font-bold tracking-[-0.03em] text-[#1C1D33]">
            Pending Approvals &amp; Client Nudges
          </h1>
          <p className="mt-1 text-sm text-[#5B5E77]">
            Track every post waiting on client signoff or revisions across all your active campaigns.
          </p>
        </div>
      </div>

      {/* 4 Live KPI Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-[#E2E4F0] bg-white p-5">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#5B42DC]">
            Awaiting signoff
          </p>
          <p className="mt-2 text-3xl font-bold tracking-tight text-[#1C1D33]">
            {metrics.inReview}
          </p>
          <p className="mt-1 text-xs text-[#5B5E77]">
            Across {metrics.campaignsWithPending} campaign{metrics.campaignsWithPending === 1 ? '' : 's'}
          </p>
        </div>

        <button
          type="button"
          onClick={() =>
            setStatusFilter((cur) => (cur === 'changes_requested' ? 'actionable' : 'changes_requested'))
          }
          className={`rounded-2xl border p-5 text-left transition-colors cursor-pointer ${
            statusFilter === 'changes_requested'
              ? 'border-[#9A5B0A] bg-[#FEF8EC]'
              : 'border-[#E2E4F0] bg-white hover:border-[#D4B483]'
          }`}
        >
          <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#9A5B0A]">
            Needs revision
          </p>
          <p className="mt-2 text-3xl font-bold tracking-tight text-[#1C1D33]">
            {metrics.changesRequested}
          </p>
          <p className="mt-1 text-xs text-[#7D4908]">
            {statusFilter === 'changes_requested' ? 'Showing revisions only' : 'Click to filter revisions'}
          </p>
        </button>

        <div className="rounded-2xl border border-[#E2E4F0] bg-white p-5">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#1E6F4A]">
            Approved proofs
          </p>
          <p className="mt-2 text-3xl font-bold tracking-tight text-[#1C1D33]">
            {metrics.approved}
          </p>
          <p className="mt-1 text-xs text-[#5B5E77]">Ready for publishing</p>
        </div>

        <div className="rounded-2xl border border-[#E2E4F0] bg-white p-5">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#474A63]">
            Signoff rate
          </p>
          <p className="mt-2 text-3xl font-bold tracking-tight text-[#1C1D33]">
            {metrics.totalPosts > 0 ? `${metrics.approvedRate}%` : '—'}
          </p>
          <p className="mt-1 text-xs text-[#5B5E77]">
            {metrics.approved} of {metrics.totalPosts} total proofs
          </p>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-col gap-3 rounded-2xl border border-[#E2E4F0] bg-white p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            aria-label="Filter pending posts"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search post title, caption, or client…"
            className="h-9 w-full rounded-xl border border-[#DCDEEB] bg-[#FAFBFD] px-3 text-xs text-[#1C1D33] placeholder:text-[#8E91A8] focus:border-[#5B42DC] focus:bg-white focus:outline-none sm:w-64"
          />

          <select
            aria-label="Filter by campaign"
            value={campaignFilter}
            onChange={(e) => setCampaignFilter(e.target.value)}
            className="h-9 rounded-xl border border-[#DCDEEB] bg-white px-3 text-xs font-medium text-[#1C1D33] focus:border-[#5B42DC] focus:outline-none"
          >
            <option value="all">All campaigns ({campaigns.length})</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.clientName} — {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border border-[#E2E4F0] bg-[#FAFBFD] p-0.5">
            {(
              [
                ['actionable', 'All pending'],
                ['in_review', 'In review'],
                ['changes_requested', 'Changes requested'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setStatusFilter(key)}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold cursor-pointer ${
                  statusFilter === key
                    ? 'bg-white text-[#5B42DC] shadow-xs'
                    : 'text-[#5D607A] hover:text-[#1C1D33]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1">
            {availableChannels.map((ch) => (
              <button
                key={ch}
                type="button"
                onClick={() => setChannelFilter(ch)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold cursor-pointer ${
                  channelFilter === ch
                    ? 'bg-[#EAE6FF] text-[#4931C2]'
                    : 'bg-[#F4F5FA] text-[#5D607A] hover:text-[#1C1D33]'
                }`}
              >
                {ch}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Grouped Campaign Sections */}
      {groupedCampaigns.length === 0 ? (
        <div className="rounded-2xl border border-[#E2E4F0] bg-white p-12 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-[#EDF8F2] text-[#1E6F4A]">
            <Clock className="h-5 w-5" aria-hidden="true" />
          </div>
          <h2 className="mt-3 text-lg font-bold text-[#1C1D33]">Nothing pending in this filter</h2>
          <p className="mt-1 text-sm text-[#5B5E77]">
            All matching posts are signed off, or adjust your campaign/channel filters above.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {groupedCampaigns.map(({ campaign, posts }) => {
            const mailtoSubject = encodeURIComponent(
              `Posts ready for your review: ${campaign.name}`
            );
            const mailtoBody = encodeURIComponent(buildNudgeText(campaign, posts));

            return (
              <section
                key={campaign.id}
                className="overflow-hidden rounded-2xl border border-[#E2E4F0] bg-white"
              >
                {/* Campaign Group Header */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#ECEDF4] bg-[#FAFBFD] px-5 py-3.5">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#5B42DC] text-[11px] font-bold text-white">
                      {campaign.clientName.slice(0, 2).toUpperCase()}
                    </span>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-sm font-bold text-[#1C1D33]">
                          {campaign.clientName} · {campaign.name}
                        </h2>
                        <span className="rounded-full bg-[#EEF0FA] px-2 py-0.5 font-mono text-[11px] font-semibold text-[#474A63]">
                          {posts.length} pending
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {!campaign.reviewLinkRevoked && (
                      <>
                        <button
                          type="button"
                          onClick={() => void handleCopyReviewUrl(campaign)}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#DCDEEB] bg-white px-2.5 text-xs font-semibold text-[#23253E] hover:border-[#5B42DC] hover:text-[#5B42DC] cursor-pointer"
                        >
                          {copiedCampaignId === campaign.id ? (
                            <>
                              <Check className="h-3.5 w-3.5 text-[#1E6F4A]" />
                              Copied URL
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5" />
                              Copy link
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleCopyNudgeMessage(campaign, posts)}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#EAE6FF] px-3 text-xs font-semibold text-[#4931C2] hover:bg-[#DDD5FF] cursor-pointer"
                        >
                          {copiedNudgeCampaignId === campaign.id ? (
                            <>
                              <Check className="h-3.5 w-3.5 text-[#1E6F4A]" />
                              Copied nudge
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5" />
                              Copy client nudge
                            </>
                          )}
                        </button>
                        <a
                          href={`mailto:?subject=${mailtoSubject}&body=${mailtoBody}`}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#DCDEEB] bg-white px-2.5 text-xs font-semibold text-[#23253E] hover:border-[#5B42DC] hover:text-[#5B42DC]"
                        >
                          <Mail className="h-3.5 w-3.5" />
                          Email reminder
                        </a>
                        <a
                          href={`/review/${campaign.activeReviewToken}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Open review portal for ${campaign.name}`}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#DCDEEB] bg-white text-[#474A63] hover:border-[#5B42DC] hover:text-[#5B42DC]"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => onOpenCampaign(campaign.id)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#DCDEEB] bg-white px-2.5 text-xs font-semibold text-[#5B42DC] hover:border-[#5B42DC] cursor-pointer"
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                      Open campaign
                    </button>
                  </div>
                </div>

                {/* Actionable Posts List */}
                <div className="divide-y divide-[#ECEDF4]">
                  {posts.map((post) => {
                    const checked = Boolean(selectedIds[post.id]);
                    const latestComment =
                      post.comments.length > 0 ? post.comments[post.comments.length - 1] : null;
                    return (
                      <div
                        key={post.id}
                        className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex min-w-0 flex-1 items-start gap-3.5">
                          <button
                            type="button"
                            onClick={() => togglePostSelection(post)}
                            aria-label={`Select ${post.title}`}
                            className="mt-1 shrink-0 text-[#6B6E87] hover:text-[#5B42DC] cursor-pointer"
                          >
                            {checked ? (
                              <CheckSquare className="h-4 w-4 text-[#5B42DC]" />
                            ) : (
                              <Square className="h-4 w-4" />
                            )}
                          </button>

                          <div className="w-20 shrink-0">
                            <ProofImage
                              src={post.imageUrl}
                              alt={post.title}
                              aspectClass="aspect-square"
                            />
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <PostStatusBadge status={post.status} />
                              <span className="font-mono text-xs text-[#6B6E87]">
                                {post.channel} · Scheduled {post.scheduledDate}
                              </span>
                            </div>
                            <h3 className="mt-1 truncate text-sm font-bold text-[#1C1D33]">
                              {post.title}
                            </h3>
                            <p className="mt-0.5 line-clamp-2 text-xs text-[#474A63]">
                              {post.caption}
                            </p>
                            {latestComment && (
                              <p className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-lg border border-[#EAEBF4] bg-[#FAFBFD] px-2.5 py-1 text-[11px] text-[#43465E]">
                                <MessageSquare className="h-3 w-3 shrink-0 text-[#5B42DC]" />
                                <span className="truncate">
                                  <strong>{latestComment.authorName}:</strong> {latestComment.body}
                                </span>
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 shrink-0 pl-8 sm:pl-0">
                          {post.status === 'changes_requested' && (
                            <button
                              type="button"
                              onClick={() => void onResetToInReview(campaign.id, post.id)}
                              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#EAE6FF] px-3 text-xs font-semibold text-[#4931C2] hover:bg-[#DDD5FF] cursor-pointer"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                              Mark re-review ready
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onInspectPost(campaign, post)}
                            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#DCDEEB] bg-white px-3.5 text-xs font-semibold text-[#23253E] hover:border-[#5B42DC] hover:text-[#5B42DC] cursor-pointer"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            Inspect proof
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Bulk Action Bar when items selected */}
      {selectedEntries.length > 0 && (
        <div className="sticky bottom-4 z-20 mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#1C1D33] px-5 py-3 text-white shadow-xl">
          <div className="text-xs font-semibold">
            {selectedEntries.length} post{selectedEntries.length === 1 ? '' : 's'} selected
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {selectedEntries.some(([, meta]) => meta.status === 'changes_requested') && (
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => void handleBulkResetToReview()}
                className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-[#5B42DC] px-3.5 text-xs font-semibold text-white hover:bg-[#4931C2] disabled:opacity-50 cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {bulkBusy ? 'Updating…' : 'Mark selected ready for re-review'}
              </button>
            )}
            <button
              type="button"
              onClick={() => setSelectedIds({})}
              className="inline-flex h-8 items-center rounded-xl border border-white/20 px-3 text-xs font-semibold text-white/90 hover:bg-white/10 cursor-pointer"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
