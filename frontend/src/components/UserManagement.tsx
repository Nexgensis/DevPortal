import { useState, useEffect } from 'react';
import { Badge } from './ui/badge';
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
import { Users, Plus, Edit, Trash2, Shield, Mail, User as UserIcon, MoreVertical } from 'lucide-react';
import { User } from '../types/app';
import { toast } from 'sonner';
import { userApi } from '../lib/api';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { GlassCard } from './ui/glass-card';
import { AccentButton } from './ui/accent-button';
import { GlassSkeleton } from './ui/glass-skeleton';

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
        setUsers(users.map(u => u.id === editingUser.id ? updatedUser : u));
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
      setUsers(users.filter(u => u.id !== userToDelete.id));
      toast.success('User deleted successfully');
      setUserToDelete(null);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast.error(errorMessage);
    }
  };

  const resetForm = () => {
    setFormData({
      username: '',
      email: '',
      fullName: '',
      password: '',
      role: 'user',
    });
    setEditingUser(null);
  };

  const handleAddUser = () => {
    resetForm();
    setDialogOpen(true);
  };

  return (
    <>
      <GlassCard>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-semibold text-[var(--ink)]">
              <Users className="h-6 w-6" />
              User Management
            </h2>
            <p className="text-sm text-[var(--ink-muted)] mt-1">
              Manage users and their permissions
            </p>
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
                <DialogTitle>
                  {editingUser ? 'Edit User' : 'Add New User'}
                </DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="username" className="text-[var(--ink)]">
                    Username <span className="text-[var(--accent-destructive)]">*</span>
                  </Label>
                  <Input
                    id="username"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-[var(--ink)]">
                    Email <span className="text-[var(--accent-destructive)]">*</span>
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fullName" className="text-[var(--ink)]">Full Name</Label>
                  <Input
                    id="fullName"
                    value={formData.fullName}
                    onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                  />
                </div>
                {!editingUser && (
                  <div className="space-y-2">
                    <Label htmlFor="password" className="text-[var(--ink)]">
                      Password <span className="text-[var(--accent-destructive)]">*</span>
                    </Label>
                    <Input
                      id="password"
                      type="password"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      required
                    />
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="role" className="text-[var(--ink)]">Role</Label>
                  <Select value={formData.role} onValueChange={(value) => setFormData({ ...formData, role: value })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <DialogFooter className="gap-2">
                  <AccentButton
                    type="button"
                    variant="ghost"
                    onClick={() => setDialogOpen(false)}
                  >
                    Cancel
                  </AccentButton>
                  <AccentButton
                    type="submit"
                    variant="lime"
                    loading={isSaving}
                    disabled={isSaving}
                  >
                    {editingUser ? 'Update' : 'Create'}
                  </AccentButton>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            <GlassSkeleton.Row count={4} />
          </div>
        ) : users.length === 0 ? (
          <div className="text-center py-16 px-4 rounded-2xl border border-dashed border-black/6 bg-black/3">
            <div className="h-24 w-24 rounded-2xl glass-card flex items-center justify-center mx-auto mb-4">
              <Users className="h-12 w-12 text-[var(--ink-muted)]" />
            </div>
            <h3 className="mb-2 text-lg font-semibold text-[var(--ink)]">No Users Available</h3>
            <p className="text-[var(--ink-muted)] mb-4 max-w-md mx-auto">
              Click "Add User" to create your first user.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {users.map((user) => (
              <div
                key={user.id}
                className="glass-card glass-hover flex items-center gap-4 p-4"
              >
                <div className="h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-black/4 border border-black/8">
                  <UserIcon className="h-5 w-5 text-[var(--ink)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="truncate font-medium text-[var(--ink)]">{user.username}</span>
                    <Badge
                      variant={user.role === 'admin' ? 'default' : 'secondary'}
                      className={
                        user.role === 'admin'
                          ? 'bg-[var(--accent-lime)] text-[#0A0B14] hover:bg-[var(--accent-lime)] border-0'
                          : 'bg-black/5 text-[var(--ink)] hover:bg-black/5 border border-black/8'
                      }
                    >
                      {user.role === 'admin' && <Shield className="h-3 w-3 mr-1" />}
                      {user.role}
                    </Badge>
                    {!user.isActive && (
                      <Badge
                        variant="secondary"
                        className="bg-black/5 text-[var(--ink-muted)] border border-black/8"
                      >
                        Inactive
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-[var(--ink-muted)]">
                    <Mail className="h-3 w-3" />
                    <span className="truncate">{user.email}</span>
                    {user.fullName && <span className="truncate">• {user.fullName}</span>}
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="h-9 w-9 rounded-xl bg-black/3 border border-black/8 hover:bg-black/6 flex items-center justify-center transition-colors flex-shrink-0 focus-ring-cyan backdrop-blur-md text-[var(--ink)]"
                      aria-label="More options"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48 z-[100] glass-card-strong border-0 p-1">
                    <DropdownMenuItem
                      className="cursor-pointer rounded-lg focus:bg-[var(--accent-cyan)]/20"
                      onSelect={(e) => {
                        e.preventDefault();
                        handleEdit(user);
                      }}
                    >
                      <Edit className="h-4 w-4 mr-2" />
                      Edit User
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="cursor-pointer rounded-lg text-red-300 focus:bg-[var(--accent-destructive)]/15"
                      onSelect={(e) => {
                        e.preventDefault();
                        setUserToDelete(user);
                      }}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete User
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        )}
      </GlassCard>

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
            <AlertDialogAction onClick={confirmDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
