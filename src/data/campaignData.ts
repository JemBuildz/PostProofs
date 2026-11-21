export type ReviewStatus = 'in_review' | 'approved' | 'changes_requested';

export interface PostComment {
  id: string;
  author: string;
  role: 'Client' | 'Creator';
  text: string;
  timestamp: string;
}

export interface CampaignPost {
  id: string;
  title: string;
  channel: 'Instagram' | 'LinkedIn';
  format: string;
  scheduledDate: string;
  scheduledTime: string;
  caption: string;
  hashtags: string[];
  status: ReviewStatus;
  artworkKey: 'slow-mornings' | 'launch-day' | 'studio-craft' | 'weekend-reminder';
  comments: PostComment[];
}

export const INITIAL_CAMPAIGN_POSTS: CampaignPost[] = [
  {
    id: 'post-1',
    title: 'Slow mornings stoneware teaser',
    channel: 'Instagram',
    format: '4:5 Feed Post',
    scheduledDate: 'Apr 14',
    scheduledTime: '09:00 AM',
    caption:
      'Quiet routines deserve vessels that hold warmth a little longer. Our Spring ’26 matte stoneware mugs open for early access tomorrow at 10 AM PT.',
    hashtags: ['#SlowMornings', '#SmallBatchCeramics'],
    status: 'approved',
    artworkKey: 'slow-mornings',
    comments: [
      {
        id: 'c-1',
        author: 'Jamie',
        role: 'Client',
        text: 'Love this caption and the sunlit mug framing—approved to schedule.',
        timestamp: '2h ago',
      },
    ],
  },
  {
    id: 'post-2',
    title: 'Spring collection launch teaser',
    channel: 'Instagram',
    format: '4:5 Feed Post',
    scheduledDate: 'Apr 15',
    scheduledTime: '10:00 AM',
    caption:
      'The Linen & Stoneware collection is officially live. Four hand-thrown table essentials glazed in oat, pebble, and warm birch—crafted to mix across every meal.',
    hashtags: ['#SpringLaunch', '#TablewareDesign'],
    status: 'changes_requested',
    artworkKey: 'launch-day',
    comments: [
      {
        id: 'c-2',
        author: 'Jamie',
        role: 'Client',
        text: 'Can we mention free domestic shipping over $75 in the second sentence?',
        timestamp: '45m ago',
      },
    ],
  },
  {
    id: 'post-3',
    title: 'Behind the glaze studio notes',
    channel: 'LinkedIn',
    format: 'Single Image Post',
    scheduledDate: 'Apr 17',
    scheduledTime: '11:30 AM',
    caption:
      'Over 400 glaze tests went into our matte oat finish. Sharing a closer look from our Portland kiln studio on how we source local clay and cut water waste by 38%.',
    hashtags: ['#Craftsmanship', '#SustainableDesign'],
    status: 'in_review',
    artworkKey: 'studio-craft',
    comments: [
      {
        id: 'c-3',
        author: 'Alex',
        role: 'Creator',
        text: 'Ready for your quick check on the 38% sustainability stat before Thursday.',
        timestamp: '1h ago',
      },
    ],
  },
  {
    id: 'post-4',
    title: 'First batch shipping reminder',
    channel: 'Instagram',
    format: '4:5 Feed Post',
    scheduledDate: 'Apr 19',
    scheduledTime: '04:00 PM',
    caption:
      'Packing the first kiln run now. Orders placed by Sunday at midnight ship out Monday morning at 9:00 AM in plastic-free kraft wrap.',
    hashtags: ['#SmallBatch', '#ShipsMonday'],
    status: 'in_review',
    artworkKey: 'weekend-reminder',
    comments: [],
  },
];

export const FAQ_ITEMS: Array<{ question: string; answer: string }> = [
  {
    question: 'Do my clients need to create an account to review posts?',
    answer:
      'No. You share one private, revocable link for the campaign. Your client opens it directly in their browser to inspect each post, leave comments, and click Approve or Request changes.',
  },
  {
    question: 'Does PostProofs connect to Instagram or auto-publish posts?',
    answer:
      'No. PostProofs stays focused on the client review and sign-off step before scheduling. You never have to connect social OAuth tokens or hand over publishing permissions.',
  },
  {
    question: 'Can I revoke a client link if I sent it to the wrong person?',
    answer:
      'Yes. You can revoke any review link in one click—immediately cutting off access to both the campaign posts and uploaded images—or rotate it to generate a fresh URL while keeping all saved feedback.',
  },
  {
    question: 'How do plan limits and subscriptions work?',
    answer:
      'Every account starts free with 1 active campaign, up to 5 saved post proofs, and 25 MB of image storage. Solo ($12/mo) unlocks 3 campaigns, 100 post proofs, and 250 MB storage; Studio ($29/mo) unlocks 10 campaigns, 500 post proofs, and 1,024 MB storage. Billing runs via Stripe Checkout and limits are enforced server-side.',
  },
];
