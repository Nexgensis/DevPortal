import { useState, useEffect } from 'react';
import { Play, Square, Clock, Settings, Edit2, Check, X, ExternalLink, Server as ServerIcon, Globe, MoreVertical, Database } from 'lucide-react';
import { App, Server, Project } from '../types/app';
import { toast } from 'sonner@2.0.3';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { AccentButton } from './ui/accent-button';
import { StatusBadge } from './ui/status-badge';

interface AppCardProps {
  app: App;
  server?: Server;
  project?: Project;
  onUpdateApp: (id: string, updates: Partial<App>) => Promise<void>;
  onStartApp: (id: string, timeoutMinutes: number) => Promise<any>;
  onStopApp: (id: string) => Promise<any>;
  onEditApp: (app: App) => void;
  onPostgresBackup: (server: Server) => void;
  isAdmin: boolean;
}

const TIMEOUT_OPTIONS = [
  { value: '5', label: '5 min' },
  { value: '10', label: '10 min' },
  { value: '15', label: '15 min' },
  { value: '30', label: '30 min' },
  { value: '60', label: '1 hour' },
  { value: '120', label: '2 hours' },
  { value: '180', label: '3 hours' },
  { value: '240', label: '4 hours' },
  { value: '360', label: '6 hours' },
  { value: '480', label: '8 hours' },
  { value: '720', label: '12 hours' },
  { value: '1440', label: '24 hours' },
  { value: '0', label: 'Infinite' },
];

export function AppCard({ app, server, project, onUpdateApp, onStartApp, onStopApp, onEditApp, onPostgresBackup, isAdmin }: AppCardProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [isEditingTimeout, setIsEditingTimeout] = useState(false);
  const [newTimeout, setNewTimeout] = useState((app.autoStopTimeout ?? 60).toString());

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
      if (result.app_url) {
        setTimeout(() => {
          window.open(result.app_url, '_blank');
          toast.success(`Opening ${result.app_url} in new tab`);
        }, 1500);
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
    <div className="bento-card flex items-center gap-4 p-4 group">
      {/* Primary Name + Status */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="truncate font-medium text-slate-900">{app.name}</span>
          <StatusBadge status={app.status === 'running' ? 'running' : 'stopped'} />
        </div>

        {/* Secondary Info - Domain URL */}
        <a
          href={formatDomain(app.domain)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-slate-600 hover:text-slate-900 hover:underline truncate flex items-center gap-1.5 w-fit max-w-full"
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
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Clock className="h-4 w-4" />
          {isEditingTimeout ? (
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <Select value={newTimeout} onValueChange={setNewTimeout}>
                <SelectTrigger className="h-8 w-[120px] text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEOUT_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleUpdateTimeout();
                }}
                className="h-7 w-7 rounded-md flex items-center justify-center bg-[var(--accent-lime)]/30 text-emerald-300 hover:bg-[var(--accent-lime)]/50 transition-colors focus-ring-cyan"
                aria-label="Save timeout"
              >
                <Check className="h-4 w-4" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleCancelTimeout();
                }}
                className="h-7 w-7 rounded-md flex items-center justify-center bg-[var(--accent-destructive)]/15 text-red-300 hover:bg-[var(--accent-destructive)]/30 transition-colors focus-ring-cyan"
                aria-label="Cancel"
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
              className="hover:text-slate-900 flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-black/4 transition-colors"
            >
              <span>Runtime: {formatRunTime(app.autoStopTimeout ?? 60)}</span>
              <Edit2 className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Server Status */}
        <div className="flex items-center gap-2">
          <ServerIcon className="h-4 w-4 text-slate-500" />
          <span className="text-sm text-slate-600">{server?.name || 'Unknown'}</span>
          {server && (
            <StatusBadge status={server.status === 'online' ? 'online' : 'offline'} />
          )}
        </div>

        {/* Auto-stop countdown */}
        {timeRemaining !== null && (
          <div className="flex items-center gap-2 rounded-full px-3 py-1.5 bg-[var(--accent-peach-soft)] border border-[color-mix(in_srgb,var(--accent-peach)_30%,transparent)] text-[var(--ink)]">
            <Clock className="h-4 w-4" />
            <span className="text-sm font-medium tabular-nums">{formatTime(timeRemaining)}</span>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {app.status === 'stopped' ? (
          <AccentButton
            onClick={(e) => {
              e.stopPropagation();
              handleStart();
            }}
            disabled={isLoading || !server || server.status !== 'online'}
            loading={isLoading}
            variant="lime"
            size="lg"
          >
            {!isLoading && <Play className="h-4 w-4" />}
            {isLoading ? 'Starting…' : 'Start'}
          </AccentButton>
        ) : (
          <AccentButton
            onClick={(e) => {
              e.stopPropagation();
              handleStop();
            }}
            disabled={isLoading || !server}
            loading={isLoading}
            variant="destructive"
            size="lg"
          >
            {!isLoading && <Square className="h-4 w-4" />}
            {isLoading ? 'Stopping…' : 'Stop'}
          </AccentButton>
        )}

        {/* Options Menu - Admin Only */}
        {isAdmin && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="h-10 w-10 rounded-xl bg-black/3 border border-black/8 hover:bg-black/6 flex items-center justify-center transition-colors focus-ring-cyan backdrop-blur-md text-slate-700"
                onClick={(e) => e.stopPropagation()}
                aria-label="More options"
              >
                <MoreVertical className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-48 z-[100] glass-card-strong border-0 p-1"
            >
              <DropdownMenuItem
                className="cursor-pointer rounded-lg focus:bg-[var(--accent-cyan)]/20"
                onSelect={(e) => {
                  e.preventDefault();
                  onEditApp(app);
                }}
              >
                <Settings className="h-4 w-4 mr-2" />
                Edit Application
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="cursor-pointer rounded-lg focus:bg-[var(--accent-cyan)]/20"
                onSelect={(e) => {
                  e.preventDefault();
                  if (server) onPostgresBackup(server);
                }}
                disabled={!server || server.status !== 'online'}
              >
                <Database className="h-4 w-4 mr-2" />
                Database Dump
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="cursor-pointer rounded-lg focus:bg-[var(--accent-cyan)]/20"
                onSelect={(e) => {
                  e.preventDefault();
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
