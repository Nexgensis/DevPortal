import { useEffect, useState } from 'react';
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';

interface AuthCallbackProps {
  onAuthSuccess: (token: string) => Promise<boolean>;
}

export function AuthCallback({ onAuthSuccess }: AuthCallbackProps) {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Completing authentication...');

  useEffect(() => {
    const handleCallback = async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const token = params.get('token');

        if (!token) {
          throw new Error('No authentication token received');
        }

        const success = await onAuthSuccess(token);

        if (success) {
          setStatus('success');
          setMessage('Successfully authenticated!');
          setTimeout(() => {
            window.location.href = '/';
          }, 1500);
        } else {
          throw new Error('Failed to validate authentication token');
        }
      } catch (err) {
        setStatus('error');
        setMessage(err instanceof Error ? err.message : 'Authentication failed');
        setTimeout(() => {
          window.location.href = '/';
        }, 3000);
      }
    };

    handleCallback();
  }, [onAuthSuccess]);

  const iconBg =
    status === 'success'
      ? 'bg-[var(--accent-pink)]'
      : status === 'error'
        ? 'bg-[var(--accent-destructive)]'
        : 'bg-[var(--accent-peach)]';

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md bento-card p-8 lg:p-10">
        <div className="flex justify-center mb-6">
          <div className={`h-20 w-20 rounded-2xl flex items-center justify-center ${iconBg}`}>
            {status === 'loading' && <Loader2 className="h-10 w-10 text-[var(--ink)] animate-spin" />}
            {status === 'success' && <CheckCircle2 className="h-10 w-10 text-[var(--ink)]" />}
            {status === 'error' && <AlertCircle className="h-10 w-10 text-white" />}
          </div>
        </div>

        {status === 'loading' && (
          <div className="text-center">
            <p className="text-lg font-medium mb-2 text-[var(--ink)]">Authenticating…</p>
            <p className="text-sm text-[var(--ink-muted)]">{message}</p>
          </div>
        )}

        {status === 'success' && (
          <div className="flex items-start gap-2 rounded-xl px-3.5 py-3 text-sm bg-[var(--accent-pink-soft)] border border-[color-mix(in_srgb,var(--accent-pink)_30%,transparent)] text-[var(--ink)]">
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{message}</span>
          </div>
        )}

        {status === 'error' && (
          <div className="flex items-start gap-2 rounded-xl px-3.5 py-3 text-sm bg-[var(--accent-destructive-soft)] border border-[color-mix(in_srgb,var(--accent-destructive)_25%,transparent)] text-[var(--accent-destructive)]">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{message}</span>
          </div>
        )}
      </div>
    </div>
  );
}
