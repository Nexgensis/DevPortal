import { useEffect, useState } from 'react';
import { KeyRound, LifeBuoy, LogOut, ShieldCheck, Smartphone, Copy, Check, Download } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '../ui/input';
import { AccentButton } from '../ui/accent-button';
import { vaultApi, VaultApiError } from '../../lib/vaultApi';
import type { VaultEnrollment, VaultStatus } from '../../types/vault';

// The MFA gate is rendered *in place of* the vault content (not over it) while
// the vault is locked: nothing behind it has been fetched, so there is nothing
// to peek at. Three modes: first-time enrollment, unlock, and the one-time
// recovery-codes screen after enrolling.

type Mode = 'unlock' | 'recovery' | 'enroll' | 'codes';

interface Props {
  status: VaultStatus;
  onUnlocked: () => void;
  onSignOut: () => void;
  /** Message from a Microsoft sign-in that just came back unsuccessful. */
  initialError?: string | null;
}

function formatUntil(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function VaultMfaGate({ status, onUnlocked, onSignOut, initialError = null }: Props) {
  const [mode, setMode] = useState<Mode>(status.enrolled ? 'unlock' : 'enroll');
  // SSO sessions unlock by signing in to Microsoft again (their org's MFA);
  // the authenticator app is for local (password) logins.
  const microsoftFirst = status.methods.microsoft && (status.loginMethod === 'sso' || !status.methods.totp);
  const [useApp, setUseApp] = useState(false);
  const [msError, setMsError] = useState<string | null>(initialError);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [lockedUntil, setLockedUntil] = useState<string | null>(status.lockedOutUntil);
  const [enrollment, setEnrollment] = useState<VaultEnrollment | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [savedCodes, setSavedCodes] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  // Lockout expires on its own; re-enable the form when it does.
  useEffect(() => {
    if (!lockedUntil) return;
    const ms = new Date(lockedUntil).getTime() - Date.now();
    if (ms <= 0) {
      setLockedUntil(null);
      return;
    }
    const t = window.setTimeout(() => setLockedUntil(null), ms + 500);
    return () => window.clearTimeout(t);
  }, [lockedUntil]);

  const handleError = (e: unknown) => {
    if (e instanceof VaultApiError) {
      if (e.code === 'MFA_LOCKED_OUT' && e.lockedOutUntil) {
        setLockedUntil(e.lockedOutUntil);
        setError(null);
      } else if (e.code === 'MFA_NO_PENDING_ENROLLMENT') {
        setEnrollment(null);
        setError('Setup timed out. Start again to get a fresh QR code.');
      } else {
        setError(e.message);
      }
    } else {
      setError('Something went wrong. Try again.');
    }
  };

  const startEnrollment = async () => {
    setBusy(true);
    setError(null);
    try {
      setEnrollment(await vaultApi.startEnrollment());
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'enroll') {
        const res = await vaultApi.confirmEnrollment(code);
        setEnrollment(null); // drop the secret from memory as soon as it's confirmed
        setCodes(res.recoveryCodes);
        setMode('codes');
      } else if (mode === 'recovery') {
        const res = await vaultApi.unlockWithRecoveryCode(recovery);
        const left = res.recoveryCodesRemaining ?? 0;
        toast.warning(`Recovery code used. ${left} left.${left <= 3 ? ' Ask another admin to reset your MFA soon.' : ''}`);
        onUnlocked();
      } else {
        await vaultApi.unlock(code);
        onUnlocked();
      }
    } catch (err) {
      handleError(err);
      setCode('');
      setRecovery('');
    } finally {
      setBusy(false);
    }
  };

  const copyCodes = async () => {
    await navigator.clipboard.writeText(codes.join('\n'));
    toast.success('Recovery codes copied');
  };

  const downloadCodes = () => {
    const blob = new Blob(
      [`Nexus Aura Vault recovery codes\nEach code works once. Store them somewhere safe and offline.\n\n${codes.join('\n')}\n`],
      { type: 'text/plain' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vault-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (status.sessionUpgradeRequired) {
    return (
      <GateCard icon={LogOut} title="Sign in again to use the vault">
        <p className="text-sm text-[var(--ink-muted)]">
          The vault ties its unlock to your login session, and your current session was started before the vault existed.
          Sign out and sign back in once.
        </p>
        <AccentButton onClick={onSignOut} className="w-full mt-2">
          <LogOut className="h-4 w-4" /> Sign out
        </AccentButton>
      </GateCard>
    );
  }

  const startMicrosoft = async () => {
    setBusy(true);
    setMsError(null);
    try {
      const { url } = await vaultApi.startMicrosoftUnlock();
      // Full-page redirect: Microsoft sends the browser back to /vault.
      window.location.assign(url);
    } catch (e) {
      setMsError(e instanceof Error ? e.message : 'Could not start the Microsoft sign-in');
      setBusy(false);
    }
  };

  if (microsoftFirst && !useApp && mode !== 'codes') {
    return (
      <GateCard icon={ShieldCheck} title="Unlock the vault">
        <p className="text-sm text-[var(--ink-muted)]">
          Confirm it's you by signing in to Microsoft again and approving the request in Microsoft Authenticator. The
          vault then stays unlocked for this session for up to 24 hours.
        </p>
        {msError && <ErrorLine>{msError}</ErrorLine>}
        <AccentButton onClick={() => void startMicrosoft()} loading={busy} className="w-full mt-2">
          <MicrosoftMark /> Unlock with Microsoft
        </AccentButton>
        {status.methods.totp && (
          <button
            type="button"
            className="w-full text-center text-sm text-[var(--ink-muted)] underline hover:text-[var(--ink)]"
            onClick={() => setUseApp(true)}
          >
            Use my authenticator app instead
          </button>
        )}
      </GateCard>
    );
  }

  if (mode === 'codes') {
    return (
      <GateCard icon={LifeBuoy} title="Save your recovery codes">
        <p className="text-sm text-[var(--ink-muted)]">
          If you lose your phone, each code unlocks the vault once. They won't be shown again.
        </p>
        <ol className="grid grid-cols-2 gap-2 rounded-xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--ink)_4%,transparent)] p-4 font-mono text-sm text-[var(--ink)]">
          {codes.map((c) => (
            <li key={c} className="tabular-nums">{c}</li>
          ))}
        </ol>
        <div className="flex gap-2">
          <AccentButton variant="ghost" onClick={copyCodes} className="flex-1"><Copy /> Copy</AccentButton>
          <AccentButton variant="ghost" onClick={downloadCodes} className="flex-1"><Download /> Download</AccentButton>
        </div>
        <label className="flex items-center gap-2 text-sm text-[var(--ink)] cursor-pointer select-none">
          <input type="checkbox" checked={savedCodes} onChange={(e) => setSavedCodes(e.target.checked)} />
          I've stored these codes somewhere safe
        </label>
        <AccentButton
          className="w-full"
          disabled={!savedCodes}
          onClick={() => {
            setCodes([]);
            onUnlocked();
          }}
        >
          <Check /> Open the vault
        </AccentButton>
      </GateCard>
    );
  }

  if (mode === 'enroll' && !enrollment) {
    return (
      <GateCard icon={Smartphone} title="Set up two-factor authentication">
        <p className="text-sm text-[var(--ink-muted)]">
          The vault needs a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator,
          1Password, Authy…) at least once every 24 hours.
        </p>
        {error && <ErrorLine>{error}</ErrorLine>}
        <AccentButton onClick={startEnrollment} loading={busy} className="w-full">
          <ShieldCheck /> Start setup
        </AccentButton>
      </GateCard>
    );
  }

  const locked = !!lockedUntil;
  return (
    <GateCard
      icon={mode === 'enroll' ? Smartphone : KeyRound}
      title={mode === 'enroll' ? 'Scan with your authenticator app' : 'Unlock the vault'}
    >
      {mode === 'enroll' && enrollment && (
        <div className="flex flex-col items-center gap-3">
          <img
            src={enrollment.qrCodePng}
            alt="QR code for your authenticator app"
            width={200}
            height={200}
            className="rounded-xl bg-white p-2 border border-[var(--border)]"
          />
          <button
            type="button"
            className="text-xs text-[var(--ink-muted)] underline underline-offset-2 hover:text-[var(--ink)]"
            onClick={() => setShowSecret((s) => !s)}
          >
            {showSecret ? 'Hide setup key' : "Can't scan? Enter a setup key instead"}
          </button>
          {showSecret && (
            <code className="break-all rounded-lg bg-[color-mix(in_srgb,var(--ink)_5%,transparent)] px-3 py-2 font-mono text-xs text-[var(--ink)] select-all">
              {enrollment.secret}
            </code>
          )}
        </div>
      )}

      <p className="text-sm text-[var(--ink-muted)]">
        {mode === 'recovery'
          ? 'Enter one of the recovery codes you saved when you set up MFA.'
          : mode === 'enroll'
            ? 'Then enter the 6-digit code it shows to finish setup.'
            : 'Enter the 6-digit code from your authenticator app. The vault stays unlocked for 24 hours or until you sign out.'}
      </p>

      <form onSubmit={submitCode} className="flex flex-col gap-3">
        {mode === 'recovery' ? (
          <Input
            autoFocus
            value={recovery}
            onChange={(e) => setRecovery(e.target.value)}
            placeholder="xxxxx-xxxxx"
            autoComplete="off"
            spellCheck={false}
            disabled={locked || busy}
            className="h-12 text-center font-mono text-lg tracking-widest"
            aria-label="Recovery code"
          />
        ) : (
          <Input
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            inputMode="numeric"
            autoComplete="one-time-code"
            disabled={locked || busy}
            className="h-12 text-center font-mono text-2xl tracking-[0.5em]"
            aria-label="6-digit code"
          />
        )}
        {locked && <ErrorLine>Too many wrong codes. Try again after {formatUntil(lockedUntil!)}.</ErrorLine>}
        {error && !locked && <ErrorLine>{error}</ErrorLine>}
        <AccentButton
          type="submit"
          loading={busy}
          disabled={locked || (mode === 'recovery' ? recovery.trim().length < 10 : code.length !== 6)}
          className="w-full"
        >
          {mode === 'enroll' ? 'Verify and finish setup' : 'Unlock'}
        </AccentButton>
      </form>

      {mode !== 'enroll' && (
        <button
          type="button"
          className="text-sm text-[var(--ink-muted)] hover:text-[var(--ink)] underline underline-offset-2"
          onClick={() => {
            setError(null);
            setMode(mode === 'recovery' ? 'unlock' : 'recovery');
          }}
        >
          {mode === 'recovery' ? 'Use my authenticator app instead' : 'Lost your phone? Use a recovery code'}
        </button>
      )}
    </GateCard>
  );
}

function GateCard({ icon: Icon, title, children }: { icon: React.ComponentType<{ className?: string }>; title: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-center py-10">
      <div className="bento-card w-full max-w-md p-8 flex flex-col gap-4">
        <div className="h-12 w-12 rounded-full bg-[var(--accent-pink)] flex items-center justify-center">
          <Icon className="h-6 w-6 text-[var(--on-accent)]" />
        </div>
        <h2 className="font-display text-2xl font-bold text-[var(--ink)]">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function ErrorLine({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="text-sm text-[var(--accent-destructive)]">
      {children}
    </p>
  );
}

// Microsoft's four-square mark, drawn inline (no external asset).
function MicrosoftMark() {
  return (
    <svg viewBox="0 0 21 21" className="h-4 w-4" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}
