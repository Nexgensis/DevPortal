import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useScanReports } from '../hooks/useScanReports';
import {
  ScanReport,
  ParsedReportResponse,
  ParsedReport,
  SeverityCounts,
  TrivyParsed,
  ZapParsed,
  SonarParsed,
} from '../types/scan';
import {
  ShieldCheck, Plus, RefreshCw, Trash2, FileJson, AlertCircle, Pencil,
  Box, Code2, Globe2, ChevronDown,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { GlassCard } from './ui/glass-card';
import { AccentButton } from './ui/accent-button';
import { StatusBadge } from './ui/status-badge';
import { GlassSkeleton } from './ui/glass-skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { PillTag } from './ui/pill-tag';

// Sub-navigation for the dashboard's three scanner panels. Clean underline-tab style
// matching the rest of the editorial UI (Config sub-nav, etc.) instead of the lime
// pill TabsTrigger which clashed in this denser context.
type ScanSection = 'container' | 'code' | 'runtime';
const SCAN_SECTIONS: { id: ScanSection; label: string; icon: LucideIcon }[] = [
  { id: 'container', label: 'Container & Dependencies', icon: Box },
  { id: 'code',      label: 'Code Quality',             icon: Code2 },
  { id: 'runtime',   label: 'Live Runtime API',         icon: Globe2 },
];

interface Props {
  // When true, show source-management controls (Add / Refresh / Delete) in a
  // flat table — the admin Config tab uses this mode. When false, render the
  // viewer dashboard (env dropdown + severity matrix + tabbed scan results) —
  // the standalone Security Scan tab uses this mode.
  manage?: boolean;
}

const flatInput =
  'w-full h-9 px-3 text-sm text-[var(--ink)] bg-[var(--card)] border border-[var(--border)] rounded-[var(--radius)] placeholder:text-[var(--ink-muted)] focus:outline-none focus:border-[var(--ink)]/30 transition-colors';

const fmtTime = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

const prettyJson = (raw?: string) => {
  if (!raw) return '';
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
};

// envKeyOf is the dropdown key — same repo can have a main + uat scan source,
// each tracked independently, so we group by (repo, branch).
const envKeyOf = (r: { repoName: string; branch: string }) => `${r.repoName}/${r.branch}`;

// detectScanner mirrors the backend's heuristic when the admin didn't label
// the source — used only to bucket sources into tabs in the dashboard.
const detectScanner = (s: string): 'trivy' | 'zap' | 'sonar' | '' => {
  const v = s.toLowerCase();
  if (v.includes('trivy')) return 'trivy';
  if (v.includes('zap') || v.includes('owasp')) return 'zap';
  if (v.includes('sonar')) return 'sonar';
  return '';
};

export const SecurityScanReport = ({ manage = false }: Props) => {
  const { loading, list, get, getParsed, addSource, updateSource, refresh, deleteSource } = useScanReports();
  const [reports, setReports] = useState<ScanReport[]>([]);

  const load = useCallback(async () => setReports(await list()), [list]);
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Admin source-management dialogs (manage=true only). The same dialog drives
  // both create and edit — `editingId` !== null means we're updating that row
  // instead of creating a new one.
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [repoName, setRepoName] = useState('');
  const [branch, setBranch] = useState('main');
  const [scanner, setScanner] = useState('');
  const [nexusRepo, setNexusRepo] = useState('');
  const [reportPath, setReportPath] = useState('');
  const [viewing, setViewing] = useState<ScanReport | null>(null);

  const resetForm = () => {
    setEditingId(null);
    setRepoName(''); setBranch('main'); setScanner(''); setNexusRepo(''); setReportPath('');
  };

  const openAdd = () => {
    resetForm();
    setFormOpen(true);
  };

  const openEdit = (r: ScanReport) => {
    setEditingId(r.id);
    setRepoName(r.repoName);
    setBranch(r.branch);
    setScanner(r.scanner || '');
    setNexusRepo(r.nexusRepo);
    setReportPath(r.reportPath);
    setFormOpen(true);
  };

  const handleSubmit = async () => {
    if (!repoName.trim() || !branch.trim() || !nexusRepo.trim() || !reportPath.trim()) return;
    const payload = {
      repoName: repoName.trim(),
      branch: branch.trim(),
      scanner: scanner.trim() || undefined,
      nexusRepo: nexusRepo.trim(),
      reportPath: reportPath.trim(),
    };
    const ok = editingId
      ? await updateSource(editingId, payload)
      : await addSource(payload);
    if (ok) {
      setFormOpen(false);
      resetForm();
      load();
    }
  };
  const handleRefresh = async (id: string) => { if (await refresh(id)) load(); };
  const handleDelete = async (id: string) => { if (await deleteSource(id)) load(); };
  const handleView   = async (r: ScanReport) => { setViewing(await get(r.id) || r); };

  // ───── Viewer (manage=false): env dropdown + severity row + tabbed dashboard.
  if (!manage) {
    return <ReportDashboard reports={reports} loading={loading} getParsed={getParsed} />;
  }

  // ───── Admin source-management table (manage=true): the existing flat layout.
  return (
    <div className="space-y-6">
      <GlassCard className="p-0 overflow-hidden">
        <div className="p-6 border-b border-[var(--border)] flex items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-[var(--accent-pink-soft)] flex items-center justify-center">
            <ShieldCheck className="h-6 w-6 text-[var(--ink)]" />
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-semibold text-[var(--ink)]">Scan Sources</h2>
            <p className="text-[var(--ink-muted)] text-sm">Register CI/CD security-scan report sources from Nexus &amp; refresh on demand</p>
          </div>
          <AccentButton variant="lime" onClick={openAdd}>
            <Plus className="h-4 w-4" />
            Add Source
          </AccentButton>
        </div>

        {reports.length === 0 ? (
          <div className="text-center py-16 px-4">
            <FileJson className="h-14 w-14 text-[var(--ink-muted)] mx-auto mb-4" strokeWidth={1.5} />
            <p className="text-[var(--ink-muted)]">No scan sources yet. Add one to start monitoring Nexus reports.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--ink-muted)] border-b border-[var(--border)]">
                  <th className="px-6 py-3 font-medium">Repository</th>
                  <th className="px-6 py-3 font-medium">Branch</th>
                  <th className="px-6 py-3 font-medium">Scanner</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">Last updated</th>
                  <th className="px-6 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id} className="border-b border-[var(--border)] last:border-0">
                    <td className="px-6 py-3 font-medium text-[var(--ink)]">{r.repoName}</td>
                    <td className="px-6 py-3 text-[var(--ink)]">{r.branch}</td>
                    <td className="px-6 py-3 text-[var(--ink-muted)]">{r.scanner || '—'}</td>
                    <td className="px-6 py-3">
                      <StatusBadge
                        status={r.status === 'ok' ? 'online' : r.status === 'error' ? 'offline' : 'idle'}
                        label={r.status === 'ok' ? 'OK' : r.status === 'error' ? 'Error' : 'Pending'}
                      />
                      {r.status === 'error' && r.errorMsg && (
                        <span className="ml-2 inline-flex items-center gap-1 text-xs text-[var(--accent-destructive)]" title={r.errorMsg}>
                          <AlertCircle className="h-3 w-3" /> {r.errorMsg.slice(0, 40)}{r.errorMsg.length > 40 ? '…' : ''}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-3 text-[var(--ink-muted)]">{fmtTime(r.fetchedAt)}</td>
                    <td className="px-6 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <AccentButton variant="ghost" onClick={() => handleView(r)} disabled={r.status !== 'ok'}>
                          <FileJson className="h-4 w-4" /> View
                        </AccentButton>
                        <button
                          type="button"
                          onClick={() => openEdit(r)}
                          disabled={loading}
                          aria-label="Edit source"
                          title="Edit source"
                          className="h-9 w-9 rounded-[var(--radius)] border border-[var(--border)] flex items-center justify-center text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-black/[0.03] transition-colors focus:outline-none"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRefresh(r.id)}
                          disabled={loading}
                          aria-label="Refresh"
                          title="Refresh now"
                          className="h-9 w-9 rounded-[var(--radius)] border border-[var(--border)] flex items-center justify-center text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-black/[0.03] transition-colors focus:outline-none"
                        >
                          <RefreshCw className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(r.id)}
                          disabled={loading}
                          aria-label="Remove source"
                          title="Delete source"
                          className="h-9 w-9 rounded-[var(--radius)] border border-[var(--border)] flex items-center justify-center text-[var(--ink-muted)] hover:text-[var(--accent-destructive)] hover:bg-black/[0.03] transition-colors focus:outline-none"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {/* Add / Edit Source dialog (same form, swapped title + submit label) */}
      <Dialog open={formOpen} onOpenChange={(o) => { setFormOpen(o); if (!o) resetForm(); }}>
        <DialogContent className="bento-card sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Scan Source' : 'Add Scan Source'}</DialogTitle>
            <DialogDescription>
              {editingId
                ? 'Change any field. Editing the path or repo resets the row to "pending" and triggers an immediate refresh.'
                : 'Register a repo/branch and the Nexus path to its scan report. The backend monitors it and keeps the latest report.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="sc-repo" className="block text-xs font-medium text-[var(--ink-muted)] mb-1">Repository</label>
                <input id="sc-repo" className={flatInput} value={repoName} onChange={(e) => setRepoName(e.target.value)} placeholder="e.g. bmr_backend" spellCheck={false} autoCapitalize="off" />
              </div>
              <div>
                <label htmlFor="sc-branch" className="block text-xs font-medium text-[var(--ink-muted)] mb-1">Branch</label>
                <input id="sc-branch" className={flatInput} value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main / uat" spellCheck={false} autoCapitalize="off" />
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="sc-scanner" className="block text-xs font-medium text-[var(--ink-muted)] mb-1">Scanner (optional)</label>
                <input id="sc-scanner" className={flatInput} value={scanner} onChange={(e) => setScanner(e.target.value)} placeholder="trivy / zap / sonar" spellCheck={false} autoCapitalize="off" />
              </div>
              <div>
                <label htmlFor="sc-nexusrepo" className="block text-xs font-medium text-[var(--ink-muted)] mb-1">Nexus Repository</label>
                <input id="sc-nexusrepo" className={flatInput} value={nexusRepo} onChange={(e) => setNexusRepo(e.target.value)} placeholder="e.g. security-reports" spellCheck={false} autoCapitalize="off" />
              </div>
            </div>
            <div>
              <label htmlFor="sc-path" className="block text-xs font-medium text-[var(--ink-muted)] mb-1">Report Path (exact file or folder prefix)</label>
              <input id="sc-path" className={flatInput} value={reportPath} onChange={(e) => setReportPath(e.target.value)} placeholder="Nexgensis/bmr_backend/uat/trivy/trivy-image/" spellCheck={false} autoCapitalize="off" />
            </div>
          </div>
          <DialogFooter>
            <AccentButton variant="lime" onClick={handleSubmit} disabled={loading || !repoName.trim() || !branch.trim() || !nexusRepo.trim() || !reportPath.trim()}>
              {editingId ? 'Save Changes' : 'Add Source'}
            </AccentButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Raw JSON viewer dialog (admin debugging tool) */}
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="bento-card sm:max-w-[820px]">
          <DialogHeader>
            <DialogTitle>{viewing ? `${viewing.repoName} · ${viewing.branch}${viewing.scanner ? ' · ' + viewing.scanner : ''}` : 'Report'}</DialogTitle>
            <DialogDescription>
              {viewing?.assetPath ? `Nexus: ${viewing.assetPath}` : 'Scan report JSON'}
            </DialogDescription>
          </DialogHeader>
          <pre className="max-h-[60vh] overflow-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-4 text-xs leading-relaxed text-[var(--ink)] whitespace-pre">
            {prettyJson(viewing?.reportJson)}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ─── Viewer dashboard ───────────────────────────────────────────────────────

interface DashboardProps {
  reports: ScanReport[];
  loading: boolean;
  getParsed: (id: string) => Promise<ParsedReportResponse | null>;
}

interface BucketedParsed {
  trivy?: ParsedReportResponse;
  zap?: ParsedReportResponse;
  sonar?: ParsedReportResponse;
}

// Aggregate severities across all scanners under one env so the matrix at the
// top reflects the full compliance picture, not just one report family.
const sumSeverity = (b: BucketedParsed): SeverityCounts => {
  const empty: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0, unknown: 0 };
  const add = (a: SeverityCounts, s?: SeverityCounts) => {
    if (!s) return;
    a.critical += s.critical; a.high += s.high; a.medium += s.medium;
    a.low += s.low; a.info += s.info; a.unknown += s.unknown;
  };
  add(empty, b.trivy?.parsed?.severity);
  add(empty, b.zap?.parsed?.severity);
  add(empty, b.sonar?.parsed?.severity);
  return empty;
};

const ReportDashboard = ({ reports, loading, getParsed }: DashboardProps) => {
  // Bucket sources by (repo, branch). Each env may have 1-3 scanner sources.
  const envs = useMemo(() => {
    const byEnv: Record<string, ScanReport[]> = {};
    for (const r of reports) {
      const k = envKeyOf(r);
      (byEnv[k] ??= []).push(r);
    }
    return Object.entries(byEnv)
      .map(([key, rs]) => ({ key, repoName: rs[0].repoName, branch: rs[0].branch, sources: rs }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [reports]);

  const [selectedKey, setSelectedKey] = useState<string>('');
  const [parsed, setParsed] = useState<BucketedParsed>({});
  const [parsedLoading, setParsedLoading] = useState(false);
  const [scanSection, setScanSection] = useState<ScanSection>('container');

  // Auto-pick the first env when reports load or the selection becomes stale.
  useEffect(() => {
    if (envs.length === 0) {
      setSelectedKey('');
      return;
    }
    if (!selectedKey || !envs.find((e) => e.key === selectedKey)) {
      setSelectedKey(envs[0].key);
    }
  }, [envs, selectedKey]);

  // Track the current env in a ref so a stale loadParsed() in flight can detect
  // the user changed envs mid-fetch and discard its results.
  const selectedKeyRef = useRef(selectedKey);
  useEffect(() => { selectedKeyRef.current = selectedKey; }, [selectedKey]);

  // Clear parsed data when env changes — we never auto-fetch. The user must
  // click Refresh to load the report. This prevents the network spam that
  // happened when getParsed (non-memoized) was a useEffect dependency.
  useEffect(() => {
    setParsed({});
    setParsedLoading(false);
  }, [selectedKey]);

  // Imperative loader — fires only when the Refresh button is clicked.
  const loadParsed = useCallback(async () => {
    const key = selectedKeyRef.current;
    if (!key) return;
    const env = envs.find((e) => e.key === key);
    if (!env) return;
    setParsedLoading(true);
    try {
      const results = await Promise.all(
        env.sources.map(async (s) => {
          const r = await getParsed(s.id);
          // Bucket by detected scanner family (admin's label first, falls back
          // to backend's auto-detect on the response itself).
          let kind = detectScanner(s.scanner);
          if (!kind && r?.parsed?.scanner) kind = r.parsed.scanner as typeof kind;
          return { kind, r };
        }),
      );
      // Discard if the user switched envs while we were loading.
      if (key !== selectedKeyRef.current) return;
      const next: BucketedParsed = {};
      for (const { kind, r } of results) {
        if (!r) continue;
        if (kind === 'trivy' || kind === 'zap' || kind === 'sonar') {
          next[kind] = r;
        }
      }
      setParsed(next);
    } finally {
      if (selectedKeyRef.current === key) setParsedLoading(false);
    }
  }, [envs, getParsed]);

  const currentEnv = envs.find((e) => e.key === selectedKey);
  const severity = useMemo(() => sumSeverity(parsed), [parsed]);

  // ── Empty state (no sources configured at all) ──
  if (!loading && reports.length === 0) {
    return (
      <GlassCard className="p-0 overflow-hidden">
        <div className="p-6 border-b border-[var(--border)] flex items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-[var(--accent-pink-soft)] flex items-center justify-center">
            <ShieldCheck className="h-6 w-6 text-[var(--ink)]" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-[var(--ink)]">Security Scan Report</h2>
            <p className="text-[var(--ink-muted)] text-sm">Latest CI/CD security scan per repo &amp; branch</p>
          </div>
        </div>
        <div className="text-center py-16 px-4">
          <FileJson className="h-14 w-14 text-[var(--ink-muted)] mx-auto mb-4" strokeWidth={1.5} />
          <p className="text-[var(--ink-muted)]">No scan reports configured yet. An admin can add sources under Config → Scan Sources.</p>
        </div>
      </GlassCard>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header + env dropdown */}
      <GlassCard className="p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-2xl bg-[var(--accent-pink-soft)] flex items-center justify-center">
              <ShieldCheck className="h-6 w-6 text-[var(--ink)]" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-[var(--ink)]">Security Scan Report</h2>
              <p className="text-[var(--ink-muted)] text-sm">
                {currentEnv
                  ? `${currentEnv.repoName} · ${currentEnv.branch} · ${currentEnv.sources.length} source${currentEnv.sources.length === 1 ? '' : 's'}`
                  : 'Pick an environment to view its latest scan results'}
              </p>
            </div>
          </div>

          {/* Env dropdown + manual Refresh — data is never auto-fetched. */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <label htmlFor="scan-env" className="sr-only">Environment</label>
              <select
                id="scan-env"
                value={selectedKey}
                onChange={(e) => setSelectedKey(e.target.value)}
                disabled={envs.length === 0}
                className="appearance-none h-10 pl-3 pr-9 text-sm text-[var(--ink)] bg-[var(--card)] border border-[var(--border)] rounded-[var(--radius)] focus:outline-none focus:border-[var(--ink)]/30 transition-colors disabled:opacity-50 min-w-[14rem]"
              >
                {envs.map((e) => (
                  <option key={e.key} value={e.key}>{e.repoName} / {e.branch}</option>
                ))}
              </select>
              <ChevronDown className="h-4 w-4 absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--ink-muted)] pointer-events-none" />
            </div>
            <button
              type="button"
              onClick={loadParsed}
              disabled={!selectedKey || parsedLoading}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-[var(--radius)] bg-[var(--accent-pink)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none"
            >
              <RefreshCw className={`h-4 w-4 ${parsedLoading ? 'animate-spin' : ''}`} />
              {parsedLoading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </div>
      </GlassCard>

      {/* Loading state — clean static-CSS skeletons (no framer-motion). */}
      {parsedLoading ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <GlassSkeleton.Card count={4} />
          </div>
          <GlassSkeleton.Card />
        </div>
      ) : (
        <>
          <SeverityMatrix counts={severity} buckets={parsed} />

          <GlassCard className="p-6">
            {/* Sub-navigation — flat underline tabs on a hairline rule.
                Extends to the card edges via negative margins so the rule reads as a full divider. */}
            <div className="border-b border-[var(--border)] -mx-6 mb-6">
              <nav className="px-6 -mb-px flex gap-1 overflow-x-auto">
                {SCAN_SECTIONS.map(({ id, label, icon: Icon }) => {
                  const isActive = scanSection === id;
                  return (
                    <button
                      key={id}
                      onClick={() => setScanSection(id)}
                      className={`inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors focus:outline-none ${
                        isActive
                          ? 'border-[var(--accent-pink)] text-[var(--ink)]'
                          : 'border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)] hover:border-[var(--border)]'
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />
                      {label}
                    </button>
                  );
                })}
              </nav>
            </div>

            {scanSection === 'container' && <TrivyPanel resp={parsed.trivy} />}
            {scanSection === 'code'      && <SonarPanel resp={parsed.sonar} />}
            {scanSection === 'runtime'   && <ZapPanel resp={parsed.zap} />}
          </GlassCard>
        </>
      )}
    </div>
  );
};

// ─── Severity matrix ────────────────────────────────────────────────────────

interface SeverityTone {
  label: string;
  color: string;     // accent var for the number + border
  softBg: string;    // tinted background
}

const SEVERITY_TONES: Record<keyof SeverityCounts, SeverityTone> = {
  critical: { label: 'Critical', color: 'var(--accent-destructive)',     softBg: 'var(--accent-destructive-soft)' },
  high:     { label: 'High',     color: 'var(--accent-peach)',           softBg: 'var(--accent-peach-soft)' },
  medium:   { label: 'Medium',   color: 'var(--accent-pink)',            softBg: 'var(--accent-pink-soft)' },
  low:      { label: 'Low',      color: 'var(--accent-green)',           softBg: 'var(--accent-green-soft)' },
  info:     { label: 'Info',     color: 'var(--ink-muted)',              softBg: 'var(--card)' },
  unknown:  { label: 'Unknown',  color: 'var(--ink-muted)',              softBg: 'var(--card)' },
};

interface SeverityMatrixProps {
  counts: SeverityCounts;
  buckets: BucketedParsed;
}

const SeverityMatrix = ({ counts, buckets }: SeverityMatrixProps) => {
  // Show the four primary tiers; collapse Info/Unknown into a single sidecar pill.
  const primary: (keyof SeverityCounts)[] = ['critical', 'high', 'medium', 'low'];
  const haveAny = Object.values(buckets).some(Boolean);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {primary.map((k) => {
          const t = SEVERITY_TONES[k];
          return (
            <div
              key={k}
              className="relative overflow-hidden rounded-2xl border border-[var(--border)] p-5 flex flex-col transition-transform duration-300 hover:-translate-y-0.5"
              style={{ background: t.softBg }}
            >
              <span aria-hidden className="absolute left-0 top-0 bottom-0 w-1" style={{ background: t.color }} />
              <div className="text-4xl font-bold leading-none tabular-nums" style={{ color: t.color }}>
                {counts[k]}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: t.color }} />
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink)]/70">
                  {t.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Sources legend + Info/Unknown chips */}
      <div className="flex flex-wrap items-center gap-2">
        {haveAny && (
          <>
            {buckets.trivy && <PillTag tone="slate" size="sm" icon={Box}>Trivy</PillTag>}
            {buckets.sonar && <PillTag tone="slate" size="sm" icon={Code2}>SonarQube</PillTag>}
            {buckets.zap   && <PillTag tone="slate" size="sm" icon={Globe2}>OWASP ZAP</PillTag>}
          </>
        )}
        {counts.info > 0 && <PillTag tone="slate" size="sm">Info: {counts.info}</PillTag>}
        {counts.unknown > 0 && <PillTag tone="slate" size="sm">Unknown: {counts.unknown}</PillTag>}
      </div>
    </div>
  );
};

// ─── Tab panels ─────────────────────────────────────────────────────────────

const PanelEmpty = ({ label }: { label: string }) => (
  <div className="text-center py-10 px-4 rounded-[var(--radius)] border border-dashed border-[var(--border)]">
    <FileJson className="h-10 w-10 text-[var(--ink-muted)] mx-auto mb-3" strokeWidth={1.5} />
    <p className="text-sm text-[var(--ink-muted)]">{label}</p>
  </div>
);

const PanelError = ({ msg }: { msg: string }) => (
  <div className="flex items-start gap-3 p-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--accent-destructive-soft)]">
    <AlertCircle className="h-5 w-5 text-[var(--accent-destructive)] mt-0.5 shrink-0" />
    <div className="text-sm text-[var(--ink)]">{msg}</div>
  </div>
);

// Decide what to render for a panel: error, empty, or the slot.
const renderPanelContent = (
  resp: ParsedReportResponse | undefined,
  emptyMsg: string,
  body: (p: ParsedReport) => React.ReactNode,
) => {
  if (!resp) return <PanelEmpty label={emptyMsg} />;
  if (resp.sourceStatus !== 'ok') {
    return <PanelError msg={resp.errorMsg ? `Source unavailable: ${resp.errorMsg}` : 'Source unavailable (poller has not fetched it yet).'} />;
  }
  if (!resp.parsed) return <PanelEmpty label="No parsed data available." />;
  if (resp.parsed.status === 'unsupported') {
    return <PanelError msg={resp.parsed.errorMsg || 'Report format not recognized.'} />;
  }
  if (resp.parsed.status === 'empty') {
    return <PanelEmpty label="Report is empty — no findings recorded." />;
  }
  return body(resp.parsed);
};

const SEV_TONE_FOR_PILL: Record<TrivyParsed['vulnerabilities'][number]['severity'], 'red' | 'orange' | 'amber' | 'green' | 'slate'> = {
  CRITICAL: 'red',
  HIGH:     'orange',
  MEDIUM:   'amber',
  LOW:      'green',
  INFO:     'slate',
  UNKNOWN:  'slate',
};

const TrivyPanel = ({ resp }: { resp?: ParsedReportResponse }) => {
  return renderPanelContent(
    resp,
    'No container/dependency scan registered for this environment.',
    (p) => {
      const t = p.trivy!;
      return (
        <div className="space-y-6">
          {(t.artifactName || t.artifactType) && (
            <div className="flex items-center gap-3 flex-wrap">
              {t.artifactType && (
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  {t.artifactType}
                </span>
              )}
              {t.artifactName && (
                <code className="font-mono text-xs px-2.5 py-1 rounded-md bg-black/[0.04] border border-[var(--border)] text-[var(--ink)] break-all">
                  {t.artifactName}
                </code>
              )}
            </div>
          )}

          {/* Vulnerabilities table */}
          {t.vulnerabilities.length === 0 ? (
            <PanelEmpty label="No vulnerabilities reported. 🟢" />
          ) : (
            <div>
              <div className="flex items-baseline justify-between mb-3">
                <h4 className="text-sm font-semibold text-[var(--ink)]">
                  Vulnerabilities <span className="text-[var(--ink-muted)] font-normal tabular-nums">({t.vulnerabilities.length})</span>
                </h4>
              </div>
              <div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--card)]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left border-b border-[var(--border)] bg-black/[0.025]">
                      <th className="px-4 py-3 font-semibold text-[11px] uppercase tracking-[0.12em] text-[var(--ink-muted)]">Severity</th>
                      <th className="px-4 py-3 font-semibold text-[11px] uppercase tracking-[0.12em] text-[var(--ink-muted)]">CVE</th>
                      <th className="px-4 py-3 font-semibold text-[11px] uppercase tracking-[0.12em] text-[var(--ink-muted)]">Package</th>
                      <th className="px-4 py-3 font-semibold text-[11px] uppercase tracking-[0.12em] text-[var(--ink-muted)]">Installed</th>
                      <th className="px-4 py-3 font-semibold text-[11px] uppercase tracking-[0.12em] text-[var(--ink-muted)]">Fixed</th>
                      <th className="px-4 py-3 font-semibold text-[11px] uppercase tracking-[0.12em] text-[var(--ink-muted)]">Title</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.vulnerabilities.slice(0, 200).map((v, i) => (
                      <tr key={`${v.id}-${i}`} className="border-b border-[var(--border)] last:border-0 hover:bg-black/[0.025] transition-colors">
                        <td className="px-4 py-3"><PillTag tone={SEV_TONE_FOR_PILL[v.severity]} size="sm">{v.severity}</PillTag></td>
                        <td className="px-4 py-3 font-mono text-xs text-[var(--ink)] whitespace-nowrap">{v.id}</td>
                        <td className="px-4 py-3 text-[var(--ink)]">{v.package}</td>
                        <td className="px-4 py-3 font-mono text-xs text-[var(--ink-muted)] whitespace-nowrap">{v.version}</td>
                        <td className="px-4 py-3 font-mono text-xs text-[var(--accent-green)] whitespace-nowrap">{v.fixedVersion || '—'}</td>
                        <td className="px-4 py-3 text-[var(--ink-muted)] max-w-md truncate" title={v.title}>{v.title || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {t.vulnerabilities.length > 200 && (
                  <div className="px-4 py-2.5 text-xs text-[var(--ink-muted)] border-t border-[var(--border)] bg-black/[0.015]">
                    Showing 200 of {t.vulnerabilities.length}. Trim noisy findings via the scanner config.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SBOM component list */}
          {t.sbom.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-[var(--ink)] mb-2">
                SBOM components <span className="text-[var(--ink-muted)] font-normal">({t.sbom.length})</span>
              </h4>
              <div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left border-b border-[var(--border)] bg-black/[0.025] sticky top-0">
                      <th className="px-4 py-3 font-semibold text-[11px] uppercase tracking-[0.12em] text-[var(--ink-muted)]">Name</th>
                      <th className="px-4 py-3 font-semibold text-[11px] uppercase tracking-[0.12em] text-[var(--ink-muted)]">Version</th>
                      <th className="px-4 py-3 font-semibold text-[11px] uppercase tracking-[0.12em] text-[var(--ink-muted)]">Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.sbom.slice(0, 500).map((c, i) => (
                      <tr key={`${c.name}-${c.version}-${i}`} className="border-b border-[var(--border)] last:border-0 hover:bg-black/[0.025] transition-colors">
                        <td className="px-4 py-3 text-[var(--ink)]">{c.name}</td>
                        <td className="px-4 py-3 font-mono text-xs text-[var(--ink-muted)]">{c.version || '—'}</td>
                        <td className="px-4 py-3 text-xs text-[var(--ink-muted)]">{c.type || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      );
    },
  );
};

const SONAR_KEY_LABEL: Record<string, string> = {
  bugs: 'Bugs',
  vulnerabilities: 'Vulnerabilities',
  code_smells: 'Code smells',
  security_hotspots: 'Security hotspots',
  duplicated_lines_density: 'Duplicated lines %',
  coverage: 'Coverage %',
  ncloc: 'Lines of code',
  complexity: 'Complexity',
};

const SonarPanel = ({ resp }: { resp?: ParsedReportResponse }) => {
  return renderPanelContent(
    resp,
    'No static code-quality scan registered for this environment.',
    (p) => {
      const s = p.sonar!;
      return (
        <div className="space-y-5">
          {s.metrics.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {s.metrics.map((m) => (
                <div key={m.key} className="rounded-[var(--radius)] border border-[var(--border)] p-3">
                  <div className="text-2xl font-bold tabular-nums text-[var(--ink)]">{m.value || '—'}</div>
                  <div className="text-xs text-[var(--ink-muted)] mt-0.5 truncate" title={m.key}>
                    {SONAR_KEY_LABEL[m.key.toLowerCase()] || m.key}
                  </div>
                </div>
              ))}
            </div>
          )}

          {(s.hotspots || s.issues) ? (
            <div className="flex flex-wrap items-center gap-2">
              {s.hotspots ? <PillTag tone="amber" size="sm">Hotspots: {s.hotspots}</PillTag> : null}
              {s.issues   ? <PillTag tone="orange" size="sm">Issues: {s.issues}</PillTag> : null}
            </div>
          ) : null}

          {s.lines && s.lines.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-[var(--ink)] mb-2">Report excerpt</h4>
              <pre className="max-h-72 overflow-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-3 text-xs leading-relaxed text-[var(--ink)] whitespace-pre-wrap">
                {s.lines.slice(0, 200).join('\n')}
              </pre>
            </div>
          )}

          {s.metrics.length === 0 && (!s.lines || s.lines.length === 0) && (
            <PanelEmpty label="Sonar report parsed but contains no recognizable metrics or lines." />
          )}
        </div>
      );
    },
  );
};

const ZAP_RISK_TONE: Record<string, 'red' | 'orange' | 'amber' | 'green' | 'slate'> = {
  High: 'red',
  Medium: 'orange',
  Low: 'amber',
  Informational: 'slate',
};

const ZapPanel = ({ resp }: { resp?: ParsedReportResponse }) => {
  return renderPanelContent(
    resp,
    'No live-runtime (DAST) scan registered for this environment.',
    (p) => {
      const z = p.zap!;
      return (
        <div className="space-y-4">
          {z.site && (
            <div className="text-xs text-[var(--ink-muted)]">
              Site: <span className="font-mono text-[var(--ink)]">{z.site}</span>
            </div>
          )}
          {z.alerts.length === 0 ? (
            <PanelEmpty label="No runtime alerts. 🟢" />
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--card)]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-[var(--border)] bg-black/[0.025]">
                    <th className="px-4 py-3 font-semibold text-[11px] uppercase tracking-[0.12em] text-[var(--ink-muted)]">Risk</th>
                    <th className="px-4 py-3 font-semibold text-[11px] uppercase tracking-[0.12em] text-[var(--ink-muted)]">Alert</th>
                    <th className="px-4 py-3 font-semibold text-[11px] uppercase tracking-[0.12em] text-[var(--ink-muted)]">Confidence</th>
                    <th className="px-4 py-3 font-semibold text-[11px] uppercase tracking-[0.12em] text-[var(--ink-muted)] text-right">Instances</th>
                    <th className="px-4 py-3 font-semibold text-[11px] uppercase tracking-[0.12em] text-[var(--ink-muted)]">Sample</th>
                  </tr>
                </thead>
                <tbody>
                  {z.alerts.map((a, i) => (
                    <tr key={`${a.name}-${i}`} className="border-b border-[var(--border)] last:border-0 hover:bg-black/[0.025] transition-colors">
                      <td className="px-4 py-3"><PillTag tone={ZAP_RISK_TONE[a.risk] || 'slate'} size="sm">{a.risk}</PillTag></td>
                      <td className="px-4 py-3 text-[var(--ink)]">{a.name}</td>
                      <td className="px-4 py-3 text-xs text-[var(--ink-muted)]">{a.confidence || '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--ink)]">{a.count}</td>
                      <td className="px-4 py-3 text-xs text-[var(--ink-muted)] font-mono max-w-md truncate" title={a.sample}>{a.sample || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      );
    },
  );
};
