import React, { useState } from 'react';
import { useProjectStore } from '../stores/projectStore';
import { ProjectBreakdown } from './ProjectBreakdown';
import { Plus, Brain, Zap, TrendingUp, Users, Clock, AlertCircle } from 'lucide-react';

export const Dashboard: React.FC = () => {
  const [ideaInput, setIdeaInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const { projects, currentProject, createProject, stats } = useProjectStore();

  const handleBreakdown = async () => {
    if (!ideaInput.trim()) return;

    setIsProcessing(true);
    try {
      await createProject(ideaInput);
      setIdeaInput('');
    } catch (error) {
      console.error('Failed to create project:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>Project Planning Dashboard</h2>
        <div className="stats-bar">
          <div className="stat-card">
            <TrendingUp size={20} />
            <div>
              <span className="stat-value">{stats.totalProjects}</span>
              <span className="stat-label">Projects</span>
            </div>
          </div>
          <div className="stat-card">
            <Users size={20} />
            <div>
              <span className="stat-value">{stats.totalTickets}</span>
              <span className="stat-label">Total Items</span>
            </div>
          </div>
          <div className="stat-card">
            <Clock size={20} />
            <div>
              <span className="stat-value">{stats.avgBreakdownTime}s</span>
              <span className="stat-label">Avg Time</span>
            </div>
          </div>
          <div className="stat-card">
            <AlertCircle size={20} />
            <div>
              <span className="stat-value">{stats.blockedItems}</span>
              <span className="stat-label">Blocked</span>
            </div>
          </div>
        </div>
      </div>

      <div className="idea-input-section">
        <h3>
          <Brain size={24} />
          Transform Your Idea into Structured Project
        </h3>
        <div className="input-group">
          <textarea
            value={ideaInput}
            onChange={(e) => setIdeaInput(e.target.value)}
            placeholder="Describe your project idea in detail. For example: 'Build a social media analytics dashboard that tracks engagement metrics across multiple platforms, provides real-time insights, and generates automated reports for marketing teams...'"
            rows={4}
            disabled={isProcessing}
          />
          <button
            onClick={handleBreakdown}
            disabled={!ideaInput.trim() || isProcessing}
            className="breakdown-btn"
          >
            {isProcessing ? (
              <>Processing...</>
            ) : (
              <>
                <Zap size={20} />
                Generate Breakdown
              </>
            )}
          </button>
        </div>
      </div>

      <div className="breakdown-levels">
        <h3>Hierarchical Breakdown Structure</h3>
        <div className="levels-flow">
          <div className="level-box idea">
            <span className="level-icon">💡</span>
            <span>Idea</span>
          </div>
          <div className="arrow">→</div>
          <div className="level-box initiative">
            <span className="level-icon">🎯</span>
            <span>Initiative</span>
          </div>
          <div className="arrow">→</div>
          <div className="level-box feature">
            <span className="level-icon">⚡</span>
            <span>Feature</span>
          </div>
          <div className="arrow">→</div>
          <div className="level-box epic">
            <span className="level-icon">📚</span>
            <span>Epic</span>
          </div>
          <div className="arrow">→</div>
          <div className="level-box story">
            <span className="level-icon">📝</span>
            <span>Story</span>
          </div>
          <div className="arrow">→</div>
          <div className="level-box task">
            <span className="level-icon">✓</span>
            <span>Task</span>
          </div>
          <div className="arrow">→</div>
          <div className="level-box subtask">
            <span className="level-icon">•</span>
            <span>Subtask</span>
          </div>
        </div>
      </div>

      {currentProject && (
        <ProjectBreakdown project={currentProject} />
      )}

      <div className="recent-projects">
        <h3>Recent Projects</h3>
        <div className="projects-grid">
          {projects.slice(0, 6).map(project => (
            <div key={project.id} className="project-card">
              <h4>{project.title}</h4>
              <p>{project.description?.substring(0, 100)}...</p>
              <div className="project-meta">
                <span>{project.itemCount} items</span>
                <span>{new Date(project.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};