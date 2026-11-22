import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, sendEmailVerification, signInWithPopup, signOut } from 'firebase/auth';
import type { User } from 'firebase/auth';
import {
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  ExternalLink,
  Eye,
  FolderPlus,
  ImageOff,
  Link2,
  Link2Off,
  LogOut,
  MailWarning,
  Menu,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings,
  Share2,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { api, ApiError } from '../lib/api';
import type { BillingStatusResponse } from '../lib/api';
import {
  getInitialStripeReturnNotice,
  parseStripeReturnParams,
  resolveStripeReturnNotice,
} from '../lib/billingReturn';
import type { CheckoutSessionCheckResult, ParsedStripeReturn } from '../lib/billingReturn';
import { resolveSelectedCampaignId, resolveWorkspaceTab } from '../lib/workspaceState';
import type { WorkspaceTab } from '../lib/workspaceState';
import { auth, googleProvider } from '../lib/firebase';
import postproofsLogo from '../assets/images/postproofs_logo.png';
import { WorkspaceSettings } from './WorkspaceSettings';
import { ApprovedVaultView } from './ApprovedVaultView';
import { ClientPortalsView } from './ClientPortalsView';
import {
  CampaignBatchFooterBar,
  CampaignViewToolbar,
  KanbanBoardView,
  WeekGridView,
} from './CampaignProofViews';
import type { CampaignViewMode } from './CampaignProofViews';
import { PendingApprovalsHub } from './PendingApprovalsHub';
import { PostProofDetailModal } from './PostProofDetailModal';
import {
  ALLOWED_CHANNELS,
  subscribeCreatorBilling,
  subscribeCreatorCampaignPosts,
  subscribeCreatorCampaigns,
} from '../lib/firestoreRepo';
import type {
  FirebaseCampaign,
  FirebasePost,
  PostApprovalStatus,
  SocialChannel,
} from '../lib/firestoreRepo';

interface CreatorWorkspaceProps {
  pathname: string;
  search: string;
  onNavigate: (path: string, options?: { replace?: boolean }) => void;
}

const SELECTED_CAMPAIGN_STORAGE_KEY = 'postproofs_selected_campaign_id';

function readStoredCampaignId(): string | null {
  try {
    return window.sessionStorage.getItem(SELECTED_CAMPAIGN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredCampaignId(id: string | null): void {
  try {
    if (id) {
      window.sessionStorage.setItem(SELECTED_CAMPAIGN_STORAGE_KEY, id);
    } else {
      window.sessionStorage.removeItem(SELECTED_CAMPAIGN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors in restricted browsing modes
  }
}

function PostStatusText({ status }: { status: PostApprovalStatus }) {
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
        Needs changes
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

function Thumbnail({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (failed || !src) {
    return (
      <div className="flex aspect-square w-full items-center justify-center rounded-xl border border-[#E5E6F0] bg-[#F4F5FA] text-[#7D8099]">
        <ImageOff className="h-5 w-5" aria-hidden="true" />
      </div>
    );
  }
  return (
    <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl border border-[#E5E6F0] bg-[#F8F9FD]">
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

function formatPlanLabel(plan: BillingStatusResponse['subscriptionPlan']): string {
  if (plan === 'studio') return 'Studio ($29/mo)';
  if (plan === 'solo') return 'Solo ($12/mo)';
  return 'Free starter';
}

function formatStatusLabel(status: BillingStatusResponse['subscriptionStatus']): string {
  switch (status) {
    case 'active':
      return 'Active';
    case 'trialing':
      return 'Trialing';
    case 'past_due':
      return 'Past due';
    case 'canceled':
      return 'Canceled';
    case 'unpaid':
      return 'Unpaid';
    default:
      return 'No paid subscription';
  }
}

export const CreatorWorkspace: React.FC<CreatorWorkspaceProps> = ({
  pathname,
  search,
  onNavigate,
}) => {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');

  const activeTab = resolveWorkspaceTab(pathname);
  const [campaigns, setCampaigns] = useState<FirebaseCampaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignIdState] = useState<string | null>(
    readStoredCampaignId
  );
  const [postsByCampaignId, setPostsByCampaignId] = useState<Record<string, FirebasePost[]>>({});
  const [campaignViewMode, setCampaignViewMode] = useState<CampaignViewMode>('week');
  const [campaignChannelFilter, setCampaignChannelFilter] = useState('All');
  const [campaignSearchQuery, setCampaignSearchQuery] = useState('');
  const [showNewCampaignModal, setShowNewCampaignModal] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [inspectedTarget, setInspectedTarget] = useState<{
    campaignId: string;
    postId: string;
  } | null>(null);
  const [workspaceError, setWorkspaceError] = useState('');

  const setSelectedCampaignId = useCallback(
    (next: string | null | ((prev: string | null) => string | null)) => {
      setSelectedCampaignIdState((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next;
        writeStoredCampaignId(resolved);
        return resolved;
      });
    },
    []
  );

  const openTab = useCallback(
    (tab: WorkspaceTab, options?: { replace?: boolean }) => {
      const target =
        tab === 'pending'
          ? '/app/pending'
          : tab === 'approved'
            ? '/app/approved'
            : tab === 'portals'
              ? '/app/portals'
              : tab === 'billing'
                ? '/app/billing'
                : tab === 'settings'
                  ? '/app/settings'
                  : '/app';
      setMobileNavOpen(false);
      onNavigate(target, options);
    },
    [onNavigate]
  );

  // Server-authoritative billing status (keyed by Firebase UID)
  const [billingStatus, setBillingStatus] = useState<BillingStatusResponse | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingBusyPlan, setBillingBusyPlan] = useState<'solo' | 'studio' | 'portal' | null>(null);
  const [highlightedPlan, setHighlightedPlan] = useState<'solo' | 'studio' | null>(null);
  const [billingNotice, setBillingNotice] = useState('');
  const [billingError, setBillingError] = useState('');

  // Campaign creation & rename state
  const [newCampaignName, setNewCampaignName] = useState('');
  const [newClientName, setNewClientName] = useState('');
  const [campaignError, setCampaignError] = useState('');
  const [campaignUpgradePrompt, setCampaignUpgradePrompt] = useState(false);
  const [campaignBusy, setCampaignBusy] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState(false);
  const [editCampaignName, setEditCampaignName] = useState('');
  const [editClientName, setEditClientName] = useState('');
  const [editCampaignBusy, setEditCampaignBusy] = useState(false);

  // Manual post entry & post edit form state
  const [showPostForm, setShowPostForm] = useState(false);
  const [postTitle, setPostTitle] = useState('');
  const [postChannel, setPostChannel] = useState<SocialChannel>('Instagram');
  const [postDate, setPostDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [postCaption, setPostCaption] = useState('');
  const [imageMode, setImageMode] = useState<'upload' | 'url'>('upload');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState('');
  const [postError, setPostError] = useState('');
  const [postUpgradePrompt, setPostUpgradePrompt] = useState(false);
  const [postBusy, setPostBusy] = useState(false);

  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editPostTitle, setEditPostTitle] = useState('');
  const [editPostChannel, setEditPostChannel] = useState<SocialChannel>('Instagram');
  const [editPostDate, setEditPostDate] = useState('');
  const [editPostCaption, setEditPostCaption] = useState('');
  const [editPostBusy, setEditPostBusy] = useState(false);

  // Link, deletion confirmations, verification & comment UI state
  const [linkBusy, setLinkBusy] = useState(false);
  const [confirmLinkAction, setConfirmLinkAction] = useState<'revoke' | 'rotate' | null>(null);
  const [confirmDeleteCampaignId, setConfirmDeleteCampaignId] = useState<string | null>(null);
  const [deleteCampaignBusy, setDeleteCampaignBusy] = useState(false);
  const [confirmDeletePostId, setConfirmDeletePostId] = useState<string | null>(null);
  const [deletePostBusy, setDeletePostBusy] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [verifyBannerBusy, setVerifyBannerBusy] = useState(false);
  const [verifyBannerMessage, setVerifyBannerMessage] = useState('');
  const [, setProfileTick] = useState(0);

  const pendingStripeReturnRef = useRef<ParsedStripeReturn | null>(null);

  const resetPostFormFields = useCallback(() => {
    setPostTitle('');
    setPostChannel('Instagram');
    setPostDate(new Date().toISOString().slice(0, 10));
    setPostCaption('');
    setImageFile(null);
    setImageUrl('');
    setPostError('');
    setPostUpgradePrompt(false);
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  const refreshBillingStatus = useCallback(async () => {
    if (!auth.currentUser) return;
    setBillingLoading(true);
    try {
      const status = await api.getBillingStatus();
      setBillingStatus(status);
      setBillingError('');

      const pending = pendingStripeReturnRef.current;
      if (pending?.billing === 'success') {
        let sessionCheck: CheckoutSessionCheckResult | null = null;
        if (
          !status.entitlements.isPaidActive &&
          pending.hasValidSessionId &&
          pending.sessionId &&
          status.stripeConfigured
        ) {
          sessionCheck = await api
            .checkCheckoutSession(pending.sessionId)
            .catch(() => ({ verified: false }));
        }
        setBillingNotice(
          resolveStripeReturnNotice({
            billing: pending.billing,
            hasValidSessionId: pending.hasValidSessionId,
            billingStatus: status,
            sessionCheck,
          })
        );
        if (status.entitlements.isPaidActive) {
          pendingStripeReturnRef.current = null;
        }
      }
    } catch (err) {
      setBillingError(err instanceof Error ? err.message : 'Unable to fetch billing status.');
      const pending = pendingStripeReturnRef.current;
      if (pending?.billing === 'success') {
        setBillingNotice(
          resolveStripeReturnNotice({
            billing: pending.billing,
            hasValidSessionId: pending.hasValidSessionId,
            billingStatus: null,
            verificationFailed: true,
          })
        );
      }
    } finally {
      setBillingLoading(false);
    }
  }, []);

  // Consume query parameters (?plan=solo|studio, ?tab=billing, or ?billing=success|canceled).
  // Wait for authReady so signed-out users keep query parameters (such as session_id or ?plan=)
  // across a reload prior to signing in, and only normalize URL to /app/billing once signed in.
  // IMPORTANT: ?billing=success is NEVER treated as proof of payment; access comes strictly from
  // server-verified billing status updated by signed Stripe webhooks.
  useEffect(() => {
    if (!authReady || !search) return;
    const parsed = parseStripeReturnParams(search);
    const shouldOpenBilling =
      parsed.plan !== null || parsed.tab === 'billing' || parsed.billing !== null;

    if (parsed.plan) {
      setHighlightedPlan(parsed.plan);
    }

    if (parsed.billing !== null) {
      pendingStripeReturnRef.current = parsed;
      setBillingNotice(getInitialStripeReturnNotice(parsed));
    }

    if (user && shouldOpenBilling) {
      if (parsed.billing === 'success') {
        void refreshBillingStatus();
      }
      openTab('billing', { replace: true });
    }
  }, [authReady, user, search, openTab, refreshBillingStatus]);

  // Subscribe to creator's campaigns and server-written billing record when signed in
  useEffect(() => {
    if (!authReady) {
      return;
    }

    if (!user) {
      setCampaigns([]);
      setSelectedCampaignId(null);
      setPostsByCampaignId({});
      setBillingStatus(null);
      setBillingError('');
      setWorkspaceError('');
      setCampaignError('');
      setCampaignUpgradePrompt(false);
      setShowPostForm(false);
      setEditingCampaign(false);
      setEditingPostId(null);
      setConfirmDeleteCampaignId(null);
      setConfirmDeletePostId(null);
      setConfirmLinkAction(null);
      setReplyDrafts({});
      setVerifyBannerMessage('');
      return;
    }

    void refreshBillingStatus();

    const unsubCampaigns = subscribeCreatorCampaigns(
      user.uid,
      (items) => {
        setCampaigns(items);
        setSelectedCampaignId((prev) => resolveSelectedCampaignId(prev, items));
      },
      (err) => setWorkspaceError(err.message)
    );

    const unsubBilling = subscribeCreatorBilling(
      user.uid,
      () => {
        void refreshBillingStatus();
      },
      () => {
        // Ignore if billing doc does not exist yet
      }
    );

    return () => {
      unsubCampaigns();
      unsubBilling();
    };
  }, [authReady, user, refreshBillingStatus, setSelectedCampaignId]);

  const activeCampaign = campaigns.find((c) => c.id === selectedCampaignId) ?? null;

  // Reset campaign-scoped transient edit/confirmation states when switching campaigns
  useEffect(() => {
    setEditingCampaign(false);
    setConfirmDeleteCampaignId(null);
    setConfirmDeletePostId(null);
    setConfirmLinkAction(null);
    setEditingPostId(null);
    setShowPostForm(false);
    setCampaignChannelFilter('All');
    setCampaignSearchQuery('');
    resetPostFormFields();
  }, [selectedCampaignId, resetPostFormFields]);

  // Subscribe to posts & comments across all active campaign review links
  // so both the selected campaign views and cross-campaign Pending Approvals Hub stay live.
  useEffect(() => {
    if (!authReady || !user || campaigns.length === 0) {
      setPostsByCampaignId({});
      return;
    }

    const activeIds = new Set(campaigns.map((c) => c.id));
    setPostsByCampaignId((prev) => {
      const pruned: Record<string, FirebasePost[]> = {};
      for (const [id, list] of Object.entries(prev)) {
        if (activeIds.has(id)) pruned[id] = list;
      }
      return pruned;
    });

    const unsubs = campaigns
      .filter((c) => Boolean(c.activeReviewToken))
      .map((campaign) =>
        subscribeCreatorCampaignPosts(
          user.uid,
          campaign.activeReviewToken,
          (items) => {
            setPostsByCampaignId((prev) => ({ ...prev, [campaign.id]: items }));
          },
          (err) => setWorkspaceError(err.message)
        )
      );

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [authReady, user, campaigns]);

  const posts = useMemo(
    () => (activeCampaign ? (postsByCampaignId[activeCampaign.id] ?? []) : []),
    [activeCampaign, postsByCampaignId]
  );

  const totalPendingCount = useMemo(() => {
    let count = 0;
    for (const c of campaigns) {
      for (const p of postsByCampaignId[c.id] ?? []) {
        if (p.status === 'in_review' || p.status === 'changes_requested') {
          count += 1;
        }
      }
    }
    return count;
  }, [campaigns, postsByCampaignId]);

  const handleGoogleSignIn = async () => {
    setAuthError('');
    setAuthBusy(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Unable to sign in with Google. Please try again.'
      );
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignOut = async () => {
    pendingStripeReturnRef.current = null;
    setBillingNotice('');
    setHighlightedPlan(null);
    setInspectedTarget(null);
    setPostsByCampaignId({});
    await signOut(auth);
    onNavigate('/app', { replace: true });
  };

  const handleRefreshProfileAndUser = useCallback(async () => {
    if (!auth.currentUser) return;
    await auth.currentUser.reload();
    await auth.currentUser.getIdToken(true);
    setUser(auth.currentUser);
    setProfileTick((t) => t + 1);
  }, []);

  const handleSendVerificationBanner = async () => {
    if (!auth.currentUser) return;
    setVerifyBannerBusy(true);
    setVerifyBannerMessage('');
    try {
      await sendEmailVerification(auth.currentUser);
      setVerifyBannerMessage(
        `Verification email sent to ${auth.currentUser.email || 'your inbox'}. Open the link, then click Refresh status.`
      );
    } catch (err) {
      setWorkspaceError(
        err instanceof Error ? err.message : 'Unable to send verification email.'
      );
    } finally {
      setVerifyBannerBusy(false);
    }
  };

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setCampaignError('');
    setCampaignUpgradePrompt(false);
    setCampaignBusy(true);
    try {
      const res = await api.createCampaign({
        name: newCampaignName,
        clientName: newClientName,
      });
      setNewCampaignName('');
      setNewClientName('');
      setSelectedCampaignId(res.campaign.id);
      setShowNewCampaignModal(false);
      setShowPostForm(true);
      void refreshBillingStatus();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 402 || err.upgradeRequired)) {
        setCampaignUpgradePrompt(true);
      }
      setCampaignError(err instanceof Error ? err.message : 'Unable to create campaign.');
    } finally {
      setCampaignBusy(false);
    }
  };

  const startEditingCampaign = () => {
    if (!activeCampaign) return;
    setEditCampaignName(activeCampaign.name);
    setEditClientName(activeCampaign.clientName);
    setEditingCampaign(true);
    setConfirmDeleteCampaignId(null);
    setWorkspaceError('');
  };

  const handleSaveCampaignEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCampaign) return;
    setEditCampaignBusy(true);
    setWorkspaceError('');
    try {
      await api.updateCampaign(activeCampaign.id, {
        name: editCampaignName,
        clientName: editClientName,
      });
      setEditingCampaign(false);
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : 'Unable to update campaign.');
    } finally {
      setEditCampaignBusy(false);
    }
  };

  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !activeCampaign) return;
    if (activeCampaign.reviewLinkRevoked) {
      setPostError('Generate a new active review link before adding posts.');
      return;
    }

    setPostError('');
    setPostUpgradePrompt(false);
    setPostBusy(true);
    try {
      let uploadedImageId: string | undefined;
      let resolvedImageUrl: string | undefined;

      if (imageMode === 'upload') {
        if (!imageFile) {
          throw new Error('Choose an image file to upload, or switch to Image URL.');
        }
        const uploaded = await api.uploadCampaignImage(activeCampaign.id, imageFile);
        uploadedImageId = uploaded.imageId;
      } else {
        const trimmed = imageUrl.trim();
        if (!trimmed) {
          throw new Error('Provide an HTTPS image URL or upload an image file.');
        }
        resolvedImageUrl = trimmed;
      }

      await api.createPost(activeCampaign.id, {
        title: postTitle,
        caption: postCaption,
        channel: postChannel,
        scheduledDate: postDate,
        imageId: uploadedImageId,
        imageUrl: resolvedImageUrl,
      });

      resetPostFormFields();
      setShowPostForm(false);
      void refreshBillingStatus();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 402 || err.upgradeRequired)) {
        setPostUpgradePrompt(true);
      }
      setPostError(err instanceof Error ? err.message : 'Unable to add post.');
    } finally {
      setPostBusy(false);
    }
  };

  const startEditingPost = (post: FirebasePost) => {
    setEditingPostId(post.id);
    setEditPostTitle(post.title);
    setEditPostChannel(post.channel);
    setEditPostDate(post.scheduledDate);
    setEditPostCaption(post.caption);
    setConfirmDeletePostId(null);
    setWorkspaceError('');
  };

  const handleSavePostEdit = async (
    e: React.FormEvent,
    postId: string,
    markInReview = false
  ) => {
    e.preventDefault();
    if (!activeCampaign) return;
    setEditPostBusy(true);
    setWorkspaceError('');
    try {
      await api.updatePost(activeCampaign.id, postId, {
        title: editPostTitle,
        caption: editPostCaption,
        channel: editPostChannel,
        scheduledDate: editPostDate,
        ...(markInReview ? { status: 'in_review' } : {}),
      });
      setEditingPostId(null);
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : 'Unable to save post changes.');
    } finally {
      setEditPostBusy(false);
    }
  };

  const handleRevokeLinkById = async (campaignId: string) => {
    if (!user) return;
    setLinkBusy(true);
    setWorkspaceError('');
    try {
      await api.revokeReviewLink(campaignId);
      setConfirmLinkAction(null);
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : 'Unable to revoke link.');
    } finally {
      setLinkBusy(false);
    }
  };

  const handleRotateLinkById = async (campaignId: string) => {
    if (!user) return;
    setLinkBusy(true);
    setWorkspaceError('');
    try {
      await api.regenerateReviewLink(campaignId);
      setConfirmLinkAction(null);
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : 'Unable to generate a new link.');
    } finally {
      setLinkBusy(false);
    }
  };

  const handleRevokeLink = async () => {
    if (!activeCampaign) return;
    await handleRevokeLinkById(activeCampaign.id);
  };

  const handleRotateLink = async () => {
    if (!activeCampaign) return;
    await handleRotateLinkById(activeCampaign.id);
  };

  const handleDeleteCampaign = async () => {
    if (!user || !activeCampaign) return;
    setDeleteCampaignBusy(true);
    setWorkspaceError('');
    try {
      const deletedId = activeCampaign.id;
      await api.deleteCampaign(deletedId);
      setConfirmDeleteCampaignId(null);
      setShowPostForm(false);
      setSelectedCampaignId((prev) => (prev === deletedId ? '' : prev));
      void refreshBillingStatus();
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : 'Unable to delete campaign.');
    } finally {
      setDeleteCampaignBusy(false);
    }
  };

  const handleDeletePost = async (postId: string) => {
    if (!activeCampaign) return;
    setDeletePostBusy(true);
    setWorkspaceError('');
    try {
      await api.deletePost(activeCampaign.id, postId);
      setConfirmDeletePostId(null);
      void refreshBillingStatus();
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : 'Unable to delete post.');
    } finally {
      setDeletePostBusy(false);
    }
  };

  const handleResetPostForCampaign = async (campaignId: string, postId: string) => {
    setWorkspaceError('');
    try {
      await api.resetPostToInReview(campaignId, postId);
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : 'Unable to reset status.');
    }
  };

  const handleResetPostReview = async (postId: string) => {
    if (!activeCampaign) return;
    await handleResetPostForCampaign(activeCampaign.id, postId);
  };

  const handleSubmitReplyForCampaign = async (
    campaignId: string,
    postId: string,
    body: string
  ) => {
    if (!user) return;
    const trimmed = body.trim();
    if (!trimmed) return;
    setWorkspaceError('');
    try {
      await api.addCreatorComment(campaignId, postId, trimmed);
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : 'Unable to send reply.');
      throw err;
    }
  };

  const handleCreatorReply = async (e: React.FormEvent, postId: string) => {
    e.preventDefault();
    if (!user || !activeCampaign) return;
    const body = (replyDrafts[postId] || '').trim();
    if (!body) return;
    try {
      await handleSubmitReplyForCampaign(activeCampaign.id, postId, body);
      setReplyDrafts((prev) => ({ ...prev, [postId]: '' }));
    } catch {
      // Error surfaced via workspaceError inside handleSubmitReplyForCampaign
    }
  };

  const campaignChannels = useMemo(
    () => Array.from(new Set(posts.map((p) => p.channel))),
    [posts]
  );

  const filteredPosts = useMemo(() => {
    const q = campaignSearchQuery.trim().toLowerCase();
    return posts.filter((post) => {
      if (campaignChannelFilter !== 'All' && post.channel !== campaignChannelFilter) return false;
      if (!q) return true;
      return (
        post.title.toLowerCase().includes(q) ||
        post.caption.toLowerCase().includes(q) ||
        post.channel.toLowerCase().includes(q)
      );
    });
  }, [posts, campaignChannelFilter, campaignSearchQuery]);

  const inspectedCampaign = inspectedTarget
    ? campaigns.find((c) => c.id === inspectedTarget.campaignId) ?? null
    : null;
  const inspectedPosts = inspectedCampaign
    ? (postsByCampaignId[inspectedCampaign.id] ?? [])
    : [];

  const handleCopyReviewLink = (token: string) => {
    const url = `${window.location.origin}/review/${token}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).catch(() => {});
    }
    setCopiedToken(true);
    window.setTimeout(() => setCopiedToken(false), 2000);
  };

  const handleStartCheckout = async (plan: 'solo' | 'studio') => {
    setBillingError('');
    setBillingNotice('');
    pendingStripeReturnRef.current = null;
    setBillingBusyPlan(plan);
    try {
      const { url } = await api.createCheckoutSession(plan);
      if (!url) throw new Error('Stripe Checkout did not return a redirect URL.');
      window.location.assign(url);
    } catch (err) {
      setBillingError(err instanceof Error ? err.message : 'Unable to start Stripe Checkout.');
      setBillingBusyPlan(null);
    }
  };

  const handleOpenPortal = async () => {
    setBillingError('');
    setBillingNotice('');
    pendingStripeReturnRef.current = null;
    setBillingBusyPlan('portal');
    try {
      const { url } = await api.createBillingPortalSession();
      if (!url) throw new Error('Stripe Billing Portal did not return a redirect URL.');
      window.location.assign(url);
    } catch (err) {
      setBillingError(err instanceof Error ? err.message : 'Unable to open Stripe Billing Portal.');
      setBillingBusyPlan(null);
    }
  };

  const approvedCount = posts.filter((p) => p.status === 'approved').length;
  const changesCount = posts.filter((p) => p.status === 'changes_requested').length;
  const inReviewCount = posts.filter((p) => p.status === 'in_review').length;

  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FAFBFD] text-sm text-[#646780]">
        Connecting to Firebase…
      </div>
    );
  }

  // ==================== CREATOR SIGN-IN (FIREBASE GOOGLE AUTH) ====================
  if (!user) {
    return (
      <div className="min-h-screen bg-[#FAFBFD] text-[#1C1D33]">
        <header className="border-b border-[#ECEDF4] bg-white">
          <div className="mx-auto flex h-[68px] max-w-[1200px] items-center justify-between gap-8 px-6">
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

            <button
              type="button"
              onClick={() => onNavigate('/')}
              className="text-sm font-medium text-[#555870] transition-colors hover:text-[#1C1D33] whitespace-nowrap shrink-0 cursor-pointer"
            >
              Back to landing page
            </button>
          </div>
        </header>

        <main className="mx-auto max-w-md px-6 py-16">
          <div className="rounded-2xl border border-[#DFE1EC] bg-white p-7 sm:p-8">
            <p className="text-xs font-semibold text-[#5B42DC]">Creator sign-in</p>
            <h1 className="mt-1.5 text-2xl font-bold tracking-[-0.03em] text-[#1C1D33]">
              Sign in to PostProofs
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-[#5B5E77]">
              Sign in with Google to create campaigns, add social posts, share private revocable
              client links, and manage your subscription.
            </p>

            {billingNotice && (
              <p className="mt-4 rounded-xl border border-[#D4CCF7] bg-[#F6F4FF] px-3.5 py-2.5 text-xs font-medium text-[#3F2DA8]">
                {billingNotice}
              </p>
            )}

            {authError && (
              <p
                role="alert"
                className="mt-4 rounded-xl border border-[#F0C8C4] bg-[#FDF4F3] px-3.5 py-2.5 text-xs font-medium text-[#9B2B22]"
              >
                {authError}
              </p>
            )}

            <button
              type="button"
              disabled={authBusy}
              onClick={handleGoogleSignIn}
              className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2.5 rounded-xl bg-[#5B42DC] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#4931C2] disabled:opacity-50 cursor-pointer"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M21.35 11.1h-9.18v2.92h5.27c-.23 1.5-1.73 4.4-5.27 4.4-3.17 0-5.76-2.62-5.76-5.85s2.59-5.85 5.76-5.85c1.81 0 3.02.77 3.71 1.43l2.53-2.44C16.79 4.2 14.69 3.3 12.17 3.3 7.12 3.3 3.03 7.39 3.03 12.57s4.09 9.27 9.14 9.27c5.27 0 8.77-3.71 8.77-8.94 0-.6-.06-1.06-.15-1.8Z"
                />
              </svg>
              {authBusy ? 'Signing in…' : 'Continue with Google'}
            </button>

            <p className="mt-5 text-xs leading-relaxed text-[#72758D]">
              Your clients do not need an account — they only open the private review link you
              share with them.
            </p>
          </div>
        </main>
      </div>
    );
  }

  // ==================== AUTHENTICATED CREATOR WORKSPACE ====================
  return (
    <div className="flex min-h-screen bg-[#FAFBFD] text-[#1C1D33]">
      {/* Mobile Sidebar Backdrop */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-[#1C1D33]/40 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Stitch Persistent Left App Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col justify-between border-r border-[#ECEDF4] bg-white transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="space-y-5 p-4">
          {/* Brand Logo */}
          <div className="flex items-center justify-between px-1 pt-1">
            <button
              type="button"
              onClick={() => openTab('campaigns')}
              aria-label="PostProofs workspace"
              className="inline-flex items-center whitespace-nowrap shrink-0 cursor-pointer"
            >
              <img
                src={postproofsLogo}
                alt="postproofs"
                className="h-10 w-auto object-contain"
              />
            </button>
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              aria-label="Close navigation menu"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#555870] hover:bg-[#F4F5FA] lg:hidden cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Workspace / Active Campaign Switcher Card */}
          <div className="rounded-2xl border border-[#ECEDF4] bg-[#FAFBFD] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#7D8099]">
                Campaign workspace
              </span>
              {billingStatus && (
                <button
                  type="button"
                  onClick={() => openTab('billing')}
                  className="font-mono text-[10px] font-semibold text-[#5B42DC] hover:underline cursor-pointer"
                >
                  {billingStatus.usage.campaignsCount}/{billingStatus.entitlements.maxCampaigns}
                </button>
              )}
            </div>

            {campaigns.length > 0 ? (
              <div className="mt-2">
                <label htmlFor="sidebar-campaign-switcher" className="sr-only">
                  Select active campaign
                </label>
                <select
                  id="sidebar-campaign-switcher"
                  value={selectedCampaignId || ''}
                  onChange={(e) => {
                    setSelectedCampaignId(e.target.value);
                    if (activeTab !== 'campaigns') openTab('campaigns');
                  }}
                  className="h-9 w-full rounded-xl border border-[#DCDEEB] bg-white px-2.5 text-xs font-semibold text-[#1C1D33] focus:border-[#5B42DC] focus:outline-none"
                >
                  {campaigns.map((cmp) => (
                    <option key={cmp.id} value={cmp.id}>
                      {cmp.clientName} · {cmp.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="mt-1.5 text-xs font-medium text-[#5B5E77]">No campaigns created yet</p>
            )}

            <button
              type="button"
              onClick={() => {
                setCampaignError('');
                setShowNewCampaignModal(true);
                setMobileNavOpen(false);
              }}
              className="mt-2.5 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-xl border border-[#D8D3FA] bg-white text-xs font-semibold text-[#5B42DC] hover:bg-[#F6F4FF] cursor-pointer"
            >
              <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" />
              New campaign
            </button>
          </div>

          {/* Primary Stitch Navigation Menu */}
          <nav className="space-y-1" aria-label="Workspace navigation">
            <button
              type="button"
              onClick={() => openTab('campaigns')}
              aria-current={activeTab === 'campaigns' ? 'page' : undefined}
              className={`flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-colors cursor-pointer ${
                activeTab === 'campaigns'
                  ? 'bg-[#5B42DC] text-white shadow-xs'
                  : 'text-[#474A63] hover:bg-[#F4F5FA] hover:text-[#1C1D33]'
              }`}
            >
              <span className="inline-flex items-center gap-2.5">
                <Calendar className="h-4 w-4" aria-hidden="true" />
                Calendar Proofs
              </span>
            </button>

            <button
              type="button"
              onClick={() => openTab('pending')}
              aria-current={activeTab === 'pending' ? 'page' : undefined}
              className={`flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-colors cursor-pointer ${
                activeTab === 'pending'
                  ? 'bg-[#5B42DC] text-white shadow-xs'
                  : 'text-[#474A63] hover:bg-[#F4F5FA] hover:text-[#1C1D33]'
              }`}
            >
              <span className="inline-flex items-center gap-2.5">
                <Clock className="h-4 w-4" aria-hidden="true" />
                Pending Review
              </span>
              {totalPendingCount > 0 && (
                <span
                  className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 font-mono text-[11px] font-bold ${
                    activeTab === 'pending'
                      ? 'bg-white/20 text-white'
                      : 'bg-[#FEECEB] text-[#C0382B]'
                  }`}
                >
                  {totalPendingCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => openTab('approved')}
              aria-current={activeTab === 'approved' ? 'page' : undefined}
              className={`flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-colors cursor-pointer ${
                activeTab === 'approved'
                  ? 'bg-[#5B42DC] text-white shadow-xs'
                  : 'text-[#474A63] hover:bg-[#F4F5FA] hover:text-[#1C1D33]'
              }`}
            >
              <span className="inline-flex items-center gap-2.5">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                Approved Vault
              </span>
            </button>

            <button
              type="button"
              onClick={() => openTab('portals')}
              aria-current={activeTab === 'portals' ? 'page' : undefined}
              className={`flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-colors cursor-pointer ${
                activeTab === 'portals'
                  ? 'bg-[#5B42DC] text-white shadow-xs'
                  : 'text-[#474A63] hover:bg-[#F4F5FA] hover:text-[#1C1D33]'
              }`}
            >
              <span className="inline-flex items-center gap-2.5">
                <Building2 className="h-4 w-4" aria-hidden="true" />
                Client Portals
              </span>
            </button>

            <div className="my-2 border-t border-[#ECEDF4] pt-2">
              <button
                type="button"
                onClick={() => {
                  openTab('billing');
                  void refreshBillingStatus();
                }}
                aria-current={activeTab === 'billing' ? 'page' : undefined}
                className={`flex w-full items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-colors cursor-pointer ${
                  activeTab === 'billing'
                    ? 'bg-[#5B42DC] text-white shadow-xs'
                    : 'text-[#474A63] hover:bg-[#F4F5FA] hover:text-[#1C1D33]'
                }`}
              >
                <CreditCard className="h-4 w-4" aria-hidden="true" />
                Billing
              </button>

              <button
                type="button"
                onClick={() => openTab('settings')}
                aria-current={activeTab === 'settings' ? 'page' : undefined}
                className={`mt-1 flex w-full items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-colors cursor-pointer ${
                  activeTab === 'settings'
                    ? 'bg-[#5B42DC] text-white shadow-xs'
                    : 'text-[#474A63] hover:bg-[#F4F5FA] hover:text-[#1C1D33]'
                }`}
              >
                <Settings className="h-4 w-4" aria-hidden="true" />
                Settings
              </button>
            </div>
          </nav>
        </div>

        {/* Bottom Live Status & User Strip */}
        <div className="space-y-3 border-t border-[#ECEDF4] p-4">
          <div className="flex items-center justify-between rounded-xl border border-[#E5E6F0] bg-[#FAFBFD] px-3 py-2 text-xs">
            <span className="inline-flex items-center gap-2 font-medium text-[#23253E]">
              <span className="h-2 w-2 rounded-full bg-[#1E6F4A]" aria-hidden="true" />
              Client Sync Live
            </span>
            <span className="font-mono text-[10px] font-semibold text-[#5B42DC]">Live</span>
          </div>
          <div className="flex items-center justify-between gap-2 px-1">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-[#1C1D33]">
                {user.displayName || 'Creator'}
              </p>
              <p className="truncate text-[11px] text-[#7D8099]">{user.email}</p>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              aria-label="Sign out"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#E2E4F0] bg-white text-[#474A63] hover:border-[#C2B8FA] hover:text-[#5B42DC] cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Shell */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Utility Header matching Stitch Screens */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-[#ECEDF4] bg-white px-4 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open workspace navigation"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#E2E4F0] bg-white text-[#23253E] lg:hidden cursor-pointer"
            >
              <Menu className="h-4 w-4" aria-hidden="true" />
            </button>

            <div className="relative w-full max-w-sm">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-[#8E91A8]"
                aria-hidden="true"
              />
              <input
                type="search"
                aria-label="Search posts, proofs, captions"
                value={campaignSearchQuery}
                onChange={(e) => setCampaignSearchQuery(e.target.value)}
                placeholder="Search posts, proofs, captions…"
                className="h-9 w-full rounded-xl border border-[#E2E4F0] bg-[#FAFBFD] pr-3 pl-9 text-xs text-[#1C1D33] placeholder:text-[#8E91A8] focus:border-[#5B42DC] focus:bg-white focus:outline-none"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {activeCampaign && !activeCampaign.reviewLinkRevoked && (
              <button
                type="button"
                onClick={() => handleCopyReviewLink(activeCampaign.activeReviewToken)}
                className="hidden h-9 items-center gap-1.5 rounded-xl border border-[#DCDEEB] bg-white px-3 text-xs font-semibold text-[#23253E] transition-colors hover:border-[#5B42DC] hover:text-[#5B42DC] sm:inline-flex cursor-pointer"
              >
                {copiedToken ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-[#1E6F4A]" aria-hidden="true" />
                    Copied proof link
                  </>
                ) : (
                  <>
                    <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Share proof batch
                  </>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                if (!activeCampaign) {
                  setShowNewCampaignModal(true);
                } else {
                  if (activeTab !== 'campaigns') openTab('campaigns');
                  setShowPostForm(true);
                }
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#5B42DC] px-3.5 text-xs font-semibold text-white transition-colors hover:bg-[#4931C2] cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {activeCampaign ? 'New post draft' : 'New campaign'}
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1360px] flex-1 px-4 py-7 sm:px-6">
        {!user.emailVerified && (
          <div
            role="status"
            className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E7C998] bg-[#FEF8EC] px-4 py-3 text-xs text-[#7D4908]"
          >
            <div className="flex items-start gap-2.5">
              <MailWarning className="mt-0.5 h-4 w-4 shrink-0 text-[#9A5B0A]" aria-hidden="true" />
              <div>
                <p className="font-semibold">Verify your email address to unlock workspace actions</p>
                <p className="mt-0.5 text-[#8A520B]">
                  {verifyBannerMessage ||
                    'Your email is not verified yet. Verify your email before creating campaigns, uploading images, or upgrading your plan.'}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={verifyBannerBusy}
                onClick={() => void handleSendVerificationBanner()}
                className="inline-flex h-8 items-center rounded-lg bg-[#9A5B0A] px-3 text-xs font-semibold text-white hover:bg-[#7D4908] disabled:opacity-50 cursor-pointer"
              >
                Send verification email
              </button>
              <button
                type="button"
                disabled={verifyBannerBusy}
                onClick={() => void handleRefreshProfileAndUser()}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#E0BE86] bg-white px-2.5 text-xs font-semibold text-[#7D4908] hover:border-[#9A5B0A] disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw className="h-3 w-3" aria-hidden="true" />
                Refresh status
              </button>
            </div>
          </div>
        )}

        {workspaceError && (
          <div
            role="alert"
            className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-[#F0C8C4] bg-[#FDF4F3] px-4 py-3 text-sm text-[#9B2B22]"
          >
            <span>{workspaceError}</span>
            <button
              type="button"
              onClick={() => setWorkspaceError('')}
              aria-label="Dismiss error"
              className="shrink-0 rounded-md p-1 text-[#9B2B22] hover:bg-[#F9E3E0] cursor-pointer"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}

        {activeTab === 'settings' ? (
          <WorkspaceSettings
            user={user}
            billingStatus={billingStatus}
            onOpenBilling={() => {
              openTab('billing');
              void refreshBillingStatus();
            }}
            onProfileUpdated={handleRefreshProfileAndUser}
            onAccountDeleted={handleSignOut}
          />
        ) : activeTab === 'pending' ? (
          <PendingApprovalsHub
            campaigns={campaigns}
            postsByCampaignId={postsByCampaignId}
            onOpenCampaign={(cmpId) => {
              setSelectedCampaignId(cmpId);
              openTab('campaigns');
            }}
            onInspectPost={(cmp, post) => {
              setSelectedCampaignId(cmp.id);
              setInspectedTarget({ campaignId: cmp.id, postId: post.id });
            }}
            onResetToInReview={handleResetPostForCampaign}
          />
        ) : activeTab === 'approved' ? (
          <ApprovedVaultView
            campaigns={campaigns}
            postsByCampaignId={postsByCampaignId}
            searchQuery={campaignSearchQuery}
            onOpenCampaign={(cmpId) => {
              setSelectedCampaignId(cmpId);
              openTab('campaigns');
            }}
            onInspectPost={(cmp, post) => {
              setSelectedCampaignId(cmp.id);
              setInspectedTarget({ campaignId: cmp.id, postId: post.id });
            }}
          />
        ) : activeTab === 'portals' ? (
          <ClientPortalsView
            campaigns={campaigns}
            postsByCampaignId={postsByCampaignId}
            onOpenCampaign={(cmpId) => {
              setSelectedCampaignId(cmpId);
              openTab('campaigns');
            }}
            onCreateCampaign={() => setShowNewCampaignModal(true)}
            onRevokeLink={handleRevokeLinkById}
            onRotateLink={handleRotateLinkById}
          />
        ) : activeTab === 'billing' ? (
          /* ==================== BILLING VIEW (STRIPE TEST MODE + FIREBASE UID) ==================== */
          <section className="mx-auto max-w-4xl space-y-6">
            <div className="rounded-2xl border border-[#E2E4F0] bg-white p-6 sm:p-7">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold text-[#5B42DC]">
                    Subscription & plan quotas · Stripe test mode
                  </p>
                  <h1 className="mt-1 text-2xl font-bold tracking-[-0.03em] text-[#1C1D33]">
                    {billingStatus ? formatPlanLabel(billingStatus.subscriptionPlan) : 'Loading plan…'}
                  </h1>
                  <p className="mt-1.5 text-sm text-[#5B5E77]">
                    Signed in as <span className="font-medium text-[#1C1D33]">{user.email}</span>
                  </p>
                </div>

                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    disabled={billingLoading}
                    onClick={() => void refreshBillingStatus()}
                    className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-[#DCDEEB] bg-white px-3.5 text-xs font-semibold text-[#23253E] transition-colors hover:border-[#5B42DC] hover:text-[#5B42DC] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    Refresh status
                  </button>

                  {billingStatus?.hasStripeCustomer && (
                    <button
                      type="button"
                      disabled={billingBusyPlan !== null}
                      onClick={() => void handleOpenPortal()}
                      className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#1C1D33] px-4 text-xs font-semibold text-white transition-colors hover:bg-[#2F3152] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <CreditCard className="h-3.5 w-3.5" aria-hidden="true" />
                      {billingBusyPlan === 'portal' ? 'Opening portal…' : 'Manage billing portal'}
                    </button>
                  )}
                </div>
              </div>

              {billingNotice && (
                <div className="mt-5 rounded-xl border border-[#D4CCF7] bg-[#F6F4FF] px-4 py-3 text-sm text-[#3F2DA8]">
                  {billingNotice}
                </div>
              )}

              {billingError && (
                <div
                  role="alert"
                  className="mt-5 rounded-xl border border-[#F0C8C4] bg-[#FDF4F3] px-4 py-3 text-sm text-[#9B2B22]"
                >
                  {billingError}
                </div>
              )}

              {billingStatus && (
                <div className="mt-6 grid grid-cols-1 gap-4 border-t border-[#ECEDF4] pt-6 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-xl border border-[#ECEDF4] bg-[#FAFBFD] p-4">
                    <p className="text-xs font-medium text-[#6B6E87]">Subscription status</p>
                    <p className="mt-1 text-base font-bold text-[#1C1D33]">
                      {formatStatusLabel(billingStatus.subscriptionStatus)}
                    </p>
                    {billingStatus.currentPeriodEnd && (
                      <p className="mt-1 font-mono text-[11px] text-[#6B6E87]">
                        Period ends {new Date(billingStatus.currentPeriodEnd).toLocaleDateString()}
                      </p>
                    )}
                  </div>

                  <div className="rounded-xl border border-[#ECEDF4] bg-[#FAFBFD] p-4">
                    <p className="text-xs font-medium text-[#6B6E87]">Campaigns used</p>
                    <p className="mt-1 font-mono text-base font-bold tabular-nums text-[#1C1D33]">
                      {billingStatus.usage.campaignsCount} / {billingStatus.entitlements.maxCampaigns}
                    </p>
                    <p className="mt-1 text-[11px] text-[#6B6E87]">Enforced server-side</p>
                  </div>

                  <div className="rounded-xl border border-[#ECEDF4] bg-[#FAFBFD] p-4">
                    <p className="text-xs font-medium text-[#6B6E87]">Total posts used</p>
                    <p className="mt-1 font-mono text-base font-bold tabular-nums text-[#1C1D33]">
                      {billingStatus.usage.postsCount} / {billingStatus.entitlements.maxPostsTotal}
                    </p>
                    <p className="mt-1 text-[11px] text-[#6B6E87]">Enforced server-side</p>
                  </div>

                  <div className="rounded-xl border border-[#ECEDF4] bg-[#FAFBFD] p-4">
                    <p className="text-xs font-medium text-[#6B6E87]">Image storage used</p>
                    <p className="mt-1 font-mono text-base font-bold tabular-nums text-[#1C1D33]">
                      {(billingStatus.usage.storageBytesUsed / (1024 * 1024)).toFixed(1)} MB /{' '}
                      {Math.round(billingStatus.entitlements.maxStorageBytes / (1024 * 1024))} MB
                    </p>
                    <p className="mt-1 text-[11px] text-[#6B6E87]">
                      Cleaned up when posts/campaigns delete
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Plan Upgrade Cards */}
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div
                className={`flex flex-col justify-between rounded-2xl bg-white p-6 ${
                  highlightedPlan === 'solo'
                    ? 'border-2 border-[#5B42DC] ring-2 ring-[#5B42DC]/15'
                    : 'border border-[#E2E4F0]'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-[#5B42DC]">Solo</p>
                    {highlightedPlan === 'solo' && (
                      <span className="rounded-full bg-[#F2EFFE] px-2.5 py-0.5 text-[11px] font-semibold text-[#5B42DC]">
                        Selected plan
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex items-baseline gap-1">
                    <span className="font-mono text-3xl font-bold tracking-tight text-[#1C1D33]">
                      $12
                    </span>
                    <span className="text-sm text-[#6B6E87]">/month (test mode)</span>
                  </div>
                  <p className="mt-2 text-sm text-[#5B5E77]">
                    For solo social media managers running recurring client approvals.
                  </p>
                  <ul className="mt-5 space-y-2 text-sm text-[#3B3E57]">
                    <li>Up to 3 active campaigns</li>
                    <li>Up to 100 post proofs total</li>
                    <li>Private revocable client links & campaign-scoped images</li>
                  </ul>
                </div>

                <button
                  type="button"
                  disabled={
                    billingBusyPlan !== null ||
                    (billingStatus?.subscriptionPlan === 'solo' &&
                      billingStatus.entitlements.isPaidActive)
                  }
                  onClick={() => void handleStartCheckout('solo')}
                  className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-xl border border-[#5B42DC] bg-white px-4 text-sm font-semibold text-[#5B42DC] transition-colors hover:bg-[#F6F4FF] disabled:opacity-50 cursor-pointer"
                >
                  {billingBusyPlan === 'solo'
                    ? 'Redirecting to Stripe…'
                    : billingStatus?.subscriptionPlan === 'solo' &&
                        billingStatus.entitlements.isPaidActive
                      ? 'Current plan'
                      : 'Upgrade to Solo'}
                </button>
              </div>

              <div
                className={`flex flex-col justify-between rounded-2xl bg-white p-6 ${
                  highlightedPlan === 'studio'
                    ? 'border-2 border-[#5B42DC] ring-2 ring-[#5B42DC]/15'
                    : 'border border-[#5B42DC]'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-[#5B42DC]">Studio</p>
                    {highlightedPlan === 'studio' && (
                      <span className="rounded-full bg-[#F2EFFE] px-2.5 py-0.5 text-[11px] font-semibold text-[#5B42DC]">
                        Selected plan
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex items-baseline gap-1">
                    <span className="font-mono text-3xl font-bold tracking-tight text-[#1C1D33]">
                      $29
                    </span>
                    <span className="text-sm text-[#6B6E87]">/month (test mode)</span>
                  </div>
                  <p className="mt-2 text-sm text-[#5B5E77]">
                    For boutique studios managing multiple brand calendars at once.
                  </p>
                  <ul className="mt-5 space-y-2 text-sm text-[#3B3E57]">
                    <li>Up to 10 active campaigns</li>
                    <li>Up to 500 post proofs total</li>
                    <li>Private revocable client links & campaign-scoped images</li>
                  </ul>
                </div>

                <button
                  type="button"
                  disabled={
                    billingBusyPlan !== null ||
                    (billingStatus?.subscriptionPlan === 'studio' &&
                      billingStatus.entitlements.isPaidActive)
                  }
                  onClick={() => void handleStartCheckout('studio')}
                  className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-xl bg-[#5B42DC] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#4931C2] disabled:opacity-50 cursor-pointer"
                >
                  {billingBusyPlan === 'studio'
                    ? 'Redirecting to Stripe…'
                    : billingStatus?.subscriptionPlan === 'studio' &&
                        billingStatus.entitlements.isPaidActive
                      ? 'Current plan'
                      : 'Upgrade to Studio'}
                </button>
              </div>
            </div>

            {billingStatus && (!billingStatus.stripeConfigured || !billingStatus.webhookConfigured) && (
              <div className="rounded-2xl border border-[#E5E6F0] bg-white p-5 text-xs leading-relaxed text-[#5B5E77]">
                <p className="font-semibold text-[#1C1D33]">Stripe test mode setup required</p>
                <p className="mt-1">
                  Configure <code className="font-mono">STRIPE_SECRET_KEY</code> (test key{' '}
                  <code className="font-mono">sk_test_…</code>),{' '}
                  <code className="font-mono">STRIPE_WEBHOOK_SECRET</code>,{' '}
                  <code className="font-mono">STRIPE_PRICE_ID_SOLO</code>, and{' '}
                  <code className="font-mono">STRIPE_PRICE_ID_STUDIO</code> in your environment
                  variables to test hosted Checkout and signed webhook syncing.
                </p>
              </div>
            )}
          </section>
        ) : (
          /* ==================== CALENDAR PROOFS FULL-WIDTH STAGE ==================== */
          <section className="space-y-6">
            {!activeCampaign ? (
              <div className="mx-auto max-w-xl rounded-3xl border border-[#E2E4F0] bg-white p-8">
                <p className="text-xs font-semibold text-[#5B42DC]">Get started</p>
                <h1 className="mt-1 text-2xl font-bold tracking-[-0.03em] text-[#1C1D33]">
                  Create your first campaign
                </h1>
                <p className="mt-1.5 text-sm text-[#5B5E77]">
                  Name your campaign and client to unlock the Calendar Week Grid, Kanban board, and
                  your private tokenized client portal link.
                </p>

                <form onSubmit={handleCreateCampaign} className="mt-6 space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor="cmp-name" className="block text-xs font-semibold text-[#474A63]">
                        Campaign name
                      </label>
                      <input
                        id="cmp-name"
                        type="text"
                        required
                        maxLength={120}
                        value={newCampaignName}
                        onChange={(e) => setNewCampaignName(e.target.value)}
                        placeholder="Spring launch · Week 2"
                        className="mt-1 h-10 w-full rounded-xl border border-[#DCDEEB] px-3 text-sm text-[#1C1D33] focus:border-[#5B42DC] focus:outline-none"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="cmp-client"
                        className="block text-xs font-semibold text-[#474A63]"
                      >
                        Client name
                      </label>
                      <input
                        id="cmp-client"
                        type="text"
                        required
                        maxLength={120}
                        value={newClientName}
                        onChange={(e) => setNewClientName(e.target.value)}
                        placeholder="Solstice Home"
                        className="mt-1 h-10 w-full rounded-xl border border-[#DCDEEB] px-3 text-sm text-[#1C1D33] focus:border-[#5B42DC] focus:outline-none"
                      />
                    </div>
                  </div>

                  {campaignError && (
                    <div
                      role="alert"
                      className="rounded-xl border border-[#F0C8C4] bg-[#FDF4F3] p-3 text-xs font-medium text-[#9B2B22]"
                    >
                      <p>{campaignError}</p>
                      {campaignUpgradePrompt && (
                        <button
                          type="button"
                          onClick={() => openTab('billing')}
                          className="mt-2 font-semibold text-[#5B42DC] underline cursor-pointer"
                        >
                          View plans &amp; upgrade
                        </button>
                      )}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={campaignBusy}
                    className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-[#5B42DC] px-5 text-xs font-semibold text-white transition-colors hover:bg-[#4931C2] disabled:opacity-50 cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    {campaignBusy ? 'Creating…' : 'Create campaign'}
                  </button>
                </form>
              </div>
            ) : (
              <>
                {/* Stitch Breadcrumb + Campaign Title + Summary Pills + Private Client Portal Controls */}
                <div className="rounded-2xl border border-[#E2E4F0] bg-white p-6">
                  {editingCampaign ? (
                    <form onSubmit={handleSaveCampaignEdit} className="space-y-4">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label
                            htmlFor="edit-cmp-name"
                            className="block text-xs font-semibold text-[#474A63]"
                          >
                            Campaign name
                          </label>
                          <input
                            id="edit-cmp-name"
                            type="text"
                            required
                            minLength={2}
                            maxLength={120}
                            value={editCampaignName}
                            onChange={(e) => setEditCampaignName(e.target.value)}
                            className="mt-1 h-10 w-full rounded-xl border border-[#DCDEEB] px-3 text-sm text-[#1C1D33] focus:border-[#5B42DC] focus:outline-none"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor="edit-cmp-client"
                            className="block text-xs font-semibold text-[#474A63]"
                          >
                            Client name
                          </label>
                          <input
                            id="edit-cmp-client"
                            type="text"
                            required
                            minLength={2}
                            maxLength={120}
                            value={editClientName}
                            onChange={(e) => setEditClientName(e.target.value)}
                            className="mt-1 h-10 w-full rounded-xl border border-[#DCDEEB] px-3 text-sm text-[#1C1D33] focus:border-[#5B42DC] focus:outline-none"
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          disabled={editCampaignBusy}
                          onClick={() => setEditingCampaign(false)}
                          className="h-9 rounded-xl border border-[#DCDEEB] bg-white px-3.5 text-xs font-semibold text-[#474A63] hover:text-[#1C1D33] cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={editCampaignBusy}
                          className="h-9 rounded-xl bg-[#5B42DC] px-4 text-xs font-semibold text-white hover:bg-[#4931C2] disabled:opacity-50 cursor-pointer"
                        >
                          {editCampaignBusy ? 'Saving…' : 'Save campaign'}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-[#6B6E87]">
                          <span>Campaigns</span>
                          <span>&rsaquo;</span>
                          <span className="rounded-full bg-[#EAE6FF] px-2.5 py-0.5 font-semibold text-[#4931C2]">
                            {activeCampaign.clientName}
                          </span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <h1 className="text-2xl font-bold tracking-[-0.03em] text-[#1C1D33] sm:text-3xl">
                            {activeCampaign.name}
                          </h1>
                          <button
                            type="button"
                            onClick={startEditingCampaign}
                            aria-label="Edit campaign details"
                            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[#ECEDF4] text-[#6E718A] transition-colors hover:border-[#C2B8FA] hover:text-[#5B42DC] cursor-pointer"
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>

                        {/* Stitch Status Counter Badges */}
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-[#E2E4F0] bg-[#FAFBFD] px-3 py-1 font-mono text-xs font-semibold text-[#1C1D33]">
                            Total Posts: {posts.length}
                          </span>
                          <span className="rounded-full bg-[#EDF8F2] px-3 py-1 font-mono text-xs font-semibold text-[#1E6F4A]">
                            Approved: {approvedCount}
                          </span>
                          <span className="rounded-full bg-[#EEF0FA] px-3 py-1 font-mono text-xs font-semibold text-[#474A63]">
                            In Review: {inReviewCount}
                          </span>
                          <span className="rounded-full bg-[#FEF4E6] px-3 py-1 font-mono text-xs font-semibold text-[#9A5B0A]">
                            Changes Requested: {changesCount}
                          </span>
                        </div>
                      </div>

                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              setShowPostForm((prev) => {
                                if (prev) resetPostFormFields();
                                return !prev;
                              })
                            }
                            disabled={activeCampaign.reviewLinkRevoked || deleteCampaignBusy}
                            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#5B42DC] px-4 text-xs font-semibold text-white transition-colors hover:bg-[#4931C2] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <Plus className="h-4 w-4" aria-hidden="true" />
                            {showPostForm ? 'Close post form' : 'Add post'}
                          </button>

                          {confirmDeleteCampaignId === activeCampaign.id ? (
                            <>
                              <button
                                type="button"
                                disabled={deleteCampaignBusy}
                                onClick={() => void handleDeleteCampaign()}
                                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#9B2B22] px-3.5 text-xs font-semibold text-white transition-colors hover:bg-[#7F221B] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                {deleteCampaignBusy ? 'Deleting…' : 'Confirm delete'}
                              </button>
                              <button
                                type="button"
                                disabled={deleteCampaignBusy}
                                onClick={() => setConfirmDeleteCampaignId(null)}
                                className="inline-flex h-10 items-center rounded-xl border border-[#DCDEEB] bg-white px-3 text-xs font-semibold text-[#474A63] transition-colors hover:text-[#1C1D33] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              disabled={deleteCampaignBusy}
                              onClick={() => setConfirmDeleteCampaignId(activeCampaign.id)}
                              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-[#EED2CE] bg-white px-3.5 text-xs font-semibold text-[#9B2B22] transition-colors hover:bg-[#FDF4F3] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                              Delete campaign
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {confirmDeleteCampaignId === activeCampaign.id && (
                      <div
                        role="alert"
                        className="mt-4 rounded-xl border border-[#F0C8C4] bg-[#FDF4F3] px-3.5 py-2.5 text-xs text-[#9B2B22]"
                      >
                        This will permanently delete <strong>{activeCampaign.name}</strong>, its
                        review link, all posts and comments, and its stored images.
                      </div>
                    )}

                    {/* Private Revocable Client Review Link Controls */}
                    <div className="mt-5 border-t border-[#ECEDF4] pt-5">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="inline-flex items-center gap-1.5 font-semibold text-[#23253E]">
                          {activeCampaign.reviewLinkRevoked ? (
                            <Link2Off className="h-3.5 w-3.5 text-[#9A5B0A]" aria-hidden="true" />
                          ) : (
                            <Link2 className="h-3.5 w-3.5 text-[#1E6F4A]" aria-hidden="true" />
                          )}
                          Private client review link
                        </span>
                        <span
                          className={`font-semibold ${
                            activeCampaign.reviewLinkRevoked ? 'text-[#9A5B0A]' : 'text-[#1E6F4A]'
                          }`}
                        >
                          {activeCampaign.reviewLinkRevoked ? 'Revoked' : 'Active'}
                        </span>
                      </div>

                      <div className="mt-2.5 flex flex-wrap items-center gap-2">
                        <code className="w-full min-w-0 truncate rounded-xl border border-[#E5E6F0] bg-[#FAFBFD] px-3 py-2 font-mono text-xs text-[#43465E] sm:flex-1">
                          {activeCampaign.reviewLinkRevoked
                            ? 'Link revoked — clients immediately lose access to posts and uploaded images until you generate a new link.'
                            : `${window.location.origin}/review/${activeCampaign.activeReviewToken}`}
                        </code>

                        {!activeCampaign.reviewLinkRevoked && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleCopyReviewLink(activeCampaign.activeReviewToken)}
                              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#DCDEEB] bg-white px-3 text-xs font-semibold text-[#23253E] transition-colors hover:border-[#5B42DC] hover:text-[#5B42DC] whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              {copiedToken ? (
                                <>
                                  <Check className="h-3.5 w-3.5 text-[#1E6F4A]" />
                                  Copied
                                </>
                              ) : (
                                <>
                                  <Copy className="h-3.5 w-3.5" />
                                  Copy link
                                </>
                              )}
                            </button>

                            <a
                              href={`/review/${activeCampaign.activeReviewToken}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#DCDEEB] bg-white px-3 text-xs font-semibold text-[#23253E] transition-colors hover:border-[#5B42DC] hover:text-[#5B42DC] whitespace-nowrap shrink-0"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              Preview as client
                            </a>

                            {confirmLinkAction === 'revoke' ? (
                              <>
                                <button
                                  type="button"
                                  disabled={linkBusy}
                                  onClick={() => void handleRevokeLink()}
                                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#9B2B22] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#7F221B] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                                >
                                  Confirm revoke
                                </button>
                                <button
                                  type="button"
                                  disabled={linkBusy}
                                  onClick={() => setConfirmLinkAction(null)}
                                  className="inline-flex h-9 items-center rounded-xl border border-[#DCDEEB] bg-white px-2.5 text-xs font-semibold text-[#474A63] hover:text-[#1C1D33] cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                disabled={linkBusy}
                                onClick={() => setConfirmLinkAction('revoke')}
                                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#EED2CE] bg-white px-3 text-xs font-semibold text-[#9B2B22] transition-colors hover:bg-[#FDF4F3] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                <Link2Off className="h-3.5 w-3.5" />
                                Revoke
                              </button>
                            )}
                          </>
                        )}

                        {activeCampaign.reviewLinkRevoked ? (
                          <button
                            type="button"
                            disabled={linkBusy}
                            onClick={() => void handleRotateLink()}
                            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#DCDEEB] bg-white px-3 text-xs font-semibold text-[#23253E] transition-colors hover:border-[#5B42DC] hover:text-[#5B42DC] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                            Generate new link
                          </button>
                        ) : confirmLinkAction === 'rotate' ? (
                          <>
                            <button
                              type="button"
                              disabled={linkBusy}
                              onClick={() => void handleRotateLink()}
                              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#1C1D33] px-3 text-xs font-semibold text-white hover:bg-[#2F3152] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              Confirm rotate
                            </button>
                            <button
                              type="button"
                              disabled={linkBusy}
                              onClick={() => setConfirmLinkAction(null)}
                              className="inline-flex h-9 items-center rounded-xl border border-[#DCDEEB] bg-white px-2.5 text-xs font-semibold text-[#474A63] hover:text-[#1C1D33] cursor-pointer"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            disabled={linkBusy}
                            onClick={() => setConfirmLinkAction('rotate')}
                            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#DCDEEB] bg-white px-3 text-xs font-semibold text-[#23253E] transition-colors hover:border-[#5B42DC] hover:text-[#5B42DC] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                            Rotate link
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Manual Post Entry Form */}
                  {showPostForm && !activeCampaign.reviewLinkRevoked && (
                    <div className="rounded-2xl border border-[#5B42DC]/40 bg-white p-6">
                      <h3 className="text-base font-bold text-[#1C1D33]">
                        Add post to {activeCampaign.name}
                      </h3>
                      <p className="mt-1 text-xs text-[#646780]">
                        Manual post entry with caption, channel, target date, and campaign-scoped
                        image.
                      </p>

                      <form onSubmit={handleCreatePost} className="mt-4 space-y-4">
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                          <div>
                            <label
                              htmlFor="post-title"
                              className="block text-xs font-semibold text-[#474A63]"
                            >
                              Short label (optional)
                            </label>
                            <input
                              id="post-title"
                              type="text"
                              maxLength={120}
                              value={postTitle}
                              onChange={(e) => setPostTitle(e.target.value)}
                              placeholder="New collection teaser"
                              className="mt-1 h-10 w-full rounded-xl border border-[#DCDEEB] px-3 text-sm text-[#1C1D33] focus:border-[#5B42DC] focus:outline-none"
                            />
                          </div>

                          <div>
                            <label
                              htmlFor="post-channel"
                              className="block text-xs font-semibold text-[#474A63]"
                            >
                              Channel
                            </label>
                            <select
                              id="post-channel"
                              value={postChannel}
                              onChange={(e) => setPostChannel(e.target.value as SocialChannel)}
                              className="mt-1 h-10 w-full rounded-xl border border-[#DCDEEB] bg-white px-3 text-sm text-[#1C1D33] focus:border-[#5B42DC] focus:outline-none"
                            >
                              {ALLOWED_CHANNELS.map((ch) => (
                                <option key={ch} value={ch}>
                                  {ch}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label
                              htmlFor="post-date"
                              className="block text-xs font-semibold text-[#474A63]"
                            >
                              Target date
                            </label>
                            <input
                              id="post-date"
                              type="date"
                              required
                              value={postDate}
                              onChange={(e) => setPostDate(e.target.value)}
                              className="mt-1 h-10 w-full rounded-xl border border-[#DCDEEB] px-3 font-mono text-sm text-[#1C1D33] focus:border-[#5B42DC] focus:outline-none"
                            />
                          </div>
                        </div>

                        <div>
                          <label
                            htmlFor="post-caption"
                            className="block text-xs font-semibold text-[#474A63]"
                          >
                            Caption
                          </label>
                          <textarea
                            id="post-caption"
                            rows={3}
                            required
                            maxLength={2200}
                            value={postCaption}
                            onChange={(e) => setPostCaption(e.target.value)}
                            placeholder="Write the post copy and hashtags your client should review…"
                            className="mt-1 w-full rounded-xl border border-[#DCDEEB] p-3 text-sm text-[#1C1D33] focus:border-[#5B42DC] focus:outline-none"
                          />
                        </div>

                        <div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-[#474A63]">Post image</span>
                            <div className="inline-flex rounded-lg bg-[#F3F4FA] p-0.5 text-xs">
                              <button
                                type="button"
                                onClick={() => setImageMode('upload')}
                                className={`rounded-md px-2.5 py-1 font-semibold cursor-pointer ${
                                  imageMode === 'upload'
                                    ? 'bg-white text-[#1C1D33] shadow-xs'
                                    : 'text-[#60637C]'
                                }`}
                              >
                                Upload file
                              </button>
                              <button
                                type="button"
                                onClick={() => setImageMode('url')}
                                className={`rounded-md px-2.5 py-1 font-semibold cursor-pointer ${
                                  imageMode === 'url'
                                    ? 'bg-white text-[#1C1D33] shadow-xs'
                                    : 'text-[#60637C]'
                                }`}
                              >
                                Image URL
                              </button>
                            </div>
                          </div>

                          {imageMode === 'upload' ? (
                            <label className="mt-2 flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-dashed border-[#CFD2E4] bg-[#FAFBFD] px-4 py-3 text-sm text-[#555870] hover:border-[#5B42DC]">
                              <span className="inline-flex items-center gap-2 truncate">
                                <Upload className="h-4 w-4 shrink-0 text-[#5B42DC]" />
                                {imageFile
                                  ? imageFile.name
                                  : 'Choose PNG, JPEG, WEBP, or GIF (max 5MB)'}
                              </span>
                              <input
                                type="file"
                                accept="image/png,image/jpeg,image/webp,image/gif"
                                className="sr-only"
                                onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
                              />
                              <span className="text-xs font-semibold text-[#5B42DC] shrink-0">
                                Browse
                              </span>
                            </label>
                          ) : (
                            <div>
                              <input
                                type="url"
                                aria-label="External HTTPS image URL"
                                maxLength={2000}
                                value={imageUrl}
                                onChange={(e) => setImageUrl(e.target.value)}
                                placeholder="https://example.com/post-creative.jpg"
                                className="mt-2 h-10 w-full rounded-xl border border-[#DCDEEB] px-3 text-sm text-[#1C1D33] focus:border-[#5B42DC] focus:outline-none"
                              />
                              <p className="mt-1.5 text-[11px] leading-relaxed text-[#6B6E87]">
                                PostProofs downloads and stores a private copy (PNG, JPEG, WEBP, or
                                GIF up to 5 MB) in campaign-scoped storage. Clients never see the
                                original URL.
                              </p>
                            </div>
                          )}
                        </div>

                        {postError && (
                          <div
                            role="alert"
                            className="rounded-xl border border-[#F0C8C4] bg-[#FDF4F3] p-3 text-xs font-medium text-[#9B2B22]"
                          >
                            <p>{postError}</p>
                            {postUpgradePrompt && (
                              <button
                                type="button"
                                onClick={() => openTab('billing')}
                                className="mt-2 font-semibold text-[#5B42DC] underline cursor-pointer"
                              >
                                View plans & upgrade
                              </button>
                            )}
                          </div>
                        )}

                        <div className="flex items-center justify-end gap-2.5">
                          <button
                            type="button"
                            onClick={() => {
                              setShowPostForm(false);
                              resetPostFormFields();
                            }}
                            className="h-10 rounded-xl border border-[#DCDEEB] bg-white px-4 text-xs font-semibold text-[#474A63] hover:text-[#1C1D33] cursor-pointer"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={postBusy}
                            className="h-10 rounded-xl bg-[#5B42DC] px-5 text-xs font-semibold text-white transition-colors hover:bg-[#4931C2] disabled:opacity-50 cursor-pointer"
                          >
                            {postBusy ? 'Saving post…' : 'Save post for review'}
                          </button>
                        </div>
                      </form>
                    </div>
                  )}

                  {/* View Switcher & Channel Filter (always visible so Week Grid / Kanban / Feed are 1 click away) */}
                  <CampaignViewToolbar
                    viewMode={campaignViewMode}
                    onChangeViewMode={setCampaignViewMode}
                    channelFilter={campaignChannelFilter}
                    onChangeChannelFilter={setCampaignChannelFilter}
                    channels={campaignChannels}
                    searchQuery={campaignSearchQuery}
                    onChangeSearchQuery={setCampaignSearchQuery}
                  />

                  {/* Creator View of Saved Post Statuses & Client Feedback */}
                  {posts.length > 0 && filteredPosts.length === 0 ? (
                    <div className="rounded-2xl border border-[#E2E4F0] bg-white p-10 text-center">
                      <p className="text-sm font-semibold text-[#1C1D33]">
                        No posts match this filter
                      </p>
                      <p className="mt-1 text-xs text-[#646780]">
                        Clear your search or channel filter to view all posts in this campaign.
                      </p>
                    </div>
                  ) : campaignViewMode === 'week' ? (
                    <WeekGridView
                      posts={filteredPosts}
                      linkRevoked={activeCampaign.reviewLinkRevoked}
                      onInspectPost={(post) =>
                        setInspectedTarget({ campaignId: activeCampaign.id, postId: post.id })
                      }
                      onEditPost={(post) => {
                        setCampaignViewMode('list');
                        startEditingPost(post);
                      }}
                      onAddPostForDate={(isoDate) => {
                        setPostDate(isoDate);
                        setShowPostForm(true);
                      }}
                    />
                  ) : campaignViewMode === 'kanban' ? (
                    <KanbanBoardView
                      posts={filteredPosts}
                      linkRevoked={activeCampaign.reviewLinkRevoked}
                      onInspectPost={(post) =>
                        setInspectedTarget({ campaignId: activeCampaign.id, postId: post.id })
                      }
                      onEditPost={(post) => {
                        setCampaignViewMode('list');
                        startEditingPost(post);
                      }}
                      onResetToInReview={(postId) => void handleResetPostReview(postId)}
                      onAddPost={() => setShowPostForm(true)}
                    />
                  ) : posts.length === 0 ? (
                    <div className="rounded-2xl border border-[#E2E4F0] bg-white p-10 text-center">
                      <p className="text-sm font-semibold text-[#1C1D33]">
                        No posts in this campaign yet
                      </p>
                      <p className="mt-1 text-xs text-[#646780]">
                        Click “New post draft” to enter a post with its caption, channel, date, and
                        image.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {filteredPosts.map((post) => (
                        <article
                          key={post.id}
                          className="grid grid-cols-1 gap-5 rounded-2xl border border-[#E2E4F0] bg-white p-5 sm:grid-cols-12"
                        >
                          <div className="sm:col-span-3">
                            <Thumbnail src={post.imageUrl} alt={post.title} />
                          </div>

                          <div className="flex flex-col justify-between sm:col-span-9">
                            {editingPostId === post.id ? (
                              <form
                                onSubmit={(e) => void handleSavePostEdit(e, post.id, false)}
                                className="space-y-3"
                              >
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                  <div>
                                    <label
                                      htmlFor={`edit-title-${post.id}`}
                                      className="block text-[11px] font-semibold text-[#474A63]"
                                    >
                                      Title
                                    </label>
                                    <input
                                      id={`edit-title-${post.id}`}
                                      type="text"
                                      required
                                      maxLength={120}
                                      value={editPostTitle}
                                      onChange={(e) => setEditPostTitle(e.target.value)}
                                      className="mt-1 h-9 w-full rounded-xl border border-[#DCDEEB] px-3 text-xs text-[#1C1D33] focus:border-[#5B42DC] focus:outline-none"
                                    />
                                  </div>
                                  <div>
                                    <label
                                      htmlFor={`edit-channel-${post.id}`}
                                      className="block text-[11px] font-semibold text-[#474A63]"
                                    >
                                      Channel
                                    </label>
                                    <select
                                      id={`edit-channel-${post.id}`}
                                      value={editPostChannel}
                                      onChange={(e) =>
                                        setEditPostChannel(e.target.value as SocialChannel)
                                      }
                                      className="mt-1 h-9 w-full rounded-xl border border-[#DCDEEB] bg-white px-2.5 text-xs text-[#1C1D33] focus:border-[#5B42DC] focus:outline-none"
                                    >
                                      {ALLOWED_CHANNELS.map((ch) => (
                                        <option key={ch} value={ch}>
                                          {ch}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                  <div>
                                    <label
                                      htmlFor={`edit-date-${post.id}`}
                                      className="block text-[11px] font-semibold text-[#474A63]"
                                    >
                                      Target date
                                    </label>
                                    <input
                                      id={`edit-date-${post.id}`}
                                      type="date"
                                      required
                                      value={editPostDate}
                                      onChange={(e) => setEditPostDate(e.target.value)}
                                      className="mt-1 h-9 w-full rounded-xl border border-[#DCDEEB] px-2.5 font-mono text-xs text-[#1C1D33] focus:border-[#5B42DC] focus:outline-none"
                                    />
                                  </div>
                                </div>
                                <div>
                                  <label
                                    htmlFor={`edit-caption-${post.id}`}
                                    className="block text-[11px] font-semibold text-[#474A63]"
                                  >
                                    Caption
                                  </label>
                                  <textarea
                                    id={`edit-caption-${post.id}`}
                                    rows={3}
                                    required
                                    maxLength={2200}
                                    value={editPostCaption}
                                    onChange={(e) => setEditPostCaption(e.target.value)}
                                    className="mt-1 w-full rounded-xl border border-[#DCDEEB] p-2.5 text-xs text-[#1C1D33] focus:border-[#5B42DC] focus:outline-none"
                                  />
                                </div>
                                <div className="flex flex-wrap items-center justify-end gap-2">
                                  <button
                                    type="button"
                                    disabled={editPostBusy}
                                    onClick={() => setEditingPostId(null)}
                                    className="h-8 rounded-xl border border-[#DCDEEB] bg-white px-3 text-xs font-semibold text-[#474A63] hover:text-[#1C1D33] cursor-pointer"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="submit"
                                    disabled={editPostBusy}
                                    className="h-8 rounded-xl border border-[#5B42DC] bg-white px-3 text-xs font-semibold text-[#5B42DC] hover:bg-[#F6F4FF] disabled:opacity-50 cursor-pointer"
                                  >
                                    {editPostBusy ? 'Saving…' : 'Save changes'}
                                  </button>
                                  {post.status === 'changes_requested' && (
                                    <button
                                      type="button"
                                      disabled={editPostBusy}
                                      onClick={(e) => void handleSavePostEdit(e, post.id, true)}
                                      className="h-8 rounded-xl bg-[#5B42DC] px-3 text-xs font-semibold text-white hover:bg-[#4931C2] disabled:opacity-50 cursor-pointer"
                                    >
                                      Save & mark ready for re-review
                                    </button>
                                  )}
                                </div>
                              </form>
                            ) : (
                              <div>
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div>
                                    <h3 className="text-base font-bold text-[#1C1D33]">
                                      {post.title}
                                    </h3>
                                    <p className="mt-0.5 font-mono text-xs tabular-nums text-[#6B6E87]">
                                      {post.channel} · {post.scheduledDate}
                                    </p>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <PostStatusText status={post.status} />
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setInspectedTarget({
                                          campaignId: activeCampaign.id,
                                          postId: post.id,
                                        })
                                      }
                                      aria-label={`Inspect ${post.title}`}
                                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#ECEDF4] px-2.5 text-[11px] font-semibold text-[#474A63] transition-colors hover:border-[#C2B8FA] hover:text-[#5B42DC] cursor-pointer"
                                    >
                                      <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                                      Inspect
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => startEditingPost(post)}
                                      aria-label={`Edit ${post.title}`}
                                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#ECEDF4] text-[#7D8099] transition-colors hover:border-[#C2B8FA] hover:text-[#5B42DC] cursor-pointer"
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </button>
                                    {confirmDeletePostId === post.id ? (
                                      <>
                                        <button
                                          type="button"
                                          disabled={deletePostBusy}
                                          onClick={() => void handleDeletePost(post.id)}
                                          className="inline-flex h-8 items-center rounded-lg bg-[#9B2B22] px-2.5 text-[11px] font-semibold text-white hover:bg-[#7F221B] disabled:opacity-50 cursor-pointer"
                                        >
                                          {deletePostBusy ? 'Deleting…' : 'Confirm'}
                                        </button>
                                        <button
                                          type="button"
                                          disabled={deletePostBusy}
                                          onClick={() => setConfirmDeletePostId(null)}
                                          className="inline-flex h-8 items-center rounded-lg border border-[#DCDEEB] bg-white px-2 text-[11px] font-semibold text-[#474A63] hover:text-[#1C1D33] cursor-pointer"
                                        >
                                          Cancel
                                        </button>
                                      </>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setConfirmDeletePostId(post.id);
                                          setEditingPostId(null);
                                        }}
                                        aria-label={`Delete ${post.title}`}
                                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#ECEDF4] text-[#7D8099] transition-colors hover:border-[#EED2CE] hover:text-[#9B2B22] cursor-pointer"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    )}
                                  </div>
                                </div>

                                <p className="mt-2.5 whitespace-pre-wrap text-sm leading-relaxed text-[#43465E]">
                                  {post.caption}
                                </p>

                                <div className="mt-4 border-t border-[#ECEDF4] pt-3.5">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#5E617A]">
                                      <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                                      Comments ({post.comments.length})
                                    </span>

                                    {post.status === 'changes_requested' && (
                                      <button
                                        type="button"
                                        onClick={() => handleResetPostReview(post.id)}
                                        className="text-xs font-semibold text-[#5B42DC] hover:underline cursor-pointer"
                                      >
                                        Mark ready for re-review
                                      </button>
                                    )}
                                  </div>

                                  {post.comments.length > 0 && (
                                    <div className="mt-2.5 space-y-2">
                                      {post.comments.map((comment) => (
                                        <div
                                          key={comment.id}
                                          className="rounded-xl border border-[#ECEDF4] bg-[#FAFBFD] px-3 py-2 text-xs"
                                        >
                                          <div className="flex items-center justify-between gap-2">
                                            <span className="font-semibold text-[#1C1D33]">
                                              {comment.authorName} ·{' '}
                                              {comment.authorRole === 'client' ? 'Client' : 'Creator'}
                                            </span>
                                            <span className="font-mono text-[11px] text-[#7D8099]">
                                              {new Date(comment.createdAt).toLocaleDateString()}
                                            </span>
                                          </div>
                                          <p className="mt-0.5 leading-relaxed text-[#4A4D66]">
                                            {comment.body}
                                          </p>
                                        </div>
                                      ))}
                                    </div>
                                  )}

                                  {!activeCampaign.reviewLinkRevoked && (
                                    <form
                                      onSubmit={(e) => handleCreatorReply(e, post.id)}
                                      className="mt-2.5 flex items-center gap-2"
                                    >
                                      <input
                                        type="text"
                                        aria-label={`Reply to feedback on ${post.title}`}
                                        maxLength={1500}
                                        value={replyDrafts[post.id] || ''}
                                        onChange={(e) =>
                                          setReplyDrafts((prev) => ({
                                            ...prev,
                                            [post.id]: e.target.value,
                                          }))
                                        }
                                        placeholder="Reply to client feedback…"
                                        className="h-9 min-w-0 flex-1 rounded-xl border border-[#DCDEEB] px-3 text-xs text-[#1C1D33] focus:border-[#5B42DC] focus:outline-none"
                                      />
                                      <button
                                        type="submit"
                                        disabled={!(replyDrafts[post.id] || '').trim()}
                                        className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#DCDEEB] bg-white px-3 text-xs font-semibold text-[#23253E] hover:border-[#5B42DC] hover:text-[#5B42DC] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                                      >
                                        <Send className="h-3 w-3" aria-hidden="true" />
                                        Reply
                                      </button>
                                    </form>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  )}

                  <CampaignBatchFooterBar
                    campaign={activeCampaign}
                    pendingCount={inReviewCount + changesCount}
                    copiedToken={copiedToken}
                    onCopyLink={() => handleCopyReviewLink(activeCampaign.activeReviewToken)}
                  />
                </>
              )}
          </section>
        )}
        </main>
      </div>

      {/* Create New Campaign Modal (opened from sidebar or Client Portals) */}
      {showNewCampaignModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1C1D33]/45 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-new-campaign-title"
          onClick={() => setShowNewCampaignModal(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-[#E2E4F0] bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 id="modal-new-campaign-title" className="text-lg font-bold text-[#1C1D33]">
                Create new campaign
              </h2>
              <button
                type="button"
                onClick={() => setShowNewCampaignModal(false)}
                aria-label="Close modal"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#5D607A] hover:bg-[#F4F5FA] cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleCreateCampaign} className="mt-4 space-y-3.5">
              <div>
                <label htmlFor="modal-cmp-name" className="block text-xs font-semibold text-[#474A63]">
                  Campaign name
                </label>
                <input
                  id="modal-cmp-name"
                  type="text"
                  required
                  maxLength={120}
                  value={newCampaignName}
                  onChange={(e) => setNewCampaignName(e.target.value)}
                  placeholder="Spring launch · Week 2"
                  className="mt-1 h-10 w-full rounded-xl border border-[#DCDEEB] px-3 text-sm text-[#1C1D33] focus:border-[#5B42DC] focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="modal-cmp-client" className="block text-xs font-semibold text-[#474A63]">
                  Client name
                </label>
                <input
                  id="modal-cmp-client"
                  type="text"
                  required
                  maxLength={120}
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  placeholder="Solstice Home"
                  className="mt-1 h-10 w-full rounded-xl border border-[#DCDEEB] px-3 text-sm text-[#1C1D33] focus:border-[#5B42DC] focus:outline-none"
                />
              </div>

              {campaignError && (
                <div
                  role="alert"
                  className="rounded-xl border border-[#F0C8C4] bg-[#FDF4F3] p-3 text-xs font-medium text-[#9B2B22]"
                >
                  <p>{campaignError}</p>
                  {campaignUpgradePrompt && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowNewCampaignModal(false);
                        openTab('billing');
                      }}
                      className="mt-2 font-semibold text-[#5B42DC] underline cursor-pointer"
                    >
                      View plans &amp; upgrade
                    </button>
                  )}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewCampaignModal(false)}
                  className="h-9 rounded-xl border border-[#DCDEEB] bg-white px-4 text-xs font-semibold text-[#474A63] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={campaignBusy}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#5B42DC] px-4 text-xs font-semibold text-white hover:bg-[#4931C2] disabled:opacity-50 cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  {campaignBusy ? 'Creating…' : 'Create campaign'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {inspectedCampaign && inspectedTarget && (
        <PostProofDetailModal
          campaign={inspectedCampaign}
          posts={inspectedPosts}
          activePostId={inspectedTarget.postId}
          onSelectPost={(nextPostId) =>
            setInspectedTarget({ campaignId: inspectedCampaign.id, postId: nextPostId })
          }
          onClose={() => setInspectedTarget(null)}
          onEditPost={(post) => {
            setSelectedCampaignId(inspectedCampaign.id);
            openTab('campaigns');
            setCampaignViewMode('list');
            startEditingPost(post);
          }}
          onResetToInReview={handleResetPostForCampaign}
          onSubmitReply={handleSubmitReplyForCampaign}
        />
      )}
    </div>
  );
};
