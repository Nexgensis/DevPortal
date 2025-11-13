import { Server, App, Project } from '../types/app';
import { Button } from './ui/button';
import { Server as ServerIcon, FolderKanban, Plus, Users, FileText, Activity } from 'lucide-react';

interface DashboardOverviewProps {
  servers: Server[];
  apps: App[];
  projects: Project[];
  onAddServer: () => void;
  onAddProject: () => void;
  onNavigateToAdministration: () => void;
  isAdmin: boolean;
}

export function DashboardOverview({
  servers,
  apps,
  projects,
  onAddServer,
  onAddProject,
  onNavigateToAdministration,
  isAdmin,
}: DashboardOverviewProps) {
  const onlineServers = servers.filter(s => s.status === 'online').length;
  const runningApps = apps.filter(a => a.status === 'running').length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
      {/* Server Connections Widget */}
      <div className="bento-card">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-black flex items-center justify-center">
              <ServerIcon className="h-5 w-5 text-white" />
            </div>
            <h3>Server Connections</h3>
          </div>
          {isAdmin && (
            <Button
              onClick={onAddServer}
              size="sm"
              className="bg-accent hover:bg-accent/90 text-accent-foreground border-2 border-black rounded-lg h-9 px-4"
            >
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          )}
        </div>

        <div className="space-y-3">
          {servers.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground mb-3">No servers configured</p>
              {isAdmin && (
                <Button
                  onClick={onAddServer}
                  variant="outline"
                  size="sm"
                  className="border-2 border-black rounded-lg"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Server
                </Button>
              )}
            </div>
          ) : (
            <>
              {servers.slice(0, 3).map((server) => (
                <div
                  key={server.id}
                  className="flex items-center justify-between p-3 bg-secondary rounded-lg border-2 border-black/10"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <div
                        className={`h-2 w-2 rounded-full ${
                          server.status === 'online' ? 'bg-[#22C55E]' : 'bg-[#EF4444]'
                        }`}
                      />
                      <span className="truncate">{server.name}</span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{server.address}</p>
                  </div>
                  <span
                    className={`text-xs px-2 py-1 rounded ${
                      server.status === 'online'
                        ? 'bg-[#22C55E]/10 text-[#22C55E]'
                        : 'bg-[#EF4444]/10 text-[#EF4444]'
                    }`}
                  >
                    {server.status}
                  </span>
                </div>
              ))}
              {servers.length > 3 && (
                <Button
                  onClick={onNavigateToAdministration}
                  variant="ghost"
                  size="sm"
                  className="w-full border-2 border-black/10 rounded-lg"
                >
                  View All ({servers.length})
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Project Organization Widget */}
      <div className="bento-card">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-black flex items-center justify-center">
              <FolderKanban className="h-5 w-5 text-white" />
            </div>
            <h3>Projects</h3>
          </div>
          {isAdmin && (
            <Button
              onClick={onAddProject}
              size="sm"
              className="bg-accent hover:bg-accent/90 text-accent-foreground border-2 border-black rounded-lg h-9 px-4"
            >
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          )}
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-accent/10 rounded-lg border-2 border-accent">
            <span>Total Projects</span>
            <span className="text-2xl">{projects.length}</span>
          </div>

          {projects.length > 0 ? (
            <div className="space-y-2">
              {projects.slice(0, 3).map((project) => (
                <div
                  key={project.id}
                  className="p-3 bg-secondary rounded-lg border-2 border-black/10"
                >
                  <p className="truncate">{project.name}</p>
                  {project.description && (
                    <p className="text-xs text-muted-foreground truncate mt-1">
                      {project.description}
                    </p>
                  )}
                </div>
              ))}
              {projects.length > 3 && (
                <Button
                  onClick={onNavigateToAdministration}
                  variant="ghost"
                  size="sm"
                  className="w-full border-2 border-black/10 rounded-lg"
                >
                  View All ({projects.length})
                </Button>
              )}
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground">No projects created</p>
            </div>
          )}
        </div>
      </div>

      {/* Applications Status Widget */}
      <div className="bento-card">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-10 w-10 rounded-lg bg-black flex items-center justify-center">
            <Activity className="h-5 w-5 text-white" />
          </div>
          <h3>Application Status</h3>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-4 bg-secondary rounded-lg border-2 border-black/10 text-center">
              <div className="text-2xl mb-1">{apps.length}</div>
              <div className="text-xs text-muted-foreground">Total Apps</div>
            </div>
            <div className="p-4 bg-[#22C55E]/10 rounded-lg border-2 border-[#22C55E]/30 text-center">
              <div className="text-2xl mb-1 text-[#22C55E]">{runningApps}</div>
              <div className="text-xs text-muted-foreground">Running</div>
            </div>
          </div>

          <div className="p-4 bg-secondary rounded-lg border-2 border-black/10">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm">Online Servers</span>
              <span className="text-sm">
                {onlineServers}/{servers.length}
              </span>
            </div>
            <div className="w-full bg-black/10 rounded-full h-2">
              <div
                className="bg-[#22C55E] h-2 rounded-full transition-all"
                style={{
                  width: servers.length > 0 ? `${(onlineServers / servers.length) * 100}%` : '0%',
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Administration Quick Links (Admin Only) */}
      {isAdmin && (
        <div className="bento-card lg:col-span-2 xl:col-span-1">
          <div className="flex items-center gap-3 mb-6">
            <div className="h-10 w-10 rounded-lg bg-black flex items-center justify-center">
              <Users className="h-5 w-5 text-white" />
            </div>
            <h3>Administration</h3>
          </div>

          <div className="space-y-3">
            <Button
              onClick={onNavigateToAdministration}
              variant="outline"
              className="w-full justify-start border-2 border-black rounded-lg h-12 hover:bg-accent hover:border-accent"
            >
              <Users className="h-4 w-4 mr-3" />
              Manage Users
            </Button>
            <Button
              onClick={onNavigateToAdministration}
              variant="outline"
              className="w-full justify-start border-2 border-black rounded-lg h-12 hover:bg-accent hover:border-accent"
            >
              <FileText className="h-4 w-4 mr-3" />
              View Audit Logs
            </Button>
            <Button
              onClick={onNavigateToAdministration}
              variant="outline"
              className="w-full justify-start border-2 border-black rounded-lg h-12 hover:bg-accent hover:border-accent"
            >
              <ServerIcon className="h-4 w-4 mr-3" />
              Infrastructure
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
