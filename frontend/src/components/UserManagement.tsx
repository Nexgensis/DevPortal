import { useState, useEffect } from 'react';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from './ui/dialog';
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
import { Users, Plus, Edit, Trash2, User as UserIcon, Search, ChevronDown, Shield } from 'lucide-react';
import { User } from '../types/app';
import { PillTag } from './ui/pill-tag';
import { StatusBadge } from './ui/status-badge';
import { toast } from 'sonner';
import { userApi } from '../lib/api';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { GlassSkeleton } from './ui/glass-skeleton';
import { AccentButton } from './ui/accent-button';
import { useApps } from '../hooks/useApps';
import { useServers } from '../hooks/useServers';

// ─── UserCard ───────────────────────────────────────────────────────────────
// One card per user. Self-contained: keeps its own "Assign App" search state
// and the filtered list of "assigned team members" (other admins in the system).
function UserCard({
  user,
  otherAdmins,
  appsCount,
  serversOnlineCount,
  onEdit,
  onDelete,
}: {
  user: User;
  otherAdmins: User[];
  appsCount: number;
  serversOnlineCount: number;
  onEdit: (u: User) => void;
  onDelete: (u: User) => void;
}) {
  const [search, setSearch] = useState('');
  const display = user.fullName || user.username;

  const members = otherAdmins.filter((u) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (u.fullName || u.username).toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  });

  return (
    <div className="rounded-2xl bg-white dark:bg-[#1A1A1E] border border-gray-200/80 dark:border-zinc-800 p-6 sm:p-8 flex flex-col">
      {/* ── Top header: avatar + email/name (+ dropdown actions) ── */}
      <div className="flex items-start gap-4">
        <div className="h-12 w-12 rounded-full bg-gray-100 dark:bg-zinc-800 flex items-center justify-center shrink-0">
          <UserIcon className="h-6 w-6 text-gray-500 dark:text-zinc-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-gray-500 dark:text-zinc-400 truncate">{user.email}</div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="mt-0.5 inline-flex items-center gap-1.5 rounded-md -ml-1 px-1 py-0.5 hover:bg-gray-100 dark:hover:bg-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 dark:focus-visible:ring-zinc-700 transition-colors"
              >
                <span className="font-semibold text-gray-900 dark:text-zinc-100 truncate max-w-[12rem]">
                  {display}
                </span>
                <ChevronDown className="h-4 w-4 text-gray-500 dark:text-zinc-400" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44 z-[100] p-1">
              <DropdownMenuItem className="cursor-pointer rounded-md" onSelect={(e) => { e.preventDefault(); onEdit(user); }}>
                <Edit className="h-4 w-4 mr-2" /> Edit User
              </DropdownMenuItem>
              <DropdownMenuItem className="cursor-pointer rounded-md text-red-600 dark:text-red-400" onSelect={(e) => { e.preventDefault(); onDelete(user); }}>
                <Trash2 className="h-4 w-4 mr-2" /> Delete User
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Status pill */}
      <div className="mt-4">
        <StatusBadge status={user.isActive ? 'online' : 'offline'} />
      </div>

      {/* ── Divider ── */}
      <div className="my-6 h-px bg-gray-200 dark:bg-zinc-800" />

      {/* ── Middle: Assign App ── */}
      <div>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-zinc-100 mb-3">Assign App</h3>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-zinc-500 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search App"
            className="w-full h-10 pl-9 pr-3 rounded-xl bg-gray-50 dark:bg-zinc-900 border border-gray-200/80 dark:border-zinc-800 text-sm text-gray-900 dark:text-zinc-100 placeholder:text-gray-400 dark:placeholder:text-zinc-500 focus:outline-none focus:border-gray-300 dark:focus:border-zinc-700 transition-colors"
          />
        </div>
      </div>

      {/* ── Assigned Members list ── */}
      <div className="mt-4 space-y-2">
        {members.length === 0 ? (
          <div className="text-xs text-gray-500 dark:text-zinc-400 px-3 py-2.5 rounded-xl bg-gray-50/80 dark:bg-zinc-900">
            No members match.
          </div>
        ) : (
          members.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-gray-50/80 dark:bg-zinc-900"
            >
              <div className="h-7 w-7 rounded-full bg-gray-200 dark:bg-zinc-800 flex items-center justify-center shrink-0">
                <UserIcon className="h-4 w-4 text-gray-500 dark:text-zinc-400" />
              </div>
              <span className="flex-1 truncate text-sm text-gray-900 dark:text-zinc-100">
                {m.fullName || m.username}
              </span>
              {m.role === 'admin' && (
                <PillTag tone="purple" icon={Shield} size="sm">admin</PillTag>
              )}
            </div>
          ))
        )}
      </div>

      {/* ── Footer: bold 3-line server metrics ── */}
      <div className="mt-6 pt-6 border-t border-gray-200 dark:border-zinc-800">
        <div className="text-2xl font-bold leading-snug text-gray-900 dark:text-zinc-100 tabular-nums">
          {appsCount} apps -<br />
          {serversOnlineCount} servers<br />
          online
        </div>
      </div>
    </div>
  );
}

// ─── UserManagement ──────────────────────────────────────────────────────────
export function UserManagement() {
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    fullName: '',
    password: '',
    role: 'user',
  });

  // Footer metric source: live counts from the existing apps/servers hooks so
  // each card reflects "what's running across the fleet" (the spec text reads
  // as a system status block, not a per-user attribute).
  const { apps } = useApps();
  const { servers } = useServers();
  const appsCount = apps.length;
  const serversOnlineCount = servers.filter((s) => s.status === 'online').length;

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      setIsLoading(true);
      const userList = await userApi.list();
      setUsers(userList);
    } catch (error) {
      console.error('Failed to load users:', error);
      toast.error('Failed to load users');
      setUsers([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      if (editingUser) {
        const updatedUser = await userApi.update(editingUser.id, {
          username: formData.username,
          email: formData.email,
          fullName: formData.fullName || '',
          role: formData.role as 'admin' | 'user',
        });
        setUsers(users.map((u) => (u.id === editingUser.id ? updatedUser : u)));
        toast.success('User updated successfully');
      } else {
        const newUser = await userApi.create({
          username: formData.username,
          email: formData.email,
          fullName: formData.fullName || '',
          password: formData.password,
          role: formData.role as 'admin' | 'user',
        });
        setUsers([...users, newUser]);
        toast.success('User created successfully');
      }
      setDialogOpen(false);
      resetForm();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast.error(errorMessage);
    } finally {
      setIsSaving(false);
    }
  };

  const handleEdit = (user: User) => {
    setEditingUser(user);
    setFormData({
      username: user.username,
      email: user.email,
      fullName: user.fullName || '',
      password: '',
      role: user.role,
    });
    setDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!userToDelete) return;
    try {
      await userApi.delete(userToDelete.id);
      setUsers(users.filter((u) => u.id !== userToDelete.id));
      toast.success('User deleted successfully');
      setUserToDelete(null);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast.error(errorMessage);
    }
  };

  const resetForm = () => {
    setFormData({ username: '', email: '', fullName: '', password: '', role: 'user' });
    setEditingUser(null);
  };

  const handleAddUser = () => {
    resetForm();
    setDialogOpen(true);
  };

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold text-gray-900 dark:text-zinc-100">
            <Users className="h-6 w-6" />
            User Management
          </h2>
          <p className="text-sm text-gray-500 dark:text-zinc-400 mt-1">Manage users and their permissions</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <AccentButton onClick={handleAddUser} variant="lime">
              <Plus className="h-4 w-4" />
              Add User
            </AccentButton>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingUser ? 'Edit User' : 'Add New User'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username" className="text-[var(--ink)]">
                  Username <span className="text-[var(--accent-destructive)]">*</span>
                </Label>
                <Input id="username" value={formData.username} onChange={(e) => setFormData({ ...formData, username: e.target.value })} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email" className="text-[var(--ink)]">
                  Email <span className="text-[var(--accent-destructive)]">*</span>
                </Label>
                <Input id="email" type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fullName" className="text-[var(--ink)]">Full Name</Label>
                <Input id="fullName" value={formData.fullName} onChange={(e) => setFormData({ ...formData, fullName: e.target.value })} />
              </div>
              {!editingUser && (
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-[var(--ink)]">
                    Password <span className="text-[var(--accent-destructive)]">*</span>
                  </Label>
                  <Input id="password" type="password" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} required />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="role" className="text-[var(--ink)]">Role</Label>
                <Select value={formData.role} onValueChange={(value) => setFormData({ ...formData, role: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter className="gap-2">
                <AccentButton type="button" variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</AccentButton>
                <AccentButton type="submit" variant="lime" loading={isSaving} disabled={isSaving}>
                  {editingUser ? 'Update' : 'Create'}
                </AccentButton>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-8 lg:gap-10">
          <GlassSkeleton.Card count={3} />
        </div>
      ) : users.length === 0 ? (
        <div className="text-center py-16 px-4 rounded-2xl border border-dashed border-gray-200 dark:border-zinc-800">
          <div className="h-24 w-24 rounded-2xl bg-gray-100 dark:bg-zinc-900 flex items-center justify-center mx-auto mb-4">
            <Users className="h-12 w-12 text-gray-400 dark:text-zinc-500" />
          </div>
          <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-zinc-100">No Users Available</h3>
          <p className="text-gray-500 dark:text-zinc-400 mb-4 max-w-md mx-auto">Click "Add User" to create your first user.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-8 lg:gap-10">
          {users.map((user) => (
            <UserCard
              key={user.id}
              user={user}
              otherAdmins={users.filter((u) => u.id !== user.id && u.role === 'admin')}
              appsCount={appsCount}
              serversOnlineCount={serversOnlineCount}
              onEdit={handleEdit}
              onDelete={setUserToDelete}
            />
          ))}
        </div>
      )}

      {/* Delete confirmation */}
      <AlertDialog open={!!userToDelete} onOpenChange={(o) => !o && setUserToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete user "{userToDelete?.username}". This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
