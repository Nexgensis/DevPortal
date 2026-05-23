import { Server, LogOut, Shield, Users, FileText, Database, FolderKanban } from 'lucide-react';

type ActiveView = 'applications' | 'infrastructure' | 'users' | 'audit-logs' | 'database-dump';

interface SidebarProps {
  activeView: ActiveView;
  onNavigate: (view: ActiveView) => void;
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

  const handleNavigate = (view: ActiveView) => {
    onNavigate(view);
  };

  return (
    <aside className="w-64 h-screen sticky top-0 flex-shrink-0 flex flex-col text-white">
      {/* Logo */}
      <div className="px-6 py-7 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-7 w-7 rounded-lg flex items-center justify-center bg-[var(--accent-pink)] text-[var(--ink)]">
            <Server className="h-4 w-4" />
          </div>
          <span className="text-2xl font-semibold tracking-tight text-white">DevOps</span>
        </div>
      </div>

      {/* Main Menu — active item extends to the sidebar's right edge and merges with the main panel */}
      <div className="flex-1 pl-4">
        <nav className="space-y-1">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            return (
              <div key={item.id} className="relative">
                {/* Top curve carved into sidebar above the active pill */}
                {isActive && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute right-0 bottom-full h-3 w-3"
                    style={{
                      background:
                        'radial-gradient(circle at top left, var(--sidebar-bg) 12px, var(--canvas) 12px)',
                    }}
                  />
                )}
                <button
                  onClick={() => handleNavigate(item.id)}
                  className={`relative w-full flex items-center gap-3 pl-5 pr-4 py-3.5 text-base font-medium transition-colors duration-150 focus:outline-none ${
                    isActive
                      ? 'bg-[var(--canvas)] text-[var(--ink)] rounded-l-xl rounded-r-none'
                      : 'text-white/65 hover:bg-white/5 hover:text-white mr-4 rounded-xl'
                  }`}
                >
                  <Icon className={`h-5 w-5 ${isActive ? 'text-[var(--accent-pink)]' : ''}`} />
                  <span>{item.label}</span>
                </button>
                {/* Bottom curve carved into sidebar below the active pill */}
                {isActive && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute right-0 top-full h-3 w-3"
                    style={{
                      background:
                        'radial-gradient(circle at bottom left, var(--sidebar-bg) 12px, var(--canvas) 12px)',
                    }}
                  />
                )}
              </div>
            );
          })}
        </nav>
      </div>

      {/* User Info */}
      <div className="px-4 pb-4 pt-2 flex-shrink-0">
        <div className="flex items-center gap-3 rounded-2xl bg-white/5 border border-white/10 p-3.5 mb-3">
          <div className="h-10 w-10 rounded-xl bg-[var(--accent-pink)] flex items-center justify-center flex-shrink-0">
            <Shield className="h-5 w-5 text-[var(--ink)]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="truncate text-base font-semibold text-white">{username}</p>
            <p className="text-xs text-white/55">{isAdmin ? 'Administrator' : 'User'}</p>
          </div>
        </div>
        <button
          onClick={onLogout}
          className="w-full flex items-center justify-center gap-2 h-11 rounded-full text-base font-medium text-white/70 hover:bg-white/5 hover:text-white transition-colors"
        >
          <LogOut className="h-5 w-5" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
