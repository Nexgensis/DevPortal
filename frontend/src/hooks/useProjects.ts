import { useState, useEffect } from 'react';
import { Project } from '../types/app';

const STORAGE_KEY = 'devops-dashboard-projects';

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        setProjects(JSON.parse(stored));
      } catch (error) {
        console.error('Failed to parse projects from localStorage:', error);
      }
    }
  }, []);

  const saveProjects = (newProjects: Project[]) => {
    setProjects(newProjects);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newProjects));
  };

  const addProject = (project: Omit<Project, 'id' | 'createdAt'>) => {
    const newProject: Project = {
      ...project,
      id: Date.now().toString(),
      createdAt: Date.now(),
    };
    saveProjects([...projects, newProject]);
  };

  const updateProject = (id: string, updates: Partial<Project>) => {
    saveProjects(projects.map(project => project.id === id ? { ...project, ...updates } : project));
  };

  const removeProject = (id: string) => {
    saveProjects(projects.filter(project => project.id !== id));
  };

  return {
    projects,
    addProject,
    updateProject,
    removeProject,
  };
}
