import React, { useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  CheckSquare,
  Clock,
  ExternalLink,
  Eye,
  FolderOpen,
  MessageSquare,
  RotateCcw,
  Square,
  Zap,
} from 'lucide-react';
import type { FirebaseCampaign, FirebasePost, PostApprovalStatus } from '../lib/firestoreRepo';
import { PostStatusBadge, ProofImage } from './SocialPostMockup';

export interface PendingApprovalsHubProps {
  readonly campaigns: ReadonlyArray<FirebaseCampaign>;
  readonly postsByCampaignId: Readonly<Record<string, FirebasePost[]>>;
  readonly searchQuery?: string;
  readonly onOpenCampaign: (campaignId: string) => void;
  readonly onInspectPost: (campaign: FirebaseCampaign, post: FirebasePost) => void;
  readonly onUpdatePostStatus: (
    campaignId: string,
    postId: string,
    status: PostApprovalStatus
  ) => Promise<void>;
}

type PendingStatusFilter = 'actionable' | 'in_review' | 'changes_requested';

export const PendingApprovalsHub: React.FC<PendingApprovalsHubProps> = ({
  campaigns,
  postsByCampaignId,
  searchQuery = '',
  onOpenCampaign,
  onInspectPost,
  onUpdatePostStatus,
}) => {
  const [localFilterText, setLocalFilterText] = useState('');
  const [campaignFilter, setCampaignFilter] = useState('all');
  const [channelFilter, setChannelFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState<PendingStatusFilter>('actionable');
  const [selectedIds, setSelectedIds] = useState<
    Record<string, { campaignId: string; status: PostApprovalStatus }>
  >({});
  const [copiedNudgePostId, setCopiedNudgePostId] = useState<string | null>(null);
  const [busyPostId, setBusyPostId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const combinedQuery = (localFilterText || searchQuery).trim().toLowerCase();

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
          if (!combinedQuery) return true;
          return (
            post.title.toLowerCase().includes(combinedQuery) ||
            post.caption.toLowerCase().includes(combinedQuery) ||
            campaign.name.toLowerCase().includes(combinedQuery) ||
            campaign.clientName.toLowerCase().includes(combinedQuery)
          );
        });
        return { campaign, posts: filtered };
      })
      .filter((group) => group.posts.length > 0);
  }, [campaigns, postsByCampaignId, campaignFilter, channelFilter, statusFilter, combinedQuery]);

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

  const toggleCampaignGroupSelection = (posts: ReadonlyArray<FirebasePost>) => {
    const allSelected = posts.every((p) => Boolean(selectedIds[p.id]));
    setSelectedIds((prev) => {
      const next = { ...prev };
      if (allSelected) {
        for (const p of posts) delete next[p.id];
      } else {
        for (const p of posts) {
          next[p.id] = { campaignId: p.campaignId, status: p.status };
        }
      }
      return next;
    });
  };

  const handleCopyNudge = async (campaign: FirebaseCampaign, post: FirebasePost) => {
    if (campaign.reviewLinkRevoked) return;
    const url = `${window.location.origin}/review/${campaign.activeReviewToken}`;
    const text = `Hi ${campaign.clientName} team,\n\n"${post.title}" (${post.channel}, ${post.scheduledDate}) in "${campaign.name}" is ready for your sign-off.\n\nReview and approve here:\n${url}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedNudgePostId(post.id);
      window.setTimeout(
        () => setCopiedNudgePostId((cur) => (cur === post.id ? null : cur)),
        2000
      );
    } catch {
      // Ignore clipboard failures
    }
  };

  const handleQuickStatus = async (
    campaignId: string,
    postId: string,
    nextStatus: PostApprovalStatus
  ) => {
    if (busyPostId) return;
    setBusyPostId(postId);
    try {
      await onUpdatePostStatus(campaignId, postId, nextStatus);
      setSelectedIds((prev) => {
        if (!prev[postId]) return prev;
        const next = { ...prev };
        delete next[postId];
        return next;
      });
    } finally {
      setBusyPostId(null);
    }
  };

  const handleBulkStatus = async (targetStatus: PostApprovalStatus) => {
    if (selectedEntries.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    try {
      for (const [postId, meta] of selectedEntries) {
        await onUpdatePostStatus(meta.campaignId, postId, targetStatus);
      }
      setSelectedIds({});
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="space-y-6 pb-20">
      {/* 4 Stitch Priority Triage KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-[#DCE0F0] bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-[#6B6E87]">
            <span>Priority triage</span>
            <span className="inline-flex items-center gap-1 text-[#5B42DC]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#5B42DC]" aria-hidden="true" />
              Live Queue
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold tracking-tight text-[#1C1D33]">
              {metrics.inReview}
            </span>
            <span className="text-xs font-medium text-[#5B5E77]">posts waiting</span>
          </div>
          <p className="mt-1 text-xs font-bold text-[#1C1D33]">Awaiting Client Signoff</p>
          <div className="mt-3 flex items-center justify-between border-t border-[#F0F1F8] pt-2.5 text-[11px] text-[#5B5E77]">
            <span>
              {metrics.campaignsWithPending} campaign{metrics.campaignsWithPending === 1 ? '' : 's'}
            </span>
            <span className="font-semibold text-[#5B42DC]">Active batch</span>
          </div>
        </div>

        <button
          type="button"
          onClick={() =>
            setStatusFilter((cur) =>
              cur === 'changes_requested' ? 'actionable' : 'changes_requested'
            )
          }
          className={`rounded-2xl border p-5 text-left shadow-xs transition-colors cursor-pointer ${
            statusFilter === 'changes_requested'
              ? 'border-[#C94A3F] bg-[#FFF5F4]'
              : 'border-[#F2D5D2] bg-white hover:border-[#C94A3F]'
          }`}
        >
          <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-[#9B2B22]">
            <span>Action required</span>
            <span className="rounded-full bg-[#FEECEB] px-2 py-0.5 text-[10px] font-bold text-[#9B2B22]">
              Client edits
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold tracking-tight text-[#9B2B22]">
              {metrics.changesRequested}
            </span>
            <span className="text-xs font-medium text-[#5B5E77]">actionable threads</span>
          </div>
          <p className="mt-1 text-xs font-bold text-[#1C1D33]">Needs Revision</p>
          <div className="mt-3 flex items-center justify-between border-t border-[#F7E5E3] pt-2.5 text-[11px] text-[#9B2B22]">
            <span>{statusFilter === 'changes_requested' ? 'Filtered view active' : 'Client notes attached'}</span>
            <span className="font-semibold underline">
              {statusFilter === 'changes_requested' ? 'Show all' : 'Filter queue'}
            </span>
          </div>
        </button>

        <div className="rounded-2xl border border-[#DCE0F0] bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-[#6B6E87]">
            <span>Stage: Ready</span>
            <span className="rounded-full bg-[#EDF8F2] px-2 py-0.5 text-[10px] font-bold text-[#1E6F4A]">
              Signed off
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold tracking-tight text-[#1C1D33]">
              {metrics.approved}
            </span>
            <span className="text-xs font-medium text-[#5B5E77]">approved posts</span>
          </div>
          <p className="mt-1 text-xs font-bold text-[#1C1D33]">Approved Vault Ready</p>
          <div className="mt-3 flex items-center justify-between border-t border-[#F0F1F8] pt-2.5 text-[11px] text-[#5B5E77]">
            <span>Verified proofs</span>
            <span className="font-semibold text-[#1E6F4A]">Ready to publish</span>
          </div>
        </div>

        <div className="rounded-2xl border border-[#C2E3D2] bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-[#1E6F4A]">
            <span>Approval rate</span>
            <span className="rounded-full bg-[#EDF8F2] px-2 py-0.5 text-[10px] font-bold text-[#1E6F4A]">
              Live progress
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold tracking-tight text-[#1C1D33]">
              {metrics.totalPosts > 0 ? `${metrics.approvedRate}%` : '—'}
            </span>
            <span className="text-xs font-medium text-[#5B5E77]">complete</span>
          </div>
          <p className="mt-1 text-xs font-bold text-[#1C1D33]">Campaign Signoff Rate</p>
          <div className="mt-3 flex items-center justify-between border-t border-[#F0F1F8] pt-2.5 text-[11px] text-[#5B5E77]">
            <span>
              {metrics.approved} of {metrics.totalPosts} total proofs
            </span>
            <span className="font-semibold text-[#1E6F4A]">Live</span>
          </div>
        </div>
      </div>

      {/* Stitch Filter & Channel Strip */}
      <div className="flex flex-col gap-3 rounded-2xl border border-[#E2E4F0] bg-white p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            aria-label="Filter pending posts by caption or client"
            value={localFilterText}
            onChange={(e) => setLocalFilterText(e.target.value)}
            placeholder="Filter by caption, title, client…"
            className="h-9 w-full rounded-xl border border-[#DCDEEB] bg-[#FAFBFD] px-3 text-xs text-[#1C1D33] placeholder:text-[#8E91A8] focus:border-[#5B42DC] focus:bg-white focus:outline-none sm:w-64"
          />

          <select
            aria-label="Filter by campaign"
            value={campaignFilter}
            onChange={(e) => setCampaignFilter(e.target.value)}
            className="h-9 rounded-xl border border-[#DCDEEB] bg-white px-3 text-xs font-medium text-[#1C1D33] focus:border-[#5B42DC] focus:outline-none"
          >
            <option value="all">Workspace: All Active ({campaigns.length})</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.clientName} — {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1">
            {availableChannels.map((ch) => (
              <button
                key={ch}
                type="button"
                onClick={() => setChannelFilter(ch)}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold cursor-pointer ${
                  channelFilter === ch
                    ? 'bg-[#EAE6FF] text-[#4931C2]'
                    : 'bg-[#F4F5FA] text-[#5D607A] hover:text-[#1C1D33]'
                }`}
              >
                {ch}
              </button>
            ))}
          </div>

          <div className="inline-flex rounded-xl border border-[#E2E4F0] bg-[#FAFBFD] p-0.5">
            {(
              [
                ['actionable', 'All pending'],
                ['in_review', 'In review'],
                ['changes_requested', 'Revisions'],
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
        </div>
      </div>

      {/* Grouped Client / Campaign Sections matching Screenshot 2 */}
      {groupedCampaigns.length === 0 ? (
        <div className="rounded-2xl border border-[#E2E4F0] bg-white p-12 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-[#EDF8F2] text-[#1E6F4A]">
            <Clock className="h-5 w-5" aria-hidden="true" />
          </div>
          <h2 className="mt-3 text-lg font-bold text-[#1C1D33]">No pending proofs in this queue</h2>
          <p className="mt-1 text-sm text-[#5B5E77]">
            All matching posts are approved, or add a new post draft in Calendar Proofs.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {groupedCampaigns.map(({ campaign, posts }) => {
            const allGroupChecked = posts.every((p) => Boolean(selectedIds[p.id]));

            return (
              <section
                key={campaign.id}
                className="overflow-hidden rounded-2xl border border-[#E2E4F0] bg-white shadow-xs"
              >
                {/* Campaign Group Header */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#ECEDF4] bg-[#FAFBFD] px-5 py-3.5">
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => toggleCampaignGroupSelection(posts)}
                      aria-label={`Select all posts in ${campaign.name}`}
                      className="text-[#6B6E87] hover:text-[#5B42DC] cursor-pointer"
                    >
                      {allGroupChecked ? (
                        <CheckSquare className="h-4 w-4 text-[#5B42DC]" />
                      ) : (
                        <Square className="h-4 w-4" />
                      )}
                    </button>

                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#5B42DC] text-[11px] font-bold text-white">
                      {campaign.clientName.slice(0, 2).toUpperCase()}
                    </span>

                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-bold text-[#1C1D33]">{campaign.clientName}</h2>
                      <span className="text-xs text-[#B4B7CB]">/</span>
                      <span className="text-xs font-medium text-[#5B5E77]">{campaign.name}</span>
                      <span className="rounded-full border border-[#D8D3FA] bg-[#EAE6FF] px-2.5 py-0.5 text-[11px] font-semibold text-[#4931C2]">
                        {posts.length} proof{posts.length === 1 ? '' : 's'} pending
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    {!campaign.reviewLinkRevoked && (
                      <a
                        href={`/review/${campaign.activeReviewToken}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-semibold text-[#5B42DC] hover:underline"
                      >
                        Portal Details <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => onOpenCampaign(campaign.id)}
                      className="inline-flex items-center gap-1 font-semibold text-[#474A63] hover:text-[#1C1D33] cursor-pointer"
                    >
                      <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                      Open campaign
                    </button>
                  </div>
                </div>

                {/* Actionable Posts Rows */}
                <div className="divide-y divide-[#ECEDF4]">
                  {posts.map((post) => {
                    const checked = Boolean(selectedIds[post.id]);
                    const isRowBusy = busyPostId === post.id;
                    const latestComment =
                      post.comments.length > 0 ? post.comments[post.comments.length - 1] : null;

                    return (
                      <div
                        key={post.id}
                        className="flex flex-col gap-4 p-5 transition-colors hover:bg-[#FAFBFD]/70 lg:flex-row lg:items-center lg:justify-between"
                      >
                        <div className="flex min-w-0 flex-1 items-start gap-4">
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

                          <div className="min-w-0 flex-1 space-y-1.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <PostStatusBadge status={post.status} />
                              <span className="font-mono text-xs text-[#6B6E87]">
                                {post.channel} · Scheduled {post.scheduledDate}
                              </span>
                            </div>

                            <h3 className="truncate text-sm font-bold text-[#1C1D33]">
                              {post.title}
                            </h3>
                            <p className="line-clamp-2 text-xs leading-relaxed text-[#43465E]">
                              {post.caption}
                            </p>

                            {latestComment && (
                              <div className="mt-2 flex items-start gap-2 rounded-xl border border-[#EAEBF4] bg-[#F7F8FD] px-3 py-2 text-xs text-[#3B3E57]">
                                <MessageSquare
                                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#5B42DC]"
                                  aria-hidden="true"
                                />
                                <p className="min-w-0 flex-1 leading-relaxed">
                                  <strong>{latestComment.authorName} annotated:</strong>{' '}
                                  {latestComment.body}
                                </p>
                                <button
                                  type="button"
                                  onClick={() => onInspectPost(campaign, post)}
                                  className="shrink-0 font-semibold text-[#5B42DC] hover:underline cursor-pointer"
                                >
                                  Inspect &amp; reply
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Right Fast Actions matching Screenshot 2 */}
                        <div className="flex flex-wrap items-center gap-2 pl-8 lg:shrink-0 lg:pl-0">
                          {!campaign.reviewLinkRevoked && (
                            <button
                              type="button"
                              onClick={() => void handleCopyNudge(campaign, post)}
                              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#5B42DC] px-3.5 text-xs font-bold text-white shadow-xs hover:bg-[#4931C2] cursor-pointer"
                            >
                              {copiedNudgePostId === post.id ? (
                                <>
                                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                                  Copied nudge
                                </>
                              ) : (
                                <>
                                  <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                                  Magic Nudge
                                </>
                              )}
                            </button>
                          )}

                          {post.status === 'changes_requested' && (
                            <button
                              type="button"
                              disabled={isRowBusy}
                              onClick={() =>
                                void handleQuickStatus(campaign.id, post.id, 'in_review')
                              }
                              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#D8D3FA] bg-[#F6F4FF] px-3 text-xs font-semibold text-[#4931C2] hover:bg-[#EAE6FF] disabled:opacity-50 cursor-pointer"
                            >
                              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                              Re-review
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={isRowBusy}
                            onClick={() =>
                              void handleQuickStatus(campaign.id, post.id, 'approved')
                            }
                            className="inline-flex h-9 items-center gap-1 rounded-xl border border-[#DCDEEB] bg-white px-3 text-xs font-semibold text-[#1E6F4A] hover:border-[#1E6F4A] hover:bg-[#EDF8F2] disabled:opacity-50 cursor-pointer"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                            Approve
                          </button>

                          <button
                            type="button"
                            onClick={() => onInspectPost(campaign, post)}
                            aria-label={`Inspect ${post.title}`}
                            className="inline-flex h-9 items-center gap-1 rounded-xl border border-[#DCDEEB] bg-white px-3 text-xs font-semibold text-[#23253E] hover:border-[#5B42DC] hover:text-[#5B42DC] cursor-pointer"
                          >
                            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                            Inspect
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

      {/* Floating Bottom Bulk Bar matching Screenshot 2 */}
      {selectedEntries.length > 0 && (
        <div className="fixed inset-x-4 bottom-5 z-30 mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#343658] bg-[#1C1D33]/95 px-5 py-3 text-white shadow-2xl backdrop-blur-md">
          <div className="flex items-center gap-2 text-xs">
            <span className="h-2 w-2 rounded-full bg-[#3DD68C]" aria-hidden="true" />
            <span>
              Selected <strong>{selectedEntries.length}</strong> post
              {selectedEntries.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => void handleBulkStatus('approved')}
              className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-[#1E6F4A] px-3.5 text-xs font-bold text-white hover:bg-[#175739] disabled:opacity-50 cursor-pointer"
            >
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              {bulkBusy ? 'Updating…' : `Approve selected (${selectedEntries.length})`}
            </button>
            {selectedEntries.some(([, m]) => m.status === 'changes_requested') && (
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => void handleBulkStatus('in_review')}
                className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-[#5B42DC] px-3 text-xs font-bold text-white hover:bg-[#4931C2] disabled:opacity-50 cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Mark re-review ready
              </button>
            )}
            <button
              type="button"
              onClick={() => setSelectedIds({})}
              className="inline-flex h-8 items-center rounded-xl border border-white/20 px-3 text-xs font-semibold text-white/85 hover:bg-white/10 cursor-pointer"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
