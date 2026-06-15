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
import { Users, Plus, Trash2, User as UserIcon, ChevronDown, Shield, Power, Search } from 'lucide-react';
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
// ─── UserCard ───────────────────────────────────────────────────────────────
// Compact per-user card: avatar + email + name (dropdown actions) + status pill
// + role chip. Previous incarnation showed a fake "Assign App" section (no
// backend) and a global fleet-stats footer (identical on every card) — both
// removed in the cleanup since they were filler, not data.
function UserCard({
  user,
  onToggleRole,
  onToggleActive,
  onDelete,
}: {
  user: User;
  onToggleRole: (u: User) => void;
  onToggleActive: (u: User) => void;
  onDelete: (u: User) => void;
}) {
  const display = user.fullName || user.username;

  return (
    <div className="rounded-2xl bg-white dark:bg-[#1A1A1E] border border-gray-200/80 dark:border-zinc-800 p-5 flex flex-col gap-4">
      {/* Top header: avatar + email/name + dropdown actions */}
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-full bg-gray-100 dark:bg-zinc-800 flex items-center justify-center shrink-0">
          <UserIcon className="h-5 w-5 text-gray-500 dark:text-zinc-400" />
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
              <DropdownMenuItem className="cursor-pointer rounded-md" onSelect={() => onToggleRole(user)}>
                <Shield className="h-4 w-4 mr-2" />
                {user.role === 'admin' ? 'Make user' : 'Make admin'}
              </DropdownMenuItem>
              <DropdownMenuItem className="cursor-pointer rounded-md" onSelect={() => onToggleActive(user)}>
                <Power className="h-4 w-4 mr-2" />
                {user.isActive ? 'Disable user' : 'Enable user'}
              </DropdownMenuItem>
              <DropdownMenuItem className="cursor-pointer rounded-md text-red-600 dark:text-red-400" onSelect={() => onDelete(user)}>
                <Trash2 className="h-4 w-4 mr-2" /> Delete User
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Status + role */}
      <div className="flex items-center gap-2 flex-wrap">
        <StatusBadge
          status={user.isActive ? 'online' : 'offline'}
          label={user.isActive ? 'Active' : 'Disabled'}
        />
        {user.role === 'admin' && (
          <PillTag tone="purple" icon={Shield} size="sm">admin</PillTag>
        )}
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
  const [searchQuery, setSearchQuery] = useState('');

  // Case-insensitive match across username, fullName, and email.
  const filteredUsers = users.filter((u) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      u.username.toLowerCase().includes(q) ||
      (u.fullName ?? '').toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q)
    );
  });


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

  // Flip a user between 'admin' and 'user' via a partial update — no dialog,
  // no other fields touched, just the role.
  const handleToggleRole = async (user: User) => {
    const newRole: 'admin' | 'user' = user.role === 'admin' ? 'user' : 'admin';
    try {
      const updated = await userApi.update(user.id, { role: newRole });
      setUsers((prev) => prev.map((u) => (u.id === user.id ? updated : u)));
      toast.success(
        `${user.fullName || user.username} is now ${newRole === 'admin' ? 'an admin' : 'a regular user'}`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update role');
    }
  };

  // Disable / enable a user — partial update on isActive only. Disabled users
  // cannot log in but their data is preserved (use Delete for permanent removal).
  const handleToggleActive = async (user: User) => {
    const newActive = !user.isActive;
    try {
      const updated = await userApi.update(user.id, { isActive: newActive });
      setUsers((prev) => prev.map((u) => (u.id === user.id ? updated : u)));
      toast.success(
        `${user.fullName || user.username} ${newActive ? 'enabled' : 'disabled'}`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update user');
    }
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

      {/* Search */}
      {users.length > 0 && (
        <div className="relative mb-6 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-zinc-500 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search users by name or email…"
            className="w-full h-10 pl-9 pr-3 rounded-xl bg-white dark:bg-zinc-900 border border-gray-200/80 dark:border-zinc-800 text-sm text-gray-900 dark:text-zinc-100 placeholder:text-gray-400 dark:placeholder:text-zinc-500 focus:outline-none focus:border-gray-300 dark:focus:border-zinc-700 transition-colors"
          />
        </div>
      )}

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
      ) : filteredUsers.length === 0 ? (
        <div className="text-center py-12 px-4 rounded-2xl border border-dashed border-gray-200 dark:border-zinc-800 text-sm text-gray-500 dark:text-zinc-400">
          No users match "{searchQuery}".
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
          {filteredUsers.map((user) => (
            <UserCard
              key={user.id}
              user={user}
              onToggleRole={handleToggleRole}
              onToggleActive={handleToggleActive}
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
