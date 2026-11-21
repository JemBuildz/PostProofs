import React, { useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup } from 'firebase/auth';
import type { User } from 'firebase/auth';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Clock,
  FileText,
  Layers,
  Menu,
  RotateCcw,
  X,
} from 'lucide-react';
import {
  CampaignPost,
  FAQ_ITEMS,
  INITIAL_CAMPAIGN_POSTS,
  ReviewStatus,
} from '../data/campaignData';
import { auth, googleProvider } from '../lib/firebase';
import { getStatusMeta, HeroProofViewer } from './HeroProofViewer';
import { FooterInfoModal } from './Modals';
import postproofsLogo from '../assets/images/postproofs_logo.png';

interface LandingPageProps {
  onNavigate: (path: string) => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onNavigate }) => {
  const [posts, setPosts] = useState<CampaignPost[]>(INITIAL_CAMPAIGN_POSTS);
  const [selectedPostId, setSelectedPostId] = useState<string>(INITIAL_CAMPAIGN_POSTS[0].id);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);
  const [footerModal, setFooterModal] = useState<'privacy' | 'contact' | null>(null);
  const [signedInUser, setSignedInUser] = useState<User | null>(() => auth.currentUser);
  const [enteringWorkspace, setEnteringWorkspace] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(auth, (firebaseUser) => {
      setSignedInUser(firebaseUser);
    });
  }, []);

  const handleEnterWorkspace = (targetPath: string) => {
    if (enteringWorkspace) return;
    if (auth.currentUser || signedInUser) {
      onNavigate(targetPath);
      return;
    }

    setEnteringWorkspace(true);
    // Trigger signInWithPopup synchronously inside the click handler so browsers allow the popup.
    signInWithPopup(auth, googleProvider)
      .then((cred) => {
        if (cred.user) {
          onNavigate(targetPath);
        }
      })
      .catch((err: unknown) => {
        const code =
          typeof err === 'object' && err !== null && 'code' in err
            ? String((err as { code?: unknown }).code)
            : '';
        // If user closed/canceled Google sign-in, stay on the landing page;
        // if popup was blocked or another error occurred, fall back to /app sign-in view.
        if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
          onNavigate(targetPath);
        }
      })
      .finally(() => {
        setEnteringWorkspace(false);
      });
  };

  const handleUpdateStatus = (postId: string, status: ReviewStatus) => {
    setPosts((prev) =>
      prev.map((post) => (post.id === postId ? { ...post, status } : post))
    );
  };

  const handleAddComment = (postId: string, text: string) => {
    setPosts((prev) =>
      prev.map((post) =>
        post.id === postId
          ? {
              ...post,
              comments: [
                ...post.comments,
                {
                  id: `c-${Date.now()}`,
                  author: 'Jamie',
                  role: 'Client',
                  text,
                  timestamp: 'Just now',
                },
              ],
            }
          : post
      )
    );
  };

  const inspectPostInHero = (postId: string) => {
    setSelectedPostId(postId);
    const heroEl = document.getElementById('live-proof');
    if (heroEl) {
      heroEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const approvedCount = posts.filter((p) => p.status === 'approved').length;
  const changesCount = posts.filter((p) => p.status === 'changes_requested').length;

  return (
    <div id="top" className="min-h-screen bg-white text-[#1C1D33]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-[#1C1D33] focus:shadow-md"
      >
        Skip to content
      </a>

      {/* Strict 3-Zone Top Navigation Bar */}
      <header className="sticky top-0 z-30 border-b border-[#ECEDF4] bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex h-[68px] max-w-[1200px] items-center justify-between gap-8 px-6">
          {/* Zone 1: Brand Wordmark */}
          <a href="#top" aria-label="PostProofs home" className="whitespace-nowrap shrink-0">
            <span className="inline-flex items-center whitespace-nowrap shrink-0">
              <img
                src={postproofsLogo}
                alt="postproofs"
                className="h-12 w-auto object-contain"
              />
            </span>
          </a>

          {/* Zone 2: Concise Single-Line Navigation Links */}
          <nav className="hidden items-center gap-7 md:flex" aria-label="Main navigation">
            <a
              href="#how-it-works"
              className="text-sm font-medium text-[#555870] transition-colors hover:text-[#1C1D33] hover:underline hover:underline-offset-4 whitespace-nowrap shrink-0"
            >
              How it works
            </a>
            <a
              href="#who-its-for"
              className="text-sm font-medium text-[#555870] transition-colors hover:text-[#1C1D33] hover:underline hover:underline-offset-4 whitespace-nowrap shrink-0"
            >
              Who it’s for
            </a>
            <a
              href="#pricing"
              className="text-sm font-medium text-[#555870] transition-colors hover:text-[#1C1D33] hover:underline hover:underline-offset-4 whitespace-nowrap shrink-0"
            >
              Pricing
            </a>
            <a
              href="#faq"
              className="text-sm font-medium text-[#555870] transition-colors hover:text-[#1C1D33] hover:underline hover:underline-offset-4 whitespace-nowrap shrink-0"
            >
              FAQ
            </a>
          </nav>

          {/* Zone 3: Single Primary Action */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              disabled={enteringWorkspace}
              onClick={() => handleEnterWorkspace('/app')}
              className="hidden h-10 items-center justify-center gap-2 rounded-xl bg-[#5B42DC] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#4931C2] disabled:opacity-60 whitespace-nowrap shrink-0 md:inline-flex cursor-pointer"
            >
              {enteringWorkspace ? 'Signing in…' : 'Open workspace'}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => setMobileNavOpen((prev) => !prev)}
              aria-expanded={mobileNavOpen}
              aria-controls="mobile-nav-drawer"
              aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#E2E4F0] text-[#1C1D33] md:hidden cursor-pointer"
            >
              {mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Drawer */}
        {mobileNavOpen && (
          <nav
            id="mobile-nav-drawer"
            aria-label="Mobile navigation"
            className="border-t border-[#ECEDF4] bg-white px-6 py-4 md:hidden"
          >
            <div className="flex flex-col divide-y divide-[#F1F2F8]">
              <a
                href="#how-it-works"
                onClick={() => setMobileNavOpen(false)}
                className="py-3 text-sm font-semibold text-[#2E304A]"
              >
                How it works
              </a>
              <a
                href="#who-its-for"
                onClick={() => setMobileNavOpen(false)}
                className="py-3 text-sm font-semibold text-[#2E304A]"
              >
                Who it’s for
              </a>
              <a
                href="#pricing"
                onClick={() => setMobileNavOpen(false)}
                className="py-3 text-sm font-semibold text-[#2E304A]"
              >
                Pricing
              </a>
              <a
                href="#faq"
                onClick={() => setMobileNavOpen(false)}
                className="py-3 text-sm font-semibold text-[#2E304A]"
              >
                FAQ
              </a>
            </div>
            <button
              type="button"
              disabled={enteringWorkspace}
              onClick={() => {
                setMobileNavOpen(false);
                handleEnterWorkspace('/app');
              }}
              className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#5B42DC] px-4 text-sm font-semibold text-white disabled:opacity-60 cursor-pointer"
            >
              {enteringWorkspace ? 'Signing in…' : 'Open workspace'}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </nav>
        )}
      </header>

      <main id="main">
        {/* Hero Section */}
        <section className="border-b border-[#ECEDF4] bg-[#FAFBFD] py-16 lg:py-20">
          <div className="mx-auto grid max-w-[1200px] grid-cols-1 items-center gap-12 px-6 lg:grid-cols-12 lg:gap-10">
            {/* Left Proposition */}
            <div className="lg:col-span-5">
              <p className="text-[13px] font-semibold text-[#5B42DC]">
                Early access{' '}
                <span className="mx-1.5 text-[#B4B7CB]" aria-hidden="true">
                  ·
                </span>{' '}
                Client approvals, minus the chaos
              </p>

              <h1 className="mt-4 text-[clamp(2.4rem,4vw,3.65rem)] font-extrabold leading-[1.04] tracking-[-0.04em] text-[#1C1D33]">
                Get social posts approved without the file shuffle.
              </h1>

              <p className="mt-5 max-w-[46ch] text-[17px] leading-[1.68] text-[#555870]">
                Turn your planned posts into clean, shareable proofs. Clients can approve or request
                changes in one place, and you can see what’s still waiting.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={enteringWorkspace}
                  onClick={() => handleEnterWorkspace('/app')}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#5B42DC] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#4931C2] disabled:opacity-60 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Create a review link
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>
                <a
                  href="#how-it-works"
                  className="inline-flex h-12 items-center justify-center rounded-xl border border-[#DCDEEB] bg-white px-5 text-sm font-semibold text-[#23253E] transition-colors hover:border-[#C2B8FA] hover:text-[#4D34CE] whitespace-nowrap shrink-0"
                >
                  See how it works
                </a>
              </div>

              <p className="mt-5 text-[13px] leading-relaxed text-[#6E718A]">
                <strong className="font-semibold text-[#3C3F57]">
                  No social account connection.
                </strong>{' '}
                No auto-publishing. Just a clearer review step.
              </p>
            </div>

            {/* Right Interactive Product Proof */}
            <div id="live-proof" className="lg:col-span-7">
              <HeroProofViewer
                posts={posts}
                selectedPostId={selectedPostId}
                onSelectPost={setSelectedPostId}
                onUpdateStatus={handleUpdateStatus}
                onAddComment={handleAddComment}
              />
            </div>
          </div>
        </section>

        {/* Value & Capabilities Section — Asymmetric Editorial Grid */}
        <section className="py-20 lg:py-24" aria-labelledby="problem-title">
          <div className="mx-auto max-w-[1200px] px-6">
            <div className="max-w-2xl">
              <p className="text-[13px] font-semibold text-[#5B42DC]">
                Less chasing, clearer feedback
              </p>
              <h2
                id="problem-title"
                className="mt-2.5 text-[clamp(1.9rem,3.2vw,2.75rem)] font-bold leading-[1.12] tracking-[-0.035em] text-[#1C1D33]"
              >
                Keep the review process in one place.
              </h2>
              <p className="mt-4 text-base leading-[1.7] text-[#5B5E77]">
                When copy, visuals, and comments are scattered across files and messages, it’s
                harder to know which version is ready. Give every post a clear preview and status.
              </p>
            </div>

            <div className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-12">
              <article className="flex flex-col justify-between rounded-2xl border border-[#E5E6F0] bg-[#FAFBFD] p-7 sm:p-8 lg:col-span-7">
                <div>
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#E2E0F7] bg-white text-[#5B42DC]">
                    <FileText className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <h3 className="mt-5 text-2xl font-bold tracking-[-0.025em] text-[#1C1D33]">
                    Stop sending a new PDF for every round
                  </h3>
                  <p className="mt-3 max-w-[52ch] text-[15px] leading-[1.7] text-[#575A73]">
                    Share one review page so your client always sees the current post proof and
                    leaves feedback directly where it belongs—no re-exporting slides or digging
                    through email threads named “v4_final_FINAL.pdf”.
                  </p>
                </div>

                <div className="mt-8 grid grid-cols-1 gap-4 border-t border-[#E6E7F2] pt-6 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold text-[#7A7D96]">Before PostProofs</p>
                    <p className="mt-1.5 text-sm leading-relaxed text-[#575A73]">
                      Spreadsheet copy + Drive folder + three email replies with conflicting edits.
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-[#5B42DC]">With one review link</p>
                    <p className="mt-1.5 text-sm leading-relaxed text-[#1C1D33]">
                      Live caption, visual preview, client notes, and sign-off in a single URL.
                    </p>
                  </div>
                </div>
              </article>

              <div className="flex flex-col gap-6 lg:col-span-5">
                <article className="flex-1 rounded-2xl border border-[#E5E6F0] bg-white p-7">
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#E2E0F7] bg-[#F7F5FF] text-[#5B42DC]">
                    <Check className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <h3 className="mt-5 text-lg font-bold tracking-[-0.02em] text-[#1C1D33]">
                    Make the next action obvious
                  </h3>
                  <p className="mt-2.5 text-sm leading-[1.7] text-[#575A73]">
                    See at a glance which posts are approved and which need another pass without
                    scanning long email chains or color-coded spreadsheet cells.
                  </p>
                </article>

                <article className="flex-1 rounded-2xl border border-[#E5E6F0] bg-white p-7">
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#E2E0F7] bg-[#F7F5FF] text-[#5B42DC]">
                    <Layers className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <h3 className="mt-5 text-lg font-bold tracking-[-0.02em] text-[#1C1D33]">
                    Keep content and context together
                  </h3>
                  <p className="mt-2.5 text-sm leading-[1.7] text-[#575A73]">
                    Review the post creative alongside its caption, channel, publish date, and
                    client comments—so small mistakes are caught before scheduling.
                  </p>
                </article>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works — 4-Step Editorial Workflow */}
        <section
          id="how-it-works"
          className="border-y border-[#ECEDF4] bg-[#FAFBFD] py-20 lg:py-24"
          aria-labelledby="how-title"
        >
          <div className="mx-auto max-w-[1200px] px-6">
            <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
              <div className="max-w-xl">
                <p className="text-[13px] font-semibold text-[#5B42DC]">A simple workflow</p>
                <h2
                  id="how-title"
                  className="mt-2.5 text-[clamp(1.9rem,3.2vw,2.75rem)] font-bold leading-[1.12] tracking-[-0.035em] text-[#1C1D33]"
                >
                  From content calendar to client sign-off.
                </h2>
              </div>
              <p className="max-w-md text-[15px] leading-[1.7] text-[#5B5E77]">
                Start with the planning tools you already use. Add a focused review step before
                scheduling and publishing.
              </p>
            </div>

            <ol className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  num: '01',
                  title: 'Bring in your posts',
                  body: 'Add your planned posts with caption, channel, target date, and creative assets.',
                },
                {
                  num: '02',
                  title: 'Prepare the proof',
                  body: 'Turn each planned post into a consistent visual preview your client can read at a glance.',
                },
                {
                  num: '03',
                  title: 'Share one link',
                  body: 'Send a single private, revocable review URL for the entire campaign—no attachments to track.',
                },
                {
                  num: '04',
                  title: 'Track the decision',
                  body: 'See what is approved and what needs changes before you move posts into your scheduler.',
                },
              ].map((step) => (
                <li
                  key={step.num}
                  className="flex flex-col rounded-2xl border border-[#E5E6F0] bg-white p-6"
                >
                  <span className="font-mono text-sm font-medium tabular-nums text-[#5B42DC]">
                    {step.num}
                  </span>
                  <h3 className="mt-4 text-lg font-bold tracking-[-0.02em] text-[#1C1D33]">
                    {step.title}
                  </h3>
                  <p className="mt-2.5 text-sm leading-[1.7] text-[#5B5E77]">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Who It's For + Live-Synced Campaign Status Panel */}
        <section id="who-its-for" className="py-20 lg:py-24" aria-labelledby="fit-title">
          <div className="mx-auto grid max-w-[1200px] grid-cols-1 items-center gap-12 px-6 lg:grid-cols-12">
            <div className="lg:col-span-6">
              <p className="text-[13px] font-semibold text-[#5B42DC]">Built for the review step</p>
              <h2
                id="fit-title"
                className="mt-2.5 max-w-[18ch] text-[clamp(1.9rem,3.2vw,2.75rem)] font-bold leading-[1.12] tracking-[-0.035em] text-[#1C1D33]"
              >
                For small teams who plan in spreadsheets and design elsewhere.
              </h2>
              <p className="mt-4 max-w-[50ch] text-[15px] leading-[1.75] text-[#5B5E77]">
                PostProofs is a focused client-review space for social media freelancers and small
                agencies. Keep your existing planning and publishing tools; use this to make the
                approval handoff easier to follow.
              </p>

              <ul className="mt-7 space-y-3.5">
                {[
                  'One review link for the campaign instead of a chain of attachments.',
                  'A clear status for every post that is approved, awaiting review, or needs changes.',
                  'No social OAuth or publishing integration required to get started.',
                ].map((point) => (
                  <li
                    key={point}
                    className="flex items-start gap-3 text-[15px] leading-relaxed text-[#383B54]"
                  >
                    <Check
                      className="mt-1 h-4 w-4 shrink-0 text-[#1E6F4A]"
                      strokeWidth={2.4}
                      aria-hidden="true"
                    />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="lg:col-span-6">
              <div
                className="rounded-2xl border border-[#E2E4F0] bg-[#FAFBFD] p-6 sm:p-8"
                aria-label="Live campaign approval status synced with the interactive proof above"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-[#6F728A]">Synced campaign overview</p>
                    <h3 className="mt-1 text-2xl font-bold tracking-[-0.03em] text-[#1C1D33]">
                      Spring content · Week 2 · {posts.length} posts
                    </h3>
                  </div>
                  <p className="font-mono text-xs tabular-nums text-[#5D607A]">
                    {approvedCount} approved · {changesCount} changes
                  </p>
                </div>

                <div className="mt-6 divide-y divide-[#E7E9F3] border-y border-[#E7E9F3]">
                  {posts.map((post) => {
                    const meta = getStatusMeta(post.status);
                    const isSelected = post.id === selectedPostId;
                    return (
                      <button
                        key={post.id}
                        type="button"
                        onClick={() => inspectPostInHero(post.id)}
                        className={`group flex w-full items-center justify-between gap-4 py-3.5 text-left transition-colors cursor-pointer ${
                          isSelected ? 'text-[#1C1D33]' : 'text-[#2D3049] hover:text-[#1C1D33]'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold group-hover:text-[#5B42DC]">
                              {post.title}
                            </span>
                            <ArrowUpRight
                              className="h-3.5 w-3.5 shrink-0 text-[#9FA2B8] opacity-0 transition-opacity group-hover:opacity-100"
                              aria-hidden="true"
                            />
                          </div>
                          <p className="mt-0.5 text-xs text-[#6E718A] font-mono tabular-nums">
                            {post.channel} · {post.scheduledDate}
                          </p>
                        </div>

                        <span
                          className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold whitespace-nowrap ${meta.textClass}`}
                        >
                          {meta.icon === 'check' && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                          {meta.icon === 'alert' && (
                            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                          {meta.icon === 'clock' && <Clock className="h-3.5 w-3.5" aria-hidden="true" />}
                          {meta.label}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <p className="mt-4 text-xs text-[#6E718A]">
                  Select any post above to inspect or update its approval status in the interactive
                  preview.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Pricing Section */}
        <section
          id="pricing"
          className="border-y border-[#ECEDF4] bg-[#FAFBFD] py-20 lg:py-24"
          aria-labelledby="pricing-title"
        >
          <div className="mx-auto max-w-[1200px] px-6">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-[13px] font-semibold text-[#5B42DC]">Early access pricing</p>
              <h2
                id="pricing-title"
                className="mt-2.5 text-[clamp(1.9rem,3.2vw,2.75rem)] font-bold leading-[1.12] tracking-[-0.035em] text-[#1C1D33]"
              >
                Pick a plan that fits your client list.
              </h2>
              <p className="mt-4 text-base leading-[1.7] text-[#5B5E77]">
                Start free with 1 campaign and up to 5 posts, or upgrade for higher active campaign,
                post proof, and image storage capacity. Cancel anytime.
              </p>
            </div>

            <div className="mx-auto mt-12 grid max-w-[780px] grid-cols-1 gap-6 md:grid-cols-2">
              <article className="flex flex-col rounded-2xl border border-[#DFE1EC] bg-white p-7 sm:p-8">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-xl font-bold text-[#1C1D33]">Solo</h3>
                  <span className="text-xs font-medium text-[#70738C]">Independent freelancers</span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-[#5B5E77]">
                  For freelancers reviewing posts with a handful of clients.
                </p>

                <div className="mt-6 flex items-baseline gap-1.5 font-mono tabular-nums">
                  <span className="font-[family-name:var(--font-display)] text-[44px] font-extrabold leading-none tracking-[-0.04em] text-[#1C1D33]">
                    $12
                  </span>
                  <span className="text-sm text-[#6E718A]">/ month</span>
                </div>
                <p className="mt-2 text-xs text-[#787B93]">Monthly billing · cancel anytime</p>

                <button
                  type="button"
                  disabled={enteringWorkspace}
                  onClick={() => handleEnterWorkspace('/app?plan=solo')}
                  className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-[#D8DAEA] bg-white text-sm font-semibold text-[#1C1D33] transition-colors hover:border-[#5B42DC] hover:text-[#5B42DC] disabled:opacity-60 cursor-pointer"
                >
                  Choose Solo
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>

                <div className="mt-7 border-t border-[#ECEDF4] pt-6">
                  <p className="text-xs font-semibold text-[#6E718A]">Includes</p>
                  <ul className="mt-3.5 space-y-3 text-sm text-[#43465E]">
                    {[
                      'Up to 3 active campaigns',
                      'Up to 100 saved post proofs',
                      '250 MB private image storage',
                      'Shareable revocable review links and approval status',
                    ].map((item) => (
                      <li key={item} className="flex items-start gap-2.5">
                        <Check
                          className="mt-0.5 h-4 w-4 shrink-0 text-[#1E6F4A]"
                          aria-hidden="true"
                        />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </article>

              <article className="flex flex-col rounded-2xl border-2 border-[#5B42DC] bg-white p-7 sm:p-8">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-xl font-bold text-[#1C1D33]">Studio</h3>
                  <span className="text-xs font-semibold text-[#5B42DC]">High-volume managers</span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-[#5B5E77]">
                  For active creators managing multiple client calendars at once.
                </p>

                <div className="mt-6 flex items-baseline gap-1.5 font-mono tabular-nums">
                  <span className="font-[family-name:var(--font-display)] text-[44px] font-extrabold leading-none tracking-[-0.04em] text-[#1C1D33]">
                    $29
                  </span>
                  <span className="text-sm text-[#6E718A]">/ month</span>
                </div>
                <p className="mt-2 text-xs text-[#787B93]">Monthly billing · cancel anytime</p>

                <button
                  type="button"
                  disabled={enteringWorkspace}
                  onClick={() => handleEnterWorkspace('/app?plan=studio')}
                  className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#5B42DC] text-sm font-semibold text-white transition-colors hover:bg-[#4931C2] disabled:opacity-60 cursor-pointer"
                >
                  Choose Studio
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>

                <div className="mt-7 border-t border-[#ECEDF4] pt-6">
                  <p className="text-xs font-semibold text-[#6E718A]">Everything in Solo, plus</p>
                  <ul className="mt-3.5 space-y-3 text-sm text-[#43465E]">
                    {[
                      'Up to 10 active campaigns',
                      'Up to 500 saved post proofs',
                      '1,024 MB private image storage',
                      'Private revocable client links & URL image imports',
                    ].map((item) => (
                      <li key={item} className="flex items-start gap-2.5">
                        <Check
                          className="mt-0.5 h-4 w-4 shrink-0 text-[#1E6F4A]"
                          aria-hidden="true"
                        />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </article>
            </div>

            <p className="mx-auto mt-8 max-w-xl text-center text-xs leading-relaxed text-[#72758D]">
              Subscriptions are processed via Stripe Checkout in test mode and enforced server-side.
            </p>
          </div>
        </section>

        {/* FAQ Section */}
        <section id="faq" className="py-20 lg:py-24" aria-labelledby="faq-title">
          <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-10 px-6 lg:grid-cols-12 lg:gap-12">
            <div className="lg:col-span-4">
              <p className="text-[13px] font-semibold text-[#5B42DC]">Questions</p>
              <h2
                id="faq-title"
                className="mt-2.5 text-[clamp(1.9rem,3vw,2.5rem)] font-bold leading-[1.12] tracking-[-0.035em] text-[#1C1D33]"
              >
                Good to know.
              </h2>
              <p className="mt-3.5 text-[15px] leading-[1.7] text-[#5B5E77]">
                Straight answers about how the early-access workflow handles campaigns, client
                access, and billing.
              </p>
            </div>

            <div className="divide-y divide-[#E7E9F3] border-y border-[#E7E9F3] lg:col-span-8">
              {FAQ_ITEMS.map((item, idx) => {
                const isOpen = openFaqIndex === idx;
                return (
                  <div key={item.question}>
                    <button
                      type="button"
                      onClick={() => setOpenFaqIndex(isOpen ? null : idx)}
                      aria-expanded={isOpen}
                      className="flex w-full items-center justify-between gap-4 py-5 text-left text-[15px] font-semibold text-[#1C1D33] transition-colors hover:text-[#5B42DC] cursor-pointer"
                    >
                      <span>{item.question}</span>
                      <ChevronDown
                        className={`h-4 w-4 shrink-0 text-[#5B42DC] transition-transform duration-150 ${
                          isOpen ? 'rotate-180' : ''
                        }`}
                        aria-hidden="true"
                      />
                    </button>
                    {isOpen && (
                      <p className="pb-5 pr-8 text-sm leading-[1.75] text-[#575A73]">
                        {item.answer}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="pb-20 lg:pb-24">
          <div className="mx-auto max-w-[1200px] px-6">
            <div className="rounded-3xl bg-[#242242] px-7 py-14 text-center text-white sm:px-12 sm:py-16">
              <h2 className="mx-auto max-w-xl text-[clamp(1.9rem,3.4vw,2.75rem)] font-bold leading-[1.12] tracking-[-0.03em] text-white">
                Make the approval step easier to follow.
              </h2>
              <p className="mx-auto mt-4 max-w-lg text-[15px] leading-[1.7] text-[#D1D2E5]">
                Give every post a clear proof, one place for feedback, and an easy-to-spot status
                before it gets scheduled.
              </p>
              <div className="mt-8">
                <button
                  type="button"
                  disabled={enteringWorkspace}
                  onClick={() => handleEnterWorkspace('/app')}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-white px-6 text-sm font-semibold text-[#1E1D38] transition-colors hover:bg-[#EEECFF] disabled:opacity-60 cursor-pointer"
                >
                  Open creator workspace
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Quiet Footer */}
      <footer className="border-t border-[#ECEDF4] bg-white py-8">
        <div className="mx-auto flex max-w-[1200px] flex-col items-start justify-between gap-4 px-6 sm:flex-row sm:items-center">
          <a href="#top" aria-label="Back to top">
            <span className="inline-flex items-center whitespace-nowrap shrink-0">
              <img
                src={postproofsLogo}
                alt="postproofs"
                className="h-9 w-auto object-contain"
              />
            </span>
          </a>

          <p className="text-xs text-[#6F728A]">
            © {new Date().getFullYear()} PostProofs. A focused client-review workflow.
          </p>

          <div className="flex items-center gap-6 text-xs font-medium text-[#5A5D75]">
            <button
              type="button"
              onClick={() => setFooterModal('privacy')}
              className="transition-colors hover:text-[#5B42DC] cursor-pointer"
            >
              Privacy
            </button>
            <button
              type="button"
              onClick={() => setFooterModal('contact')}
              className="transition-colors hover:text-[#5B42DC] cursor-pointer"
            >
              Contact
            </button>
          </div>
        </div>
      </footer>

      <FooterInfoModal mode={footerModal} onClose={() => setFooterModal(null)} />
    </div>
  );
};
