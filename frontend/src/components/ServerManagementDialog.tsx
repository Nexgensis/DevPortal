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
import { Trash2, Server as ServerIcon, Upload, Eye, EyeOff, ShieldCheck, Terminal, Copy, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner@2.0.3';
import { AccentButton } from './ui/accent-button';

// Directory the setup script writes the certs to (kept in sync with buildSetupScript).
const CERTS_DIR = '/etc/docker/certs';

// Builds a single copy-paste script that stands up the mTLS CA + certs, points
// the already-running Docker daemon at them (TLS socket on :2376), and prints
// the three files to paste in later steps. SERVER_IP comes from the Host Address
// field so the server cert's SAN matches the address WebManager will connect to.
// The whole thing is piped to `sudo bash` so a mid-script error can't kill the
// user's interactive shell and `set -e` aborts cleanly on the first failure.
function buildSetupScript(address: string): string {
  const ip = address.trim() || 'YOUR_SERVER_IP';
  return `cat <<'SETUP' | sudo bash
set -e
SERVER_IP="${ip}"
CERTS=${CERTS_DIR}
mkdir -p "$CERTS"; cd "$CERTS"

# 1) Generate the CA, the server cert, and the client cert (no passphrase)
openssl genrsa -out ca-key.pem 4096
openssl req -new -x509 -days 3650 -key ca-key.pem -sha256 -out ca.pem -subj "/CN=WebManagerCA"

openssl genrsa -out server-key.pem 4096
openssl req -subj "/CN=$SERVER_IP" -sha256 -new -key server-key.pem -out server.csr
printf 'subjectAltName=IP:%s,IP:127.0.0.1\\nextendedKeyUsage=serverAuth\\n' "$SERVER_IP" > extfile.cnf
openssl x509 -req -days 3650 -sha256 -in server.csr -CA ca.pem -CAkey ca-key.pem -CAcreateserial -out server-cert.pem -extfile extfile.cnf

openssl genrsa -out key.pem 4096
openssl req -subj "/CN=client" -new -key key.pem -out client.csr
printf 'extendedKeyUsage=clientAuth\\n' > extfile-client.cnf
openssl x509 -req -days 3650 -sha256 -in client.csr -CA ca.pem -CAkey ca-key.pem -CAcreateserial -out cert.pem -extfile extfile-client.cnf

# 2) Point the running daemon at the certs + TLS socket on :2376
cat > /etc/docker/daemon.json <<JSON
{
  "tlsverify": true,
  "tlscacert": "$CERTS/ca.pem",
  "tlscert": "$CERTS/server-cert.pem",
  "tlskey": "$CERTS/server-key.pem",
  "hosts": ["unix:///var/run/docker.sock", "tcp://0.0.0.0:2376"]
}
JSON
mkdir -p /etc/systemd/system/docker.service.d
printf '[Service]\\nExecStart=\\nExecStart=/usr/bin/dockerd\\n' > /etc/systemd/system/docker.service.d/override.conf

# 3) Raise inotify limit (avoids "Too many open files" on reload), then restart
sysctl -q fs.inotify.max_user_instances=1024 || true
systemctl daemon-reload
systemctl restart docker

echo
echo "Done. Use the cat commands in the next steps to print each file."
SETUP`;
}

const STEPS = [
  { n: 1, title: 'Connection' },
  { n: 2, title: 'Run setup' },
  { n: 3, title: 'CA cert' },
  { n: 4, title: 'Client cert' },
  { n: 5, title: 'Client key' },
];
const LAST_STEP = STEPS.length;

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
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [dockerApiPort, setDockerApiPort] = useState('2376');
  const [tlsCa, setTlsCa] = useState('');
  const [tlsCert, setTlsCert] = useState('');
  const [tlsKey, setTlsKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  // Optional server-level PostgreSQL fallback credentials.
  const [pgUser, setPgUser] = useState('');
  const [pgPassword, setPgPassword] = useState('');
  const [pgMaintenanceDb, setPgMaintenanceDb] = useState('');
  const [pgHasPassword, setPgHasPassword] = useState(false);
  const [showPgPassword, setShowPgPassword] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const setupScript = buildSetupScript(address);
  const isLastStep = step === LAST_STEP;

  const handleCopy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      toast.success('Copied to clipboard');
      setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 2000);
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  useEffect(() => {
    if (server) {
      setName(server.name);
      setAddress(server.address);
      setDockerApiPort(server.dockerApiPort?.toString() || '2376');
      // CA + client cert are public material and round-trip from the API.
      setTlsCa(server.tlsCa || '');
      setTlsCert(server.tlsCert || '');
      // The private key is encrypted server-side and never returned.
      setTlsKey('');
      setPgUser(server.pgUser || '');
      setPgMaintenanceDb(server.pgMaintenanceDb || '');
      setPgHasPassword(!!server.pgHasPassword);
    } else {
      setName('');
      setAddress('');
      setDockerApiPort('2376');
      setTlsCa('');
      setTlsCert('');
      setTlsKey('');
      setPgUser('');
      setPgMaintenanceDb('');
      setPgHasPassword(false);
    }
    setPgPassword('');
    setShowPgPassword(false);
    setShowKey(false);
    setStep(1);
    setCopiedKey(null);
  }, [server, open]);

  // Loads a PEM file's text content into the given setter.
  const handleFileUpload =
    (setter: (v: string) => void, label: string) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        setter((event.target?.result as string) ?? '');
        toast.success(`${label} loaded from file`);
      };
      reader.onerror = () => toast.error(`Failed to read ${label} file`);
      reader.readAsText(file);
      // Allow re-selecting the same file later.
      e.target.value = '';
    };

  // Validates the fields required to leave a given step. On edit, the CA/cert are
  // pre-filled and the key may stay empty (keep existing), so those steps are lenient.
  const validateStep = (s: number): string | null => {
    if (s === 1) {
      if (!name.trim()) return 'Server name is required';
      if (!address.trim()) return 'Host address is required';
    }
    if (s === 3 && !server && !tlsCa.trim()) return 'CA certificate is required';
    if (s === 4 && !server && !tlsCert.trim()) return 'Client certificate is required';
    if (s === 5 && !server && !tlsKey.trim()) return 'Client private key is required';
    return null;
  };

  const goNext = () => {
    const err = validateStep(step);
    if (err) {
      toast.error(err);
      return;
    }
    setStep((s) => Math.min(LAST_STEP, s + 1));
  };

  const goBack = () => setStep((s) => Math.max(1, s - 1));

  // handleSave is wired ONLY to the Save button's onClick (not the form's
  // onSubmit). This prevents any other interaction — Enter in an input, a
  // stray button click, React reconciling Next→Save at the same DOM slot
  // mid-click — from accidentally completing the save. The user MUST click
  // the explicit Save button on Step 5 to commit changes.
  const handleSave = async () => {
    if (!name.trim() || !address.trim()) {
      toast.error('Server name and host address are required');
      return;
    }
    if (!tlsCa.trim()) {
      toast.error('CA certificate is required');
      return;
    }
    if (!tlsCert.trim()) {
      toast.error('Client certificate is required');
      return;
    }
    if (!server && !tlsKey.trim()) {
      toast.error('Client private key is required');
      return;
    }

    const serverData: any = {
      name,
      address,
      dockerApiPort: parseInt(dockerApiPort, 10) || 2376,
      tlsCa: tlsCa.trim(),
      tlsCert: tlsCert.trim(),
    };
    // Only send the key when one was entered, so editing without re-uploading
    // the key preserves the encrypted value already stored.
    if (tlsKey.trim()) {
      serverData.tlsKey = tlsKey.trim();
    }

    // Optional server-level PostgreSQL fallback creds. Password is only sent when
    // typed, so editing without re-entering it preserves the stored secret.
    serverData.pgUser = pgUser.trim();
    serverData.pgMaintenanceDb = pgMaintenanceDb.trim();
    if (pgPassword) {
      serverData.pgPassword = pgPassword;
    }

    setIsSaving(true);
    try {
      if (server) {
        await onUpdate(server.id, serverData);
        toast.success('Server updated successfully');
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

  // A "cat <path>" hint row with a copy button, shown above each paste step.
  const catHint = (file: string, key: string) => {
    const cmd = `cat ${CERTS_DIR}/${file}`;
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--canvas)] px-3 py-2">
        <code className="truncate font-mono text-xs text-[var(--ink)]">{cmd}</code>
        <AccentButton
          type="button"
          variant="ghost"
          className="shrink-0 px-2 py-1 text-xs"
          onClick={() => handleCopy(key, cmd)}
          aria-label={`Copy ${cmd}`}
        >
          {copiedKey === key ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copiedKey === key ? 'Copied' : 'Copy'}
        </AccentButton>
      </div>
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ServerIcon className="h-5 w-5" />
              {server ? 'Edit Server' : 'Add New Server'}
            </DialogTitle>
            <DialogDescription>
              Connect a remote host via its Docker Engine API secured with mutual TLS.
            </DialogDescription>
          </DialogHeader>

          {/* Step progress */}
          <div className="flex items-center gap-1.5">
            {STEPS.map((s) => (
              <div
                key={s.n}
                className={`h-1 flex-1 rounded-full ${s.n <= step ? 'bg-[var(--accent-pink)]' : 'bg-black/10'}`}
              />
            ))}
          </div>
          <p className="text-xs font-medium text-[var(--ink-muted)]">
            Step {step} of {LAST_STEP} · {STEPS[step - 1].title}
          </p>

          {/* Form never auto-submits — Save is wired to the button's onClick.
              Stops Enter-key / React-reconciliation edge cases from triggering
              save before the user has filled every step. */}
          <form onSubmit={(e) => e.preventDefault()}>
            <div className="grid gap-4 py-4 max-h-[58vh] overflow-y-auto pr-2">
              {/* Step 1 — connection details */}
              {step === 1 && (
                <>
                  <div className="grid gap-2">
                    <Label htmlFor="name" className="text-[var(--ink)]">
                      Server Name <span className="text-[var(--accent-destructive)]">*</span>
                    </Label>
                    <Input
                      id="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Production Server 1"
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="address" className="text-[var(--ink)]">
                      Host Address (IP or Hostname) <span className="text-[var(--accent-destructive)]">*</span>
                    </Label>
                    <Input
                      id="address"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="192.168.1.100 or server.example.com"
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="dockerApiPort" className="text-[var(--ink)]">
                      Docker API Port <span className="text-[var(--accent-destructive)]">*</span>
                    </Label>
                    <Input
                      id="dockerApiPort"
                      type="number"
                      value={dockerApiPort}
                      onChange={(e) => setDockerApiPort(e.target.value)}
                      placeholder="2376"
                    />
                  </div>

                  {/* Optional server-level PostgreSQL superuser — used as a fallback
                      for ALL containers on this host when the default "postgres" role
                      fails (hardened images). Leave blank to rely on auto-detection. */}
                  <div className="rounded-[var(--radius)] border border-[var(--border)] p-4 mt-1">
                    <div className="mb-3">
                      <h4 className="text-sm font-semibold text-[var(--ink)]">PostgreSQL Credentials (optional)</h4>
                      <p className="text-xs text-[var(--ink-muted)] mt-0.5">
                        Fallback superuser for containers that removed the default <code>postgres</code> role.
                        Stored encrypted; tried only if <code>postgres</code> fails.
                      </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="grid gap-2">
                        <Label htmlFor="pgUser" className="text-[var(--ink)]">Database User</Label>
                        <Input
                          id="pgUser"
                          value={pgUser}
                          onChange={(e) => setPgUser(e.target.value)}
                          placeholder="e.g. nexgensis"
                          autoCapitalize="off"
                          autoCorrect="off"
                          spellCheck={false}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="pgPassword" className="text-[var(--ink)]">Password</Label>
                        <div className="relative">
                          <Input
                            id="pgPassword"
                            type={showPgPassword ? 'text' : 'password'}
                            value={pgPassword}
                            onChange={(e) => setPgPassword(e.target.value)}
                            placeholder={pgHasPassword ? '•••••••• (unchanged)' : 'Enter password'}
                            autoComplete="new-password"
                            className="pr-9"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPgPassword((v) => !v)}
                            aria-label={showPgPassword ? 'Hide password' : 'Show password'}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors focus:outline-none"
                          >
                            {showPgPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="pgMaintenanceDb" className="text-[var(--ink)]">Maintenance DB</Label>
                        <Input
                          id="pgMaintenanceDb"
                          value={pgMaintenanceDb}
                          onChange={(e) => setPgMaintenanceDb(e.target.value)}
                          placeholder="postgres"
                          autoCapitalize="off"
                          autoCorrect="off"
                          spellCheck={false}
                        />
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Step 2 — one-command setup script */}
              {step === 2 && (
                <div className="grid gap-3">
                  <p className="text-sm text-[var(--ink)]">
                    Run this once on <span className="font-mono">{address.trim() || 'the host'}</span>. It generates the
                    mTLS certs, exposes the Docker API on <span className="font-mono">:{dockerApiPort || '2376'}</span>,
                    and writes the files to <span className="font-mono">{CERTS_DIR}</span>.
                  </p>

                  <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--canvas)]">
                    <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
                      <span className="flex items-center gap-2 text-xs font-medium text-[var(--ink)]">
                        <Terminal className="h-3.5 w-3.5 text-[var(--ink-muted)]" />
                        One-command setup
                      </span>
                      <AccentButton
                        type="button"
                        variant="ghost"
                        className="px-2 py-1 text-xs"
                        onClick={() => handleCopy('script', setupScript)}
                        aria-label="Copy setup command"
                      >
                        {copiedKey === 'script' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        {copiedKey === 'script' ? 'Copied' : 'Copy'}
                      </AccentButton>
                    </div>
                    <pre className="max-h-64 overflow-auto p-3 text-[11px] leading-relaxed text-[var(--ink)]">
                      <code className="font-mono whitespace-pre">{setupScript}</code>
                    </pre>
                  </div>

                  <p className="text-xs text-[var(--ink-muted)]">
                    Requires <span className="font-mono">sudo</span> on a systemd host. If a firewall is active, open the
                    port: <span className="font-mono">sudo ufw allow {dockerApiPort || '2376'}/tcp</span>. Next, copy each
                    file with the <span className="font-mono">cat</span> commands in steps 3–5.
                  </p>
                </div>
              )}

              {/* Step 3 — CA certificate */}
              {step === 3 && (
                <div className="grid gap-3">
                  <p className="text-sm text-[var(--ink)]">Run this on the host and paste the full output below.</p>
                  {catHint('ca.pem', 'ca')}
                  <CertField
                    id="tlsCa"
                    label="CA Certificate"
                    hint="ca.pem"
                    value={tlsCa}
                    onChange={setTlsCa}
                    onFile={handleFileUpload(setTlsCa, 'CA certificate')}
                    placeholder={'-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----'}
                    required={!server}
                  />
                </div>
              )}

              {/* Step 4 — client certificate */}
              {step === 4 && (
                <div className="grid gap-3">
                  <p className="text-sm text-[var(--ink)]">Run this on the host and paste the full output below.</p>
                  {catHint('cert.pem', 'cert')}
                  <CertField
                    id="tlsCert"
                    label="Client Certificate"
                    hint="cert.pem"
                    value={tlsCert}
                    onChange={setTlsCert}
                    onFile={handleFileUpload(setTlsCert, 'Client certificate')}
                    placeholder={'-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----'}
                    required={!server}
                  />
                </div>
              )}

              {/* Step 5 — client private key */}
              {step === 5 && (
                <div className="grid gap-3">
                  <p className="text-sm text-[var(--ink)]">Run this on the host and paste the full output below.</p>
                  {catHint('key.pem', 'key')}
                  <CertField
                    id="tlsKey"
                    label="Client Private Key"
                    hint="key.pem"
                    value={tlsKey}
                    onChange={setTlsKey}
                    onFile={handleFileUpload(setTlsKey, 'Client private key')}
                    placeholder={
                      server
                        ? 'Leave empty to keep the existing key, or paste a new key.pem to replace it…'
                        : '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----'
                    }
                    required={!server}
                    secret
                    revealed={showKey}
                    onToggleReveal={() => setShowKey((v) => !v)}
                    footer={
                      server
                        ? 'The private key is encrypted at rest and never displayed. Upload a new key only to replace it.'
                        : 'The private key is encrypted before storage and never returned by the API.'
                    }
                  />
                </div>
              )}
            </div>

            <DialogFooter className="gap-2 sm:justify-between">
              <div className="flex gap-2">
                {server && (
                  <AccentButton
                    type="button"
                    variant="destructive"
                    onClick={() => setShowDeleteDialog(true)}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </AccentButton>
                )}
              </div>
              <div className="flex gap-2">
                {step > 1 ? (
                  <AccentButton type="button" variant="ghost" onClick={goBack}>
                    <ChevronLeft className="h-4 w-4" />
                    Back
                  </AccentButton>
                ) : (
                  <AccentButton type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                    Cancel
                  </AccentButton>
                )}
                {!isLastStep ? (
                  <AccentButton key="next-btn" type="button" variant="lime" onClick={goNext}>
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </AccentButton>
                ) : (
                  <AccentButton key="save-btn" type="button" variant="lime" onClick={handleSave} loading={isSaving} disabled={isSaving}>
                    {server ? 'Update' : 'Add'} Server
                  </AccentButton>
                )}
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{server?.name}" and any applications assigned to it, removing them from the
              database. This action cannot be undone.
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

interface CertFieldProps {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  onFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder: string;
  required?: boolean;
  secret?: boolean;
  revealed?: boolean;
  onToggleReveal?: () => void;
  footer?: string;
}

// CertField is a single PEM input: a labelled textarea with an "upload from
// file" button, used for each of the three mTLS assets.
function CertField({
  id,
  label,
  hint,
  value,
  onChange,
  onFile,
  placeholder,
  required,
  secret,
  revealed,
  onToggleReveal,
  footer,
}: CertFieldProps) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id} className="flex items-center gap-2 text-[var(--ink)]">
        <ShieldCheck className="h-4 w-4" />
        {label} <span className="text-xs text-[var(--ink-muted)]">({hint})</span>
        {required && <span className="text-[var(--accent-destructive)]">*</span>}
      </Label>

      <div className="flex gap-2">
        <AccentButton
          type="button"
          variant="ghost"
          className="flex-1"
          onClick={() => document.getElementById(`${id}FileInput`)?.click()}
        >
          <Upload className="h-4 w-4" />
          Upload from File
        </AccentButton>
        <input
          id={`${id}FileInput`}
          type="file"
          accept=".pem,.crt,.cert,.key,.txt"
          onChange={onFile}
          className="hidden"
        />
        {secret && onToggleReveal && (
          <AccentButton
            type="button"
            variant="ghost"
            className="px-3"
            onClick={onToggleReveal}
            aria-label={revealed ? 'Hide private key' : 'Show private key'}
          >
            {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </AccentButton>
        )}
      </div>

      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="font-mono min-h-[160px]"
        style={
          secret
            ? ({
                WebkitTextSecurity: revealed ? 'none' : 'disc',
                textSecurity: revealed ? 'none' : 'disc',
              } as React.CSSProperties)
            : undefined
        }
        required={required}
      />
      {footer && <p className="text-xs text-[var(--ink-muted)]">{footer}</p>}
    </div>
  );
}
