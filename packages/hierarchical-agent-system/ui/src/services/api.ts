import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000/api';

export interface BreakdownRequest {
  idea: string;
  options?: {
    maxDepth?: number;
    includeAcceptanceCriteria?: boolean;
    includeLabels?: boolean;
    autoAssign?: boolean;
  };
}

export interface BreakdownResponse {
  title: string;
  items: any[];
  totalItems: number;
  confidence: number;
  processingTime: number;
}

export class HierarchicalAgentAPI {
  static async breakdownIdea(idea: string): Promise<BreakdownResponse> {
    try {
      const response = await axios.post(`${API_BASE_URL}/breakdown`, {
        idea,
        options: {
          maxDepth: 7,
          includeAcceptanceCriteria: true,
          includeLabels: true,
          autoAssign: false
        }
      });

      return response.data;
    } catch (error) {
      // Fallback to mock data for development
      return this.getMockBreakdown(idea);
    }
  }

  static getMockBreakdown(idea: string): BreakdownResponse {
    const mockItems = [
      {
        id: 'idea-1',
        title: idea.substring(0, 50),
        description: idea,
        level: 'idea',
        status: 'pending',
        priority: 'high',
        labels: ['MVP', 'Q1-2024'],
        acceptanceCriteria: ['System successfully processes user input'],
        children: [
          {
            id: 'init-1',
            title: 'Core Platform Development',
            description: 'Build the foundational platform',
            level: 'initiative',
            status: 'in_progress',
            priority: 'critical',
            labels: ['foundation', 'platform'],
            acceptanceCriteria: ['Platform is stable', 'Core APIs functional'],
            children: [
              {
                id: 'feat-1',
                title: 'User Management System',
                description: 'Complete user authentication and authorization',
                level: 'feature',
                status: 'in_progress',
                priority: 'high',
                effort: 21,
                labels: ['auth', 'security'],
                acceptanceCriteria: ['Users can register', 'Users can login', 'Role-based access works'],
                children: [
                  {
                    id: 'epic-1',
                    title: 'Authentication Flow',
                    description: 'Implement complete authentication workflow',
                    level: 'epic',
                    status: 'in_progress',
                    priority: 'high',
                    effort: 13,
                    assignee: 'Team Alpha',
                    labels: ['auth'],
                    acceptanceCriteria: ['OAuth2 integration', 'JWT tokens', 'Session management'],
                    children: [
                      {
                        id: 'story-1',
                        title: 'Login Page Implementation',
                        description: 'Create login page with form validation',
                        level: 'story',
                        status: 'in_progress',
                        priority: 'high',
                        effort: 5,
                        assignee: 'Developer 1',
                        labels: ['frontend'],
                        acceptanceCriteria: ['Form validates input', 'Shows errors clearly', 'Submits to API'],
                        children: [
                          {
                            id: 'task-1',
                            title: 'Design login form UI',
                            description: 'Create responsive login form design',
                            level: 'task',
                            status: 'completed',
                            priority: 'medium',
                            effort: 2,
                            assignee: 'Designer 1',
                            labels: ['design'],
                            acceptanceCriteria: ['Mobile responsive', 'Accessible'],
                            children: [
                              {
                                id: 'subtask-1',
                                title: 'Create mockups',
                                description: 'Design mockups in Figma',
                                level: 'subtask',
                                status: 'completed',
                                priority: 'medium',
                                effort: 1,
                                assignee: 'Designer 1',
                                labels: ['design'],
                                acceptanceCriteria: ['3 variations created']
                              }
                            ]
                          },
                          {
                            id: 'task-2',
                            title: 'Implement form validation',
                            description: 'Add client-side validation',
                            level: 'task',
                            status: 'in_progress',
                            priority: 'high',
                            effort: 3,
                            assignee: 'Developer 1',
                            labels: ['frontend'],
                            acceptanceCriteria: ['Email validation', 'Password strength check']
                          }
                        ]
                      },
                      {
                        id: 'story-2',
                        title: 'JWT Token Management',
                        description: 'Implement JWT token generation and validation',
                        level: 'story',
                        status: 'pending',
                        priority: 'high',
                        effort: 8,
                        labels: ['backend', 'security'],
                        acceptanceCriteria: ['Tokens expire properly', 'Refresh tokens work', 'Secure storage']
                      }
                    ]
                  },
                  {
                    id: 'epic-2',
                    title: 'User Profile Management',
                    description: 'User profile CRUD operations',
                    level: 'epic',
                    status: 'pending',
                    priority: 'medium',
                    effort: 8,
                    labels: ['user-management'],
                    acceptanceCriteria: ['Users can update profile', 'Avatar upload works', 'Privacy settings']
                  }
                ]
              },
              {
                id: 'feat-2',
                title: 'Data Analytics Dashboard',
                description: 'Real-time analytics and reporting',
                level: 'feature',
                status: 'pending',
                priority: 'medium',
                effort: 34,
                labels: ['analytics', 'dashboard'],
                acceptanceCriteria: ['Real-time updates', 'Export functionality', 'Custom date ranges']
              }
            ]
          }
        ]
      }
    ];

    return {
      title: idea.substring(0, 50),
      items: mockItems,
      totalItems: this.countItems(mockItems),
      confidence: 0.85,
      processingTime: 2.5
    };
  }

  private static countItems(items: any[]): number {
    let count = 0;
    const traverse = (nodes: any[]) => {
      nodes.forEach(node => {
        count++;
        if (node.children) {
          traverse(node.children);
        }
      });
    };
    traverse(items);
    return count;
  }

  static async exportToJira(projectId: string): Promise<void> {
    await axios.post(`${API_BASE_URL}/export/jira`, { projectId });
  }

  static async getProjectStats(): Promise<any> {
    try {
      const response = await axios.get(`${API_BASE_URL}/stats`);
      return response.data;
    } catch {
      return {
        totalProjects: 12,
        totalTickets: 487,
        avgBreakdownTime: 12,
        blockedItems: 3
      };
    }
  }
}