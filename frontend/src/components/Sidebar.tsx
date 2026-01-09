import { Home, Server, FolderKanban, Settings, LogOut, Shield, Users, FileText, Database } from 'lucide-react';
import { Button } from './ui/button';

interface SidebarProps {
  activeView: 'applications' | 'infrastructure' | 'users' | 'audit-logs' | 'database-dump';
  onNavigate: (view: 'applications' | 'infrastructure' | 'users' | 'audit-logs' | 'database-dump') => void;
  onLogout: () => void;
  isAdmin: boolean;
  username: string;
}

export function Sidebar({ activeView, onNavigate, onLogout, isAdmin, username }: SidebarProps) {
  const menuItems = [
    { id: 'applications' as const, label: 'Applications', icon: FolderKanban },
    { id: 'database-dump' as const, label: 'Database Dump', icon: Database },
    ...(isAdmin ? [
      { id: 'infrastructure' as const, label: 'Infrastructure', icon: Server },
      { id: 'users' as const, label: 'Users', icon: Users },
      { id: 'audit-logs' as const, label: 'Audit Logs', icon: FileText },
    ] : []),
  ];

  return (
    <div className="w-64 h-screen bg-white border-r-[3px] border-black flex flex-col sticky top-0 flex-shrink-0">
      {/* Logo */}
      <div className="p-6 border-b-[3px] border-black flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 bg-accent border-2 border-black rounded-lg flex items-center justify-center">
            <Server className="h-6 w-6 text-black" />
          </div>
          <div>
            <h2 className="tracking-tight">DevOps</h2>
            <p className="text-xs text-muted-foreground">Dashboard</p>
          </div>
        </div>
      </div>

      {/* Main Menu - Scrollable inside the sidebar if needed */}
      <div className="flex-1 p-4 overflow-y-auto">
        <p className="text-xs text-muted-foreground px-3 mb-3">Main Menu</p>
        <nav className="space-y-2">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;

            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg border-2 transition-all ${isActive
                  ? 'bg-black text-white border-black'
                  : 'bg-white text-black border-transparent hover:bg-secondary hover:border-black/10'
                  }`}
              >
                <Icon className="h-5 w-5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* User Info - Sticky at bottom of the sidebar */}
      <div className="p-4 border-t-[3px] border-black flex-shrink-0 bg-white">
        <div className="bg-secondary rounded-lg border-2 border-black/10 p-4 mb-3">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-10 w-10 rounded-lg bg-accent border-2 border-black flex items-center justify-center">
              <Shield className="h-5 w-5 text-black" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="truncate font-medium">{username}</p>
              <p className="text-xs text-muted-foreground">
                {isAdmin ? 'Administrator' : 'User'}
              </p>
            </div>
          </div>
        </div>

        <Button
          onClick={onLogout}
          variant="outline"
          className="w-full border-2 border-black rounded-lg hover:bg-destructive hover:text-white hover:border-destructive font-medium"
        >
          <LogOut className="h-4 w-4 mr-2" />
          Logout
        </Button>
      </div>
    </div>
  );
}