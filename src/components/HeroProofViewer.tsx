import React, { useState } from 'react';
import {
  Check,
  Clock,
  Copy,
  FileSpreadsheet,
  Instagram,
  Linkedin,
  MessageSquare,
  RotateCcw,
  Send,
} from 'lucide-react';
import { CampaignPost, ReviewStatus } from '../data/campaignData';
import { PostArtwork } from './PostArtwork';

interface HeroProofViewerProps {
  posts: CampaignPost[];
  selectedPostId: string;
  onSelectPost: (id: string) => void;
  onUpdateStatus: (id: string, status: ReviewStatus) => void;
  onAddComment: (id: string, text: string) => void;
}

export function getStatusMeta(status: ReviewStatus): {
  label: string;
  textClass: string;
  icon: 'check' | 'alert' | 'clock';
} {
  if (status === 'approved') {
    return {
      label: 'Approved',
      textClass: 'text-[#1E6F4A]',
      icon: 'check',
    };
  }
  if (status === 'changes_requested') {
    return {
      label: 'Needs changes',
      textClass: 'text-[#9A5B0A]',
      icon: 'alert',
    };
  }
  return {
    label: 'Awaiting review',
    textClass: 'text-[#52546B]',
    icon: 'clock',
  };
}

export const HeroProofViewer: React.FC<HeroProofViewerProps> = ({
  posts,
  selectedPostId,
  onSelectPost,
  onUpdateStatus,
  onAddComment,
}) => {
  const [viewMode, setViewMode] = useState<'proof' | 'sheet'>('proof');
  const [commentDraft, setCommentDraft] = useState('');
  const [linkCopied, setLinkCopied] = useState(false);

  const activePost = posts.find((p) => p.id === selectedPostId) ?? posts[0];
  const approvedCount = posts.filter((p) => p.status === 'approved').length;
  const statusMeta = getStatusMeta(activePost.status);

  const handleCopyLink = () => {
    const shareUrl = `https://app.postproofs.co/review/spring-week-2`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(shareUrl).catch(() => {});
    }
    setLinkCopied(true);
    window.setTimeout(() => setLinkCopied(false), 2000);
  };

  const handleSubmitComment = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = commentDraft.trim();
    if (!trimmed) return;
    onAddComment(activePost.id, trimmed);
    setCommentDraft('');
  };

  return (
    <div
      className="w-full overflow-hidden rounded-2xl border border-[#DFE1EC] bg-white shadow-[0_20px_56px_-18px_rgba(28,29,51,0.14)]"
      aria-label="Interactive PostProofs client review preview"
    >
      {/* Window Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#ECEDF4] bg-[#FAFBFD] px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            <span className="h-2.5 w-2.5 rounded-full bg-[#D9DCE8]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#D9DCE8]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#D9DCE8]" />
          </div>
          <span className="truncate text-xs font-medium text-[#5A5D75]">
            Spring content · Week 2
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div
            className="inline-flex items-center rounded-lg bg-[#EEF0F7] p-0.5"
            role="tablist"
            aria-label="Preview mode"
          >
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'proof'}
              onClick={() => setViewMode('proof')}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                viewMode === 'proof'
                  ? 'bg-white text-[#1C1D33] shadow-xs'
                  : 'text-[#62657D] hover:text-[#1C1D33]'
              }`}
            >
              Client proof
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'sheet'}
              onClick={() => setViewMode('sheet')}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                viewMode === 'sheet'
                  ? 'bg-white text-[#1C1D33] shadow-xs'
                  : 'text-[#62657D] hover:text-[#1C1D33]'
              }`}
            >
              <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />
              Source sheet
            </button>
          </div>

          <button
            type="button"
            onClick={handleCopyLink}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#DFE1EC] bg-white px-2.5 py-1 text-xs font-semibold text-[#32344D] transition-colors hover:border-[#C2B8FA] hover:text-[#4D34CE] whitespace-nowrap shrink-0 cursor-pointer"
          >
            {linkCopied ? (
              <>
                <Check className="h-3.5 w-3.5 text-[#1E6F4A]" aria-hidden="true" />
                <span className="text-[#1E6F4A]">Copied</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Copy link</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Campaign Summary & Post Switcher Bar */}
      <div className="border-b border-[#ECEDF4] bg-white px-4 py-3">
        <div className="flex items-center justify-between gap-4 text-xs text-[#646780]">
          <div className="flex items-center gap-2 font-mono tabular-nums">
            <span className="font-medium text-[#1C1D33]">
              {approvedCount}/{posts.length} approved
            </span>
            <span aria-hidden="true">·</span>
            <span>Interactive demo</span>
          </div>
          <span className={`inline-flex items-center gap-1.5 font-semibold ${statusMeta.textClass}`}>
            {statusMeta.icon === 'check' && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
            {statusMeta.icon === 'alert' && <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />}
            {statusMeta.icon === 'clock' && <Clock className="h-3.5 w-3.5" aria-hidden="true" />}
            {statusMeta.label}
          </span>
        </div>

        {/* Post Selector Strip */}
        <div className="mt-2.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {posts.map((post, idx) => {
            const isActive = post.id === activePost.id;
            const meta = getStatusMeta(post.status);
            return (
              <button
                key={post.id}
                type="button"
                onClick={() => {
                  onSelectPost(post.id);
                  setViewMode('proof');
                }}
                className={`flex flex-col items-start rounded-lg border px-2.5 py-2 text-left transition-colors cursor-pointer ${
                  isActive
                    ? 'border-[#5B42DC] bg-[#F7F5FF]'
                    : 'border-[#ECEDF4] bg-[#FAFBFD] hover:border-[#D5D7E6]'
                }`}
              >
                <div className="flex w-full items-center justify-between gap-1 text-[11px] font-mono tabular-nums text-[#6F728A]">
                  <span>0{idx + 1}</span>
                  <span className={meta.textClass} aria-label={meta.label}>
                    {meta.icon === 'check' && <Check className="h-3 w-3" />}
                    {meta.icon === 'alert' && <RotateCcw className="h-3 w-3" />}
                    {meta.icon === 'clock' && <Clock className="h-3 w-3" />}
                  </span>
                </div>
                <span className="mt-0.5 w-full truncate text-xs font-semibold text-[#1C1D33]">
                  {post.scheduledDate}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Content Area */}
      {viewMode === 'proof' ? (
        <div className="grid grid-cols-1 gap-5 bg-[#F8F9FD] p-4 sm:grid-cols-12 sm:p-5">
          {/* Left: Post Creative */}
          <div className="sm:col-span-5">
            <PostArtwork artworkKey={activePost.artworkKey} />
            <div className="mt-2.5 flex items-center justify-between text-[11px] text-[#666982] font-mono tabular-nums">
              <span>{activePost.scheduledDate}</span>
              <span>{activePost.scheduledTime}</span>
            </div>
          </div>

          {/* Right: Caption, Comments, Approval Actions */}
          <div className="flex flex-col justify-between sm:col-span-7">
            <div>
              <div className="flex items-center justify-between gap-2 text-xs text-[#5E617A]">
                <span className="inline-flex items-center gap-1.5 font-semibold text-[#23253E]">
                  {activePost.channel === 'Instagram' ? (
                    <Instagram className="h-3.5 w-3.5 text-[#B83B6B]" aria-hidden="true" />
                  ) : (
                    <Linkedin className="h-3.5 w-3.5 text-[#1B64A8]" aria-hidden="true" />
                  )}
                  {activePost.channel}
                </span>
                <span className="text-[#72758D]">{activePost.format}</span>
              </div>

              <h3 className="mt-2 text-base font-bold tracking-tight text-[#1C1D33]">
                {activePost.title}
              </h3>

              <p className="mt-2 text-[13px] leading-relaxed text-[#464962]">
                {activePost.caption}{' '}
                <span className="font-medium text-[#5B42DC]">
                  {activePost.hashtags.join(' ')}
                </span>
              </p>

              {/* Comments Thread */}
              <div className="mt-4 border-t border-[#E6E8F2] pt-3">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#666982]">
                  <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>
                    Client feedback ({activePost.comments.length})
                  </span>
                </div>

                <div className="mt-2 max-h-[112px] space-y-2 overflow-y-auto pr-1">
                  {activePost.comments.map((comment) => (
                    <div
                      key={comment.id}
                      className="rounded-lg border border-[#E7E8F3] bg-white px-3 py-2 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="font-semibold text-[#23253E]">
                          {comment.author} · {comment.role}
                        </span>
                        <span className="text-[#81849B]">{comment.timestamp}</span>
                      </div>
                      <p className="mt-1 leading-relaxed text-[#52556E]">{comment.text}</p>
                    </div>
                  ))}
                </div>

                <form onSubmit={handleSubmitComment} className="mt-2.5 flex items-center gap-1.5">
                  <label htmlFor="demo-comment-input" className="sr-only">
                    Add a client comment
                  </label>
                  <input
                    id="demo-comment-input"
                    type="text"
                    value={commentDraft}
                    onChange={(e) => setCommentDraft(e.target.value)}
                    placeholder="Add a note as Jamie (Client)..."
                    className="h-9 min-w-0 flex-1 rounded-lg border border-[#DCDEEB] bg-white px-3 text-xs text-[#1C1D33] placeholder:text-[#8A8DA4] focus:border-[#5B42DC] focus:outline-none"
                  />
                  <button
                    type="submit"
                    aria-label="Send comment"
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#DCDEEB] bg-white text-[#3F425C] transition-colors hover:border-[#5B42DC] hover:text-[#5B42DC] cursor-pointer"
                  >
                    <Send className="h-3.5 w-3.5" />
                  </button>
                </form>
              </div>
            </div>

            {/* Decision Buttons */}
            <div className="mt-4 grid grid-cols-2 gap-2 border-t border-[#E6E8F2] pt-3.5">
              <button
                type="button"
                onClick={() => onUpdateStatus(activePost.id, 'approved')}
                className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activePost.status === 'approved'
                    ? 'bg-[#1E6F4A] text-white'
                    : 'border border-[#C9E5D7] bg-[#EDF8F2] text-[#1E6F4A] hover:bg-[#DFF3E8]'
                }`}
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                {activePost.status === 'approved' ? 'Approved' : 'Approve post'}
              </button>
              <button
                type="button"
                onClick={() => onUpdateStatus(activePost.id, 'changes_requested')}
                className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activePost.status === 'changes_requested'
                    ? 'bg-[#9A5B0A] text-white'
                    : 'border border-[#E2E3EE] bg-white text-[#41445E] hover:border-[#D6B98C] hover:text-[#8A5007]'
                }`}
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Request changes
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Source Spreadsheet Preview Mode */
        <div className="bg-[#F8F9FD] p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2 pb-3">
            <div className="text-xs text-[#595C75]">
              <span className="font-semibold text-[#1C1D33]">spring-calendar-week2.csv</span>
              <span className="mx-2 text-[#B3B6C9]">·</span>
              <span>Click any row to inspect its generated proof</span>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-[#E2E4F0] bg-white">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[#ECEDF4] bg-[#FAFBFD] font-mono text-[11px] text-[#6B6E87]">
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Channel</th>
                  <th className="px-3 py-2 font-medium">Post Title</th>
                  <th className="px-3 py-2 font-medium">Decision</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0F1F7]">
                {posts.map((post) => {
                  const meta = getStatusMeta(post.status);
                  const isActive = post.id === activePost.id;
                  return (
                    <tr
                      key={post.id}
                      onClick={() => {
                        onSelectPost(post.id);
                        setViewMode('proof');
                      }}
                      className={`cursor-pointer transition-colors ${
                        isActive ? 'bg-[#F5F3FF]' : 'hover:bg-[#FAFBFD]'
                      }`}
                    >
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono tabular-nums text-[#595C75]">
                        {post.scheduledDate}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-[#3F425C]">
                        {post.channel}
                      </td>
                      <td className="px-3 py-2.5 font-medium text-[#1C1D33]">{post.title}</td>
                      <td className={`whitespace-nowrap px-3 py-2.5 font-semibold ${meta.textClass}`}>
                        {meta.label}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-xs text-[#646780]">
              Each spreadsheet row maps directly to a shareable proof card with caption and creative.
            </p>
            <button
              type="button"
              onClick={() => setViewMode('proof')}
              className="rounded-lg bg-[#5B42DC] px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#4931C2] whitespace-nowrap shrink-0 cursor-pointer"
            >
              Open client proof
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
