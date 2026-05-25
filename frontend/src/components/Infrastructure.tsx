import { useState } from 'react';
import { Server, Project } from '../types/app';
import { ServerManagementDialog } from './ServerManagementDialog';
import { ProjectManagementDialog } from './ProjectManagementDialog';
import { Server as ServerIcon, FolderKanban, Plus, MoreVertical, Settings, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from './ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
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
  const [serverToDelete, setServerToDelete] = useState<Server | null>(null);

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
              <h2 className="flex items-center gap-2 text-xl font-semibold text-[var(--ink)]">
                <ServerIcon className="h-6 w-6" />
                Server Connections
              </h2>
              <p className="text-sm text-[var(--ink-muted)] mt-1">
                Manage secure mTLS Docker API connections to your remote hosts
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
                <ServerIcon className="h-12 w-12 text-[var(--ink-muted)]" />
              </div>
              <p className="text-[var(--ink-muted)] mb-4">No servers configured yet</p>
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
                      <span className="truncate font-medium text-[var(--ink)]">{server.name}</span>
                      <StatusBadge status={server.status === 'online' ? 'online' : 'offline'} />
                    </div>
                    <div className="text-sm text-[var(--ink-muted)]">{server.address}</div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="h-9 w-9 rounded-xl bg-black/3 border border-black/8 hover:bg-black/6 flex items-center justify-center transition-colors flex-shrink-0 focus-ring-cyan backdrop-blur-md text-[var(--ink)]"
                        aria-label="More options"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48 z-[100] glass-card-strong border-0 p-1">
                      <DropdownMenuItem
                        className="cursor-pointer rounded-lg focus:bg-[var(--accent-cyan)]/20"
                        onSelect={() => handleEditServer(server)}
                      >
                        <Settings className="h-4 w-4 mr-2" />
                        Edit Server
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="cursor-pointer rounded-lg text-[var(--accent-destructive)] focus:bg-[var(--accent-destructive)]/10 focus:text-[var(--accent-destructive)]"
                        onSelect={() => setServerToDelete(server)}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete Server
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
              <h2 className="flex items-center gap-2 text-xl font-semibold text-[var(--ink)]">
                <FolderKanban className="h-6 w-6" />
                Project Organization
              </h2>
              <p className="text-sm text-[var(--ink-muted)] mt-1">
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
                <FolderKanban className="h-12 w-12 text-[var(--ink-muted)]" />
              </div>
              <p className="text-[var(--ink-muted)] mb-4">No projects created yet</p>
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
                    <div className="mb-0.5 truncate font-medium text-[var(--ink)]">{project.name}</div>
                    {project.description && (
                      <div className="text-sm text-[var(--ink-muted)] truncate">{project.description}</div>
                    )}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="h-9 w-9 rounded-xl bg-black/3 border border-black/8 hover:bg-black/6 flex items-center justify-center transition-colors flex-shrink-0 focus-ring-cyan backdrop-blur-md text-[var(--ink)]"
                        aria-label="More options"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48 z-[100] glass-card-strong border-0 p-1">
                      <DropdownMenuItem
                        className="cursor-pointer rounded-lg focus:bg-[var(--accent-cyan)]/20"
                        onSelect={() => handleEditProject(project)}
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

      <AlertDialog open={!!serverToDelete} onOpenChange={(open) => !open && setServerToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this server?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{serverToDelete?.name}" ({serverToDelete?.address}) and any applications
              assigned to it, removing them from the database. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (serverToDelete) onDeleteServer(serverToDelete.id);
                setServerToDelete(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
