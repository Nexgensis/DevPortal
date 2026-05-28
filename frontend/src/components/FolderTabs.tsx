import { Settings, Database, ShieldCheck, Rocket } from 'lucide-react';
// TODO(applications): re-import `FolderKanban` when the Applications tab is re-enabled.
import type { LucideIcon } from 'lucide-react';

export type FolderView = 'applications' | 'database-dump' | 'security-scan' | 'running-apps' | 'config';

interface FolderDef {
  id: FolderView;
  label: string;
  icon: LucideIcon;
  color: string;
  adminOnly?: boolean;
}

// Each section is a folder with its own vivid tab color (file-folder inspired).
// Order: Database Dump first. Colors come from themed CSS vars (Google brand palette).
const FOLDERS: FolderDef[] = [
  { id: 'database-dump', label: 'Database Dump', icon: Database, color: 'var(--tab-db)' },
  // TODO(applications): re-enable when the Applications section is rebuilt.
  // { id: 'applications', label: 'Applications', icon: FolderKanban, color: 'var(--tab-apps)' },
  { id: 'running-apps', label: 'Running Apps', icon: Rocket, color: 'var(--tab-running)' },
  { id: 'security-scan', label: 'Security Scan', icon: ShieldCheck, color: 'var(--tab-scan)' },
  { id: 'config', label: 'Config', icon: Settings, color: 'var(--tab-users)', adminOnly: true },
];

interface FolderTabsProps {
  active: FolderView;
  onNavigate: (view: FolderView) => void;
  isAdmin: boolean;
}

export function FolderTabs({ active, onNavigate, isAdmin }: FolderTabsProps) {
  const folders = FOLDERS.filter((f) => !f.adminOnly || isAdmin);

  return (
    // Tabs sit IN FRONT of the panel (z-20 row) and melt into it via their flared
    // bases. They overlap horizontally (negative margin) like manila folders; the
    // active tab gets the highest z-index and the panel colour so its base vanishes.
    <div className="relative z-20 flex items-end">
      {folders.map((f, i) => {
        const Icon = f.icon;
        const isActive = f.id === active;
        return (
          <button
            key={f.id}
            onClick={() => onNavigate(f.id)}
            style={{
              // Active tab = card colour (melts into the card body + masks the top border).
              // Inactive tabs keep their own distinct colour.
              '--tab-color': isActive ? 'var(--card)' : f.color,
              // Strict left-to-right cascade; active jumps to the top of the stack.
              zIndex: isActive ? 50 : 10 - i,
              // Physically overlap: each tab's right tail tucks under the next.
              marginRight: i === folders.length - 1 ? 0 : '-30px',
            } as any}
            className={`folder-tab flex w-72 shrink-0 items-center justify-start gap-3 whitespace-nowrap pl-7 pr-16 text-lg focus:outline-none transition-all duration-200 ease-in-out ${
              isActive
                // Active: heavy editorial serif, high-contrast ink, tallest box.
                ? 'pt-10 pb-5 font-display font-bold text-[var(--ink)]'
                // Inactive: bold geometric sans, crisp white on the vivid colour.
                : 'pt-7 pb-5 font-sans font-semibold text-white opacity-95 hover:pt-9'
            }`}
          >
            <Icon className={`shrink-0 ${isActive ? 'h-6 w-6' : 'h-[22px] w-[22px]'}`} strokeWidth={isActive ? 2.25 : 2} />
            <span>{f.label}</span>
          </button>
        );
      })}
    </div>
  );
}
