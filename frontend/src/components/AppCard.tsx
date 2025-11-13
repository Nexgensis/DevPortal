import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Play, Square, Loader2, Clock, Settings, Edit2, Check, X, ExternalLink, Server as ServerIcon, Globe, MoreVertical } from 'lucide-react';
import { App, Server, Project } from '../types/app';
import { executeDockerCompose } from '../lib/serverApi';
import { toast } from 'sonner@2.0.3';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

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

  // Calculate time remaining using timerEndsAt for persistence
  useEffect(() => {
    if (app.status === 'running' && app.timerEndsAt) {
      const updateTimer = () => {
        const remaining = Math.max(0, app.timerEndsAt! - Date.now());
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
  }, [app.status, app.timerEndsAt]);

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
    if (isNaN(timeout) || timeout < 0) {
      toast.error('Invalid timeout value');
      return;
    }

    try {
      await onUpdateApp(app.id, { autoStopTimeout: timeout });
      setIsEditingTimeout(false);
      toast.success(timeout === 0 ? 'Runtime set to infinite' : 'Runtime updated');
    } catch (error) {
      toast.error('Failed to update runtime');
    }
  };

  const handleCancelTimeout = () => {
    setNewTimeout((app.autoStopTimeout ?? 60).toString());
    setIsEditingTimeout(false);
  };

  const formatRunTime = (minutes: number) => {
    if (minutes === 0) return 'Infinite';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) {
      return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }
    return `${mins}m`;
  };

  return (
    <div className="flex items-center gap-4 p-4 bg-white rounded-lg hover:bg-secondary/30 transition-all border-2 border-black/5 hover:border-black/10 group">
      {/* Status Indicator */}
      <div
        className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${app.status === 'running' ? 'bg-[#22C55E] animate-pulse' : 'bg-[#EF4444]'
          }`}
      />

      {/* Primary Name */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="truncate">{app.name}</span>
          <span
            className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${app.status === 'running'
              ? 'bg-[#22C55E]/10 text-[#22C55E]'
              : 'bg-[#EF4444]/10 text-[#EF4444]'
              }`}
          >
            {app.status}
          </span>
        </div>

        {/* Secondary Info - Domain URL */}
        <a
          href={formatDomain(app.domain)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-primary hover:underline truncate flex items-center gap-1.5 w-fit max-w-full"
          onClick={(e) => e.stopPropagation()}
        >
          <Globe className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="truncate">{app.domain}</span>
          <ExternalLink className="h-3 w-3 flex-shrink-0 opacity-60" />
        </a>
      </div>

      {/* Key Metrics */}
      <div className="flex items-center gap-4 flex-shrink-0">
        {/* Runtime - Editable */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="h-4 w-4" />
          {isEditingTimeout ? (
            <div className="flex items-center gap-2">
              <select
                value={newTimeout}
                onChange={(e) => setNewTimeout(e.target.value)}
                className="h-7 px-2 border border-gray-300 rounded text-sm"
                onClick={(e) => e.stopPropagation()}
              >
                <option value="5">5 min</option>
                <option value="10">10 min</option>
                <option value="15">15 min</option>
                <option value="30">30 min</option>
                <option value="60">1 hour</option>
                <option value="120">2 hours</option>
                <option value="180">3 hours</option>
                <option value="240">4 hours</option>
                <option value="360">6 hours</option>
                <option value="480">8 hours</option>
                <option value="720">12 hours</option>
                <option value="1440">24 hours</option>
                <option value="0">Infinite</option>
              </select>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleUpdateTimeout();
                }}
                className="text-green-600 hover:text-green-700"
              >
                <Check className="h-4 w-4" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleCancelTimeout();
                }}
                className="text-red-600 hover:text-red-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsEditingTimeout(true);
                setNewTimeout((app.autoStopTimeout ?? 60).toString());
              }}
              className="hover:text-foreground flex items-center gap-1"
            >
              <span>Runtime: {formatRunTime(app.autoStopTimeout ?? 60)}</span>
              <Edit2 className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Server Status */}
        <div className="flex items-center gap-2">
          <ServerIcon className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">{server?.name || 'Unknown'}</span>
          {server && (
            <span
              className={`text-xs px-2 py-0.5 rounded-full ${server.status === 'online'
                ? 'bg-[#22C55E]/10 text-[#22C55E]'
                : 'bg-[#EF4444]/10 text-[#EF4444]'
                }`}
            >
              {server.status}
            </span>
          )}
        </div>

        {/* Auto-stop countdown (when running) */}
        {timeRemaining !== null && (
          <div className="flex items-center gap-2 bg-accent/10 rounded-lg px-3 py-1.5 border border-accent">
            <Clock className="h-4 w-4 text-accent-foreground animate-pulse" />
            <span className="text-sm text-accent-foreground">{formatTime(timeRemaining)}</span>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-3 flex-shrink-0">
        {app.status === 'stopped' ? (
          <Button
            onClick={(e) => {
              e.stopPropagation();
              handleStart();
            }}
            disabled={isLoading || !server || server.status !== 'online'}
            className="h-12 px-6 rounded-lg bg-accent hover:bg-accent/90 text-accent-foreground border-2 border-black"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                <span>Starting...</span>
              </>
            ) : (
              <>
                <Play className="h-5 w-5 mr-2" />
                <span>Start</span>
              </>
            )}
          </Button>
        ) : (
          <Button
            onClick={(e) => {
              e.stopPropagation();
              handleStop();
            }}
            disabled={isLoading || !server}
            className="h-12 px-6 rounded-lg bg-[#EF4444] hover:bg-[#EF4444]/90 text-white border-2 border-black"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                <span>Stopping...</span>
              </>
            ) : (
              <>
                <Square className="h-5 w-5 mr-2" />
                <span>Stop</span>
              </>
            )}
          </Button>
        )}

        {/* Options Menu - Admin Only */}
        {isAdmin && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="h-12 w-12 rounded-lg hover:bg-gray-100 border-2 border-transparent hover:border-gray-300"
              >
                <MoreVertical className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-48 z-50 bg-white"
              onPointerDownOutside={(e) => e.stopPropagation()}
              onInteractOutside={(e) => e.stopPropagation()}
            >
              <DropdownMenuItem
                className="cursor-pointer"
                onSelect={() => {
                  onEditApp(app);
                }}
              >
                <Settings className="h-4 w-4 mr-2" />
                Edit Application
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="cursor-pointer"
                onSelect={() => {
                  const url = formatDomain(app.domain);
                  window.open(url, '_blank');
                }}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Open in Browser
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
