import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { App, Project, Server } from '../types/app';
import { Trash2, Globe } from 'lucide-react';
import { toast } from 'sonner@2.0.3';
import { AccentButton } from './ui/accent-button';

interface AppManagementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  app?: App | null;
  projects: Project[];
  servers: Server[];
  onSave: (app: Omit<App, 'id' | 'status' | 'startedAt'>) => Promise<App>;
  onUpdate: (id: string, updates: Partial<App>) => Promise<App>;
  onDelete: (id: string) => Promise<void>;
}

export function AppManagementDialog({
  open,
  onOpenChange,
  app,
  projects,
  servers,
  onSave,
  onUpdate,
  onDelete,
}: AppManagementDialogProps) {
  const [name, setName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [serverId, setServerId] = useState('');
  const [domain, setDomain] = useState('');
  const [cdPath, setCdPath] = useState('');
  const [autoStopTimeout, setAutoStopTimeout] = useState('60');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (app) {
      setName(app.name);
      setProjectId(app.projectId);
      setServerId(app.serverId);
      setDomain(app.domain);
      setCdPath(app.cdPath);
      setAutoStopTimeout(app.autoStopTimeout.toString());
    } else {
      setName('');
      setProjectId('');
      setServerId('');
      setDomain('');
      setCdPath('');
      setAutoStopTimeout('60');
    }
  }, [app, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name || !projectId || !serverId || !domain || !cdPath) {
      toast.error('All required fields must be filled');
      return;
    }

    if (!domain.includes('.')) {
      toast.error('Please enter a valid domain (e.g., pharma.qms.nexgensis.com)');
      return;
    }

    const timeout = parseInt(autoStopTimeout);
    if (isNaN(timeout) || timeout <= 0) {
      toast.error('Total run time must be a positive number');
      return;
    }

    const appData = {
      name,
      projectId,
      serverId,
      domain,
      cdPath,
      autoStopTimeout: timeout,
    };

    setIsSaving(true);
    try {
      if (app) {
        await onUpdate(app.id, appData);
        toast.success('App updated successfully');
      } else {
        await onSave(appData);
        toast.success('App added successfully');
      }
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = () => {
    if (app) {
      onDelete(app.id);
      toast.success('App deleted successfully');
      setShowDeleteDialog(false);
      onOpenChange(false);
    }
  };

  // Format domain display with protocol if needed
  const formatDomain = (dom: string) => {
    if (!dom) return '';
    if (dom.startsWith('http://') || dom.startsWith('https://')) {
      return dom;
    }
    return `https://${dom}`;
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              {app ? 'Edit App' : 'Add New App'}
            </DialogTitle>
            <DialogDescription>
              {app
                ? 'Update the app configuration below.'
                : 'Add a new application to your dashboard.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="grid gap-4 py-4 max-h-[60vh] overflow-y-auto pr-2">
              <div className="grid gap-2">
                <Label htmlFor="project" className="text-[var(--ink)]">
                  Project <span className="text-[var(--accent-destructive)]">*</span>
                </Label>
                <Select value={projectId} onValueChange={setProjectId} required>
                  <SelectTrigger id="project">
                    <SelectValue placeholder="Select a project" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.length === 0 ? (
                      <div className="p-2 text-[var(--ink-muted)] text-center text-sm">
                        No projects available
                      </div>
                    ) : (
                      projects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <p className="text-xs text-[var(--ink-muted)]">
                  The project this app belongs to (e.g., QMS, EBMR)
                </p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="name" className="text-[var(--ink)]">
                  App Name <span className="text-[var(--accent-destructive)]">*</span>
                </Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="QMS"
                  required
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="domain" className="text-[var(--ink)]">
                  Domain <span className="text-[var(--accent-destructive)]">*</span>
                </Label>
                <Input
                  id="domain"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder="pharma.qms.nexgensis.com"
                  required
                />
                <p className="text-xs text-[var(--ink-muted)]">
                  Opens automatically in a new tab when app starts
                  {domain && (
                    <span className="block mt-1 text-[var(--ink)] font-medium">
                      Will open: {formatDomain(domain)}
                    </span>
                  )}
                </p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="cdPath" className="text-[var(--ink)]">
                  Compose File Path <span className="text-[var(--accent-destructive)]">*</span>
                </Label>
                <Input
                  id="cdPath"
                  value={cdPath}
                  onChange={(e) => setCdPath(e.target.value)}
                  placeholder="/root/qms/qms"
                  required
                />
                <p className="text-xs text-[var(--ink-muted)]">
                  Full path to the directory containing docker-compose.yml
                </p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="server" className="text-[var(--ink)]">
                  Server <span className="text-[var(--accent-destructive)]">*</span>
                </Label>
                <Select value={serverId} onValueChange={setServerId} required>
                  <SelectTrigger id="server">
                    <SelectValue placeholder="Select a server" />
                  </SelectTrigger>
                  <SelectContent>
                    {servers.length === 0 ? (
                      <div className="p-2 text-[var(--ink-muted)] text-center text-sm">
                        No servers available
                      </div>
                    ) : (
                      servers.map((server) => (
                        <SelectItem key={server.id} value={server.id}>
                          {server.name} ({server.address})
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <p className="text-xs text-[var(--ink-muted)]">
                  The server where this app is hosted
                </p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="autoStopTimeout" className="text-[var(--ink)]">
                  Total Run Time (minutes) <span className="text-[var(--accent-destructive)]">*</span>
                </Label>
                <Input
                  id="autoStopTimeout"
                  type="number"
                  min="1"
                  value={autoStopTimeout}
                  onChange={(e) => setAutoStopTimeout(e.target.value)}
                  placeholder="60"
                  required
                />
                <p className="text-xs text-[var(--ink-muted)]">
                  App will automatically stop after this duration when started
                  {autoStopTimeout && parseInt(autoStopTimeout) >= 60 && (
                    <span className="block mt-1">
                      ({Math.floor(parseInt(autoStopTimeout) / 60)}h {parseInt(autoStopTimeout) % 60}m)
                    </span>
                  )}
                </p>
              </div>
            </div>
            <DialogFooter className="gap-2">
              {app && (
                <AccentButton
                  type="button"
                  variant="destructive"
                  onClick={() => setShowDeleteDialog(true)}
                  className="mr-auto"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </AccentButton>
              )}
              <AccentButton type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </AccentButton>
              <AccentButton
                type="submit"
                variant="lime"
                loading={isSaving}
                disabled={isSaving || projects.length === 0 || servers.length === 0}
              >
                {app ? 'Update' : 'Add'} App
              </AccentButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{app?.name}". This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
