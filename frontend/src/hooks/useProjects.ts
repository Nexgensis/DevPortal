import { useState, useEffect } from 'react';
import { Project } from '../types/app';
import { projectApi } from '../lib/api';
import { toast } from 'sonner';

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProjects = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const projectList = await projectApi.list();
      setProjects(projectList);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load projects';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadProjects();
  }, []);

  const addProject = async (project: Omit<Project, 'id' | 'createdAt'>): Promise<Project> => {
    try {
      const newProject = await projectApi.create(project);
      setProjects(prev => [...prev, newProject]);
      toast.success('Project added successfully');
      return newProject;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to add project';
      toast.error(errorMessage);
      throw err;
    }
  };

  const updateProject = async (id: string, updates: Partial<Project>): Promise<Project> => {
    try {
      const updatedProject = await projectApi.update(id, updates);
      setProjects(prev => prev.map(project => project.id === id ? updatedProject : project));
      toast.success('Project updated successfully');
      return updatedProject;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update project';
      toast.error(errorMessage);
      throw err;
    }
  };

  const removeProject = async (id: string): Promise<void> => {
    try {
      await projectApi.delete(id);
      setProjects(prev => prev.filter(project => project.id !== id));
      toast.success('Project deleted successfully');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete project';
      toast.error(errorMessage);
      throw err;
    }
  };

  return {
    projects,
    isLoading,
    error,
    addProject,
    updateProject,
    removeProject,
    reload: loadProjects,
  };
}
