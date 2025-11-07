import { useState, useEffect } from 'react';
import { useApps } from './hooks/useApps';
import { useServers } from './hooks/useServers';
import { useProjects } from './hooks/useProjects';
import { useAuth } from './hooks/useAuth';
import { AppCard } from './components/AppCard';
import { AppManagementDialog } from './components/AppManagementDialog';

import { AdminPanel } from './components/AdminPanel';
import { LoginPage } from './components/LoginPage';
import { Button } from './components/ui/button';
import { Badge } from './components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { Plus, Activity, LogOut, FolderKanban, Shield, Search } from 'lucide-react';
import { Input } from './components/ui/input';
import { App, Project } from './types/app';
import { Toaster } from './components/ui/sonner';
// Server API calls now handled by backend integration

export default function App() {
  const { user, isLoading: authLoading, isAuthenticated, isAdmin, login, logout } = useAuth();
  const { apps, addApp, updateApp, removeApp, startApp, stopApp, getAppsByProject, getAppsByServer, isLoading: appsLoading, error: appsError, reload: reloadApps } = useApps();
  const { servers, addServer, updateServer, removeServer, refreshAllServers, isLoading: serversLoading, error: serversError, reload: reloadServers } = useServers();
  const { projects, addProject, updateProject, removeProject, isLoading: projectsLoading, error: projectsError, reload: reloadProjects } = useProjects();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingApp, setEditingApp] = useState<App | null>(null);

  const [searchQuery, setSearchQuery] = useState('');

  // Note: Server status polling is now handled by the backend

  // Show login page if not authenticated
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
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



  // Group apps by project and filter by search
  const appsByProject = projects.reduce((acc, project) => {
    const projectApps = getAppsByProject(project.id);
    
    // Filter apps by search query (search by app name, domain, or project name)
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
    <div className="min-h-screen p-6 sm:p-10">
      <div className="max-w-[1600px] mx-auto bg-white/60 backdrop-blur-sm rounded-[2.5rem] shadow-[0_8px_40px_rgba(0,0,0,0.08)] p-8 sm:p-10 lg:p-12">
        {/* Header */}
        <div className="mb-10">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
            <div className="flex items-center gap-5">
              <div className="h-16 w-16 rounded-3xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center shadow-lg">
                <Activity className="h-8 w-8 text-white" />
              </div>
              <div>
                <h1 className="text-foreground mb-1">Welcome, {user?.username}</h1>
                <p className="text-muted-foreground">
                  Manage your applications and servers
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-3 px-5 py-3 bg-white rounded-3xl shadow-sm">
                <div className="h-8 w-8 rounded-full bg-accent/20 flex items-center justify-center">
                  <Shield className={`h-4 w-4 ${isAdmin ? 'text-accent-foreground' : 'text-primary'}`} />
                </div>
                <span className="text-foreground">
                  {isAdmin ? 'Administrator' : 'User'}
                </span>
              </div>
              <Button
                variant="ghost"
                onClick={logout}
                className="rounded-3xl hover:bg-white px-5 h-12"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Logout
              </Button>
            </div>
          </div>
        </div>

        {/* Admin Panel (Admin Only) */}
        {isAdmin && (
          <AdminPanel
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

        {/* Apps Section */}
        <div className="bg-white rounded-[2rem] shadow-[0_4px_24px_rgba(0,0,0,0.06)] p-10">
          {/* Section Header */}
          <div className="mb-10">
            <div className="flex items-center gap-3 mb-2">
              <div className="h-10 w-10 rounded-2xl bg-primary/10 flex items-center justify-center">
                <FolderKanban className="h-5 w-5 text-primary" />
              </div>
              <h2 className="text-foreground">Applications</h2>
            </div>
            <p className="text-muted-foreground ml-[52px]">
              Manage and monitor your Docker Compose applications
            </p>
          </div>

          {/* Search and Actions Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 mb-8">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <Input
                placeholder="Search applications..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-12 rounded-3xl bg-secondary/50 border-0 h-12 focus:bg-secondary"
              />
            </div>
            {isAdmin && (
              <Button
                onClick={handleAddApp}
                className="bg-accent hover:bg-accent/90 text-accent-foreground rounded-full h-12 px-8 shadow-sm"
                disabled={projects.length === 0 || servers.length === 0}
              >
                <Plus className="mr-2 h-5 w-5" />
                Add Application
              </Button>
            )}
          </div>

          {apps.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 px-4">
              <div className="h-32 w-32 rounded-[2rem] bg-gradient-to-br from-secondary to-secondary/50 flex items-center justify-center mb-6 shadow-sm">
                <Activity className="h-16 w-16 text-muted-foreground/60" />
              </div>
              <h3 className="text-foreground mb-3">No Applications Yet</h3>
              <p className="text-muted-foreground text-center mb-8 max-w-md leading-relaxed">
                {isAdmin
                  ? projects.length === 0
                    ? 'Create a project first to organize your applications, then add your first Docker Compose app.'
                    : servers.length === 0
                    ? 'Add a server connection first, then you can deploy your applications.'
                    : 'Get started by adding your first Docker Compose application.'
                  : 'No applications have been configured yet. Contact your administrator to get started.'}
              </p>
              {isAdmin && projects.length > 0 && servers.length > 0 && (
                <Button
                  onClick={handleAddApp}
                  className="bg-accent hover:bg-accent/90 text-accent-foreground rounded-full px-8 h-12 shadow-sm"
                >
                  <Plus className="mr-2 h-5 w-5" />
                  Add Your First Application
                </Button>
              )}
            </div>
          ) : projects.length === 0 ? (
            <div className="text-center py-16 px-4">
              <div className="h-24 w-24 rounded-3xl bg-secondary/50 flex items-center justify-center mx-auto mb-4">
                <FolderKanban className="h-12 w-12 text-muted-foreground/60" />
              </div>
              <p className="text-muted-foreground">
                No projects available. {isAdmin ? 'Create a project to organize your apps.' : 'Contact your administrator.'}
              </p>
            </div>
          ) : visibleProjects.length === 0 ? (
            <div className="text-center py-16 px-4">
              <div className="h-24 w-24 rounded-3xl bg-secondary/50 flex items-center justify-center mx-auto mb-4">
                <Search className="h-12 w-12 text-muted-foreground/40" />
              </div>
              <h3 className="text-foreground mb-2">No Results Found</h3>
              <p className="text-muted-foreground mb-1">No apps found matching "{searchQuery}"</p>
              <p className="text-muted-foreground mb-6">Try searching by app name, domain, or project name</p>
              <Button
                variant="outline"
                className="rounded-full border-2"
                onClick={() => setSearchQuery('')}
              >
                Clear Search
              </Button>
            </div>
          ) : (
            <Tabs defaultValue={visibleProjects[0]?.id} className="w-full">
              {/* Project Tabs */}
              <TabsList className="mb-8 flex-wrap h-auto bg-gradient-to-r from-secondary/80 to-secondary/40 rounded-3xl p-2">
                {visibleProjects.map((project) => (
                  <TabsTrigger 
                    key={project.id} 
                    value={project.id} 
                    className="rounded-2xl px-6 py-3 data-[state=active]:bg-white data-[state=active]:shadow-md transition-all"
                  >
                    <span className="mr-2">{project.name}</span>
                    <Badge variant="secondary" className="rounded-full bg-primary/10 text-primary px-2.5 py-0.5">
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
                      <div className="h-24 w-24 rounded-3xl bg-secondary/50 flex items-center justify-center mx-auto mb-4">
                        <FolderKanban className="h-12 w-12 text-muted-foreground/60" />
                      </div>
                      <h3 className="text-foreground mb-2">No Applications in {project.name}</h3>
                      <p className="text-muted-foreground mb-6">This project doesn't have any applications yet.</p>
                      {isAdmin && (
                        <Button
                          onClick={handleAddApp}
                          className="bg-accent hover:bg-accent/90 text-accent-foreground rounded-full px-6 h-11"
                        >
                          <Plus className="mr-2 h-4 w-4" />
                          Add Application
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
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
