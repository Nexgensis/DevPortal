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
import { Button } from './components/ui/button';
import { Badge } from './components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { Plus, Activity, FolderKanban, Search } from 'lucide-react';
import { Input } from './components/ui/input';
import { App, Project } from './types/app';
import { Toaster } from './components/ui/sonner';

export default function App() {
  const { user, isLoading: authLoading, isAuthenticated, isAdmin, login, logout } = useAuth();
  const { apps, addApp, updateApp, removeApp, startApp, stopApp, getAppsByProject, getAppsByServer, isLoading: appsLoading, error: appsError, reload: reloadApps } = useApps();
  const { servers, addServer, updateServer, removeServer, refreshAllServers, isLoading: serversLoading, error: serversError, reload: reloadServers } = useServers();
  const { projects, addProject, updateProject, removeProject, isLoading: projectsLoading, error: projectsError, reload: reloadProjects } = useProjects();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingApp, setEditingApp] = useState<App | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeView, setActiveView] = useState<'applications' | 'infrastructure' | 'users' | 'audit-logs'>('applications');
  const [serverDialogTrigger, setServerDialogTrigger] = useState(0);
  const [projectDialogTrigger, setProjectDialogTrigger] = useState(0);

  // Show login page if not authenticated
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <Activity className="h-12 w-12 text-accent mx-auto mb-4 animate-pulse" />
          <p className="text-muted-foreground">Loading...</p>
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

  const handleEditApp = (app: App) => {
    setEditingApp(app);
    setDialogOpen(true);
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
    <div className="flex min-h-screen bg-white">
      {/* Sidebar */}
      <Sidebar
        activeView={activeView}
        onNavigate={setActiveView}
        onLogout={logout}
        isAdmin={isAdmin}
        username={user?.username || ''}
      />

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        <div className="p-8 max-w-[1600px] mx-auto">
          {/* Header */}
          <div className="mb-8 bento-card">
            <div className="flex items-center justify-between">
              <div>
                <h1>
                  {activeView === 'applications' && 'Applications'}
                  {activeView === 'infrastructure' && 'Infrastructure'}
                  {activeView === 'users' && 'User Management'}
                  {activeView === 'audit-logs' && 'Audit Logs'}
                </h1>
                <p className="text-muted-foreground mt-1">
                  {activeView === 'applications' && 'Manage and monitor your Docker Compose applications'}
                  {activeView === 'infrastructure' && 'Manage servers, projects, and users'}
                  {activeView === 'users' && 'Manage users and their permissions'}
                  {activeView === 'audit-logs' && 'View and manage audit logs'}
                </p>
              </div>
            </div>
          </div>

          {/* Content Area */}
          {activeView === 'applications' && (
            <div className="bento-card">
              {/* Search and Actions Bar */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 mb-6">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                  <Input
                    placeholder="Search applications..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-12 border-2 border-black/10 rounded-lg h-12 focus:border-black"
                  />
                </div>
                {isAdmin && (
                  <Button
                    onClick={handleAddApp}
                    className="bg-accent hover:bg-accent/90 text-accent-foreground border-2 border-black rounded-lg h-12 px-6"
                    disabled={projects.length === 0 || servers.length === 0}
                  >
                    <Plus className="mr-2 h-5 w-5" />
                    Add Application
                  </Button>
                )}
              </div>

              {apps.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 px-4">
                  <div className="h-32 w-32 rounded-xl bg-secondary border-2 border-black/10 flex items-center justify-center mb-6">
                    <Activity className="h-16 w-16 text-muted-foreground/60" />
                  </div>
                  <h3 className="mb-3">No Applications Yet</h3>
                  <p className="text-muted-foreground text-center mb-8 max-w-md">
                    {isAdmin
                      ? projects.length === 0
                        ? 'Create a project first to organize your applications.'
                        : servers.length === 0
                        ? 'Add a server connection first to deploy your applications.'
                        : 'Get started by adding your first Docker Compose application.'
                      : 'No applications have been configured yet. Contact your administrator.'}
                  </p>
                  {isAdmin && projects.length > 0 && servers.length > 0 && (
                    <Button
                      onClick={handleAddApp}
                      className="bg-accent hover:bg-accent/90 text-accent-foreground border-2 border-black rounded-lg px-8 h-12"
                    >
                      <Plus className="mr-2 h-5 w-5" />
                      Add Your First Application
                    </Button>
                  )}
                </div>
              ) : projects.length === 0 ? (
                <div className="text-center py-16 px-4">
                  <div className="h-24 w-24 rounded-xl bg-secondary border-2 border-black/10 flex items-center justify-center mx-auto mb-4">
                    <FolderKanban className="h-12 w-12 text-muted-foreground/60" />
                  </div>
                  <p className="text-muted-foreground">
                    No projects available. {isAdmin ? 'Create a project to organize your apps.' : 'Contact your administrator.'}
                  </p>
                </div>
              ) : visibleProjects.length === 0 ? (
                <div className="text-center py-16 px-4">
                  <div className="h-24 w-24 rounded-xl bg-secondary border-2 border-black/10 flex items-center justify-center mx-auto mb-4">
                    <Search className="h-12 w-12 text-muted-foreground/40" />
                  </div>
                  <h3 className="mb-2">No Results Found</h3>
                  <p className="text-muted-foreground mb-1">No apps found matching "{searchQuery}"</p>
                  <p className="text-muted-foreground mb-6">Try searching by app name, domain, or project name</p>
                  <Button
                    variant="outline"
                    className="border-2 border-black rounded-lg"
                    onClick={() => setSearchQuery('')}
                  >
                    Clear Search
                  </Button>
                </div>
              ) : (
                <Tabs defaultValue={visibleProjects[0]?.id} className="w-full">
                  {/* Project Tabs */}
                  <TabsList className="mb-8 flex-wrap h-auto bg-secondary rounded-lg p-2 border-2 border-black/10">
                    {visibleProjects.map((project) => (
                      <TabsTrigger 
                        key={project.id} 
                        value={project.id} 
                        className="rounded-lg px-6 py-3 data-[state=active]:bg-accent data-[state=active]:border-2 data-[state=active]:border-black transition-all"
                      >
                        <span className="mr-2">{project.name}</span>
                        <Badge variant="secondary" className="rounded-full bg-black/10 text-black px-2.5 py-0.5">
                          {appsByProject[project.id]?.length || 0}
                        </Badge>
                      </TabsTrigger>
                    ))}
                  </TabsList>

                  {/* Project Content */}
                  {visibleProjects.map((project) => (
                    <TabsContent key={project.id} value={project.id} className="mt-0">
                      {appsByProject[project.id]?.length === 0 ? (
                        <div className="text-center py-16 px-4">
                          <div className="h-24 w-24 rounded-xl bg-secondary border-2 border-black/10 flex items-center justify-center mx-auto mb-4">
                            <FolderKanban className="h-12 w-12 text-muted-foreground/60" />
                          </div>
                          <h3 className="mb-2">No Applications in {project.name}</h3>
                          <p className="text-muted-foreground mb-6">This project doesn't have any applications yet.</p>
                          {isAdmin && (
                            <Button
                              onClick={handleAddApp}
                              className="bg-accent hover:bg-accent/90 text-accent-foreground border-2 border-black rounded-lg px-6 h-11"
                            >
                              <Plus className="mr-2 h-4 w-4" />
                              Add Application
                            </Button>
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
            />
          )}

          {activeView === 'users' && isAdmin && (
            <UserManagement />
          )}

          {activeView === 'audit-logs' && isAdmin && (
            <AuditLogs />
          )}
        </div>
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