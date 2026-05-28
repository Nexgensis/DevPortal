import { useState, useEffect } from 'react';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { FileText, RefreshCw, User, Play, Square, Plus, Edit, Trash2, Pin as PinIcon } from 'lucide-react';
import { AuditLog } from '../types/app';
import { auditApi } from '../lib/api';
import { toast } from 'sonner';
import { GlassCard } from './ui/glass-card';
import { AccentButton } from './ui/accent-button';
import { GlassSkeleton } from './ui/glass-skeleton';
import { PillTag, PillTone } from './ui/pill-tag';

// Action verb → PillTag tone + icon. start = live (green), stop/delete =
// terminal (red), create = new (cyan), update = mutating (amber), pin = promoted
// (orange), neutral fallback = slate.
type ActionSpec = { tone: PillTone; icon: React.ComponentType<{ className?: string }> };
const ACTION_SPEC: Record<string, ActionSpec> = {
  start:  { tone: 'green',  icon: Play },
  stop:   { tone: 'red',    icon: Square },
  create: { tone: 'cyan',   icon: Plus },
  update: { tone: 'amber',  icon: Edit },
  delete: { tone: 'red',    icon: Trash2 },
  pin:    { tone: 'orange', icon: PinIcon },
  unpin:  { tone: 'slate',  icon: PinIcon },
};

const actionSpec = (action: string): ActionSpec => {
  for (const key of Object.keys(ACTION_SPEC)) {
    if (action.includes(key)) return ACTION_SPEC[key];
  }
  return { tone: 'slate', icon: FileText };
};

export function AuditLogs() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [filters, setFilters] = useState({
    action: '',
    resourceType: '',
    username: '',
  });
  const [pageSize, setPageSize] = useState(20);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters, pageSize]);

  useEffect(() => {
    loadLogs();
  }, [currentPage, filters, pageSize]);

  const loadLogs = async () => {
    try {
      setIsLoading(true);
      const result = await auditApi.getLogs({
        limit: pageSize,
        offset: (currentPage - 1) * pageSize,
        action: filters.action || undefined,
        resourceType: filters.resourceType || undefined,
      });
      setLogs(result.logs || []);
      setTotal(result.total || 0);
    } catch (error) {
      console.error('Failed to load audit logs:', error);
      toast.error('Failed to load audit logs');
      setLogs([]);
      setTotal(0);
    } finally {
      setIsLoading(false);
    }
  };


  const formatDuration = (details: string) => {
    const durationMatch = details.match(/Duration: ([^,]+)/);
    if (durationMatch) {
      return durationMatch[1];
    }
    return null;
  };

  const filteredLogs = logs.filter(log =>
    log.username.toLowerCase().includes(filters.username.toLowerCase())
  );

  const totalPages = Math.ceil(total / pageSize);

  const pageButtonClasses = (active: boolean) =>
    `inline-flex items-center justify-center h-9 min-w-9 px-3 rounded-xl text-sm font-medium transition-colors focus-ring-cyan ${
      active
        ? 'bg-[var(--accent-lime)] text-[#0A0B14] shadow-[0_3px_12px_rgba(163,255,18,0.35)]'
        : 'bg-black/4 text-[var(--ink)] hover:bg-black/8 border border-black/8 backdrop-blur-md'
    } disabled:opacity-50 disabled:cursor-not-allowed`;

  return (
    <GlassCard>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold text-[var(--ink)]">
            <FileText className="h-6 w-6" />
            Audit Logs
          </h2>
          <p className="text-sm text-[var(--ink-muted)] mt-1">
            Track all system activities and changes
          </p>
        </div>
        <AccentButton variant="ghost" onClick={loadLogs} disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </AccentButton>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="flex-1">
          <Input
            placeholder="Search by username..."
            value={filters.username}
            onChange={(e) => setFilters({ ...filters, username: e.target.value })}
            className="h-11"
          />
        </div>
        <Select value={filters.action || '__all__'} onValueChange={(value) => setFilters({ ...filters, action: value === '__all__' ? '' : value })}>
          <SelectTrigger className="w-full sm:w-48 h-11">
            <SelectValue placeholder="Filter by action" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Actions</SelectItem>
            <SelectItem value="start_app">Start App</SelectItem>
            <SelectItem value="stop_app">Stop App</SelectItem>
            <SelectItem value="create_app">Create App</SelectItem>
            <SelectItem value="update_app">Update App</SelectItem>
            <SelectItem value="delete_app">Delete App</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.resourceType || '__all__'} onValueChange={(value) => setFilters({ ...filters, resourceType: value === '__all__' ? '' : value })}>
          <SelectTrigger className="w-full sm:w-48 h-11">
            <SelectValue placeholder="Filter by resource" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Resources</SelectItem>
            <SelectItem value="app">Applications</SelectItem>
            <SelectItem value="server">Servers</SelectItem>
            <SelectItem value="project">Projects</SelectItem>
            <SelectItem value="user">Users</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Logs */}
      {isLoading ? (
        <div className="space-y-2">
          <GlassSkeleton.Row count={6} />
        </div>
      ) : (
        <div className="space-y-2">
          {filteredLogs.map((log) => (
            <div
              key={log.id}
              className="glass-card glass-hover flex items-center justify-between gap-4 p-4"
            >
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-shrink-0">
                  {(() => {
                    const spec = actionSpec(log.action);
                    return (
                      <PillTag tone={spec.tone} icon={spec.icon as never} size="sm">
                        {log.action.replace(/_/g, ' ')}
                      </PillTag>
                    );
                  })()}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <User className="h-4 w-4 text-[var(--ink-muted)] flex-shrink-0" />
                    <span className="truncate font-medium text-[var(--ink)]">{log.username}</span>
                    <span className="text-[var(--ink-muted)] flex-shrink-0">•</span>
                    <span className="truncate text-[var(--ink)]">{log.resourceName}</span>
                    <PillTag tone="slate" size="sm" className="flex-shrink-0">
                      {log.resourceType}
                    </PillTag>
                  </div>

                  <div className="text-sm text-[var(--ink-muted)] truncate">
                    {log.details}
                    {formatDuration(log.details) && (
                      <span className="ml-2 text-amber-300">
                        Duration: {formatDuration(log.details)}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="text-right text-xs text-[var(--ink-muted)] flex-shrink-0">
                <div>{new Date(log.createdAt).toLocaleDateString()}</div>
                <div>{new Date(log.createdAt).toLocaleTimeString()}</div>
              </div>
            </div>
          ))}

          {filteredLogs.length === 0 && !isLoading && (
            <div className="text-center py-16 px-4 rounded-2xl border border-dashed border-black/6 bg-black/3">
              <div className="h-24 w-24 rounded-2xl glass-card flex items-center justify-center mx-auto mb-4">
                <FileText className="h-12 w-12 text-[var(--ink-muted)]" />
              </div>
              <h3 className="mb-2 text-lg font-semibold text-[var(--ink)]">No Audit Logs Available</h3>
              <p className="text-[var(--ink-muted)] mb-4 max-w-md mx-auto">
                No logs found matching your filters.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Pagination */}
      {total > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-6 pt-6 border-t border-black/6">
          <div className="flex items-center gap-4">
            <div className="text-sm text-[var(--ink-muted)]">
              Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, total)} of {total} logs
            </div>
            <Select value={pageSize.toString()} onValueChange={(value) => setPageSize(Number(value))}>
              <SelectTrigger className="w-32 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10 per page</SelectItem>
                <SelectItem value="20">20 per page</SelectItem>
                <SelectItem value="50">50 per page</SelectItem>
                <SelectItem value="100">100 per page</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <button onClick={() => setCurrentPage(1)} disabled={currentPage === 1} className={pageButtonClasses(false)}>
                First
              </button>
              <button onClick={() => setCurrentPage(currentPage - 1)} disabled={currentPage === 1} className={pageButtonClasses(false)}>
                Previous
              </button>

              <div className="flex items-center gap-1">
                {(() => {
                  const pages: any[] = [];
                  const maxVisible = 5;
                  let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
                  let endPage = Math.min(totalPages, startPage + maxVisible - 1);

                  if (endPage - startPage < maxVisible - 1) {
                    startPage = Math.max(1, endPage - maxVisible + 1);
                  }

                  if (startPage > 1) {
                    pages.push(
                      <button key={1} onClick={() => setCurrentPage(1)} className={pageButtonClasses(1 === currentPage)}>
                        1
                      </button>
                    );
                    if (startPage > 2) {
                      pages.push(
                        <span key="ellipsis-start" className="px-2 text-[var(--ink-muted)]">…</span>
                      );
                    }
                  }

                  for (let i = startPage; i <= endPage; i++) {
                    pages.push(
                      <button key={i} onClick={() => setCurrentPage(i)} className={pageButtonClasses(i === currentPage)}>
                        {i}
                      </button>
                    );
                  }

                  if (endPage < totalPages) {
                    if (endPage < totalPages - 1) {
                      pages.push(
                        <span key="ellipsis-end" className="px-2 text-[var(--ink-muted)]">…</span>
                      );
                    }
                    pages.push(
                      <button key={totalPages} onClick={() => setCurrentPage(totalPages)} className={pageButtonClasses(totalPages === currentPage)}>
                        {totalPages}
                      </button>
                    );
                  }

                  return pages;
                })()}
              </div>

              <button onClick={() => setCurrentPage(currentPage + 1)} disabled={currentPage === totalPages} className={pageButtonClasses(false)}>
                Next
              </button>
              <button onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages} className={pageButtonClasses(false)}>
                Last
              </button>
            </div>
          )}
        </div>
      )}
    </GlassCard>
  );
}
