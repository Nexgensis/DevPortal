import { useState, useMemo } from 'react';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Activity, AlertCircle, ArrowRight } from 'lucide-react';
import { AccentButton } from './ui/accent-button';

// Time-of-day greeting. Buckets: 5–12 morning, 12–17 afternoon, else evening.
function getTimeOfDay(): 'Morning' | 'Afternoon' | 'Evening' {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'Morning';
  if (h >= 12 && h < 17) return 'Afternoon';
  return 'Evening';
}

// Rotating quotes for the hero — DevOps / infra / cloud / automation flavor.
// Picked once per page load (useMemo with empty deps below).
const QUOTES: { text: string; author?: string }[] = [
  { text: 'If it hurts, do it more often.', author: 'Martin Fowler' },
  { text: 'You build it, you run it.', author: 'Werner Vogels' },
  { text: 'Cattle, not pets.', author: 'Infrastructure adage' },
  { text: 'Automate everything that hurts.' },
  { text: 'Infrastructure as code, not as art.' },
  { text: 'The best deployment is the one no one notices.' },
  { text: 'Logs are the most underrated form of debugging.' },
  { text: 'Continuous deployment is freedom from fear.' },
  { text: 'The cloud is just someone else’s computer.' },
  { text: 'There are only two hard things in CS: cache invalidation and naming things.', author: 'Phil Karlton' },
  { text: 'Move slow and fix things.', author: 'SRE proverb' },
  { text: 'Hope is not a strategy.', author: 'Google SRE' },
  { text: 'Reliability is a feature.' },
  { text: 'Ship small. Ship often. Ship safely.' },
];

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL)
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api';

interface LoginPageProps {
  onLogin: (credentials: { username: string; password: string }) => Promise<boolean>;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isMicrosoftLoading, setIsMicrosoftLoading] = useState(false);
  const [error, setError] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showAdminLogin, setShowAdminLogin] = useState(false);

  const timeOfDay = getTimeOfDay();
  const quote = useMemo(() => QUOTES[Math.floor(Math.random() * QUOTES.length)], []);

  const handleMicrosoftLogin = async () => {
    setError('');
    setIsMicrosoftLoading(true);
    try {
      const response = await fetch(`${API_BASE}/auth/microsoft`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error('Failed to get Microsoft login URL');
      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error('No login URL received');
      }
    } catch (err) {
      setError('Failed to initialize Microsoft login: ' + (err instanceof Error ? err.message : 'An error occurred'));
      setIsMicrosoftLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      const success = await onLogin({ username, password });
      if (!success) setError('Invalid username or password');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row p-4 gap-4">
      {/* =================== LEFT: Brand panel with warm bloom =================== */}
      <div
        className="relative lg:w-1/2 rounded-3xl overflow-hidden flex flex-col justify-between p-10 lg:p-14 min-h-[42vh] lg:min-h-[calc(100vh-2rem)] border border-[var(--border)]"
        style={{
          background:
            'radial-gradient(60% 50% at 25% 25%, color-mix(in srgb, var(--accent-peach) 50%, transparent) 0%, transparent 60%),' +
            'radial-gradient(55% 45% at 70% 65%, color-mix(in srgb, var(--accent-pink) 45%, transparent) 0%, transparent 60%),' +
            'var(--canvas-soft)',
        }}
      >
        {/* Top row: brand */}
        <div className="relative flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-[var(--accent-pink)] flex items-center justify-center">
            <Activity className="h-5 w-5 text-[var(--ink)]" />
          </div>
          <div>
            <div className="text-sm font-semibold text-[var(--ink)] tracking-tight">DevOps Dashboard</div>
            <div className="text-[11px] text-[var(--ink-muted)]">by Sourav</div>
          </div>
        </div>

        {/* Hero copy */}
        <div className="relative">
          <h1 className="text-5xl lg:text-6xl xl:text-7xl font-semibold text-[var(--ink)] leading-[1.02] tracking-tight max-w-[8em]">
            Good
            <br />
            <span className="text-[var(--ink)]/40">{timeOfDay}.</span>
          </h1>
          <blockquote className="mt-6 max-w-md">
            <p className="text-[var(--ink-muted)] text-base lg:text-lg leading-relaxed italic">
              “{quote.text}”
            </p>
            {quote.author && (
              <footer className="text-[11px] text-[var(--ink-muted)] uppercase tracking-[0.18em] mt-2 not-italic">
                — {quote.author}
              </footer>
            )}
          </blockquote>
        </div>

        {/* Bottom footer */}
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-2.5 rounded-full bg-[var(--card)]/80 border border-[var(--border)] px-3 py-1.5">
            <span className="status-dot-online" />
            <span className="text-[11px] text-[var(--ink)] font-medium">12 apps · 8 servers online</span>
          </div>
          <span className="text-[11px] text-[var(--ink-muted)]">© 2026 Sourav</span>
        </div>
      </div>

      {/* =================== RIGHT: Form panel — cream canvas + white card =================== */}
      <div className="relative lg:w-1/2 flex items-center justify-center p-4 lg:p-8 min-h-[58vh] lg:min-h-[calc(100vh-2rem)]">
        <div className="w-full max-w-md bento-card p-8 lg:p-10">
          <div className="mb-7">
            <h2 className="text-3xl font-semibold text-[var(--ink)] mb-1 tracking-tight">Welcome back</h2>
            <p className="text-[var(--ink-muted)] text-sm">Sign in to your account to continue.</p>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-2xl px-3.5 py-3 text-sm bg-[var(--accent-destructive-soft)] border border-[color-mix(in_srgb,var(--accent-destructive)_25%,transparent)] text-[var(--accent-destructive)] mb-5">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Microsoft SSO */}
          <button
            type="button"
            onClick={handleMicrosoftLogin}
            disabled={isMicrosoftLoading || isLoading}
            className="w-full h-12 rounded-2xl flex items-center justify-center gap-3 text-sm font-medium bg-[var(--ink)] text-[var(--card)] hover:bg-[var(--ink)]/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isMicrosoftLoading ? (
              <span className="h-4 w-4 rounded-full border-2 border-white/60 border-r-transparent animate-spin" />
            ) : (
              <svg className="h-4 w-4" viewBox="0 0 23 23" fill="none">
                <rect x="1" y="1" width="10" height="10" fill="#F25022" />
                <rect x="12" y="1" width="10" height="10" fill="#7FBA00" />
                <rect x="1" y="12" width="10" height="10" fill="#00A4EF" />
                <rect x="12" y="12" width="10" height="10" fill="#FFB900" />
              </svg>
            )}
            {isMicrosoftLoading ? 'Redirecting to Microsoft…' : 'Continue with Microsoft'}
          </button>

          {/* Admin login — collapsed by default. Click the link to reveal the credentials form. */}
          {!showAdminLogin ? (
            <div className="mt-6 text-center">
              <button
                type="button"
                onClick={() => setShowAdminLogin(true)}
                className="text-xs text-[var(--ink-muted)] hover:text-[var(--ink)] underline underline-offset-4 decoration-[var(--ink-muted)]/40 hover:decoration-[var(--ink)]/60 transition-colors focus:outline-none"
              >
                Admin login
              </button>
            </div>
          ) : (
            <>
              {/* Divider */}
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-[var(--border)]" />
                </div>
                <div className="relative flex justify-center text-[11px] uppercase tracking-[0.18em]">
                  <span className="px-3 text-[var(--ink-muted)] bg-[var(--card)]">Admin login</span>
                </div>
              </div>

              {/* Credentials form */}
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="username" className="text-[var(--ink)]/70 text-xs uppercase tracking-wider">
                    Username
                  </Label>
                  <Input
                    id="username"
                    type="text"
                    placeholder="your.username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="h-12 rounded-xl"
                    required
                    autoFocus
                    disabled={isLoading || isMicrosoftLoading}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-[var(--ink)]/70 text-xs uppercase tracking-wider">
                    Password
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-12 rounded-xl"
                    required
                    disabled={isLoading || isMicrosoftLoading}
                  />
                </div>
                <AccentButton
                  type="submit"
                  variant="pink"
                  size="lg"
                  className="w-full h-12 mt-2 rounded-2xl"
                  disabled={isLoading || isMicrosoftLoading}
                  loading={isLoading}
                >
                  {isLoading ? 'Signing in…' : 'Sign in'}
                  {!isLoading && <ArrowRight className="h-4 w-4" />}
                </AccentButton>
              </form>

              {/* Collapse back to just the Microsoft button */}
              <div className="mt-4 text-center">
                <button
                  type="button"
                  onClick={() => {
                    setShowAdminLogin(false);
                    setUsername('');
                    setPassword('');
                    setError('');
                  }}
                  className="text-xs text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors focus:outline-none"
                >
                  Cancel
                </button>
              </div>
            </>
          )}

          <p className="text-[11px] text-[var(--ink-muted)] mt-8 text-center">
            Protected by Microsoft Entra ID · SSL encrypted
          </p>
        </div>
      </div>
    </div>
  );
}
