import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Server as ServerIcon, Activity, RefreshCw } from 'lucide-react';
import { Server } from '../types/app';

interface ServerOverviewProps {
  servers: Server[];
  onRefresh: () => void;
  isRefreshing: boolean;
}

export function ServerOverview({ servers, onRefresh, isRefreshing }: ServerOverviewProps) {
  const onlineServers = servers.filter(s => s.status === 'online').length;
  const totalApps = servers.reduce((sum, s) => sum + s.runningAppsCount, 0);

  return (
    <div className="mb-10">
      {/* Section Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="h-10 w-10 rounded-2xl bg-green-50 flex items-center justify-center">
            <ServerIcon className="h-5 w-5 text-green-600" />
          </div>
          <h2 className="text-foreground">Infrastructure Status</h2>
        </div>
        <p className="text-muted-foreground ml-[52px]">
          Real-time monitoring of your servers and applications
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Online Servers KPI */}
        <div className="bg-white rounded-[2rem] shadow-[0_4px_24px_rgba(0,0,0,0.06)] p-8 transition-all hover:shadow-[0_6px_32px_rgba(0,0,0,0.08)]">
          <div className="flex items-start justify-between mb-6">
            <div>
              <div className="text-muted-foreground mb-1">Online Servers</div>
              <div className="flex items-baseline gap-3">
                <span className="text-5xl text-foreground">{onlineServers}</span>
                <span className="text-xl text-muted-foreground">/ {servers.length}</span>
              </div>
            </div>
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-green-50 to-green-100/50 flex items-center justify-center shadow-sm">
              <ServerIcon className="h-7 w-7 text-green-600" />
            </div>
          </div>
          <div className="h-2 bg-secondary rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-green-500 to-green-400 rounded-full transition-all duration-500"
              style={{ width: `${servers.length > 0 ? (onlineServers / servers.length) * 100 : 0}%` }}
            />
          </div>
        </div>

        {/* Total Running Apps KPI */}
        <div className="bg-white rounded-[2rem] shadow-[0_4px_24px_rgba(0,0,0,0.06)] p-8 transition-all hover:shadow-[0_6px_32px_rgba(0,0,0,0.08)]">
          <div className="flex items-start justify-between mb-6">
            <div>
              <div className="text-muted-foreground mb-1">Active Applications</div>
              <div className="flex items-baseline gap-3">
                <span className="text-5xl text-foreground">{totalApps}</span>
                <span className="text-xl text-muted-foreground">running</span>
              </div>
            </div>
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-accent/20 to-accent/10 flex items-center justify-center shadow-sm">
              <Activity className="h-7 w-7 text-accent-foreground" />
            </div>
          </div>
          <div className="text-sm text-muted-foreground">
            Across {servers.length} {servers.length === 1 ? 'server' : 'servers'}
          </div>
        </div>

        {/* Refresh Action Card */}
        <div className="bg-gradient-to-br from-white to-secondary/20 rounded-[2rem] shadow-[0_4px_24px_rgba(0,0,0,0.06)] p-8 flex flex-col items-center justify-center gap-4">
          <div className="text-center">
            <div className="text-muted-foreground mb-2">System Status</div>
            <div className="text-sm text-muted-foreground">Last updated just now</div>
          </div>
          <Button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="bg-primary hover:bg-primary/90 text-white rounded-full px-8 h-12 shadow-sm"
          >
            <RefreshCw className={`h-5 w-5 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh Status
          </Button>
        </div>
      </div>
    </div>
  );
}
