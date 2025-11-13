import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Server, Project } from '../types/app';
import { ServerManagementDialog } from './ServerManagementDialog';
import { ProjectManagementDialog } from './ProjectManagementDialog';
import { Server as ServerIcon, FolderKanban, Plus, MoreVertical, Settings } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

interface InfrastructureProps {
  servers: Server[];
  projects: Project[];
  onAddServer: (server: Omit<Server, 'id' | 'status' | 'runningAppsCount' | 'lastChecked'>) => Promise<Server>;
  onUpdateServer: (id: string, updates: Partial<Server>) => Promise<Server>;
  onDeleteServer: (id: string) => Promise<void>;
  onAddProject: (project: Omit<Project, 'id' | 'createdAt'>) => Promise<Project>;
  onUpdateProject: (id: string, updates: Partial<Project>) => Promise<Project>;
  onDeleteProject: (id: string) => Promise<void>;
}

export function Infrastructure({
  servers,
  projects,
  onAddServer,
  onUpdateServer,
  onDeleteServer,
  onAddProject,
  onUpdateProject,
  onDeleteProject,
}: InfrastructureProps) {
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
      <div className="space-y-8">
        {/* Server Connections Section */}
        <div className="bento-card">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="flex items-center gap-2">
                <ServerIcon className="h-6 w-6" />
                Server Connections
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Manage SSH connections to your servers
              </p>
            </div>
            <Button 
              onClick={handleAddServer} 
              className="bg-accent hover:bg-accent/90 text-accent-foreground border-2 border-black rounded-lg h-11 px-6"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Server
            </Button>
          </div>
          
          {servers.length === 0 ? (
            <div className="text-center py-12 px-4 bg-secondary/30 rounded-xl border-2 border-dashed border-black/10">
              <div className="h-20 w-20 rounded-xl bg-white border-2 border-black/10 flex items-center justify-center mx-auto mb-4">
                <ServerIcon className="h-10 w-10 text-muted-foreground/60" />
              </div>
              <p className="text-muted-foreground mb-4">No servers configured yet</p>
              <Button onClick={handleAddServer} variant="outline" className="border-2 border-black rounded-lg">
                <Plus className="h-4 w-4 mr-2" />
                Add Your First Server
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {servers.map((server) => (
                <div
                  key={server.id}
                  className="flex items-center gap-4 p-4 bg-white rounded-lg hover:bg-secondary/30 transition-all border-2 border-black/5 hover:border-black/10"
                >
                  <div
                    className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${
                      server.status === 'online' ? 'bg-[#22C55E]' : 'bg-[#EF4444]'
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="truncate">{server.name}</span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
                          server.status === 'online'
                            ? 'bg-[#22C55E]/10 text-[#22C55E]'
                            : 'bg-[#EF4444]/10 text-[#EF4444]'
                        }`}
                      >
                        {server.status}
                      </span>
                    </div>
                    <div className="text-sm text-muted-foreground">{server.address}</div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="h-9 w-9 rounded-lg hover:bg-gray-100 border-2 border-transparent hover:border-gray-300 flex items-center justify-center transition-all flex-shrink-0"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48 z-[100] bg-white shadow-lg border-2">
                      <DropdownMenuItem 
                        className="cursor-pointer hover:bg-gray-100"
                        onSelect={(e) => {
                          e.preventDefault();
                          handleEditServer(server);
                        }}
                      >
                        <Settings className="h-4 w-4 mr-2" />
                        Edit Server
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Project Organization Section */}
        <div className="bento-card">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="flex items-center gap-2">
                <FolderKanban className="h-6 w-6" />
                Project Organization
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Group applications into logical projects
              </p>
            </div>
            <Button 
              onClick={handleAddProject} 
              className="bg-accent hover:bg-accent/90 text-accent-foreground border-2 border-black rounded-lg h-11 px-6"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Project
            </Button>
          </div>
          
          {projects.length === 0 ? (
            <div className="text-center py-12 px-4 bg-secondary/30 rounded-xl border-2 border-dashed border-black/10">
              <div className="h-20 w-20 rounded-xl bg-white border-2 border-black/10 flex items-center justify-center mx-auto mb-4">
                <FolderKanban className="h-10 w-10 text-muted-foreground/60" />
              </div>
              <p className="text-muted-foreground mb-4">No projects created yet</p>
              <Button onClick={handleAddProject} variant="outline" className="border-2 border-black rounded-lg">
                <Plus className="h-4 w-4 mr-2" />
                Create Your First Project
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {projects.map((project) => (
                <div
                  key={project.id}
                  className="flex items-center gap-4 p-4 bg-white rounded-lg hover:bg-secondary/30 transition-all border-2 border-black/5 hover:border-black/10"
                >
                  <div className="flex-1 min-w-0">
                    <div className="mb-0.5 truncate">{project.name}</div>
                    {project.description && (
                      <div className="text-sm text-muted-foreground truncate">{project.description}</div>
                    )}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="h-9 w-9 rounded-lg hover:bg-gray-100 border-2 border-transparent hover:border-gray-300 flex items-center justify-center transition-all flex-shrink-0"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48 z-[100] bg-white shadow-lg border-2">
                      <DropdownMenuItem 
                        className="cursor-pointer hover:bg-gray-100"
                        onSelect={(e) => {
                          e.preventDefault();
                          handleEditProject(project);
                        }}
                      >
                        <Settings className="h-4 w-4 mr-2" />
                        Edit Project
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

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
