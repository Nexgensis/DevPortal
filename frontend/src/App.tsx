import { useState, useEffect } from 'react';
import { useApps } from './hooks/useApps';
import { useServers } from './hooks/useServers';
import { useProjects } from './hooks/useProjects';
import { useAuth } from './hooks/useAuth';
import { AppCard } from './components/AppCard';
import { AppManagementDialog } from './components/AppManagementDialog';
import { Sidebar } from './components/Sidebar';
import { Infrastructure } from './components/Infrastructure';
import { UserManagement } from './components/UserManagement';
import { AuditLogs } from './components/AuditLogs';
import { LoginPage } from './components/LoginPage';
import { AuthCallback } from './components/AuthCallback';
import { PostgresManager } from './components/PostgresManager';
import { Badge } from './components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { Plus, Activity, FolderKanban, Search, Server as ServerIcon, Zap, Clock } from 'lucide-react';
import { Input } from './components/ui/input';
import { App as AppType, Project, Server } from './types/app';
import { Toaster } from './components/ui/sonner';
import { GlassCard } from './components/ui/glass-card';
import { AccentButton } from './components/ui/accent-button';

export default function App() {
  const { user, isLoading: authLoading, isAuthenticated, isAdmin, login, logout, setAuthToken } = useAuth();
  const { apps, addApp, updateApp, removeApp, startApp, stopApp, getAppsByProject, getAppsByServer, isLoading: appsLoading, error: appsError, reload: reloadApps } = useApps();
  const { servers, addServer, updateServer, removeServer, refreshAllServers, isLoading: serversLoading, error: serversError, reload: reloadServers } = useServers();
  const { projects, addProject, updateProject, removeProject, isLoading: projectsLoading, error: projectsError, reload: reloadProjects } = useProjects();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingApp, setEditingApp] = useState<App | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeView, setActiveView] = useState<'applications' | 'infrastructure' | 'users' | 'audit-logs' | 'database-dump'>('applications');
  const [serverDialogTrigger, setServerDialogTrigger] = useState(0);
  const [projectDialogTrigger, setProjectDialogTrigger] = useState(0);


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
          <p className="text-slate-600">Loading…</p>
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

  const handleNavigateToAdministration = () => {
    setActiveView('infrastructure');
  };

  const handleAddServerFromOverview = () => {
    setActiveView('infrastructure');
    setTimeout(() => setServerDialogTrigger(prev => prev + 1), 100);
  };

  const handleAddProjectFromOverview = () => {
    setActiveView('infrastructure');
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
    <div className="flex min-h-screen bg-[var(--sidebar-bg)]">
      {/* Sidebar */}
      <Sidebar
        activeView={activeView}
        onNavigate={setActiveView}
        onLogout={logout}
        isAdmin={isAdmin}
        username={user?.username || ''}
      />

      {/* Main Content — white rounded panel sitting inside the dark frame */}
      <main
        className="flex-1 min-w-0 my-4 mr-4 bg-[var(--canvas)] rounded-2xl overflow-hidden"
      >
        <div className="p-8 max-w-[1600px] mx-auto">
          {/* Header */}
          <div className="bento-card mb-8 p-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-semibold text-[var(--ink)]">
                  {activeView === 'applications' && 'Applications'}
                  {activeView === 'infrastructure' && 'Infrastructure'}
                  {activeView === 'database-dump' && 'Database Dump'}
                  {activeView === 'users' && 'User Management'}
                  {activeView === 'audit-logs' && 'Audit Logs'}
                </h1>
                <p className="text-[var(--ink-muted)] mt-1">
                  {activeView === 'applications' && 'Manage and monitor your Docker Compose applications'}
                  {activeView === 'infrastructure' && 'Manage servers, projects, and users'}
                  {activeView === 'database-dump' && 'Dump and download PostgreSQL databases from containers'}
                  {activeView === 'users' && 'Manage users and their permissions'}
                  {activeView === 'audit-logs' && 'View and manage audit logs'}
                </p>
              </div>
            </div>
          </div>

          {/* Bento stat row — only on Applications view */}
          {activeView === 'applications' && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <StatCard
                tone="cream"
                icon={<FolderKanban className="h-4 w-4" />}
                label="Total Applications"
                value={apps.length}
                trend={`${projects.length} project${projects.length === 1 ? '' : 's'}`}
              />
              <StatCard
                tone="pink"
                icon={<Zap className="h-4 w-4" />}
                label="Running Now"
                value={apps.filter(a => a.status === 'running').length}
                trend={`of ${apps.length} apps`}
              />
              <StatCard
                tone="cream"
                icon={<ServerIcon className="h-4 w-4" />}
                label="Servers Online"
                value={`${servers.filter(s => s.status === 'online').length}/${servers.length}`}
                trend={servers.length > 0 && servers.every(s => s.status === 'online') ? 'All healthy' : 'Mixed'}
              />
              <StatCard
                tone="peach"
                icon={<Clock className="h-4 w-4" />}
                label="Last Activity"
                value="Just now"
                trend="Live"
              />
            </div>
          )}

          {/* Content Area */}
          {activeView === 'applications' && (
            <GlassCard animate={false}>
              {/* Search and Actions Bar */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 mb-6">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3.5 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-500 pointer-events-none" />
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
                  <div className="h-32 w-32 rounded-2xl glass-card flex items-center justify-center mb-6">
                    <Activity className="h-16 w-16 text-[var(--accent-cyan)]" />
                  </div>
                  <h3 className="mb-3 text-lg font-semibold text-slate-900">No Applications Yet</h3>
                  <p className="text-slate-600 text-center mb-8 max-w-md">
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
                    <FolderKanban className="h-12 w-12 text-slate-500" />
                  </div>
                  <p className="text-slate-600">
                    No projects available. {isAdmin ? 'Create a project to organize your apps.' : 'Contact your administrator.'}
                  </p>
                </div>
              ) : visibleProjects.length === 0 ? (
                <div className="text-center py-16 px-4">
                  <div className="h-24 w-24 rounded-2xl glass-card flex items-center justify-center mx-auto mb-4">
                    <Search className="h-12 w-12 text-slate-500" />
                  </div>
                  <h3 className="mb-2 text-lg font-semibold text-slate-900">No Results Found</h3>
                  <p className="text-slate-600 mb-1">No apps found matching "{searchQuery}"</p>
                  <p className="text-slate-600 mb-6">Try searching by app name, domain, or project name</p>
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
                        <span className="inline-flex items-center justify-center min-w-5 px-1.5 h-5 rounded-full bg-black/5 text-xs font-semibold text-slate-700">
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
                            <FolderKanban className="h-12 w-12 text-slate-500" />
                          </div>
                          <h3 className="mb-2 text-lg font-semibold text-slate-900">No Applications in {project.name}</h3>
                          <p className="text-slate-600 mb-6">This project doesn't have any applications yet.</p>
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
            </GlassCard>
          )}

          {activeView === 'infrastructure' && isAdmin && (
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

          {activeView === 'users' && isAdmin && (
            <UserManagement />
          )}

          {activeView === 'audit-logs' && isAdmin && (
            <AuditLogs />
          )}

          {activeView === 'database-dump' && (
            <PostgresManager />
          )}
        </div>
      </main>

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