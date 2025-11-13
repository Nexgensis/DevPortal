import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import { Users, Plus, Edit, Trash2, Shield, Mail, User as UserIcon, MoreVertical } from 'lucide-react';
import { User } from '../types/app';
import { userApi } from '../lib/api';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

export function UserManagement() {
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
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
      // Don't show error toast for mock API
      setUsers([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingUser) {
        await userApi.update(editingUser.id, {
          username: formData.username,
          email: formData.email,
          fullName: formData.fullName || '',
          role: formData.role as 'admin' | 'user',
        });
        toast.success('User updated successfully');
      } else {
        await userApi.create(formData);
        toast.success('User created successfully');
      }
      setDialogOpen(false);
      resetForm();
      loadUsers();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast.error(errorMessage);
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

  const handleDelete = async (user: User) => {
    if (confirm(`Are you sure you want to delete user "${user.username}"?`)) {
      try {
        await userApi.delete(user.id);
        toast.success('User deleted successfully');
        loadUsers();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        toast.error(errorMessage);
      }
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
    <div className="bento-card">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="flex items-center gap-2">
            <Users className="h-6 w-6" />
            User Management
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Manage users and their permissions
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button 
              onClick={handleAddUser}
              className="bg-accent hover:bg-accent/90 text-accent-foreground border-2 border-black rounded-lg h-11 px-6"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add User
            </Button>
          </DialogTrigger>
          <DialogContent className="border-2 border-black/10">
            <DialogHeader>
              <DialogTitle>
                {editingUser ? 'Edit User' : 'Add New User'}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  className="border-2 border-black/10 rounded-lg"
                  required
                />
              </div>
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="border-2 border-black/10 rounded-lg"
                  required
                />
              </div>
              <div>
                <Label htmlFor="fullName">Full Name</Label>
                <Input
                  id="fullName"
                  value={formData.fullName}
                  onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                  className="border-2 border-black/10 rounded-lg"
                />
              </div>
              {!editingUser && (
                <div>
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="border-2 border-black/10 rounded-lg"
                    required
                  />
                </div>
              )}
              <div>
                <Label htmlFor="role">Role</Label>
                <Select value={formData.role} onValueChange={(value) => setFormData({ ...formData, role: value })}>
                  <SelectTrigger className="border-2 border-black/10 rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-2 border-black/10">
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button 
                  type="submit"
                  className="bg-accent hover:bg-accent/90 text-accent-foreground border-2 border-black rounded-lg"
                >
                  {editingUser ? 'Update' : 'Create'}
                </Button>
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => setDialogOpen(false)}
                  className="border-2 border-black rounded-lg"
                >
                  Cancel
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="text-center py-8">
          <div className="animate-pulse text-muted-foreground">Loading users...</div>
        </div>
      ) : users.length === 0 ? (
        <div className="text-center py-16 px-4 bg-secondary/30 rounded-xl border-2 border-dashed border-black/10">
          <div className="h-24 w-24 rounded-xl bg-white border-2 border-black/10 flex items-center justify-center mx-auto mb-4">
            <Users className="h-12 w-12 text-muted-foreground/60" />
          </div>
          <h3 className="mb-2">No Users Available</h3>
          <p className="text-muted-foreground mb-4 max-w-md mx-auto">
            User management requires backend integration. Connect your authentication system to manage users and their access permissions.
          </p>
          <div className="text-sm text-muted-foreground bg-white rounded-xl p-4 max-w-lg mx-auto border-2 border-black/5">
            <strong>Backend Setup Required:</strong> Configure your authentication backend with the API endpoints for user CRUD operations. Currently using local authentication only.
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {users.map((user) => (
            <div
              key={user.id}
              className="flex items-center gap-4 p-4 bg-white rounded-lg hover:bg-secondary/30 transition-all border-2 border-black/5 hover:border-black/10"
            >
              <UserIcon className="h-5 w-5 text-muted-foreground flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="truncate">{user.username}</span>
                  <Badge 
                    variant={user.role === 'admin' ? 'default' : 'secondary'}
                    className={user.role === 'admin' ? 'bg-black text-white' : ''}
                  >
                    {user.role === 'admin' && <Shield className="h-3 w-3 mr-1" />}
                    {user.role}
                  </Badge>
                  {!user.isActive && (
                    <Badge variant="destructive">Inactive</Badge>
                  )}
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Mail className="h-3 w-3" />
                  <span className="truncate">{user.email}</span>
                  {user.fullName && <span className="truncate">• {user.fullName}</span>}
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="h-9 w-9 rounded-lg hover:bg-gray-100 border-2 border-transparent hover:border-gray-300 flex items-center justify-center transition-all flex-shrink-0"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48 z-[100] bg-white shadow-lg border-2">
                  <DropdownMenuItem 
                    className="cursor-pointer hover:bg-gray-100"
                    onSelect={(e) => {
                      e.preventDefault();
                      handleEdit(user);
                    }}
                  >
                    <Edit className="h-4 w-4 mr-2" />
                    Edit User
                  </DropdownMenuItem>
                  <DropdownMenuItem 
                    className="cursor-pointer hover:bg-red-50 text-destructive"
                    onSelect={(e) => {
                      e.preventDefault();
                      handleDelete(user);
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
    </div>
  );
}