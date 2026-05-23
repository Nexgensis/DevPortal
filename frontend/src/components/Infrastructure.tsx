import { useState } from 'react';
import { Server, Project } from '../types/app';
import { ServerManagementDialog } from './ServerManagementDialog';
import { ProjectManagementDialog } from './ProjectManagementDialog';
import { Server as ServerIcon, FolderKanban, Plus, MoreVertical, Settings, Database } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from './ui/dropdown-menu';
import { GlassCard } from './ui/glass-card';
import { AccentButton } from './ui/accent-button';
import { StatusBadge } from './ui/status-badge';

interface InfrastructureProps {
  servers: Server[];
  projects: Project[];
  onAddServer: (server: Omit<Server, 'id' | 'status' | 'runningAppsCount' | 'lastChecked'>) => Promise<Server>;
  onUpdateServer: (id: string, updates: Partial<Server>) => Promise<Server>;
  onDeleteServer: (id: string) => Promise<void>;
  onAddProject: (project: Omit<Project, 'id' | 'createdAt'>) => Promise<Project>;
  onUpdateProject: (id: string, updates: Partial<Project>) => Promise<Project>;
  onDeleteProject: (id: string) => Promise<void>;
  onPostgresBackup: (server: Server) => void;
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
  onPostgresBackup,
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
        <GlassCard>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
                <ServerIcon className="h-6 w-6" />
                Server Connections
              </h2>
              <p className="text-sm text-slate-600 mt-1">
                Manage SSH connections to your servers
              </p>
            </div>
            <AccentButton onClick={handleAddServer} variant="lime">
              <Plus className="h-4 w-4" />
              Add Server
            </AccentButton>
          </div>

          {servers.length === 0 ? (
            <div className="text-center py-12 px-4 rounded-2xl border border-dashed border-black/6 bg-black/3">
              <div className="h-20 w-20 rounded-2xl glass-card flex items-center justify-center mx-auto mb-4">
                <ServerIcon className="h-12 w-12 text-slate-500" />
              </div>
              <p className="text-slate-600 mb-4">No servers configured yet</p>
              <AccentButton onClick={handleAddServer} variant="ghost">
                <Plus className="h-4 w-4" />
                Add Your First Server
              </AccentButton>
            </div>
          ) : (
            <div className="space-y-2">
              {servers.map((server) => (
                <div
                  key={server.id}
                  className="glass-card glass-hover flex items-center gap-4 p-4"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="truncate font-medium text-slate-900">{server.name}</span>
                      <StatusBadge status={server.status === 'online' ? 'online' : 'offline'} />
                    </div>
                    <div className="text-sm text-slate-600">{server.address}</div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="h-9 w-9 rounded-xl bg-black/3 border border-black/8 hover:bg-black/6 flex items-center justify-center transition-colors flex-shrink-0 focus-ring-cyan backdrop-blur-md text-slate-700"
                        aria-label="More options"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48 z-[100] glass-card-strong border-0 p-1">
                      <DropdownMenuItem
                        className="cursor-pointer rounded-lg focus:bg-[var(--accent-cyan)]/20"
                        onSelect={(e) => {
                          e.preventDefault();
                          handleEditServer(server);
                        }}
                      >
                        <Settings className="h-4 w-4 mr-2" />
                        Edit Server
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="cursor-pointer rounded-lg focus:bg-[var(--accent-cyan)]/20"
                        onSelect={(e) => {
                          e.preventDefault();
                          onPostgresBackup(server);
                        }}
                      >
                        <Database className="h-4 w-4 mr-2" />
                        Database Dump
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          )}
        </GlassCard>

        {/* Project Organization Section */}
        <GlassCard>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
                <FolderKanban className="h-6 w-6" />
                Project Organization
              </h2>
              <p className="text-sm text-slate-600 mt-1">
                Group applications into logical projects
              </p>
            </div>
            <AccentButton onClick={handleAddProject} variant="lime">
              <Plus className="h-4 w-4" />
              Add Project
            </AccentButton>
          </div>

          {projects.length === 0 ? (
            <div className="text-center py-12 px-4 rounded-2xl border border-dashed border-black/6 bg-black/3">
              <div className="h-20 w-20 rounded-2xl glass-card flex items-center justify-center mx-auto mb-4">
                <FolderKanban className="h-12 w-12 text-slate-500" />
              </div>
              <p className="text-slate-600 mb-4">No projects created yet</p>
              <AccentButton onClick={handleAddProject} variant="ghost">
                <Plus className="h-4 w-4" />
                Create Your First Project
              </AccentButton>
            </div>
          ) : (
            <div className="space-y-2">
              {projects.map((project) => (
                <div
                  key={project.id}
                  className="glass-card glass-hover flex items-center gap-4 p-4"
                >
                  <div className="flex-1 min-w-0">
                    <div className="mb-0.5 truncate font-medium text-slate-900">{project.name}</div>
                    {project.description && (
                      <div className="text-sm text-slate-600 truncate">{project.description}</div>
                    )}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="h-9 w-9 rounded-xl bg-black/3 border border-black/8 hover:bg-black/6 flex items-center justify-center transition-colors flex-shrink-0 focus-ring-cyan backdrop-blur-md text-slate-700"
                        aria-label="More options"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48 z-[100] glass-card-strong border-0 p-1">
                      <DropdownMenuItem
                        className="cursor-pointer rounded-lg focus:bg-[var(--accent-cyan)]/20"
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
        </GlassCard>
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
