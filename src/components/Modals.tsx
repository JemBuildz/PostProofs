import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../lib/api';

interface InfoModalProps {
  mode: 'privacy' | 'contact' | null;
  onClose: () => void;
}

export const FooterInfoModal: React.FC<InfoModalProps> = ({ mode, onClose }) => {
  const [contactEmail, setContactEmail] = useState('');
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setSent(false);
    setError('');
    setSubmitting(false);
    if (!mode) {
      setContactEmail('');
      setMessage('');
    }
  }, [mode]);

  useEffect(() => {
    if (!mode) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [mode, onClose]);

  if (!mode) return null;

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEmail = contactEmail.trim();
    const trimmedMessage = message.trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (!trimmedMessage || trimmedMessage.length < 3) {
      setError('Please include a short note about your question or workflow.');
      return;
    }

    setError('');
    setSubmitting(true);
    try {
      await api.submitContactInquiry({ email: trimmedEmail, message: trimmedMessage });
      setSent(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to submit your message. Please try again.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#18192C]/50 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="footer-info-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-[#DFE1EC] bg-white p-6 shadow-xl sm:p-7"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="footer-info-title" className="text-xl font-bold tracking-tight text-[#1C1D33]">
            {mode === 'privacy' ? 'Privacy & data handling' : 'Contact PostProofs'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#E5E6F0] text-[#5C5F78] transition-colors hover:bg-[#F7F8FC] hover:text-[#1C1D33] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {mode === 'privacy' ? (
          <div className="mt-4 space-y-3 text-sm leading-relaxed text-[#52556E]">
            <p>
              PostProofs is designed specifically for pre-publish client review. We never ask to
              connect or store credentials for your Instagram, LinkedIn, or social publishing
              accounts.
            </p>
            <p>
              Your campaigns, uploaded or imported post creatives, and client approval notes remain
              private to your workspace and are accessible only via unique, revocable review URLs.
            </p>
            <p>
              We use Firebase (Authentication, Firestore, Storage) for workspace state and Stripe
              for subscription billing. You can delete any post or campaign (along with its stored
              images) from the Campaigns tab, or permanently delete your account and all workspace
              data from Settings.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-2 h-10 w-full rounded-xl bg-[#1C1D33] text-sm font-semibold text-white transition-colors hover:bg-[#2B2D4A] cursor-pointer"
            >
              Close
            </button>
          </div>
        ) : sent ? (
          <div className="mt-4">
            <div className="rounded-xl border border-[#CBE7D9] bg-[#F1FAF5] p-4 text-sm text-[#1E4633]">
              <p className="font-semibold">Message saved</p>
              <p className="mt-1 text-[#2E5E47]">
                Thanks for reaching out. We’ve logged your inquiry and will follow up at{' '}
                {contactEmail.trim()}.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 h-10 w-full rounded-xl bg-[#1C1D33] text-sm font-semibold text-white transition-colors hover:bg-[#2B2D4A] cursor-pointer"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleContactSubmit} className="mt-4 space-y-3.5" noValidate>
            <div>
              <label htmlFor="contact-email" className="block text-xs font-semibold text-[#474A63]">
                Your email
              </label>
              <input
                id="contact-email"
                type="email"
                maxLength={160}
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="you@agency.co"
                className="mt-1.5 h-10 w-full rounded-xl border border-[#DCDEEB] px-3 text-sm text-[#1C1D33] focus:border-[#5B42DC] focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="contact-msg" className="block text-xs font-semibold text-[#474A63]">
                How can we help?
              </label>
              <textarea
                id="contact-msg"
                rows={3}
                maxLength={2000}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Questions about client review links, post approvals, or plans..."
                className="mt-1.5 w-full rounded-xl border border-[#DCDEEB] p-3 text-sm text-[#1C1D33] focus:border-[#5B42DC] focus:outline-none"
              />
            </div>
            {error && (
              <p className="text-xs font-medium text-[#B9382C]" role="alert">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="h-10 w-full rounded-xl bg-[#5B42DC] text-sm font-semibold text-white transition-colors hover:bg-[#4931C2] disabled:opacity-50 cursor-pointer"
            >
              {submitting ? 'Sending…' : 'Send message'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
