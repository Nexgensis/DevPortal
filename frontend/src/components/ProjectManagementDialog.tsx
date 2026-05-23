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
import { Project } from '../types/app';
import { Trash2, FolderKanban } from 'lucide-react';
import { toast } from 'sonner@2.0.3';
import { AccentButton } from './ui/accent-button';

interface ProjectManagementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project?: Project | null;
  onSave: (project: Omit<Project, 'id' | 'createdAt'>) => void;
  onUpdate: (id: string, updates: Partial<Project>) => void;
  onDelete: (id: string) => void;
}

export function ProjectManagementDialog({
  open,
  onOpenChange,
  project,
  onSave,
  onUpdate,
  onDelete,
}: ProjectManagementDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (project) {
      setName(project.name);
      setDescription(project.description || '');
    } else {
      setName('');
      setDescription('');
    }
  }, [project, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name) {
      toast.error('Project name is required');
      return;
    }

    const projectData = {
      name,
      description: description || undefined,
    };

    setIsSaving(true);
    try {
      if (project) {
        await onUpdate(project.id, projectData);
        toast.success('Project updated successfully');
      } else {
        await onSave(projectData);
        toast.success('Project created successfully');
      }
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = () => {
    if (project) {
      onDelete(project.id);
      toast.success('Project deleted successfully');
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
              <FolderKanban className="h-5 w-5" />
              {project ? 'Edit Project' : 'Create New Project'}
            </DialogTitle>
            <DialogDescription>
              {project
                ? 'Update the project details below.'
                : 'Create a new project to organize your applications.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="grid gap-4 py-4 max-h-[60vh] overflow-y-auto pr-2">
              <div className="grid gap-2">
                <Label htmlFor="name" className="text-slate-700">
                  Project Name <span className="text-[var(--accent-destructive)]">*</span>
                </Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="QMS"
                  required
                />
                <p className="text-xs text-slate-500">
                  A unique name for the project (e.g., QMS, EBMR, CRM)
                </p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="description" className="text-slate-700">Description (Optional)</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Quality Management System applications"
                  rows={3}
                />
                <p className="text-xs text-slate-500">
                  Brief description of what this project contains
                </p>
              </div>
            </div>

            <DialogFooter className="gap-2">
              {project && (
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
                {project ? 'Update' : 'Create'} Project
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
              This will permanently delete "{project?.name}". All apps in this project will need to be reassigned to another project.
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
