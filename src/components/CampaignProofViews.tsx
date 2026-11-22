import React, { useMemo, useState } from 'react';
import {
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Copy,
  ExternalLink,
  Eye,
  LayoutList,
  Pencil,
  Plus,
  RotateCcw,
} from 'lucide-react';
import type { FirebaseCampaign, FirebasePost } from '../lib/firestoreRepo';
import { PostStatusBadge, ProofImage } from './SocialPostMockup';

export type CampaignViewMode = 'list' | 'week' | 'kanban';

function parseIsoDateLocal(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const d = new Date(year, month, day);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatLocalIso(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function getMondayIso(referenceIso?: string): string {
  const parsed = referenceIso ? parseIsoDateLocal(referenceIso) : null;
  const d = parsed ?? new Date();
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = copy.getDay(); // 0=Sun..6=Sat
  const diffToMon = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diffToMon);
  return formatLocalIso(copy);
}

export function shiftIsoDays(iso: string, deltaDays: number): string {
  const parsed = parseIsoDateLocal(iso) ?? new Date();
  const copy = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate() + deltaDays);
  return formatLocalIso(copy);
}

function buildWeekDays(mondayIso: string) {
  const dayNames = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  const todayIso = formatLocalIso(new Date());
  return dayNames.map((label, offset) => {
    const iso = shiftIsoDays(mondayIso, offset);
    const parsed = parseIsoDateLocal(iso)!;
    return {
      iso,
      label,
      dayNumber: parsed.getDate(),
      monthShort: parsed.toLocaleDateString('en-US', { month: 'short' }),
      isToday: iso === todayIso,
    };
  });
}

export interface CampaignViewToolbarProps {
  readonly viewMode: CampaignViewMode;
  readonly onChangeViewMode: (mode: CampaignViewMode) => void;
  readonly channelFilter: string;
  readonly onChangeChannelFilter: (channel: string) => void;
  readonly channels: ReadonlyArray<string>;
  readonly searchQuery: string;
  readonly onChangeSearchQuery: (value: string) => void;
}

export const CampaignViewToolbar: React.FC<CampaignViewToolbarProps> = ({
  viewMode,
  onChangeViewMode,
  channelFilter,
  onChangeChannelFilter,
  channels,
  searchQuery,
  onChangeSearchQuery,
}) => {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-[#E2E4F0] bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="inline-flex rounded-xl border border-[#E2E4F0] bg-[#FAFBFD] p-1"
          role="group"
          aria-label="Campaign layout view"
        >
          <button
            type="button"
            onClick={() => onChangeViewMode('list')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
              viewMode === 'list'
                ? 'bg-white text-[#5B42DC] shadow-xs'
                : 'text-[#5D607A] hover:text-[#1C1D33]'
            }`}
          >
            <LayoutList className="h-3.5 w-3.5" aria-hidden="true" />
            Feed list
          </button>
          <button
            type="button"
            onClick={() => onChangeViewMode('week')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
              viewMode === 'week'
                ? 'bg-white text-[#5B42DC] shadow-xs'
                : 'text-[#5D607A] hover:text-[#1C1D33]'
            }`}
          >
            <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
            Week grid
          </button>
          <button
            type="button"
            onClick={() => onChangeViewMode('kanban')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
              viewMode === 'kanban'
                ? 'bg-white text-[#5B42DC] shadow-xs'
                : 'text-[#5D607A] hover:text-[#1C1D33]'
            }`}
          >
            <Columns3 className="h-3.5 w-3.5" aria-hidden="true" />
            Kanban
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {['All', ...channels].map((ch) => (
            <button
              key={ch}
              type="button"
              onClick={() => onChangeChannelFilter(ch)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                channelFilter === ch
                  ? 'bg-[#EAE6FF] text-[#4931C2]'
                  : 'bg-[#F4F5FA] text-[#5D607A] hover:bg-[#ECEDF6] hover:text-[#1C1D33]'
              }`}
            >
              {ch}
            </button>
          ))}
        </div>
      </div>

      <div className="w-full sm:w-56">
        <label htmlFor="campaign-post-search" className="sr-only">
          Filter campaign posts
        </label>
        <input
          id="campaign-post-search"
          type="search"
          value={searchQuery}
          onChange={(e) => onChangeSearchQuery(e.target.value)}
          placeholder="Search titles or captions…"
          className="h-9 w-full rounded-xl border border-[#DCDEEB] bg-[#FAFBFD] px-3 text-xs text-[#1C1D33] placeholder:text-[#8E91A8] focus:border-[#5B42DC] focus:bg-white focus:outline-none"
        />
      </div>
    </div>
  );
};

export interface WeekGridViewProps {
  readonly posts: ReadonlyArray<FirebasePost>;
  readonly linkRevoked: boolean;
  readonly onInspectPost: (post: FirebasePost) => void;
  readonly onEditPost: (post: FirebasePost) => void;
  readonly onAddPostForDate: (isoDate: string) => void;
}

export const WeekGridView: React.FC<WeekGridViewProps> = ({
  posts,
  linkRevoked,
  onInspectPost,
  onEditPost,
  onAddPostForDate,
}) => {
  const initialMonday = useMemo(() => {
    const firstDated = posts.find((p) => parseIsoDateLocal(p.scheduledDate));
    return getMondayIso(firstDated?.scheduledDate);
  }, [posts]);

  const [weekMondayIso, setWeekMondayIso] = useState<string>(() => initialMonday);

  const days = useMemo(() => buildWeekDays(weekMondayIso), [weekMondayIso]);
  const weekRangeLabel = `${days[0].monthShort} ${days[0].dayNumber} – ${days[6].monthShort} ${days[6].dayNumber}`;

  const postsByDay = useMemo(() => {
    const grouped = new Map<string, FirebasePost[]>();
    for (const d of days) {
      grouped.set(d.iso, []);
    }
    for (const post of posts) {
      const list = grouped.get(post.scheduledDate);
      if (list) list.push(post);
    }
    return grouped;
  }, [days, posts]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#E2E4F0] bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setWeekMondayIso((cur) => shiftIsoDays(cur, -7))}
            aria-label="Previous week"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#DCDEEB] bg-white text-[#474A63] hover:border-[#5B42DC] hover:text-[#5B42DC] cursor-pointer"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setWeekMondayIso((cur) => shiftIsoDays(cur, 7))}
            aria-label="Next week"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#DCDEEB] bg-white text-[#474A63] hover:border-[#5B42DC] hover:text-[#5B42DC] cursor-pointer"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="ml-1 text-sm font-bold tracking-[-0.02em] text-[#1C1D33]">
            {weekRangeLabel}
          </span>
        </div>

        <button
          type="button"
          onClick={() => setWeekMondayIso(getMondayIso())}
          className="h-8 rounded-lg border border-[#DCDEEB] bg-[#FAFBFD] px-3 text-xs font-semibold text-[#474A63] hover:border-[#5B42DC] hover:text-[#5B42DC] cursor-pointer"
        >
          Jump to this week
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-7">
        {days.map((day) => {
          const dayPosts = postsByDay.get(day.iso) ?? [];
          return (
            <div
              key={day.iso}
              className={`flex min-h-[260px] flex-col rounded-2xl border p-3 ${
                day.isToday
                  ? 'border-[#5B42DC] bg-[#F7F5FF]'
                  : 'border-[#E2E4F0] bg-white'
              }`}
            >
              <div className="flex items-center justify-between border-b border-[#ECEDF4] pb-2">
                <div>
                  <span className="font-mono text-[10px] font-semibold tracking-wider text-[#6B6E87]">
                    {day.label}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-lg font-bold text-[#1C1D33]">{day.dayNumber}</span>
                    {day.isToday && (
                      <span className="rounded-md bg-[#5B42DC] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        Today
                      </span>
                    )}
                  </div>
                </div>
                <span className="rounded-full bg-[#F2F3FA] px-2 py-0.5 font-mono text-[10px] font-medium text-[#5D607A]">
                  {dayPosts.length}
                </span>
              </div>

              <div className="mt-2.5 flex flex-1 flex-col gap-2.5">
                {dayPosts.length === 0 ? (
                  <button
                    type="button"
                    disabled={linkRevoked}
                    onClick={() => onAddPostForDate(day.iso)}
                    className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-[#D6D8E8] bg-[#FAFBFD] p-3 text-center text-[#7A7E99] transition-colors hover:border-[#5B42DC] hover:text-[#5B42DC] disabled:opacity-50 cursor-pointer"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    <span className="mt-1 text-[11px] font-semibold">Add post</span>
                  </button>
                ) : (
                  dayPosts.map((post) => (
                    <div
                      key={post.id}
                      className="rounded-xl border border-[#E5E6F0] bg-[#FAFBFD] p-2.5 transition-colors hover:border-[#C2B8FA]"
                    >
                      <div className="flex items-center justify-between gap-1 text-[11px]">
                        <span className="truncate font-semibold text-[#23253E]">
                          {post.channel}
                        </span>
                      </div>
                      <div className="mt-2">
                        <ProofImage
                          src={post.imageUrl}
                          alt={post.title}
                          aspectClass="aspect-square"
                        />
                      </div>
                      <div className="mt-2">
                        <PostStatusBadge status={post.status} />
                      </div>
                      <p className="mt-1.5 line-clamp-2 text-[11px] font-medium text-[#1C1D33]">
                        {post.title}
                      </p>
                      <div className="mt-2 flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onInspectPost(post)}
                          className="inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-lg border border-[#DCDEEB] bg-white px-2 text-[11px] font-semibold text-[#23253E] hover:border-[#5B42DC] hover:text-[#5B42DC] cursor-pointer"
                        >
                          <Eye className="h-3 w-3" aria-hidden="true" />
                          Inspect
                        </button>
                        <button
                          type="button"
                          onClick={() => onEditPost(post)}
                          aria-label={`Edit ${post.title}`}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[#DCDEEB] bg-white text-[#5D607A] hover:border-[#5B42DC] hover:text-[#5B42DC] cursor-pointer"
                        >
                          <Pencil className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export interface KanbanBoardViewProps {
  readonly posts: ReadonlyArray<FirebasePost>;
  readonly linkRevoked: boolean;
  readonly onInspectPost: (post: FirebasePost) => void;
  readonly onEditPost: (post: FirebasePost) => void;
  readonly onResetToInReview: (postId: string) => void;
  readonly onAddPost: () => void;
}

export const KanbanBoardView: React.FC<KanbanBoardViewProps> = ({
  posts,
  linkRevoked,
  onInspectPost,
  onEditPost,
  onResetToInReview,
  onAddPost,
}) => {
  const columns: Array<{
    key: 'in_review' | 'changes_requested' | 'approved';
    title: string;
    subtitle: string;
    accentClass: string;
  }> = [
    {
      key: 'in_review',
      title: 'Awaiting client review',
      subtitle: 'Shared in live client portal',
      accentClass: 'border-t-[#5B42DC]',
    },
    {
      key: 'changes_requested',
      title: 'Changes requested',
      subtitle: 'Revisions flagged by client',
      accentClass: 'border-t-[#9A5B0A]',
    },
    {
      key: 'approved',
      title: 'Approved',
      subtitle: 'Signed off for publishing',
      accentClass: 'border-t-[#1E6F4A]',
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {columns.map((col) => {
        const colPosts = posts.filter((p) => p.status === col.key);
        return (
          <div
            key={col.key}
            className={`rounded-2xl border border-[#E2E4F0] border-t-4 ${col.accentClass} bg-white p-4`}
          >
            <div className="flex items-center justify-between border-b border-[#ECEDF4] pb-3">
              <div>
                <h3 className="text-sm font-bold text-[#1C1D33]">{col.title}</h3>
                <p className="text-[11px] text-[#6B6E87]">{col.subtitle}</p>
              </div>
              <span className="rounded-full bg-[#F4F5FA] px-2.5 py-0.5 font-mono text-xs font-semibold text-[#23253E]">
                {colPosts.length}
              </span>
            </div>

            <div className="mt-3 space-y-3">
              {colPosts.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[#E2E4F0] bg-[#FAFBFD] p-5 text-center text-xs text-[#7D8099]">
                  <p>No posts in this stage.</p>
                  {col.key === 'in_review' && !linkRevoked && (
                    <button
                      type="button"
                      onClick={onAddPost}
                      className="mt-2 inline-flex items-center gap-1 font-semibold text-[#5B42DC] hover:underline cursor-pointer"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      Add post
                    </button>
                  )}
                </div>
              ) : (
                colPosts.map((post) => (
                  <div
                    key={post.id}
                    className="rounded-xl border border-[#E5E6F0] bg-[#FAFBFD] p-3.5"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-16 shrink-0">
                        <ProofImage
                          src={post.imageUrl}
                          alt={post.title}
                          aspectClass="aspect-square"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-[11px] text-[#6B6E87]">
                          {post.channel} · {post.scheduledDate}
                        </p>
                        <h4 className="mt-0.5 truncate text-xs font-bold text-[#1C1D33]">
                          {post.title}
                        </h4>
                        <p className="mt-1 line-clamp-2 text-xs text-[#4B4E68]">{post.caption}</p>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#ECEDF4] pt-2.5">
                      <span className="font-mono text-[11px] text-[#7D8099]">
                        {post.comments.length} comment{post.comments.length === 1 ? '' : 's'}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {post.status === 'changes_requested' && (
                          <button
                            type="button"
                            onClick={() => onResetToInReview(post.id)}
                            className="inline-flex h-7 items-center gap-1 rounded-lg bg-[#EAE6FF] px-2 text-[11px] font-semibold text-[#4931C2] hover:bg-[#DDD5FF] cursor-pointer"
                          >
                            <RotateCcw className="h-3 w-3" aria-hidden="true" />
                            Re-review
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onInspectPost(post)}
                          className="inline-flex h-7 items-center gap-1 rounded-lg border border-[#DCDEEB] bg-white px-2.5 text-[11px] font-semibold text-[#23253E] hover:border-[#5B42DC] hover:text-[#5B42DC] cursor-pointer"
                        >
                          <Eye className="h-3 w-3" aria-hidden="true" />
                          Inspect
                        </button>
                        <button
                          type="button"
                          onClick={() => onEditPost(post)}
                          aria-label={`Edit ${post.title}`}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[#DCDEEB] bg-white text-[#5D607A] hover:border-[#5B42DC] hover:text-[#5B42DC] cursor-pointer"
                        >
                          <Pencil className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export interface CampaignBatchFooterBarProps {
  readonly campaign: FirebaseCampaign;
  readonly pendingCount: number;
  readonly copiedToken: boolean;
  readonly onCopyLink: () => void;
}

export const CampaignBatchFooterBar: React.FC<CampaignBatchFooterBarProps> = ({
  campaign,
  pendingCount,
  copiedToken,
  onCopyLink,
}) => {
  if (campaign.reviewLinkRevoked || pendingCount === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#D8D3FA] bg-[#F7F5FF] px-5 py-4">
      <div>
        <p className="text-sm font-bold text-[#1C1D33]">
          Ready for {campaign.clientName}&apos;s review?
          <span className="ml-2 rounded-full bg-[#EAE6FF] px-2.5 py-0.5 text-xs font-semibold text-[#4931C2]">
            {pendingCount} pending
          </span>
        </p>
        <p className="mt-0.5 text-xs text-[#555870]">
          Share the private link so your client can review frames and sign off with one click.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onCopyLink}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#DCDEEB] bg-white px-3.5 text-xs font-semibold text-[#23253E] hover:border-[#5B42DC] hover:text-[#5B42DC] cursor-pointer"
        >
          {copiedToken ? (
            <>
              <Check className="h-3.5 w-3.5 text-[#1E6F4A]" aria-hidden="true" />
              Copied link
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              Copy client link
            </>
          )}
        </button>
        <a
          href={`/review/${campaign.activeReviewToken}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#5B42DC] px-4 text-xs font-semibold text-white hover:bg-[#4931C2]"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          Open client portal
        </a>
      </div>
    </div>
  );
};
