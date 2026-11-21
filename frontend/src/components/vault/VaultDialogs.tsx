import { useEffect, useState } from 'react';
import { Eye, EyeOff, Wand2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { AccentButton } from '../ui/accent-button';
import { vaultApi, VaultApiError } from '../../lib/vaultApi';
import type { VaultApp, VaultCredential, VaultCredentialInput, VaultProject } from '../../types/vault';

// ─── Project dialog ──────────────────────────────────────────────────────────

export function ProjectDialog({
  open,
  onOpenChange,
  project,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  project: VaultProject | null;
  onSaved: (p: VaultProject) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(project?.name ?? '');
      setDescription(project?.description ?? '');
      setError(null);
    }
  }, [open, project]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const saved = project
        ? await vaultApi.updateProject(project.id, { name, description })
        : await vaultApi.createProject({ name, description });
      onSaved(saved);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save client');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{project ? 'Edit client' : 'New client'}</DialogTitle>
            <DialogDescription>A client or project. Inside it you add its apps, and each app holds its accounts.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="vault-project-name">Name</Label>
            <Input id="vault-project-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="vault-project-desc">Description</Label>
            <Textarea id="vault-project-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
          </div>
          {error && <p role="alert" className="text-sm text-[var(--accent-destructive)]">{error}</p>}
          <DialogFooter>
            <AccentButton type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</AccentButton>
            <AccentButton type="submit" loading={busy} disabled={!name.trim()}>{project ? 'Save' : 'Create client'}</AccentButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── App dialog ──────────────────────────────────────────────────────────────

export function AppDialog({
  open,
  onOpenChange,
  projectId,
  app,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: string;
  app: VaultApp | null;
  onSaved: (a: VaultApp) => void;
}) {
  const [name, setName] = useState('');
  const [loginUrl, setLoginUrl] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(app?.name ?? '');
      setLoginUrl(app?.loginUrl ?? '');
      setDescription(app?.description ?? '');
      setError(null);
    }
  }, [open, app]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { name, loginUrl, description };
      const saved = app ? await vaultApi.updateApp(app.id, body) : await vaultApi.createApp(projectId, body);
      onSaved(saved);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save app');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4" autoComplete="off">
          <DialogHeader>
            <DialogTitle>{app ? `Edit ${app.name}` : 'Add app'}</DialogTitle>
            <DialogDescription>A service this client uses, such as AWS Console or the production database. You add its accounts next.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="va-name">App / service</Label>
            <Input id="va-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="AWS Console" maxLength={200} autoFocus required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="va-url">Login URL</Label>
            <Input id="va-url" type="url" value={loginUrl} onChange={(e) => setLoginUrl(e.target.value)} placeholder="https://" maxLength={2048} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="va-desc">Description</Label>
            <Textarea id="va-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
          </div>
          {error && <p role="alert" className="text-sm text-[var(--accent-destructive)]">{error}</p>}
          <DialogFooter>
            <AccentButton type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</AccentButton>
            <AccentButton type="submit" loading={busy} disabled={!name.trim()}>{app ? 'Save' : 'Add app'}</AccentButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Account dialog ──────────────────────────────────────────────────────────

// Generates a strong password locally with the Web Crypto CSPRNG. Rejection
// sampling avoids modulo bias.
function generatePassword(length = 24): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*()-_=+[]{}';
  const out: string[] = [];
  const buf = new Uint8Array(64);
  const limit = 256 - (256 % alphabet.length);
  while (out.length < length) {
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b < limit && out.length < length) out.push(alphabet[b % alphabet.length]);
    }
  }
  return out.join('');
}

export function CredentialDialog({
  open,
  onOpenChange,
  app,
  credential,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  app: VaultApp;
  credential: VaultCredential | null;
  onSaved: (c: VaultCredential) => void;
}) {
  const [label, setLabel] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [notes, setNotes] = useState('');
  const [notesLoaded, setNotesLoaded] = useState(false);
  const [clearNotes, setClearNotes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = !!credential;

  useEffect(() => {
    if (!open) {
      // Drop anything secret typed into the form when it closes.
      setPassword('');
      setNotes('');
      return;
    }
    setLabel(credential?.label ?? '');
    setUsername(credential?.username ?? '');
    setPassword('');
    setNotes('');
    setNotesLoaded(false);
    setClearNotes(false);
    setShowPassword(false);
    setError(null);
  }, [open, credential]);

  // Editing existing notes means decrypting them, which is an audited reveal,
  // so it only happens when the admin asks for it.
  const loadNotes = async () => {
    if (!credential) return;
    try {
      const res = await vaultApi.reveal(credential.id, 'notes', 'view');
      setNotes(res.value);
      setNotesLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load notes');
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body: VaultCredentialInput = { label, username };
    if (password) body.password = password;
    if (!editing) {
      if (notes) body.notes = notes;
    } else if (clearNotes) {
      body.notes = '';
    } else if (notesLoaded || (!credential?.hasNotes && notes)) {
      body.notes = notes;
    }
    try {
      const saved = editing
        ? await vaultApi.updateCredential(credential!.id, body)
        : await vaultApi.createCredential(app.id, body);
      onSaved(saved);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof VaultApiError || err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  const notesEditable = !editing || !credential?.hasNotes || notesLoaded;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <form onSubmit={submit} className="flex flex-col gap-4" autoComplete="off">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${credential!.label || credential!.username || 'account'}` : `Add account · ${app.name}`}</DialogTitle>
            <DialogDescription>Passwords and notes are encrypted before they're stored.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="vc-label">Account name</Label>
              <Input id="vc-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Root, Read-only, Deploy bot…" maxLength={120} autoFocus />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="vc-user">Username</Label>
              <Input id="vc-user" value={username} onChange={(e) => setUsername(e.target.value)} maxLength={512} autoComplete="off" spellCheck={false} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="vc-pass">{editing ? 'New password' : 'Password'}</Label>
              <div className="relative">
                <Input
                  id="vc-pass"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={editing ? 'Leave blank to keep' : ''}
                  autoComplete="new-password"
                  spellCheck={false}
                  required={!editing}
                  className="pr-20 font-mono"
                />
                <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex gap-0.5">
                  <IconButton label="Generate a strong password" onClick={() => { setPassword(generatePassword()); setShowPassword(true); }}>
                    <Wand2 className="h-4 w-4" />
                  </IconButton>
                  <IconButton label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((s) => !s)}>
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </IconButton>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:col-span-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="vc-notes">Notes</Label>
                {editing && credential!.hasNotes && !notesLoaded && !clearNotes && (
                  <div className="flex gap-3 text-xs">
                    <button type="button" className="underline text-[var(--ink-muted)] hover:text-[var(--ink)]" onClick={loadNotes}>Edit notes</button>
                    <button type="button" className="underline text-[var(--ink-muted)] hover:text-[var(--accent-destructive)]" onClick={() => setClearNotes(true)}>Remove notes</button>
                  </div>
                )}
              </div>
              {notesEditable && !clearNotes ? (
                <Textarea id="vc-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Recovery email, MFA device, who owns this account…" maxLength={20000} />
              ) : (
                <p className="text-sm text-[var(--ink-muted)] rounded-xl border border-dashed border-[var(--border)] px-3.5 py-2">
                  {clearNotes ? 'Notes will be removed when you save.' : 'Encrypted notes kept as they are.'}
                </p>
              )}
            </div>
          </div>
          {error && <p role="alert" className="text-sm text-[var(--accent-destructive)]">{error}</p>}
          <DialogFooter>
            <AccentButton type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</AccentButton>
            <AccentButton type="submit" loading={busy} disabled={(!editing && !password) || (!label.trim() && !username.trim())}>
              {editing ? 'Save changes' : 'Add account'}
            </AccentButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function IconButton({
  label,
  onClick,
  children,
  disabled,
  tone = 'default',
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  tone?: 'default' | 'danger';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`h-8 w-8 inline-flex items-center justify-center rounded-lg text-[var(--ink-muted)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-pink)] disabled:opacity-40 ${
        tone === 'danger'
          ? 'hover:text-[var(--accent-destructive)] hover:bg-[var(--accent-destructive-soft)]'
          : 'hover:text-[var(--ink)] hover:bg-[color-mix(in_srgb,var(--ink)_7%,transparent)]'
      }`}
    >
      {children}
    </button>
  );
}
