import React, { useEffect, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  History,
  MessageSquare,
  Monitor,
  Pencil,
  RotateCcw,
  Send,
  Smartphone,
  X,
} from 'lucide-react';
import type { FirebaseCampaign, FirebasePost } from '../lib/firestoreRepo';
import { PostStatusBadge, SocialPostMockup } from './SocialPostMockup';
import type { PreviewFrameMode } from './SocialPostMockup';

export interface PostProofDetailModalProps {
  readonly campaign: FirebaseCampaign;
  readonly posts: ReadonlyArray<FirebasePost>;
  readonly activePostId: string;
  readonly onSelectPost: (postId: string) => void;
  readonly onClose: () => void;
  readonly onEditPost: (post: FirebasePost) => void;
  readonly onResetToInReview: (campaignId: string, postId: string) => Promise<void>;
  readonly onSubmitReply: (campaignId: string, postId: string, body: string) => Promise<void>;
}

export const PostProofDetailModal: React.FC<PostProofDetailModalProps> = ({
  campaign,
  posts,
  activePostId,
  onSelectPost,
  onClose,
  onEditPost,
  onResetToInReview,
  onSubmitReply,
}) => {
  const [previewMode, setPreviewMode] = useState<PreviewFrameMode>('phone');
  const [replyText, setReplyText] = useState('');
  const [busyAction, setBusyAction] = useState(false);

  const currentIndex = posts.findIndex((p) => p.id === activePostId);
  const post = currentIndex >= 0 ? posts[currentIndex] : posts[0];

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    setReplyText('');
  }, [activePostId]);

  if (!post) return null;

  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < posts.length - 1;

  const handleReplySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = replyText.trim();
    if (!trimmed || busyAction) return;
    setBusyAction(true);
    try {
      await onSubmitReply(campaign.id, post.id, trimmed);
      setReplyText('');
    } finally {
      setBusyAction(false);
    }
  };

  const handleReset = async () => {
    if (busyAction) return;
    setBusyAction(true);
    try {
      await onResetToInReview(campaign.id, post.id);
    } finally {
      setBusyAction(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1C1D33]/45 p-3 backdrop-blur-[2px] sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="proof-inspector-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-[1180px] flex-col overflow-hidden rounded-3xl border border-[#DCE0F0] bg-[#FAFBFD] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Inspector Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E5E6F0] bg-white px-5 py-4">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-[#5B42DC]">
              {campaign.clientName} · {campaign.name}
            </p>
            <div className="mt-0.5 flex flex-wrap items-center gap-2.5">
              <h2
                id="proof-inspector-title"
                className="truncate text-lg font-bold tracking-[-0.02em] text-[#1C1D33]"
              >
                {post.title}
              </h2>
              <PostStatusBadge status={post.status} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Prev / Next post pager */}
            <div className="inline-flex items-center rounded-xl border border-[#E2E4F0] bg-[#FAFBFD] p-0.5">
              <button
                type="button"
                disabled={!hasPrev}
                onClick={() => hasPrev && onSelectPost(posts[currentIndex - 1].id)}
                aria-label="Previous post"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#474A63] hover:bg-white hover:text-[#1C1D33] disabled:opacity-35 cursor-pointer"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="px-2.5 font-mono text-xs tabular-nums text-[#555870]">
                Post {currentIndex + 1} of {posts.length}
              </span>
              <button
                type="button"
                disabled={!hasNext}
                onClick={() => hasNext && onSelectPost(posts[currentIndex + 1].id)}
                aria-label="Next post"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#474A63] hover:bg-white hover:text-[#1C1D33] disabled:opacity-35 cursor-pointer"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            {/* Device Preview Mode Switch */}
            <div
              className="inline-flex rounded-xl border border-[#E2E4F0] bg-[#FAFBFD] p-0.5"
              role="group"
              aria-label="Proof preview mode"
            >
              <button
                type="button"
                onClick={() => setPreviewMode('phone')}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold cursor-pointer ${
                  previewMode === 'phone'
                    ? 'bg-[#5B42DC] text-white'
                    : 'text-[#555870] hover:text-[#1C1D33]'
                }`}
              >
                <Smartphone className="h-3.5 w-3.5" aria-hidden="true" />
                Mobile
              </button>
              <button
                type="button"
                onClick={() => setPreviewMode('feed')}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold cursor-pointer ${
                  previewMode === 'feed'
                    ? 'bg-[#5B42DC] text-white'
                    : 'text-[#555870] hover:text-[#1C1D33]'
                }`}
              >
                <Monitor className="h-3.5 w-3.5" aria-hidden="true" />
                Feed
              </button>
              <button
                type="button"
                onClick={() => setPreviewMode('copy')}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold cursor-pointer ${
                  previewMode === 'copy'
                    ? 'bg-[#5B42DC] text-white'
                    : 'text-[#555870] hover:text-[#1C1D33]'
                }`}
              >
                <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                Copy
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close proof inspector"
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[#E2E4F0] bg-white text-[#555870] hover:border-[#C2B8FA] hover:text-[#1C1D33] cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body Split: Left Mockup Stage + Right Details/Feedback */}
        <div className="grid flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-12">
          {/* Left Visual Proof Stage */}
          <div className="flex flex-col items-center justify-center border-b border-[#E5E6F0] bg-[#F2F3FA] p-6 lg:col-span-7 lg:border-r lg:border-b-0">
            <div className="w-full max-w-[540px]">
              <SocialPostMockup
                clientName={campaign.clientName}
                channel={post.channel}
                scheduledDate={post.scheduledDate}
                title={post.title}
                caption={post.caption}
                imageUrl={post.imageUrl}
                mode={previewMode}
              />
            </div>
          </div>

          {/* Right Specifications, Feedback Thread & Timeline */}
          <div className="space-y-5 p-5 sm:p-6 lg:col-span-5">
            {/* Quick Actions Card */}
            <div className="rounded-2xl border border-[#E2E4F0] bg-white p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6B6E87]">
                Proof actions
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onEditPost(post);
                    onClose();
                  }}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#DCDEEB] bg-white px-3.5 text-xs font-semibold text-[#23253E] hover:border-[#5B42DC] hover:text-[#5B42DC] cursor-pointer"
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  Edit post & caption
                </button>

                {post.status === 'changes_requested' && (
                  <button
                    type="button"
                    disabled={busyAction}
                    onClick={() => void handleReset()}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#5B42DC] px-3.5 text-xs font-semibold text-white hover:bg-[#4931C2] disabled:opacity-50 cursor-pointer"
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    Mark ready for re-review
                  </button>
                )}

                {!campaign.reviewLinkRevoked && (
                  <a
                    href={`/review/${campaign.activeReviewToken}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#DCDEEB] bg-white px-3.5 text-xs font-semibold text-[#23253E] hover:border-[#5B42DC] hover:text-[#5B42DC]"
                  >
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    Preview portal
                  </a>
                )}
              </div>
            </div>

            {/* Technical Specifications */}
            <div className="rounded-2xl border border-[#E2E4F0] bg-white p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6B6E87]">
                Technical specifications
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2.5 text-xs">
                <div className="rounded-xl border border-[#ECEDF4] bg-[#FAFBFD] p-2.5">
                  <p className="text-[11px] text-[#7D8099]">Platform</p>
                  <p className="mt-0.5 font-semibold text-[#1C1D33]">{post.channel}</p>
                </div>
                <div className="rounded-xl border border-[#ECEDF4] bg-[#FAFBFD] p-2.5">
                  <p className="text-[11px] text-[#7D8099]">Target schedule</p>
                  <p className="mt-0.5 font-mono font-semibold text-[#1C1D33]">
                    {post.scheduledDate}
                  </p>
                </div>
                <div className="rounded-xl border border-[#ECEDF4] bg-[#FAFBFD] p-2.5">
                  <p className="text-[11px] text-[#7D8099]">Copy length</p>
                  <p className="mt-0.5 font-mono font-semibold text-[#1C1D33]">
                    {post.caption.length} chars
                  </p>
                </div>
                <div className="rounded-xl border border-[#ECEDF4] bg-[#FAFBFD] p-2.5">
                  <p className="text-[11px] text-[#7D8099]">Visual asset</p>
                  <p className="mt-0.5 font-semibold text-[#1C1D33]">
                    {post.imageId ? 'Campaign upload' : post.imageUrl ? 'Stored image' : 'None'}
                  </p>
                </div>
              </div>
            </div>

            {/* Client & Creator Comment Thread */}
            <div className="rounded-2xl border border-[#E2E4F0] bg-white p-4">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#1C1D33]">
                  <MessageSquare className="h-3.5 w-3.5 text-[#5B42DC]" aria-hidden="true" />
                  Feedback thread ({post.comments.length})
                </span>
              </div>

              <div className="mt-3 max-h-52 space-y-2 overflow-y-auto">
                {post.comments.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-[#E5E6F0] bg-[#FAFBFD] px-3 py-4 text-center text-xs text-[#7D8099]">
                    No client notes or creator replies yet.
                  </p>
                ) : (
                  post.comments.map((c) => (
                    <div
                      key={c.id}
                      className={`rounded-xl border px-3 py-2.5 text-xs ${
                        c.authorRole === 'client'
                          ? 'border-[#E6DEC8] bg-[#FFFDF8]'
                          : 'border-[#E2DFFA] bg-[#F7F5FF]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-[#1C1D33]">
                          {c.authorName}{' '}
                          <span className="ml-1 rounded bg-white/80 px-1.5 py-0.5 text-[10px] font-semibold text-[#5B42DC]">
                            {c.authorRole === 'client' ? 'Client' : 'Creator'}
                          </span>
                        </span>
                        <span className="font-mono text-[10px] text-[#7D8099]">
                          {new Date(c.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="mt-1 leading-relaxed text-[#3B3E57]">{c.body}</p>
                    </div>
                  ))
                )}
              </div>

              {!campaign.reviewLinkRevoked && (
                <form onSubmit={(e) => void handleReplySubmit(e)} className="mt-3 flex gap-2">
                  <label htmlFor="inspector-reply-input" className="sr-only">
                    Reply to client feedback
                  </label>
                  <input
                    id="inspector-reply-input"
                    type="text"
                    maxLength={1500}
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Reply to client feedback…"
                    className="h-9 min-w-0 flex-1 rounded-xl border border-[#DCDEEB] px-3 text-xs text-[#1C1D33] focus:border-[#5B42DC] focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={busyAction || !replyText.trim()}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#5B42DC] px-3.5 text-xs font-semibold text-white hover:bg-[#4931C2] disabled:opacity-50 cursor-pointer"
                  >
                    <Send className="h-3 w-3" aria-hidden="true" />
                    Reply
                  </button>
                </form>
              )}
            </div>

            {/* Proof Audit Trail */}
            <div className="rounded-2xl border border-[#E2E4F0] bg-white p-4">
              <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#6B6E87]">
                <History className="h-3.5 w-3.5 text-[#5B42DC]" aria-hidden="true" />
                Proof audit trail
              </p>
              <ul className="mt-2.5 space-y-2 text-xs text-[#474A63]">
                <li className="flex items-center justify-between">
                  <span>Proof created</span>
                  <span className="font-mono text-[11px] text-[#7D8099]">
                    {new Date(post.createdAt).toLocaleString()}
                  </span>
                </li>
                <li className="flex items-center justify-between">
                  <span>Last updated</span>
                  <span className="font-mono text-[11px] text-[#7D8099]">
                    {new Date(post.updatedAt).toLocaleString()}
                  </span>
                </li>
                <li className="flex items-center justify-between">
                  <span>Portal status</span>
                  <span
                    className={`font-semibold ${
                      campaign.reviewLinkRevoked ? 'text-[#9A5B0A]' : 'text-[#1E6F4A]'
                    }`}
                  >
                    {campaign.reviewLinkRevoked ? 'Link revoked' : 'Live review link'}
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
