import { useCallback, useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { AccentButton } from '../ui/accent-button';
import { PillTag } from '../ui/pill-tag';
import { GlassSkeleton } from '../ui/glass-skeleton';
import { listPortalUsers, vaultApi } from '../../lib/vaultApi';
import type { VaultApp, VaultGrant, VaultProject } from '../../types/vault';

// Admin-only: who can see this client, and what they can do.
//
// A grant covers either the whole client or one app in it, at View (see,
// reveal, copy) or Edit (also change accounts; on a whole client also add and
// remove apps), optionally until an end date. Giving the same person access
// at the same scope again changes that grant instead of adding a second one.
// The server enforces all of it on every request; revoking takes effect on
// the person's very next click.

const WHOLE_CLIENT = '__client__'; // Radix Select can't use "" as a value

type Person = { id: string; username: string; fullName: string };

export function AccessDialog({
  open,
  onOpenChange,
  project,
  apps,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  project: VaultProject;
  apps: VaultApp[];
}) {
  const [grants, setGrants] = useState<VaultGrant[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState('');
  const [scope, setScope] = useState(WHOLE_CLIENT);
  const [level, setLevel] = useState<'view' | 'edit'>('view');
  const [until, setUntil] = useState(''); // yyyy-mm-dd, '' = no end date
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [gs, users] = await Promise.all([vaultApi.listGrants(project.id), listPortalUsers()]);
      setGrants(gs);
      // Admins already see everything, so they aren't offered.
      setPeople(users.filter((u) => u.role !== 'admin' && u.isActive).sort((a, b) => a.username.localeCompare(b.username)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load access');
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setConfirmRevoke(null);
    void load();
  }, [open, load]);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;
    setBusy(true);
    setError(null);
    try {
      await vaultApi.setGrant(project.id, {
        userId,
        appId: scope === WHOLE_CLIENT ? '' : scope,
        level,
        // Access lasts through the chosen day, in the admin's time zone.
        expiresAt: until ? new Date(`${until}T23:59:59`).toISOString() : null,
      });
      const who = people.find((p) => p.id === userId)?.username ?? 'They';
      toast.success(`${who} now has ${level} access`);
      setUserId('');
      setUntil('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not share');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (g: VaultGrant) => {
    try {
      await vaultApi.revokeGrant(g.id);
      toast.success(`Removed ${g.username}'s access`);
      setConfirmRevoke(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not remove access');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle>Access · {project.name}</DialogTitle>
          <DialogDescription>
            Admins can always see everything. Share this client, or a single app in it, with anyone else here. They still
            confirm MFA before any password is shown, and every reveal is logged.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <GlassSkeleton className="h-28 rounded-xl" />
        ) : grants.length === 0 ? (
          <p className="text-sm text-[var(--ink-muted)] rounded-xl border border-dashed border-[var(--border)] px-4 py-3">
            Only admins can see this client right now.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] max-h-[38vh] overflow-auto">
            {grants.map((g) => (
              <li key={g.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm ${g.expired ? 'opacity-60' : ''}`}>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-[var(--ink)] truncate">{g.fullName || g.username}</div>
                  <div className="text-xs text-[var(--ink-muted)] truncate">
                    {g.appId ? g.appName : 'Whole client'} ·{' '}
                    {g.expiresAt ? `${g.expired ? 'ended' : 'until'} ${new Date(g.expiresAt).toLocaleDateString()}` : 'no end date'}
                    {g.grantedBy && ` · by ${g.grantedBy}`}
                  </div>
                </div>
                {g.expired ? (
                  <PillTag tone="slate" size="sm">Expired</PillTag>
                ) : (
                  <PillTag tone={g.level === 'edit' ? 'amber' : 'blue'} size="sm">{g.level === 'edit' ? 'Edit' : 'View'}</PillTag>
                )}
                {confirmRevoke === g.id ? (
                  <span className="flex items-center gap-1">
                    <AccentButton size="sm" variant="ghost" onClick={() => setConfirmRevoke(null)}>Keep</AccentButton>
                    <AccentButton size="sm" onClick={() => void revoke(g)}>Remove</AccentButton>
                  </span>
                ) : (
                  <button
                    type="button"
                    aria-label={`Remove ${g.username}'s access`}
                    title="Remove access"
                    onClick={() => setConfirmRevoke(g.id)}
                    className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-[var(--ink-muted)] hover:text-[var(--accent-destructive)] hover:bg-[var(--accent-destructive-soft)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-pink)]"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={submit} className="flex flex-col gap-3 rounded-xl border border-[var(--border)] p-4">
          <div className="text-sm font-medium text-[var(--ink)]">Share</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Person</Label>
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger aria-label="Person"><SelectValue placeholder={people.length ? 'Choose someone' : 'No one else to add'} /></SelectTrigger>
                <SelectContent>
                  {people.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.fullName ? `${p.fullName} (${p.username})` : p.username}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>What</Label>
              <Select value={scope} onValueChange={setScope}>
                <SelectTrigger aria-label="What to share"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={WHOLE_CLIENT}>Whole client (all apps)</SelectItem>
                  {apps.map((a) => (
                    <SelectItem key={a.id} value={a.id}>Only {a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Can</Label>
              <Select value={level} onValueChange={(v) => setLevel(v as 'view' | 'edit')}>
                <SelectTrigger aria-label="Access level"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="view">View: see, reveal and copy</SelectItem>
                  <SelectItem value="edit">Edit: also add and change accounts</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="grant-until">Until (optional)</Label>
              <Input id="grant-until" type="date" min={today} value={until} onChange={(e) => setUntil(e.target.value)} />
            </div>
          </div>
          {error && <p role="alert" className="text-sm text-[var(--accent-destructive)]">{error}</p>}
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-[var(--ink-muted)]">Sharing again with the same person and scope updates their access.</p>
            <AccentButton type="submit" loading={busy} disabled={!userId}>Share</AccentButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
