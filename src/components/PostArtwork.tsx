import React from 'react';
import { CampaignPost } from '../data/campaignData';
import slowMorningsImg from '../assets/images/slow_mornings_post_1795061583964.jpg';
import launchDayImg from '../assets/images/launch_day_post_1795061582590.jpg';
import studioCraftImg from '../assets/images/studio_craft_post_1795061583355.jpg';
import weekendReminderImg from '../assets/images/weekend_reminder_post_1795061584039.jpg';

interface PostArtworkProps {
  artworkKey: CampaignPost['artworkKey'];
  compact?: boolean;
}

const ARTWORK_ASSETS: Record<
  CampaignPost['artworkKey'],
  {
    src: string;
    alt: string;
    eyebrow: string;
    headline: string;
    badge?: string;
  }
> = {
  'slow-mornings': {
    src: slowMorningsImg,
    alt: 'Sunlit morning table with handmade matte cream ceramic mug, oat linen napkin, and eucalyptus sprig',
    eyebrow: 'Spring ’26',
    headline: 'Slow Mornings',
  },
  'launch-day': {
    src: launchDayImg,
    alt: 'Speckled stoneware bowls and minimalist ceramic pitcher arranged on draped flax linen',
    eyebrow: 'April 15 · Live Now',
    headline: 'Linen & Stoneware',
    badge: '1 / 4',
  },
  'studio-craft': {
    src: studioCraftImg,
    alt: 'Ceramic artist brushing natural matte glaze onto a stoneware bowl inside a sunlit Portland studio',
    eyebrow: 'Studio Notes · Portland',
    headline: '400 small-batch glazes',
  },
  'weekend-reminder': {
    src: weekendReminderImg,
    alt: 'Neatly packed kraft parcel box with tissue-wrapped stoneware mug, twine, and note card ready for shipping',
    eyebrow: 'Ships Monday · 09:00',
    headline: 'First batch closes Sunday',
  },
};

export const PostArtwork: React.FC<PostArtworkProps> = ({ artworkKey, compact = false }) => {
  const asset = ARTWORK_ASSETS[artworkKey] ?? ARTWORK_ASSETS['slow-mornings'];

  return (
    <div
      className={`relative w-full overflow-hidden rounded-lg bg-[#ECEEF5] select-none ${
        compact ? 'aspect-square' : 'aspect-[4/4.2] min-h-[210px]'
      }`}
    >
      <img
        src={asset.src}
        alt={asset.alt}
        referrerPolicy="no-referrer"
        className="h-full w-full object-cover"
      />
      {!compact && (
        <>
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-[#161724]/75 via-[#161724]/30 to-transparent"
            aria-hidden="true"
          />
          <div className="absolute inset-x-4 bottom-4 flex items-end justify-between gap-2 text-white">
            <div>
              <div className="font-mono text-[10px] tracking-wider text-white/85 uppercase">
                {asset.eyebrow}
              </div>
              <div className="mt-0.5 font-serif text-[19px] font-semibold leading-tight text-white">
                {asset.headline}
              </div>
            </div>
            {asset.badge && (
              <span className="font-mono text-[10px] text-white/85 shrink-0">{asset.badge}</span>
            )}
          </div>
        </>
      )}
    </div>
  );
};
