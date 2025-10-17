import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Play, Square, Loader2, Clock, Settings, Edit2, Check, X, ExternalLink, Server as ServerIcon, Globe } from 'lucide-react';
import { App, Server, Project } from '../types/app';
import { executeDockerCompose } from '../lib/serverApi';
import { toast } from 'sonner@2.0.3';

interface AppCardProps {
  app: App;
  server?: Server;
  project?: Project;
  onUpdateApp: (id: string, updates: Partial<App>) => Promise<void>;
  onStartApp: (id: string, timeoutMinutes: number) => Promise<any>;
  onStopApp: (id: string) => Promise<any>;
  onEditApp: (app: App) => void;
  isAdmin: boolean;
}

export function AppCard({ app, server, project, onUpdateApp, onStartApp, onStopApp, onEditApp, isAdmin }: AppCardProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [isEditingTimeout, setIsEditingTimeout] = useState(false);
  const [newTimeout, setNewTimeout] = useState((app.autoStopTimeout ?? 60).toString());

  // Calculate time remaining
  useEffect(() => {
    if (app.status === 'running' && app.startedAt) {
      const updateTimer = () => {
        const elapsed = Date.now() - app.startedAt!;
        const timeout = app.autoStopTimeout ?? 60;
        const timeoutMs = timeout * 60 * 1000;
        const remaining = Math.max(0, timeoutMs - elapsed);
        setTimeRemaining(remaining);

        if (remaining === 0) {
          handleStop();
        }
      };

      updateTimer();
      const interval = setInterval(updateTimer, 1000);
      return () => clearInterval(interval);
    } else {
      setTimeRemaining(null);
    }
  }, [app.status, app.startedAt, app.autoStopTimeout]);

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const formatDomain = (domain: string) => {
    if (!domain) return '';
    if (domain.startsWith('http://') || domain.startsWith('https://')) {
      return domain;
    }
    return `https://${domain}`;
  };

  const handleStart = async () => {
    if (!server) {
      toast.error('Server not found for this app');
      return;
    }

    if (server.status === 'offline') {
      toast.error(`Server "${server.name}" is offline`);
      return;
    }

    setIsLoading(true);

    try {
      const result = await onStartApp(app.id, app.autoStopTimeout ?? 60);
      toast.success(`${app.name} started successfully`);

      // Open app domain in new tab if starting and app_url is provided
      if (result.app_url) {
        setTimeout(() => {
          window.open(result.app_url, '_blank');
          toast.success(`Opening ${result.app_url} in new tab`);
        }, 1500); // Small delay to let the app start
      } else if (app.domain) {
        setTimeout(() => {
          const url = formatDomain(app.domain);
          window.open(url, '_blank');
          toast.success(`Opening ${app.domain} in new tab`);
        }, 1500);
      }
    } catch (error) {
      console.error('Start app error:', error);
      toast.error(`Failed to start ${app.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleStop = async () => {
    if (!server) {
      toast.error('Server not found for this app');
      return;
    }

    setIsLoading(true);

    try {
      await onStopApp(app.id);
      toast.success(`${app.name} stopped successfully`);
    } catch (error) {
      console.error('Stop app error:', error);
      toast.error(`Failed to stop ${app.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateTimeout = async () => {
    const timeout = parseInt(newTimeout);
    if (isNaN(timeout) || timeout <= 0) {
      toast.error('Timeout must be a positive number');
      return;
    }

    try {
      await onUpdateApp(app.id, { autoStopTimeout: timeout });
      setIsEditingTimeout(false);
      toast.success('Total run time updated');
    } catch (error) {
      toast.error('Failed to update timeout');
    }
  };

  const handleCancelTimeout = () => {
    setNewTimeout(app.autoStopTimeout.toString());
    setIsEditingTimeout(false);
  };

  const formatRunTime = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) {
      return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }
    return `${mins}m`;
  };

  return (
    <Card className="relative overflow-hidden transition-all duration-300 hover:shadow-[0_8px_40px_rgba(0,0,0,0.12)] hover:-translate-y-1 bg-white rounded-[2rem] border-0 shadow-[0_4px_24px_rgba(0,0,0,0.06)]">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h3 className="text-foreground">{app.name}</h3>
              <Badge
                variant={app.status === 'running' ? 'default' : 'secondary'}
                className={`
                  transition-all duration-300 rounded-full px-3 py-1
                  ${app.status === 'running' 
                    ? 'bg-gradient-to-r from-green-500 to-green-400 hover:from-green-600 hover:to-green-500 animate-pulse text-white shadow-sm' 
                    : 'bg-secondary text-muted-foreground'
                  }
                `}
              >
                {app.status}
              </Badge>
            </div>
            <CardDescription>
              {project?.name || 'No Project'}
            </CardDescription>
          </div>
          {isAdmin && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onEditApp(app)}
              className="h-10 w-10 rounded-2xl hover:bg-secondary/50"
            >
              <Settings className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {/* App Details Group */}
          <div className="space-y-2.5">
            {/* Domain */}
            <div className="flex items-center gap-3 bg-gradient-to-r from-secondary/60 to-secondary/30 rounded-2xl px-4 py-3 group hover:from-secondary hover:to-secondary/60 transition-all">
              <Globe className="h-4 w-4 text-primary flex-shrink-0" />
              <a
                href={formatDomain(app.domain)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline truncate flex-1 transition-all"
              >
                {app.domain}
              </a>
              <ExternalLink className="h-3.5 w-3.5 text-primary opacity-60 group-hover:opacity-100 transition-opacity" />
            </div>

            {/* Server info */}
            <div className="flex items-center gap-3 bg-gradient-to-r from-secondary/60 to-secondary/30 rounded-2xl px-4 py-3">
              <ServerIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span className="text-muted-foreground truncate flex-1">
                {server?.name || 'Unknown Server'}
              </span>
              {server && (
                <Badge 
                  variant="outline" 
                  className={`rounded-full px-2.5 ${server.status === 'online' ? 'border-green-500 text-green-600 bg-green-50' : 'border-red-500 text-red-600 bg-red-50'}`}
                >
                  {server.status}
                </Badge>
              )}
            </div>
            
            {/* Total run time display/edit */}
            <div className="flex items-center gap-3 bg-secondary/50 rounded-2xl px-3 py-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              {isEditingTimeout ? (
                <div className="flex items-center gap-2 flex-1">
                  <Input
                    type="number"
                    min="1"
                    value={newTimeout}
                    onChange={(e) => setNewTimeout(e.target.value)}
                    className="h-8 w-20 rounded-xl"
                  />
                  <span className="text-muted-foreground">min</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 rounded-xl"
                    onClick={handleUpdateTimeout}
                  >
                    <Check className="h-4 w-4 text-green-600" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 rounded-xl"
                    onClick={handleCancelTimeout}
                  >
                    <X className="h-4 w-4 text-red-600" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-between flex-1">
                  <span className="text-muted-foreground">
                    Runtime: {formatRunTime(app.autoStopTimeout ?? 60)}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 rounded-xl hover:bg-white"
                    onClick={() => {
                      setIsEditingTimeout(true);
                      setNewTimeout((app.autoStopTimeout ?? 60).toString());
                    }}
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>
            
            {/* Countdown timer */}
            {timeRemaining !== null && (
              <div className="flex items-center gap-3 bg-gradient-to-r from-accent/20 to-accent/10 rounded-2xl px-4 py-3 border border-accent/20">
                <Clock className="h-4 w-4 text-accent-foreground animate-pulse flex-shrink-0" />
                <span className="text-accent-foreground">Auto-stop in {formatTime(timeRemaining)}</span>
              </div>
            )}
          </div>
          
          {/* Action Buttons */}
          <div className="flex gap-3 pt-2">
            {app.status === 'stopped' ? (
              <Button
                onClick={handleStart}
                disabled={isLoading || !server || server.status !== 'online'}
                className="flex-1 bg-gradient-to-r from-accent to-accent/90 hover:from-accent/90 hover:to-accent/80 text-accent-foreground rounded-full h-12 shadow-sm transition-all duration-200"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    <Play className="mr-2 h-5 w-5" />
                    Start Application
                  </>
                )}
              </Button>
            ) : (
              <Button
                onClick={handleStop}
                disabled={isLoading || !server}
                variant="destructive"
                className="flex-1 rounded-full h-12 shadow-sm transition-all duration-200"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Stopping...
                  </>
                ) : (
                  <>
                    <Square className="mr-2 h-5 w-5" />
                    Stop Application
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
