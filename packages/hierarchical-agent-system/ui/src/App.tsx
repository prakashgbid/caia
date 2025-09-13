import React, { useState, useEffect } from 'react';
import { HierarchicalGrid } from './components/HierarchicalGrid';
import { Dashboard } from './components/Dashboard';
import { useProjectStore } from './stores/projectStore';
import './App.css';

function App() {
  const { currentView, setCurrentView } = useProjectStore();

  return (
    <div className="app">
      <header className="app-header">
        <h1>🎯 Hierarchical Project Planner</h1>
        <div className="view-switcher">
          <button
            className={currentView === 'dashboard' ? 'active' : ''}
            onClick={() => setCurrentView('dashboard')}
          >
            Dashboard
          </button>
          <button
            className={currentView === 'grid' ? 'active' : ''}
            onClick={() => setCurrentView('grid')}
          >
            Hierarchy Grid
          </button>
        </div>
      </header>

      <main className="app-main">
        {currentView === 'dashboard' ? <Dashboard /> : <HierarchicalGrid />}
      </main>
    </div>
  );
}

export default App;