import { useState, useEffect } from 'react';
import { useRoute, buildUrl, DEFAULT_VIEW, type View, type ConfigTab } from './hooks/useRoute';
import { useApps } from './hooks/useApps';
import { useServers } from './hooks/useServers';
import { useProjects } from './hooks/useProjects';
import { useAuth } from './hooks/useAuth';
import { AppCard } from './components/AppCard';
import { AppManagementDialog } from './components/AppManagementDialog';
import { FolderTabs } from './components/FolderTabs';
import { Infrastructure } from './components/Infrastructure';
import { UserManagement } from './components/UserManagement';
import { AuditLogs } from './components/AuditLogs';
import { LoginPage } from './components/LoginPage';
import { AuthCallback } from './components/AuthCallback';
import { PostgresManager } from './components/PostgresManager';
import { SecurityScanReport } from './components/SecurityScanReport';
import { RunningApps } from './components/RunningApps';
import { Wiki } from './components/Wiki';
import { Badge } from './components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { Plus, Activity, FolderKanban, Search, Server as ServerIcon, Zap, Clock, LogOut, Shield, Sun, Moon, Users as UsersIcon, FileText, ShieldCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Input } from './components/ui/input';
import { App as AppType, Project, Server } from './types/app';
import { Toaster } from './components/ui/sonner';
import { GlassCard } from './components/ui/glass-card';
import { AccentButton } from './components/ui/accent-button';

// Per-view editorial header copy — each folder tab gets its own big serif title
// + muted subtitle at the top of the workspace (keyed by activeView).
const VIEW_META: Record<'applications' | 'config' | 'database-dump' | 'security-scan' | 'running-apps' | 'wiki', { title: string; subtitle: string }> = {
  'database-dump': { title: 'Database Dump', subtitle: 'Dump and download PostgreSQL databases from containers' },
  applications: { title: 'Applications', subtitle: 'Deploy and manage your Docker Compose applications' },
  'running-apps': { title: 'Running Apps', subtitle: 'Live view of compose projects and their frontend URLs per server' },
  'security-scan': { title: 'Security Scan Report', subtitle: 'Latest CI/CD security scan reports per repository and branch' },
  wiki: { title: 'Developer Wiki', subtitle: 'Onboarding guides, git workflow, deployment notes, and team knowledge' },
  config: { title: 'Configuration', subtitle: 'Servers, users, and system activity' },
};

// Config groups three admin sections behind one tab; each sub-tab keeps its own header copy.
// The ConfigTab union lives in useRoute so the URL parser and the UI can't drift.
const CONFIG_TABS: Record<ConfigTab, { title: string; subtitle: string; icon: LucideIcon }> = {
  infrastructure: { title: 'Infrastructure', subtitle: 'Manage server connections and project groupings', icon: ServerIcon },
  users: { title: 'Users', subtitle: 'Manage user accounts, roles, and access', icon: UsersIcon },
  'scan-sources': { title: 'Scan Sources', subtitle: 'Register and refresh CI/CD security-scan report sources', icon: ShieldCheck },
  'audit-logs': { title: 'Audit Logs', subtitle: 'Review system activity and security events', icon: FileText },
};
const CONFIG_TAB_ORDER: ConfigTab[] = ['infrastructure', 'users', 'scan-sources', 'audit-logs'];

export default function App() {
  const { user, isLoading: authLoading, isAuthenticated, isAdmin, login, logout, setAuthToken } = useAuth();
  const { apps, addApp, updateApp, removeApp, startApp, stopApp, getAppsByProject, getAppsByServer, isLoading: appsLoading, error: appsError, reload: reloadApps } = useApps();
  const { servers, addServer, updateServer, removeServer, refreshAllServers, isLoading: serversLoading, error: serversError, reload: reloadServers } = useServers();
  const { projects, addProject, updateProject, removeProject, isLoading: projectsLoading, error: projectsError, reload: reloadProjects } = useProjects();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingApp, setEditingApp] = useState<App | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Navigation lives in the URL, so Back/Forward, refresh and shared links all
  // work. These names are kept so the rest of the component reads unchanged.
  const { route, navigate } = useRoute();
  const activeView = route.view;
  const configTab = route.configTab;
  const setActiveView = (view: View) => navigate({ view });
  const setConfigTab = (tab: ConfigTab) => navigate({ view: 'config', configTab: tab });

  const [serverDialogTrigger, setServerDialogTrigger] = useState(0);
  const [projectDialogTrigger, setProjectDialogTrigger] = useState(0);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('devops-theme');
      if (saved === 'light' || saved === 'dark') return saved;
    }
    return 'light';
  });

  // Apply the theme by toggling the `.dark` class on <html>, and persist it.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('devops-theme', theme);
  }, [theme]);


  // Handle Microsoft SSO callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    if (token) {
      const handleSSO = async () => {
        const success = await setAuthToken(token);
        if (success) {
          // Remove token from URL
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      };
      handleSSO();
    }
  }, [setAuthToken]);

  // Normalise the URL once the session is known: "/" or an unknown path becomes
  // the default view, and a non-admin who deep-links to /config is bounced out.
  // Both use replace so Back doesn't return to the path we just redirected away
  // from and bounce forward again.
  useEffect(() => {
    if (!isAuthenticated) return;
    if (window.location.pathname.includes('/auth/callback')) return;
    if (route.view === 'config' && !isAdmin) {
      navigate({ view: DEFAULT_VIEW }, { replace: true });
      return;
    }
    if (buildUrl(route) !== window.location.pathname + window.location.search) {
      navigate({}, { replace: true });
    }
  }, [isAuthenticated, isAdmin, route, navigate]);

  // Check if we're on the auth callback route
  const isAuthCallback = window.location.pathname.includes('/auth/callback') ||
    new URLSearchParams(window.location.search).has('token');

  // Show auth callback page if redirected from Microsoft
  if (isAuthCallback && !isAuthenticated) {
    return <AuthCallback onAuthSuccess={setAuthToken} />;
  }

  // Show login page if not authenticated
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Activity className="h-12 w-12 text-[var(--accent-cyan)] mx-auto mb-4 animate-pulse" />
          <p className="text-[var(--ink-muted)]">Loading…</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage onLogin={login} />;
  }

  const handleAddApp = () => {
    setEditingApp(null);
    setDialogOpen(true);
  };

  const handleEditApp = (app: AppType) => {
    setEditingApp(app);
    setDialogOpen(true);
  };

  const handlePostgresBackup = (server: Server) => {
    setActiveView('database-dump');
  };

  // One navigate() per action: setting the tab and the view separately would
  // push two history entries, so Back would need two presses to leave.
  const handleNavigateToAdministration = () => {
    navigate({ view: 'config', configTab: 'infrastructure' });
  };

  const handleAddServerFromOverview = () => {
    navigate({ view: 'config', configTab: 'infrastructure' });
    setTimeout(() => setServerDialogTrigger(prev => prev + 1), 100);
  };

  const handleAddProjectFromOverview = () => {
    navigate({ view: 'config', configTab: 'infrastructure' });
    setTimeout(() => setProjectDialogTrigger(prev => prev + 1), 100);
  };

  // Group apps by project and filter by search
  const appsByProject = projects.reduce((acc, project) => {
    const projectApps = getAppsByProject(project.id);

    // Filter apps by search query
    const filteredApps = searchQuery
      ? projectApps.filter(app =>
        app.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        app.domain.toLowerCase().includes(searchQuery.toLowerCase()) ||
        project.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
      : projectApps;

    acc[project.id] = filteredApps;
    return acc;
  }, {} as Record<string, App[]>);

  // Filter projects to only show those with apps (after search)
  const visibleProjects = searchQuery
    ? projects.filter(project => appsByProject[project.id]?.length > 0)
    : projects;

  return (
    <div className="dot-matrix relative h-screen flex flex-col overflow-hidden">
      {/* Top bar — brand + user */}
      <header className="relative z-10 flex items-center justify-between px-6 pt-10 pb-4 flex-shrink-0">
        <div className="flex flex-col items-start">
          {/* Portal title (serif) */}
          <h1 className="font-display text-5xl lg:text-6xl font-bold leading-[1.05] tracking-tight text-[var(--ink)]">
            Nexus Aura Portal
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2.5 rounded-full bg-[var(--card)] border border-[var(--border)] pl-2.5 pr-3.5 py-1.5">
            <div className="h-7 w-7 rounded-full bg-[var(--accent-pink)] flex items-center justify-center flex-shrink-0">
              <Shield className="h-4 w-4 text-[var(--on-accent)]" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold text-[var(--ink)]">{user?.username}</div>
              <div className="text-[11px] text-[var(--ink-muted)]">{isAdmin ? 'Administrator' : 'User'}</div>
            </div>
          </div>
          <button
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            aria-label="Toggle light / dark theme"
            className="h-10 w-10 rounded-full flex items-center justify-center bg-[var(--card)] border border-[var(--border)] text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors focus:outline-none"
          >
            {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </button>
          <button
            onClick={logout}
            aria-label="Sign out"
            className="h-10 w-10 rounded-full flex items-center justify-center bg-[var(--card)] border border-[var(--border)] text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors focus:outline-none"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* Folder area — flat borderless card; the active (card-colored) tab melts into it */}
      <div className="relative z-10 flex-1 min-h-0 flex flex-col px-4 pb-4">
        <FolderTabs active={activeView} onNavigate={setActiveView} isAdmin={isAdmin} />
        <main className="folder-paper relative z-10 -mt-px flex-1 min-h-0 rounded-tr-[28px] rounded-b-[28px] border border-[var(--border)] overflow-auto">
          <div className="px-10 py-8">
          {/* Per-view editorial header — big serif title + muted subtitle for the active tab. */}
          <div className="mb-8">
            <h1 className="font-display text-4xl font-bold tracking-tight text-[var(--ink)]">
              {VIEW_META[activeView].title}
            </h1>
            <p className="text-[var(--ink-muted)] mt-2 text-base">
              {VIEW_META[activeView].subtitle}
            </p>
          </div>

          {/* Stats — inline on the paper, separated by hairlines (no boxes) */}
          {activeView === 'applications' && (
            <div className="mb-10 grid grid-cols-2 lg:grid-cols-4 border-y border-[var(--border)] divide-x divide-[var(--border)]">
              <EditorialStat value={apps.length} label="Total Applications" sub={`${projects.length} project${projects.length === 1 ? '' : 's'}`} />
              <EditorialStat value={apps.filter(a => a.status === 'running').length} label="Running Now" sub={`of ${apps.length} apps`} />
              <EditorialStat value={`${servers.filter(s => s.status === 'online').length}/${servers.length}`} label="Servers Online" sub={servers.length > 0 && servers.every(s => s.status === 'online') ? 'All healthy' : 'Mixed'} />
              <EditorialStat value="Just now" label="Last Activity" sub="Live" />
            </div>
          )}

          {/* Content Area — directly on the paper, no card wrapper */}
          {activeView === 'applications' && (
            <div>
              {/* Search and Actions Bar */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 mb-8">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3.5 top-1/2 transform -translate-y-1/2 h-4 w-4 text-[var(--ink-muted)] pointer-events-none" />
                  <Input
                    placeholder="Search applications..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 h-11"
                  />
                </div>
                {isAdmin && (
                  <AccentButton
                    onClick={handleAddApp}
                    variant="lime"
                    size="lg"
                    disabled={projects.length === 0 || servers.length === 0}
                  >
                    <Plus className="h-5 w-5" />
                    Add Application
                  </AccentButton>
                )}
              </div>

              {apps.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 px-4">
                  <Activity className="h-14 w-14 text-[var(--accent-pink)] mb-5" strokeWidth={1.5} />
                  <h3 className="mb-3 text-lg font-semibold text-[var(--ink)]">No Applications Yet</h3>
                  <p className="text-[var(--ink-muted)] text-center mb-8 max-w-md">
                    {isAdmin
                      ? projects.length === 0
                        ? 'Create a project first to organize your applications.'
                        : servers.length === 0
                          ? 'Add a server connection first to deploy your applications.'
                          : 'Get started by adding your first Docker Compose application.'
                      : 'No applications have been configured yet. Contact your administrator.'}
                  </p>
                  {isAdmin && projects.length > 0 && servers.length > 0 && (
                    <AccentButton onClick={handleAddApp} variant="lime" size="lg">
                      <Plus className="h-5 w-5" />
                      Add Your First Application
                    </AccentButton>
                  )}
                </div>
              ) : projects.length === 0 ? (
                <div className="text-center py-16 px-4">
                  <div className="h-24 w-24 rounded-2xl glass-card flex items-center justify-center mx-auto mb-4">
                    <FolderKanban className="h-12 w-12 text-[var(--ink-muted)]" />
                  </div>
                  <p className="text-[var(--ink-muted)]">
                    No projects available. {isAdmin ? 'Create a project to organize your apps.' : 'Contact your administrator.'}
                  </p>
                </div>
              ) : visibleProjects.length === 0 ? (
                <div className="text-center py-16 px-4">
                  <div className="h-24 w-24 rounded-2xl glass-card flex items-center justify-center mx-auto mb-4">
                    <Search className="h-12 w-12 text-[var(--ink-muted)]" />
                  </div>
                  <h3 className="mb-2 text-lg font-semibold text-[var(--ink)]">No Results Found</h3>
                  <p className="text-[var(--ink-muted)] mb-1">No apps found matching "{searchQuery}"</p>
                  <p className="text-[var(--ink-muted)] mb-6">Try searching by app name, domain, or project name</p>
                  <AccentButton variant="ghost" onClick={() => setSearchQuery('')}>
                    Clear Search
                  </AccentButton>
                </div>
              ) : (
                <Tabs defaultValue={visibleProjects[0]?.id} className="w-full">
                  {/* Project Tabs */}
                  <TabsList className="mb-8 flex-wrap h-auto">
                    {visibleProjects.map((project) => (
                      <TabsTrigger
                        key={project.id}
                        value={project.id}
                      >
                        <span className="mr-2">{project.name}</span>
                        <span className="inline-flex items-center justify-center min-w-5 px-1.5 h-5 rounded-full bg-black/5 text-xs font-semibold text-[var(--ink)]">
                          {appsByProject[project.id]?.length || 0}
                        </span>
                      </TabsTrigger>
                    ))}
                  </TabsList>

                  {/* Project Content */}
                  {visibleProjects.map((project) => (
                    <TabsContent key={project.id} value={project.id} className="mt-0">
                      {appsByProject[project.id]?.length === 0 ? (
                        <div className="text-center py-16 px-4">
                          <div className="h-24 w-24 rounded-2xl glass-card flex items-center justify-center mx-auto mb-4">
                            <FolderKanban className="h-12 w-12 text-[var(--ink-muted)]" />
                          </div>
                          <h3 className="mb-2 text-lg font-semibold text-[var(--ink)]">No Applications in {project.name}</h3>
                          <p className="text-[var(--ink-muted)] mb-6">This project doesn't have any applications yet.</p>
                          {isAdmin && (
                            <AccentButton onClick={handleAddApp} variant="lime">
                              <Plus className="h-4 w-4" />
                              Add Application
                            </AccentButton>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {appsByProject[project.id]?.map((app) => (
                            <AppCard
                              key={app.id}
                              app={app}
                              server={servers.find(s => s.id === app.serverId)}
                              project={project}
                              onUpdateApp={updateApp}
                              onStartApp={startApp}
                              onStopApp={stopApp}
                              onEditApp={handleEditApp}
                              onPostgresBackup={handlePostgresBackup}
                              isAdmin={isAdmin}
                            />
                          ))}
                        </div>
                      )}
                    </TabsContent>
                  ))}
                </Tabs>
              )}
            </div>
          )}

          {activeView === 'config' && isAdmin && (
            <div className="w-full">
              {/* Settings-style sub-navigation — flat underline tabs on a hairline rule. */}
              <div className="mb-8 border-b border-[var(--border)]">
                <nav className="-mb-px flex gap-1 overflow-x-auto">
                  {CONFIG_TAB_ORDER.map((id) => {
                    const { title, icon: Icon } = CONFIG_TABS[id];
                    const isActive = configTab === id;
                    return (
                      <button
                        key={id}
                        onClick={() => setConfigTab(id)}
                        className={`inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors focus:outline-none ${
                          isActive
                            ? 'border-[var(--accent-pink)] text-[var(--ink)]'
                            : 'border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)] hover:border-[var(--border)]'
                        }`}
                      >
                        <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />
                        {title}
                      </button>
                    );
                  })}
                </nav>
              </div>

              {configTab === 'infrastructure' && (
                <Infrastructure
                  servers={servers}
                  projects={projects}
                  onAddServer={addServer}
                  onUpdateServer={updateServer}
                  onDeleteServer={removeServer}
                  onAddProject={addProject}
                  onUpdateProject={updateProject}
                  onDeleteProject={removeProject}
                  onPostgresBackup={handlePostgresBackup}
                />
              )}
              {configTab === 'users' && <UserManagement />}
              {configTab === 'scan-sources' && <SecurityScanReport manage />}
              {configTab === 'audit-logs' && <AuditLogs />}
            </div>
          )}

          {activeView === 'database-dump' && (
            <PostgresManager />
          )}

          {activeView === 'security-scan' && (
            <SecurityScanReport />
          )}

          {activeView === 'running-apps' && (
            <RunningApps />
          )}

          {activeView === 'wiki' && (
            <Wiki />
          )}
          </div>
        </main>
      </div>

      {/* App Management Dialog (Admin Only) */}
      {isAdmin && (
        <AppManagementDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          app={editingApp}
          projects={projects}
          servers={servers}
          onSave={addApp}
          onUpdate={updateApp}
          onDelete={removeApp}
        />
      )}


      {/* Toast Notifications */}
      <Toaster />
    </div>
  );
}

// Editorial inline stat — big number + label, no box (sits on the folder paper).
function EditorialStat({ value, label, sub }: { value: React.ReactNode; label: string; sub?: string }) {
  return (
    <div className="px-6 py-5 first:pl-0">
      <div className="text-3xl font-bold leading-none tabular-nums text-[var(--ink)]">{value}</div>
      <div className="mt-2 text-sm font-medium text-[var(--ink)]">{label}</div>
      {sub && <div className="mt-0.5 text-xs text-[var(--ink-muted)]">{sub}</div>}
    </div>
  );
}

type StatTone = 'cream' | 'pink' | 'peach' | 'ink';
function StatCard({
  tone,
  icon,
  label,
  value,
  trend,
}: {
  tone: StatTone;
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  trend?: string;
}) {
  const toneStyles: Record<StatTone, { card: string; icon: string; label: string; value: string; trend: string }> = {
    cream: {
      card: 'bg-[var(--card)] border border-[var(--border)] text-[var(--ink)]',
      icon: 'bg-[rgba(26,22,18,0.06)] text-[var(--ink)]',
      label: 'text-[var(--ink-muted)]',
      value: 'text-[var(--ink)]',
      trend: 'inline-flex items-center rounded-full bg-[rgba(26,22,18,0.05)] text-[var(--ink)] px-2.5 py-0.5 text-xs font-medium',
    },
    pink: {
      card: 'bg-[var(--accent-pink-soft)] border border-[color-mix(in_srgb,var(--accent-pink)_25%,transparent)] text-[var(--ink)]',
      icon: 'bg-[var(--accent-pink)] text-[var(--ink)]',
      label: 'text-[var(--ink)]/60',
      value: 'text-[var(--ink)]',
      trend: 'inline-flex items-center rounded-full bg-[var(--accent-pink)] text-[var(--ink)] px-2.5 py-0.5 text-xs font-semibold',
    },
    peach: {
      card: 'bg-[var(--accent-peach-soft)] border border-[color-mix(in_srgb,var(--accent-peach)_30%,transparent)] text-[var(--ink)]',
      icon: 'bg-[var(--accent-peach)] text-[var(--ink)]',
      label: 'text-[var(--ink)]/60',
      value: 'text-[var(--ink)]',
      trend: 'inline-flex items-center rounded-full bg-[var(--card)] text-[var(--ink)] px-2.5 py-0.5 text-xs font-medium border border-[var(--border)]',
    },
    ink: {
      card: 'bg-[var(--ink)] text-[var(--card)]',
      icon: 'bg-[var(--card)] text-[var(--ink)]',
      label: 'text-white/55',
      value: 'text-[var(--card)]',
      trend: 'inline-flex items-center rounded-full bg-[var(--accent-pink)] text-[var(--ink)] px-2.5 py-0.5 text-xs font-semibold',
    },
  };
  const s = toneStyles[tone];

  return (
    <div className={`rounded-xl p-5 ${s.card}`}>
      <div className="flex items-center justify-between mb-3">
        <div className={`h-9 w-9 rounded-full flex items-center justify-center ${s.icon}`}>
          {icon}
        </div>
        {trend && <span className={s.trend}>{trend}</span>}
      </div>
      <div className={`text-3xl font-semibold leading-none tabular-nums ${s.value}`}>{value}</div>
      <div className={`text-sm mt-2 ${s.label}`}>{label}</div>
    </div>
  );
}