import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Bookmark,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Edit3,
  ExternalLink,
  FileText,
  Heart,
  History,
  ImageOff,
  Link2,
  MessageCircle,
  MessageSquare,
  MoreHorizontal,
  RotateCcw,
  Send,
  Smartphone,
  Wifi,
} from 'lucide-react';
import type { FirebaseCampaign, FirebasePost, PostApprovalStatus } from '../lib/firestoreRepo';
import { HighlightedCaption, PostStatusBadge } from './SocialPostMockup';

export interface PostDetailReviewViewProps {
  readonly campaign: FirebaseCampaign;
  readonly posts: ReadonlyArray<FirebasePost>;
  readonly activePostId: string;
  readonly backLabel?: string;
  readonly onBack: () => void;
  readonly onSelectPost: (postId: string) => void;
  readonly onEditPost: (post: FirebasePost) => void;
  readonly onUpdatePostStatus: (
    campaignId: string,
    postId: string,
    status: PostApprovalStatus
  ) => Promise<void>;
  readonly onSubmitReply: (campaignId: string, postId: string, body: string) => Promise<void>;
}

type FramePreviewMode = 'feed' | 'stories' | 'copy';

function toHandle(clientName: string): string {
  const cleaned = clientName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 22);
  return cleaned ? `@${cleaned}` : '@brand';
}

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'PP';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

export const PostDetailReviewView: React.FC<PostDetailReviewViewProps> = ({
  campaign,
  posts,
  activePostId,
  backLabel = 'Calendar',
  onBack,
  onSelectPost,
  onEditPost,
  onUpdatePostStatus,
  onSubmitReply,
}) => {
  const [previewMode, setPreviewMode] = useState<FramePreviewMode>('feed');
  const [commentText, setCommentText] = useState('');
  const [busyAction, setBusyAction] = useState(false);
  const [copiedNudge, setCopiedNudge] = useState(false);
  const [copiedCopy, setCopiedCopy] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

  const currentIndex = posts.findIndex((p) => p.id === activePostId);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const post = posts[safeIndex];

  useEffect(() => {
    setImgFailed(false);
    setCommentText('');
  }, [activePostId, post?.imageUrl]);

  if (!post) return null;

  const hasPrev = safeIndex > 0;
  const hasNext = safeIndex < posts.length - 1;
  const handle = toHandle(campaign.clientName);

  const handleDecision = async (nextStatus: PostApprovalStatus) => {
    if (busyAction) return;
    setBusyAction(true);
    try {
      await onUpdatePostStatus(campaign.id, post.id, nextStatus);
    } finally {
      setBusyAction(false);
    }
  };

  const handleCommentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = commentText.trim();
    if (!trimmed || busyAction) return;
    setBusyAction(true);
    try {
      await onSubmitReply(campaign.id, post.id, trimmed);
      setCommentText('');
    } finally {
      setBusyAction(false);
    }
  };

  const handleCopyNudge = async () => {
    if (campaign.reviewLinkRevoked) return;
    const url = `${window.location.origin}/review/${campaign.activeReviewToken}`;
    const msg = `Hi ${campaign.clientName} team,\n\nQuick reminder: "${post.title}" (${post.channel}, ${post.scheduledDate}) in "${campaign.name}" is ready for your sign-off.\n\nReview & approve here:\n${url}`;
    try {
      await navigator.clipboard.writeText(msg);
      setCopiedNudge(true);
      window.setTimeout(() => setCopiedNudge(false), 2000);
    } catch {
      // Ignore clipboard failures
    }
  };

  const handleCopyCaption = async () => {
    try {
      await navigator.clipboard.writeText(post.caption);
      setCopiedCopy(true);
      window.setTimeout(() => setCopiedCopy(false), 2000);
    } catch {
      // Ignore clipboard failures
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Control Bar: Back Breadcrumb, Status Pill, Post Pager & Preview Mode */}
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="group inline-flex items-center gap-1 text-xs font-semibold text-[#5B42DC] hover:underline cursor-pointer"
          >
            <ArrowLeft
              className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5"
              aria-hidden="true"
            />
            {backLabel}
          </button>
          <span className="text-xs text-[#C7C4D8]">/</span>
          <span className="truncate text-xs font-medium text-[#5B5E77]">
            {campaign.clientName} · {campaign.name}
          </span>
          <span className="text-xs text-[#C7C4D8]">/</span>
          <h1 className="truncate text-base font-bold tracking-[-0.02em] text-[#1C1D33]">
            {post.scheduledDate} · {post.title}
          </h1>
          <PostStatusBadge status={post.status} />
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {/* Post Pagination */}
          <div className="inline-flex items-center rounded-xl border border-[#E2E4F0] bg-white p-1 shadow-xs">
            <button
              type="button"
              disabled={!hasPrev}
              onClick={() => hasPrev && onSelectPost(posts[safeIndex - 1].id)}
              aria-label="Previous post"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-[#474A63] hover:bg-[#F4F5FA] disabled:opacity-35 cursor-pointer"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-2.5 font-mono text-xs font-semibold text-[#1C1D33] select-none">
              Post <span className="text-[#5B42DC]">{safeIndex + 1}</span> of {posts.length}
            </span>
            <button
              type="button"
              disabled={!hasNext}
              onClick={() => hasNext && onSelectPost(posts[safeIndex + 1].id)}
              aria-label="Next post"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-[#474A63] hover:bg-[#F4F5FA] disabled:opacity-35 cursor-pointer"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Device Frame Switcher */}
          <div
            className="inline-flex items-center gap-1 rounded-xl border border-[#E2E4F0] bg-white p-1 shadow-xs"
            role="group"
            aria-label="Proof preview mode"
          >
            <button
              type="button"
              onClick={() => setPreviewMode('feed')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                previewMode === 'feed'
                  ? 'bg-[#5B42DC] text-white shadow-xs'
                  : 'text-[#555870] hover:bg-[#F4F5FA] hover:text-[#1C1D33]'
              }`}
            >
              <Smartphone className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Feed Preview</span>
            </button>
            <button
              type="button"
              onClick={() => setPreviewMode('stories')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                previewMode === 'stories'
                  ? 'bg-[#5B42DC] text-white shadow-xs'
                  : 'text-[#555870] hover:bg-[#F4F5FA] hover:text-[#1C1D33]'
              }`}
            >
              <Smartphone className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Stories</span>
            </button>
            <button
              type="button"
              onClick={() => setPreviewMode('copy')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                previewMode === 'copy'
                  ? 'bg-[#5B42DC] text-white shadow-xs'
                  : 'text-[#555870] hover:bg-[#F4F5FA] hover:text-[#1C1D33]'
              }`}
            >
              <FileText className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Copy Only</span>
            </button>
          </div>
        </div>
      </div>

      {/* Primary Split Stage: 60% Left Preview Device (7 cols) & 40% Right Decision/Feedback Rail (5 cols) */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
        {/* LEFT COLUMN: Realistic Social Viewport & Phone Hardware Frame */}
        <section className="flex flex-col items-center lg:col-span-7">
          <div className="relative flex w-full flex-col items-center justify-center overflow-hidden rounded-3xl border border-[#E2E4F0] bg-[#F2F3FF] p-5 sm:p-10">
            <div className="pointer-events-none absolute -top-24 -left-24 h-80 w-80 rounded-full bg-[#C3C0FF]/25 blur-3xl" />
            <div className="pointer-events-none absolute -right-24 -bottom-24 h-80 w-80 rounded-full bg-[#89CEFF]/20 blur-3xl" />

            {previewMode === 'copy' ? (
              <div className="relative z-10 w-full max-w-[520px] rounded-2xl border border-[#DCE0F0] bg-white p-6 shadow-sm">
                <div className="flex items-center justify-between border-b border-[#ECEDF4] pb-3">
                  <span className="text-xs font-bold text-[#5B42DC]">
                    {post.channel} · Editorial Copy Proof
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleCopyCaption()}
                    className="inline-flex items-center gap-1 rounded-lg bg-[#F4F5FA] px-2.5 py-1 text-xs font-semibold text-[#23253E] hover:bg-[#EAE6FF] hover:text-[#4931C2] cursor-pointer"
                  >
                    {copiedCopy ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-[#1E6F4A]" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        Copy text
                      </>
                    )}
                  </button>
                </div>
                <h2 className="mt-4 text-lg font-bold text-[#1C1D33]">{post.title}</h2>
                <p className="mt-3 whitespace-pre-wrap text-[15px] leading-[1.75] text-[#2F324B]">
                  <HighlightedCaption caption={post.caption} />
                </p>
                <div className="mt-5 flex items-center justify-between border-t border-[#ECEDF4] pt-3 font-mono text-[11px] text-[#7D8099]">
                  <span>{post.caption.length} characters</span>
                  <span>
                    {handle} · {post.scheduledDate}
                  </span>
                </div>
              </div>
            ) : (
              <div className="relative z-10 w-full max-w-[400px] rounded-[44px] bg-[#283044] p-3 shadow-2xl">
                <div className="relative flex w-full flex-col overflow-hidden rounded-[36px] bg-white">
                  <div className="flex h-8 w-full shrink-0 items-center justify-between px-6 pt-2 text-[11px] font-semibold text-[#1C1D33]">
                    <span>9:41</span>
                    <div className="flex h-4 w-24 items-center justify-end rounded-full bg-[#1C1D33] px-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-white/30" />
                    </div>
                    <div className="flex items-center gap-1 text-[#1C1D33]">
                      <Wifi className="h-3 w-3" aria-hidden="true" />
                      <span className="font-mono text-[10px]">5G</span>
                    </div>
                  </div>

                  {previewMode === 'stories' ? (
                    <div className="flex flex-col bg-[#1C1D33] p-3 text-white">
                      <div className="mb-2 grid grid-cols-3 gap-1 px-1">
                        <span className="h-0.5 rounded-full bg-white" />
                        <span className="h-0.5 rounded-full bg-white/35" />
                        <span className="h-0.5 rounded-full bg-white/35" />
                      </div>
                      <div className="mb-2.5 flex items-center justify-between px-1">
                        <div className="flex items-center gap-2">
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#5B42DC] text-[10px] font-bold">
                            {getInitials(campaign.clientName)}
                          </span>
                          <span className="text-xs font-semibold">{handle}</span>
                        </div>
                        <span className="font-mono text-[10px] text-white/70">{post.channel}</span>
                      </div>
                      <div className="relative flex aspect-[9/14] w-full items-center justify-center overflow-hidden rounded-2xl bg-black/40">
                        {imgFailed || !post.imageUrl ? (
                          <div className="flex flex-col items-center text-white/60">
                            <ImageOff className="h-6 w-6" />
                            <span className="mt-1 text-xs">No image</span>
                          </div>
                        ) : (
                          <img
                            src={post.imageUrl}
                            alt={post.title}
                            referrerPolicy="no-referrer"
                            onError={() => setImgFailed(true)}
                            className="h-full w-full object-contain"
                          />
                        )}
                      </div>
                      <div className="mt-3 rounded-xl bg-white/10 p-3 text-xs leading-relaxed text-white/95 backdrop-blur-sm">
                        <p className="line-clamp-3">{post.caption}</p>
                      </div>
                      <div className="mt-3 flex justify-center">
                        <div className="h-1 w-24 rounded-full bg-white/30" />
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex h-11 shrink-0 items-center justify-between border-b border-[#F2F3FA] px-4">
                        <span className="text-sm font-bold tracking-tight text-[#1C1D33]">
                          {post.channel}
                        </span>
                        <div className="flex items-center gap-3 text-[#1C1D33]">
                          <Heart className="h-4 w-4" aria-hidden="true" />
                          <Send className="h-4 w-4" aria-hidden="true" />
                        </div>
                      </div>

                      <div className="flex items-center justify-between px-3.5 py-2.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="rounded-full bg-gradient-to-tr from-[#39B8FD] via-[#5B42DC] to-[#4F46E5] p-0.5">
                            <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-[#EAE6FF] text-xs font-bold text-[#3525CD]">
                              {getInitials(campaign.clientName)}
                            </div>
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1">
                              <span className="truncate text-xs font-semibold text-[#1C1D33]">
                                {handle}
                              </span>
                              <CheckCircle2
                                className="h-3.5 w-3.5 shrink-0 text-[#5B42DC]"
                                aria-hidden="true"
                              />
                            </div>
                            <p className="truncate text-[10px] text-[#6B6E87]">
                              {campaign.name} · Scheduled {post.scheduledDate}
                            </p>
                          </div>
                        </div>
                        <MoreHorizontal className="h-4 w-4 shrink-0 text-[#6B6E87]" />
                      </div>

                      <div className="relative flex aspect-[4/5] w-full items-center justify-center overflow-hidden bg-[#F4F5FA]">
                        {imgFailed || !post.imageUrl ? (
                          <div className="flex flex-col items-center text-[#7D8099]">
                            <ImageOff className="h-6 w-6" aria-hidden="true" />
                            <span className="mt-1.5 text-xs">Preview image unavailable</span>
                          </div>
                        ) : (
                          <img
                            src={post.imageUrl}
                            alt={post.title}
                            referrerPolicy="no-referrer"
                            onError={() => setImgFailed(true)}
                            className="h-full w-full object-contain"
                          />
                        )}
                      </div>

                      <div className="flex items-center justify-between px-3.5 pt-2.5 text-[#1C1D33]">
                        <div className="flex items-center gap-3.5">
                          <Heart className="h-5 w-5" aria-hidden="true" />
                          <MessageCircle className="h-5 w-5" aria-hidden="true" />
                          <Send className="h-5 w-5" aria-hidden="true" />
                        </div>
                        <Bookmark className="h-5 w-5" aria-hidden="true" />
                      </div>

                      <div className="space-y-1 px-3.5 py-2.5 text-xs leading-5 text-[#1C1D33]">
                        <p className="whitespace-pre-wrap line-clamp-5">
                          <span className="mr-1.5 font-bold">{handle}</span>
                          <HighlightedCaption caption={post.caption} />
                        </p>
                        <p className="pt-1 font-mono text-[10px] uppercase tracking-wide text-[#6B6E87]">
                          Scheduled · {post.scheduledDate}
                        </p>
                      </div>

                      <div className="flex h-6 w-full shrink-0 items-center justify-center">
                        <div className="h-1 w-28 rounded-full bg-[#1C1D33]/20" />
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            <div className="relative z-10 mt-5 flex flex-wrap items-center justify-center gap-5 font-mono text-[11px] text-[#5B5E77]">
              <span className="inline-flex items-center gap-1.5">
                <Smartphone className="h-3.5 w-3.5 text-[#5B42DC]" aria-hidden="true" />
                Device Render: iPhone 15 Pro (393 × 852 px)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-[#5B42DC]" aria-hidden="true" />
                Channel: {post.channel}
              </span>
            </div>
          </div>
        </section>

        {/* RIGHT COLUMN: Sign-Off Status, Specs, Feedback Thread & Audit Trail */}
        <section className="flex flex-col gap-4 lg:col-span-5">
          <div className="flex flex-col gap-4 rounded-2xl border border-[#E2E4F0] bg-white p-5 shadow-xs">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#6B6E87]">
                  Client Sign-Off Status
                </span>
                <h2 className="mt-0.5 truncate text-base font-bold text-[#1C1D33]">
                  {campaign.name}
                </h2>
              </div>
              <span className="rounded-full bg-[#F2F3FA] px-2.5 py-1 font-mono text-[11px] font-semibold text-[#1C1D33] shrink-0">
                {campaign.reviewLinkRevoked ? 'Link revoked' : 'Portal live'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={busyAction}
                onClick={() => void handleDecision('approved')}
                className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl text-xs font-bold transition-all cursor-pointer disabled:opacity-50 ${
                  post.status === 'approved'
                    ? 'bg-[#006E4B] text-white shadow-sm'
                    : 'bg-[#1E6F4A] text-white hover:bg-[#005338] shadow-xs'
                }`}
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                {post.status === 'approved' ? 'Approved' : 'Approve Post'}
              </button>

              <button
                type="button"
                disabled={busyAction}
                onClick={() => void handleDecision('changes_requested')}
                className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl text-xs font-bold transition-all cursor-pointer disabled:opacity-50 ${
                  post.status === 'changes_requested'
                    ? 'bg-[#9A5B0A] text-white shadow-xs'
                    : 'border border-[#DCE0F0] bg-[#EEF0FA] text-[#1C1D33] hover:bg-[#E2E7FF]'
                }`}
              >
                <MessageSquare className="h-4 w-4 text-[#5B42DC]" aria-hidden="true" />
                {post.status === 'changes_requested' ? 'Changes Flagged' : 'Request Changes'}
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#ECEDF4] pt-3 text-xs">
              {post.status !== 'in_review' ? (
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={() => void handleDecision('in_review')}
                  className="inline-flex items-center gap-1 font-semibold text-[#5B42DC] hover:underline cursor-pointer"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  Reset to awaiting review
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onEditPost(post)}
                  className="inline-flex items-center gap-1 font-semibold text-[#5B42DC] hover:underline cursor-pointer"
                >
                  <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                  Edit post &amp; copy
                </button>
              )}

              {!campaign.reviewLinkRevoked && (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void handleCopyNudge()}
                    className="inline-flex items-center gap-1 font-semibold text-[#5B42DC] hover:underline cursor-pointer"
                  >
                    {copiedNudge ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-[#1E6F4A]" />
                        Copied nudge
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        Copy nudge
                      </>
                    )}
                  </button>
                  <a
                    href={`/review/${campaign.activeReviewToken}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-semibold text-[#23253E] hover:text-[#5B42DC]"
                  >
                    Portal <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* Technical Specifications */}
          <div className="rounded-2xl border border-[#E2E4F0] bg-white p-5 shadow-xs">
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#6B6E87]">
              Technical Specifications
            </span>
            <div className="mt-3 grid grid-cols-2 gap-2.5 text-xs">
              <div className="rounded-xl bg-[#F4F5FE] p-3">
                <span className="block text-[11px] text-[#6B6E87]">Platform</span>
                <span className="mt-0.5 block font-bold text-[#1C1D33]">{post.channel}</span>
              </div>
              <div className="rounded-xl bg-[#F4F5FE] p-3">
                <span className="block text-[11px] text-[#6B6E87]">Preview Format</span>
                <span className="mt-0.5 block font-bold text-[#1C1D33]">
                  {previewMode === 'stories' ? '9:16 Vertical' : '4:5 Portrait'}
                </span>
              </div>
              <div className="rounded-xl bg-[#F4F5FE] p-3">
                <span className="block text-[11px] text-[#6B6E87]">Target Schedule</span>
                <span className="mt-0.5 block font-mono font-bold text-[#1C1D33]">
                  {post.scheduledDate}
                </span>
              </div>
              <div className="rounded-xl bg-[#F4F5FE] p-3">
                <span className="block text-[11px] text-[#6B6E87]">Attached Visual</span>
                <span className="mt-0.5 block font-bold text-[#1C1D33]">
                  {post.imageId ? 'Campaign Upload' : 'Proof Image'}
                </span>
              </div>
            </div>
          </div>

          {/* Feedback & Threaded Discussion */}
          <div className="flex flex-col rounded-2xl border border-[#E2E4F0] bg-white p-5 shadow-xs">
            <div className="flex items-center justify-between border-b border-[#ECEDF4] pb-3">
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#E2DFFF] px-2.5 py-1 text-xs font-bold text-[#3323CC]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#5B42DC]" aria-hidden="true" />
                Feedback ({post.comments.length})
              </span>
              <button
                type="button"
                onClick={() => onEditPost(post)}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#5B42DC] hover:underline cursor-pointer"
              >
                <Edit3 className="h-3 w-3" aria-hidden="true" />
                Edit post
              </button>
            </div>

            <div className="mt-3 max-h-56 space-y-2.5 overflow-y-auto">
              {post.comments.length === 0 ? (
                <p className="rounded-xl border border-dashed border-[#DCE0F0] bg-[#FAFBFD] px-3 py-5 text-center text-xs text-[#7D8099]">
                  No feedback comments yet. Add a note for your team or client below.
                </p>
              ) : (
                post.comments.map((c) => (
                  <div
                    key={c.id}
                    className={`rounded-xl p-3 text-xs ${
                      c.authorRole === 'creator' ? 'ml-4 bg-[#E2DFFF]/40' : 'bg-[#F2F3FF]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#5B42DC] text-[10px] font-bold text-white">
                          {getInitials(c.authorName)}
                        </span>
                        <span className="truncate font-bold text-[#1C1D33]">{c.authorName}</span>
                        <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-bold uppercase text-[#5B42DC]">
                          {c.authorRole}
                        </span>
                      </div>
                      <span className="font-mono text-[10px] text-[#6B6E87] shrink-0">
                        {new Date(c.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="mt-1.5 pl-8 leading-relaxed text-[#2F324B]">{c.body}</p>
                  </div>
                ))
              )}
            </div>

            <form onSubmit={(e) => void handleCommentSubmit(e)} className="mt-3 space-y-2">
              <label htmlFor="detail-comment-composer" className="sr-only">
                Add feedback or reply to client revisions
              </label>
              <textarea
                id="detail-comment-composer"
                rows={3}
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Add specific feedback or reply to client revisions…"
                className="w-full resize-none rounded-xl border border-[#E2E4F0] bg-[#F2F3FF] p-3 text-xs text-[#1C1D33] placeholder:text-[#7D8099] focus:border-[#5B42DC] focus:bg-white focus:outline-none"
              />
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-[#7D8099]">
                  Visible in live client review link
                </span>
                <button
                  type="submit"
                  disabled={busyAction || !commentText.trim()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-[#5B42DC] px-3.5 text-xs font-semibold text-white hover:bg-[#4931C2] disabled:opacity-50 cursor-pointer"
                >
                  <span>Post Comment</span>
                  <Send className="h-3 w-3" aria-hidden="true" />
                </button>
              </div>
            </form>
          </div>

          {/* Proof Audit Trail */}
          <div className="rounded-2xl border border-[#E2E4F0] bg-white p-5 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-[#6B6E87]">
                <History className="h-3.5 w-3.5 text-[#5B42DC]" aria-hidden="true" />
                Proof Audit Trail
              </span>
              <span className="text-[11px] font-semibold text-[#5B42DC]">Live Sync</span>
            </div>

            <div className="relative mt-3 space-y-3 pl-1 before:absolute before:top-2 before:bottom-2 before:left-2.5 before:w-0.5 before:bg-[#DFE3F7]">
              <div className="relative flex items-start gap-3">
                <span className="z-10 mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#5B42DC] text-white">
                  <Edit3 className="h-2.5 w-2.5" aria-hidden="true" />
                </span>
                <div className="text-xs">
                  <p className="font-semibold text-[#1C1D33]">Draft created &amp; staged</p>
                  <p className="font-mono text-[11px] text-[#6B6E87]">
                    {new Date(post.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>

              <div className="relative flex items-start gap-3">
                <span className="z-10 mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#39B8FD] text-white">
                  <Link2 className="h-2.5 w-2.5" aria-hidden="true" />
                </span>
                <div className="text-xs">
                  <p className="font-semibold text-[#1C1D33]">Client Portal Token</p>
                  <p className="text-[11px] text-[#6B6E87]">
                    {campaign.reviewLinkRevoked
                      ? 'Revoked — regenerate link to share'
                      : 'Active tokenized review link enabled'}
                  </p>
                </div>
              </div>

              <div className="relative flex items-start gap-3">
                <span className="z-10 mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#1E6F4A] text-white">
                  <Check className="h-2.5 w-2.5" aria-hidden="true" />
                </span>
                <div className="text-xs">
                  <p className="font-semibold text-[#1C1D33]">Latest Proof State</p>
                  <p className="font-mono text-[11px] text-[#6B6E87]">
                    Updated {new Date(post.updatedAt).toLocaleString()}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
