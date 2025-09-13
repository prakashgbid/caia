import { create } from 'zustand';
import { HierarchicalAgentAPI } from '../services/api';

interface ProjectItem {
  id: string;
  title: string;
  description: string;
  level: 'idea' | 'initiative' | 'feature' | 'epic' | 'story' | 'task' | 'subtask';
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  priority: 'critical' | 'high' | 'medium' | 'low';
  assignee?: string;
  effort?: number;
  labels: string[];
  acceptanceCriteria: string[];
  path: string[];
  children?: ProjectItem[];
}

interface Project {
  id: string;
  title: string;
  description: string;
  items: ProjectItem[];
  itemCount: number;
  createdAt: Date;
}

interface ProjectStore {
  projects: Project[];
  currentProject: Project | null;
  hierarchicalData: any[];
  selectedItem: ProjectItem | null;
  currentView: 'dashboard' | 'grid';
  stats: {
    totalProjects: number;
    totalTickets: number;
    avgBreakdownTime: number;
    blockedItems: number;
  };

  setCurrentView: (view: 'dashboard' | 'grid') => void;
  setSelectedItem: (item: ProjectItem | null) => void;
  createProject: (idea: string) => Promise<void>;
  loadProject: (projectId: string) => void;
  updateItem: (itemId: string, updates: Partial<ProjectItem>) => void;
  refreshStats: () => void;
}

const transformToHierarchical = (items: ProjectItem[]): any[] => {
  const result: any[] = [];

  const buildTree = (item: ProjectItem, path: string[] = []): any => {
    const currentPath = [...path, item.title];
    return {
      ...item,
      path: currentPath,
      children: item.children?.map(child => buildTree(child, currentPath))
    };
  };

  items.forEach(item => {
    if (item.level === 'idea') {
      result.push(buildTree(item));
    }
  });

  return result;
};

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  currentProject: null,
  hierarchicalData: [],
  selectedItem: null,
  currentView: 'dashboard',
  stats: {
    totalProjects: 0,
    totalTickets: 0,
    avgBreakdownTime: 12,
    blockedItems: 0
  },

  setCurrentView: (view) => set({ currentView: view }),

  setSelectedItem: (item) => set({ selectedItem: item }),

  createProject: async (idea: string) => {
    const startTime = Date.now();

    try {
      // Call the Hierarchical Agent System API
      const breakdown = await HierarchicalAgentAPI.breakdownIdea(idea);

      const project: Project = {
        id: `project-${Date.now()}`,
        title: breakdown.title || idea.substring(0, 50),
        description: idea,
        items: breakdown.items,
        itemCount: breakdown.totalItems,
        createdAt: new Date()
      };

      const hierarchicalData = transformToHierarchical(breakdown.items);

      set(state => ({
        projects: [project, ...state.projects],
        currentProject: project,
        hierarchicalData,
        stats: {
          ...state.stats,
          totalProjects: state.stats.totalProjects + 1,
          totalTickets: state.stats.totalTickets + breakdown.totalItems,
          avgBreakdownTime: Math.round((Date.now() - startTime) / 1000)
        }
      }));
    } catch (error) {
      console.error('Failed to create project breakdown:', error);
      throw error;
    }
  },

  loadProject: (projectId: string) => {
    const project = get().projects.find(p => p.id === projectId);
    if (project) {
      const hierarchicalData = transformToHierarchical(project.items);
      set({ currentProject: project, hierarchicalData });
    }
  },

  updateItem: (itemId: string, updates: Partial<ProjectItem>) => {
    set(state => {
      const updateInTree = (items: ProjectItem[]): ProjectItem[] => {
        return items.map(item => {
          if (item.id === itemId) {
            return { ...item, ...updates };
          }
          if (item.children) {
            return { ...item, children: updateInTree(item.children) };
          }
          return item;
        });
      };

      const updatedProjects = state.projects.map(project => {
        if (project.id === state.currentProject?.id) {
          return {
            ...project,
            items: updateInTree(project.items)
          };
        }
        return project;
      });

      const currentProject = updatedProjects.find(p => p.id === state.currentProject?.id);
      const hierarchicalData = currentProject
        ? transformToHierarchical(currentProject.items)
        : state.hierarchicalData;

      return {
        projects: updatedProjects,
        currentProject,
        hierarchicalData
      };
    });
  },

  refreshStats: () => {
    const state = get();
    const blockedItems = state.projects.reduce((count, project) => {
      const countBlocked = (items: ProjectItem[]): number => {
        return items.reduce((sum, item) => {
          const itemBlocked = item.status === 'blocked' ? 1 : 0;
          const childrenBlocked = item.children ? countBlocked(item.children) : 0;
          return sum + itemBlocked + childrenBlocked;
        }, 0);
      };
      return count + countBlocked(project.items);
    }, 0);

    set(state => ({
      stats: {
        ...state.stats,
        blockedItems
      }
    }));
  }
}));