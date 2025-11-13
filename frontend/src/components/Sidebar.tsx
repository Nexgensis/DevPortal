import { Home, Server, FolderKanban, Settings, LogOut, Shield, Users, FileText } from 'lucide-react';
import { Button } from './ui/button';
import joinHiveLogo from 'figma:asset/5007331c79bebd08d33e495d8e37bb9954759a00.png';

interface SidebarProps {
  activeView: 'applications' | 'infrastructure' | 'users' | 'audit-logs';
  onNavigate: (view: 'applications' | 'infrastructure' | 'users' | 'audit-logs') => void;
  onLogout: () => void;
  isAdmin: boolean;
  username: string;
}

export function Sidebar({ activeView, onNavigate, onLogout, isAdmin, username }: SidebarProps) {
  const menuItems = [
    { id: 'applications' as const, label: 'Applications', icon: FolderKanban },
    ...(isAdmin ? [
      { id: 'infrastructure' as const, label: 'Infrastructure', icon: Server },
      { id: 'users' as const, label: 'Users', icon: Users },
      { id: 'audit-logs' as const, label: 'Audit Logs', icon: FileText },
    ] : []),
  ];

  return (
    <div className="w-64 min-h-screen bg-white border-r-[3px] border-black flex flex-col">
      {/* Logo */}
      <div className="p-6 border-b-[3px] border-black">
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

      {/* Main Menu */}
      <div className="flex-1 p-4">
        <p className="text-xs text-muted-foreground px-3 mb-3">Main Menu</p>
        <nav className="space-y-2">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg border-2 transition-all ${
                  isActive
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

      {/* User Info */}
      <div className="p-4 border-t-[3px] border-black">
        <div className="bg-secondary rounded-lg border-2 border-black/10 p-4 mb-3">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-10 w-10 rounded-lg bg-accent border-2 border-black flex items-center justify-center">
              <Shield className="h-5 w-5 text-black" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="truncate">{username}</p>
              <p className="text-xs text-muted-foreground">
                {isAdmin ? 'Administrator' : 'User'}
              </p>
            </div>
          </div>
        </div>
        
        <Button
          onClick={onLogout}
          variant="outline"
          className="w-full border-2 border-black rounded-lg hover:bg-destructive hover:text-white hover:border-destructive"
        >
          <LogOut className="h-4 w-4 mr-2" />
          Logout
        </Button>
      </div>
    </div>
  );
}