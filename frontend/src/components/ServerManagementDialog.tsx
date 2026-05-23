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
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Server } from '../types/app';
import { Trash2, Server as ServerIcon, Upload, Eye, EyeOff, Key } from 'lucide-react';
import { toast } from 'sonner@2.0.3';
import { AccentButton } from './ui/accent-button';

interface ServerManagementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server?: Server | null;
  onSave: (server: Omit<Server, 'id' | 'status' | 'runningAppsCount'>) => void;
  onUpdate: (id: string, updates: Partial<Server>) => void;
  onDelete: (id: string) => void;
}

export function ServerManagementDialog({
  open,
  onOpenChange,
  server,
  onSave,
  onUpdate,
  onDelete,
}: ServerManagementDialogProps) {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [sshUser, setSshUser] = useState('');
  const [sshPort, setSshPort] = useState('22');
  const [sshPrivateKey, setSshPrivateKey] = useState('');
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (server) {
      setName(server.name);
      setAddress(server.address);
      setSshUser(server.sshUser);
      setSshPort(server.sshPort.toString());
      setSshPrivateKey(''); // Never show existing private key
    } else {
      setName('');
      setAddress('');
      setSshUser('');
      setSshPort('22');
      setSshPrivateKey('');
    }
    setShowPrivateKey(false);
  }, [server, open]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        setSshPrivateKey(content);
        toast.success('SSH private key loaded from file');
      };
      reader.onerror = () => {
        toast.error('Failed to read file');
      };
      reader.readAsText(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name || !address) {
      toast.error('Server name and address are required');
      return;
    }

    if (!sshUser) {
      toast.error('SSH user is required');
      return;
    }

    if (!server && !sshPrivateKey) {
      toast.error('SSH private key is required');
      return;
    }

    const serverData: any = {
      name,
      address,
      sshUser,
      sshPort: parseInt(sshPort),
    };

    if (sshPrivateKey) {
      serverData.sshPrivateKey = sshPrivateKey;
    }

    setIsSaving(true);
    try {
      if (server) {
        await onUpdate(server.id, serverData);
        toast.success(sshPrivateKey ? 'Server and SSH key updated successfully' : 'Server updated successfully');
      } else {
        await onSave(serverData);
        toast.success('Server added successfully');
      }
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = () => {
    if (server) {
      onDelete(server.id);
      toast.success('Server deleted successfully');
      setShowDeleteDialog(false);
      onOpenChange(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ServerIcon className="h-5 w-5" />
              {server ? 'Edit Server' : 'Add New Server'}
            </DialogTitle>
            <DialogDescription>
              {server
                ? 'Update the server configuration below. Leave SSH private key empty to keep existing key.'
                : 'Add a new server where applications are hosted.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="grid gap-4 py-4 max-h-[60vh] overflow-y-auto pr-2">
              <div className="grid gap-2">
                <Label htmlFor="name" className="text-slate-700">
                  Server Name <span className="text-[var(--accent-destructive)]">*</span>
                </Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Production Server 1"
                  required
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="address" className="text-slate-700">
                  Server Address (IP or Hostname) <span className="text-[var(--accent-destructive)]">*</span>
                </Label>
                <Input
                  id="address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="192.168.1.100 or server.example.com"
                  required
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="sshUser" className="text-slate-700">
                  SSH User <span className="text-[var(--accent-destructive)]">*</span>
                </Label>
                <Input
                  id="sshUser"
                  value={sshUser}
                  onChange={(e) => setSshUser(e.target.value)}
                  placeholder="root"
                  required
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="sshPort" className="text-slate-700">
                  SSH Port <span className="text-[var(--accent-destructive)]">*</span>
                </Label>
                <Input
                  id="sshPort"
                  type="number"
                  value={sshPort}
                  onChange={(e) => setSshPort(e.target.value)}
                  placeholder="22"
                  required
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="sshPrivateKey" className="flex items-center gap-2 text-slate-700">
                  <Key className="h-4 w-4" />
                  SSH Private Key {server ? '(Optional — leave empty to keep existing)' : <span className="text-[var(--accent-destructive)]">*</span>}
                </Label>

                <div className="flex gap-2">
                  <AccentButton
                    type="button"
                    variant="ghost"
                    className="flex-1"
                    onClick={() => document.getElementById('keyFileInput')?.click()}
                  >
                    <Upload className="h-4 w-4" />
                    Upload from File
                  </AccentButton>
                  <input
                    id="keyFileInput"
                    type="file"
                    accept=".pem,.key,.txt"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <AccentButton
                    type="button"
                    variant="ghost"
                    className="px-3"
                    onClick={() => setShowPrivateKey(!showPrivateKey)}
                    aria-label={showPrivateKey ? 'Hide private key' : 'Show private key'}
                  >
                    {showPrivateKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </AccentButton>
                </div>

                <Textarea
                  id="sshPrivateKey"
                  value={sshPrivateKey}
                  onChange={(e) => setSshPrivateKey(e.target.value)}
                  placeholder={server
                    ? "Paste new SSH private key here or leave empty to keep existing..."
                    : "-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"}
                  className="font-mono min-h-[120px]"
                  style={{
                    WebkitTextSecurity: showPrivateKey ? 'none' : 'disc',
                    textSecurity: showPrivateKey ? 'none' : 'disc'
                  } as React.CSSProperties}
                  required={!server}
                />
                <p className="text-xs text-slate-500">
                  {server
                    ? 'Private key is encrypted and never displayed. Upload a new key only if you want to replace it.'
                    : 'Upload your SSH private key file or paste the content above. This will be encrypted and stored securely.'}
                </p>
              </div>
            </div>

            <DialogFooter className="gap-2">
              {server && (
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
              <AccentButton type="submit" variant="lime" loading={isSaving} disabled={isSaving}>
                {server ? 'Update' : 'Add'} Server
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
              This will permanently delete "{server?.name}". Any apps associated with this server will need to be reassigned.
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
