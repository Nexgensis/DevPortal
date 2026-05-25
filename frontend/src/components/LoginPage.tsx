import { useState, useMemo } from 'react';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  AlertCircle, ArrowRight,
  Server, Database, Boxes, Clock,
} from 'lucide-react';
import { AccentButton } from './ui/accent-button';
import { NexusMark } from './NexusAuraMark';
import {
  GitHubLogo, GitLogo, DockerLogo, PostgresLogo, SonarCloudLogo, TrivyLogo,
} from './BrandLogos';

// Floating tech-logo chips scattered around the hero. Each carries its brand color,
// a slow float (varied duration/delay) and an absolute position on the canvas.
const LOGO_CHIPS = [
  { Logo: GitLogo,        name: 'Git',             color: '#F05032', pos: 'left-[30%] top-[55%]',  dur: '10s', delay: '0s'  },
  { Logo: DockerLogo,     name: 'Docker',          color: '#2496ED', pos: 'left-[27%] top-[69%]',  dur: '13s', delay: '-7s' },
  { Logo: SonarCloudLogo, name: 'SonarQube Cloud', color: '#126ED3', pos: 'left-[30%] top-[83%]',  dur: '12s', delay: '-5s' },
  { Logo: GitHubLogo,     name: 'GitHub',          color: '#181717', pos: 'right-[30%] top-[55%]', dur: '11s', delay: '-3s' },
  { Logo: PostgresLogo,   name: 'PostgreSQL',      color: '#336791', pos: 'right-[27%] top-[69%]', dur: '9s',  delay: '-4s' },
  { Logo: TrivyLogo,      name: 'Trivy',           color: '#1904DA', pos: 'right-[30%] top-[83%]', dur: '14s', delay: '-2s' },
] as const;

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
    <div className="relative min-h-screen w-full flex flex-col bg-white overflow-hidden">
      {/* =========================== HERO =========================== */}
      <main className="relative flex-1 w-full flex items-center justify-center px-4 py-6">
        {/* Drifting peach → pink → purple mesh glow (30s loops) */}
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div
            className="mesh-blob-1 absolute left-1/2 top-1/2 h-[30rem] w-[30rem] -translate-x-1/2 -translate-y-[30%] rounded-full blur-[120px]"
            style={{ background: 'rgba(255, 196, 150, 0.55)' }}
          />
          <div
            className="mesh-blob-3 absolute left-[62%] top-[42%] h-[28rem] w-[28rem] rounded-full blur-[130px]"
            style={{ background: 'rgba(190, 150, 245, 0.45)' }}
          />
          <div
            className="mesh-blob-2 absolute left-[34%] top-[55%] h-[24rem] w-[24rem] rounded-full blur-[120px]"
            style={{ background: 'rgba(255, 150, 190, 0.34)' }}
          />
        </div>

        {/* Faint square grid behind the headline */}
        <div aria-hidden className="hero-grid pointer-events-none absolute left-1/2 top-1/2 h-[40rem] w-[52rem] -translate-x-1/2 -translate-y-1/2" />

        {/* ---- Floating accent cards (live status, lg screens only) ---- */}
        <div aria-hidden className="pointer-events-none absolute inset-0 hidden lg:block">
          {/* top-left: server deploy card */}
          <div
            className="card-float absolute left-[5%] top-[14%] w-60 rounded-2xl border border-gray-200/70 bg-white p-4 shadow-[0_18px_44px_-16px_rgba(80,40,120,0.22)]"
            style={{ animationDuration: '10s' }}
          >
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-600">
                <Server className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#1A1A1E] truncate">web-frontend</p>
                <p className="text-[11px] text-[#1A1A1E]/50">Deployed Wed 27 Oct, 2026</p>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between text-[11px] text-[#1A1A1E]/55">
              <span>v2.4.1 · healthy</span><span>100%</span>
            </div>
            <div className="mt-1.5 h-1.5 w-full rounded-full bg-gray-100">
              <div className="h-full w-full rounded-full bg-emerald-500" />
            </div>
          </div>

          {/* top-right: database card */}
          <div
            className="card-float absolute right-[5%] top-[18%] w-60 rounded-2xl border border-gray-200/70 bg-white p-4 shadow-[0_18px_44px_-16px_rgba(80,40,120,0.22)]"
            style={{ animationDuration: '11s', animationDelay: '-4s' }}
          >
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-blue-600">
                <Database className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#1A1A1E] truncate">postgres-primary</p>
                <p className="text-[11px] text-[#1A1A1E]/50">Backup Wed 27 Oct, 2026</p>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between text-[11px] text-[#1A1A1E]/55">
              <span>Uptime 99.9%</span><span>92%</span>
            </div>
            <div className="mt-1.5 h-1.5 w-full rounded-full bg-gray-100">
              <div className="h-full w-[92%] rounded-full bg-blue-500" />
            </div>
          </div>

          {/* center-left: purple "scheduled" card, slightly rotated */}
          <div
            className="card-float absolute left-[12%] top-[52%] w-52 -rotate-3 rounded-2xl p-4 text-white shadow-[0_20px_48px_-14px_rgba(124,58,237,0.5)]"
            style={{
              background: 'linear-gradient(135deg, #A855F7 0%, #7C3AED 100%)',
              animationDuration: '9s', animationDelay: '-2s',
            }}
          >
            <p className="text-[10px] uppercase tracking-[0.14em] text-white/70">Scheduled task</p>
            <p className="mt-0.5 text-sm font-semibold">Nightly backup</p>
            <div className="mt-2.5 flex gap-1.5">
              <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-[11px]">DB</span>
              <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-[11px]">Cron</span>
            </div>
            <div className="mt-3 flex items-center gap-1.5 text-[11px] text-white/85">
              <Clock className="h-3.5 w-3.5" /> 12:00 AM · daily
            </div>
          </div>

          {/* right: dark apps pill */}
          <div
            className="card-float absolute right-[10%] top-[56%] flex items-center gap-2.5 rounded-full bg-[#1A1A1E] py-2 pl-2 pr-4 text-white shadow-[0_14px_30px_-10px_rgba(0,0,0,0.4)]"
            style={{ animationDuration: '12s', animationDelay: '-6s' }}
          >
            <span className="grid h-8 w-8 place-items-center rounded-full bg-white/10">
              <Boxes className="h-4 w-4" />
            </span>
            <div className="leading-tight">
              <p className="text-[13px] font-semibold">12 apps</p>
              <p className="text-[10px] text-white/60">running</p>
            </div>
          </div>
        </div>

        {/* ---- Floating tech-logo chips (lg screens only) ---- */}
        <div aria-hidden className="pointer-events-none absolute inset-0 hidden lg:block">
          {LOGO_CHIPS.map(({ Logo, name, color, pos, dur, delay }) => (
            <div
              key={name}
              className={`card-float absolute ${pos} grid h-[4.5rem] w-[4.5rem] place-items-center rounded-2xl border border-gray-200/70 bg-white shadow-[0_16px_36px_-12px_rgba(80,40,120,0.28)]`}
              style={{ animationDuration: dur, animationDelay: delay }}
              title={name}
            >
              <Logo className="h-9 w-9" style={{ color }} />
            </div>
          ))}
        </div>

        {/* ---- Center column: headline + login card ---- */}
        <div className="relative z-10 w-full max-w-2xl flex flex-col items-center text-center">
          {/* eyebrow status pill */}
          <div className="inline-flex items-center gap-2 rounded-full border border-gray-200/70 bg-white/80 backdrop-blur px-3.5 py-1.5">
            <span className="status-dot-online" />
            <span className="text-[11px] font-medium text-[#1A1A1E]">All systems operational</span>
          </div>

          {/* headline (bold sans, two-tone like the reference) */}
          <h1 className="font-sans mt-5 text-5xl sm:text-6xl font-extrabold tracking-tight leading-[1.02] text-[#1A1A1E]">
            Good {timeOfDay}.
            <br />
            <span className="text-[#1A1A1E]/35">Welcome to Nexus Aura.</span>
          </h1>

          {/* subtext / rotating quote */}
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-[#1A1A1E]/55 italic">
            “{quote.text}”
            {quote.author && <span className="not-italic text-[#1A1A1E]/40"> — {quote.author}</span>}
          </p>

          {/* =================== Login card =================== */}
          <div className="mt-9 w-full max-w-md rounded-3xl border border-gray-200/70 bg-white p-7 sm:p-8 text-left shadow-[0_24px_60px_-20px_rgba(80,40,120,0.22)]">
            <div className="mb-6 flex items-center gap-3">
              <NexusMark className="h-9 w-9 shrink-0" />
              <div>
                <p className="text-sm font-semibold leading-tight text-[#1A1A1E]">Sign in to Nexus Aura</p>
                <p className="text-xs text-[#1A1A1E]/55">Database, apps, infrastructure &amp; users</p>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-xl px-3.5 py-3 text-sm bg-[var(--accent-destructive-soft)] border border-[color-mix(in_srgb,var(--accent-destructive)_25%,transparent)] text-[var(--accent-destructive)] mb-5">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Microsoft SSO */}
            <button
              type="button"
              onClick={handleMicrosoftLogin}
              disabled={isMicrosoftLoading || isLoading}
              className="w-full h-12 rounded-xl flex items-center justify-center gap-3 text-sm font-medium bg-[#1A1A1E] text-white hover:bg-[#1A1A1E]/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
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

            {/* Admin login — collapsed by default. */}
            {!showAdminLogin ? (
              <div className="mt-6 text-center">
                <button
                  type="button"
                  onClick={() => setShowAdminLogin(true)}
                  className="text-xs text-[#1A1A1E]/55 hover:text-[#1A1A1E] underline underline-offset-4 decoration-[#1A1A1E]/30 hover:decoration-[#1A1A1E]/60 transition-colors focus:outline-none"
                >
                  Admin login
                </button>
              </div>
            ) : (
              <>
                <div className="relative my-6">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-gray-200/70" />
                  </div>
                  <div className="relative flex justify-center text-[11px] uppercase tracking-[0.18em]">
                    <span className="px-3 text-[#1A1A1E]/45 bg-white">Admin login</span>
                  </div>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="username" className="text-[#1A1A1E]/70 text-xs uppercase tracking-wider">
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
                    <Label htmlFor="password" className="text-[#1A1A1E]/70 text-xs uppercase tracking-wider">
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
                    className="w-full h-12 mt-2 rounded-xl"
                    disabled={isLoading || isMicrosoftLoading}
                    loading={isLoading}
                  >
                    {isLoading ? 'Signing in…' : 'Sign in'}
                    {!isLoading && <ArrowRight className="h-4 w-4" />}
                  </AccentButton>
                </form>

                <div className="mt-4 text-center">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAdminLogin(false);
                      setUsername('');
                      setPassword('');
                      setError('');
                    }}
                    className="text-xs text-[#1A1A1E]/55 hover:text-[#1A1A1E] transition-colors focus:outline-none"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}

            <p className="text-[11px] text-[#1A1A1E]/45 mt-7 text-center">
              Protected by Microsoft Entra ID · SSL encrypted
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
