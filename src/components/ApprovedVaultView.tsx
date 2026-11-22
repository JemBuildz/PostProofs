import React, { useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  Eye,
  FileSpreadsheet,
  FolderOpen,
  ShieldCheck,
} from 'lucide-react';
import type { FirebaseCampaign, FirebasePost } from '../lib/firestoreRepo';
import { PostStatusBadge, ProofImage } from './SocialPostMockup';

export interface ApprovedVaultViewProps {
  readonly campaigns: ReadonlyArray<FirebaseCampaign>;
  readonly postsByCampaignId: Readonly<Record<string, FirebasePost[]>>;
  readonly searchQuery: string;
  readonly onOpenCampaign: (campaignId: string) => void;
  readonly onInspectPost: (campaign: FirebaseCampaign, post: FirebasePost) => void;
}

export const ApprovedVaultView: React.FC<ApprovedVaultViewProps> = ({
  campaigns,
  postsByCampaignId,
  searchQuery,
  onOpenCampaign,
  onInspectPost,
}) => {
  const [channelFilter, setChannelFilter] = useState('All');
  const [campaignFilter, setCampaignFilter] = useState('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const approvedItems = useMemo(() => {
    const out: Array<{ campaign: FirebaseCampaign; post: FirebasePost }> = [];
    for (const cmp of campaigns) {
      for (const post of postsByCampaignId[cmp.id] ?? []) {
        if (post.status === 'approved') {
          out.push({ campaign: cmp, post });
        }
      }
    }
    return out;
  }, [campaigns, postsByCampaignId]);

  const channels = useMemo(() => {
    const set = new Set<string>();
    for (const item of approvedItems) set.add(item.post.channel);
    return ['All', ...Array.from(set)];
  }, [approvedItems]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return approvedItems.filter(({ campaign, post }) => {
      if (campaignFilter !== 'all' && campaign.id !== campaignFilter) return false;
      if (channelFilter !== 'All' && post.channel !== channelFilter) return false;
      if (!q) return true;
      return (
        post.title.toLowerCase().includes(q) ||
        post.caption.toLowerCase().includes(q) ||
        campaign.name.toLowerCase().includes(q) ||
        campaign.clientName.toLowerCase().includes(q)
      );
    });
  }, [approvedItems, campaignFilter, channelFilter, searchQuery]);

  const handleCopyCaption = async (post: FirebasePost) => {
    try {
      await navigator.clipboard.writeText(post.caption);
      setCopiedId(post.id);
      window.setTimeout(() => setCopiedId((cur) => (cur === post.id ? null : cur)), 2000);
    } catch {
      // Ignore clipboard failures
    }
  };

  const handleExportAuditCsv = () => {
    const csvEscape = (value: string) => {
      const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const header = [
      'Client',
      'Campaign',
      'Post Title',
      'Channel',
      'Scheduled Date',
      'Status',
      'Last Updated',
      'Portal Token State',
      'Caption',
    ];
    const rows = filtered.map(({ campaign, post }) =>
      [
        campaign.clientName,
        campaign.name,
        post.title,
        post.channel,
        post.scheduledDate,
        post.status,
        post.updatedAt,
        campaign.reviewLinkRevoked ? 'Revoked' : 'Active',
        post.caption,
      ]
        .map(csvEscape)
        .join(',')
    );
    const csv = [header.map(csvEscape).join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `postproofs-approved-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-[#1E6F4A]">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Proof Vault · Client Signoff Archive</span>
          </div>
          <h1 className="mt-1 text-3xl font-bold tracking-[-0.03em] text-[#1C1D33]">
            Approved Vault
          </h1>
          <p className="mt-1 text-sm text-[#5B5E77]">
            {approvedItems.length} client-approved social proof{approvedItems.length === 1 ? '' : 's'}{' '}
            ready for copy &amp; publishing.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="inline-flex items-center gap-2 rounded-2xl border border-[#C2E3D2] bg-[#EDF8F2] px-4 py-2 text-xs font-semibold text-[#1E6F4A]">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            {approvedItems.length} approved
          </div>
          {filtered.length > 0 && (
            <button
              type="button"
              onClick={handleExportAuditCsv}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#DCDEEB] bg-white px-3.5 text-xs font-semibold text-[#23253E] hover:border-[#5B42DC] hover:text-[#5B42DC] cursor-pointer"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-[#1E6F4A]" aria-hidden="true" />
              Export Audit CSV
            </button>
          )}
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#E2E4F0] bg-white p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {channels.map((ch) => (
            <button
              key={ch}
              type="button"
              onClick={() => setChannelFilter(ch)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                channelFilter === ch
                  ? 'bg-[#5B42DC] text-white'
                  : 'bg-[#F4F5FA] text-[#555870] hover:text-[#1C1D33]'
              }`}
            >
              {ch}
            </button>
          ))}
        </div>

        <select
          aria-label="Filter approved posts by campaign"
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

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-[#E2E4F0] bg-white p-12 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-[#EDF8F2] text-[#1E6F4A]">
            <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
          </div>
          <h2 className="mt-3 text-lg font-bold text-[#1C1D33]">No approved posts here yet</h2>
          <p className="mt-1 text-sm text-[#5B5E77]">
            Once a client approves posts in their private review portal, they collect automatically
            here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map(({ campaign, post }) => (
            <article
              key={post.id}
              className="flex flex-col justify-between rounded-2xl border border-[#E2E4F0] bg-white p-4"
            >
              <div>
                <div className="flex items-center justify-between gap-2 pb-3">
                  <span className="truncate text-xs font-semibold text-[#5B42DC]">
                    {campaign.clientName} · {campaign.name}
                  </span>
                  <PostStatusBadge status={post.status} />
                </div>

                <ProofImage src={post.imageUrl} alt={post.title} aspectClass="aspect-[4/3]" />

                <div className="mt-3 flex items-center justify-between font-mono text-[11px] text-[#6B6E87]">
                  <span>{post.channel}</span>
                  <span>{post.scheduledDate}</span>
                </div>

                <h3 className="mt-1.5 text-sm font-bold text-[#1C1D33]">{post.title}</h3>
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[#474A63]">
                  {post.caption}
                </p>

                {/* Stitch Section 6 Signoff Seal Block */}
                <div className="mt-3 space-y-1 rounded-xl border border-[#C2E3D2] bg-[#EDF8F2]/65 p-3 text-[11px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-[#474A63]">Signoff status:</span>
                    <span className="font-bold text-[#1E6F4A]">Approved</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-[#474A63]">Portal method:</span>
                    <span className="font-semibold text-[#1C1D33]">
                      {campaign.reviewLinkRevoked ? 'Link revoked' : 'Magic Review Link'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t border-[#C2E3D2]/60 pt-1 text-[10px] text-[#5B5E77]">
                    <span>Updated:</span>
                    <span className="font-mono">{new Date(post.updatedAt).toLocaleString()}</span>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#ECEDF4] pt-3">
                <button
                  type="button"
                  onClick={() => void handleCopyCaption(post)}
                  className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-lg border border-[#DCDEEB] bg-white px-2.5 text-xs font-semibold text-[#23253E] hover:border-[#5B42DC] hover:text-[#5B42DC] cursor-pointer"
                >
                  {copiedId === post.id ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-[#1E6F4A]" />
                      Copied copy
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      Copy caption
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => onInspectPost(campaign, post)}
                  className="inline-flex h-8 items-center gap-1 rounded-lg bg-[#EAE6FF] px-2.5 text-xs font-semibold text-[#4931C2] hover:bg-[#DDD5FF] cursor-pointer"
                >
                  <Eye className="h-3.5 w-3.5" />
                  Inspect
                </button>
                <button
                  type="button"
                  onClick={() => onOpenCampaign(campaign.id)}
                  aria-label={`Open ${campaign.name}`}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#DCDEEB] bg-white text-[#555870] hover:border-[#5B42DC] hover:text-[#5B42DC] cursor-pointer"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
};
