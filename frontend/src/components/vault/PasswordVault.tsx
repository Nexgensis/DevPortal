import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppWindow, ChevronRight, Copy, Eye, EyeOff, ExternalLink, FileText, FolderLock, History, KeyRound, Lock, Pencil, Plus, Search,
  ShieldCheck, Trash2, Users as UsersIcon, RotateCcw, UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '../ui/input';
import { AccentButton } from '../ui/accent-button';
import { PillTag, type PillTone } from '../ui/pill-tag';
import { GlassSkeleton } from '../ui/glass-skeleton';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '../ui/alert-dialog';
import { vaultApi, VaultApiError, onVaultLocked } from '../../lib/vaultApi';
import { clearCopiedSecretNow, copyPlain, copySecret, CLIPBOARD_CLEAR_MS } from '../../lib/clipboard';
import type { VaultAdmin, VaultApp, VaultAuditEvent, VaultCredential, VaultProject, VaultStatus } from '../../types/vault';
import { VaultMfaGate } from './VaultMfaGate';
import { AppDialog, CredentialDialog, IconButton, ProjectDialog } from './VaultDialogs';
import { AccessDialog } from './VaultAccessDialog';

// How long a revealed password stays on screen before it re-masks itself.
const REVEAL_MS = 20_000;
const MASK = '••••••••••••';

type Tab = 'logins' | 'activity' | 'people';

const canEdit = (access: string) => access === 'admin' || access === 'edit';

// Result codes Microsoft step-up sends back in the URL (/vault?unlock_error=…).
const UNLOCK_ERRORS: Record<string, string> = {
  wrong_account: 'You signed in to Microsoft as a different person than your portal account. Sign in with your own work account.',
  no_mfa: "Microsoft didn't confirm MFA for that sign-in. Ask your admin to check the vault's MFA settings.",
  no_approval: "Microsoft didn't ask for a fresh Authenticator approval for that sign-in, so the vault stayed locked. Ask your admin to check the vault's Conditional Access policy.",
  not_fresh: 'Microsoft reused an earlier sign-in. Try again and enter your password when Microsoft asks.',
  expired: 'That unlock attempt expired or was already used. Try again.',
  cancelled: 'The Microsoft sign-in was cancelled.',
  invalid: "Microsoft's answer couldn't be verified. Try again.",
  unavailable: "Unlock with Microsoft isn't set up on this server.",
  server: 'Something went wrong on the server. Try again.',
};

function readUnlockResult(): { ok: boolean; error: string | null } | null {
  const q = new URLSearchParams(window.location.search);
  if (q.get('unlock') === 'ok') return { ok: true, error: null };
  const code = q.get('unlock_error');
  return code ? { ok: false, error: UNLOCK_ERRORS[code] ?? UNLOCK_ERRORS.server } : null;
}

interface Props {
  currentUsername: string;
  onSignOut: () => void;
}

function timeLeft(iso: string | null): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
}

export function PasswordVault({ currentUsername, onSignOut }: Props) {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('logins');
  const [, forceTick] = useState(0);
  // Coming back from "Unlock with Microsoft"? Read the result once, then
  // drop it from the address bar.
  const [unlockResult] = useState(readUnlockResult);
  useEffect(() => {
    if (!unlockResult) return;
    window.history.replaceState(window.history.state, '', window.location.pathname);
    if (unlockResult.ok) toast.success('Vault unlocked');
  }, [unlockResult]);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await vaultApi.status());
      setStatusError(null);
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : 'Could not reach the vault');
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  // Any API call answering VAULT_LOCKED (expiry, locked in another tab,
  // signed out elsewhere) drops us back to the gate.
  useEffect(() => onVaultLocked(() => void refreshStatus()), [refreshStatus]);

  // Re-lock the UI exactly when the server-side unlock expires, and tick the
  // "time left" label once a minute.
  useEffect(() => {
    if (!status?.unlocked || !status.unlockExpiresAt) return;
    const ms = new Date(status.unlockExpiresAt).getTime() - Date.now();
    const expire = window.setTimeout(() => void refreshStatus(), Math.max(ms, 0) + 1000);
    const tick = window.setInterval(() => forceTick((n) => n + 1), 60_000);
    return () => {
      window.clearTimeout(expire);
      window.clearInterval(tick);
    };
  }, [status, refreshStatus]);

  // Leaving the vault (tab switch, sign-out) wipes a pending copied secret.
  useEffect(() => () => void clearCopiedSecretNow(), []);

  const lockNow = async () => {
    try {
      await vaultApi.lock();
    } finally {
      await clearCopiedSecretNow();
      await refreshStatus();
      toast.success('Vault locked');
    }
  };

  if (statusError) {
    return (
      <div className="bento-card p-8 text-center">
        <FolderLock className="h-10 w-10 mx-auto mb-3 text-[var(--ink-muted)]" />
        <p className="text-[var(--ink)] font-medium">{statusError}</p>
        <AccentButton variant="ghost" className="mt-4" onClick={() => void refreshStatus()}>Try again</AccentButton>
      </div>
    );
  }
  if (!status) {
    return <GlassSkeleton className="h-64 w-full rounded-2xl" />;
  }
  if (!status.unlocked) {
    return (
      <VaultMfaGate
        key={String(status.enrolled)}
        status={status}
        onUnlocked={() => void refreshStatus()}
        onSignOut={onSignOut}
        initialError={unlockResult?.error ?? null}
      />
    );
  }

  const isAdmin = status.role === 'admin';
  const tabs = ([
    ['logins', 'Logins', KeyRound],
    ['activity', 'Activity', History],
    ['people', 'People & MFA', UsersIcon],
  ] as const).filter(([id]) => isAdmin || id === 'logins');

  return (
    <div className="flex flex-col gap-6">
      {/* Session bar: unlock state + sub-navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)]">
        <nav className="-mb-px flex gap-1">
          {tabs.map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors focus:outline-none ${
                tab === id
                  ? 'border-[var(--accent-pink)] text-[var(--ink)]'
                  : 'border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)]'
              }`}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-2 pb-2">
          <PillTag tone="green" icon={ShieldCheck} size="sm">Unlocked · {timeLeft(status.unlockExpiresAt)}</PillTag>
          {status.enrolled && status.recoveryCodesRemaining <= 3 && (
            <PillTag tone="amber" size="sm">{status.recoveryCodesRemaining} recovery codes left</PillTag>
          )}
          <AccentButton variant="ghost" size="sm" onClick={lockNow}>
            <Lock /> Lock now
          </AccentButton>
        </div>
      </div>

      {tab === 'logins' && <LoginsView isAdmin={isAdmin} />}
      {tab === 'activity' && isAdmin && <ActivityView />}
      {tab === 'people' && isAdmin && <PeopleView currentUsername={currentUsername} />}
    </div>
  );
}

// ─── Logins: clients (left) → apps → accounts (right) ─────────────────────────

function LoginsView({ isAdmin }: { isAdmin: boolean }) {
  const [projects, setProjects] = useState<VaultProject[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [projectDialog, setProjectDialog] = useState<{ open: boolean; project: VaultProject | null }>({ open: false, project: null });
  const [deleteProject, setDeleteProject] = useState<VaultProject | null>(null);

  const loadProjects = useCallback(async (q: string) => {
    try {
      const list = await vaultApi.listProjects(q);
      setProjects(list);
      setSelectedId((cur) => (cur && list.some((p) => p.id === cur) ? cur : list[0]?.id ?? null));
    } catch (e) {
      if (!(e instanceof VaultApiError && e.code === 'VAULT_LOCKED')) toast.error(e instanceof Error ? e.message : 'Failed to load clients');
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  // Server-side search also matches app names, account names and usernames
  // inside clients ("aws" finds the client holding the AWS Console). Debounced.
  useEffect(() => {
    const t = window.setTimeout(() => void loadProjects(search.trim()), search ? 250 : 0);
    return () => window.clearTimeout(t);
  }, [search, loadProjects]);

  const selected = projects.find((p) => p.id === selectedId) ?? null;

  const confirmDeleteProject = async () => {
    if (!deleteProject) return;
    try {
      await vaultApi.deleteProject(deleteProject.id);
      toast.success(`Deleted ${deleteProject.name}`);
      void loadProjects(search.trim());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete client');
    } finally {
      setDeleteProject(null);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6 min-h-[420px]">
      {/* Project list */}
      <aside className="flex flex-col gap-3">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--ink-muted)] pointer-events-none" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search clients, apps, users" className="pl-10" aria-label="Search clients" />
        </div>
        {isAdmin && (
          <AccentButton onClick={() => setProjectDialog({ open: true, project: null })}>
            <Plus /> New Client
          </AccentButton>
        )}
        <div className="flex flex-col gap-1 mt-1">
          {loadingProjects ? (
            [0, 1, 2].map((i) => <GlassSkeleton key={i} className="h-14 rounded-xl" />)
          ) : projects.length === 0 ? (
            <p className="text-sm text-[var(--ink-muted)] px-1 py-4">
              {search ? 'No matches.' : isAdmin ? 'No clients yet.' : 'Nothing has been shared with you yet.'}
            </p>
          ) : (
            projects.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                className={`text-left rounded-xl px-3.5 py-2.5 border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-pink)] ${
                  p.id === selectedId
                    ? 'bg-[color-mix(in_srgb,var(--accent-pink)_10%,transparent)] border-[color-mix(in_srgb,var(--accent-pink)_40%,transparent)]'
                    : 'border-transparent hover:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-[var(--ink)] truncate">{p.name}</span>
                  <span className="text-xs tabular-nums text-[var(--ink-muted)]" title={`${p.appCount} apps, ${p.credentialCount} accounts`}>{p.appCount} {p.appCount === 1 ? 'app' : 'apps'}</span>
                </div>
                {p.description && <div className="text-xs text-[var(--ink-muted)] truncate">{p.description}</div>}
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Apps and their accounts */}
      <section className="min-w-0">
        {selected ? (
          <AppsPanel
            key={selected.id}
            project={selected}
            isAdmin={isAdmin}
            onEditProject={() => setProjectDialog({ open: true, project: selected })}
            onDeleteProject={() => setDeleteProject(selected)}
            onCountChange={() => void loadProjects(search.trim())}
          />
        ) : (
          !loadingProjects && (
            <div className="bento-card p-10 text-center">
              <FolderLock className="h-10 w-10 mx-auto mb-3 text-[var(--accent-pink)]" strokeWidth={1.5} />
              <p className="text-[var(--ink)] font-medium">
                {isAdmin ? 'Create a client to start storing logins.' : 'Nothing has been shared with you yet. Ask an admin for access.'}
              </p>
            </div>
          )
        )}
      </section>

      <ProjectDialog
        open={projectDialog.open}
        onOpenChange={(open) => setProjectDialog((s) => ({ ...s, open }))}
        project={projectDialog.project}
        onSaved={(p) => {
          toast.success(projectDialog.project ? 'Client updated' : 'Client created');
          setSelectedId(p.id);
          void loadProjects(search.trim());
        }}
      />
      <AlertDialog open={!!deleteProject} onOpenChange={(o) => !o && setDeleteProject(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteProject?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteProject?.appCount
                ? 'This client still has apps. Delete them first.'
                : 'The client will be removed. Its history stays in the activity log.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {!deleteProject?.appCount && <AlertDialogAction onClick={confirmDeleteProject}>Delete</AlertDialogAction>}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AppsPanel({
  project,
  isAdmin,
  onEditProject,
  onDeleteProject,
  onCountChange,
}: {
  project: VaultProject;
  isAdmin: boolean;
  onEditProject: () => void;
  onDeleteProject: () => void;
  onCountChange: () => void;
}) {
  const [apps, setApps] = useState<VaultApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [appDialog, setAppDialog] = useState<{ open: boolean; app: VaultApp | null }>({ open: false, app: null });
  const [deletingApp, setDeletingApp] = useState<VaultApp | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; app: VaultApp | null; cred: VaultCredential | null }>({ open: false, app: null, cred: null });
  const [deleting, setDeleting] = useState<{ app: VaultApp; cred: VaultCredential } | null>(null);
  const [notesFor, setNotesFor] = useState<{ title: string; value: string } | null>(null);
  const [historyFor, setHistoryFor] = useState<{ title: string; credentialId?: string; appId?: string } | null>(null);
  const [accessOpen, setAccessOpen] = useState(false);
  // What the caller may do here. The server enforces all of it; this only
  // hides buttons that would fail.
  const clientEdit = canEdit(project.access);

  // Revealed passwords: id → plaintext, each with its own re-mask timer.
  // Component state only; never persisted.
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const timers = useRef<Record<string, number>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const hide = useCallback((id: string) => {
    window.clearTimeout(timers.current[id]);
    delete timers.current[id];
    setRevealed((r) => {
      const { [id]: _drop, ...rest } = r;
      return rest;
    });
  }, []);

  useEffect(() => {
    const t = timers.current;
    return () => Object.values(t).forEach((id) => window.clearTimeout(id));
  }, []);

  // Locked elsewhere → wipe anything on screen immediately.
  useEffect(() => onVaultLocked(() => {
    setRevealed({});
    setNotesFor(null);
  }), []);

  const load = useCallback(async () => {
    try {
      setApps(await vaultApi.listApps(project.id));
    } catch (e) {
      if (!(e instanceof VaultApiError && e.code === 'VAULT_LOCKED')) toast.error(e instanceof Error ? e.message : 'Failed to load apps');
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const changed = () => {
    void load();
    onCountChange();
  };

  const accountTitle = (app: VaultApp, c: VaultCredential) => `${app.name} · ${c.label || c.username || 'account'}`;

  const reveal = async (c: VaultCredential) => {
    if (revealed[c.id] !== undefined) return hide(c.id);
    setBusyId(c.id);
    try {
      const { value } = await vaultApi.reveal(c.id, 'password', 'view');
      setRevealed((r) => ({ ...r, [c.id]: value }));
      timers.current[c.id] = window.setTimeout(() => hide(c.id), REVEAL_MS);
    } catch (e) {
      if (!(e instanceof VaultApiError && e.code === 'VAULT_LOCKED')) toast.error(e instanceof Error ? e.message : 'Reveal failed');
    } finally {
      setBusyId(null);
    }
  };

  const copyPassword = async (c: VaultCredential) => {
    setBusyId(c.id);
    try {
      const { value } = await vaultApi.reveal(c.id, 'password', 'copy');
      await copySecret(value, () => toast('Clipboard cleared', { duration: 2000 }));
      toast.success(`Password copied. Clipboard clears in ${CLIPBOARD_CLEAR_MS / 1000}s.`);
    } catch (e) {
      if (!(e instanceof VaultApiError && e.code === 'VAULT_LOCKED')) toast.error(e instanceof Error ? e.message : 'Copy failed');
    } finally {
      setBusyId(null);
    }
  };

  const openNotes = async (app: VaultApp, c: VaultCredential) => {
    try {
      const { value } = await vaultApi.reveal(c.id, 'notes', 'view');
      setNotesFor({ title: accountTitle(app, c), value });
    } catch (e) {
      if (!(e instanceof VaultApiError && e.code === 'VAULT_LOCKED')) toast.error(e instanceof Error ? e.message : 'Could not open notes');
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await vaultApi.deleteCredential(deleting.cred.id);
      hide(deleting.cred.id);
      toast.success(`Deleted ${accountTitle(deleting.app, deleting.cred)}`);
      changed();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeleting(null);
    }
  };

  const confirmDeleteApp = async () => {
    if (!deletingApp) return;
    try {
      await vaultApi.deleteApp(deletingApp.id);
      toast.success(`Deleted ${deletingApp.name}`);
      changed();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeletingApp(null);
    }
  };

  // Filter keeps an app when its own name/URL matches (all accounts shown) or
  // any of its accounts match (only those shown).
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return apps;
    return apps.flatMap((a) => {
      if ([a.name, a.loginUrl].some((v) => v.toLowerCase().includes(q))) return [a];
      const accounts = a.accounts.filter((c) => [c.label, c.username].some((v) => v.toLowerCase().includes(q)));
      return accounts.length ? [{ ...a, accounts }] : [];
    });
  }, [apps, filter]);

  const accountCount = apps.reduce((n, a) => n + a.accounts.length, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-2xl font-bold text-[var(--ink)] truncate">{project.name}</h2>
          <p className="text-sm text-[var(--ink-muted)]">
            {project.description ? `${project.description} · ` : ''}
            {apps.length} {apps.length === 1 ? 'app' : 'apps'} · {accountCount} {accountCount === 1 ? 'account' : 'accounts'}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {isAdmin && (
            <>
              <AccentButton variant="ghost" size="sm" onClick={() => setAccessOpen(true)}><UserPlus /> Access</AccentButton>
              <IconButton label="Edit client" onClick={onEditProject}><Pencil className="h-4 w-4" /></IconButton>
              <IconButton label="Delete client" onClick={onDeleteProject} tone="danger"><Trash2 className="h-4 w-4" /></IconButton>
            </>
          )}
          {!isAdmin && (
            <PillTag tone={project.access === 'edit' ? 'amber' : 'blue'} size="sm">
              {project.access === 'edit' ? 'You can edit' : project.access === 'view' ? 'View only' : 'Shared apps only'}
            </PillTag>
          )}
          {clientEdit && (
            <AccentButton className="ml-2" onClick={() => setAppDialog({ open: true, app: null })}><Plus /> Add app</AccentButton>
          )}
        </div>
      </div>

      {accountCount > 5 && (
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter apps and accounts" className="max-w-sm" aria-label="Filter apps and accounts" />
      )}

      {loading ? (
        <GlassSkeleton className="h-40 rounded-2xl" />
      ) : apps.length === 0 ? (
        <div className="bento-card p-10 text-center">
          <AppWindow className="h-10 w-10 mx-auto mb-3 text-[var(--accent-pink)]" strokeWidth={1.5} />
          <p className="text-[var(--ink)] font-medium mb-1">No apps for this client yet.</p>
          {clientEdit && (
            <>
              <p className="text-sm text-[var(--ink-muted)] mb-4">Add an app such as AWS Console, then add its accounts.</p>
              <AccentButton onClick={() => setAppDialog({ open: true, app: null })}><Plus /> Add the first app</AccentButton>
            </>
          )}
        </div>
      ) : visible.length === 0 ? (
        <p className="text-sm text-[var(--ink-muted)] py-4">No apps or accounts match “{filter}”.</p>
      ) : (
        visible.map((app) => {
          const isOpen = !collapsed[app.id] || !!filter.trim();
          const appEdit = canEdit(app.access);
          return (
            <section key={app.id} className="bento-card overflow-hidden" aria-label={app.name}>
              <header className="flex flex-wrap items-center gap-2 px-4 py-3">
                <button
                  type="button"
                  onClick={() => setCollapsed((c) => ({ ...c, [app.id]: isOpen }))}
                  aria-expanded={isOpen}
                  className="flex items-center gap-2 min-w-0 flex-1 text-left rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-pink)]"
                >
                  <ChevronRight className={`h-4 w-4 shrink-0 text-[var(--ink-muted)] transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                  <span className="font-semibold text-[var(--ink)] truncate">{app.name}</span>
                  <span className="text-xs tabular-nums text-[var(--ink-muted)] shrink-0">
                    {app.accounts.length} {app.accounts.length === 1 ? 'account' : 'accounts'}
                  </span>
                </button>
                {app.loginUrl && (
                  // loginUrl is validated server-side as http(s) only.
                  <a href={app.loginUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-[var(--ink-muted)] hover:text-[var(--accent-pink)] max-w-[260px] truncate">
                    <ExternalLink className="h-3 w-3 shrink-0" /> <span className="truncate">{app.loginUrl.replace(/^https?:\/\//, '')}</span>
                  </a>
                )}
                <div className="flex items-center gap-0.5">
                  {!isAdmin && !appEdit && <PillTag tone="blue" size="sm">View only</PillTag>}
                  {isAdmin && (
                    <IconButton label={`History of ${app.name}`} onClick={() => setHistoryFor({ title: app.name, appId: app.id })}><History className="h-4 w-4" /></IconButton>
                  )}
                  {appEdit && (
                    <IconButton label={`Edit ${app.name}`} onClick={() => setAppDialog({ open: true, app })}><Pencil className="h-4 w-4" /></IconButton>
                  )}
                  {clientEdit && (
                    <IconButton label={`Delete ${app.name}`} onClick={() => setDeletingApp(app)} tone="danger"><Trash2 className="h-4 w-4" /></IconButton>
                  )}
                  {appEdit && (
                    <AccentButton variant="ghost" size="sm" className="ml-1" onClick={() => setDialog({ open: true, app, cred: null })}>
                      <Plus /> Add account
                    </AccentButton>
                  )}
                </div>
              </header>
              {isOpen && (
                app.accounts.length === 0 ? (
                  <p className="border-t border-[var(--border)] px-4 py-4 text-sm text-[var(--ink-muted)]">No accounts yet.</p>
                ) : (
                  <div className="border-t border-[var(--border)] overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wide text-[var(--ink-muted)] border-b border-[var(--border)]">
                          <th className="px-4 py-2.5 font-medium">Account</th>
                          <th className="px-4 py-2.5 font-medium">Username</th>
                          <th className="px-4 py-2.5 font-medium">Password</th>
                          <th className="px-4 py-2.5 font-medium sr-only">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {app.accounts.map((c) => {
                          const shown = revealed[c.id];
                          return (
                            <tr key={c.id} className="border-b last:border-b-0 border-[var(--border)] align-middle">
                              <td className="px-4 py-3 min-w-[140px] font-medium text-[var(--ink)]">
                                {c.label || <span className="text-[var(--ink-muted)] font-normal">—</span>}
                              </td>
                              <td className="px-4 py-3">
                                {c.username ? (
                                  <div className="flex items-center gap-1">
                                    <span className="font-mono text-[var(--ink)] truncate max-w-[220px]">{c.username}</span>
                                    <IconButton label="Copy username" onClick={() => copyPlain(c.username).then(() => toast.success('Username copied'))}>
                                      <Copy className="h-3.5 w-3.5" />
                                    </IconButton>
                                  </div>
                                ) : (
                                  <span className="text-[var(--ink-muted)]">—</span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-1">
                                  <span className={`font-mono ${shown !== undefined ? 'text-[var(--ink)] select-all break-all' : 'text-[var(--ink-muted)] tracking-wider'}`}>
                                    {shown !== undefined ? shown : MASK}
                                  </span>
                                  <IconButton label={shown !== undefined ? 'Hide password' : 'Reveal password'} onClick={() => void reveal(c)} disabled={busyId === c.id}>
                                    {shown !== undefined ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                  </IconButton>
                                  <IconButton label="Copy password" onClick={() => void copyPassword(c)} disabled={busyId === c.id}>
                                    <Copy className="h-4 w-4" />
                                  </IconButton>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center justify-end gap-0.5">
                                  {c.hasNotes && (
                                    <IconButton label="View notes" onClick={() => void openNotes(app, c)}><FileText className="h-4 w-4" /></IconButton>
                                  )}
                                  {isAdmin && (
                                    <IconButton label="History" onClick={() => setHistoryFor({ title: accountTitle(app, c), credentialId: c.id })}><History className="h-4 w-4" /></IconButton>
                                  )}
                                  {appEdit && (
                                    <>
                                      <IconButton label="Edit" onClick={() => setDialog({ open: true, app, cred: c })}><Pencil className="h-4 w-4" /></IconButton>
                                      <IconButton label="Delete" onClick={() => setDeleting({ app, cred: c })} tone="danger"><Trash2 className="h-4 w-4" /></IconButton>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )
              )}
            </section>
          );
        })
      )}

      <p className="text-xs text-[var(--ink-muted)]">
        Every reveal and copy is recorded. Copied passwords are wiped from the clipboard after {CLIPBOARD_CLEAR_MS / 1000}s
        while this tab is focused; clipboard-history tools on your computer may keep their own copy.
      </p>

      {isAdmin && (
        <AccessDialog open={accessOpen} onOpenChange={setAccessOpen} project={project} apps={apps} />
      )}

      <AppDialog
        open={appDialog.open}
        onOpenChange={(open) => setAppDialog((s) => ({ ...s, open }))}
        projectId={project.id}
        app={appDialog.app}
        onSaved={(saved) => {
          toast.success(appDialog.app ? 'App updated' : 'App added');
          setCollapsed((c) => ({ ...c, [saved.id]: false }));
          changed();
        }}
      />

      {dialog.app && (
        <CredentialDialog
          open={dialog.open}
          onOpenChange={(open) => setDialog((s) => ({ ...s, open }))}
          app={dialog.app}
          credential={dialog.cred}
          onSaved={(saved) => {
            hide(saved.id);
            toast.success(dialog.cred ? 'Account updated' : 'Account added');
            changed();
          }}
        />
      )}

      <AlertDialog open={!!deletingApp} onOpenChange={(o) => !o && setDeletingApp(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deletingApp?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingApp?.accounts.length
                ? 'This app still has accounts. Delete them first.'
                : 'The app will be removed. Its history stays in the activity log.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {!deletingApp?.accounts.length && <AlertDialogAction onClick={confirmDeleteApp}>Delete</AlertDialogAction>}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting && accountTitle(deleting.app, deleting.cred)}?</AlertDialogTitle>
            <AlertDialogDescription>The stored password and notes are destroyed permanently. This can't be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!notesFor} onOpenChange={(o) => !o && setNotesFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Notes · {notesFor?.title}</DialogTitle>
            <DialogDescription>Decrypted for this view only. Closing the dialog clears it.</DialogDescription>
          </DialogHeader>
          <pre className="whitespace-pre-wrap break-words rounded-xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--ink)_4%,transparent)] p-4 font-sans text-sm text-[var(--ink)] max-h-[50vh] overflow-auto">
            {notesFor?.value}
          </pre>
        </DialogContent>
      </Dialog>

      <Dialog open={!!historyFor} onOpenChange={(o) => !o && setHistoryFor(null)}>
        <DialogContent className="sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>History · {historyFor?.title}</DialogTitle>
            <DialogDescription>Who viewed, copied or changed {historyFor?.appId ? 'this app and its accounts' : 'this account'}.</DialogDescription>
          </DialogHeader>
          {historyFor && <AuditList credentialId={historyFor.credentialId} appId={historyFor.appId} compact />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Activity ────────────────────────────────────────────────────────────────

const ACTION_TONE: Record<string, PillTone> = {
  VIEW_PASSWORD: 'blue', COPY_PASSWORD: 'blue', VIEW_NOTES: 'blue',
  CREATE_CREDENTIAL: 'cyan', CREATE_APP: 'cyan', CREATE_PROJECT: 'cyan',
  GRANT_ACCESS: 'purple', UPDATE_ACCESS: 'purple', REVOKE_ACCESS: 'red',
  UPDATE_CREDENTIAL: 'amber', UPDATE_APP: 'amber', UPDATE_PROJECT: 'amber',
  DELETE_CREDENTIAL: 'red', DELETE_APP: 'red', DELETE_PROJECT: 'red',
  MFA_VERIFIED: 'green', MFA_ENROLLED: 'green', MFA_ENROLL_STARTED: 'slate',
  MFA_FAILED: 'orange', MFA_LOCKED_OUT: 'red', RECOVERY_CODE_USED: 'orange', MFA_RESET: 'purple',
  VAULT_LOCKED: 'slate', KEYS_ROTATED: 'purple',
};

const prettyAction = (a: string) => a.toLowerCase().replace(/_/g, ' ');

function describe(ev: VaultAuditEvent): string {
  const d = ev.details || {};
  const parts: string[] = [];
  if (typeof d.appName === 'string') parts.push(d.appName);
  if (typeof d.label === 'string' && d.label) parts.push(d.label);
  if (typeof d.name === 'string') parts.push(d.name);
  if (typeof d.targetUsername === 'string') parts.push(`for ${d.targetUsername}`);
  if (Array.isArray(d.changed) && d.changed.length) parts.push(`changed ${d.changed.join(', ')}`);
  if (typeof d.scope === 'string') parts.push(d.scope);
  if (typeof d.level === 'string') parts.push(`${d.level} access`);
  if (typeof d.expiresAt === 'string') parts.push(`until ${new Date(d.expiresAt).toLocaleDateString()}`);
  if (typeof d.method === 'string') parts.push(`via ${String(d.method).replace('_', ' ')}`);
  if (typeof d.reason === 'string') parts.push(String(d.reason));
  return parts.join(' · ');
}

function AuditList({ credentialId, appId, compact }: { credentialId?: string; appId?: string; compact?: boolean }) {
  const [events, setEvents] = useState<VaultAuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const limit = compact ? 20 : 50;

  useEffect(() => {
    setLoading(true);
    vaultApi
      .audit({ credentialId, appId, limit, offset })
      .then((r) => {
        setEvents(r.events);
        setTotal(r.total);
      })
      .catch((e) => {
        if (!(e instanceof VaultApiError && e.code === 'VAULT_LOCKED')) toast.error(e instanceof Error ? e.message : 'Failed to load activity');
      })
      .finally(() => setLoading(false));
  }, [credentialId, appId, limit, offset]);

  if (loading) return <GlassSkeleton className="h-40 rounded-2xl" />;
  if (events.length === 0) return <p className="text-sm text-[var(--ink-muted)]">No activity yet.</p>;

  return (
    <div className="flex flex-col gap-3">
      <ul className={`divide-y divide-[var(--border)] ${compact ? 'max-h-[50vh] overflow-auto' : 'bento-card'}`}>
        {events.map((ev) => (
          <li key={ev.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
            <PillTag tone={ACTION_TONE[ev.action] ?? 'slate'} size="sm">{prettyAction(ev.action)}</PillTag>
            <span className="font-medium text-[var(--ink)]">{ev.actorUsername}</span>
            <span className="text-[var(--ink-muted)] truncate flex-1 min-w-[120px]">{describe(ev)}</span>
            <span className="text-xs text-[var(--ink-muted)] tabular-nums" title={ev.userAgent}>
              {new Date(ev.occurredAt).toLocaleString()} · {ev.ip || '—'}
            </span>
          </li>
        ))}
      </ul>
      {total > limit && (
        <div className="flex items-center justify-between text-sm text-[var(--ink-muted)]">
          <span>{offset + 1}–{Math.min(offset + limit, total)} of {total}</span>
          <div className="flex gap-2">
            <AccentButton variant="ghost" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>Newer</AccentButton>
            <AccentButton variant="ghost" size="sm" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>Older</AccentButton>
          </div>
        </div>
      )}
    </div>
  );
}

function ActivityView() {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-[var(--ink-muted)]">
        Append-only record of every unlock, reveal, copy and change. Entries can't be edited or deleted, even by admins.
      </p>
      <AuditList />
    </div>
  );
}

// ─── Admin MFA ───────────────────────────────────────────────────────────────

function PeopleView({ currentUsername }: { currentUsername: string }) {
  const [admins, setAdmins] = useState<VaultAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState<VaultAdmin | null>(null);

  const load = useCallback(() => {
    vaultApi
      .members()
      .then(setAdmins)
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Failed to load people'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const confirmReset = async () => {
    if (!resetting) return;
    try {
      await vaultApi.resetMemberMfa(resetting.userId);
      toast.success(`${resetting.username} will set up MFA again on their next visit`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Reset failed');
    } finally {
      setResetting(null);
    }
  };

  const tone: Record<VaultAdmin['mfaStatus'], PillTone> = { active: 'green', pending: 'amber', none: 'slate' };
  const label: Record<VaultAdmin['mfaStatus'], string> = { active: 'App MFA on', pending: 'Setup started', none: 'No app MFA' };

  if (loading) return <GlassSkeleton className="h-40 rounded-2xl" />;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-[var(--ink-muted)]">
        Everyone who can open the vault: admins, plus anyone a client or app was shared with. People who sign in with
        Microsoft unlock with Microsoft and need nothing here. For local logins using the authenticator app, if someone
        loses their phone and recovery codes, reset their app MFA here so they can set it up again. You can't reset your own.
      </p>
      <ul className="bento-card divide-y divide-[var(--border)]">
        {admins.map((a) => (
          <li key={a.userId} className="flex items-center gap-3 px-4 py-3">
            <div className="flex-1 min-w-0">
              <div className="font-medium text-[var(--ink)]">{a.fullName || a.username}</div>
              <div className="text-xs text-[var(--ink-muted)]">{a.username} · {a.role === 'admin' ? 'admin' : 'shared access'}{!a.isActive && ' · deactivated'}</div>
            </div>
            <PillTag tone={tone[a.mfaStatus]} size="sm">{label[a.mfaStatus]}</PillTag>
            {a.username !== currentUsername && a.mfaStatus !== 'none' && (
              <AccentButton variant="ghost" size="sm" onClick={() => setResetting(a)}><RotateCcw /> Reset MFA</AccentButton>
            )}
          </li>
        ))}
      </ul>
      <AlertDialog open={!!resetting} onOpenChange={(o) => !o && setResetting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset MFA for {resetting?.username}?</AlertDialogTitle>
            <AlertDialogDescription>
              Their authenticator and recovery codes stop working and any open vault session of theirs is locked. This is recorded in the activity log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmReset}>Reset MFA</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
