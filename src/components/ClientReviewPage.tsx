import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  CheckCheck,
  Copy,
  Lock,
  MessageSquare,
  RotateCcw,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  addClientPostComment,
  submitClientPostDecision,
  subscribeClientReviewLink,
  subscribeClientReviewPosts,
} from '../lib/firestoreRepo';
import type {
  FirebasePost,
  FirebaseReviewLink,
  PostApprovalStatus,
} from '../lib/firestoreRepo';
import postproofsLogo from '../assets/images/postproofs_logo.png';
import {
  HighlightedCaption,
  PostStatusBadge,
  SocialPostMockup,
} from './SocialPostMockup';

interface ClientReviewPageProps {
  token: string;
  onNavigate: (path: string) => void;
}

type ClientReviewFilter = 'all' | PostApprovalStatus;

export const ClientReviewPage: React.FC<ClientReviewPageProps> = ({ token, onNavigate }) => {
  const [reviewLink, setReviewLink] = useState<FirebaseReviewLink | null>(null);
  const [posts, setPosts] = useState<FirebasePost[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoked, setRevoked] = useState(false);
  const [reviewerName, setReviewerName] = useState('');
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [busyPostId, setBusyPostId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ClientReviewFilter>('all');
  const [confirmApproveAll, setConfirmApproveAll] = useState(false);
  const [batchApproving, setBatchApproving] = useState(false);
  const [copiedCaptionPostId, setCopiedCaptionPostId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let unsubPosts: (() => void) | null = null;
    let postsSubscribed = false;

    setLoading(true);
    setRevoked(false);
    setReviewLink(null);
    setReviewerName('');
    setPosts([]);
    setStatusFilter('all');
    setConfirmApproveAll(false);
    setCopiedCaptionPostId(null);
    setActionError('');

    const handleInvalidLink = () => {
      if (cancelled) return;
      if (unsubPosts) {
        unsubPosts();
        unsubPosts = null;
      }
      postsSubscribed = false;
      setReviewLink(null);
      setPosts([]);
      setRevoked(true);
      setLoading(false);
    };

    const unsubLink = subscribeClientReviewLink(
      token,
      (link) => {
        if (cancelled) return;
        setReviewLink(link);
        setReviewerName((prev) => prev || link.clientName);

        if (!postsSubscribed) {
          postsSubscribed = true;
          unsubPosts = subscribeClientReviewPosts(
            token,
            (items) => {
              if (cancelled) return;
              setPosts(items);
              setLoading(false);
            },
            handleInvalidLink
          );
        }
      },
      handleInvalidLink
    );

    return () => {
      cancelled = true;
      unsubLink();
      if (unsubPosts) unsubPosts();
    };
  }, [token]);

  const handleDecision = async (
    postId: string,
    decision: 'approved' | 'changes_requested'
  ) => {
    if (!reviewLink) return;
    setBusyPostId(postId);
    setActionError('');
    try {
      const note = (commentDrafts[postId] || '').trim();
      await submitClientPostDecision({
        reviewLink,
        postId,
        decision,
        authorName: reviewerName.trim() || reviewLink.clientName || 'Client',
        comment: note || undefined,
      });
      if (note) {
        setCommentDrafts((prev) => ({ ...prev, [postId]: '' }));
      }
    } catch {
      setActionError(
        'Could not save your decision. This review link may have been revoked by the creator.'
      );
    } finally {
      setBusyPostId(null);
    }
  };

  const handleCommentSubmit = async (e: React.FormEvent, postId: string) => {
    e.preventDefault();
    if (!reviewLink) return;
    const body = (commentDrafts[postId] || '').trim();
    if (!body) return;

    setBusyPostId(postId);
    setActionError('');
    try {
      await addClientPostComment({
        reviewLink,
        postId,
        authorName: reviewerName.trim() || reviewLink.clientName || 'Client',
        body,
      });
      setCommentDrafts((prev) => ({ ...prev, [postId]: '' }));
    } catch {
      setActionError(
        'Could not post your comment. This review link may have been revoked by the creator.'
      );
    } finally {
      setBusyPostId(null);
    }
  };

  const approvedCount = posts.filter((p) => p.status === 'approved').length;
  const changesCount = posts.filter((p) => p.status === 'changes_requested').length;
  const inReviewCount = posts.filter((p) => p.status === 'in_review').length;
  const remainingUnapproved = posts.filter((p) => p.status !== 'approved');
  const progressPct = posts.length > 0 ? Math.round((approvedCount / posts.length) * 100) : 0;

  const filteredPosts = useMemo(() => {
    if (statusFilter === 'all') return posts;
    return posts.filter((p) => p.status === statusFilter);
  }, [posts, statusFilter]);

  const handleCopyCaption = async (post: FirebasePost) => {
    try {
      await navigator.clipboard.writeText(post.caption);
      setCopiedCaptionPostId(post.id);
      window.setTimeout(
        () => setCopiedCaptionPostId((cur) => (cur === post.id ? null : cur)),
        2000
      );
    } catch {
      // Ignore clipboard failures
    }
  };

  const handleApproveRemaining = async () => {
    if (!reviewLink || remainingUnapproved.length === 0 || batchApproving) return;
    setBatchApproving(true);
    setActionError('');
    try {
      const author = reviewerName.trim() || reviewLink.clientName || 'Client';
      for (const post of remainingUnapproved) {
        await submitClientPostDecision({
          reviewLink,
          postId: post.id,
          decision: 'approved',
          authorName: author,
        });
      }
      setConfirmApproveAll(false);
    } catch {
      setActionError(
        'Could not approve all remaining posts. This review link may have been revoked by the creator.'
      );
    } finally {
      setBatchApproving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAFBFD] text-[#1C1D33] pb-20">
      <header className="border-b border-[#ECEDF4] bg-white">
        <div className="mx-auto flex h-[68px] max-w-[1160px] items-center justify-between gap-6 px-6">
          <button
            type="button"
            onClick={() => onNavigate('/')}
            aria-label="PostProofs home"
            className="inline-flex items-center whitespace-nowrap shrink-0 cursor-pointer"
          >
            <img
              src={postproofsLogo}
              alt="postproofs"
              className="h-12 w-auto object-contain"
            />
          </button>

          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F4F5FA] px-3 py-1 text-xs font-medium text-[#555870]">
            <ShieldCheck className="h-3.5 w-3.5 text-[#5B42DC]" aria-hidden="true" />
            Private client review
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-[1160px] px-4 py-8 sm:px-6 sm:py-10">
        {loading ? (
          <div className="rounded-2xl border border-[#E5E6F0] bg-white p-10 text-center text-sm text-[#646780]">
            Loading campaign proof…
          </div>
        ) : revoked || !reviewLink ? (
          <div className="mx-auto max-w-lg rounded-2xl border border-[#E5E6F0] bg-white p-8 text-center">
            <div className="mx-auto inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[#E5E6F0] bg-[#FAFBFD] text-[#555870]">
              <Lock className="h-5 w-5" aria-hidden="true" />
            </div>
            <h1 className="mt-4 text-2xl font-bold tracking-tight text-[#1C1D33]">
              This review link is not active
            </h1>
            <p className="mt-2.5 text-sm leading-relaxed text-[#5B5E77]">
              This link is invalid, has been revoked, or was replaced by a newer link.
            </p>
            <p className="mt-4 text-xs text-[#797C94]">
              Ask your social media manager for the latest PostProofs review link.
            </p>
            <button
              type="button"
              onClick={() => onNavigate('/')}
              className="mt-6 inline-flex h-10 items-center justify-center rounded-xl border border-[#DCDEEB] bg-white px-4 text-xs font-semibold text-[#23253E] transition-colors hover:border-[#5B42DC] hover:text-[#5B42DC] cursor-pointer"
            >
              Go to PostProofs home
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Hero Portal Header Card (Stitch Magic Proof Portal layout in PostProofs palette) */}
            <section className="rounded-3xl border border-[#E2E4F0] bg-white p-6 sm:p-7">
              <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-[#5B42DC]">
                    <span>Client review portal</span>
                    <span className="text-[#B8BBD0]">·</span>
                    <span>{reviewLink.clientName}</span>
                  </div>
                  <h1 className="mt-1.5 text-3xl font-bold tracking-[-0.03em] text-[#1C1D33]">
                    {reviewLink.campaignName}
                  </h1>
                  <p className="mt-1.5 text-sm text-[#5B5E77]">
                    {posts.length} post{posts.length === 1 ? '' : 's'} in batch · Review visuals
                    and captions below, leave notes, or approve with one click.
                  </p>
                </div>

                {/* Progress Breakdown Ring + Batch Approve Control */}
                <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-[#E5E6F0] bg-[#FAFBFD] p-4 sm:flex-nowrap">
                  <div className="flex items-center gap-3.5">
                    <div className="relative flex h-14 w-14 shrink-0 items-center justify-center">
                      <svg className="h-14 w-14 -rotate-90" viewBox="0 0 56 56" aria-hidden="true">
                        <circle
                          cx="28"
                          cy="28"
                          r="22"
                          fill="none"
                          stroke="#E5E6F0"
                          strokeWidth="5"
                        />
                        <circle
                          cx="28"
                          cy="28"
                          r="22"
                          fill="none"
                          stroke="#5B42DC"
                          strokeWidth="5"
                          strokeLinecap="round"
                          strokeDasharray={2 * Math.PI * 22}
                          strokeDashoffset={
                            2 * Math.PI * 22 * (1 - Math.min(1, progressPct / 100))
                          }
                        />
                      </svg>
                      <span className="absolute font-mono text-xs font-bold text-[#1C1D33]">
                        {approvedCount}/{posts.length}
                      </span>
                    </div>

                    <div className="space-y-0.5 text-[11px]">
                      <p className="font-semibold text-[#1C1D33]">Progress Breakdown</p>
                      <p className="font-medium text-[#1E6F4A]">
                        ● {approvedCount} Approved
                      </p>
                      <p className="font-medium text-[#5B42DC]">
                        ● {inReviewCount} Pending
                      </p>
                      <p className="font-medium text-[#9A5B0A]">
                        ● {changesCount} Revision{changesCount === 1 ? '' : 's'}
                      </p>
                    </div>
                  </div>

                  {remainingUnapproved.length > 0 && (
                    <div className="flex items-center gap-2 shrink-0">
                      {confirmApproveAll ? (
                        <>
                          <button
                            type="button"
                            disabled={batchApproving}
                            onClick={() => void handleApproveRemaining()}
                            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#1E6F4A] px-3.5 text-xs font-semibold text-white hover:bg-[#175739] disabled:opacity-50 cursor-pointer"
                          >
                            <CheckCheck className="h-4 w-4" aria-hidden="true" />
                            {batchApproving
                              ? 'Approving…'
                              : `Confirm approve (${remainingUnapproved.length})`}
                          </button>
                          <button
                            type="button"
                            disabled={batchApproving}
                            onClick={() => setConfirmApproveAll(false)}
                            className="inline-flex h-10 items-center rounded-xl border border-[#DCDEEB] bg-white px-3 text-xs font-semibold text-[#474A63] hover:text-[#1C1D33] cursor-pointer"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmApproveAll(true)}
                          className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#5B42DC] px-4 text-xs font-semibold text-white transition-colors hover:bg-[#4931C2] cursor-pointer"
                        >
                          <CheckCheck className="h-4 w-4" aria-hidden="true" />
                          Approve remaining ({remainingUnapproved.length})
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Filter Tabs + Reviewer Name Input */}
              <div className="mt-6 flex flex-col justify-between gap-4 border-t border-[#ECEDF4] pt-5 sm:flex-row sm:items-center">
                <div className="flex flex-wrap items-center gap-1.5">
                  {(
                    [
                      ['all', `All posts (${posts.length})`],
                      ['in_review', `Pending (${inReviewCount})`],
                      ['approved', `Approved (${approvedCount})`],
                      ['changes_requested', `Changes (${changesCount})`],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setStatusFilter(key)}
                      className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                        statusFilter === key
                          ? 'bg-[#5B42DC] text-white'
                          : 'bg-[#F4F5FA] text-[#555870] hover:bg-[#EAEBF5] hover:text-[#1C1D33]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2.5 sm:w-72">
                  <label
                    htmlFor="reviewer-name"
                    className="shrink-0 text-xs font-semibold text-[#474A63]"
                  >
                    Reviewing as
                  </label>
                  <input
                    id="reviewer-name"
                    type="text"
                    maxLength={80}
                    value={reviewerName}
                    onChange={(e) => setReviewerName(e.target.value)}
                    placeholder="Your name"
                    className="h-9 min-w-0 flex-1 rounded-xl border border-[#DCDEEB] bg-white px-3 text-sm text-[#1C1D33] focus:border-[#5B42DC] focus:outline-none"
                  />
                </div>
              </div>
            </section>

            {actionError && (
              <div
                role="alert"
                className="flex items-center justify-between gap-3 rounded-xl border border-[#F0C8C4] bg-[#FDF4F3] px-4 py-3 text-sm text-[#9B2B22]"
              >
                <span>{actionError}</span>
                <button
                  type="button"
                  onClick={() => setActionError('')}
                  aria-label="Dismiss error"
                  className="shrink-0 rounded-md p-1 text-[#9B2B22] hover:bg-[#F9E3E0] cursor-pointer"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            )}

            {posts.length === 0 ? (
              <div className="rounded-2xl border border-[#E5E6F0] bg-white p-10 text-center text-sm text-[#646780]">
                No posts have been added to this campaign yet. Check back soon.
              </div>
            ) : filteredPosts.length === 0 ? (
              <div className="rounded-2xl border border-[#E5E6F0] bg-white p-10 text-center">
                <p className="text-sm font-semibold text-[#1C1D33]">No posts match this filter</p>
                <button
                  type="button"
                  onClick={() => setStatusFilter('all')}
                  className="mt-2 text-xs font-semibold text-[#5B42DC] hover:underline cursor-pointer"
                >
                  Show all {posts.length} posts
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                {filteredPosts.map((post, idx) => {
                  const isBusy = busyPostId === post.id || batchApproving;
                  return (
                    <article
                      key={post.id}
                      id={`review-post-${post.id}`}
                      className="grid grid-cols-1 gap-6 rounded-3xl border border-[#E2E4F0] bg-white p-5 sm:p-6 lg:grid-cols-12"
                    >
                      {/* Left Column: Social Channel Proof Mockup + Frame Metadata */}
                      <div className="lg:col-span-5">
                        <SocialPostMockup
                          clientName={reviewLink.clientName}
                          channel={post.channel}
                          scheduledDate={post.scheduledDate}
                          title={post.title}
                          caption={post.caption}
                          imageUrl={post.imageUrl}
                          mode="feed"
                        />
                        <div className="mt-3 flex items-center justify-between px-1 text-xs font-mono tabular-nums text-[#666982]">
                          <span>
                            {String(idx + 1).padStart(2, '0')} · {post.channel}
                          </span>
                          <span>Scheduled {post.scheduledDate}</span>
                        </div>
                      </div>

                      {/* Right Column: Title, Copy Proof Box, Comment Thread & Sign-off */}
                      <div className="flex flex-col justify-between lg:col-span-7">
                        <div>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-mono text-xs font-semibold text-[#5B42DC]">
                              {post.channel} · {post.scheduledDate}
                            </span>
                            <PostStatusBadge status={post.status} />
                          </div>

                          <h2 className="mt-2 text-2xl font-bold tracking-[-0.02em] text-[#1C1D33]">
                            {post.title}
                          </h2>

                          {/* Primary Caption Proof Box with Copy action */}
                          <div className="mt-4 rounded-2xl border border-[#EAEBF4] bg-[#FAFBFD] p-4">
                            <div className="flex items-center justify-between gap-2 border-b border-[#EAEBF4] pb-2">
                              <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#6B6E87]">
                                Primary caption proof
                              </span>
                              <button
                                type="button"
                                onClick={() => void handleCopyCaption(post)}
                                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-[#5B42DC] hover:bg-[#EAE6FF] cursor-pointer"
                              >
                                {copiedCaptionPostId === post.id ? (
                                  <>
                                    <Check className="h-3 w-3 text-[#1E6F4A]" />
                                    Copied
                                  </>
                                ) : (
                                  <>
                                    <Copy className="h-3 w-3" />
                                    Copy caption
                                  </>
                                )}
                              </button>
                            </div>
                            <p className="mt-3 whitespace-pre-wrap text-[15px] leading-[1.7] text-[#3B3E57]">
                              <HighlightedCaption caption={post.caption} />
                            </p>
                          </div>

                          {/* Feedback Thread */}
                          <div className="mt-5 border-t border-[#ECEDF4] pt-4">
                            <div className="flex items-center gap-1.5 text-xs font-semibold text-[#5E617A]">
                              <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Feedback &amp; revisions ({post.comments.length})</span>
                            </div>

                            {post.comments.length > 0 && (
                              <div className="mt-3 space-y-2.5">
                                {post.comments.map((comment) => (
                                  <div
                                    key={comment.id}
                                    className="rounded-xl border border-[#EAEBF4] bg-[#FAFBFD] px-3.5 py-2.5 text-sm"
                                  >
                                    <div className="flex items-center justify-between gap-2 text-xs">
                                      <span className="font-semibold text-[#1C1D33]">
                                        {comment.authorName} ·{' '}
                                        {comment.authorRole === 'client' ? 'Client' : 'Creator'}
                                      </span>
                                      <span className="font-mono text-[11px] text-[#7D8099]">
                                        {new Date(comment.createdAt).toLocaleDateString()}
                                      </span>
                                    </div>
                                    <p className="mt-1 leading-relaxed text-[#4A4D66]">
                                      {comment.body}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            )}

                            <form
                              onSubmit={(e) => handleCommentSubmit(e, post.id)}
                              className="mt-3 flex items-center gap-2"
                            >
                              <label htmlFor={`comment-${post.id}`} className="sr-only">
                                Add a comment for {post.title}
                              </label>
                              <input
                                id={`comment-${post.id}`}
                                type="text"
                                maxLength={1500}
                                value={commentDrafts[post.id] || ''}
                                onChange={(e) =>
                                  setCommentDrafts((prev) => ({
                                    ...prev,
                                    [post.id]: e.target.value,
                                  }))
                                }
                                placeholder="Leave a comment or revision note…"
                                className="h-10 min-w-0 flex-1 rounded-xl border border-[#DCDEEB] bg-white px-3.5 text-sm text-[#1C1D33] placeholder:text-[#8E91A8] focus:border-[#5B42DC] focus:outline-none"
                              />
                              <button
                                type="submit"
                                disabled={isBusy || !(commentDrafts[post.id] || '').trim()}
                                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-[#DCDEEB] bg-white px-3.5 text-xs font-semibold text-[#23253E] transition-colors hover:border-[#5B42DC] hover:text-[#5B42DC] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                <Send className="h-3.5 w-3.5" aria-hidden="true" />
                                Comment
                              </button>
                            </form>
                          </div>
                        </div>

                        <div className="mt-6 grid grid-cols-1 gap-2.5 border-t border-[#ECEDF4] pt-4 sm:grid-cols-2">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleDecision(post.id, 'approved')}
                            className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 ${
                              post.status === 'approved'
                                ? 'bg-[#1E6F4A] text-white'
                                : 'border border-[#C2E3D2] bg-[#EDF8F2] text-[#1E6F4A] hover:bg-[#DEF2E7]'
                            }`}
                          >
                            <Check className="h-4 w-4" aria-hidden="true" />
                            {post.status === 'approved' ? 'Approved' : 'Approve post'}
                          </button>

                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleDecision(post.id, 'changes_requested')}
                            className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 ${
                              post.status === 'changes_requested'
                                ? 'bg-[#9A5B0A] text-white'
                                : 'border border-[#DCDEEB] bg-white text-[#32344D] hover:border-[#D4B483] hover:text-[#8A5007]'
                            }`}
                          >
                            <RotateCcw className="h-4 w-4" aria-hidden="true" />
                            Request changes
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>

      {!loading && !revoked && reviewLink && posts.length > 0 && (
        <div className="fixed inset-x-4 bottom-4 z-30 mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#1C1D33] px-5 py-3 text-white shadow-xl">
          <div className="flex items-center gap-2.5 text-xs">
            <span className="inline-block h-2 w-2 rounded-full bg-[#3DD68C]" aria-hidden="true" />
            <span className="font-semibold">
              All changes saved live · {approvedCount}/{posts.length} approved
            </span>
          </div>
          {inReviewCount > 0 ? (
            <button
              type="button"
              onClick={() => {
                setStatusFilter('in_review');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="inline-flex h-8 items-center rounded-xl bg-[#5B42DC] px-3 text-xs font-semibold text-white hover:bg-[#4931C2] cursor-pointer"
            >
              View {inReviewCount} awaiting review
            </button>
          ) : (
            <span className="font-mono text-[11px] text-white/75">No login required</span>
          )}
        </div>
      )}
    </div>
  );
};
