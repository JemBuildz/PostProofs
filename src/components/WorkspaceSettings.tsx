import React, { useEffect, useState } from 'react';
import { sendEmailVerification, updateProfile } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { Check, CreditCard, MailWarning, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import type { BillingStatusResponse } from '../lib/api';

interface WorkspaceSettingsProps {
  user: User;
  billingStatus: BillingStatusResponse | null;
  onOpenBilling: () => void;
  onProfileUpdated: () => Promise<void>;
  onAccountDeleted: () => Promise<void>;
}

function formatPlanLabel(plan: BillingStatusResponse['subscriptionPlan']): string {
  if (plan === 'studio') return 'Studio ($29/mo)';
  if (plan === 'solo') return 'Solo ($12/mo)';
  return 'Free starter';
}

export const WorkspaceSettings: React.FC<WorkspaceSettingsProps> = ({
  user,
  billingStatus,
  onOpenBilling,
  onProfileUpdated,
  onAccountDeleted,
}) => {
  const [displayName, setDisplayName] = useState(user.displayName || '');
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');
  const [profileError, setProfileError] = useState('');

  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyMessage, setVerifyMessage] = useState('');
  const [verifyError, setVerifyError] = useState('');

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => {
    setDisplayName(user.displayName || '');
  }, [user.displayName]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = displayName.trim().slice(0, 80);
    if (!trimmed) {
      setProfileError('Enter a display name or studio name.');
      return;
    }

    setProfileBusy(true);
    setProfileError('');
    setProfileMessage('');
    try {
      await updateProfile(user, { displayName: trimmed });
      await onProfileUpdated();
      setProfileMessage('Profile name updated.');
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Unable to update profile.');
    } finally {
      setProfileBusy(false);
    }
  };

  const handleSendVerification = async () => {
    setVerifyBusy(true);
    setVerifyError('');
    setVerifyMessage('');
    try {
      await sendEmailVerification(user);
      setVerifyMessage(
        `Verification email sent to ${user.email || 'your inbox'}. Open the link, then click Refresh status.`
      );
    } catch (err) {
      setVerifyError(
        err instanceof Error ? err.message : 'Unable to send verification email right now.'
      );
    } finally {
      setVerifyBusy(false);
    }
  };

  const handleRefreshVerification = async () => {
    setVerifyBusy(true);
    setVerifyError('');
    setVerifyMessage('');
    try {
      await onProfileUpdated();
      setVerifyMessage(
        user.emailVerified
          ? 'Email address verified.'
          : 'Not verified yet — click the link in your email, then check again.'
      );
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : 'Unable to refresh account status.');
    } finally {
      setVerifyBusy(false);
    }
  };

  const handleDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (deleteConfirmText.trim() !== 'DELETE') {
      setDeleteError('Type DELETE in all caps to confirm permanent deletion.');
      return;
    }

    setDeleteBusy(true);
    setDeleteError('');
    try {
      await api.deleteAccount('DELETE');
      await onAccountDeleted();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Unable to delete account.');
      setDeleteBusy(false);
    }
  };

  return (
    <section className="mx-auto max-w-3xl space-y-6" aria-labelledby="settings-heading">
      {/* Profile & Identity */}
      <div className="rounded-2xl border border-[#E2E4F0] bg-white p-6 sm:p-7">
        <p className="text-xs font-semibold text-[#5B42DC]">Workspace profile</p>
        <h1
          id="settings-heading"
          className="mt-1 text-2xl font-bold tracking-[-0.03em] text-[#1C1D33]"
        >
          Account & settings
        </h1>
        <p className="mt-1.5 text-sm text-[#5B5E77]">
          Manage your creator display name, email verification status, and stored workspace data.
        </p>

        <form onSubmit={handleSaveProfile} className="mt-6 space-y-4 border-t border-[#ECEDF4] pt-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="settings-display-name"
                className="block text-xs font-semibold text-[#474A63]"
              >
                Display / studio name
              </label>
              <input
                id="settings-display-name"
                type="text"
                maxLength={80}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Studio or creator name"
                className="mt-1.5 h-10 w-full rounded-xl border border-[#DCDEEB] px-3 text-sm text-[#1C1D33] focus:border-[#5B42DC] focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="settings-email"
                className="block text-xs font-semibold text-[#474A63]"
              >
                Signed-in email
              </label>
              <input
                id="settings-email"
                type="text"
                readOnly
                value={user.email || ''}
                className="mt-1.5 h-10 w-full rounded-xl border border-[#ECEDF4] bg-[#FAFBFD] px-3 text-sm text-[#5B5E77]"
              />
            </div>
          </div>

          {profileMessage && (
            <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1E6F4A]">
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              {profileMessage}
            </p>
          )}
          {profileError && (
            <p role="alert" className="text-xs font-medium text-[#9B2B22]">
              {profileError}
            </p>
          )}

          <div className="flex items-center justify-end">
            <button
              type="submit"
              disabled={profileBusy}
              className="inline-flex h-10 items-center justify-center rounded-xl bg-[#5B42DC] px-4 text-xs font-semibold text-white transition-colors hover:bg-[#4931C2] disabled:opacity-50 cursor-pointer"
            >
              {profileBusy ? 'Saving…' : 'Save profile'}
            </button>
          </div>
        </form>
      </div>

      {/* Email Verification */}
      <div className="rounded-2xl border border-[#E2E4F0] bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            {user.emailVerified ? (
              <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#EDF8F2] text-[#1E6F4A]">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              </div>
            ) : (
              <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FEF6EB] text-[#9A5B0A]">
                <MailWarning className="h-4 w-4" aria-hidden="true" />
              </div>
            )}
            <div>
              <h2 className="text-base font-bold text-[#1C1D33]">
                {user.emailVerified ? 'Email verified' : 'Email verification required'}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-[#5B5E77]">
                {user.emailVerified
                  ? 'Your account can create campaigns, upload creatives, manage review links, and start Stripe checkout.'
                  : 'Verify your email address before creating campaigns, uploading post creatives, or subscribing.'}
              </p>
            </div>
          </div>

          {!user.emailVerified && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={verifyBusy}
                onClick={() => void handleSendVerification()}
                className="inline-flex h-9 items-center rounded-xl bg-[#5B42DC] px-3.5 text-xs font-semibold text-white transition-colors hover:bg-[#4931C2] disabled:opacity-50 cursor-pointer"
              >
                Send verification email
              </button>
              <button
                type="button"
                disabled={verifyBusy}
                onClick={() => void handleRefreshVerification()}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#DCDEEB] bg-white px-3 text-xs font-semibold text-[#23253E] transition-colors hover:border-[#5B42DC] hover:text-[#5B42DC] disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                Refresh status
              </button>
            </div>
          )}
        </div>

        {verifyMessage && (
          <p className="mt-3 text-xs font-medium text-[#3F2DA8]">{verifyMessage}</p>
        )}
        {verifyError && (
          <p role="alert" className="mt-3 text-xs font-medium text-[#9B2B22]">
            {verifyError}
          </p>
        )}
      </div>

      {/* Plan & Storage Overview */}
      <div className="rounded-2xl border border-[#E2E4F0] bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-[#1C1D33]">Plan & workspace usage</h2>
            <p className="mt-1 text-xs text-[#5B5E77]">
              Current plan:{' '}
              <span className="font-semibold text-[#1C1D33]">
                {billingStatus ? formatPlanLabel(billingStatus.subscriptionPlan) : 'Loading…'}
              </span>
              {billingStatus && (
                <>
                  {' · '}
                  {billingStatus.usage.campaignsCount}/{billingStatus.entitlements.maxCampaigns}{' '}
                  campaigns · {billingStatus.usage.postsCount}/
                  {billingStatus.entitlements.maxPostsTotal} posts ·{' '}
                  {(billingStatus.usage.storageBytesUsed / (1024 * 1024)).toFixed(1)} MB stored
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenBilling}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#DCDEEB] bg-white px-3.5 text-xs font-semibold text-[#23253E] transition-colors hover:border-[#5B42DC] hover:text-[#5B42DC] cursor-pointer"
          >
            <CreditCard className="h-3.5 w-3.5" aria-hidden="true" />
            Manage billing
          </button>
        </div>
      </div>

      {/* Danger Zone: Permanent Account Deletion */}
      <div className="rounded-2xl border border-[#EED2CE] bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-[#9B2B22]">Delete workspace account</h2>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-[#5B5E77]">
              Permanently remove your PostProofs account, all campaigns, client review links,
              posts, comments, and stored images. If you have an active subscription, cancel it
              in the Billing portal first.
            </p>
          </div>
          {!showDeleteConfirm && (
            <button
              type="button"
              onClick={() => {
                setShowDeleteConfirm(true);
                setDeleteConfirmText('');
                setDeleteError('');
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#EED2CE] bg-white px-3.5 text-xs font-semibold text-[#9B2B22] transition-colors hover:bg-[#FDF4F3] cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              Delete account
            </button>
          )}
        </div>

        {showDeleteConfirm && (
          <form
            onSubmit={handleDeleteAccount}
            className="mt-4 space-y-3 rounded-xl border border-[#F0C8C4] bg-[#FDF4F3] p-4"
          >
            <label
              htmlFor="confirm-account-delete"
              className="block text-xs font-semibold text-[#9B2B22]"
            >
              Type <code className="font-mono">DELETE</code> to permanently erase all workspace
              data and your account:
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="confirm-account-delete"
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="DELETE"
                className="h-9 w-44 rounded-xl border border-[#E5B8B3] bg-white px-3 font-mono text-xs text-[#1C1D33] focus:border-[#9B2B22] focus:outline-none"
              />
              <button
                type="submit"
                disabled={deleteBusy || deleteConfirmText.trim() !== 'DELETE'}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#9B2B22] px-3.5 text-xs font-semibold text-white transition-colors hover:bg-[#7F221B] disabled:opacity-50 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                {deleteBusy ? 'Deleting…' : 'Confirm permanent delete'}
              </button>
              <button
                type="button"
                disabled={deleteBusy}
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeleteConfirmText('');
                  setDeleteError('');
                }}
                className="inline-flex h-9 items-center rounded-xl border border-[#DCDEEB] bg-white px-3 text-xs font-semibold text-[#474A63] hover:text-[#1C1D33] cursor-pointer"
              >
                Cancel
              </button>
            </div>
            {deleteError && (
              <p role="alert" className="text-xs font-medium text-[#9B2B22]">
                {deleteError}
              </p>
            )}
          </form>
        )}
      </div>
    </section>
  );
};
