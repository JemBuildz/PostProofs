import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { ClientReviewPage } from './components/ClientReviewPage';
import { CreatorWorkspace } from './components/CreatorWorkspace';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LandingPage } from './components/LandingPage';
import postproofsLogo from './assets/images/postproofs_logo.png';

export interface NavigateOptions {
  replace?: boolean;
}

function getCurrentRoute() {
  return {
    pathname: window.location.pathname,
    search: window.location.search,
  };
}

function safeDecodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return '';
  }
}

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  return pathname.replace(/\/+$/, '') || '/';
}

function NotFoundPage({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate: (to: string, options?: NavigateOptions) => void;
}) {
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
            onClick={() => onNavigate('/app')}
            className="text-sm font-semibold text-[#5B42DC] transition-colors hover:text-[#4931C2] whitespace-nowrap shrink-0 cursor-pointer"
          >
            Open workspace
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-lg px-6 py-20">
        <div className="rounded-2xl border border-[#DFE1EC] bg-white p-8 text-center">
          <p className="font-mono text-xs font-semibold text-[#5B42DC]">404 · Page not found</p>
          <h1 className="mt-2 text-2xl font-bold tracking-[-0.03em] text-[#1C1D33]">
            We couldn’t find that page
          </h1>
          <p className="mt-2.5 text-sm leading-relaxed text-[#5B5E77]">
            No route matches <code className="font-mono text-xs text-[#1C1D33]">{pathname}</code>.
            Check the link or return to PostProofs below.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => onNavigate('/')}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#5B42DC] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#4931C2] cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to home
            </button>
            <button
              type="button"
              onClick={() => onNavigate('/app')}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-[#DCDEEB] bg-white px-4 text-sm font-semibold text-[#23253E] transition-colors hover:border-[#5B42DC] hover:text-[#5B42DC] cursor-pointer"
            >
              Creator workspace
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  const [route, setRoute] = useState(getCurrentRoute);

  useEffect(() => {
    const onPopState = () => setRoute(getCurrentRoute());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((to: string, options?: NavigateOptions) => {
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const shouldScrollTop = !options?.replace;
    if (options?.replace) {
      if (current !== to) {
        window.history.replaceState({}, '', to);
      }
    } else if (current !== to) {
      window.history.pushState({}, '', to);
    }
    setRoute(getCurrentRoute());
    if (shouldScrollTop) {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  }, []);

  const normalized = normalizePathname(route.pathname);

  // Normalize /index.html to /
  useEffect(() => {
    if (normalized === '/index.html') {
      navigate('/', { replace: true });
    }
  }, [normalized, navigate]);

  // All /review and /review/* routes go to ClientReviewPage (missing/extra/malformed token shows inactive link state)
  if (normalized === '/review' || normalized.startsWith('/review/')) {
    const reviewMatch = normalized.match(/^\/review\/([^/]+)$/);
    const token = reviewMatch ? safeDecodeSegment(reviewMatch[1]) : '';
    return (
      <ErrorBoundary>
        <ClientReviewPage token={token} onNavigate={navigate} />
      </ErrorBoundary>
    );
  }

  // Supported creator workspace routes: /app and /app/billing
  if (normalized === '/app' || normalized === '/app/billing') {
    return (
      <ErrorBoundary>
        <CreatorWorkspace
          pathname={normalized}
          search={route.search}
          onNavigate={navigate}
        />
      </ErrorBoundary>
    );
  }

  if (normalized === '/' || normalized === '/index.html') {
    return (
      <ErrorBoundary>
        <LandingPage onNavigate={navigate} />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <NotFoundPage pathname={route.pathname} onNavigate={navigate} />
    </ErrorBoundary>
  );
}
