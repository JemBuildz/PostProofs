import React, { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';

export type SelectedPlan = 'solo' | 'studio';

interface PlanModalProps {
  open: boolean;
  initialPlan: SelectedPlan;
  onClose: () => void;
}

export const EarlyAccessModal: React.FC<PlanModalProps> = ({ open, initialPlan, onClose }) => {
  const [plan, setPlan] = useState<SelectedPlan>(initialPlan);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [clientCount, setClientCount] = useState('1–3 clients');
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    setPlan(initialPlan);
    setSubmitted(false);
    setError('');
  }, [initialPlan, open]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEmail = email.trim();
    if (!name.trim()) {
      setError('Please enter your name or studio name.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError('Please enter a valid work email address.');
      return;
    }
    setError('');
    setSubmitted(true);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#18192C]/50 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="early-access-modal-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-[#DFE1EC] bg-white p-6 shadow-xl sm:p-7"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-[#5B42DC]">Early access</p>
            <h2
              id="early-access-modal-title"
              className="mt-1 text-2xl font-bold tracking-tight text-[#1C1D33]"
            >
              {submitted ? 'You are on the early-access list' : 'Reserve your beta workspace'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#E5E6F0] text-[#5C5F78] transition-colors hover:bg-[#F7F8FC] hover:text-[#1C1D33] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {submitted ? (
          <div className="mt-5">
            <div className="rounded-xl border border-[#CBE7D9] bg-[#F1FAF5] p-4">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1E6F4A] text-white">
                  <Check className="h-3.5 w-3.5" />
                </span>
                <div className="text-sm text-[#1E4633]">
                  <p className="font-semibold">
                    {plan === 'solo' ? 'Solo ($12/month)' : 'Studio ($29/month)'} selected for{' '}
                    {name.trim()}
                  </p>
                  <p className="mt-1 text-[#2E5E47]">
                    We’ve recorded <span className="font-medium">{email.trim()}</span>. Your invite
                    and CSV starter template will arrive when the next beta onboarding batch opens.
                  </p>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="mt-5 h-11 w-full rounded-xl bg-[#1C1D33] text-sm font-semibold text-white transition-colors hover:bg-[#2B2D4A] cursor-pointer"
            >
              Return to PostProofs
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-5 space-y-4" noValidate>
            <div>
              <span className="block text-xs font-semibold text-[#474A63]">Selected plan</span>
              <div className="mt-1.5 grid grid-cols-2 gap-2 rounded-xl bg-[#F4F5FA] p-1">
                <button
                  type="button"
                  onClick={() => setPlan('solo')}
                  className={`rounded-lg py-2 text-xs font-semibold transition-colors cursor-pointer ${
                    plan === 'solo'
                      ? 'bg-white text-[#1C1D33] shadow-xs'
                      : 'text-[#60637C] hover:text-[#1C1D33]'
                  }`}
                >
                  Solo · $12/mo
                </button>
                <button
                  type="button"
                  onClick={() => setPlan('studio')}
                  className={`rounded-lg py-2 text-xs font-semibold transition-colors cursor-pointer ${
                    plan === 'studio'
                      ? 'bg-white text-[#1C1D33] shadow-xs'
                      : 'text-[#60637C] hover:text-[#1C1D33]'
                  }`}
                >
                  Studio · $29/mo
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="ea-name" className="block text-xs font-semibold text-[#474A63]">
                Your name or studio
              </label>
              <input
                id="ea-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Alex Rivera · Northlight Social"
                className="mt-1.5 h-11 w-full rounded-xl border border-[#DCDEEB] bg-white px-3.5 text-sm text-[#1C1D33] placeholder:text-[#8E91A8] focus:border-[#5B42DC] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="ea-email" className="block text-xs font-semibold text-[#474A63]">
                Work email
              </label>
              <input
                id="ea-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="alex@studio.co"
                className="mt-1.5 h-11 w-full rounded-xl border border-[#DCDEEB] bg-white px-3.5 text-sm text-[#1C1D33] placeholder:text-[#8E91A8] focus:border-[#5B42DC] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="ea-clients" className="block text-xs font-semibold text-[#474A63]">
                Active clients per month
              </label>
              <select
                id="ea-clients"
                value={clientCount}
                onChange={(e) => setClientCount(e.target.value)}
                className="mt-1.5 h-11 w-full rounded-xl border border-[#DCDEEB] bg-white px-3.5 text-sm text-[#1C1D33] focus:border-[#5B42DC] focus:outline-none"
              >
                <option value="1–3 clients">1–3 clients</option>
                <option value="4–10 clients">4–10 clients</option>
                <option value="10+ clients">More than 10 clients</option>
              </select>
            </div>

            {error && (
              <p className="text-xs font-medium text-[#B9382C]" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              className="h-11 w-full rounded-xl bg-[#5B42DC] text-sm font-semibold text-white transition-colors hover:bg-[#4931C2] cursor-pointer"
            >
              Request {plan === 'solo' ? 'Solo' : 'Studio'} early access
            </button>

            <p className="text-center text-xs text-[#73768E]">
              No credit card required now. Monthly billing begins only when you activate your workspace.
            </p>
          </form>
        )}
      </div>
    </div>
  );
};

interface InfoModalProps {
  mode: 'privacy' | 'contact' | null;
  onClose: () => void;
}

export const FooterInfoModal: React.FC<InfoModalProps> = ({ mode, onClose }) => {
  const [contactEmail, setContactEmail] = useState('');
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setSent(false);
    setError('');
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

  const handleContactSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim())) {
      setError('Please enter a valid email address.');
      return;
    }
    if (!message.trim()) {
      setError('Please include a short note about your workflow or question.');
      return;
    }
    setError('');
    setSent(true);
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
              Uploaded calendar sheets, post creatives, and client approval notes remain private to
              your workspace and are accessible only via unique, revocable review URLs.
            </p>
            <p>
              You can delete any campaign, creative asset, or client feedback thread at any time
              from your workspace settings.
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
              <p className="font-semibold">Message received</p>
              <p className="mt-1 text-[#2E5E47]">
                Thanks for reaching out. We’ll reply to {contactEmail.trim()} within one business
                day.
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
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Questions about spreadsheet formats, client review links, or beta access..."
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
              className="h-10 w-full rounded-xl bg-[#5B42DC] text-sm font-semibold text-white transition-colors hover:bg-[#4931C2] cursor-pointer"
            >
              Send message
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
