import { useState } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Server, Project } from '../types/app';
import { ServerManagementDialog } from './ServerManagementDialog';
import { ProjectManagementDialog } from './ProjectManagementDialog';
import { UserManagement } from './UserManagement';
import { AuditLogs } from './AuditLogs';
import { Server as ServerIcon, FolderKanban, Plus, Settings, Users, FileText } from 'lucide-react';

interface AdminPanelProps {
  servers: Server[];
  projects: Project[];
  onAddServer: (server: Omit<Server, 'id' | 'status' | 'runningAppsCount' | 'lastChecked'>) => Promise<Server>;
  onUpdateServer: (id: string, updates: Partial<Server>) => Promise<Server>;
  onDeleteServer: (id: string) => Promise<void>;
  onAddProject: (project: Omit<Project, 'id' | 'createdAt'>) => Promise<Project>;
  onUpdateProject: (id: string, updates: Partial<Project>) => Promise<Project>;
  onDeleteProject: (id: string) => Promise<void>;
}

export function AdminPanel({
  servers,
  projects,
  onAddServer,
  onUpdateServer,
  onDeleteServer,
  onAddProject,
  onUpdateProject,
  onDeleteProject,
}: AdminPanelProps) {
  const [serverDialogOpen, setServerDialogOpen] = useState(false);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<Server | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);

  const handleAddServer = () => {
    setEditingServer(null);
    setServerDialogOpen(true);
  };

  const handleEditServer = (server: Server) => {
    setEditingServer(server);
    setServerDialogOpen(true);
  };

  const handleAddProject = () => {
    setEditingProject(null);
    setProjectDialogOpen(true);
  };

  const handleEditProject = (project: Project) => {
    setEditingProject(project);
    setProjectDialogOpen(true);
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          Admin Panel
        </CardTitle>
        <CardDescription>
          Manage infrastructure, users, and view audit logs
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="infrastructure" className="w-full">
          <div className="mb-4 p-2 bg-yellow-100 border border-yellow-300 rounded text-sm">
            Debug: Admin Panel Tabs - You should see 4 tabs below
          </div>
          <TabsList className="grid w-full grid-cols-4 h-auto p-1 bg-muted rounded-lg">
            <TabsTrigger value="infrastructure" className="text-xs px-3 py-2">Infrastructure</TabsTrigger>
            <TabsTrigger value="users" className="text-xs px-3 py-2">Users</TabsTrigger>
            <TabsTrigger value="audit" className="text-xs px-3 py-2">Audit Logs</TabsTrigger>
            <TabsTrigger value="settings" className="text-xs px-3 py-2">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="infrastructure" className="mt-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Servers Management */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <ServerIcon className="h-5 w-5" />
                        Servers
                      </CardTitle>
                      <CardDescription>Manage your application servers</CardDescription>
                    </div>
                    <Button onClick={handleAddServer} size="sm" className="bg-indigo-600 hover:bg-indigo-700">
                      <Plus className="h-4 w-4 mr-2" />
                      Add Server
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {servers.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      No servers configured yet. Add your first server to get started.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {servers.map((server) => (
                        <div
                          key={server.id}
                          className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span>{server.name}</span>
                              <Badge
                                variant="outline"
                                className={
                                  server.status === 'online'
                                    ? 'border-green-500 text-green-500'
                                    : 'border-red-500 text-red-500'
                                }
                              >
                                {server.status}
                              </Badge>
                            </div>
                            <div className="text-muted-foreground">{server.address}</div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEditServer(server)}
                            className="h-8 w-8"
                          >
                            <Settings className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Projects Management */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <FolderKanban className="h-5 w-5" />
                        Projects
                      </CardTitle>
                      <CardDescription>Organize apps into projects</CardDescription>
                    </div>
                    <Button onClick={handleAddProject} size="sm" className="bg-indigo-600 hover:bg-indigo-700">
                      <Plus className="h-4 w-4 mr-2" />
                      Add Project
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {projects.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      No projects created yet. Add your first project to organize your apps.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {projects.map((project) => (
                        <div
                          key={project.id}
                          className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        >
                          <div className="flex-1">
                            <div className="mb-1">{project.name}</div>
                            {project.description && (
                              <div className="text-muted-foreground">{project.description}</div>
                            )}
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEditProject(project)}
                            className="h-8 w-8"
                          >
                            <Settings className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="users" className="mt-6">
            <UserManagement />
          </TabsContent>

          <TabsContent value="audit" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Audit Logs
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center py-8 text-muted-foreground">
                  Audit logs functionality is being loaded...
                  <br />
                  <Button
                    variant="outline"
                    className="mt-4"
                    onClick={() => window.location.reload()}
                  >
                    Refresh Page
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="settings" className="mt-6">
            <div className="text-center py-8 text-muted-foreground">
              System settings coming soon...
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>

      {/* Dialogs */}
      <ServerManagementDialog
        open={serverDialogOpen}
        onOpenChange={setServerDialogOpen}
        server={editingServer}
        onSave={onAddServer}
        onUpdate={onUpdateServer}
        onDelete={onDeleteServer}
      />

      <ProjectManagementDialog
        open={projectDialogOpen}
        onOpenChange={setProjectDialogOpen}
        project={editingProject}
        onSave={onAddProject}
        onUpdate={onUpdateProject}
        onDelete={onDeleteProject}
      />
    </Card>
  );
}
