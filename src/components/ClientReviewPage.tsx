import React, { useEffect, useState } from 'react';
import {
  Check,
  Clock,
  ImageOff,
  Lock,
  MessageSquare,
  RotateCcw,
  Send,
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

interface ClientReviewPageProps {
  token: string;
  onNavigate: (path: string) => void;
}

function StatusLabel({ status }: { status: PostApprovalStatus }) {
  if (status === 'approved') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1E6F4A] whitespace-nowrap">
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
        Approved
      </span>
    );
  }
  if (status === 'changes_requested') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#9A5B0A] whitespace-nowrap">
        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
        Changes requested
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#555870] whitespace-nowrap">
      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
      Awaiting review
    </span>
  );
}

function PostPreviewImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (failed || !src) {
    return (
      <div className="flex aspect-[4/3] w-full flex-col items-center justify-center rounded-xl border border-[#E5E6F0] bg-[#F4F5FA] p-6 text-center text-[#6E718A]">
        <ImageOff className="h-6 w-6" aria-hidden="true" />
        <span className="mt-2 text-xs font-medium">Preview image unavailable</span>
      </div>
    );
  }

  return (
    <div className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-xl border border-[#E5E6F0] bg-[#F8F9FD]">
      <img
        src={src}
        alt={alt}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="h-full w-full object-contain"
      />
    </div>
  );
}

export const ClientReviewPage: React.FC<ClientReviewPageProps> = ({ token, onNavigate }) => {
  const [reviewLink, setReviewLink] = useState<FirebaseReviewLink | null>(null);
  const [posts, setPosts] = useState<FirebasePost[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoked, setRevoked] = useState(false);
  const [reviewerName, setReviewerName] = useState('');
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [busyPostId, setBusyPostId] = useState<string | null>(null);
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

  return (
    <div className="min-h-screen bg-[#FAFBFD] text-[#1C1D33]">
      <header className="border-b border-[#ECEDF4] bg-white">
        <div className="mx-auto flex h-[68px] max-w-[1100px] items-center justify-between gap-6 px-6">
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

          <span className="text-xs font-medium text-[#6B6E87]">Private client review</span>
        </div>
      </header>

      <main className="mx-auto max-w-[1100px] px-6 py-10">
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
          <div>
            <div className="flex flex-col justify-between gap-6 border-b border-[#E5E6F0] pb-7 sm:flex-row sm:items-end">
              <div>
                <p className="text-xs font-semibold text-[#5B42DC]">
                  Client review · {reviewLink.clientName}
                </p>
                <h1 className="mt-1.5 text-3xl font-bold tracking-[-0.03em] text-[#1C1D33]">
                  {reviewLink.campaignName}
                </h1>
                <p className="mt-2 font-mono text-xs tabular-nums text-[#5D607A]">
                  {approvedCount} of {posts.length} approved · {changesCount} changes requested ·{' '}
                  {inReviewCount} awaiting review
                </p>
              </div>

              <div className="w-full sm:w-64">
                <label
                  htmlFor="reviewer-name"
                  className="block text-xs font-semibold text-[#474A63]"
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
                  className="mt-1.5 h-10 w-full rounded-xl border border-[#DCDEEB] bg-white px-3 text-sm text-[#1C1D33] focus:border-[#5B42DC] focus:outline-none"
                />
              </div>
            </div>

            {actionError && (
              <div
                role="alert"
                className="mt-6 flex items-center justify-between gap-3 rounded-xl border border-[#F0C8C4] bg-[#FDF4F3] px-4 py-3 text-sm text-[#9B2B22]"
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
              <div className="mt-8 rounded-2xl border border-[#E5E6F0] bg-white p-10 text-center text-sm text-[#646780]">
                No posts have been added to this campaign yet. Check back soon.
              </div>
            ) : (
              <div className="mt-8 space-y-6">
                {posts.map((post, idx) => {
                  const isBusy = busyPostId === post.id;
                  return (
                    <article
                      key={post.id}
                      className="grid grid-cols-1 gap-6 rounded-2xl border border-[#E2E4F0] bg-white p-6 lg:grid-cols-12"
                    >
                      <div className="lg:col-span-5">
                        <PostPreviewImage src={post.imageUrl} alt={post.title} />
                        <div className="mt-3 flex items-center justify-between text-xs font-mono tabular-nums text-[#666982]">
                          <span>
                            {String(idx + 1).padStart(2, '0')} · {post.channel}
                          </span>
                          <span>{post.scheduledDate}</span>
                        </div>
                      </div>

                      <div className="flex flex-col justify-between lg:col-span-7">
                        <div>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <h2 className="text-xl font-bold tracking-[-0.02em] text-[#1C1D33]">
                              {post.title}
                            </h2>
                            <StatusLabel status={post.status} />
                          </div>

                          <p className="mt-3 whitespace-pre-wrap text-[15px] leading-[1.7] text-[#3B3E57]">
                            {post.caption}
                          </p>

                          <div className="mt-6 border-t border-[#ECEDF4] pt-4">
                            <div className="flex items-center gap-1.5 text-xs font-semibold text-[#5E617A]">
                              <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Feedback ({post.comments.length})</span>
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
    </div>
  );
};
