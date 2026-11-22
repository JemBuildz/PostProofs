import React, { useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  FolderOpen,
  Link2,
  Link2Off,
  Plus,
  RefreshCw,
} from 'lucide-react';
import type { FirebaseCampaign, FirebasePost } from '../lib/firestoreRepo';

export interface ClientPortalsViewProps {
  readonly campaigns: ReadonlyArray<FirebaseCampaign>;
  readonly postsByCampaignId: Readonly<Record<string, FirebasePost[]>>;
  readonly onOpenCampaign: (campaignId: string) => void;
  readonly onCreateCampaign: () => void;
  readonly onRevokeLink: (campaignId: string) => Promise<void>;
  readonly onRotateLink: (campaignId: string) => Promise<void>;
}

export const ClientPortalsView: React.FC<ClientPortalsViewProps> = ({
  campaigns,
  postsByCampaignId,
  onOpenCampaign,
  onCreateCampaign,
  onRevokeLink,
  onRotateLink,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    campaignId: string;
    type: 'revoke' | 'rotate';
  } | null>(null);
  const [busyCampaignId, setBusyCampaignId] = useState<string | null>(null);

  const handleCopy = async (cmp: FirebaseCampaign) => {
    const url = `${window.location.origin}/review/${cmp.activeReviewToken}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(cmp.id);
      window.setTimeout(() => setCopiedId((cur) => (cur === cmp.id ? null : cur)), 2000);
    } catch {
      // Ignore clipboard failures
    }
  };

  const executeLinkAction = async (campaignId: string, type: 'revoke' | 'rotate') => {
    setBusyCampaignId(campaignId);
    try {
      if (type === 'revoke') {
        await onRevokeLink(campaignId);
      } else {
        await onRotateLink(campaignId);
      }
      setConfirmAction(null);
    } finally {
      setBusyCampaignId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-[#5B42DC]">Shareable review links</p>
          <h1 className="mt-1 text-3xl font-bold tracking-[-0.03em] text-[#1C1D33]">
            Client Portals
          </h1>
          <p className="mt-1 text-sm text-[#5B5E77]">
            Manage private tokenized links for every brand campaign. Clients sign off without a login.
          </p>
        </div>

        <button
          type="button"
          onClick={onCreateCampaign}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#5B42DC] px-4 text-xs font-semibold text-white hover:bg-[#4931C2] cursor-pointer"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New client campaign
        </button>
      </div>

      {campaigns.length === 0 ? (
        <div className="rounded-2xl border border-[#E2E4F0] bg-white p-12 text-center">
          <h2 className="text-lg font-bold text-[#1C1D33]">No client portals yet</h2>
          <p className="mt-1 text-sm text-[#5B5E77]">
            Create your first campaign to generate an active private client portal link.
          </p>
          <button
            type="button"
            onClick={onCreateCampaign}
            className="mt-5 inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#5B42DC] px-4 text-xs font-semibold text-white hover:bg-[#4931C2] cursor-pointer"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Create campaign
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {campaigns.map((cmp) => {
            const list = postsByCampaignId[cmp.id] ?? [];
            const approved = list.filter((p) => p.status === 'approved').length;
            const pending = list.filter((p) => p.status === 'in_review').length;
            const changes = list.filter((p) => p.status === 'changes_requested').length;
            const pct = list.length > 0 ? Math.round((approved / list.length) * 100) : 0;
            const isConfirming = confirmAction?.campaignId === cmp.id;
            const isBusy = busyCampaignId === cmp.id;

            return (
              <section
                key={cmp.id}
                className="flex flex-col justify-between rounded-2xl border border-[#E2E4F0] bg-white p-6"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EAE6FF] text-xs font-bold text-[#4931C2]">
                        {cmp.clientName.slice(0, 2).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-[#5B42DC]">
                          {cmp.clientName}
                        </p>
                        <h2 className="truncate text-lg font-bold text-[#1C1D33]">{cmp.name}</h2>
                      </div>
                    </div>

                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold shrink-0 ${
                        cmp.reviewLinkRevoked
                          ? 'bg-[#FEF4E6] text-[#9A5B0A]'
                          : 'bg-[#EDF8F2] text-[#1E6F4A]'
                      }`}
                    >
                      {cmp.reviewLinkRevoked ? (
                        <>
                          <Link2Off className="h-3.5 w-3.5" aria-hidden="true" />
                          Revoked
                        </>
                      ) : (
                        <>
                          <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                          Live portal
                        </>
                      )}
                    </span>
                  </div>

                  {/* Progress strip */}
                  <div className="mt-5 rounded-xl border border-[#ECEDF4] bg-[#FAFBFD] p-3.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-[#1C1D33]">
                        {approved} of {list.length} posts approved ({pct}%)
                      </span>
                      <span className="font-mono text-[11px] text-[#6B6E87]">
                        {pending} pending · {changes} revision{changes === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[#E5E6F0]">
                      <div
                        className="h-full rounded-full bg-[#1E6F4A]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>

                  {/* Link Box */}
                  <div className="mt-4">
                    <code className="block w-full truncate rounded-xl border border-[#E5E6F0] bg-[#FAFBFD] px-3 py-2.5 font-mono text-xs text-[#43465E]">
                      {cmp.reviewLinkRevoked
                        ? 'Link revoked — generate a new link to re-open access'
                        : `${window.location.origin}/review/${cmp.activeReviewToken}`}
                    </code>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-[#ECEDF4] pt-4">
                  <div className="flex flex-wrap items-center gap-2">
                    {!cmp.reviewLinkRevoked && (
                      <>
                        <button
                          type="button"
                          onClick={() => void handleCopy(cmp)}
                          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#DCDEEB] bg-white px-3 text-xs font-semibold text-[#23253E] hover:border-[#5B42DC] hover:text-[#5B42DC] cursor-pointer"
                        >
                          {copiedId === cmp.id ? (
                            <>
                              <Check className="h-3.5 w-3.5 text-[#1E6F4A]" />
                              Copied
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5" />
                              Copy URL
                            </>
                          )}
                        </button>
                        <a
                          href={`/review/${cmp.activeReviewToken}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#5B42DC] px-3.5 text-xs font-semibold text-white hover:bg-[#4931C2]"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Open portal
                        </a>
                      </>
                    )}

                    <button
                      type="button"
                      onClick={() => onOpenCampaign(cmp.id)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#DCDEEB] bg-white px-3 text-xs font-semibold text-[#474A63] hover:border-[#5B42DC] hover:text-[#5B42DC] cursor-pointer"
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                      Campaign grid
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {isConfirming ? (
                      <>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void executeLinkAction(cmp.id, confirmAction.type)}
                          className={`inline-flex h-8 items-center rounded-lg px-2.5 text-xs font-semibold text-white disabled:opacity-50 cursor-pointer ${
                            confirmAction.type === 'revoke'
                              ? 'bg-[#9B2B22] hover:bg-[#7F221B]'
                              : 'bg-[#5B42DC] hover:bg-[#4931C2]'
                          }`}
                        >
                          {confirmAction.type === 'revoke' ? 'Confirm revoke' : 'Confirm rotate'}
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => setConfirmAction(null)}
                          className="inline-flex h-8 items-center rounded-lg border border-[#DCDEEB] bg-white px-2.5 text-xs font-semibold text-[#474A63] cursor-pointer"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        {!cmp.reviewLinkRevoked && (
                          <button
                            type="button"
                            onClick={() => setConfirmAction({ campaignId: cmp.id, type: 'revoke' })}
                            className="inline-flex h-8 items-center rounded-lg border border-[#EED2CE] bg-white px-2.5 text-xs font-semibold text-[#9B2B22] hover:bg-[#FDF4F3] cursor-pointer"
                          >
                            Revoke
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setConfirmAction({ campaignId: cmp.id, type: 'rotate' })}
                          className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#DCDEEB] bg-white px-2.5 text-xs font-semibold text-[#474A63] hover:border-[#5B42DC] hover:text-[#5B42DC] cursor-pointer"
                        >
                          <RefreshCw className="h-3 w-3" aria-hidden="true" />
                          {cmp.reviewLinkRevoked ? 'Generate new link' : 'Rotate link'}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
};
