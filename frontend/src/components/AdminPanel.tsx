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
import { Server as ServerIcon, FolderKanban, Plus, Settings } from 'lucide-react';

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
    <>
      <Card className="mb-10 bg-white rounded-[2rem] shadow-[0_4px_24px_rgba(0,0,0,0.06)] border-0">
        <CardHeader className="pb-6">
          <div className="flex items-center gap-4 mb-2">
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center shadow-md">
              <Settings className="h-6 w-6 text-white" />
            </div>
            <div>
              <CardTitle className="mb-1">Administration</CardTitle>
              <CardDescription>
                Manage infrastructure, users, and system settings
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="infrastructure" className="w-full">
            <TabsList className="grid w-full grid-cols-4 h-auto p-2 bg-gradient-to-r from-secondary/80 to-secondary/40 rounded-3xl mb-8">
              <TabsTrigger value="infrastructure" className="rounded-2xl py-3 data-[state=active]:bg-white data-[state=active]:shadow-md">Infrastructure</TabsTrigger>
              <TabsTrigger value="users" className="rounded-2xl py-3 data-[state=active]:bg-white data-[state=active]:shadow-md">Users</TabsTrigger>
              <TabsTrigger value="audit" className="rounded-2xl py-3 data-[state=active]:bg-white data-[state=active]:shadow-md">Audit Logs</TabsTrigger>
              <TabsTrigger value="settings" className="rounded-2xl py-3 data-[state=active]:bg-white data-[state=active]:shadow-md">Settings</TabsTrigger>
            </TabsList>

            <TabsContent value="infrastructure" className="mt-0">
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                {/* Servers Management */}
                <div>
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <h3 className="text-foreground mb-1 flex items-center gap-2">
                        <ServerIcon className="h-5 w-5" />
                        Server Connections
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        Manage SSH connections to your servers
                      </p>
                    </div>
                    <Button onClick={handleAddServer} size="sm" className="bg-accent hover:bg-accent/90 text-accent-foreground rounded-full px-6 shadow-sm">
                      <Plus className="h-4 w-4 mr-2" />
                      Add Server
                    </Button>
                  </div>
                  
                  <div className="bg-secondary/30 rounded-2xl p-6">
                    {servers.length === 0 ? (
                      <div className="text-center py-12 px-4">
                        <div className="h-20 w-20 rounded-3xl bg-secondary/50 flex items-center justify-center mx-auto mb-4">
                          <ServerIcon className="h-10 w-10 text-muted-foreground/60" />
                        </div>
                        <p className="text-muted-foreground mb-4">No servers configured yet</p>
                        <Button onClick={handleAddServer} variant="outline" className="rounded-full">
                          <Plus className="h-4 w-4 mr-2" />
                          Add Your First Server
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {servers.map((server) => (
                          <div
                            key={server.id}
                            className="flex items-center justify-between p-5 bg-white rounded-2xl hover:shadow-md transition-all"
                          >
                            <div className="flex-1">
                              <div className="flex items-center gap-3 mb-2">
                                <span className="text-foreground">{server.name}</span>
                                <Badge
                                  variant="outline"
                                  className={`rounded-full px-3 ${
                                    server.status === 'online'
                                      ? 'border-green-500 text-green-600 bg-green-50'
                                      : 'border-red-500 text-red-600 bg-red-50'
                                  }`}
                                >
                                  {server.status}
                                </Badge>
                              </div>
                              <div className="text-sm text-muted-foreground">{server.address}</div>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleEditServer(server)}
                              className="h-10 w-10 rounded-2xl hover:bg-secondary"
                            >
                              <Settings className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Projects Management */}
                <div>
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <h3 className="text-foreground mb-1 flex items-center gap-2">
                        <FolderKanban className="h-5 w-5" />
                        Project Organization
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        Group applications into logical projects
                      </p>
                    </div>
                    <Button onClick={handleAddProject} size="sm" className="bg-accent hover:bg-accent/90 text-accent-foreground rounded-full px-6 shadow-sm">
                      <Plus className="h-4 w-4 mr-2" />
                      Add Project
                    </Button>
                  </div>
                  
                  <div className="bg-secondary/30 rounded-2xl p-6">
                    {projects.length === 0 ? (
                      <div className="text-center py-12 px-4">
                        <div className="h-20 w-20 rounded-3xl bg-secondary/50 flex items-center justify-center mx-auto mb-4">
                          <FolderKanban className="h-10 w-10 text-muted-foreground/60" />
                        </div>
                        <p className="text-muted-foreground mb-4">No projects created yet</p>
                        <Button onClick={handleAddProject} variant="outline" className="rounded-full">
                          <Plus className="h-4 w-4 mr-2" />
                          Create Your First Project
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {projects.map((project) => (
                          <div
                            key={project.id}
                            className="flex items-center justify-between p-5 bg-white rounded-2xl hover:shadow-md transition-all"
                          >
                            <div className="flex-1">
                              <div className="text-foreground mb-1">{project.name}</div>
                              {project.description && (
                                <div className="text-sm text-muted-foreground">{project.description}</div>
                              )}
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleEditProject(project)}
                              className="h-10 w-10 rounded-2xl hover:bg-secondary"
                            >
                              <Settings className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </TabsContent>
            
            <TabsContent value="users" className="mt-0">
              <UserManagement />
            </TabsContent>

            <TabsContent value="audit" className="mt-0">
              <AuditLogs />
            </TabsContent>

            <TabsContent value="settings" className="mt-0">
              <div className="text-center py-16 px-4">
                <div className="h-24 w-24 rounded-3xl bg-secondary/50 flex items-center justify-center mx-auto mb-4">
                  <Settings className="h-12 w-12 text-muted-foreground/60" />
                </div>
                <h3 className="text-foreground mb-2">System Settings</h3>
                <p className="text-muted-foreground mb-6">Configure system-wide settings and preferences</p>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

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
    </>
  );
}
