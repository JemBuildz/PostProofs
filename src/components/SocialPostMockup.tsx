import React, { useEffect, useState } from 'react';
import {
  Check,
  Clock,
  Heart,
  ImageOff,
  MessageCircle,
  MoreHorizontal,
  Repeat2,
  RotateCcw,
  Send,
  Bookmark,
} from 'lucide-react';
import type { PostApprovalStatus } from '../lib/firestoreRepo';

export type PreviewFrameMode = 'feed' | 'phone' | 'copy';

export function PostStatusBadge({ status }: { status: PostApprovalStatus }) {
  if (status === 'approved') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#EDF8F2] px-2.5 py-0.5 text-[11px] font-semibold text-[#1E6F4A] whitespace-nowrap">
        <Check className="h-3 w-3" aria-hidden="true" />
        Approved
      </span>
    );
  }
  if (status === 'changes_requested') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#FEF4E6] px-2.5 py-0.5 text-[11px] font-semibold text-[#9A5B0A] whitespace-nowrap">
        <RotateCcw className="h-3 w-3" aria-hidden="true" />
        Changes requested
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#EEF0FA] px-2.5 py-0.5 text-[11px] font-semibold text-[#474A63] whitespace-nowrap">
      <Clock className="h-3 w-3" aria-hidden="true" />
      Awaiting review
    </span>
  );
}

export function ProofImage({
  src,
  alt,
  aspectClass = 'aspect-[4/3]',
}: {
  src: string;
  alt: string;
  aspectClass?: string;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (failed || !src) {
    return (
      <div
        className={`flex ${aspectClass} w-full flex-col items-center justify-center rounded-xl border border-[#E5E6F0] bg-[#F4F5FA] p-6 text-center text-[#6E718A]`}
      >
        <ImageOff className="h-6 w-6" aria-hidden="true" />
        <span className="mt-2 text-xs font-medium">Preview image unavailable</span>
      </div>
    );
  }

  return (
    <div
      className={`flex ${aspectClass} w-full items-center justify-center overflow-hidden rounded-xl border border-[#E5E6F0] bg-[#F8F9FD]`}
    >
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

export function HighlightedCaption({ caption }: { caption: string }) {
  const parts = caption.split(/(#[A-Za-z0-9_]+|@[A-Za-z0-9_.]+)/g);
  return (
    <>
      {parts.map((part, idx) =>
        part.startsWith('#') || part.startsWith('@') ? (
          <span key={idx} className="font-medium text-[#5B42DC]">
            {part}
          </span>
        ) : (
          <React.Fragment key={idx}>{part}</React.Fragment>
        )
      )}
    </>
  );
}

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

export interface SocialPostMockupProps {
  readonly clientName: string;
  readonly channel: string;
  readonly scheduledDate: string;
  readonly title: string;
  readonly caption: string;
  readonly imageUrl: string;
  readonly mode?: PreviewFrameMode;
}

export const SocialPostMockup: React.FC<SocialPostMockupProps> = ({
  clientName,
  channel,
  scheduledDate,
  title,
  caption,
  imageUrl,
  mode = 'feed',
}) => {
  const handle = toHandle(clientName);
  const initials = getInitials(clientName);
  const normalizedChannel = channel.toLowerCase();

  if (mode === 'copy') {
    return (
      <div className="rounded-2xl border border-[#E2E4F0] bg-white p-6">
        <div className="flex items-center justify-between border-b border-[#ECEDF4] pb-3">
          <span className="text-xs font-semibold text-[#5B42DC]">{channel} · Copy Proof</span>
          <span className="font-mono text-xs tabular-nums text-[#6B6E87]">{scheduledDate}</span>
        </div>
        <h3 className="mt-4 text-lg font-bold tracking-[-0.02em] text-[#1C1D33]">{title}</h3>
        <p className="mt-3 whitespace-pre-wrap text-[15px] leading-[1.75] text-[#2F324B]">
          <HighlightedCaption caption={caption} />
        </p>
        <div className="mt-5 flex items-center justify-between border-t border-[#ECEDF4] pt-3 text-[11px] font-mono text-[#7D8099]">
          <span>{caption.length} characters</span>
          <span>{handle}</span>
        </div>
      </div>
    );
  }

  const cardInner = (
    <div className="overflow-hidden rounded-2xl border border-[#E2E4F0] bg-white shadow-xs">
      {/* Platform Header Bar */}
      <div className="flex items-center justify-between border-b border-[#F0F1F8] px-4 py-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#EAE6FF] text-xs font-bold text-[#4931C2]">
            {initials}
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs font-bold text-[#1C1D33]">
              {normalizedChannel === 'linkedin' ? clientName || 'Brand Page' : handle}
            </p>
            <p className="truncate font-mono text-[11px] text-[#6B6E87]">
              {channel} · {scheduledDate}
            </p>
          </div>
        </div>
        <MoreHorizontal className="h-4 w-4 shrink-0 text-[#8E91A8]" aria-hidden="true" />
      </div>

      {/* LinkedIn puts copy above visual; Instagram/TikTok/X keep media front & center */}
      {normalizedChannel === 'linkedin' && (
        <div className="px-4 py-3 text-xs leading-relaxed text-[#2F324B]">
          <p className="line-clamp-4 whitespace-pre-wrap">
            <HighlightedCaption caption={caption} />
          </p>
        </div>
      )}

      {/* Visual Proof Asset */}
      <div className="px-3 pt-2 pb-1">
        <ProofImage
          src={imageUrl}
          alt={title}
          aspectClass={normalizedChannel === 'tiktok' ? 'aspect-[4/5]' : 'aspect-[4/3]'}
        />
      </div>

      {/* Platform Engagement Affordance Row */}
      <div className="flex items-center justify-between px-4 py-2.5 text-[#555870]">
        <div className="flex items-center gap-3.5">
          <Heart className="h-4 w-4" aria-hidden="true" />
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
          {normalizedChannel === 'x' || normalizedChannel === 'threads' ? (
            <Repeat2 className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Send className="h-4 w-4" aria-hidden="true" />
          )}
        </div>
        <Bookmark className="h-4 w-4" aria-hidden="true" />
      </div>

      {/* Caption excerpt under media (for feed context) */}
      {normalizedChannel !== 'linkedin' && (
        <div className="border-t border-[#F4F5FA] px-4 py-3 text-xs leading-relaxed text-[#2F324B]">
          <span className="mr-1.5 font-bold text-[#1C1D33]">{handle}</span>
          <span className="line-clamp-3 whitespace-pre-wrap">
            <HighlightedCaption caption={caption} />
          </span>
        </div>
      )}
    </div>
  );

  if (mode === 'phone') {
    return (
      <div className="mx-auto w-full max-w-[360px] rounded-[34px] border-[6px] border-[#1C1D33] bg-[#F5F6FC] p-2.5 shadow-sm">
        <div className="mx-auto mb-2.5 flex h-4 w-24 items-center justify-center rounded-full bg-[#1C1D33]" />
        {cardInner}
        <div className="mx-auto mt-2.5 h-1 w-24 rounded-full bg-[#D0D3E5]" />
      </div>
    );
  }

  return cardInner;
};
